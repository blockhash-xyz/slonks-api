import { afterEach, describe, expect, test } from "bun:test";
import {
  getJson,
  logStatus,
  normalizeApiUrl,
  parseNonNegativeInt,
  parseNonNegativeNumber,
  parsePositiveInt,
  parseRatio,
  requireValue,
  sleep,
} from "./common.ts";

const originalFetch = globalThis.fetch;
const originalLog = console.log;
const originalError = console.error;

afterEach(() => {
  globalThis.fetch = originalFetch;
  console.log = originalLog;
  console.error = originalError;
});

describe("CLI common helpers", () => {
  test("normalizes API URLs and required values", () => {
    expect(normalizeApiUrl("https://api.slonks.xyz///")).toBe("https://api.slonks.xyz");
    expect(requireValue("--owner", "0xabc")).toBe("0xabc");
    expect(() => requireValue("--owner", undefined)).toThrow("--owner requires a value");
    expect(() => requireValue("--owner", "--json")).toThrow("--owner requires a value");
  });

  test("parses numeric options", () => {
    expect(parsePositiveInt("1", "--top")).toBe(1);
    expect(parseNonNegativeInt("0", "--from")).toBe(0);
    expect(parseNonNegativeNumber("0.25", "--budget")).toBe(0.25);
    expect(parseRatio("1", "--diversity")).toBe(1);
    expect(() => parsePositiveInt("0", "--top")).toThrow("positive integer");
    expect(() => parseNonNegativeInt("-1", "--from")).toThrow("non-negative integer");
    expect(() => parseNonNegativeNumber("NaN", "--budget")).toThrow("non-negative number");
    expect(() => parseRatio("2", "--diversity")).toThrow("between 0 and 1");
  });

  test("fetches JSON and includes response text in failures", async () => {
    globalThis.fetch = Object.assign(
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      originalFetch,
    ) as typeof fetch;
    await expect(getJson<{ ok: boolean }>("https://example.test")).resolves.toEqual({ ok: true });

    globalThis.fetch = Object.assign(async () => new Response("nope", { status: 418, statusText: "teapot" }), originalFetch) as
      typeof fetch;
    await expect(getJson("https://example.test/bad")).rejects.toThrow("418 teapot: nope");

    globalThis.fetch = Object.assign(
      async () => ({ ok: false, status: 500, statusText: "bad", text: async () => Promise.reject(new Error("boom")) }),
      originalFetch,
    ) as typeof fetch;
    await expect(getJson("https://example.test/no-body")).rejects.toThrow("500 bad");
  });

  test("logs status to stdout or stderr depending on JSON mode", () => {
    const logs: string[] = [];
    const errors: string[] = [];
    console.log = (message?: unknown) => logs.push(String(message));
    console.error = (message?: unknown) => errors.push(String(message));

    logStatus(false, "hello");
    logStatus(true, "json hello");

    expect(logs).toEqual(["hello"]);
    expect(errors).toEqual(["json hello"]);
  });

  test("sleeps for at least the current task turn", async () => {
    const started = Date.now();
    await sleep(0);
    expect(Date.now()).toBeGreaterThanOrEqual(started);
  });
});
