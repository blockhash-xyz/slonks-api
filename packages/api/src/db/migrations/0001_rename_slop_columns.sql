ALTER TABLE "source_punks" RENAME COLUMN "base_diff_mask" TO "base_slop_mask";--> statement-breakpoint
ALTER TABLE "source_punks" RENAME COLUMN "base_diff_count" TO "base_slop";--> statement-breakpoint
ALTER TABLE "tokens" RENAME COLUMN "diff_count" TO "slop";--> statement-breakpoint
ALTER INDEX IF EXISTS "source_punks_diff_idx" RENAME TO "source_punks_base_slop_idx";--> statement-breakpoint
ALTER INDEX IF EXISTS "tokens_slop_idx" RENAME TO "tokens_slop_level_idx";--> statement-breakpoint
ALTER INDEX IF EXISTS "tokens_diff_idx" RENAME TO "tokens_slop_idx";
