import { Hono } from "hono";
import { sql, eq } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { collectionState, tokens } from "../../db/schema.ts";
import { buildCollectionStatus } from "../../lib/snapshot.ts";

export const collection = new Hono();

async function readState() {
  const [row] = await db.select().from(collectionState).where(eq(collectionState.id, 1)).limit(1);
  return row ?? {
    id: 1,
    totalSupply: 0,
    remainingSourceIds: 10_000,
    revealed: false,
    revealBlockNumber: 0n,
    revealSeed: null,
    shuffleOffset: 0,
    sourcesPrecomputed: 0,
    lastIndexedBlock: 0n,
    updatedAt: new Date(),
  };
}

collection.get("/status", async (c) => {
  const row = await readState();
  c.header("Cache-Control", "public, s-maxage=15, stale-while-revalidate=60");
  return c.json(buildCollectionStatus(row));
});

// Per-attribute, per-type, per-slop, per-merge-level histograms — used by the
// merge lab and rarity rankings.
collection.get("/distributions", async (c) => {
  const [byMergeLevel, bySlop, byType] = await Promise.all([
    db
      .select({
        mergeLevel: tokens.mergeLevel,
        count: sql<number>`count(*)::int`,
      })
      .from(tokens)
      .where(eq(tokens.exists, true))
      .groupBy(tokens.mergeLevel)
      .orderBy(tokens.mergeLevel),
    db
      .select({
        slopLevel: tokens.slopLevel,
        count: sql<number>`count(*)::int`,
      })
      .from(tokens)
      .where(eq(tokens.exists, true))
      .groupBy(tokens.slopLevel)
      .orderBy(tokens.slopLevel),
    db.execute(sql`
      select sp.punk_type as type, count(*)::int as count
      from tokens t
      join source_punks sp on sp.source_id = t.source_id
      where t.exists = true and t.source_id is not null
      group by sp.punk_type
      order by count desc
    `),
  ]);

  c.header("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  return c.json({ byMergeLevel, bySlop, byType });
});
