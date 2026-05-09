import { Hono } from "hono";
import { and, asc, desc, eq, gte, ilike, inArray, lte, or, type SQL } from "drizzle-orm";
import { isAddress } from "viem";
import { db } from "../../db/client.ts";
import { collectionState, sourcePunks, tokens, transfers, merges, slopClaims } from "../../db/schema.ts";
import { buildTokenSnapshot } from "../../lib/snapshot.ts";
import { buildMergeTree } from "../lineage.ts";
import { includeParam, mergeDto, tokenListDto, transferDto } from "../dto.ts";
import { readThroughStateCache } from "../stateCache.ts";

export const tokens_route: Hono = new Hono();

async function getCollection() {
  const [row] = await db.select().from(collectionState).where(eq(collectionState.id, 1)).limit(1);
  if (!row) throw new Error("collection_state not initialized");
  return row;
}

tokens_route.get("/:id{[0-9]+}", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id < 0 || id >= 10_000) {
    return c.json({ error: `invalid token id ${id}` }, 400);
  }

  const snap = await readThroughStateCache(c, `token:${id}`, async () => {
    const [[row], collection] = await Promise.all([
      db
        .select({ token: tokens, source: sourcePunks, claim: slopClaims })
        .from(tokens)
        .leftJoin(sourcePunks, eq(sourcePunks.sourceId, tokens.sourceId))
        .leftJoin(slopClaims, eq(slopClaims.tokenId, tokens.tokenId))
        .where(eq(tokens.tokenId, id))
        .limit(1),
      getCollection(),
    ]);

    return buildTokenSnapshot(row?.token ?? null, row?.source ?? null, collection, row?.claim ?? null);
  });
  if (!snap) return c.json({ error: "token not found" }, 404);

  return c.json(snap);
});

// GET /tokens?owner=0x..&mergeLevel=&minSlop=&maxSlop=&type=&attribute=&sort=&page=&limit=
tokens_route.get("/", async (c) => {
  const sp = c.req.query();
  if (sp.ids != null) {
    const ids = parseTokenIds(sp.ids);
    if (typeof ids === "string") return c.json({ error: ids }, 400);

    const result = await readThroughStateCache(c, "tokens:bulk", async () => {
      const [collection, rows] = await Promise.all([
        getCollection(),
        db
          .select({ token: tokens, source: sourcePunks, claim: slopClaims })
          .from(tokens)
          .leftJoin(sourcePunks, eq(sourcePunks.sourceId, tokens.sourceId))
          .leftJoin(slopClaims, eq(slopClaims.tokenId, tokens.tokenId))
          .where(inArray(tokens.tokenId, ids)),
      ]);

      const byId = new Map(rows.map((row) => [row.token.tokenId, row]));
      const items = [];
      const missingIds = [];
      for (const id of ids) {
        const row = byId.get(id);
        const snap = buildTokenSnapshot(row?.token ?? null, row?.source ?? null, collection, row?.claim ?? null);
        if (snap) items.push(snap);
        else missingIds.push(id);
      }

      return { items, count: items.length, missingIds };
    });
    return c.json(result);
  }

  const includePixels = includeParam(sp.include, "pixels");
  const limit = parseIntParam(sp.limit, "limit", 50, 1, 200);
  const page = parseIntParam(sp.page, "page", 1, 1, 10_000);
  if (typeof limit === "string") return c.json({ error: limit }, 400);
  if (typeof page === "string") return c.json({ error: page }, 400);
  const offset = (page - 1) * limit;

  const conditions: SQL[] = [eq(tokens.exists, true)];

  if (sp.owner) {
    if (!isAddress(sp.owner)) return c.json({ error: "invalid owner" }, 400);
    conditions.push(eq(tokens.owner, sp.owner.toLowerCase()));
  }
  if (sp.mergeLevel != null) {
    const value = parseIntParam(sp.mergeLevel, "mergeLevel", 0, 0, 255);
    if (typeof value === "string") return c.json({ error: value }, 400);
    conditions.push(eq(tokens.mergeLevel, value));
  }
  const intFilters = [
    ["minSlop", tokens.slop, gte, 0, 576],
    ["maxSlop", tokens.slop, lte, 0, 576],
    ["minSlopLevel", tokens.slopLevel, gte, 0, 11],
    ["maxSlopLevel", tokens.slopLevel, lte, 0, 11],
    ["baseSourceId", tokens.baseSourceId, eq, 0, 9_999],
    ["sourceId", tokens.sourceId, eq, 0, 9_999],
  ] as const;
  for (const [name, column, op, min, max] of intFilters) {
    const raw = sp[name];
    if (raw == null) continue;
    const value = parseIntParam(raw, name, 0, min, max);
    if (typeof value === "string") return c.json({ error: value }, 400);
    conditions.push(op(column, value));
  }

  // Type / attribute filters require joining source_punks.
  const typeFilter = sp.type;
  const attrFilter = sp.attribute;

  let order: SQL[];
  switch (sp.sort) {
    case "slop_asc":
      order = [asc(tokens.slop), asc(tokens.tokenId)];
      break;
    case "slop_desc":
      order = [desc(tokens.slop), asc(tokens.tokenId)];
      break;
    case "slop_level_desc":
      order = [desc(tokens.slopLevel), asc(tokens.tokenId)];
      break;
    case "merge_desc":
      order = [desc(tokens.mergeLevel), asc(tokens.tokenId)];
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
    ...(includePixels
      ? {
          generatedPixels: tokens.generatedPixels,
          sourceGeneratedPixels: sourcePunks.generatedPixels,
          originalRgba: sourcePunks.originalRgba,
        }
      : {}),
  };

  const result = await readThroughStateCache(c, "tokens:list", async () => {
    const rows = await db
      .select(selectFields)
      .from(tokens)
      .leftJoin(sourcePunks, eq(sourcePunks.sourceId, tokens.sourceId))
      .leftJoin(slopClaims, eq(slopClaims.tokenId, tokens.tokenId))
      .where(
        and(
          ...conditions,
          typeFilter ? eq(sourcePunks.punkType, typeFilter) : undefined,
          attrFilter ? ilike(sourcePunks.attributesText, `%${attrFilter}%`) : undefined,
        ),
      )
      .orderBy(...order)
      .limit(limit + 1)
      .offset(offset);

    const hasMore = rows.length > limit;
    const visibleRows = hasMore ? rows.slice(0, limit) : rows;
    const items = visibleRows.map((row) => tokenListDto(row, includePixels));
    const nextPage = hasMore ? page + 1 : null;

    return { items, page, limit, hasMore, nextPage };
  });
  return c.json(result);
});

// Full merge tree for a token, including nested donors and per-step state changes.
tokens_route.get("/:id{[0-9]+}/lineage", async (c) => {
  const id = Number(c.req.param("id"));
  if (!validTokenId(id)) return c.json({ error: `invalid token id ${id}` }, 400);
  const tree = await readThroughStateCache(c, `token:${id}:lineage`, async () => {
    const includePixels = includeParam(c.req.query("include"), "pixels");
    return buildMergeTree(id, includePixels);
  });
  if (!tree) return c.json({ error: "token not found" }, 404);
  return c.json(tree);
});

// Per-token transfer + merge history.
tokens_route.get("/:id{[0-9]+}/history", async (c) => {
  const id = Number(c.req.param("id"));
  if (!validTokenId(id)) return c.json({ error: `invalid token id ${id}` }, 400);
  const result = await readThroughStateCache(c, `token:${id}:history`, async () => {
    const [transfersRows, mergeRows] = await Promise.all([
      db.select().from(transfers).where(eq(transfers.tokenId, id)).orderBy(asc(transfers.blockNumber)),
      db
        .select()
        .from(merges)
        .where(or(eq(merges.survivorTokenId, id), eq(merges.burnedTokenId, id)))
        .orderBy(asc(merges.blockNumber), asc(merges.logIndex)),
    ]);
    return { tokenId: id, transfers: transfersRows.map(transferDto), merges: mergeRows.map(mergeDto) };
  });
  return c.json(result);
});

export { tokens_route as tokens };

function validTokenId(id: number): boolean {
  return Number.isInteger(id) && id >= 0 && id < 10_000;
}

function parseTokenIds(raw: string): number[] | string {
  const parts = raw.split(",");
  if (parts.length === 0 || parts.some((part) => part.trim() === "")) {
    return "ids must be a comma-separated list of token ids";
  }
  if (parts.length > 200) return "ids supports up to 200 token ids";

  const seen = new Set<number>();
  const ids: number[] = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!/^\d+$/.test(trimmed)) return `invalid token id ${trimmed}`;
    const id = Number(trimmed);
    if (!validTokenId(id)) return `invalid token id ${trimmed}`;
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }

  return ids;
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
  if (!Number.isInteger(value) || value < min || value > max) {
    return `invalid ${name}`;
  }
  return value;
}
