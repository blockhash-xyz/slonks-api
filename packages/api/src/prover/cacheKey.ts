import { createHash } from "node:crypto";
import { getAddress } from "viem";
import { CHAIN_ID, CONTRACTS } from "../chain/contracts.ts";
import type { ProofContracts, ProofInput, ResolvedVoidProofRequest } from "./voidProof.ts";

export function resolvedProofCacheKey(request: ResolvedVoidProofRequest): string {
  const { tokenId, contracts, ...input } = request;
  return proofCacheKey(tokenId, input, contracts);
}

export function proofCacheKey(tokenId: number, input: ProofInput, contracts: ProofContracts): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        version: "slop-model-proof-v1",
        chainId: CHAIN_ID,
        tokenId,
        sourceId: input.sourceId,
        inputSource: input.inputSource,
        embedding: input.embedding,
        contracts: canonicalProofContracts(contracts),
      }),
    )
    .digest("hex");
}

function canonicalProofContracts(contracts: ProofContracts): ProofContracts {
  return {
    slonks: getAddress(contracts.slonks),
    renderer: getAddress(contracts.renderer),
    imageModel: getAddress(contracts.imageModel),
    mergeManager: getAddress(contracts.mergeManager),
    activeState: contracts.activeState ? getAddress(contracts.activeState) : null,
    claimContract: getAddress(contracts.claimContract ?? CONTRACTS.slopClaimExtension),
  };
}
