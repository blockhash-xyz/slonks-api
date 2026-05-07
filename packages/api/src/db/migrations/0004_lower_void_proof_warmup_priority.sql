UPDATE "void_proof_jobs"
SET "priority" = -10, "updated_at" = now()
WHERE "status" = 'queued' AND "priority" > 0;
