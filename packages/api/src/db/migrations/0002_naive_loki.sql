CREATE TABLE IF NOT EXISTS "void_proofs" (
	"cache_key" text PRIMARY KEY NOT NULL,
	"token_id" integer NOT NULL,
	"source_id" smallint NOT NULL,
	"input_source" text NOT NULL,
	"embedding" text NOT NULL,
	"proof" text NOT NULL,
	"public_inputs" jsonb NOT NULL,
	"proof_bytes" integer NOT NULL,
	"public_inputs_bytes" integer NOT NULL,
	"contracts" jsonb NOT NULL,
	"timings" jsonb NOT NULL,
	"generated_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "collection_state" ADD COLUMN "proof_warmup_last_indexed_block" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "void_proofs_token_idx" ON "void_proofs" USING btree ("token_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "void_proofs_generated_idx" ON "void_proofs" USING btree ("generated_at");