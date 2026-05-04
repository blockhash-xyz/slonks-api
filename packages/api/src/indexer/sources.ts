// One-time precompute of the 10k canonical source punks. After this completes,
// post-reveal token snapshots can be served entirely from Postgres.
//
// The work is durable: each row is upserted independently so we can crash and
// resume. We pace requests to be polite to the RPC.

import { eq, sql } from "drizzle-orm";
import { CONTRACTS, MAX_SUPPLY } from "../chain/contracts.ts";
import { publicClient, callRenderSourcePixels } from "../chain/client.ts";
import {
  cryptoPunksDataAbi,
  slonksImageModelAbi,
} from "../chain/abis.ts";
import { db } from "../db/client.ts";
import { collectionState, sourcePunks } from "../db/schema.ts";
import { parseAttributesText } from "@blockhash/slonks-core/attributes";
import { diffPixels } from "@blockhash/slonks-core/diff";

const BATCH_SIZE = 8;

export async function backfillSourcePunks(): Promise<void> {
  let pass = 0;
  while (true) {
    pass++;
    const have = await sourcesCount();
    if (have >= MAX_SUPPLY) {
      console.log(`source punks: complete (${have}/${MAX_SUPPLY})`);
      await touchSourcesCount(have);
      return;
    }

    console.log(`source punks: have ${have}/${MAX_SUPPLY}, starting pass ${pass}`);

    // Scan 0..9999, skipping ids we've already stored. Rebuild this set each
    // pass so transient RPC misses are retried without a process restart.
    const presentRows = await db.select({ id: sourcePunks.sourceId }).from(sourcePunks);
    const present = new Set(presentRows.map((r) => r.id));

    for (let id = 0; id < MAX_SUPPLY; id += BATCH_SIZE) {
      const ids: number[] = [];
      for (let j = 0; j < BATCH_SIZE && id + j < MAX_SUPPLY; j++) {
        const sid = id + j;
        if (!present.has(sid)) ids.push(sid);
      }
      if (ids.length === 0) continue;

      await Promise.all(ids.map(processOneSource));
      if (id % 200 === 0) {
        const count = await sourcesCount();
        await touchSourcesCount(count);
        console.log(`source punks: ${count}/${MAX_SUPPLY}`);
      }
    }

    const final = await sourcesCount();
    await touchSourcesCount(final);
    if (final < MAX_SUPPLY) {
      console.warn(`source punks: ${MAX_SUPPLY - final} missing after pass ${pass}, retrying shortly`);
      await sleep(30_000);
    }
  }
}

async function processOneSource(sourceId: number): Promise<void> {
  try {
    const client = publicClient();

    // Read the cheap stuff via multicall, then the heavy renderSourcePixels via eth_call.
    const [punkImageR, punkAttrsR, embeddingR] = await client.multicall({
      allowFailure: true,
      contracts: [
        {
          address: CONTRACTS.cryptoPunksData,
          abi: cryptoPunksDataAbi,
          functionName: "punkImage",
          args: [sourceId & 0xffff],
        },
        {
          address: CONTRACTS.cryptoPunksData,
          abi: cryptoPunksDataAbi,
          functionName: "punkAttributes",
          args: [sourceId & 0xffff],
        },
        {
          address: CONTRACTS.imageModel,
          abi: slonksImageModelAbi,
          functionName: "sourceEmbedding",
          args: [BigInt(sourceId)],
        },
      ],
    });

    if (
      punkImageR.status !== "success" ||
      punkAttrsR.status !== "success" ||
      embeddingR.status !== "success"
    ) {
      console.warn(`source ${sourceId}: multicall failed, skipping for retry`);
      return;
    }

    const originalRgba = hexToBytes(punkImageR.result as `0x${string}`);
    const attributesText = punkAttrsR.result as string;
    const sourceEmbedding = hexToBytes(embeddingR.result as `0x${string}`);

    const generatedBytes = await callRenderSourcePixels(sourceId);
    if (!generatedBytes) {
      console.warn(`source ${sourceId}: renderSourcePixels failed, skipping for retry`);
      return;
    }

    const { mask, count, slopLevel } = diffPixels(generatedBytes, originalRgba);
    const { attributes, punkType } = parseAttributesText(attributesText);

    await db
      .insert(sourcePunks)
      .values({
        sourceId,
        attributesText,
        attributesJson: attributes,
        punkType,
        originalRgba,
        sourceEmbedding,
        generatedPixels: generatedBytes,
        baseDiffMask: mask,
        baseDiffCount: count,
        baseSlopLevel: slopLevel,
      })
      .onConflictDoNothing({ target: sourcePunks.sourceId });
  } catch (err) {
    console.warn(`source ${sourceId} error:`, err);
  }
}

async function sourcesCount(): Promise<number> {
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(sourcePunks);
  return row?.count ?? 0;
}

async function touchSourcesCount(count: number): Promise<void> {
  await db
    .update(collectionState)
    .set({ sourcesPrecomputed: count, updatedAt: new Date() })
    .where(eq(collectionState.id, 1));
}

function hexToBytes(hex: `0x${string}`): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error(`invalid hex length: ${clean.length}`);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}
