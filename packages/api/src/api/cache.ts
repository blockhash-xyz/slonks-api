import type { Context, MiddlewareHandler } from "hono";
import { etag } from "hono/etag";

type CachePolicy = {
  sMaxage: number;
  staleWhileRevalidate: number;
  staleIfError?: number;
};

type CacheEntry = {
  body: ArrayBuffer;
  headers: [string, string][];
  status: number;
  statusText: string;
  storedAt: number;
  expiresAt: number;
  size: number;
};

type ResponseCacheOptions = {
  maxEntries?: number;
  maxBytes?: number;
  maxResponseBytes?: number;
  now?: () => number;
};

const DEFAULT_MAX_ENTRIES = 500;
const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_RESPONSE_BYTES = 512 * 1024;

export const CACHE = {
  collectionStatus: { sMaxage: 15, staleWhileRevalidate: 60, staleIfError: 300 },
  collectionStats: { sMaxage: 60, staleWhileRevalidate: 300, staleIfError: 600 },
  tokenSnapshot: { sMaxage: 60, staleWhileRevalidate: 300, staleIfError: 600 },
  tokenImage: { sMaxage: 3600, staleWhileRevalidate: 86_400, staleIfError: 86_400 },
  tokenList: { sMaxage: 30, staleWhileRevalidate: 120, staleIfError: 300 },
  owner: { sMaxage: 30, staleWhileRevalidate: 120, staleIfError: 300 },
  activity: { sMaxage: 5, staleWhileRevalidate: 30, staleIfError: 120 },
  pendingClaims: { sMaxage: 5, staleWhileRevalidate: 30, staleIfError: 120 },
  listings: { sMaxage: 20, staleWhileRevalidate: 60, staleIfError: 120 },
  preview: { sMaxage: 30, staleWhileRevalidate: 120, staleIfError: 300 },
} as const satisfies Record<string, CachePolicy>;

export function setCache(c: Context, policy: CachePolicy): void {
  const staleIfError = policy.staleIfError ?? policy.staleWhileRevalidate;
  c.header(
    "Cache-Control",
    `public, max-age=0, s-maxage=${policy.sMaxage}, stale-while-revalidate=${policy.staleWhileRevalidate}, stale-if-error=${staleIfError}`,
  );
  c.header(
    "CDN-Cache-Control",
    `public, max-age=${policy.sMaxage}, stale-while-revalidate=${policy.staleWhileRevalidate}, stale-if-error=${staleIfError}`,
  );
  appendVary(c, "Origin");
}

export function setNoStore(c: Context): void {
  c.header("Cache-Control", "no-store");
  c.header("CDN-Cache-Control", "no-store");
}

export function responseCache(options: ResponseCacheOptions = {}): MiddlewareHandler {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const now = options.now ?? Date.now;
  const entries = new Map<string, CacheEntry>();
  let totalBytes = 0;

  function deleteEntry(key: string): void {
    const existing = entries.get(key);
    if (!existing) return;
    totalBytes -= existing.size;
    entries.delete(key);
  }

  function writeEntry(key: string, entry: CacheEntry): void {
    deleteEntry(key);
    entries.set(key, entry);
    totalBytes += entry.size;

    for (const oldKey of entries.keys()) {
      if (entries.size <= maxEntries && totalBytes <= maxBytes) break;
      deleteEntry(oldKey);
    }
  }

  return async (c, next) => {
    if (c.req.method !== "GET") {
      await next();
      return;
    }

    if (!isMicrocacheCandidate(c)) {
      await next();
      guardUncacheableResponse(c.res);
      c.res.headers.set("X-Slonks-Cache", "BYPASS");
      return;
    }

    const key = c.req.url;
    const cached = entries.get(key);
    const currentTime = now();
    if (cached && cached.expiresAt > currentTime) {
      entries.delete(key);
      entries.set(key, cached);
      return cachedResponse(c, cached, currentTime);
    }
    if (cached) deleteEntry(key);

    await next();

    const ttl = sMaxage(c.res.headers.get("Cache-Control"));
    if (!isCacheable(c.res, ttl)) {
      guardUncacheableResponse(c.res);
      c.res.headers.set("X-Slonks-Cache", "BYPASS");
      return;
    }

    const body = await c.res.clone().arrayBuffer();
    if (body.byteLength > maxResponseBytes) {
      c.res.headers.set("X-Slonks-Cache", "BYPASS");
      return;
    }

    writeEntry(key, {
      body,
      headers: [...c.res.headers.entries()],
      status: c.res.status,
      statusText: c.res.statusText,
      storedAt: currentTime,
      expiresAt: currentTime + ttl * 1_000,
      size: body.byteLength,
    });
    c.res.headers.set("X-Slonks-Cache", "MISS");
  };
}

export function conditionalEtag(): MiddlewareHandler {
  const middleware = etag();
  return async (c, next) => {
    if (c.req.method !== "GET" || !isMicrocacheCandidate(c)) {
      await next();
      return;
    }
    return middleware(c, next);
  };
}

function cachedResponse(c: Context, entry: CacheEntry, now: number): Response {
  const headers = new Headers(entry.headers);
  headers.set("Age", String(Math.max(0, Math.floor((now - entry.storedAt) / 1_000))));
  headers.set("X-Slonks-Cache", "HIT");

  const etag = headers.get("ETag");
  if (etag && etagMatches(etag, c.req.header("If-None-Match"))) {
    return new Response(null, { status: 304, headers: retainedHeaders(headers) });
  }

  return new Response(entry.body.slice(0), {
    status: entry.status,
    statusText: entry.statusText,
    headers,
  });
}

function isCacheable(res: Response, ttl: number): boolean {
  if (res.status !== 200 || ttl <= 0) return false;
  if (res.headers.has("Set-Cookie")) return false;

  const cacheControl = res.headers.get("Cache-Control")?.toLowerCase() ?? "";
  return cacheControl.includes("public") && !cacheControl.includes("no-store") && !cacheControl.includes("private");
}

function guardUncacheableResponse(res: Response): void {
  if (res.headers.get("Cache-Control") === "no-store") return;
  if (res.status >= 400 || res.headers.has("Set-Cookie") || !res.headers.has("Cache-Control")) {
    res.headers.set("Cache-Control", "no-store");
    res.headers.set("CDN-Cache-Control", "no-store");
  }
}

function isMicrocacheCandidate(c: Context): boolean {
  const url = new URL(c.req.url);
  const path = url.pathname;

  if (path === "/collection/status" || path === "/collection/distributions" || path === "/holders") {
    return true;
  }

  if (/^\/tokens\/\d+$/.test(path)) return true;
  if (/^\/png\/\d+$/.test(path)) return true;
  if (/^\/owners\/[^/]+\/summary$/.test(path)) return true;

  if (path === "/void/pending-claims") {
    if (includeParam(url.searchParams.get("include"), "pixels")) return false;
    return true;
  }

  if (path === "/tokens") {
    if (url.searchParams.has("ids")) return false;
    if (includeParam(url.searchParams.get("include"), "pixels")) return false;
    return true;
  }

  return false;
}

function sMaxage(header: string | null): number {
  if (!header) return 0;
  const match = /(?:^|,)\s*s-maxage=(\d+)\s*(?:,|$)/i.exec(header);
  return match ? Number(match[1]) : 0;
}

function includeParam(raw: string | null, value: string): boolean {
  if (!raw) return false;
  return raw.split(",").some((part) => part.trim().toLowerCase() === value);
}

function appendVary(c: Context, value: string): void {
  const existing = c.res.headers.get("Vary");
  const values = new Set(
    (existing ? existing.split(",") : [])
      .map((part) => part.trim())
      .filter(Boolean),
  );
  values.add(value);
  c.header("Vary", [...values].join(", "));
}

function etagMatches(etag: string, ifNoneMatch: string | undefined): boolean {
  if (!ifNoneMatch) return false;
  const normalized = stripWeak(etag);
  return ifNoneMatch.split(",").some((candidate) => stripWeak(candidate.trim()) === normalized);
}

function stripWeak(etag: string): string {
  return etag.replace(/^W\//, "");
}

function retainedHeaders(headers: Headers): Headers {
  const retained = new Headers();
  for (const key of ["Cache-Control", "CDN-Cache-Control", "ETag", "Vary", "Age", "X-Slonks-Cache"]) {
    const value = headers.get(key);
    if (value) retained.set(key, value);
  }
  return retained;
}
