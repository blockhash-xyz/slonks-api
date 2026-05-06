import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { etag } from "hono/etag";
import { setCache, setNoStore, responseCache } from "./cache.ts";

describe("API cache helpers", () => {
  test("sets shared CDN-aware cache headers", async () => {
    const app = new Hono();
    app.get("/", (c) => {
      c.header("Vary", "Accept-Encoding");
      setCache(c, { sMaxage: 10, staleWhileRevalidate: 20 });
      return c.json({ ok: true });
    });

    const res = await app.request("/");
    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=0, s-maxage=10, stale-while-revalidate=20, stale-if-error=20",
    );
    expect(res.headers.get("CDN-Cache-Control")).toBe(
      "public, max-age=10, stale-while-revalidate=20, stale-if-error=20",
    );
    expect(res.headers.get("Vary")).toBe("Accept-Encoding, Origin");
  });

  test("sets no-store headers", async () => {
    const app = new Hono();
    app.get("/", (c) => {
      setNoStore(c);
      return c.json({ ok: true });
    });

    const res = await app.request("/");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("CDN-Cache-Control")).toBe("no-store");
  });

  test("microcaches cacheable GET responses and supports conditional hits", async () => {
    let now = 1_000;
    let calls = 0;
    const app = new Hono();
    app.use("*", responseCache({ now: () => now, maxEntries: 2, maxBytes: 10_000, maxResponseBytes: 1_000 }));
    app.use("*", etag());
    app.get("/cached", (c) => {
      calls++;
      setCache(c, { sMaxage: 10, staleWhileRevalidate: 20 });
      return c.json({ calls });
    });

    const first = await app.request("/cached");
    expect(first.headers.get("X-Slonks-Cache")).toBe("MISS");
    expect(await first.json()).toEqual({ calls: 1 });

    const second = await app.request("/cached");
    expect(second.headers.get("X-Slonks-Cache")).toBe("HIT");
    expect(second.headers.get("Age")).toBe("0");
    expect(await second.json()).toEqual({ calls: 1 });

    const etagValue = second.headers.get("ETag");
    expect(etagValue).toBeTruthy();
    const notModified = await app.request("/cached", { headers: { "If-None-Match": `W/${etagValue}` } });
    expect(notModified.status).toBe(304);
    expect(notModified.headers.get("X-Slonks-Cache")).toBe("HIT");

    now += 11_000;
    const expired = await app.request("/cached");
    expect(expired.headers.get("X-Slonks-Cache")).toBe("MISS");
    expect(await expired.json()).toEqual({ calls: 2 });
  });

  test("bypasses uncacheable methods and responses", async () => {
    let calls = 0;
    const app = new Hono();
    app.use("*", responseCache({ maxResponseBytes: 5 }));
    app.get("/uncached", (c) => c.json({ ok: true }));
    app.get("/no-store", (c) => {
      setNoStore(c);
      return c.json({ ok: true });
    });
    app.get("/cookie", (c) => {
      setCache(c, { sMaxage: 10, staleWhileRevalidate: 20 });
      c.header("Set-Cookie", "a=b");
      return c.json({ ok: true });
    });
    app.get("/large", (c) => {
      setCache(c, { sMaxage: 10, staleWhileRevalidate: 20 });
      return c.text("too large");
    });
    app.get("/error", (c) => {
      setCache(c, { sMaxage: 10, staleWhileRevalidate: 20 });
      return c.json({ error: "nope" }, 500);
    });
    app.post("/post", (c) => {
      calls++;
      setCache(c, { sMaxage: 10, staleWhileRevalidate: 20 });
      return c.json({ calls });
    });

    const uncached = await app.request("/uncached");
    expect(uncached.headers.get("X-Slonks-Cache")).toBe("BYPASS");
    expect(uncached.headers.get("Cache-Control")).toBe("no-store");

    for (const path of ["/no-store", "/cookie", "/large", "/error"]) {
      const res = await app.request(path);
      expect(res.headers.get("X-Slonks-Cache")).toBe("BYPASS");
    }
    expect((await app.request("/error")).headers.get("Cache-Control")).toBe("no-store");

    expect(await (await app.request("/post", { method: "POST" })).json()).toEqual({ calls: 1 });
    expect(await (await app.request("/post", { method: "POST" })).json()).toEqual({ calls: 2 });
  });

  test("evicts older entries when cache limits are reached", async () => {
    let aCalls = 0;
    let bCalls = 0;
    const app = new Hono();
    app.use("*", responseCache({ maxEntries: 1 }));
    app.get("/a", (c) => {
      aCalls++;
      setCache(c, { sMaxage: 10, staleWhileRevalidate: 20 });
      return c.json({ aCalls });
    });
    app.get("/b", (c) => {
      bCalls++;
      setCache(c, { sMaxage: 10, staleWhileRevalidate: 20 });
      return c.json({ bCalls });
    });

    expect((await app.request("/a")).headers.get("X-Slonks-Cache")).toBe("MISS");
    expect((await app.request("/b")).headers.get("X-Slonks-Cache")).toBe("MISS");
    const evicted = await app.request("/a");
    expect(evicted.headers.get("X-Slonks-Cache")).toBe("MISS");
    expect(await evicted.json()).toEqual({ aCalls: 2 });
  });
});
