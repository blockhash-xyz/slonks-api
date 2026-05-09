import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { encodeSlonkPng } from "@blockhash/slonks-core/png";
import { db } from "../../db/client.ts";
import { sourcePunks, tokens } from "../../db/schema.ts";
import { setNoStore } from "../cache.ts";

export const png: Hono = new Hono();

png.get("/:id{[0-9]+}", async (c) => {
  const id = Number(c.req.param("id"));
  if (!validTokenId(id)) return c.json({ error: `invalid token id ${id}` }, 400);
  if (c.req.query("scale") != null) return c.json({ error: "custom scaling is not supported" }, 400);

  const [row] = await db
    .select({ token: tokens, source: sourcePunks })
    .from(tokens)
    .leftJoin(sourcePunks, eq(sourcePunks.sourceId, tokens.sourceId))
    .where(eq(tokens.tokenId, id))
    .limit(1);

  if (!row) return c.json({ error: "token not found" }, 404);

  const pixels = row.token.generatedPixels ?? row.source?.generatedPixels ?? null;
  if (!pixels) return c.json({ error: "token image not available" }, 404);

  const body = encodeSlonkPng(pixels);
  setNoStore(c);
  c.header("Content-Type", "image/png");
  c.header("Content-Length", String(body.length));
  c.header("Content-Disposition", `inline; filename="slonk-${id}.png"`);
  c.header("X-Slonks-Image-Size", "1200x1200");
  return c.body(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer);
});

function validTokenId(id: number): boolean {
  return Number.isInteger(id) && id >= 0 && id < 10_000;
}
