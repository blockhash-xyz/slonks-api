import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { conditionalEtag, setCache, setNoStore, responseCache } from "./cache.ts";

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
    app.use("*", conditionalEtag());
    app.get("/tokens/1", (c) => {
      calls++;
      setCache(c, { sMaxage: 10, staleWhileRevalidate: 20 });
      return c.json({ calls });
    });

    const first = await app.request("/tokens/1");
    expect(first.headers.get("X-Slonks-Cache")).toBe("MISS");
    expect(await first.json()).toEqual({ calls: 1 });

    const second = await app.request("/tokens/1");
    expect(second.headers.get("X-Slonks-Cache")).toBe("HIT");
    expect(second.headers.get("Age")).toBe("0");
    expect(await second.json()).toEqual({ calls: 1 });

    const etagValue = second.headers.get("ETag");
    expect(etagValue).toBeTruthy();
    const notModified = await app.request("/tokens/1", { headers: { "If-None-Match": `W/${etagValue}` } });
    expect(notModified.status).toBe(304);
    expect(notModified.headers.get("X-Slonks-Cache")).toBe("HIT");

    now += 11_000;
    const expired = await app.request("/tokens/1");
    expect(expired.headers.get("X-Slonks-Cache")).toBe("MISS");
    expect(await expired.json()).toEqual({ calls: 2 });
  });

  test("coalesces concurrent cacheable GET responses", async () => {
    let calls = 0;
    let release: () => void = () => {};
    const blocker = new Promise<void>((resolve) => {
      release = resolve;
    });
    const app = new Hono();
    app.use("*", responseCache({ maxResponseBytes: 1_000 }));
    app.get("/tokens/1", async (c) => {
      calls++;
      await blocker;
      setCache(c, { sMaxage: 10, staleWhileRevalidate: 20 });
      return c.json({ calls });
    });

    const firstRequest = app.request("/tokens/1");
    await Promise.resolve();
    const secondRequest = app.request("/tokens/1");
    release();

    const [first, second] = await Promise.all([firstRequest, secondRequest]);
    expect(calls).toBe(1);
    expect(first.headers.get("X-Slonks-Cache")).toBe("MISS");
    expect(second.headers.get("X-Slonks-Cache")).toBe("HIT");
    expect(await first.json()).toEqual({ calls: 1 });
    expect(await second.json()).toEqual({ calls: 1 });
  });

  test("clears pending cache entries when handlers throw", async () => {
    let calls = 0;
    const app = new Hono();
    app.use("*", responseCache({ maxResponseBytes: 1_000 }));
    app.get("/tokens/1", (c) => {
      calls++;
      if (calls === 1) throw new Error("boom");
      setCache(c, { sMaxage: 10, staleWhileRevalidate: 20 });
      return c.json({ calls });
    });
    app.onError((err, c) => c.json({ error: err.message }, 500));

    expect((await app.request("/tokens/1")).status).toBe(500);
    const recovered = await app.request("/tokens/1");
    expect(recovered.headers.get("X-Slonks-Cache")).toBe("MISS");
    expect(await recovered.json()).toEqual({ calls: 2 });
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
    app.get("/tokens/3", (c) => c.json({ ok: true }));
    app.get("/tokens/4", (c) => {
      setCache(c, { sMaxage: 10, staleWhileRevalidate: 20 });
      return c.text("too large");
    });
    app.get("/tokens/5", (c) => {
      setCache(c, { sMaxage: 10, staleWhileRevalidate: 20 });
      c.header("Set-Cookie", "a=b");
      return c.json({ ok: true });
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

    const candidateWithoutCacheHeader = await app.request("/tokens/3");
    expect(candidateWithoutCacheHeader.headers.get("X-Slonks-Cache")).toBe("BYPASS");
    expect(candidateWithoutCacheHeader.headers.get("Cache-Control")).toBe("no-store");
    expect((await app.request("/tokens/4")).headers.get("X-Slonks-Cache")).toBe("BYPASS");
    expect((await app.request("/tokens/5")).headers.get("Cache-Control")).toBe("no-store");

    expect(await (await app.request("/post", { method: "POST" })).json()).toEqual({ calls: 1 });
    expect(await (await app.request("/post", { method: "POST" })).json()).toEqual({ calls: 2 });
  });

  test("bypasses bulky high-cardinality routes before hashing or storing bodies", async () => {
    const app = new Hono();
    app.use("*", responseCache());
    app.use("*", conditionalEtag());
    app.get("/listings", (c) => {
      setCache(c, { sMaxage: 10, staleWhileRevalidate: 20 });
      return c.json({ listings: [{ tokenId: "1" }] });
    });
    app.get("/tokens", (c) => {
      setCache(c, { sMaxage: 10, staleWhileRevalidate: 20 });
      return c.json({ items: [{ tokenId: "1" }] });
    });
    app.get("/owners/:address/tokens", (c) => {
      setCache(c, { sMaxage: 10, staleWhileRevalidate: 20 });
      return c.json({ tokens: [{ tokenId: "1" }] });
    });
    app.get("/collection/status", (c) => {
      setCache(c, { sMaxage: 10, staleWhileRevalidate: 20 });
      return c.json({ phase: "revealed" });
    });
    app.get("/png/1", (c) => {
      setCache(c, { sMaxage: 10, staleWhileRevalidate: 20 });
      c.header("Content-Type", "image/png");
      return c.body(new Uint8Array([1, 2, 3]));
    });
    app.get("/void/pending-claims", (c) => {
      setCache(c, { sMaxage: 10, staleWhileRevalidate: 20 });
      return c.json({ items: [] });
    });

    for (const path of [
      "/listings",
      "/tokens?ids=1,2",
      "/tokens?include=pixels",
      "/owners/0xabc/tokens",
      "/void/pending-claims?include=pixels",
    ]) {
      const res = await app.request(path);
      expect(res.headers.get("X-Slonks-Cache")).toBe("BYPASS");
      expect(res.headers.get("ETag")).toBeNull();
    }

    expect((await app.request("/collection/status")).headers.get("X-Slonks-Cache")).toBe("MISS");
    expect((await app.request("/tokens")).headers.get("X-Slonks-Cache")).toBe("MISS");
    expect((await app.request("/void/pending-claims")).headers.get("X-Slonks-Cache")).toBe("MISS");
    expect((await app.request("/void/pending-claims?recipient=0xabc&include=pixels")).headers.get("X-Slonks-Cache")).toBe(
      "MISS",
    );
    expect((await app.request("/void/pending-claims?recipient=0xabc&include=pixels")).headers.get("X-Slonks-Cache")).toBe(
      "HIT",
    );
    expect((await app.request("/png/1")).headers.get("X-Slonks-Cache")).toBe("MISS");
    expect((await app.request("/png/1")).headers.get("X-Slonks-Cache")).toBe("HIT");
  });

  test("evicts older entries when cache limits are reached", async () => {
    let aCalls = 0;
    let bCalls = 0;
    const app = new Hono();
    app.use("*", responseCache({ maxEntries: 1 }));
    app.get("/tokens/1", (c) => {
      aCalls++;
      setCache(c, { sMaxage: 10, staleWhileRevalidate: 20 });
      return c.json({ aCalls });
    });
    app.get("/tokens/2", (c) => {
      bCalls++;
      setCache(c, { sMaxage: 10, staleWhileRevalidate: 20 });
      return c.json({ bCalls });
    });

    expect((await app.request("/tokens/1")).headers.get("X-Slonks-Cache")).toBe("MISS");
    expect((await app.request("/tokens/2")).headers.get("X-Slonks-Cache")).toBe("MISS");
    const evicted = await app.request("/tokens/1");
    expect(evicted.headers.get("X-Slonks-Cache")).toBe("MISS");
    expect(await evicted.json()).toEqual({ aCalls: 2 });
  });
});
