CREATE TABLE IF NOT EXISTS "void_proof_jobs" (
	"cache_key" text PRIMARY KEY NOT NULL,
	"token_id" integer NOT NULL,
	"source_id" smallint NOT NULL,
	"input_source" text NOT NULL,
	"embedding" text NOT NULL,
	"contracts" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"locked_by" text,
	"locked_at" timestamp with time zone,
	"next_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "void_proof_jobs_status_next_run_idx" ON "void_proof_jobs" USING btree ("status","next_run_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "void_proof_jobs_token_idx" ON "void_proof_jobs" USING btree ("token_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "void_proof_jobs_updated_idx" ON "void_proof_jobs" USING btree ("updated_at");