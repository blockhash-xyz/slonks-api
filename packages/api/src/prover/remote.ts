import type { VoidProof, ResolvedVoidProofRequest } from "./voidProof.ts";
import { env } from "../env.ts";

export type RemoteVoidProofResponse = {
  status: number;
  body: Record<string, unknown>;
  retryAfter: string | null;
};

export class RemoteProverError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function requestRemoteVoidProof(request: ResolvedVoidProofRequest): Promise<RemoteVoidProofResponse> {
  if (!env.SLOP_REMOTE_PROVER_URL) throw new RemoteProverError("remote prover is not configured", 503);

  const url = new URL("/void-proof", env.SLOP_REMOTE_PROVER_URL);
  const headers = new Headers({ "Content-Type": "application/json" });
  if (env.SLOP_PROVER_AUTH_TOKEN) headers.set("Authorization", `Bearer ${env.SLOP_PROVER_AUTH_TOKEN}`);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(env.SLOP_REMOTE_PROVER_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    throw new RemoteProverError(timedOut ? "remote prover timed out" : "remote prover unavailable", timedOut ? 504 : 503);
  }

  const text = await response.text();
  const body = parseJsonObject(text);
  if (!body) throw new RemoteProverError("remote prover returned invalid JSON", 502);

  return {
    status: response.status,
    body,
    retryAfter: response.headers.get("Retry-After"),
  };
}

export function isVoidProof(value: unknown): value is VoidProof {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    record.chainId === 1 &&
    Number.isInteger(record.tokenId) &&
    Number.isInteger(record.sourceId) &&
    typeof record.inputSource === "string" &&
    typeof record.embedding === "string" &&
    typeof record.proof === "string" &&
    Array.isArray(record.publicInputs) &&
    Number.isInteger(record.proofBytes) &&
    Number.isInteger(record.publicInputsBytes) &&
    record.contracts != null &&
    typeof record.contracts === "object" &&
    record.timingsMs != null &&
    typeof record.timingsMs === "object" &&
    typeof record.generatedAt === "string"
  );
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
