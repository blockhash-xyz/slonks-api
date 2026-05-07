import { Hono } from "hono";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { env } from "../../env.ts";
import { setNoStore } from "../cache.ts";
import { generateVoidProof, ProverBusyError, ProverUnavailableError } from "../../prover/voidProof.ts";

export const voidProof = new Hono();

voidProof.post("/", async (c) => {
  setNoStore(c);
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return c.json({ error: "expected JSON body" }, 400);
  }

  const tokenId = parseTokenId(readBodyNumber(body, "tokenId", "id"), "tokenId");
  if (typeof tokenId === "string") return c.json({ error: tokenId }, 400);

  if (env.SLOP_REMOTE_PROVER_URL) return remoteVoidProof(c, tokenId);

  try {
    const proof = await generateVoidProof(tokenId);
    return c.json(proof);
  } catch (err) {
    if (err instanceof ProverBusyError) {
      c.header("Retry-After", "15");
      return c.json({ error: "prover is busy, retry shortly" }, 429);
    }
    if (err instanceof ProverUnavailableError) {
      return c.json({ error: err.message }, 503);
    }
    throw err;
  }
});

async function remoteVoidProof(c: Context, tokenId: number): Promise<Response> {
  const url = new URL("/void-proof", env.SLOP_REMOTE_PROVER_URL);
  const headers = new Headers({ "Content-Type": "application/json" });
  if (env.SLOP_PROVER_AUTH_TOKEN) headers.set("Authorization", `Bearer ${env.SLOP_PROVER_AUTH_TOKEN}`);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ tokenId }),
      signal: AbortSignal.timeout(env.SLOP_REMOTE_PROVER_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return c.json({ error: timedOut ? "remote prover timed out" : "remote prover unavailable" }, timedOut ? 504 : 503);
  }

  const text = await response.text();
  const body = parseJsonObject(text);
  if (!body) return c.json({ error: "remote prover returned invalid JSON" }, 502);

  const retryAfter = response.headers.get("Retry-After");
  if (retryAfter) c.header("Retry-After", retryAfter);
  return c.json(body, response.status as ContentfulStatusCode);
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function readBodyNumber(body: object, ...keys: string[]): unknown {
  const record = body as Record<string, unknown>;
  for (const key of keys) {
    if (record[key] != null) return record[key];
  }
  return undefined;
}

function parseTokenId(raw: unknown, name: string): number | string {
  const value = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
  if (!Number.isInteger(value) || typeof value !== "number" || value < 0 || value >= 10_000) {
    return `invalid ${name}`;
  }
  return value;
}
