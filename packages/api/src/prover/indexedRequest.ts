import { eq } from "drizzle-orm";
import { getAddress, type Hex } from "viem";
import { bytesToHex } from "@blockhash/slonks-core/proof";
import { db } from "../db/client.ts";
import { sourcePunks, tokens } from "../db/schema.ts";
import { CONTRACTS } from "../chain/contracts.ts";
import type { ProofContracts, ResolvedVoidProofRequest } from "./voidProof.ts";

export async function resolveIndexedVoidProofRequest(tokenId: number): Promise<ResolvedVoidProofRequest | null> {
  const [row] = await db
    .select({
      sourceId: tokens.sourceId,
      mergeEmbedding: tokens.mergeEmbedding,
      sourceEmbedding: sourcePunks.sourceEmbedding,
    })
    .from(tokens)
    .leftJoin(sourcePunks, eq(sourcePunks.sourceId, tokens.sourceId))
    .where(eq(tokens.tokenId, tokenId))
    .limit(1);
  if (!row || row.sourceId == null) return null;

  if (row.mergeEmbedding) {
    return {
      tokenId,
      sourceId: row.sourceId,
      inputSource: "merge embedding",
      embedding: bytesToHex(row.mergeEmbedding) as Hex,
      contracts: configuredProofContracts(),
    };
  }

  if (!row.sourceEmbedding) return null;

  return {
    tokenId,
    sourceId: row.sourceId,
    inputSource: "source embedding",
    embedding: bytesToHex(row.sourceEmbedding) as Hex,
    contracts: configuredProofContracts(),
  };
}

function configuredProofContracts(): ProofContracts {
  return {
    slonks: getAddress(CONTRACTS.slonks),
    renderer: getAddress(CONTRACTS.renderer),
    imageModel: getAddress(CONTRACTS.imageModel),
    mergeManager: getAddress(CONTRACTS.mergeManager),
    activeState: getAddress(CONTRACTS.slopGame),
  };
}
