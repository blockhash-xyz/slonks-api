import { eq } from "drizzle-orm";
import type { Hex } from "viem";
import { db } from "../db/client.ts";
import { voidProofs, type VoidProofRow } from "../db/schema.ts";
import { resolvedProofCacheKey } from "./cacheKey.ts";
import type { ResolvedVoidProofRequest, VoidProof } from "./voidProof.ts";

export async function readStoredVoidProof(request: ResolvedVoidProofRequest): Promise<VoidProof | null> {
  return readStoredVoidProofByCacheKey(resolvedProofCacheKey(request));
}

export async function readStoredVoidProofByCacheKey(cacheKey: string): Promise<VoidProof | null> {
  const [row] = await db.select().from(voidProofs).where(eq(voidProofs.cacheKey, cacheKey)).limit(1);
  return row ? rowToVoidProof(row) : null;
}

export async function writeStoredVoidProof(proof: VoidProof): Promise<void> {
  const request: ResolvedVoidProofRequest = {
    tokenId: proof.tokenId,
    sourceId: proof.sourceId,
    inputSource: proof.inputSource,
    embedding: proof.embedding,
    contracts: proof.contracts,
  };
  const generatedAt = new Date(proof.generatedAt);
  const row = {
    cacheKey: resolvedProofCacheKey(request),
    tokenId: proof.tokenId,
    sourceId: proof.sourceId,
    inputSource: proof.inputSource,
    embedding: proof.embedding,
    proof: proof.proof,
    publicInputs: proof.publicInputs,
    proofBytes: proof.proofBytes,
    publicInputsBytes: proof.publicInputsBytes,
    contracts: proof.contracts,
    timings: proof.timingsMs,
    generatedAt,
    updatedAt: new Date(),
  };

  await db
    .insert(voidProofs)
    .values(row)
    .onConflictDoUpdate({
      target: voidProofs.cacheKey,
      set: {
        proof: row.proof,
        publicInputs: row.publicInputs,
        proofBytes: row.proofBytes,
        publicInputsBytes: row.publicInputsBytes,
        contracts: row.contracts,
        timings: row.timings,
        generatedAt: row.generatedAt,
        updatedAt: row.updatedAt,
      },
    });
}

function rowToVoidProof(row: VoidProofRow): VoidProof {
  return {
    chainId: 1,
    tokenId: row.tokenId,
    sourceId: row.sourceId,
    inputSource: row.inputSource as VoidProof["inputSource"],
    embedding: row.embedding as Hex,
    proof: row.proof as Hex,
    publicInputs: row.publicInputs as Hex[],
    proofBytes: row.proofBytes,
    publicInputsBytes: row.publicInputsBytes,
    contracts: row.contracts as VoidProof["contracts"],
    timingsMs: row.timings as VoidProof["timingsMs"],
    generatedAt: row.generatedAt.toISOString(),
  };
}
