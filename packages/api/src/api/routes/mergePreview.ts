import { Hono } from "hono";
import { CACHE, setCache } from "../cache.ts";
import { computeMergePreviews } from "../mergePreviewCore.ts";

export const mergePreview = new Hono();

mergePreview.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return c.json({ error: "expected JSON body" }, 400);
  }

  const survivorTokenId = parseTokenId(readBodyNumber(body, "survivorTokenId", "tokenId"), "survivorTokenId");
  if (typeof survivorTokenId === "string") return c.json({ error: survivorTokenId }, 400);

  const donorTokenId = parseTokenId(readBodyNumber(body, "donorTokenId", "burnedTokenId", "burnTokenId"), "donorTokenId");
  if (typeof donorTokenId === "string") return c.json({ error: donorTokenId }, 400);

  const { items, errors } = await computeMergePreviews([{ survivorTokenId, donorTokenId }]);
  if (errors[0]) {
    const { status, ...errorBody } = errors[0];
    return c.json(errorBody, status as 400 | 404 | 409);
  }

  setCache(c, CACHE.preview);
  return c.json(items[0]);
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
