import { eq, inArray } from "drizzle-orm";
import { getAddress, type Address, type Hex } from "viem";
import { db } from "../db/client.ts";
import { sourcePunks, tokens, type SourcePunkRow, type TokenRow } from "../db/schema.ts";
import { blendEmbeddings } from "@blockhash/slonks-core/blend";
import { diffPixels } from "@blockhash/slonks-core/diff";
import { bytesToHex } from "@blockhash/slonks-core/hex";
import { renderEmbeddingPixelsLocal } from "@blockhash/slonks-core/imageModel";

export type MergePreviewPair = {
  survivorTokenId: number;
  donorTokenId: number;
};

export type MergePreviewItem = {
  chainId: 1;
  survivorTokenId: number;
  donorTokenId: number;
  owner: Address | null;
  survivorOwner: Address | null;
  donorOwner: Address | null;
  survivorSourceId: number;
  donorSourceId: number;
  currentMergeLevel: number;
  previewMergeLevel: number;
  embedding: Hex;
  generatedPixels: Hex;
  originalRgba: Hex;
  diffMask: Hex;
  diffCount: number;
  slopLevel: number;
};

export type MergePreviewError = MergePreviewPair & {
  error: string;
  status: number;
  survivorMergeLevel?: number;
  donorMergeLevel?: number;
};

type TokenSourceRow = {
  token: TokenRow;
  source: SourcePunkRow | null;
};

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

export function computeMergePreview(
  pair: MergePreviewPair,
  byId: Map<number, TokenSourceRow>,
): { item: MergePreviewItem } | { error: MergePreviewError } {
  const { survivorTokenId, donorTokenId } = pair;
  if (survivorTokenId === donorTokenId) {
    return failure(pair, "cannot merge token into itself", 400);
  }

  const survivor = byId.get(survivorTokenId);
  const donor = byId.get(donorTokenId);
  if (!survivor?.token.exists) return failure(pair, `survivor token ${survivorTokenId} not found`, 404);
  if (!donor?.token.exists) return failure(pair, `donor token ${donorTokenId} not found`, 404);

  if (survivor.token.mergeLevel !== donor.token.mergeLevel) {
    return {
      error: {
        ...pair,
        error: "merge level mismatch",
        status: 409,
        survivorMergeLevel: survivor.token.mergeLevel,
        donorMergeLevel: donor.token.mergeLevel,
      },
    };
  }
  if (survivor.token.mergeLevel >= 255) return failure(pair, "merge level overflow", 409);

  const survivorEmbedding = embeddingFor(survivor);
  const donorEmbedding = embeddingFor(donor);
  if (!survivorEmbedding || !donorEmbedding) return failure(pair, "token embeddings are not ready", 409);
  if (!survivor.source?.originalRgba || survivor.token.sourceId == null || donor.token.sourceId == null) {
    return failure(pair, "token source data is not ready", 409);
  }

  const blended = blendEmbeddings(survivorEmbedding, donorEmbedding);
  const generated = renderEmbeddingPixelsLocal(blended);
  const diff = diffPixels(generated, survivor.source.originalRgba);

  return {
    item: {
      chainId: 1,
      survivorTokenId,
      donorTokenId,
      owner: formatOwner(survivor.token.owner),
      survivorOwner: formatOwner(survivor.token.owner),
      donorOwner: formatOwner(donor.token.owner),
      survivorSourceId: survivor.token.sourceId,
      donorSourceId: donor.token.sourceId,
      currentMergeLevel: survivor.token.mergeLevel,
      previewMergeLevel: survivor.token.mergeLevel + 1,
      embedding: bytesToHex(blended),
      generatedPixels: bytesToHex(generated),
      originalRgba: bytesToHex(survivor.source.originalRgba),
      diffMask: bytesToHex(diff.mask),
      diffCount: diff.count,
      slopLevel: diff.slopLevel,
    },
  };
}

function embeddingFor(row: TokenSourceRow): Uint8Array | null {
  return row.token.mergeEmbedding ?? row.source?.sourceEmbedding ?? null;
}

function formatOwner(owner: string | null): Address | null {
  if (!owner) return null;
  try {
    return getAddress(owner);
  } catch {
    return owner as Address;
  }
}

function failure(pair: MergePreviewPair, error: string, status: number): { error: MergePreviewError } {
  return { error: { ...pair, error, status } };
}
