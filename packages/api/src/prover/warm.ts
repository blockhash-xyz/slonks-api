import { resolveVoidProofRequest } from "./voidProof.ts";
import { readStoredVoidProof } from "./store.ts";
import { env } from "../env.ts";
import { enqueueVoidProofJob } from "./jobs.ts";

export async function warmVoidProof(tokenId: number, reason: string): Promise<void> {
  if (!env.SLOP_REMOTE_PROVER_URL) {
    console.info(`void proof warmup skipped for ${tokenId}: remote prover is not configured`);
    return;
  }

  const request = await resolveVoidProofRequest(tokenId);
  const stored = await readStoredVoidProof(request);
  if (stored) {
    console.info(`void proof warmup cache hit for ${tokenId} (${reason})`);
    return;
  }

  console.info(`void proof warmup started for ${tokenId} (${reason})`);
  await enqueueVoidProofJob(request, { priority: 10 });
  console.info(`void proof warmup queued for ${tokenId}`);
}
