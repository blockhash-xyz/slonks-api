import { Hono, type Context } from "hono";
import { and, asc, desc, eq, inArray, isNotNull, sql, type SQL } from "drizzle-orm";
import { getAddress, isAddress, type Address } from "viem";
import {
  CHAIN_ID,
  INDEXED_NFT_COLLECTIONS,
  SLOPLING_FEED_INTERVAL_SECONDS,
  SLOPLING_STATE_NAMES,
  indexedNftCollectionBySlug,
  slopPackPrizeCollectionName,
  type IndexedNftCollection,
  type IndexedNftCollectionSlug,
  type SloplingCareState,
} from "../../chain/contracts.ts";
import { db } from "../../db/client.ts";
import { indexedNftAttributes, indexedNftCollectionState, indexedNftTokens } from "../../db/schema.ts";
import { INDEXED_NFT_CACHE_SCOPE, readThroughStateCache } from "../stateCache.ts";
import { parseTraitFiltersFromUrl, type TraitFilter } from "../traitFilters.ts";

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

indexedNfts.get("/:collection/traits", async (c) => {
  return listCollectionTraits(c, c.req.param("collection"));
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
  app.get("/traits", async (c) => listCollectionTraits(c, collectionSlug));
  app.get("/holders", async (c) => listCollectionHolders(c, collectionSlug));
  app.get("/tokens/:id", async (c) => getCollectionToken(c, collectionSlug, c.req.param("id")));
  app.get("/:id", async (c) => getCollectionToken(c, collectionSlug, c.req.param("id")));

  return app;
}

type IndexedNftStateRow = typeof indexedNftCollectionState.$inferSelect | null;
type IndexedNftTokenRow = typeof indexedNftTokens.$inferSelect;
type IndexedNftAttribute = { trait_type: string; value: string };
type TokenStatusFilter =
  | "active"
  | "all"
  | "burned"
  | "unopened"
  | "pending"
  | "settled"
  | "opened"
  | "delivered";
type TokenListFilters = {
  ownerLower: string | null;
  status: TokenStatusFilter;
  careState: SloplingCareState | null;
  traitFilters: TraitFilter[];
};

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
  const statusResult = parseStatusParam(sp.status, collection.slug);
  if ("error" in statusResult) return c.json({ error: statusResult.error }, 400);
  const status = statusResult.value;

  const careStateResult = parseCareStateParam(sp.careState ?? sp.state, collection.slug, sp.status);
  if ("error" in careStateResult) return c.json({ error: careStateResult.error }, 400);
  const careState = careStateResult.value;

  const traitFilters = parseTraitFiltersFromUrl(c.req.url);
  if (typeof traitFilters === "string") return c.json({ error: traitFilters }, 400);
  if (traitFilters.length > 0 && collection.slug !== "sloplings") {
    return c.json({ error: "trait filters are only supported for sloplings" }, 400);
  }

  const result = await readThroughStateCache(
    c,
    `indexed-nft:${collection.slug}:tokens`,
    async () => {
      const where = collectionTokenWhere(collection.slug, {
        ownerLower,
        status,
        careState,
        traitFilters,
      });
      const orderBy = collectionTokenOrder(sp.sort);
      const [state, [countRow], rows] = await Promise.all([
        readCollectionState(collection.slug),
        db.select({ total: sql<number>`count(*)::int` }).from(indexedNftTokens).where(where),
        db
          .select()
          .from(indexedNftTokens)
          .where(where)
          .orderBy(...orderBy)
          .limit(limit + 1)
          .offset((page - 1) * limit),
      ]);

      const hasMore = rows.length > limit;
      const visibleRows = hasMore ? rows.slice(0, limit) : rows;
      const attributes = await readAttributesForRows(collection.slug, visibleRows);
      const includeMetadata = includeParam(sp.include, "metadata");

      return {
        chainId: CHAIN_ID,
        collection: collectionDto(collection, state),
        owner: ownerLower ? formatAddress(ownerLower) : undefined,
        status,
        careState: careState ?? undefined,
        traits: traitFilters.length > 0 ? traitFilters : undefined,
        count: countRow?.total ?? 0,
        page,
        limit,
        hasMore,
        nextPage: hasMore ? page + 1 : null,
        items: visibleRows.map((row) => tokenDto(row, attributes.get(row.tokenId) ?? [], { includeMetadata })),
      };
    },
    { scope: INDEXED_NFT_CACHE_SCOPE },
  );
  return c.json(result);
}

async function listCollectionTraits(c: Context, slug: string) {
  const collection = indexedNftCollectionBySlug(slug);
  if (!collection) return c.json({ error: "unknown collection" }, 404);
  if (collection.slug !== "sloplings") return c.json({ error: "traits are only supported for sloplings" }, 400);

  const result = await readThroughStateCache(
    c,
    `indexed-nft:${collection.slug}:traits`,
    async () => {
      const [state, rows] = await Promise.all([
        readCollectionState(collection.slug),
        db
          .select({
            traitType: indexedNftAttributes.traitType,
            value: indexedNftAttributes.value,
            count: sql<number>`count(*)::int`,
          })
          .from(indexedNftAttributes)
          .where(eq(indexedNftAttributes.collection, collection.slug))
          .groupBy(indexedNftAttributes.traitType, indexedNftAttributes.value)
          .orderBy(asc(indexedNftAttributes.traitType), sql`count(*) desc`, asc(indexedNftAttributes.value)),
      ]);

      const traits = new Map<string, Array<{ value: string; count: number }>>();
      for (const row of rows) {
        const values = traits.get(row.traitType) ?? [];
        values.push({ value: row.value, count: row.count });
        traits.set(row.traitType, values);
      }

      return {
        chainId: CHAIN_ID,
        collection: collectionDto(collection, state),
        traits: [...traits.entries()].map(([traitType, values]) => ({ traitType, values })),
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
      const attributes = await readAttributesForRows(collection.slug, [row]);
      return {
        chainId: CHAIN_ID,
        collection: collectionDto(collection, state),
        token: tokenDto(row, attributes.get(row.tokenId) ?? [], { includeMetadata: includeParam(c.req.query("include"), "metadata") }),
      };
    },
    { scope: INDEXED_NFT_CACHE_SCOPE },
  );
  if (!result) return c.json({ error: "token not found" }, 404);
  return c.json(result);
}

function collectionTokenWhere(collection: IndexedNftCollectionSlug, options: TokenListFilters): SQL {
  const filters: SQL[] = [eq(indexedNftTokens.collection, collection)];
  switch (options.status) {
    case "all":
      break;
    case "burned":
      filters.push(eq(indexedNftTokens.exists, false));
      break;
    case "unopened":
      filters.push(eq(indexedNftTokens.exists, true));
      filters.push(sql`coalesce(${indexedNftTokens.packRequestStatus}, 0) = 0`);
      break;
    case "pending":
      filters.push(eq(indexedNftTokens.packRequestStatus, 1));
      break;
    case "settled":
      filters.push(eq(indexedNftTokens.packRequestStatus, 2));
      break;
    case "opened":
    case "delivered":
      filters.push(eq(indexedNftTokens.packRequestStatus, 3));
      break;
    default:
      filters.push(eq(indexedNftTokens.exists, true));
  }
  if (options.ownerLower) filters.push(eq(indexedNftTokens.owner, options.ownerLower));
  if (options.careState) filters.push(sloplingCareStateFilter(options.careState));
  for (const trait of options.traitFilters) {
    filters.push(sql`
      exists (
        select 1
        from indexed_nft_attributes a
        where a.collection = ${collection}
          and a.token_id = ${indexedNftTokens.tokenId}
          and lower(a.trait_type) = lower(${trait.traitType})
          and lower(a.value) = lower(${trait.value})
      )
    `);
  }
  const where = and(...filters);
  if (!where) throw new Error("missing collection filter");
  return where;
}

function collectionTokenOrder(rawSort: string | undefined): SQL[] {
  switch (rawSort) {
    case "id_desc":
      return [desc(indexedNftTokens.tokenId)];
    default:
      return [asc(indexedNftTokens.tokenId)];
  }
}

function sloplingCareStateFilter(state: SloplingCareState): SQL {
  switch (state) {
    case "immortal":
      return eq(indexedNftTokens.sloplingImmortal, true);
    case "alive":
      return sql`${indexedNftTokens.sloplingImmortal} = false and now() < ${indexedNftTokens.sloplingPaidThrough}`;
    case "starving":
      return sql`
        ${indexedNftTokens.sloplingImmortal} = false
        and now() >= ${indexedNftTokens.sloplingPaidThrough}
        and now() < (${indexedNftTokens.sloplingPaidThrough} + interval '30 days')
      `;
    case "dead":
      return sql`
        ${indexedNftTokens.sloplingImmortal} = false
        and now() >= (${indexedNftTokens.sloplingPaidThrough} + interval '30 days')
      `;
  }
}

async function readAttributesForRows(
  collection: IndexedNftCollectionSlug,
  rows: IndexedNftTokenRow[],
): Promise<Map<number, IndexedNftAttribute[]>> {
  const tokenIds = rows.map((row) => row.tokenId);
  if (tokenIds.length === 0) return new Map();

  const attrRows = await db
    .select()
    .from(indexedNftAttributes)
    .where(and(eq(indexedNftAttributes.collection, collection), inArray(indexedNftAttributes.tokenId, tokenIds)))
    .orderBy(asc(indexedNftAttributes.tokenId), asc(indexedNftAttributes.traitType));

  const byToken = new Map<number, IndexedNftAttribute[]>();
  for (const row of attrRows) {
    const list = byToken.get(row.tokenId) ?? [];
    list.push({ trait_type: row.traitType, value: row.value });
    byToken.set(row.tokenId, list);
  }
  return byToken;
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
    extendedLastIndexedBlock: state?.extendedLastIndexedBlock == null ? 0 : Number(state.extendedLastIndexedBlock),
  };
}

function tokenDto(
  row: IndexedNftTokenRow,
  staticAttributes: IndexedNftAttribute[] = [],
  options: { includeMetadata?: boolean } = {},
) {
  const attributes = attributesWithDynamicState(row, staticAttributes);
  const lifecycleState = packLifecycleState(row);
  const careState = sloplingCareState(row);
  return {
    collection: row.collection,
    tokenId: row.tokenId,
    status: row.exists ? "active" : "burned",
    exists: row.exists,
    owner: formatAddress(row.owner),
    tokenUri: row.tokenUri,
    name: row.name,
    image: row.image,
    attributes,
    careState,
    paidThrough: row.sloplingPaidThrough?.toISOString() ?? null,
    isImmortal: row.collection === "sloplings" ? row.sloplingImmortal : undefined,
    feedingPeriodsRequired: row.collection === "sloplings" ? sloplingFeedingPeriodsRequired(row, careState) : undefined,
    lifecycleState,
    openRequest:
      row.collection === "slop-packs"
        ? {
            status: lifecycleState,
            entropyBlock: row.packEntropyBlock?.toString() ?? null,
            position: row.packPosition?.toString() ?? null,
            chosen: row.packChosen?.toString() ?? null,
            beneficiary: formatAddress(row.packBeneficiary),
          }
        : undefined,
    openedAsset:
      row.collection === "slop-packs" && row.packOpenedNftContract
        ? {
            collection: formatAddress(row.packOpenedNftContract),
            collectionName: slopPackPrizeCollectionName(row.packOpenedNftContract),
            tokenId: row.packOpenedTokenId,
            beneficiary: formatAddress(row.packBeneficiary),
            blockNumber: row.packOpenedAtBlock?.toString() ?? null,
            logIndex: row.packOpenedAtLogIndex,
            txHash: row.packOpenedTxHash,
            timestamp: row.packOpenedAtTimestamp?.toISOString() ?? null,
          }
        : undefined,
    metadata: options.includeMetadata ? metadataDto(row, attributes) : undefined,
    mintedAtBlock: row.mintedAtBlock == null ? null : Number(row.mintedAtBlock),
    lastEventBlock: row.lastEventBlock == null ? null : Number(row.lastEventBlock),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function metadataDto(row: IndexedNftTokenRow, attributes: IndexedNftAttribute[]): Record<string, unknown> | null {
  if (!row.metadataJson) return null;
  return {
    ...row.metadataJson,
    attributes,
  };
}

function attributesWithDynamicState(
  row: IndexedNftTokenRow,
  attributes: IndexedNftAttribute[],
): IndexedNftAttribute[] {
  if (row.collection !== "sloplings") return attributes;
  const careState = sloplingCareState(row);
  if (!careState) return attributes;
  return [
    ...attributes.filter((attribute) => attribute.trait_type.toLowerCase() !== "state"),
    { trait_type: "State", value: stateLabel(careState) },
  ];
}

function sloplingCareState(row: IndexedNftTokenRow): SloplingCareState | null {
  if (row.collection !== "sloplings") return null;
  if (row.sloplingImmortal) return "immortal";
  if (!row.sloplingPaidThrough) return null;

  const now = Date.now();
  const paidThroughMs = row.sloplingPaidThrough.getTime();
  if (now < paidThroughMs) return "alive";
  if (now < paidThroughMs + SLOPLING_FEED_INTERVAL_SECONDS * 1000) return "starving";
  return "dead";
}

function sloplingFeedingPeriodsRequired(
  row: IndexedNftTokenRow,
  careState: SloplingCareState | null,
): number | null {
  if (!row.sloplingPaidThrough || !careState) return null;
  if (careState === "immortal" || careState === "dead") return 0;
  const now = Date.now();
  const paidThroughMs = row.sloplingPaidThrough.getTime();
  if (paidThroughMs > now) return 1;
  return Math.floor((now - paidThroughMs) / (SLOPLING_FEED_INTERVAL_SECONDS * 1000)) + 1;
}

function packLifecycleState(row: IndexedNftTokenRow): "unopened" | "pending" | "settled" | "delivered" | "burned" | null {
  if (row.collection !== "slop-packs") return null;
  switch (row.packRequestStatus) {
    case 1:
      return "pending";
    case 2:
      return "settled";
    case 3:
      return "delivered";
    default:
      return row.exists ? "unopened" : "burned";
  }
}

function stateLabel(state: SloplingCareState): string {
  return state.slice(0, 1).toUpperCase() + state.slice(1);
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

function parseStatusParam(
  raw: string | undefined,
  collection: IndexedNftCollectionSlug,
): { value: TokenStatusFilter } | { error: string } {
  const value = (raw ?? "active").trim().toLowerCase();
  if (value === "active" || value === "all" || value === "burned") return { value };
  if (collection === "sloplings" && isSloplingCareState(value)) return { value: "active" };
  if (
    collection === "slop-packs" &&
    (value === "unopened" ||
      value === "pending" ||
      value === "settled" ||
      value === "opened" ||
      value === "delivered")
  ) {
    return { value };
  }
  return { error: "invalid status" };
}

function parseCareStateParam(
  raw: string | undefined,
  collection: IndexedNftCollectionSlug,
  statusRaw: string | undefined,
): { value: SloplingCareState | null } | { error: string } {
  const statusAlias = statusRaw?.trim().toLowerCase();
  const value = (raw ?? (statusAlias && isSloplingCareState(statusAlias) ? statusAlias : "")).trim().toLowerCase();
  if (!value) return { value: null };
  if (collection !== "sloplings") return { error: "careState is only supported for sloplings" };
  if (!isSloplingCareState(value)) return { error: "invalid careState" };
  return { value };
}

function isSloplingCareState(value: string): value is SloplingCareState {
  return (SLOPLING_STATE_NAMES as readonly string[]).includes(value);
}

function includeParam(raw: string | undefined, value: string): boolean {
  return (raw ?? "")
    .split(",")
    .map((part) => part.trim())
    .includes(value);
}
