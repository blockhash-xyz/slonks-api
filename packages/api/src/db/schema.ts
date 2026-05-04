import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Postgres bytea ↔ Uint8Array helper.
const bytea = customType<{ data: Uint8Array; default: false }>({
  dataType: () => "bytea",
});

// One row per CryptoPunks source id (0..9999). Immutable after backfill — these
// are pure functions of CryptoPunksData and the deployed image model.
export const sourcePunks = pgTable(
  "source_punks",
  {
    sourceId: smallint("source_id").primaryKey(),
    attributesText: text("attributes_text").notNull(),
    attributesJson: jsonb("attributes_json").notNull().$type<Array<{ trait_type: string; value: string }>>(),
    punkType: text("punk_type").notNull(), // first comma-separated entry: "Male", "Female", "Zombie", "Ape", "Alien"
    originalRgba: bytea("original_rgba").notNull(), // 2304 bytes
    sourceEmbedding: bytea("source_embedding").notNull(), // model embedDim bytes (10)
    generatedPixels: bytea("generated_pixels").notNull(), // 576 palette indexes
    baseDiffMask: bytea("base_diff_mask").notNull(), // 72 bytes
    baseDiffCount: smallint("base_diff_count").notNull(),
    baseSlopLevel: smallint("base_slop_level").notNull(),
  },
  (t) => ({
    typeIdx: index("source_punks_type_idx").on(t.punkType),
    diffIdx: index("source_punks_diff_idx").on(t.baseDiffCount),
  }),
);

// One row per Slonks token id. Sparse during minting; complete after `Revealed`.
export const tokens = pgTable(
  "tokens",
  {
    tokenId: integer("token_id").primaryKey(), // 0..9999
    exists: boolean("exists").notNull().default(false),
    owner: text("owner"), // checksummed 0x… address; null until first Transfer indexed
    baseSourceId: smallint("base_source_id"), // assigned at mint
    sourceId: smallint("source_id"), // (baseSourceId + shuffleOffset) % 10000, after Revealed
    mergeLevel: smallint("merge_level").notNull().default(0),
    // Cumulative model-space embedding. NULL means "use sourcePunks.sourceEmbedding for this token's sourceId".
    mergeEmbedding: bytea("merge_embedding"),
    // Pixels actually rendered for this token. For unmerged tokens, equals sourcePunks.generatedPixels.
    // For merged tokens, the indexer re-renders via SlonksImageModel.renderEmbeddingPixels.
    generatedPixels: bytea("generated_pixels"),
    diffCount: smallint("diff_count"),
    slopLevel: smallint("slop_level"),
    mintedAtBlock: bigint("minted_at_block", { mode: "bigint" }),
    lastEventBlock: bigint("last_event_block", { mode: "bigint" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    ownerIdx: index("tokens_owner_idx").on(t.owner),
    sourceIdx: index("tokens_source_idx").on(t.sourceId),
    baseSourceIdx: index("tokens_base_source_idx").on(t.baseSourceId),
    mergeLevelIdx: index("tokens_merge_level_idx").on(t.mergeLevel),
    diffIdx: index("tokens_diff_idx").on(t.diffCount),
    slopIdx: index("tokens_slop_idx").on(t.slopLevel),
  }),
);

// Full Transfer log. Includes mints (from = 0x0…0) and burns (to = 0x0…0).
export const transfers = pgTable(
  "transfers",
  {
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    logIndex: integer("log_index").notNull(),
    txHash: text("tx_hash").notNull(),
    tokenId: integer("token_id").notNull(),
    from: text("from_address").notNull(),
    to: text("to_address").notNull(),
    blockTimestamp: timestamp("block_timestamp", { withTimezone: true }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.blockNumber, t.logIndex] }),
    tokenIdx: index("transfers_token_idx").on(t.tokenId, t.blockNumber),
    fromIdx: index("transfers_from_idx").on(t.from, t.blockNumber),
    toIdx: index("transfers_to_idx").on(t.to, t.blockNumber),
    blockIdx: index("transfers_block_idx").on(t.blockNumber),
  }),
);

// Full SlonkMerged log. Donor → Survivor edges form the merge ancestry graph.
export const merges = pgTable(
  "merges",
  {
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    logIndex: integer("log_index").notNull(),
    txHash: text("tx_hash").notNull(),
    survivorTokenId: integer("survivor_token_id").notNull(),
    burnedTokenId: integer("burned_token_id").notNull(),
    burnedSourceId: smallint("burned_source_id").notNull(),
    mergeLevel: smallint("merge_level").notNull(), // resulting level after this merge
    blockTimestamp: timestamp("block_timestamp", { withTimezone: true }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.blockNumber, t.logIndex] }),
    survivorIdx: index("merges_survivor_idx").on(t.survivorTokenId, t.blockNumber),
    burnedIdx: index("merges_burned_idx").on(t.burnedTokenId),
  }),
);

// Single-row collection state. Updated on Reveal{Committed,ed} + every sync tick.
export const collectionState = pgTable("collection_state", {
  id: integer("id").primaryKey().default(1),
  totalSupply: integer("total_supply").notNull().default(0),
  remainingSourceIds: integer("remaining_source_ids").notNull().default(10_000),
  revealed: boolean("revealed").notNull().default(false),
  revealBlockNumber: bigint("reveal_block_number", { mode: "bigint" }).notNull().default(sql`0`),
  revealSeed: text("reveal_seed"), // hex
  shuffleOffset: integer("shuffle_offset").notNull().default(0),
  sourcesPrecomputed: integer("sources_precomputed").notNull().default(0),
  lastIndexedBlock: bigint("last_indexed_block", { mode: "bigint" }).notNull().default(sql`0`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SourcePunkRow = typeof sourcePunks.$inferSelect;
export type TokenRow = typeof tokens.$inferSelect;
export type TransferRow = typeof transfers.$inferSelect;
export type MergeRow = typeof merges.$inferSelect;
export type CollectionStateRow = typeof collectionState.$inferSelect;
