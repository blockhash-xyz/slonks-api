import { sql } from "drizzle-orm";
import { db, close as closeDb } from "../db/client.ts";
import { collectionState } from "../db/schema.ts";
import { env } from "../env.ts";
import { backfillSourcePunks } from "./sources.ts";
import { syncOnce } from "./sync.ts";

async function ensureCollectionRow() {
  await db
    .insert(collectionState)
    .values({ id: 1 })
    .onConflictDoNothing({ target: collectionState.id });
}

async function main() {
  await ensureCollectionRow();

  // The source-punk precompute is durable: we record progress per-row, so
  // restarting the indexer picks up exactly where it left off. Run it in
  // parallel with the event sync.
  void backfillSourcePunks().catch((err) => {
    console.error("source backfill error:", err);
  });

  console.log(`indexer starting; sync interval ${env.SYNC_INTERVAL_MS}ms`);
  while (true) {
    try {
      await syncOnce();
    } catch (err) {
      console.error("sync tick error:", err);
    }
    await sleep(env.SYNC_INTERVAL_MS);
  }
}

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

main().catch(async (err) => {
  console.error("indexer fatal:", err);
  await closeDb();
  process.exit(1);
});
