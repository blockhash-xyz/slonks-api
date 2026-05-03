import { Hono } from "hono";
import { computeMergePreviews, type MergePreviewPair } from "../mergePreviewCore.ts";

export const mergePreviews = new Hono();

mergePreviews.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return c.json({ error: "expected JSON body" }, 400);
  }

  const rawPairs = (body as { pairs?: unknown }).pairs;
  if (!Array.isArray(rawPairs)) return c.json({ error: "pairs must be an array" }, 400);
  if (rawPairs.length === 0) return c.json({ error: "pairs must not be empty" }, 400);
  if (rawPairs.length > 1_000) return c.json({ error: "pairs supports up to 1000 entries" }, 400);

  const pairs: MergePreviewPair[] = [];
  for (let i = 0; i < rawPairs.length; i++) {
    const pair = parsePair(rawPairs[i], i);
    if (typeof pair === "string") return c.json({ error: pair }, 400);
    pairs.push(pair);
  }

  const { items, errors } = await computeMergePreviews(pairs);
  c.header("Cache-Control", "public, s-maxage=30, stale-while-revalidate=120");
  return c.json({ chainId: 1, items, errors, count: items.length, errorCount: errors.length });
});

function parsePair(raw: unknown, index: number): MergePreviewPair | string {
  if (!raw || typeof raw !== "object") return `pairs[${index}] must be an object`;
  const record = raw as Record<string, unknown>;
  const survivorTokenId = parseTokenId(record.survivorTokenId ?? record.tokenId, `pairs[${index}].survivorTokenId`);
  if (typeof survivorTokenId === "string") return survivorTokenId;
  const donorTokenId = parseTokenId(
    record.donorTokenId ?? record.burnedTokenId ?? record.burnTokenId,
    `pairs[${index}].donorTokenId`,
  );
  if (typeof donorTokenId === "string") return donorTokenId;
  return { survivorTokenId, donorTokenId };
}

function parseTokenId(raw: unknown, name: string): number | string {
  const value = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
  if (!Number.isInteger(value) || typeof value !== "number" || value < 0 || value >= 10_000) {
    return `invalid ${name}`;
  }
  return value;
}
