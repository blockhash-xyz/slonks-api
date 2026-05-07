ALTER TABLE "collection_state"
ADD COLUMN "game_claims_last_indexed_block" bigint DEFAULT 0 NOT NULL;

CREATE TABLE IF NOT EXISTS "slop_claims" (
  "token_id" integer PRIMARY KEY NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "recipient" text,
  "submitter" text,
  "slop" smallint,
  "minted_amount" text,
  "locked_at_block" bigint,
  "locked_at_log_index" integer,
  "locked_at_tx_hash" text,
  "locked_at_timestamp" timestamp with time zone,
  "unlocked_at_block" bigint,
  "unlocked_at_log_index" integer,
  "unlocked_at_tx_hash" text,
  "unlocked_at_timestamp" timestamp with time zone,
  "claimed_at_block" bigint,
  "claimed_at_log_index" integer,
  "claimed_at_tx_hash" text,
  "claimed_at_timestamp" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "slop_claims_status_idx" ON "slop_claims" ("status");
CREATE INDEX IF NOT EXISTS "slop_claims_recipient_idx" ON "slop_claims" ("recipient");
CREATE INDEX IF NOT EXISTS "slop_claims_locked_at_idx" ON "slop_claims" ("locked_at_block", "locked_at_log_index");
