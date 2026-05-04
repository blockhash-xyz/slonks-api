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
export type { MergePreviewError, MergePreviewItem, MergePreviewPair };
