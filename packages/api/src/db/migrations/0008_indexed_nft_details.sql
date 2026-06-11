ALTER TABLE "indexed_nft_collection_state"
  ADD COLUMN IF NOT EXISTS "extended_last_indexed_block" bigint DEFAULT 0 NOT NULL;

ALTER TABLE "indexed_nft_tokens"
  ADD COLUMN IF NOT EXISTS "token_uri" text,
  ADD COLUMN IF NOT EXISTS "name" text,
  ADD COLUMN IF NOT EXISTS "image" text,
  ADD COLUMN IF NOT EXISTS "metadata_json" jsonb,
  ADD COLUMN IF NOT EXISTS "attributes_json" jsonb,
  ADD COLUMN IF NOT EXISTS "rarity_score" double precision,
  ADD COLUMN IF NOT EXISTS "rarity_rank" integer,
  ADD COLUMN IF NOT EXISTS "slopling_paid_through" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "slopling_immortal" boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS "pack_request_status" smallint,
  ADD COLUMN IF NOT EXISTS "pack_entropy_block" bigint,
  ADD COLUMN IF NOT EXISTS "pack_position" bigint,
  ADD COLUMN IF NOT EXISTS "pack_chosen" bigint,
  ADD COLUMN IF NOT EXISTS "pack_beneficiary" text,
  ADD COLUMN IF NOT EXISTS "pack_opened_nft_contract" text,
  ADD COLUMN IF NOT EXISTS "pack_opened_token_id" text,
  ADD COLUMN IF NOT EXISTS "pack_opened_at_block" bigint,
  ADD COLUMN IF NOT EXISTS "pack_opened_at_log_index" integer,
  ADD COLUMN IF NOT EXISTS "pack_opened_tx_hash" text,
  ADD COLUMN IF NOT EXISTS "pack_opened_at_timestamp" timestamp with time zone;

CREATE TABLE IF NOT EXISTS "indexed_nft_attributes" (
  "collection" text NOT NULL,
  "token_id" integer NOT NULL,
  "trait_type" text NOT NULL,
  "value" text NOT NULL,
  CONSTRAINT "indexed_nft_attributes_collection_token_id_trait_type_pk" PRIMARY KEY (
    "collection",
    "token_id",
    "trait_type"
  )
);

CREATE INDEX IF NOT EXISTS "indexed_nft_tokens_collection_rarity_idx"
  ON "indexed_nft_tokens" ("collection", "rarity_rank");
CREATE INDEX IF NOT EXISTS "indexed_nft_tokens_collection_pack_status_idx"
  ON "indexed_nft_tokens" ("collection", "pack_request_status");
CREATE INDEX IF NOT EXISTS "indexed_nft_attributes_collection_trait_value_idx"
  ON "indexed_nft_attributes" ("collection", "trait_type", "value");
CREATE INDEX IF NOT EXISTS "indexed_nft_attributes_collection_token_idx"
  ON "indexed_nft_attributes" ("collection", "token_id");
