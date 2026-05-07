import { and, asc, desc, eq, inArray, lt, lte, or } from "drizzle-orm";
import type { Hex } from "viem";
import { db } from "../db/client.ts";
import { voidProofJobs, type VoidProofJobRow } from "../db/schema.ts";
import { env } from "../env.ts";
import { resolvedProofCacheKey } from "./cacheKey.ts";
import type { ProofInputSource } from "@blockhash/slonks-core/proof";
import type { ProofContracts, ResolvedVoidProofRequest } from "./voidProof.ts";

export type VoidProofJobStatus = "queued" | "running" | "succeeded" | "failed";

export type VoidProofPending = {
  status: "pending" | "running" | "failed";
  tokenId: number;
  cacheKey: string;
  attempts: number;
  retryAfter: number;
  statusUrl: string;
  error?: string;
};

export async function enqueueVoidProofJob(
  request: ResolvedVoidProofRequest,
  options: { priority?: number; bumpExisting?: boolean } = {},
): Promise<VoidProofJobRow> {
  const cacheKey = resolvedProofCacheKey(request);
  const row = {
    cacheKey,
    tokenId: request.tokenId,
    sourceId: request.sourceId,
    inputSource: request.inputSource,
    embedding: request.embedding,
    contracts: request.contracts,
    status: "queued",
    priority: options.priority ?? 0,
    attempts: 0,
    nextRunAt: new Date(),
    updatedAt: new Date(),
  } satisfies Partial<typeof voidProofJobs.$inferInsert>;

  const [inserted] = await db
    .insert(voidProofJobs)
    .values(row)
    .onConflictDoUpdate({
      target: voidProofJobs.cacheKey,
      set: {
        priority: row.priority,
        status: "queued",
        nextRunAt: row.nextRunAt,
        lastError: null,
        updatedAt: row.updatedAt,
      },
      where: inArray(voidProofJobs.status, ["failed"]),
    })
    .returning();
  if (inserted) return inserted;

  const job = await readVoidProofJob(cacheKey);
  if (!job) throw new Error("failed to enqueue void proof job");
  const promotedPriority = nextPriority(job, row.priority, options.bumpExisting ?? false);
  if (job.status !== "succeeded" && promotedPriority != null) {
    const [promoted] = await db
      .update(voidProofJobs)
      .set({
        priority: promotedPriority,
        nextRunAt: row.nextRunAt,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(voidProofJobs.cacheKey, cacheKey),
          eq(voidProofJobs.status, "queued"),
          lt(voidProofJobs.priority, promotedPriority),
        ),
      )
      .returning();
    if (promoted) return promoted;
  }
  return job;
}

function nextPriority(job: VoidProofJobRow, requestedPriority: number, bumpExisting: boolean): number | null {
  if (job.status !== "queued") return job.priority < requestedPriority ? requestedPriority : null;
  if (job.priority < requestedPriority) return requestedPriority;
  if (!bumpExisting || requestedPriority <= 0) return null;
  return Math.min(job.priority + 1, requestedPriority + 900);
}

export async function readVoidProofJob(cacheKey: string): Promise<VoidProofJobRow | null> {
  const [row] = await db.select().from(voidProofJobs).where(eq(voidProofJobs.cacheKey, cacheKey)).limit(1);
  return row ?? null;
}

export async function claimVoidProofJob(workerId: string): Promise<VoidProofJobRow | null> {
  const staleBefore = new Date(Date.now() - env.SLOP_PROOF_JOB_STALE_MS);
  return db.transaction(async (tx) => {
    const [job] = await tx
      .select()
      .from(voidProofJobs)
      .where(
        and(
          or(
            eq(voidProofJobs.status, "queued"),
            and(eq(voidProofJobs.status, "running"), lt(voidProofJobs.lockedAt, staleBefore)),
          ),
          lte(voidProofJobs.nextRunAt, new Date()),
        ),
      )
      .orderBy(desc(voidProofJobs.priority), asc(voidProofJobs.createdAt))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!job) return null;

    const [claimed] = await tx
      .update(voidProofJobs)
      .set({
        status: "running",
        attempts: job.attempts + 1,
        lockedBy: workerId,
        lockedAt: new Date(),
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(voidProofJobs.cacheKey, job.cacheKey))
      .returning();
    return claimed ?? null;
  });
}

export async function completeVoidProofJob(cacheKey: string): Promise<void> {
  await db
    .update(voidProofJobs)
    .set({
      status: "succeeded",
      lockedBy: null,
      lockedAt: null,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(voidProofJobs.cacheKey, cacheKey));
}

export async function releaseVoidProofJob(cacheKey: string, message: string, retryAfterMs: number): Promise<void> {
  await db
    .update(voidProofJobs)
    .set({
      status: "queued",
      lockedBy: null,
      lockedAt: null,
      lastError: message.slice(0, 2_000),
      nextRunAt: new Date(Date.now() + retryAfterMs),
      updatedAt: new Date(),
    })
    .where(eq(voidProofJobs.cacheKey, cacheKey));
}

export async function failVoidProofJob(job: VoidProofJobRow, message: string): Promise<void> {
  const attempts = job.attempts;
  const permanent = attempts >= env.SLOP_PROOF_JOB_MAX_ATTEMPTS;
  await db
    .update(voidProofJobs)
    .set({
      status: permanent ? "failed" : "queued",
      lockedBy: null,
      lockedAt: null,
      lastError: message.slice(0, 2_000),
      nextRunAt: new Date(Date.now() + retryDelayMs(attempts)),
      updatedAt: new Date(),
    })
    .where(eq(voidProofJobs.cacheKey, job.cacheKey));
}

export function requestFromJob(row: VoidProofJobRow): ResolvedVoidProofRequest {
  return {
    tokenId: row.tokenId,
    sourceId: row.sourceId,
    inputSource: row.inputSource as ProofInputSource,
    embedding: row.embedding as Hex,
    contracts: row.contracts as ProofContracts,
  };
}

export function pendingFromJob(row: VoidProofJobRow): VoidProofPending {
  return {
    status: row.status === "running" ? "running" : row.status === "failed" ? "failed" : "pending",
    tokenId: row.tokenId,
    cacheKey: row.cacheKey,
    attempts: row.attempts,
    retryAfter: Math.ceil(env.SLOP_PROOF_PENDING_RETRY_MS / 1_000),
    statusUrl: `/void-proof/jobs/${row.cacheKey}`,
    error: row.status === "failed" ? row.lastError ?? "proof generation failed" : undefined,
  };
}

function retryDelayMs(attempts: number): number {
  return Math.min(5 * 60_000, 2 ** Math.max(0, attempts - 1) * 5_000);
}
