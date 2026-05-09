import type { Address, Hex } from "viem";
import { getAddress } from "viem";
import type { Attribute } from "@blockhash/slonks-core/attributes";
import { bytesToHex } from "@blockhash/slonks-core/hex";
import { isKnownSlopGameAddress } from "../chain/contracts.ts";
import type { CollectionStateRow, SlopClaimRow, SourcePunkRow, TokenRow } from "../db/schema.ts";

export type TokenStatus = "active" | "burned" | "locked" | "voided";
export type TokenClaimInfo = Pick<SlopClaimRow, "status" | "recipient"> | null;

// Mirrors slonks-web's TokenSnapshot so the API is a drop-in replacement.
export type TokenSnapshot = {
  chainId: 1;
  tokenId: string;
  status: TokenStatus;
  exists: boolean;
  owner: Address | null;
  claimStatus: string | null;
  claimRecipient: Address | null;
  lockedOn: Address | null;
  revealed: boolean;
  baseSourceId: number | null;
  sourceId: number | null;
  punkAttributesText: string | null;
  attributes: Attribute[];
  mergeLevel: number;
  embedding: Hex | null;
  generatedPixels: Hex | null;
  originalRgba: Hex | null;
  slop: number | null;
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
  claim: TokenClaimInfo = null,
): TokenSnapshot | null {
  if (!token) return null;

  const revealed = collection.revealed;
  const exists = token.exists;
  const claimStatus = claim?.status ?? null;
  const owner = token.owner ? toChecksum(token.owner) : null;
  const isClaimCustodied = isKnownSlopGameAddress(owner);
  const status = tokenStatus(exists, claimStatus, isClaimCustodied);
  const claimRecipient = claim?.recipient ? toChecksum(claim.recipient) : null;
  const lockedOn = owner && isClaimCustodied && isCustodiedClaimStatus(claimStatus) ? owner : null;

  const generatedBytes = token.generatedPixels ?? source?.generatedPixels ?? null;
  const originalBytes = source?.originalRgba ?? null;
  const embeddingBytes = token.mergeEmbedding ?? source?.sourceEmbedding ?? null;

  const showSource = revealed && token.sourceId != null && source != null;
  const slop = token.slop ?? (token.mergeLevel === 0 ? source?.baseSlop : null) ?? null;
  const slopLevel = token.slopLevel ?? (token.mergeLevel === 0 ? source?.baseSlopLevel : null) ?? null;

  return {
    chainId: 1,
    tokenId: token.tokenId.toString(),
    status,
    exists,
    owner,
    claimStatus,
    claimRecipient,
    lockedOn,
    revealed,
    baseSourceId: token.baseSourceId ?? null,
    sourceId: showSource ? token.sourceId : null,
    punkAttributesText: showSource ? source!.attributesText : null,
    attributes: showSource ? source!.attributesJson : [],
    mergeLevel: token.mergeLevel,
    embedding: embeddingBytes && showSource ? bytesToHex(embeddingBytes) : null,
    generatedPixels: showSource && generatedBytes ? bytesToHex(generatedBytes) : null,
    originalRgba: showSource && originalBytes ? bytesToHex(originalBytes) : null,
    slop: showSource ? slop : null,
    slopLevel: showSource ? slopLevel : null,
  };
}

export function tokenStatus(
  exists: boolean | null | undefined,
  claimStatus?: string | null,
  isClaimCustodied = false,
): TokenStatus {
  if (!exists) return "burned";
  if (!isClaimCustodied) return "active";
  if (claimStatus === "pending") return "locked";
  if (claimStatus === "claimed" || claimStatus === "voided") return "voided";
  return "active";
}

export function isCustodiedClaimStatus(claimStatus?: string | null): boolean {
  return claimStatus === "pending" || claimStatus === "claimed" || claimStatus === "voided";
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
