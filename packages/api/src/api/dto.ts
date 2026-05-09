import { bytesToHex } from "@blockhash/slonks-core/hex";
import { isKnownSlopGameAddress } from "../chain/contracts.ts";
import type { MergeRow, TransferRow } from "../db/schema.ts";
import { isCustodiedClaimStatus, tokenStatus } from "../lib/snapshot.ts";

export type TokenListRow = {
  tokenId: number;
  exists?: boolean;
  owner?: string | null;
  sourceId: number | null;
  baseSourceId: number | null;
  mergeLevel: number;
  slop: number | null;
  slopLevel: number | null;
  punkType: string | null;
  attributesText: string | null;
  generatedPixels?: Uint8Array | null;
  sourceGeneratedPixels?: Uint8Array | null;
  originalRgba?: Uint8Array | null;
  claimStatus?: string | null;
  claimRecipient?: string | null;
};

export function tokenListDto(row: TokenListRow, includePixels: boolean) {
  const item: Record<string, unknown> = {
    tokenId: row.tokenId,
  };

  const isClaimCustodied = isKnownSlopGameAddress(row.owner);
  if ("exists" in row) item.status = tokenStatus(row.exists, row.claimStatus, isClaimCustodied);
  if ("owner" in row) item.owner = row.owner;
  if ("claimStatus" in row) {
    item.claimStatus = row.claimStatus ?? null;
    item.claimRecipient = row.claimRecipient ?? null;
    item.lockedOn = row.owner && isClaimCustodied && isCustodiedClaimStatus(row.claimStatus) ? row.owner : null;
  }

  Object.assign(item, {
    sourceId: row.sourceId,
    baseSourceId: row.baseSourceId,
    mergeLevel: row.mergeLevel,
    slop: row.slop,
    slopLevel: row.slopLevel,
    punkType: row.punkType,
    attributesText: row.attributesText,
  });

  if (includePixels) {
    const pixels = row.generatedPixels ?? row.sourceGeneratedPixels ?? null;
    item.generatedPixels = pixels ? bytesToHex(pixels) : null;
    item.originalRgba = row.originalRgba ? bytesToHex(row.originalRgba) : null;
  }

  return item;
}

export function includeParam(raw: string | undefined, value: string): boolean {
  if (!raw) return false;
  return raw.split(",").map((part) => part.trim().toLowerCase()).includes(value);
}

export function transferDto(row: TransferRow) {
  return {
    blockNumber: row.blockNumber.toString(),
    logIndex: row.logIndex,
    txHash: row.txHash,
    tokenId: row.tokenId,
    from: row.from,
    to: row.to,
    blockTimestamp: row.blockTimestamp.toISOString(),
  };
}

export function mergeDto(row: MergeRow) {
  return {
    blockNumber: row.blockNumber.toString(),
    logIndex: row.logIndex,
    txHash: row.txHash,
    survivorTokenId: row.survivorTokenId,
    burnedTokenId: row.burnedTokenId,
    burnedSourceId: row.burnedSourceId,
    mergeLevel: row.mergeLevel,
    blockTimestamp: row.blockTimestamp.toISOString(),
  };
}
