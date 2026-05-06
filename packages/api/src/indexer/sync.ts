// Polling event sync. On each tick:
//   1. Read collection counters (cheap multicall) and update collection_state.
//   2. Walk eth_getLogs from `lastIndexedBlock + 1` up to `latest - 1` (one
//      block lag for reorg safety on mainnet).
//   3. Decode events, dispatch to handlers, persist updates, advance cursor.
//
// On Reveal we also backfill `tokens.source_id` for every minted token using
// `(baseSourceId + shuffleOffset) % MAX_SUPPLY` — pure math, no per-token RPC.

import { eq, sql } from "drizzle-orm";
import { decodeEventLog, type Hex, type Log } from "viem";
import {
  slonksAbi,
  slonksMergeManagerAbi,
} from "../chain/abis.ts";
import { CONTRACTS, MAX_SUPPLY, SLONKS_DEPLOY_BLOCK } from "../chain/contracts.ts";
import { publicClient } from "../chain/client.ts";
import { env } from "../env.ts";
import { db } from "../db/client.ts";
import { collectionState, tokens } from "../db/schema.ts";
import {
  applyMergeRender,
  ensureToken,
  reconcileMergedTokens,
  recordMerge,
  recordTransfer,
  repairMissingBaseSourceIds,
} from "./handlers.ts";

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

export async function syncOnce(): Promise<void> {
  const client = publicClient();

  const [latest, [stateRow]] = await Promise.all([
    client.getBlockNumber(),
    db.select().from(collectionState).where(eq(collectionState.id, 1)).limit(1),
  ]);

  if (!stateRow) {
    console.warn("collection_state row missing, skipping tick");
    return;
  }

  const safeLatest = latest > 0n ? latest - 1n : 0n;
  const startFrom = env.START_BLOCK ?? SLONKS_DEPLOY_BLOCK;
  let from = stateRow.lastIndexedBlock === 0n ? startFrom : stateRow.lastIndexedBlock + 1n;
  if (from > safeLatest) {
    await refreshCollection(safeLatest);
    return;
  }

  const range = env.LOG_RANGE;
  await refreshCollectionCounters();

  while (from <= safeLatest) {
    const to = from + range - 1n > safeLatest ? safeLatest : from + range - 1n;

    const [slonksLogs, mergeLogs] = await Promise.all([
      client.getLogs({
        address: CONTRACTS.slonks,
        fromBlock: from,
        toBlock: to,
      }),
      client.getLogs({
        address: CONTRACTS.mergeManager,
        fromBlock: from,
        toBlock: to,
      }),
    ]);

    await processSlonksLogs(slonksLogs);
    await processMergeLogs(mergeLogs);

    await db
      .update(collectionState)
      .set({ lastIndexedBlock: to, updatedAt: new Date() })
      .where(eq(collectionState.id, 1));

    from = to + 1n;
  }

  await refreshCollection(safeLatest);
}

async function processSlonksLogs(logs: Log[]): Promise<void> {
  for (const log of logs) {
    let decoded;
    try {
      decoded = decodeEventLog({
        abi: slonksAbi,
        data: log.data,
        topics: log.topics,
        strict: false,
      });
    } catch {
      continue;
    }
    if (!log.blockNumber || log.logIndex == null || !log.transactionHash) continue;

    switch (decoded.eventName) {
      case "Transfer": {
        const args = decoded.args as { from: `0x${string}`; to: `0x${string}`; tokenId: bigint };
        const tokenId = Number(args.tokenId);
        if (tokenId < 0 || tokenId >= MAX_SUPPLY) continue;
        const blockTimestamp = await blockTime(log.blockNumber);

        await recordTransfer({
          blockNumber: log.blockNumber,
          logIndex: log.logIndex,
          txHash: log.transactionHash,
          tokenId,
          from: args.from.toLowerCase(),
          to: args.to.toLowerCase(),
          blockTimestamp,
        });

        const isMint = args.from.toLowerCase() === ZERO_ADDR;
        const isBurn = args.to.toLowerCase() === ZERO_ADDR;
        await ensureToken(tokenId, log.blockNumber, isMint, isBurn, args.to.toLowerCase());
        break;
      }
      case "Revealed": {
        const args = decoded.args as { seed: Hex; offset: bigint };
        await db
          .update(collectionState)
          .set({
            revealed: true,
            revealSeed: args.seed,
            shuffleOffset: Number(args.offset),
            updatedAt: new Date(),
          })
          .where(eq(collectionState.id, 1));
        await fillSourceIdsAfterReveal(Number(args.offset));
        break;
      }
      case "RevealCommitted": {
        const args = decoded.args as { targetBlock: bigint };
        await db
          .update(collectionState)
          .set({ revealBlockNumber: args.targetBlock, updatedAt: new Date() })
          .where(eq(collectionState.id, 1));
        break;
      }
      case "BatchMetadataUpdate":
      case "MetadataUpdate":
        // No-op for now; these are cache-invalidation hints. State changes that
        // affect metadata (transfers, merges, reveal) are picked up by their own
        // events.
        break;
    }
  }
}

async function processMergeLogs(logs: Log[]): Promise<void> {
  for (const log of logs) {
    let decoded;
    try {
      decoded = decodeEventLog({
        abi: slonksMergeManagerAbi,
        data: log.data,
        topics: log.topics,
        strict: false,
      });
    } catch {
      continue;
    }
    if (decoded.eventName !== "SlonkMerged") continue;
    if (!log.blockNumber || log.logIndex == null || !log.transactionHash) continue;

    const args = decoded.args as {
      tokenId: bigint;
      burnedTokenId: bigint;
      burnedSourceId: bigint;
      mergeLevel: bigint;
    };
    const blockTimestamp = await blockTime(log.blockNumber);

    await recordMerge({
      blockNumber: log.blockNumber,
      logIndex: log.logIndex,
      txHash: log.transactionHash,
      survivorTokenId: Number(args.tokenId),
      burnedTokenId: Number(args.burnedTokenId),
      burnedSourceId: Number(args.burnedSourceId),
      mergeLevel: Number(args.mergeLevel),
      blockTimestamp,
    });
  }
}

async function refreshCollection(safeLatest: bigint): Promise<void> {
  const {
    totalSupply,
    remaining,
    revealed,
    revealBlock,
    shuffleOffset,
    revealSeed,
  } = await readCollectionFromChain();

  await db
    .update(collectionState)
    .set({
      totalSupply,
      remainingSourceIds: remaining,
      revealed,
      revealBlockNumber: revealBlock,
      shuffleOffset,
      revealSeed,
      lastIndexedBlock: safeLatest,
      updatedAt: new Date(),
    })
    .where(eq(collectionState.id, 1));

  await repairMissingBaseSourceIds();

  if (revealed && shuffleOffset >= 0) {
    await fillSourceIdsAfterReveal(shuffleOffset);
    await reconcileMergedTokens();
  }
}

async function refreshCollectionCounters(): Promise<void> {
  const {
    totalSupply,
    remaining,
    revealed,
    revealBlock,
    shuffleOffset,
    revealSeed,
  } = await readCollectionFromChain();

  await db
    .update(collectionState)
    .set({
      totalSupply,
      remainingSourceIds: remaining,
      revealed,
      revealBlockNumber: revealBlock,
      shuffleOffset,
      revealSeed,
      updatedAt: new Date(),
    })
    .where(eq(collectionState.id, 1));

  if (revealed && shuffleOffset >= 0) {
    await fillSourceIdsAfterReveal(shuffleOffset);
  }
}

async function readCollectionFromChain(): Promise<{
  totalSupply: number;
  remaining: number;
  revealed: boolean;
  revealBlock: bigint;
  shuffleOffset: number;
  revealSeed: Hex;
}> {
  const client = publicClient();
  const slonks = { address: CONTRACTS.slonks, abi: slonksAbi } as const;
  const reads = await client.multicall({
    allowFailure: false,
    contracts: [
      { ...slonks, functionName: "totalSupply" },
      { ...slonks, functionName: "remainingSourceIds" },
      { ...slonks, functionName: "revealed" },
      { ...slonks, functionName: "revealBlockNumber" },
      { ...slonks, functionName: "shuffleOffset" },
      { ...slonks, functionName: "revealSeed" },
    ],
  });

  const [totalSupply, remaining, revealed, revealBlock, shuffleOffset, revealSeed] = reads;

  return {
    totalSupply: Number(totalSupply as bigint),
    remaining: Number(remaining as bigint),
    revealed: revealed as boolean,
    revealBlock: revealBlock as bigint,
    shuffleOffset: Number(shuffleOffset as bigint),
    revealSeed: revealSeed as Hex,
  };
}

async function fillSourceIdsAfterReveal(offset: number): Promise<void> {
  // Pure math: source_id = (base_source_id + offset) % MAX_SUPPLY for every token
  // that has a base_source_id but no source_id yet.
  await db.execute(sql`
    update tokens
    set source_id = ((base_source_id + ${offset}) % ${MAX_SUPPLY})::smallint
    where base_source_id is not null and source_id is null
  `);

  // Pre-merge tokens inherit the source punk's generated_pixels + slop stats.
  // Skip tokens with merge_level > 0 — those are filled in by applyMergeRender.
  await db.execute(sql`
    update tokens t
    set
      generated_pixels = sp.generated_pixels,
      slop = sp.base_slop,
      slop_level = sp.base_slop_level,
      updated_at = now()
    from source_punks sp
    where sp.source_id = t.source_id
      and t.merge_level = 0
      and t.source_id is not null
      and (t.generated_pixels is null or t.slop is null)
  `);
}

const blockTimeCache = new Map<string, Date>();

async function blockTime(blockNumber: bigint): Promise<Date> {
  const key = blockNumber.toString();
  const cached = blockTimeCache.get(key);
  if (cached) return cached;
  const block = await publicClient().getBlock({ blockNumber });
  const ts = new Date(Number(block.timestamp) * 1000);
  blockTimeCache.set(key, ts);
  if (blockTimeCache.size > 5_000) {
    const first = blockTimeCache.keys().next().value;
    if (first) blockTimeCache.delete(first);
  }
  return ts;
}
