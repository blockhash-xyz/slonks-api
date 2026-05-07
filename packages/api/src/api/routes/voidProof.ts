import { Hono } from "hono";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ensureEmbeddingHex, type ProofInputSource } from "@blockhash/slonks-core/proof";
import { getAddress, type Address, type Hex } from "viem";
import { env } from "../../env.ts";
import { setNoStore } from "../cache.ts";
import {
  generateVoidProof,
  generateVoidProofFromResolved,
  ProverBusyError,
  ProverUnavailableError,
  resolveVoidProofRequest,
  type ProofContracts,
  type ResolvedVoidProofRequest,
} from "../../prover/voidProof.ts";
import { isVoidProof, requestRemoteVoidProof, RemoteProverError } from "../../prover/remote.ts";

export const voidProof = new Hono();

voidProof.post("/", async (c) => {
  setNoStore(c);
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return c.json({ error: "expected JSON body" }, 400);
  }

  const tokenId = parseTokenId(readBodyNumber(body, "tokenId", "id"), "tokenId");
  if (typeof tokenId === "string") return c.json({ error: tokenId }, 400);

  const resolved = parseResolvedVoidProofRequest(body, tokenId);
  if (typeof resolved === "string") return c.json({ error: resolved }, 400);
  if (resolved) return respondWithProof(c, () => generateVoidProofFromResolved(resolved));

  if (env.SLOP_REMOTE_PROVER_URL) return remoteVoidProof(c, await resolveVoidProofRequest(tokenId));

  return respondWithProof(c, () => generateVoidProof(tokenId));
});

async function respondWithProof(c: Context, build: () => Promise<unknown>): Promise<Response> {
  try {
    const proof = await build();
    return c.json(proof);
  } catch (err) {
    if (err instanceof ProverBusyError) {
      c.header("Retry-After", "15");
      return c.json({ error: "prover is busy, retry shortly" }, 429);
    }
    if (err instanceof ProverUnavailableError) {
      return c.json({ error: err.message }, 503);
    }
    throw err;
  }
}

async function remoteVoidProof(c: Context, request: ResolvedVoidProofRequest): Promise<Response> {
  const { readStoredVoidProof, writeStoredVoidProof } = await import("../../prover/store.ts");
  const stored = await readStoredVoidProof(request);
  if (stored) return c.json(stored);

  try {
    const response = await requestRemoteVoidProof(request);
    const retryAfter = response.retryAfter;
    if (retryAfter) c.header("Retry-After", retryAfter);

    if (response.status === 200 && isVoidProof(response.body)) {
      try {
        await writeStoredVoidProof(response.body);
      } catch (err) {
        console.warn("failed to store void proof:", err);
      }
    }
    return c.json(response.body, response.status as ContentfulStatusCode);
  } catch (err) {
    if (err instanceof RemoteProverError) {
      return c.json({ error: err.message }, err.status as ContentfulStatusCode);
    }
    throw err;
  }
}

const PROOF_INPUT_SOURCES = new Set<ProofInputSource>(["active embedding", "merge embedding", "source embedding"]);

function parseResolvedVoidProofRequest(body: object, tokenId: number): ResolvedVoidProofRequest | string | null {
  const record = body as Record<string, unknown>;
  const hasResolvedFields =
    record.sourceId != null || record.inputSource != null || record.embedding != null || record.contracts != null;
  if (!hasResolvedFields) return null;

  const sourceId = typeof record.sourceId === "string" ? Number(record.sourceId) : record.sourceId;
  if (!Number.isInteger(sourceId) || typeof sourceId !== "number" || sourceId < 0 || sourceId >= 10_000) {
    return "invalid sourceId";
  }

  if (typeof record.inputSource !== "string" || !PROOF_INPUT_SOURCES.has(record.inputSource as ProofInputSource)) {
    return "invalid inputSource";
  }

  if (typeof record.embedding !== "string" || !record.embedding.startsWith("0x")) {
    return "invalid embedding";
  }

  let embedding: Hex;
  try {
    embedding = ensureEmbeddingHex(record.embedding as Hex, "embedding");
  } catch (err) {
    return err instanceof Error ? err.message : "invalid embedding";
  }

  const contracts = parseProofContracts(record.contracts);
  if (typeof contracts === "string") return contracts;

  return {
    tokenId,
    sourceId,
    inputSource: record.inputSource as ProofInputSource,
    embedding,
    contracts,
  };
}

function parseProofContracts(raw: unknown): ProofContracts | string {
  if (!raw || typeof raw !== "object") return "invalid contracts";
  const contracts = raw as Record<string, unknown>;
  const slonks = parseAddress(contracts.slonks, "contracts.slonks");
  if (!slonks.ok) return slonks.error;
  const renderer = parseAddress(contracts.renderer, "contracts.renderer");
  if (!renderer.ok) return renderer.error;
  const imageModel = parseAddress(contracts.imageModel, "contracts.imageModel");
  if (!imageModel.ok) return imageModel.error;
  const mergeManager = parseAddress(contracts.mergeManager, "contracts.mergeManager");
  if (!mergeManager.ok) return mergeManager.error;
  const activeState = contracts.activeState == null ? null : parseAddress(contracts.activeState, "contracts.activeState");
  if (activeState && !activeState.ok) return activeState.error;

  return {
    slonks: slonks.value,
    renderer: renderer.value,
    imageModel: imageModel.value,
    mergeManager: mergeManager.value,
    activeState: activeState ? activeState.value : null,
  };
}

type AddressParseResult = { ok: true; value: Address } | { ok: false; error: string };

function parseAddress(raw: unknown, label: string): AddressParseResult {
  if (typeof raw !== "string") return { ok: false, error: `invalid ${label}` };
  try {
    return { ok: true, value: getAddress(raw) };
  } catch {
    return { ok: false, error: `invalid ${label}` };
  }
}

function readBodyNumber(body: object, ...keys: string[]): unknown {
  const record = body as Record<string, unknown>;
  for (const key of keys) {
    if (record[key] != null) return record[key];
  }
  return undefined;
}

function parseTokenId(raw: unknown, name: string): number | string {
  const value = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
  if (!Number.isInteger(value) || typeof value !== "number" || value < 0 || value >= 10_000) {
    return `invalid ${name}`;
  }
  return value;
}
