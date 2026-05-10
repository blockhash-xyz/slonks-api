import { and, eq, inArray } from "drizzle-orm";
import { slopGameAbi } from "../chain/abis.ts";
import { publicClient } from "../chain/client.ts";
import { SLOP_CLAIM_CONTRACTS, SLOP_GAME_ADDRESSES } from "../chain/contracts.ts";
import { db } from "../db/client.ts";
import { slopClaims, tokens } from "../db/schema.ts";

const CLAIM_CUSTODY_OWNERS = SLOP_GAME_ADDRESSES.map((address) => address.toLowerCase());

export async function isIndexedPendingVoidClaim(tokenId: number): Promise<boolean> {
  const [row] = await db
    .select({ tokenId: slopClaims.tokenId })
    .from(slopClaims)
    .innerJoin(tokens, eq(tokens.tokenId, slopClaims.tokenId))
    .where(
      and(
        eq(slopClaims.tokenId, tokenId),
        eq(slopClaims.status, "pending"),
        eq(tokens.exists, true),
        inArray(tokens.owner, CLAIM_CUSTODY_OWNERS),
      ),
    )
    .limit(1);

  return !!row;
}

export async function isPendingVoidClaim(tokenId: number): Promise<boolean> {
  if (await isIndexedPendingVoidClaim(tokenId)) return true;

  const client = publicClient();
  const reads = await Promise.all(
    SLOP_CLAIM_CONTRACTS.map(async (address) => {
      try {
        return await client.readContract({
          address,
          abi: slopGameAbi,
          functionName: "isSlopClaimPending",
          args: [BigInt(tokenId)],
        });
      } catch (err) {
        console.warn(`isSlopClaimPending(${tokenId}) failed on ${address}:`, err);
        return false;
      }
    }),
  );
  return reads.some(Boolean);
}

export function notPendingVoidClaimMessage(tokenId: number): string {
  return `token ${tokenId} is not locked in a claim contract with a pending SLOP claim`;
}
