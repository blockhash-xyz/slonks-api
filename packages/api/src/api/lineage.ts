import { asc, inArray } from "drizzle-orm";
import { db } from "../db/client.ts";
import {
  merges,
  slopClaims,
  sourcePunks,
  tokens,
  type MergeRow,
  type SlopClaimRow,
  type SourcePunkRow,
  type TokenRow,
} from "../db/schema.ts";
import { isKnownSlopGameAddress } from "../chain/contracts.ts";
import { tokenStatus, type TokenStatus } from "../lib/snapshot.ts";
import { blendEmbeddings } from "@blockhash/slonks-core/blend";
import { diffPixels } from "@blockhash/slonks-core/diff";
import { bytesToHex, hexToBytes } from "@blockhash/slonks-core/hex";
import { renderEmbeddingPixelsLocal } from "@blockhash/slonks-core/imageModel";
import { mergeDto } from "./dto.ts";

type OrderedMerge = MergeRow & { order: number };

type MergeTreeState = {
  tokenId: number;
  sourceId: number | null;
  mergeLevel: number;
  stateSource: "source" | "merge-replay" | "indexed-current";
  embedding: `0x${string}` | null;
  generatedPixels?: `0x${string}` | null;
  originalRgba?: `0x${string}` | null;
  slop: number | null;
  slopLevel: number | null;
};

type MergeTreeStep = {
  event: ReturnType<typeof mergeDto>;
  before: MergeTreeState;
  after: MergeTreeState;
  change: {
    mergeLevelDelta: number | null;
    slopDelta: number | null;
    slopLevelDelta: number | null;
  };
  donor: MergeTreeNode;
};

type MergeTreeNode = {
  tokenId: number;
  status: TokenStatus;
  exists: boolean;
  owner: string | null;
  claimStatus: string | null;
  claimRecipient: string | null;
  sourceId: number | null;
  baseSourceId: number | null;
  punkType: string | null;
  attributesText: string | null;
  initial: MergeTreeState;
  current: MergeTreeState;
  mergeCount: number;
  leafCount: number;
  merges: MergeTreeStep[];
};

export type MergeTreeResponse = {
  tokenId: number;
  includePixels: boolean;
  tokenIds: number[];
  mergeCount: number;
  root: MergeTreeNode;
  merges: ReturnType<typeof mergeDto>[];
};

type BuildContext = {
  includePixels: boolean;
  bySurvivor: Map<number, OrderedMerge[]>;
  tokensById: Map<number, TokenRow>;
  claimsById: Map<number, SlopClaimRow>;
  sourcesById: Map<number, SourcePunkRow>;
};

export async function buildMergeTree(tokenId: number, includePixels: boolean): Promise<MergeTreeResponse | null> {
  const orderedMerges = (await db.select().from(merges).orderBy(asc(merges.blockNumber), asc(merges.logIndex))).map(
    (row, order) => ({ ...row, order }),
  );
  const bySurvivor = groupMergesBySurvivor(orderedMerges);
  const reachable = collectReachable(tokenId, bySurvivor);
  const tokenRows =
    reachable.tokenIds.size > 0
      ? await db.select().from(tokens).where(inArray(tokens.tokenId, [...reachable.tokenIds]))
      : [];
  const tokensById = new Map(tokenRows.map((row) => [row.tokenId, row]));
  if (!tokensById.has(tokenId) && !bySurvivor.has(tokenId)) return null;

  const claimRows =
    reachable.tokenIds.size > 0
      ? await db.select().from(slopClaims).where(inArray(slopClaims.tokenId, [...reachable.tokenIds]))
      : [];
  const claimsById = new Map(claimRows.map((row) => [row.tokenId, row]));

  const sourceIds = new Set<number>();
  for (const token of tokenRows) {
    if (token.sourceId != null) sourceIds.add(token.sourceId);
  }
  const sourceRows =
    sourceIds.size > 0 ? await db.select().from(sourcePunks).where(inArray(sourcePunks.sourceId, [...sourceIds])) : [];
  const sourcesById = new Map(sourceRows.map((row) => [row.sourceId, row]));

  const context: BuildContext = {
    includePixels,
    bySurvivor,
    tokensById,
    claimsById,
    sourcesById,
  };
  const root = buildNode(tokenId, Number.POSITIVE_INFINITY, context, new Set(), true);
  const mergeRows = [...reachable.mergeOrders].sort((a, b) => a - b).map((order) => orderedMerges[order]!);

  return {
    tokenId,
    includePixels,
    tokenIds: [...reachable.tokenIds].sort((a, b) => a - b),
    mergeCount: mergeRows.length,
    root,
    merges: mergeRows.map(mergeDto),
  };
}

function groupMergesBySurvivor(rows: OrderedMerge[]): Map<number, OrderedMerge[]> {
  const bySurvivor = new Map<number, OrderedMerge[]>();
  for (const row of rows) {
    const list = bySurvivor.get(row.survivorTokenId) ?? [];
    list.push(row);
    bySurvivor.set(row.survivorTokenId, list);
  }
  return bySurvivor;
}

function collectReachable(tokenId: number, bySurvivor: Map<number, OrderedMerge[]>) {
  const tokenIds = new Set<number>();
  const mergeOrders = new Set<number>();

  function visit(id: number, cutoffOrder: number): void {
    tokenIds.add(id);
    for (const event of bySurvivor.get(id) ?? []) {
      if (event.order >= cutoffOrder) break;
      mergeOrders.add(event.order);
      visit(event.burnedTokenId, event.order);
    }
  }

  visit(tokenId, Number.POSITIVE_INFINITY);
  return { tokenIds, mergeOrders };
}

function buildNode(
  tokenId: number,
  cutoffOrder: number,
  context: BuildContext,
  stack: Set<number>,
  useIndexedCurrent = false,
): MergeTreeNode {
  if (stack.has(tokenId)) throw new Error(`cycle detected in merge tree at token ${tokenId}`);
  stack.add(tokenId);

  const token = context.tokensById.get(tokenId) ?? null;
  const claim = context.claimsById.get(tokenId) ?? null;
  const source = token?.sourceId == null ? null : context.sourcesById.get(token.sourceId) ?? null;
  const initial = initialState(tokenId, token, source, context.includePixels);
  let current = initial;
  const steps: MergeTreeStep[] = [];
  let mergeCount = 0;
  let leafCount = 1;

  for (const event of context.bySurvivor.get(tokenId) ?? []) {
    if (event.order >= cutoffOrder) break;
    const before = current;
    const donor = buildNode(event.burnedTokenId, event.order, context, stack);
    const after = mergedState(tokenId, token, source, before, donor.current, event, context.includePixels);
    steps.push({
      event: mergeDto(event),
      before,
      after,
      change: {
        mergeLevelDelta: after.mergeLevel - before.mergeLevel,
        slopDelta: delta(before.slop, after.slop),
        slopLevelDelta: delta(before.slopLevel, after.slopLevel),
      },
      donor,
    });
    current = after;
    mergeCount += 1 + donor.mergeCount;
    leafCount += donor.leafCount;
  }

  const replayedCurrent = current;
  const indexedCurrent =
    useIndexedCurrent && token?.exists ? indexedCurrentState(tokenId, token, source, context.includePixels) : null;
  current = indexedCurrent ?? replayedCurrent;

  stack.delete(tokenId);
  return {
    tokenId,
    status: tokenStatus(token?.exists, claim?.status, isKnownSlopGameAddress(token?.owner)),
    exists: token?.exists ?? false,
    owner: token?.owner ?? null,
    claimStatus: claim?.status ?? null,
    claimRecipient: claim?.recipient ?? null,
    sourceId: token?.sourceId ?? null,
    baseSourceId: token?.baseSourceId ?? null,
    punkType: source?.punkType ?? null,
    attributesText: source?.attributesText ?? null,
    initial,
    current,
    mergeCount,
    leafCount,
    merges: steps,
  };
}

function initialState(
  tokenId: number,
  token: TokenRow | null,
  source: SourcePunkRow | null,
  includePixels: boolean,
): MergeTreeState {
  return stateDto({
    tokenId,
    sourceId: token?.sourceId ?? null,
    mergeLevel: 0,
    stateSource: "source",
    embedding: source?.sourceEmbedding ?? null,
    generatedPixels: source?.generatedPixels ?? null,
    originalRgba: source?.originalRgba ?? null,
    slop: source?.baseSlop ?? null,
    slopLevel: source?.baseSlopLevel ?? null,
    includePixels,
  });
}

function mergedState(
  tokenId: number,
  token: TokenRow | null,
  source: SourcePunkRow | null,
  survivor: MergeTreeState,
  donor: MergeTreeState,
  event: OrderedMerge,
  includePixels: boolean,
): MergeTreeState {
  const survivorEmbedding = survivor.embedding ? hexToBytes(survivor.embedding) : null;
  const donorEmbedding = donor.embedding ? hexToBytes(donor.embedding) : null;
  const embedding = survivorEmbedding && donorEmbedding ? blendEmbeddings(survivorEmbedding, donorEmbedding) : null;
  const generatedPixels = embedding ? renderEmbeddingPixelsLocal(embedding) : null;
  const diff = generatedPixels && source?.originalRgba ? diffPixels(generatedPixels, source.originalRgba) : null;

  return stateDto({
    tokenId,
    sourceId: token?.sourceId ?? null,
    mergeLevel: event.mergeLevel,
    stateSource: "merge-replay",
    embedding,
    generatedPixels,
    originalRgba: source?.originalRgba ?? null,
    slop: diff?.count ?? null,
    slopLevel: diff?.slopLevel ?? null,
    includePixels,
  });
}

function indexedCurrentState(
  tokenId: number,
  token: TokenRow,
  source: SourcePunkRow | null,
  includePixels: boolean,
): MergeTreeState {
  const generatedPixels = token.generatedPixels ?? source?.generatedPixels ?? null;
  const embedding = token.mergeEmbedding ?? source?.sourceEmbedding ?? null;
  const slop = token.slop ?? (token.mergeLevel === 0 ? source?.baseSlop : null) ?? null;
  const slopLevel = token.slopLevel ?? (token.mergeLevel === 0 ? source?.baseSlopLevel : null) ?? null;

  return stateDto({
    tokenId,
    sourceId: token.sourceId ?? null,
    mergeLevel: token.mergeLevel,
    stateSource: "indexed-current",
    embedding,
    generatedPixels,
    originalRgba: source?.originalRgba ?? null,
    slop,
    slopLevel,
    includePixels,
  });
}

function stateDto(input: {
  tokenId: number;
  sourceId: number | null;
  mergeLevel: number;
  stateSource: MergeTreeState["stateSource"];
  embedding: Uint8Array | null;
  generatedPixels: Uint8Array | null;
  originalRgba: Uint8Array | null;
  slop: number | null;
  slopLevel: number | null;
  includePixels: boolean;
}): MergeTreeState {
  const state: MergeTreeState = {
    tokenId: input.tokenId,
    sourceId: input.sourceId,
    mergeLevel: input.mergeLevel,
    stateSource: input.stateSource,
    embedding: input.embedding ? bytesToHex(input.embedding) : null,
    slop: input.slop,
    slopLevel: input.slopLevel,
  };

  if (input.includePixels) {
    state.generatedPixels = input.generatedPixels ? bytesToHex(input.generatedPixels) : null;
    state.originalRgba = input.originalRgba ? bytesToHex(input.originalRgba) : null;
  }

  return state;
}

function delta(before: number | null, after: number | null): number | null {
  if (before == null || after == null) return null;
  return after - before;
}
