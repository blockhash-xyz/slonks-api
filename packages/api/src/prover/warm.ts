import { isVoidProof, requestRemoteVoidProof } from "./remote.ts";
import { resolveVoidProofRequest, type VoidProof } from "./voidProof.ts";
import { readStoredVoidProof, writeStoredVoidProof } from "./store.ts";
import { env } from "../env.ts";

export async function warmVoidProof(tokenId: number, reason: string): Promise<VoidProof | null> {
  if (!env.SLOP_REMOTE_PROVER_URL) {
    console.info(`void proof warmup skipped for ${tokenId}: remote prover is not configured`);
    return null;
  }

  const request = await resolveVoidProofRequest(tokenId);
  const stored = await readStoredVoidProof(request);
  if (stored) {
    console.info(`void proof warmup cache hit for ${tokenId} (${reason})`);
    return stored;
  }

  console.info(`void proof warmup started for ${tokenId} (${reason})`);
  const response = await requestRemoteVoidProof(request);
  if (response.status !== 200 || !isVoidProof(response.body)) {
    const message = typeof response.body.error === "string" ? response.body.error : `remote prover returned ${response.status}`;
    throw new Error(`void proof warmup failed for ${tokenId}: ${message}`);
  }

  await writeStoredVoidProof(response.body);
  console.info(`void proof warmup stored for ${tokenId}`);
  return response.body;
}
