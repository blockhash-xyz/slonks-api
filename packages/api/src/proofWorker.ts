import { randomUUID } from "node:crypto";
import { env } from "./env.ts";
import { close } from "./db/client.ts";
import {
  claimVoidProofJob,
  completeVoidProofJob,
  failVoidProofJob,
  rejectVoidProofJob,
  releaseVoidProofJob,
} from "./prover/jobs.ts";
import { isPendingVoidClaim, notPendingVoidClaimMessage } from "./prover/claimGuard.ts";
import { resolvedProofCacheKey } from "./prover/cacheKey.ts";
import { isVoidProof, requestRemoteVoidProof, RemoteProverError } from "./prover/remote.ts";
import { writeStoredVoidProof } from "./prover/store.ts";
import { resolveVoidProofRequest } from "./prover/voidProof.ts";

const workerId = `proof-worker-${randomUUID()}`;
let stopping = false;

process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});

console.log(`void proof worker ${workerId} starting; concurrency ${env.SLOP_PROOF_WORKER_CONCURRENCY}`);

await Promise.all(Array.from({ length: env.SLOP_PROOF_WORKER_CONCURRENCY }, (_, index) => workerLoop(index)));
await close();

async function workerLoop(index: number): Promise<void> {
  while (!stopping) {
    const job = await claimVoidProofJob(`${workerId}-${index}`);
    if (!job) {
      await sleep(env.SLOP_PROOF_JOB_POLL_MS);
      continue;
    }

    console.log(`void proof job ${job.cacheKey} token ${job.tokenId} attempt ${job.attempts} started`);
    try {
      const request = await resolveVoidProofRequest(job.tokenId);
      const currentCacheKey = resolvedProofCacheKey(request);
      if (currentCacheKey !== job.cacheKey) {
        const message = "proof job is stale; request a new proof";
        await rejectVoidProofJob(job.cacheKey, message);
        console.warn(`void proof job ${job.cacheKey} token ${job.tokenId} rejected: ${message}`);
        continue;
      }

      if (!(await isPendingVoidClaim(job.tokenId))) {
        const message = notPendingVoidClaimMessage(job.tokenId);
        await rejectVoidProofJob(job.cacheKey, message);
        console.warn(`void proof job ${job.cacheKey} token ${job.tokenId} rejected: ${message}`);
        continue;
      }

      const response = await requestRemoteVoidProof(request);
      if (response.status === 429) {
        const retryAfterMs = retryAfterMsFromBody(response.body, response.retryAfter) ?? env.SLOP_PROOF_PENDING_RETRY_MS;
        await releaseVoidProofJob(job.cacheKey, "remote prover busy", retryAfterMs);
        continue;
      }
      if (response.status !== 200 || !isVoidProof(response.body)) {
        const message =
          typeof response.body.error === "string" ? response.body.error : `remote prover returned ${response.status}`;
        await failVoidProofJob(job, message);
        console.warn(`void proof job ${job.cacheKey} token ${job.tokenId} failed: ${message}`);
        continue;
      }

      await writeStoredVoidProof(response.body);
      await completeVoidProofJob(job.cacheKey);
      console.log(`void proof job ${job.cacheKey} token ${job.tokenId} completed`);
    } catch (err) {
      const message = err instanceof RemoteProverError || err instanceof Error ? err.message : String(err);
      await failVoidProofJob(job, message);
      console.warn(`void proof job ${job.cacheKey} token ${job.tokenId} failed:`, err);
    }
  }
}

function retryAfterMsFromBody(body: Record<string, unknown>, retryAfter: string | null): number | null {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds > 0) return seconds * 1_000;
  }
  const raw = body.retryAfterMs ?? body.retryAfter;
  const value = typeof raw === "string" ? Number(raw) : raw;
  return Number.isFinite(value) && typeof value === "number" && value > 0 ? value : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
