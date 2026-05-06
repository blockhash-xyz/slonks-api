import { Hono } from "hono";
import { and, desc, eq, inArray, lt, or, type SQL } from "drizzle-orm";
import { isAddress } from "viem";
import { db } from "../../db/client.ts";
import { merges, tokens, transfers } from "../../db/schema.ts";
import { CACHE, setCache } from "../cache.ts";
import { mergeDto, transferDto } from "../dto.ts";

export const activity = new Hono();

// Combined transfers + merges feed. Cursor is the highest blockNumber seen.
activity.get("/", async (c) => {
  const sp = c.req.query();
  const limit = Math.min(Math.max(Number(sp.limit ?? 50), 1), 200);
  if (!Number.isInteger(limit)) return c.json({ error: "invalid limit" }, 400);
  if (sp.type != null && sp.type !== "transfer" && sp.type !== "merge") {
    return c.json({ error: "invalid type" }, 400);
  }
  const cursor = parseCursor(sp.cursor);
  if (typeof cursor === "string") return c.json({ error: cursor }, 400);

  const transferConds: SQL[] = [];
  const mergeConds: SQL[] = [];

  if (sp.token != null) {
    const id = Number(sp.token);
    if (!Number.isInteger(id) || id < 0 || id >= 10_000) return c.json({ error: "invalid token" }, 400);
    transferConds.push(eq(transfers.tokenId, id));
    mergeConds.push(or(eq(merges.survivorTokenId, id), eq(merges.burnedTokenId, id))!);
  }
  if (sp.owner) {
    if (!isAddress(sp.owner)) return c.json({ error: "invalid owner" }, 400);
    const lower = sp.owner.toLowerCase();
    transferConds.push(or(eq(transfers.from, lower), eq(transfers.to, lower))!);
    mergeConds.push(
      inArray(
        merges.survivorTokenId,
        db
          .select({ tokenId: tokens.tokenId })
          .from(tokens)
          .where(and(eq(tokens.exists, true), eq(tokens.owner, lower))),
      ),
    );
  }

  const wantTransfers = sp.type !== "merge";
  const wantMerges = sp.type !== "transfer";

  const transfersPromise = wantTransfers
    ? db
        .select()
        .from(transfers)
        .where(
          and(
            ...transferConds,
            cursor
              ? or(
                  lt(transfers.blockNumber, cursor.blockNumber),
                  and(eq(transfers.blockNumber, cursor.blockNumber), lt(transfers.logIndex, cursor.logIndex)),
                )
              : undefined,
          ),
        )
        .orderBy(desc(transfers.blockNumber), desc(transfers.logIndex))
        .limit(limit + 1)
    : Promise.resolve([]);

  const mergesPromise = wantMerges
    ? db
        .select()
        .from(merges)
        .where(
          and(
            ...mergeConds,
            cursor
              ? or(
                  lt(merges.blockNumber, cursor.blockNumber),
                  and(eq(merges.blockNumber, cursor.blockNumber), lt(merges.logIndex, cursor.logIndex)),
                )
              : undefined,
          ),
        )
        .orderBy(desc(merges.blockNumber), desc(merges.logIndex))
        .limit(limit + 1)
    : Promise.resolve([]);

  const [transferRows, mergeRows] = await Promise.all([transfersPromise, mergesPromise]);

  type Item =
    | { kind: "transfer"; blockNumber: bigint; logIndex: number; data: typeof transferRows[number] }
    | { kind: "merge"; blockNumber: bigint; logIndex: number; data: typeof mergeRows[number] };

  const items: Item[] = [
    ...transferRows.map((t) => ({ kind: "transfer" as const, blockNumber: t.blockNumber, logIndex: t.logIndex, data: t })),
    ...mergeRows.map((m) => ({ kind: "merge" as const, blockNumber: m.blockNumber, logIndex: m.logIndex, data: m })),
  ];

  items.sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) return a.blockNumber > b.blockNumber ? -1 : 1;
    return b.logIndex - a.logIndex;
  });

  const hasMore = items.length > limit;
  const trimmed = items.slice(0, limit);
  const last = trimmed[trimmed.length - 1] ?? null;
  const nextCursor = hasMore && last ? `${last.blockNumber.toString()}:${last.logIndex}` : null;

  setCache(c, CACHE.activity);
  return c.json({
    items: trimmed.map((item) => {
      return item.kind === "transfer"
        ? { kind: item.kind, ...transferDto(item.data) }
        : { kind: item.kind, ...mergeDto(item.data) };
    }),
    hasMore,
    nextCursor,
  });
});

function parseCursor(raw: string | undefined): { blockNumber: bigint; logIndex: number } | null | string {
  if (!raw) return null;
  const [blockRaw, logRaw] = raw.split(":");
  if (!blockRaw || !/^\d+$/.test(blockRaw)) return "invalid cursor";
  const blockNumber = BigInt(blockRaw);
  if (logRaw == null) return { blockNumber, logIndex: Number.MAX_SAFE_INTEGER };
  const logIndex = Number(logRaw);
  if (!Number.isInteger(logIndex) || logIndex < 0) return "invalid cursor";
  return { blockNumber, logIndex };
}
