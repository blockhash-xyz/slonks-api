CREATE TABLE IF NOT EXISTS "indexed_nft_collection_state" (
  "collection" text PRIMARY KEY NOT NULL,
  "contract_address" text NOT NULL,
  "start_block" bigint NOT NULL,
  "last_indexed_block" bigint DEFAULT 0 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "indexed_nft_tokens" (
  "collection" text NOT NULL,
  "token_id" integer NOT NULL,
  "exists" boolean DEFAULT false NOT NULL,
  "owner" text,
  "minted_at_block" bigint,
  "last_event_block" bigint,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "indexed_nft_tokens_collection_token_id_pk" PRIMARY KEY ("collection", "token_id")
);

CREATE TABLE IF NOT EXISTS "indexed_nft_transfers" (
  "collection" text NOT NULL,
  "block_number" bigint NOT NULL,
  "log_index" integer NOT NULL,
  "tx_hash" text NOT NULL,
  "token_id" integer NOT NULL,
  "from_address" text NOT NULL,
  "to_address" text NOT NULL,
  "block_timestamp" timestamp with time zone NOT NULL,
  CONSTRAINT "indexed_nft_transfers_collection_block_number_log_index_pk" PRIMARY KEY (
    "collection",
    "block_number",
    "log_index"
  )
);

CREATE INDEX IF NOT EXISTS "indexed_nft_tokens_collection_owner_idx"
  ON "indexed_nft_tokens" ("collection", "owner");
CREATE INDEX IF NOT EXISTS "indexed_nft_tokens_collection_exists_idx"
  ON "indexed_nft_tokens" ("collection", "exists");
CREATE INDEX IF NOT EXISTS "indexed_nft_transfers_collection_token_idx"
  ON "indexed_nft_transfers" ("collection", "token_id", "block_number");
CREATE INDEX IF NOT EXISTS "indexed_nft_transfers_collection_from_idx"
  ON "indexed_nft_transfers" ("collection", "from_address", "block_number");
CREATE INDEX IF NOT EXISTS "indexed_nft_transfers_collection_to_idx"
  ON "indexed_nft_transfers" ("collection", "to_address", "block_number");
CREATE INDEX IF NOT EXISTS "indexed_nft_transfers_collection_block_idx"
  ON "indexed_nft_transfers" ("collection", "block_number");
