import { Hono } from "hono";
import { and, asc, eq, isNotNull, sql, type SQL } from "drizzle-orm";
import { getAddress, type Address } from "viem";
import { db } from "../../db/client.ts";
import { tokens } from "../../db/schema.ts";
import { readThroughStateCache } from "../stateCache.ts";

export const holders = new Hono();

const SORTS = new Set([
  "count_desc",
  "max_merge_desc",
  "merged_count_desc",
  "avg_slop_desc",
  "max_slop_desc",
  "avg_slop_level_desc",
  "max_slop_level_desc",
]);

holders.get("/", async (c) => {
  const sp = c.req.query();
  const limit = parseIntParam(sp.limit, "limit", 50, 1, 200);
  const page = parseIntParam(sp.page, "page", 1, 1, 10_000);
  if (typeof limit === "string") return c.json({ error: limit }, 400);
  if (typeof page === "string") return c.json({ error: page }, 400);

  const sort = sp.sort || "count_desc";
  if (!SORTS.has(sort)) return c.json({ error: "invalid sort" }, 400);

  const result = await readThroughStateCache(c, "holders", async () => {
    const rows = await db
      .select({
        owner: tokens.owner,
        count: sql<number>`count(*)::int`,
        mergedCount: sql<number>`count(*) filter (where ${tokens.mergeLevel} > 0)::int`,
        avgSlop: sql<number | null>`avg(${tokens.slop})::float`,
        maxSlop: sql<number | null>`max(${tokens.slop})::int`,
        avgSlopLevel: sql<number | null>`avg(${tokens.slopLevel})::float`,
        maxSlopLevel: sql<number | null>`max(${tokens.slopLevel})::int`,
        maxMergeLevel: sql<number>`max(${tokens.mergeLevel})::int`,
      })
      .from(tokens)
      .where(and(eq(tokens.exists, true), isNotNull(tokens.owner)))
      .groupBy(tokens.owner)
      .orderBy(...holderOrder(sort))
      .limit(limit + 1)
      .offset((page - 1) * limit);

    const hasMore = rows.length > limit;
    const visibleRows = hasMore ? rows.slice(0, limit) : rows;

    return {
      chainId: 1,
      items: visibleRows.map((row) => ({
        owner: formatOwner(row.owner),
        count: row.count,
        mergedCount: row.mergedCount,
        avgSlop: row.avgSlop,
        maxSlop: row.maxSlop,
        avgSlopLevel: row.avgSlopLevel,
        maxSlopLevel: row.maxSlopLevel,
        maxMergeLevel: row.maxMergeLevel,
      })),
      page,
      limit,
      sort,
      hasMore,
      nextPage: hasMore ? page + 1 : null,
    };
  });
  return c.json(result);
});

function holderOrder(sort: string): SQL[] {
  switch (sort) {
    case "max_merge_desc":
      return [sql`max(${tokens.mergeLevel}) desc`, sql`count(*) desc`, asc(tokens.owner)];
    case "merged_count_desc":
      return [sql`count(*) filter (where ${tokens.mergeLevel} > 0) desc`, sql`count(*) desc`, asc(tokens.owner)];
    case "avg_slop_desc":
      return [sql`avg(${tokens.slop}) desc nulls last`, sql`count(*) desc`, asc(tokens.owner)];
    case "max_slop_desc":
      return [sql`max(${tokens.slop}) desc nulls last`, sql`count(*) desc`, asc(tokens.owner)];
    case "avg_slop_level_desc":
      return [sql`avg(${tokens.slopLevel}) desc nulls last`, sql`count(*) desc`, asc(tokens.owner)];
    case "max_slop_level_desc":
      return [sql`max(${tokens.slopLevel}) desc nulls last`, sql`count(*) desc`, asc(tokens.owner)];
    default:
      return [sql`count(*) desc`, asc(tokens.owner)];
  }
}

function formatOwner(owner: string | null): Address | null {
  if (!owner) return null;
  try {
    return getAddress(owner);
  } catch {
    return owner as Address;
  }
}

function parseIntParam(
  raw: string | undefined,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number | string {
  if (raw == null || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) return `invalid ${name}`;
  return value;
}
