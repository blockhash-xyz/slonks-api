import { Hono, type Context } from "hono";
import { and, asc, eq, isNotNull, sql, type SQL } from "drizzle-orm";
import { getAddress, isAddress, type Address } from "viem";
import {
  CHAIN_ID,
  INDEXED_NFT_COLLECTIONS,
  indexedNftCollectionBySlug,
  type IndexedNftCollection,
  type IndexedNftCollectionSlug,
} from "../../chain/contracts.ts";
import { db } from "../../db/client.ts";
import { indexedNftCollectionState, indexedNftTokens } from "../../db/schema.ts";
import { INDEXED_NFT_CACHE_SCOPE, readThroughStateCache } from "../stateCache.ts";

export const indexedNfts = new Hono();
export const slopPacks = collectionAlias("slop-packs");
export const sloplings = collectionAlias("sloplings");

indexedNfts.get("/", async (c) => {
  const result = await readThroughStateCache(
    c,
    "indexed-nft-collections",
    async () => {
      const [states, counts] = await Promise.all([
        db.select().from(indexedNftCollectionState),
        db
          .select({
            collection: indexedNftTokens.collection,
            activeCount: sql<number>`count(*)::int`,
          })
          .from(indexedNftTokens)
          .where(eq(indexedNftTokens.exists, true))
          .groupBy(indexedNftTokens.collection),
      ]);

      const stateByCollection = new Map(states.map((row) => [row.collection, row]));
      const countByCollection = new Map(counts.map((row) => [row.collection, row.activeCount]));

      return {
        chainId: CHAIN_ID,
        collections: INDEXED_NFT_COLLECTIONS.map((collection) => ({
          ...collectionDto(collection, stateByCollection.get(collection.slug) ?? null),
          activeCount: countByCollection.get(collection.slug) ?? 0,
        })),
      };
    },
    { scope: INDEXED_NFT_CACHE_SCOPE },
  );
  return c.json(result);
});

indexedNfts.get("/:collection/tokens", async (c) => {
  return listCollectionTokens(c, c.req.param("collection"));
});

indexedNfts.get("/:collection/holders", async (c) => {
  return listCollectionHolders(c, c.req.param("collection"));
});

indexedNfts.get("/:collection/tokens/:id", async (c) => {
  return getCollectionToken(c, c.req.param("collection"), c.req.param("id"));
});

function collectionAlias(collectionSlug: IndexedNftCollectionSlug): Hono {
  const app = new Hono();

  app.get("/", async (c) => listCollectionTokens(c, collectionSlug));
  app.get("/tokens", async (c) => listCollectionTokens(c, collectionSlug));
  app.get("/holders", async (c) => listCollectionHolders(c, collectionSlug));
  app.get("/tokens/:id", async (c) => getCollectionToken(c, collectionSlug, c.req.param("id")));
  app.get("/:id", async (c) => getCollectionToken(c, collectionSlug, c.req.param("id")));

  return app;
}

type IndexedNftStateRow = typeof indexedNftCollectionState.$inferSelect | null;

async function listCollectionTokens(c: Context, slug: string) {
  const collection = indexedNftCollectionBySlug(slug);
  if (!collection) return c.json({ error: "unknown collection" }, 404);

  const sp = c.req.query();
  const limit = parseIntParam(sp.limit, "limit", 50, 1, 200);
  const page = parseIntParam(sp.page, "page", 1, 1, 10_000);
  if (typeof limit === "string") return c.json({ error: limit }, 400);
  if (typeof page === "string") return c.json({ error: page }, 400);

  let ownerLower: string | null = null;
  if (sp.owner) {
    if (!isAddress(sp.owner)) return c.json({ error: "invalid owner" }, 400);
    ownerLower = sp.owner.toLowerCase();
  }

  const result = await readThroughStateCache(
    c,
    `indexed-nft:${collection.slug}:tokens`,
    async () => {
      const where = collectionTokenWhere(collection.slug, ownerLower);
      const [state, [countRow], rows] = await Promise.all([
        readCollectionState(collection.slug),
        db.select({ total: sql<number>`count(*)::int` }).from(indexedNftTokens).where(where),
        db
          .select()
          .from(indexedNftTokens)
          .where(where)
          .orderBy(asc(indexedNftTokens.tokenId))
          .limit(limit + 1)
          .offset((page - 1) * limit),
      ]);

      const hasMore = rows.length > limit;
      const visibleRows = hasMore ? rows.slice(0, limit) : rows;

      return {
        chainId: CHAIN_ID,
        collection: collectionDto(collection, state),
        owner: ownerLower ? formatAddress(ownerLower) : undefined,
        count: countRow?.total ?? 0,
        page,
        limit,
        hasMore,
        nextPage: hasMore ? page + 1 : null,
        items: visibleRows.map(tokenDto),
      };
    },
    { scope: INDEXED_NFT_CACHE_SCOPE },
  );
  return c.json(result);
}

async function listCollectionHolders(
  c: Context,
  slug: string,
) {
  const collection = indexedNftCollectionBySlug(slug);
  if (!collection) return c.json({ error: "unknown collection" }, 404);

  const sp = c.req.query();
  const limit = parseIntParam(sp.limit, "limit", 50, 1, 200);
  const page = parseIntParam(sp.page, "page", 1, 1, 10_000);
  if (typeof limit === "string") return c.json({ error: limit }, 400);
  if (typeof page === "string") return c.json({ error: page }, 400);

  const result = await readThroughStateCache(
    c,
    `indexed-nft:${collection.slug}:holders`,
    async () => {
      const [state, rows] = await Promise.all([
        readCollectionState(collection.slug),
        db
          .select({
            owner: indexedNftTokens.owner,
            count: sql<number>`count(*)::int`,
          })
          .from(indexedNftTokens)
          .where(
            and(
              eq(indexedNftTokens.collection, collection.slug),
              eq(indexedNftTokens.exists, true),
              isNotNull(indexedNftTokens.owner),
            ),
          )
          .groupBy(indexedNftTokens.owner)
          .orderBy(sql`count(*) desc`, asc(indexedNftTokens.owner))
          .limit(limit + 1)
          .offset((page - 1) * limit),
      ]);

      const hasMore = rows.length > limit;
      const visibleRows = hasMore ? rows.slice(0, limit) : rows;

      return {
        chainId: CHAIN_ID,
        collection: collectionDto(collection, state),
        page,
        limit,
        hasMore,
        nextPage: hasMore ? page + 1 : null,
        items: visibleRows.map((row) => ({
          owner: formatAddress(row.owner),
          count: row.count,
        })),
      };
    },
    { scope: INDEXED_NFT_CACHE_SCOPE },
  );
  return c.json(result);
}

async function getCollectionToken(
  c: Context,
  slug: string,
  rawId: string,
) {
  const collection = indexedNftCollectionBySlug(slug);
  if (!collection) return c.json({ error: "unknown collection" }, 404);

  const tokenId = parseTokenIdParam(rawId);
  if (typeof tokenId === "string") return c.json({ error: tokenId }, 400);

  const result = await readThroughStateCache(
    c,
    `indexed-nft:${collection.slug}:${tokenId}`,
    async () => {
      const [state, row] = await Promise.all([
        readCollectionState(collection.slug),
        db
          .select()
          .from(indexedNftTokens)
          .where(and(eq(indexedNftTokens.collection, collection.slug), eq(indexedNftTokens.tokenId, tokenId)))
          .limit(1)
          .then((rows) => rows[0] ?? null),
      ]);

      if (!row) return null;
      return {
        chainId: CHAIN_ID,
        collection: collectionDto(collection, state),
        token: tokenDto(row),
      };
    },
    { scope: INDEXED_NFT_CACHE_SCOPE },
  );
  if (!result) return c.json({ error: "token not found" }, 404);
  return c.json(result);
}

function collectionTokenWhere(collection: IndexedNftCollectionSlug, ownerLower: string | null): SQL {
  const filters: SQL[] = [eq(indexedNftTokens.collection, collection), eq(indexedNftTokens.exists, true)];
  if (ownerLower) filters.push(eq(indexedNftTokens.owner, ownerLower));
  const where = and(...filters);
  if (!where) throw new Error("missing collection filter");
  return where;
}

async function readCollectionState(collection: IndexedNftCollectionSlug): Promise<IndexedNftStateRow> {
  const [state] = await db
    .select()
    .from(indexedNftCollectionState)
    .where(eq(indexedNftCollectionState.collection, collection))
    .limit(1);
  return state ?? null;
}

function collectionDto(collection: IndexedNftCollection, state: IndexedNftStateRow) {
  return {
    slug: collection.slug,
    name: collection.name,
    symbol: collection.symbol,
    contract: getAddress(collection.address),
    startBlock: Number(collection.startBlock),
    lastIndexedBlock: state?.lastIndexedBlock == null ? 0 : Number(state.lastIndexedBlock),
  };
}

function tokenDto(row: typeof indexedNftTokens.$inferSelect) {
  return {
    collection: row.collection,
    tokenId: row.tokenId,
    status: row.exists ? "active" : "burned",
    exists: row.exists,
    owner: formatAddress(row.owner),
    mintedAtBlock: row.mintedAtBlock == null ? null : Number(row.mintedAtBlock),
    lastEventBlock: row.lastEventBlock == null ? null : Number(row.lastEventBlock),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function formatAddress(address: string | null): Address | null {
  if (!address) return null;
  try {
    return getAddress(address);
  } catch {
    return address as Address;
  }
}

function parseTokenIdParam(raw: string): number | string {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) return "invalid token id";
  return value;
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
