import { Hono } from "hono";
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
