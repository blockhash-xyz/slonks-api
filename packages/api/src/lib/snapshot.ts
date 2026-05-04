import type { Address, Hex } from "viem";
import { getAddress } from "viem";
import type { Attribute } from "@blockhash/slonks-core/attributes";
import { bytesToHex } from "@blockhash/slonks-core/hex";
import type { CollectionStateRow, SourcePunkRow, TokenRow } from "../db/schema.ts";

// Mirrors slonks-web's TokenSnapshot so the API is a drop-in replacement.
export type TokenSnapshot = {
  chainId: 1;
  tokenId: string;
  exists: boolean;
  owner: Address | null;
  revealed: boolean;
  baseSourceId: number | null;
  sourceId: number | null;
  punkAttributesText: string | null;
  attributes: Attribute[];
  mergeLevel: number;
  embedding: Hex | null;
  generatedPixels: Hex | null;
  originalRgba: Hex | null;
  diffCount: number | null;
  slopLevel: number | null;
};

export type CollectionStatusDto = {
  chainId: 1;
  totalSupply: number;
  maxSupply: number;
  remainingSourceIds: number;
  revealed: boolean;
  revealBlockNumber: number;
  shuffleOffset: number;
  phase: "minting" | "pre-reveal" | "reveal-committed" | "revealed";
  sourcesPrecomputed: number;
  lastIndexedBlock: number;
};

export function buildTokenSnapshot(
  token: TokenRow | null,
  source: SourcePunkRow | null,
  collection: CollectionStateRow,
): TokenSnapshot | null {
  if (!token) return null;

  const revealed = collection.revealed;
  const exists = token.exists;
  const owner = token.owner ? toChecksum(token.owner) : null;

  const generatedBytes = token.generatedPixels ?? source?.generatedPixels ?? null;
  const originalBytes = source?.originalRgba ?? null;
  const embeddingBytes = token.mergeEmbedding ?? source?.sourceEmbedding ?? null;

  const showSource = exists && revealed && token.sourceId != null && source != null;

  return {
    chainId: 1,
    tokenId: token.tokenId.toString(),
    exists,
    owner,
    revealed,
    baseSourceId: token.baseSourceId ?? null,
    sourceId: showSource ? token.sourceId : null,
    punkAttributesText: showSource ? source!.attributesText : null,
    attributes: showSource ? source!.attributesJson : [],
    mergeLevel: token.mergeLevel,
    embedding: embeddingBytes && showSource ? bytesToHex(embeddingBytes) : null,
    generatedPixels: showSource && generatedBytes ? bytesToHex(generatedBytes) : null,
    originalRgba: showSource && originalBytes ? bytesToHex(originalBytes) : null,
    diffCount: showSource ? token.diffCount ?? null : null,
    slopLevel: showSource ? token.slopLevel ?? null : null,
  };
}

export function buildCollectionStatus(row: CollectionStateRow): CollectionStatusDto {
  const revealed = row.revealed;
  const revealBlockNumber = Number(row.revealBlockNumber);
  let phase: CollectionStatusDto["phase"];
  if (revealed) phase = "revealed";
  else if (revealBlockNumber > 0) phase = "reveal-committed";
  else if (row.totalSupply >= 10_000) phase = "pre-reveal";
  else phase = "minting";

  return {
    chainId: 1,
    totalSupply: row.totalSupply,
    maxSupply: 10_000,
    remainingSourceIds: row.remainingSourceIds,
    revealed,
    revealBlockNumber,
    shuffleOffset: row.shuffleOffset,
    phase,
    sourcesPrecomputed: row.sourcesPrecomputed,
    lastIndexedBlock: Number(row.lastIndexedBlock),
  };
}

function toChecksum(addr: string): Address {
  try {
    return getAddress(addr);
  } catch {
    return addr as Address;
  }
}
