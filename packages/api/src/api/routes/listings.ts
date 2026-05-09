import { Hono } from "hono";
import { eq, inArray } from "drizzle-orm";
import { env } from "../../env.ts";
import { db } from "../../db/client.ts";
import { collectionState, sourcePunks, tokens, slopClaims } from "../../db/schema.ts";
import { buildTokenSnapshot, type TokenSnapshot } from "../../lib/snapshot.ts";
import { CACHE, setCache, setNoStore } from "../cache.ts";
import { includeParam } from "../dto.ts";

type OpenSeaListing = {
  protocol_address: string;
  order_hash: string;
  price?: { current?: { value: string; decimals: number; currency: string } };
  protocol_data?: {
    parameters?: {
      offer?: Array<{ token: string; identifierOrCriteria: string }>;
    };
  };
};

type NormalizedListing = {
  tokenId: string;
  priceWei: string | null;
  priceEth: number | null;
  currency: string | null;
  orderHash: string;
};

const OS_CHAIN: Record<number, string> = {
  1: "ethereum",
};

export const listings = new Hono();

listings.get("/", async (c) => {
  const sp = c.req.query();
  const chainId = parseChainId(sp.chain);
  if (typeof chainId === "string") return c.json({ error: chainId }, 400);

  const slug = sp.slug?.trim() || env.OPENSEA_SLUG;
  if (!slug) return c.json({ error: "OpenSea slug not set" }, 400);

  const apiKey = env.OPENSEA_API_KEY;
  if (!apiKey) {
    setNoStore(c);
    return c.json({
      chainId,
      enabled: false,
      reason: "OPENSEA_API_KEY not configured",
      listings: [] as NormalizedListing[],
    });
  }

  const limit = parseIntParam(sp.limit, "limit", 50, 1, 100);
  if (typeof limit === "string") return c.json({ error: limit }, 400);

  const url = new URL(`https://api.opensea.io/api/v2/listings/collection/${slug}/all`);
  url.searchParams.set("limit", String(limit));
  const cursor = sp.cursor ?? sp.next;
  if (cursor) url.searchParams.set("next", cursor);

  try {
    const res = await fetchWithTimeout(url, apiKey);
    if (!res.ok) {
      setNoStore(c);
      return c.json({ chainId, enabled: true, slug, chain: OS_CHAIN[chainId], error: `opensea ${res.status}`, listings: [] });
    }

    const data = (await res.json()) as { listings?: OpenSeaListing[]; next?: string | null };
    const normalized = normalizeListings(data.listings ?? []);
    const response: {
      chainId: number;
      enabled: true;
      slug: string;
      chain: string | undefined;
      next: string | null;
      listings: NormalizedListing[];
      tokens?: Record<string, TokenSnapshot>;
    } = {
      chainId,
      enabled: true,
      slug,
      chain: OS_CHAIN[chainId],
      next: data.next ?? null,
      listings: normalized,
    };

    if (includeParam(sp.include, "tokens") || includeParam(sp.include, "snapshots")) {
      response.tokens = await snapshotsByTokenId(normalized.map((listing) => listing.tokenId));
    }

    setCache(c, CACHE.listings);
    return c.json(response);
  } catch (err) {
    setNoStore(c);
    return c.json(
      {
        chainId,
        enabled: true,
        slug,
        chain: OS_CHAIN[chainId],
        error: err instanceof Error ? err.message : "fetch failed",
        listings: [] as NormalizedListing[],
      },
      200,
    );
  }
});

function normalizeListings(listings: OpenSeaListing[]): NormalizedListing[] {
  const normalized = listings
    .map((listing) => {
      const offer = listing.protocol_data?.parameters?.offer?.[0];
      if (!offer) return null;
      const tokenId = normalizeTokenId(offer.identifierOrCriteria);
      if (tokenId == null) return null;

      const priceWei = listing.price?.current?.value ?? null;
      const decimals = listing.price?.current?.decimals ?? 18;
      const priceEth = priceWei ? Number(BigInt(priceWei)) / 10 ** decimals : null;

      return {
        tokenId,
        priceWei,
        priceEth,
        currency: listing.price?.current?.currency ?? null,
        orderHash: listing.order_hash,
      };
    })
    .filter((listing): listing is NormalizedListing => Boolean(listing));

  const cheapest = new Map<string, NormalizedListing>();
  for (const listing of normalized) {
    const current = cheapest.get(listing.tokenId);
    if (!current || isCheaper(listing, current)) cheapest.set(listing.tokenId, listing);
  }

  return Array.from(cheapest.values()).sort((a, b) => (a.priceEth ?? Infinity) - (b.priceEth ?? Infinity));
}

async function snapshotsByTokenId(tokenIds: string[]): Promise<Record<string, TokenSnapshot>> {
  const ids = tokenIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id >= 0 && id < 10_000);
  if (ids.length === 0) return {};

  const [[collection], rows] = await Promise.all([
    db.select().from(collectionState).where(eq(collectionState.id, 1)).limit(1),
    db
      .select({ token: tokens, source: sourcePunks, claim: slopClaims })
      .from(tokens)
      .leftJoin(sourcePunks, eq(sourcePunks.sourceId, tokens.sourceId))
      .leftJoin(slopClaims, eq(slopClaims.tokenId, tokens.tokenId))
      .where(inArray(tokens.tokenId, ids)),
  ]);
  if (!collection) return {};

  const snapshots: Record<string, TokenSnapshot> = {};
  for (const row of rows) {
    const snapshot = buildTokenSnapshot(row.token, row.source, collection, row.claim);
    if (snapshot) snapshots[snapshot.tokenId] = snapshot;
  }
  return snapshots;
}

async function fetchWithTimeout(url: URL, apiKey: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    return await fetch(url, {
      headers: { "x-api-key": apiKey, accept: "application/json" },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeTokenId(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const id = BigInt(raw);
    if (id < 0n || id >= 10_000n) return null;
    return id.toString();
  } catch {
    return null;
  }
}

function isCheaper(a: NormalizedListing, b: NormalizedListing): boolean {
  if (a.priceEth == null) return false;
  if (b.priceEth == null) return true;
  return a.priceEth < b.priceEth;
}

function parseChainId(raw: string | undefined): number | string {
  if (raw == null || raw === "") return 1;
  const chainId = Number(raw);
  if (chainId !== 1) return "unsupported chain";
  return chainId;
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
