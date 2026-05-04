CREATE TABLE IF NOT EXISTS "collection_state" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"total_supply" integer DEFAULT 0 NOT NULL,
	"remaining_source_ids" integer DEFAULT 10000 NOT NULL,
	"revealed" boolean DEFAULT false NOT NULL,
	"reveal_block_number" bigint DEFAULT 0 NOT NULL,
	"reveal_seed" text,
	"shuffle_offset" integer DEFAULT 0 NOT NULL,
	"sources_precomputed" integer DEFAULT 0 NOT NULL,
	"last_indexed_block" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "merges" (
	"block_number" bigint NOT NULL,
	"log_index" integer NOT NULL,
	"tx_hash" text NOT NULL,
	"survivor_token_id" integer NOT NULL,
	"burned_token_id" integer NOT NULL,
	"burned_source_id" smallint NOT NULL,
	"merge_level" smallint NOT NULL,
	"block_timestamp" timestamp with time zone NOT NULL,
	CONSTRAINT "merges_block_number_log_index_pk" PRIMARY KEY("block_number","log_index")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "source_punks" (
	"source_id" smallint PRIMARY KEY NOT NULL,
	"attributes_text" text NOT NULL,
	"attributes_json" jsonb NOT NULL,
	"punk_type" text NOT NULL,
	"original_rgba" "bytea" NOT NULL,
	"source_embedding" "bytea" NOT NULL,
	"generated_pixels" "bytea" NOT NULL,
	"base_diff_mask" "bytea" NOT NULL,
	"base_diff_count" smallint NOT NULL,
	"base_slop_level" smallint NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tokens" (
	"token_id" integer PRIMARY KEY NOT NULL,
	"exists" boolean DEFAULT false NOT NULL,
	"owner" text,
	"base_source_id" smallint,
	"source_id" smallint,
	"merge_level" smallint DEFAULT 0 NOT NULL,
	"merge_embedding" "bytea",
	"generated_pixels" "bytea",
	"diff_count" smallint,
	"slop_level" smallint,
	"minted_at_block" bigint,
	"last_event_block" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "transfers" (
	"block_number" bigint NOT NULL,
	"log_index" integer NOT NULL,
	"tx_hash" text NOT NULL,
	"token_id" integer NOT NULL,
	"from_address" text NOT NULL,
	"to_address" text NOT NULL,
	"block_timestamp" timestamp with time zone NOT NULL,
	CONSTRAINT "transfers_block_number_log_index_pk" PRIMARY KEY("block_number","log_index")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "merges_survivor_idx" ON "merges" USING btree ("survivor_token_id","block_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "merges_burned_idx" ON "merges" USING btree ("burned_token_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "source_punks_type_idx" ON "source_punks" USING btree ("punk_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "source_punks_diff_idx" ON "source_punks" USING btree ("base_diff_count");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tokens_owner_idx" ON "tokens" USING btree ("owner");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tokens_source_idx" ON "tokens" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tokens_base_source_idx" ON "tokens" USING btree ("base_source_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tokens_merge_level_idx" ON "tokens" USING btree ("merge_level");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tokens_diff_idx" ON "tokens" USING btree ("diff_count");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tokens_slop_idx" ON "tokens" USING btree ("slop_level");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transfers_token_idx" ON "transfers" USING btree ("token_id","block_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transfers_from_idx" ON "transfers" USING btree ("from_address","block_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transfers_to_idx" ON "transfers" USING btree ("to_address","block_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transfers_block_idx" ON "transfers" USING btree ("block_number");