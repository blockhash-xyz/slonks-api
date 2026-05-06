import { Hono } from "hono";
import { and, asc, eq, sql } from "drizzle-orm";
import { isAddress, getAddress } from "viem";
import { db } from "../../db/client.ts";
import { tokens, sourcePunks } from "../../db/schema.ts";
import { includeParam, tokenListDto } from "../dto.ts";

export const owners = new Hono();

owners.get("/:address/tokens", async (c) => {
  const address = c.req.param("address");
  if (!isAddress(address)) return c.json({ error: "invalid address" }, 400);
  const lower = address.toLowerCase();
  const includePixels = includeParam(c.req.query("include"), "pixels");

  const selectFields = {
    tokenId: tokens.tokenId,
    exists: tokens.exists,
    sourceId: tokens.sourceId,
    baseSourceId: tokens.baseSourceId,
    mergeLevel: tokens.mergeLevel,
    slop: tokens.slop,
    slopLevel: tokens.slopLevel,
    punkType: sourcePunks.punkType,
    attributesText: sourcePunks.attributesText,
    ...(includePixels
      ? {
          generatedPixels: tokens.generatedPixels,
          sourceGeneratedPixels: sourcePunks.generatedPixels,
          originalRgba: sourcePunks.originalRgba,
        }
      : {}),
  };

  const rows = await db
    .select(selectFields)
    .from(tokens)
    .leftJoin(sourcePunks, eq(sourcePunks.sourceId, tokens.sourceId))
    .where(and(eq(tokens.exists, true), eq(tokens.owner, lower)))
    .orderBy(asc(tokens.tokenId));

  c.header("Cache-Control", "public, s-maxage=30, stale-while-revalidate=120");
  return c.json({
    chainId: 1,
    owner: getAddress(address),
    count: rows.length,
    tokens: rows.map((row) => tokenListDto(row, includePixels)),
  });
});

owners.get("/:address/summary", async (c) => {
  const address = c.req.param("address");
  if (!isAddress(address)) return c.json({ error: "invalid address" }, 400);
  const lower = address.toLowerCase();

  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      avgSlop: sql<number | null>`avg(${tokens.slop})::float`,
    })
    .from(tokens)
    .where(and(eq(tokens.exists, true), eq(tokens.owner, lower)));

  const byMergeLevel = await db
    .select({
      mergeLevel: tokens.mergeLevel,
      count: sql<number>`count(*)::int`,
    })
    .from(tokens)
    .where(and(eq(tokens.exists, true), eq(tokens.owner, lower)))
    .groupBy(tokens.mergeLevel)
    .orderBy(tokens.mergeLevel);

  return c.json({
    chainId: 1,
    owner: getAddress(address),
    total: counts?.total ?? 0,
    avgSlop: counts?.avgSlop ?? null,
    byMergeLevel,
  });
});
