import { Hono } from "hono";
import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import { getAddress, isAddress } from "viem";
import { CONTRACTS } from "../../chain/contracts.ts";
import { db } from "../../db/client.ts";
import { slopClaims, sourcePunks, tokens } from "../../db/schema.ts";
import { CACHE, setCache } from "../cache.ts";
import { includeParam, tokenListDto } from "../dto.ts";

export const voidRoutes = new Hono();
const ACTIVE_GAME_OWNER = CONTRACTS.slopGame.toLowerCase();

// Slonks locked in the active SLOP game with an unclaimed SLOP claim.
voidRoutes.get("/pending-claims", async (c) => {
  const sp = c.req.query();
  const page = Number(sp.page ?? 1);
  const limit = Math.min(Math.max(Number(sp.limit ?? 50), 1), 200);
  if (!Number.isInteger(page) || page < 1) return c.json({ error: "invalid page" }, 400);
  if (!Number.isInteger(limit)) return c.json({ error: "invalid limit" }, 400);

  const includePixels = includeParam(sp.include, "pixels");
  const owner = sp.owner ?? sp.recipient;
  const conditions: SQL[] = [
    eq(slopClaims.status, "pending"),
    eq(tokens.exists, true),
    eq(tokens.owner, ACTIVE_GAME_OWNER),
  ];
  if (owner) {
    if (!isAddress(owner)) return c.json({ error: "invalid owner" }, 400);
    conditions.push(eq(slopClaims.recipient, owner.toLowerCase()));
  }

  const selectFields = {
    tokenId: tokens.tokenId,
    exists: tokens.exists,
    owner: tokens.owner,
    sourceId: tokens.sourceId,
    baseSourceId: tokens.baseSourceId,
    mergeLevel: tokens.mergeLevel,
    slop: tokens.slop,
    slopLevel: tokens.slopLevel,
    punkType: sourcePunks.punkType,
    attributesText: sourcePunks.attributesText,
    claimRecipient: slopClaims.recipient,
    lockedAtBlock: slopClaims.lockedAtBlock,
    lockedAtLogIndex: slopClaims.lockedAtLogIndex,
    lockedAtTxHash: slopClaims.lockedAtTxHash,
    lockedAtTimestamp: slopClaims.lockedAtTimestamp,
    ...(includePixels
      ? {
          generatedPixels: tokens.generatedPixels,
          sourceGeneratedPixels: sourcePunks.generatedPixels,
          originalRgba: sourcePunks.originalRgba,
        }
      : {}),
  };

  const where = and(...conditions);
  const offset = (page - 1) * limit;
  const [countRow, rows] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(slopClaims)
      .innerJoin(tokens, eq(tokens.tokenId, slopClaims.tokenId))
      .where(where),
    db
      .select(selectFields)
      .from(slopClaims)
      .innerJoin(tokens, eq(tokens.tokenId, slopClaims.tokenId))
      .leftJoin(sourcePunks, eq(sourcePunks.sourceId, tokens.sourceId))
      .where(where)
      .orderBy(desc(slopClaims.lockedAtBlock), desc(slopClaims.lockedAtLogIndex), asc(slopClaims.tokenId))
      .limit(limit + 1)
      .offset(offset),
  ]);

  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).map((row) => ({
    ...tokenListDto(row, includePixels),
    claimStatus: "pending",
    claimRecipient: row.claimRecipient ? getAddress(row.claimRecipient) : null,
    lockedAtBlock: row.lockedAtBlock?.toString() ?? null,
    lockedAtLogIndex: row.lockedAtLogIndex,
    lockedAtTxHash: row.lockedAtTxHash,
    lockedAtTimestamp: row.lockedAtTimestamp?.toISOString() ?? null,
  }));

  setCache(c, CACHE.pendingClaims);
  return c.json({
    chainId: 1,
    owner: owner ? getAddress(owner) : undefined,
    count: countRow[0]?.count ?? 0,
    page,
    limit,
    hasMore,
    nextPage: hasMore ? page + 1 : null,
    items,
  });
});
