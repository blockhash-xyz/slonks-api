import { eq, inArray } from "drizzle-orm";
import { db } from "../db/client.ts";
import { sourcePunks, tokens } from "../db/schema.ts";
import {
  computeMergePreview,
  type MergePreviewError,
  type MergePreviewItem,
  type MergePreviewPair,
} from "./mergePreviewCompute.ts";

export async function computeMergePreviews(
  pairs: MergePreviewPair[],
): Promise<{ items: MergePreviewItem[]; errors: MergePreviewError[] }> {
  const ids = Array.from(new Set(pairs.flatMap((pair) => [pair.survivorTokenId, pair.donorTokenId])));
  const rows = ids.length
    ? await db
        .select({ token: tokens, source: sourcePunks })
        .from(tokens)
        .leftJoin(sourcePunks, eq(sourcePunks.sourceId, tokens.sourceId))
        .where(inArray(tokens.tokenId, ids))
    : [];
  const byId = new Map(rows.map((row) => [row.token.tokenId, row]));

  const items: MergePreviewItem[] = [];
  const errors: MergePreviewError[] = [];
  for (const pair of pairs) {
    const result = computeMergePreview(pair, byId);
    if ("item" in result) items.push(result.item);
    else errors.push(result.error);
  }

  return { items, errors };
}

const MAX_ACTIVE_PREVIEW_JOBS = 1;
const MAX_CACHED_PREVIEW_PAIRS = 25;
const MAX_PREVIEW_CACHE_ENTRIES = 250;
const PREVIEW_CACHE_TTL_MS = 30_000;

type MergePreviewResult = Awaited<ReturnType<typeof computeMergePreviews>>;
type PreviewCacheEntry = {
  expiresAt: number;
  value: MergePreviewResult;
};

const completedPreviewJobs = new Map<string, PreviewCacheEntry>();
const pendingPreviewJobs = new Map<string, Promise<MergePreviewResult>>();
let activePreviewJobs = 0;

export class MergePreviewBusyError extends Error {
  retryAfter = 1;

  constructor() {
    super("merge preview is busy; retry shortly");
  }
}

export async function computeMergePreviewsControlled(pairs: MergePreviewPair[]): Promise<MergePreviewResult> {
  const key = previewKey(pairs);
  const now = Date.now();
  const cached = completedPreviewJobs.get(key);
  if (cached && cached.expiresAt > now) {
    completedPreviewJobs.delete(key);
    completedPreviewJobs.set(key, cached);
    return cached.value;
  }
  if (cached) completedPreviewJobs.delete(key);

  const pending = pendingPreviewJobs.get(key);
  if (pending) return pending;

  if (activePreviewJobs >= MAX_ACTIVE_PREVIEW_JOBS) {
    throw new MergePreviewBusyError();
  }

  activePreviewJobs += 1;
  const promise = computeMergePreviews(pairs);
  pendingPreviewJobs.set(key, promise);

  try {
    const result = await promise;
    if (pairs.length <= MAX_CACHED_PREVIEW_PAIRS) {
      completedPreviewJobs.set(key, { value: result, expiresAt: now + PREVIEW_CACHE_TTL_MS });
      evictPreviewCache();
    }
    return result;
  } finally {
    activePreviewJobs -= 1;
    pendingPreviewJobs.delete(key);
  }
}

function previewKey(pairs: MergePreviewPair[]): string {
  return JSON.stringify(pairs);
}

function evictPreviewCache(): void {
  for (const key of completedPreviewJobs.keys()) {
    if (completedPreviewJobs.size <= MAX_PREVIEW_CACHE_ENTRIES) break;
    completedPreviewJobs.delete(key);
  }
}

export type { MergePreviewError, MergePreviewItem, MergePreviewPair };
