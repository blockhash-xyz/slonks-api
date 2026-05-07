import { and, eq } from "drizzle-orm";
import { slopGameAbi } from "../chain/abis.ts";
import { publicClient } from "../chain/client.ts";
import { CONTRACTS } from "../chain/contracts.ts";
import { db } from "../db/client.ts";
import { slopClaims, tokens } from "../db/schema.ts";

const GAME_OWNER = CONTRACTS.slopGame.toLowerCase();

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
        eq(tokens.owner, GAME_OWNER),
      ),
    )
    .limit(1);

  return !!row;
}

export async function isPendingVoidClaim(tokenId: number): Promise<boolean> {
  if (await isIndexedPendingVoidClaim(tokenId)) return true;

  try {
    return await publicClient().readContract({
      address: CONTRACTS.slopGame,
      abi: slopGameAbi,
      functionName: "isSlopClaimPending",
      args: [BigInt(tokenId)],
    });
  } catch (err) {
    console.warn(`isSlopClaimPending(${tokenId}) failed:`, err);
    return false;
  }
}

export function notPendingVoidClaimMessage(tokenId: number): string {
  return `token ${tokenId} is not locked in the game with a pending SLOP claim`;
}
