import { eq, sql } from "drizzle-orm";
import { decodeEventLog, type Log, type PublicClient } from "viem";
import { erc721OwnershipAbi, seasonOneControllerAbi, sloplingsAbi } from "../chain/abis.ts";
import {
  CONTRACTS,
  INDEXED_NFT_COLLECTIONS,
  SLOPLING_FEED_INTERVAL_SECONDS,
  type IndexedNftCollection,
} from "../chain/contracts.ts";
import { bumpApiCacheVersion, INDEXED_NFT_CACHE_SCOPE } from "../api/stateCache.ts";
import { db } from "../db/client.ts";
import { indexedNftCollectionState, indexedNftTokens, indexedNftTransfers } from "../db/schema.ts";
import { env } from "../env.ts";

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
const blockTimeCache = new Map<string, Date>();

export async function syncIndexedNftLogs(client: PublicClient, safeLatest: bigint): Promise<void> {
  for (const collection of INDEXED_NFT_COLLECTIONS) {
    await syncIndexedNftCollectionLogs(client, collection, safeLatest);
  }
  await syncSloplingCareLogs(client, safeLatest);
  await syncSlopPackLifecycleLogs(client, safeLatest);
}

async function syncIndexedNftCollectionLogs(
  client: PublicClient,
  collection: IndexedNftCollection,
  safeLatest: bigint,
): Promise<void> {
  const stateRow = await ensureIndexedNftCollectionState(collection);
  const startFrom = env.START_BLOCK ?? collection.startBlock;
  let cursor = stateRow.lastIndexedBlock;
  let from = cursor === 0n ? startFrom : cursor + 1n;
  if (from > safeLatest) return;

  const range = env.LOG_RANGE;
  while (from <= safeLatest) {
    const to = from + range - 1n > safeLatest ? safeLatest : from + range - 1n;
    const logs = await client.getLogs({
      address: collection.address,
      fromBlock: from,
      toBlock: to,
    });

    if (await processIndexedNftLogs(client, collection, sortLogs(logs))) {
      await bumpApiCacheVersion(INDEXED_NFT_CACHE_SCOPE);
    }

    if (cursor < to) cursor = to;
    await db
      .update(indexedNftCollectionState)
      .set({ lastIndexedBlock: cursor, updatedAt: new Date() })
      .where(eq(indexedNftCollectionState.collection, collection.slug));

    from = to + 1n;
  }
}

async function ensureIndexedNftCollectionState(
  collection: IndexedNftCollection,
): Promise<{ lastIndexedBlock: bigint; extendedLastIndexedBlock: bigint }> {
  await db
    .insert(indexedNftCollectionState)
    .values({
      collection: collection.slug,
      contractAddress: collection.address.toLowerCase(),
      startBlock: collection.startBlock,
    })
    .onConflictDoUpdate({
      target: indexedNftCollectionState.collection,
      set: {
        contractAddress: collection.address.toLowerCase(),
        startBlock: collection.startBlock,
        updatedAt: new Date(),
      },
    });

  const [row] = await db
    .select({
      lastIndexedBlock: indexedNftCollectionState.lastIndexedBlock,
      extendedLastIndexedBlock: indexedNftCollectionState.extendedLastIndexedBlock,
    })
    .from(indexedNftCollectionState)
    .where(eq(indexedNftCollectionState.collection, collection.slug))
    .limit(1);

  return {
    lastIndexedBlock: row?.lastIndexedBlock ?? 0n,
    extendedLastIndexedBlock: row?.extendedLastIndexedBlock ?? 0n,
  };
}

async function processIndexedNftLogs(
  client: PublicClient,
  collection: IndexedNftCollection,
  logs: Log[],
): Promise<boolean> {
  let changed = false;
  for (const log of logs) {
    let decoded;
    try {
      decoded = decodeEventLog({
        abi: erc721OwnershipAbi,
        data: log.data,
        topics: log.topics,
        strict: false,
      });
    } catch {
      continue;
    }
    if (decoded.eventName !== "Transfer") continue;
    if (!log.blockNumber || log.logIndex == null || !log.transactionHash) continue;

    const args = decoded.args as { from: `0x${string}`; to: `0x${string}`; tokenId: bigint };
    if (args.tokenId > BigInt(Number.MAX_SAFE_INTEGER)) continue;

    const tokenId = Number(args.tokenId);
    const blockTimestamp = await blockTime(client, log.blockNumber);
    const from = args.from.toLowerCase();
    const to = args.to.toLowerCase();
    const isMint = from === ZERO_ADDR;
    const isBurn = to === ZERO_ADDR;

    await db
      .insert(indexedNftTransfers)
      .values({
        collection: collection.slug,
        blockNumber: log.blockNumber,
        logIndex: log.logIndex,
        txHash: log.transactionHash,
        tokenId,
        from,
        to,
        blockTimestamp,
      })
      .onConflictDoNothing({
        target: [indexedNftTransfers.collection, indexedNftTransfers.blockNumber, indexedNftTransfers.logIndex],
      });

    await db
      .insert(indexedNftTokens)
      .values({
        collection: collection.slug,
        tokenId,
        exists: !isBurn,
        owner: isBurn ? null : to,
        mintedAtBlock: isMint ? log.blockNumber : null,
        lastEventBlock: log.blockNumber,
      })
      .onConflictDoUpdate({
        target: [indexedNftTokens.collection, indexedNftTokens.tokenId],
        set: {
          exists: !isBurn,
          owner: isBurn ? null : to,
          mintedAtBlock: isMint
            ? log.blockNumber
            : sql`coalesce(${indexedNftTokens.mintedAtBlock}, excluded.minted_at_block)`,
          lastEventBlock: log.blockNumber,
          updatedAt: new Date(),
        },
      });

    changed = true;
  }
  return changed;
}

async function syncSloplingCareLogs(client: PublicClient, safeLatest: bigint): Promise<void> {
  const collection = INDEXED_NFT_COLLECTIONS.find((item) => item.slug === "sloplings");
  if (!collection) return;

  const stateRow = await ensureIndexedNftCollectionState(collection);
  const startFrom = env.START_BLOCK ?? collection.startBlock;
  let cursor = stateRow.extendedLastIndexedBlock;
  let from = cursor === 0n ? startFrom : cursor + 1n;
  if (from > safeLatest) return;

  const range = env.LOG_RANGE;
  while (from <= safeLatest) {
    const to = from + range - 1n > safeLatest ? safeLatest : from + range - 1n;
    const logs = await client.getLogs({
      address: CONTRACTS.sloplings,
      fromBlock: from,
      toBlock: to,
    });

    if (await processSloplingCareLogs(client, sortLogs(logs))) {
      await bumpApiCacheVersion(INDEXED_NFT_CACHE_SCOPE);
    }

    if (cursor < to) cursor = to;
    await db
      .update(indexedNftCollectionState)
      .set({ extendedLastIndexedBlock: cursor, updatedAt: new Date() })
      .where(eq(indexedNftCollectionState.collection, collection.slug));

    from = to + 1n;
  }
}

async function processSloplingCareLogs(client: PublicClient, logs: Log[]): Promise<boolean> {
  let changed = false;
  for (const log of logs) {
    if (!log.blockNumber || log.logIndex == null) continue;

    const transfer = decodeOptionalEvent(log, erc721OwnershipAbi);
    if (transfer?.eventName === "Transfer") {
      const args = transfer.args as { from: `0x${string}`; to: `0x${string}`; tokenId: bigint };
      if (args.tokenId > BigInt(Number.MAX_SAFE_INTEGER)) continue;
      if (args.from.toLowerCase() !== ZERO_ADDR) continue;

      const tokenId = Number(args.tokenId);
      const blockTimestamp = await blockTime(client, log.blockNumber);
      await db
        .insert(indexedNftTokens)
        .values({
          collection: "sloplings",
          tokenId,
          sloplingPaidThrough: addSeconds(blockTimestamp, SLOPLING_FEED_INTERVAL_SECONDS),
          sloplingImmortal: false,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [indexedNftTokens.collection, indexedNftTokens.tokenId],
          set: {
            sloplingPaidThrough: sql`coalesce(${indexedNftTokens.sloplingPaidThrough}, excluded.slopling_paid_through)`,
            sloplingImmortal: false,
            updatedAt: new Date(),
          },
        });
      changed = true;
      continue;
    }

    const decoded = decodeOptionalEvent(log, sloplingsAbi);
    if (!decoded) continue;
    const args = decoded.args as { tokenId?: bigint; paidThrough?: bigint };
    if (args.tokenId == null || args.tokenId > BigInt(Number.MAX_SAFE_INTEGER)) continue;
    const tokenId = Number(args.tokenId);

    switch (decoded.eventName) {
      case "Fed":
      case "Revived":
        if (args.paidThrough == null) break;
        await db
          .insert(indexedNftTokens)
          .values({
            collection: "sloplings",
            tokenId,
            sloplingPaidThrough: unixSecondsToDate(args.paidThrough),
            sloplingImmortal: false,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [indexedNftTokens.collection, indexedNftTokens.tokenId],
            set: {
              sloplingPaidThrough: unixSecondsToDate(args.paidThrough),
              sloplingImmortal: false,
              updatedAt: new Date(),
            },
          });
        changed = true;
        break;
      case "Immortalized":
        await db
          .insert(indexedNftTokens)
          .values({
            collection: "sloplings",
            tokenId,
            sloplingImmortal: true,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [indexedNftTokens.collection, indexedNftTokens.tokenId],
            set: {
              sloplingImmortal: true,
              updatedAt: new Date(),
            },
          });
        changed = true;
        break;
    }
  }
  return changed;
}

async function syncSlopPackLifecycleLogs(client: PublicClient, safeLatest: bigint): Promise<void> {
  const collection = INDEXED_NFT_COLLECTIONS.find((item) => item.slug === "slop-packs");
  if (!collection) return;

  const stateRow = await ensureIndexedNftCollectionState(collection);
  const startFrom = env.START_BLOCK ?? collection.startBlock;
  let cursor = stateRow.extendedLastIndexedBlock;
  let from = cursor === 0n ? startFrom : cursor + 1n;
  if (from > safeLatest) return;

  const range = env.LOG_RANGE;
  while (from <= safeLatest) {
    const to = from + range - 1n > safeLatest ? safeLatest : from + range - 1n;
    const logs = await client.getLogs({
      address: CONTRACTS.slopPacksSeasonController,
      fromBlock: from,
      toBlock: to,
    });

    if (await processSlopPackLifecycleLogs(client, sortLogs(logs))) {
      await bumpApiCacheVersion(INDEXED_NFT_CACHE_SCOPE);
    }

    if (cursor < to) cursor = to;
    await db
      .update(indexedNftCollectionState)
      .set({ extendedLastIndexedBlock: cursor, updatedAt: new Date() })
      .where(eq(indexedNftCollectionState.collection, collection.slug));

    from = to + 1n;
  }
}

async function processSlopPackLifecycleLogs(client: PublicClient, logs: Log[]): Promise<boolean> {
  let changed = false;
  for (const log of logs) {
    if (!log.blockNumber || log.logIndex == null || !log.transactionHash) continue;
    const decoded = decodeOptionalEvent(log, seasonOneControllerAbi);
    if (!decoded) continue;

    const args = decoded.args as {
      packTokenId?: bigint;
      beneficiary?: `0x${string}`;
      entropyBlock?: bigint;
      chosen?: bigint;
      position?: bigint;
      nftContract?: `0x${string}`;
      tokenId?: bigint;
    };
    if (args.packTokenId == null || args.packTokenId > BigInt(Number.MAX_SAFE_INTEGER)) continue;
    const tokenId = Number(args.packTokenId);

    switch (decoded.eventName) {
      case "OpenRequested":
        await db
          .insert(indexedNftTokens)
          .values({
            collection: "slop-packs",
            tokenId,
            packRequestStatus: 1,
            packEntropyBlock: args.entropyBlock ?? null,
            packBeneficiary: args.beneficiary?.toLowerCase() ?? null,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [indexedNftTokens.collection, indexedNftTokens.tokenId],
            set: {
              packRequestStatus: 1,
              packEntropyBlock: args.entropyBlock ?? null,
              packBeneficiary: args.beneficiary?.toLowerCase() ?? null,
              updatedAt: new Date(),
            },
          });
        changed = true;
        break;
      case "OpenSettled":
        await db
          .insert(indexedNftTokens)
          .values({
            collection: "slop-packs",
            tokenId,
            packRequestStatus: 2,
            packBeneficiary: args.beneficiary?.toLowerCase() ?? null,
            packChosen: args.chosen ?? null,
            packPosition: args.position ?? null,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [indexedNftTokens.collection, indexedNftTokens.tokenId],
            set: {
              packRequestStatus: 2,
              packBeneficiary: args.beneficiary?.toLowerCase() ?? null,
              packChosen: args.chosen ?? null,
              packPosition: args.position ?? null,
              updatedAt: new Date(),
            },
          });
        changed = true;
        break;
      case "PackOpened": {
        const blockTimestamp = await blockTime(client, log.blockNumber);
        await db
          .insert(indexedNftTokens)
          .values({
            collection: "slop-packs",
            tokenId,
            packRequestStatus: 3,
            packBeneficiary: args.beneficiary?.toLowerCase() ?? null,
            packOpenedNftContract: args.nftContract?.toLowerCase() ?? null,
            packOpenedTokenId: args.tokenId?.toString() ?? null,
            packOpenedAtBlock: log.blockNumber,
            packOpenedAtLogIndex: log.logIndex,
            packOpenedTxHash: log.transactionHash,
            packOpenedAtTimestamp: blockTimestamp,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [indexedNftTokens.collection, indexedNftTokens.tokenId],
            set: {
              packRequestStatus: 3,
              packBeneficiary: args.beneficiary?.toLowerCase() ?? null,
              packOpenedNftContract: args.nftContract?.toLowerCase() ?? null,
              packOpenedTokenId: args.tokenId?.toString() ?? null,
              packOpenedAtBlock: log.blockNumber,
              packOpenedAtLogIndex: log.logIndex,
              packOpenedTxHash: log.transactionHash,
              packOpenedAtTimestamp: blockTimestamp,
              updatedAt: new Date(),
            },
          });
        changed = true;
        break;
      }
    }
  }
  return changed;
}

function sortLogs(logs: Log[]): Log[] {
  return [...logs].sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) {
      if (a.blockNumber == null) return 1;
      if (b.blockNumber == null) return -1;
      return a.blockNumber < b.blockNumber ? -1 : 1;
    }
    if (a.logIndex == null && b.logIndex == null) return 0;
    if (a.logIndex == null) return 1;
    if (b.logIndex == null) return -1;
    return a.logIndex - b.logIndex;
  });
}

async function blockTime(client: PublicClient, blockNumber: bigint): Promise<Date> {
  const key = blockNumber.toString();
  const cached = blockTimeCache.get(key);
  if (cached) return cached;
  const block = await client.getBlock({ blockNumber });
  const ts = new Date(Number(block.timestamp) * 1000);
  blockTimeCache.set(key, ts);
  if (blockTimeCache.size > 5_000) {
    const first = blockTimeCache.keys().next().value;
    if (first) blockTimeCache.delete(first);
  }
  return ts;
}

function decodeOptionalEvent(log: Log, abi: typeof erc721OwnershipAbi | typeof seasonOneControllerAbi | typeof sloplingsAbi) {
  try {
    return decodeEventLog({
      abi,
      data: log.data,
      topics: log.topics,
      strict: false,
    });
  } catch {
    return null;
  }
}

function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

function unixSecondsToDate(seconds: bigint): Date {
  return new Date(Number(seconds) * 1000);
}
