// Stateful side effects for indexed events: writes to `tokens`, `transfers`,
// `merges`. The sync loop calls these in arrival order.

import { and, eq, gt, isNull, or } from "drizzle-orm";
import { CONTRACTS } from "../chain/contracts.ts";
import { publicClient } from "../chain/client.ts";
import { slonksAbi, slonksMergeManagerAbi } from "../chain/abis.ts";
import { db } from "../db/client.ts";
import { merges, sourcePunks, tokens, transfers } from "../db/schema.ts";
import { diffPixels } from "@blockhash/slonks-core/diff";
import { renderEmbeddingPixelsLocal } from "@blockhash/slonks-core/imageModel";

type TransferRecord = {
  blockNumber: bigint;
  logIndex: number;
  txHash: string;
  tokenId: number;
  from: string;
  to: string;
  blockTimestamp: Date;
};

type MergeRecord = {
  blockNumber: bigint;
  logIndex: number;
  txHash: string;
  survivorTokenId: number;
  burnedTokenId: number;
  burnedSourceId: number;
  mergeLevel: number;
  blockTimestamp: Date;
};

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

export async function recordTransfer(t: TransferRecord): Promise<void> {
  await db
    .insert(transfers)
    .values(t)
    .onConflictDoNothing({ target: [transfers.blockNumber, transfers.logIndex] });
}

export async function recordMerge(m: MergeRecord): Promise<boolean> {
  const inserted = await db
    .insert(merges)
    .values(m)
    .onConflictDoNothing({ target: [merges.blockNumber, merges.logIndex] })
    .returning({ blockNumber: merges.blockNumber });

  if (inserted.length === 0) return false;

  await db
    .update(tokens)
    .set({
      mergeLevel: m.mergeLevel,
      mergeEmbedding: null,
      generatedPixels: null,
      slop: null,
      slopLevel: null,
      updatedAt: new Date(),
    })
    .where(eq(tokens.tokenId, m.survivorTokenId));

  await db
    .update(tokens)
    .set({
      mergeLevel: 0,
      mergeEmbedding: null,
      generatedPixels: null,
      slop: null,
      slopLevel: null,
      updatedAt: new Date(),
    })
    .where(eq(tokens.tokenId, m.burnedTokenId));

  return true;
}

// Upsert a token row reflecting the latest Transfer. On mint, we also pull
// `baseSourceIdFor(tokenId)` so the token can be source-mapped at reveal.
export async function ensureToken(
  tokenId: number,
  blockNumber: bigint,
  isMint: boolean,
  isBurn: boolean,
  newOwnerLower: string,
): Promise<void> {
  if (isMint) {
    const baseSourceId = await readBaseSourceId(tokenId);
    await db
      .insert(tokens)
      .values({
        tokenId,
        exists: !isBurn,
        owner: newOwnerLower === ZERO_ADDR ? null : newOwnerLower,
        baseSourceId,
        mintedAtBlock: blockNumber,
        lastEventBlock: blockNumber,
      })
      .onConflictDoUpdate({
        target: tokens.tokenId,
        set: {
          exists: !isBurn,
          owner: newOwnerLower === ZERO_ADDR ? null : newOwnerLower,
          baseSourceId,
          mintedAtBlock: blockNumber,
          lastEventBlock: blockNumber,
          updatedAt: new Date(),
        },
      });
    return;
  }

  await db
    .insert(tokens)
    .values({
      tokenId,
      exists: !isBurn,
      owner: isBurn ? null : newOwnerLower,
      lastEventBlock: blockNumber,
    })
    .onConflictDoUpdate({
      target: tokens.tokenId,
      set: {
        exists: !isBurn,
        owner: isBurn ? null : newOwnerLower,
        lastEventBlock: blockNumber,
        updatedAt: new Date(),
      },
    });
}

export async function repairMissingBaseSourceIds(limit = 100): Promise<number> {
  const rows = await db
    .select({ tokenId: tokens.tokenId })
    .from(tokens)
    .where(isNull(tokens.baseSourceId))
    .limit(limit);

  let repaired = 0;
  for (const row of rows) {
    const baseSourceId = await readBaseSourceId(row.tokenId);
    if (baseSourceId == null) continue;
    await db
      .update(tokens)
      .set({ baseSourceId, updatedAt: new Date() })
      .where(eq(tokens.tokenId, row.tokenId));
    repaired++;
  }
  return repaired;
}

async function readBaseSourceId(tokenId: number): Promise<number | null> {
  try {
    const result = await publicClient().readContract({
      address: CONTRACTS.slonks,
      abi: slonksAbi,
      functionName: "baseSourceIdFor",
      args: [BigInt(tokenId)],
    });
    return Number(result);
  } catch (err) {
    console.warn(`baseSourceIdFor(${tokenId}) failed:`, err);
    return null;
  }
}

// Called after a SlonkMerged event. Re-renders pixels from the post-blend
// embedding (which the manager already stored), recomputes slop against
// the survivor's base punk, and burns the donor row.
export async function applyMergeRender(survivorTokenId: number, burnedTokenId: number): Promise<void> {
  await refreshTokenRenderFromChain(survivorTokenId);

  // The burned token's row should already be marked exists=false by its
  // Transfer event to 0x0; clear any stale merge rendering fields if present.
  await db
    .update(tokens)
    .set({
      mergeLevel: 0,
      mergeEmbedding: null,
      generatedPixels: null,
      slop: null,
      slopLevel: null,
      updatedAt: new Date(),
    })
    .where(eq(tokens.tokenId, burnedTokenId));
}

export async function reconcileMergedTokens(limit = 50): Promise<number> {
  const rows = await db
    .select({ tokenId: tokens.tokenId })
    .from(tokens)
    .where(
      and(
        gt(tokens.mergeLevel, 0),
        or(
          isNull(tokens.mergeEmbedding),
          isNull(tokens.generatedPixels),
          isNull(tokens.slop),
          isNull(tokens.slopLevel),
        ),
      ),
    )
    .limit(limit);

  let completed = 0;
  for (const row of rows) {
    if (await refreshTokenRenderFromChain(row.tokenId)) completed++;
  }
  return completed;
}

export async function refreshTokenRenderFromChain(survivorTokenId: number): Promise<boolean> {
  const [survivor] = await db.select().from(tokens).where(eq(tokens.tokenId, survivorTokenId)).limit(1);
  if (!survivor) {
    console.warn(`refreshTokenRenderFromChain: survivor ${survivorTokenId} not found`);
    return false;
  }

  // Pull the new on-chain merge state (level + embedding) directly from the manager.
  const [level, embeddingHex] = await Promise.all([
    publicClient().readContract({
      address: CONTRACTS.mergeManager,
      abi: slonksMergeManagerAbi,
      functionName: "mergeLevel",
      args: [BigInt(survivorTokenId)],
    }),
    publicClient().readContract({
      address: CONTRACTS.mergeManager,
      abi: slonksMergeManagerAbi,
      functionName: "mergeEmbedding",
      args: [BigInt(survivorTokenId)],
    }),
  ]);

  const embeddingBytes = embeddingHex.length > 2 ? hexToBytes(embeddingHex) : null;
  const update: Partial<typeof tokens.$inferInsert> = {
    mergeLevel: Number(level),
    mergeEmbedding: embeddingBytes,
    generatedPixels: null,
    slop: null,
    slopLevel: null,
    updatedAt: new Date(),
  };

  let generated: Uint8Array | null = null;
  if (embeddingBytes) {
    generated = renderEmbeddingPixelsLocal(embeddingBytes);
    update.generatedPixels = generated;
  }

  // Slop vs the survivor's source punk. Requires source_punks row.
  let hasDiff = false;
  if (generated && survivor.sourceId != null) {
    const [src] = await db.select().from(sourcePunks).where(eq(sourcePunks.sourceId, survivor.sourceId)).limit(1);
    if (src) {
      const d = diffPixels(generated, src.originalRgba);
      update.slop = d.count;
      update.slopLevel = d.slopLevel;
      hasDiff = true;
    }
  } else if (Number(level) === 0 && survivor.sourceId != null) {
    const [src] = await db.select().from(sourcePunks).where(eq(sourcePunks.sourceId, survivor.sourceId)).limit(1);
    if (src) {
      update.generatedPixels = src.generatedPixels;
      update.slop = src.baseSlop;
      update.slopLevel = src.baseSlopLevel;
      hasDiff = true;
    }
  }

  await db
    .update(tokens)
    .set(update)
    .where(eq(tokens.tokenId, survivorTokenId));

  return Boolean(hasDiff || embeddingBytes || Number(level) === 0);
}

// Placeholder for callers that want to recompute a token snapshot post-reveal
// without going through fillSourceIdsAfterReveal. Currently a no-op since
// the global reveal path covers everything.
export async function syncTokenPostReveal(_tokenId: number): Promise<void> {}

function hexToBytes(hex: `0x${string}`): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length === 0) return new Uint8Array(0);
  if (clean.length % 2 !== 0) throw new Error(`invalid hex length: ${clean.length}`);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
