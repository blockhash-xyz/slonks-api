import { Hono } from "hono";
import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { getAddress, isAddress } from "viem";
import { publicClient } from "../../chain/client.ts";
import { CONTRACTS, SLOP_CLAIM_CONTRACTS, SLOP_GAME_ADDRESSES } from "../../chain/contracts.ts";
import { slopFixedPriceVoidAbi } from "../../chain/abis.ts";
import { db } from "../../db/client.ts";
import { slopClaims, sourcePunks, tokens } from "../../db/schema.ts";
import { includeParam, tokenListDto } from "../dto.ts";
import { readThroughStateCache } from "../stateCache.ts";

export const voidRoutes = new Hono();
const LOCKING_CONTRACTS = SLOP_GAME_ADDRESSES.map((address) => address.toLowerCase());
const TOKEN_UNIT = 1_000_000_000_000_000_000n;

// Slonks locked in a SLOP game with an unclaimed SLOP claim.
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
    inArray(tokens.owner, LOCKING_CONTRACTS),
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
    claimStatus: slopClaims.status,
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

  const result = await readThroughStateCache(c, "void:pending-claims", async () => {
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
      lockedOn: row.owner ? getAddress(row.owner) : null,
      lockedAtBlock: row.lockedAtBlock?.toString() ?? null,
      lockedAtLogIndex: row.lockedAtLogIndex,
      lockedAtTxHash: row.lockedAtTxHash,
      lockedAtTimestamp: row.lockedAtTimestamp?.toISOString() ?? null,
    }));

    return {
      chainId: 1,
      contracts: {
        activeGame: getAddress(CONTRACTS.slopGame),
        claimExtension: getAddress(CONTRACTS.slopClaimExtension),
        fixedPriceVoidExtension: getAddress(CONTRACTS.slopFixedPriceVoidExtension),
        claimContracts: SLOP_CLAIM_CONTRACTS.map((address) => getAddress(address)),
        previousGame: getAddress(CONTRACTS.oldSlopGame),
        falseStartGame: getAddress(CONTRACTS.falseStartSlopGame),
        legacyGames: CONTRACTS.legacySlopGames.map((address) => getAddress(address)),
      },
      owner: owner ? getAddress(owner) : undefined,
      count: countRow[0]?.count ?? 0,
      page,
      limit,
      hasMore,
      nextPage: hasMore ? page + 1 : null,
      items,
    };
  });
  return c.json(result);
});

// Slonks currently in the V2 void and buyable through the fixed-price extension.
voidRoutes.get("/inventory", async (c) => {
  const sp = c.req.query();
  const page = Number(sp.page ?? 1);
  const limit = Math.min(Math.max(Number(sp.limit ?? 50), 1), 200);
  if (!Number.isInteger(page) || page < 1) return c.json({ error: "invalid page" }, 400);
  if (!Number.isInteger(limit)) return c.json({ error: "invalid limit" }, 400);

  const includePixels = includeParam(sp.include, "pixels");
  const conditions: SQL[] = [
    eq(tokens.exists, true),
    eq(tokens.owner, CONTRACTS.slopGame.toLowerCase()),
    inArray(slopClaims.status, ["claimed", "voided"]),
  ];

  let order: SQL[];
  switch (sp.sort) {
    case "price_desc":
    case "slop_desc":
      order = [desc(tokens.slop), asc(tokens.tokenId)];
      break;
    case "price_asc":
    case "slop_asc":
      order = [asc(tokens.slop), asc(tokens.tokenId)];
      break;
    case "id_desc":
      order = [desc(tokens.tokenId)];
      break;
    default:
      order = [asc(tokens.tokenId)];
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
    claimStatus: slopClaims.status,
    claimRecipient: slopClaims.recipient,
    claimedAtBlock: slopClaims.claimedAtBlock,
    claimedAtLogIndex: slopClaims.claimedAtLogIndex,
    claimedAtTxHash: slopClaims.claimedAtTxHash,
    claimedAtTimestamp: slopClaims.claimedAtTimestamp,
    ...(includePixels
      ? {
          generatedPixels: tokens.generatedPixels,
          sourceGeneratedPixels: sourcePunks.generatedPixels,
          originalRgba: sourcePunks.originalRgba,
        }
      : {}),
  };

  const result = await readThroughStateCache(c, "void:inventory", async () => {
    const where = and(...conditions);
    const offset = (page - 1) * limit;
    const [countRow, rows] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(tokens)
        .innerJoin(slopClaims, eq(slopClaims.tokenId, tokens.tokenId))
        .where(where),
      db
        .select(selectFields)
        .from(tokens)
        .innerJoin(slopClaims, eq(slopClaims.tokenId, tokens.tokenId))
        .leftJoin(sourcePunks, eq(sourcePunks.sourceId, tokens.sourceId))
        .where(where)
        .orderBy(...order)
        .limit(limit + 1)
        .offset(offset),
    ]);

    const hasMore = rows.length > limit;
    const visibleRows = rows.slice(0, limit);
    const prices = await readVoidPrices(visibleRows.map((row) => row.tokenId));
    const buyTarget = getAddress(CONTRACTS.slopFixedPriceVoidExtension);
    const slopAllowanceTarget = getAddress(CONTRACTS.slopGame);

    const items = visibleRows.map((row) => {
      const price = prices.get(row.tokenId) ?? { initialized: false, price: null };
      return {
        ...tokenListDto(row, includePixels),
        claimStatus: row.claimStatus ?? null,
        claimRecipient: row.claimRecipient ? getAddress(row.claimRecipient) : null,
        lockedOn: row.owner ? getAddress(row.owner) : null,
        buyable: price.initialized,
        voidPriceInitialized: price.initialized,
        voidPrice: price.price == null ? null : price.price.toString(),
        voidPriceSlop: price.price == null ? null : priceToSlop(price.price),
        buyTarget,
        slopAllowanceTarget,
        buyFunction: "buyFromVoid",
        voidedAtBlock: row.claimedAtBlock?.toString() ?? null,
        voidedAtLogIndex: row.claimedAtLogIndex,
        voidedAtTxHash: row.claimedAtTxHash,
        voidedAtTimestamp: row.claimedAtTimestamp?.toISOString() ?? null,
      };
    });

    return {
      chainId: 1,
      contracts: {
        activeGame: getAddress(CONTRACTS.slopGame),
        claimExtension: getAddress(CONTRACTS.slopClaimExtension),
        fixedPriceVoidExtension: buyTarget,
        slopToken: getAddress(CONTRACTS.slopToken),
        slopAllowanceTarget,
        claimContracts: SLOP_CLAIM_CONTRACTS.map((address) => getAddress(address)),
      },
      count: countRow[0]?.count ?? 0,
      page,
      limit,
      hasMore,
      nextPage: hasMore ? page + 1 : null,
      items,
    };
  });
  return c.json(result);
});

voidRoutes.get("/tokens", (c) => {
  const url = new URL(c.req.url);
  url.pathname = url.pathname.replace(/\/tokens$/, "/inventory");
  return c.redirect(`${url.pathname}${url.search}`, 308);
});

async function readVoidPrices(tokenIds: number[]): Promise<Map<number, { initialized: boolean; price: bigint | null }>> {
  const client = publicClient();
  const entries = await Promise.all(
    tokenIds.map(async (tokenId) => {
      const args = [BigInt(tokenId)] as const;
      const [initialized, price] = await Promise.all([
        client
          .readContract({
            address: CONTRACTS.slopFixedPriceVoidExtension,
            abi: slopFixedPriceVoidAbi,
            functionName: "voidPriceInitialized",
            args,
          })
          .catch(() => false),
        client
          .readContract({
            address: CONTRACTS.slopFixedPriceVoidExtension,
            abi: slopFixedPriceVoidAbi,
            functionName: "voidPrice",
            args,
          })
          .catch(() => 0n),
      ]);
      return [tokenId, { initialized: Boolean(initialized), price: initialized ? BigInt(price) : null }] as const;
    }),
  );

  return new Map(entries);
}

function priceToSlop(price: bigint): number | string {
  if (price % TOKEN_UNIT !== 0n) return price.toString();
  const slop = price / TOKEN_UNIT;
  return slop <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(slop) : slop.toString();
}
