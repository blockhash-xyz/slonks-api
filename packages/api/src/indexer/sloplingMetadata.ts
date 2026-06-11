import { and, eq } from "drizzle-orm";
import {
  SLOPLING_MAX_SUPPLY,
  SLOPLING_METADATA_BASE,
  type IndexedNftCollectionSlug,
} from "../chain/contracts.ts";
import { bumpApiCacheVersion, INDEXED_NFT_CACHE_SCOPE } from "../api/stateCache.ts";
import { db } from "../db/client.ts";
import { indexedNftAttributes, indexedNftTokens } from "../db/schema.ts";

type NftAttribute = { trait_type: string; value: string };
type SloplingMetadata = {
  name?: string;
  image?: string;
  attributes?: Array<{ trait_type?: unknown; value?: unknown }>;
  [key: string]: unknown;
};

const COLLECTION: IndexedNftCollectionSlug = "sloplings";
const FIRST_TOKEN_ID = 1;
const LAST_TOKEN_ID = SLOPLING_MAX_SUPPLY;
const CONCURRENCY = 8;

export async function backfillSloplingMetadata(): Promise<void> {
  const missing = await missingSloplingMetadataIds();
  if (missing.length > 0) {
    console.log(`slopling metadata backfill: ${missing.length} tokens missing`);
    let completed = 0;
    await runConcurrent(missing, CONCURRENCY, async (tokenId) => {
      await fetchAndStoreSloplingMetadata(tokenId);
      completed += 1;
      if (completed % 250 === 0 || completed === missing.length) {
        console.log(`slopling metadata backfill: ${completed}/${missing.length}`);
      }
    });
    await bumpApiCacheVersion(INDEXED_NFT_CACHE_SCOPE);
  }
}

async function missingSloplingMetadataIds(): Promise<number[]> {
  const rows = await db
    .select({ tokenId: indexedNftAttributes.tokenId })
    .from(indexedNftAttributes)
    .where(eq(indexedNftAttributes.collection, COLLECTION))
    .groupBy(indexedNftAttributes.tokenId);

  const present = new Set(rows.map((row) => row.tokenId));
  const missing: number[] = [];
  for (let tokenId = FIRST_TOKEN_ID; tokenId <= LAST_TOKEN_ID; tokenId += 1) {
    if (!present.has(tokenId)) missing.push(tokenId);
  }
  return missing;
}

async function fetchAndStoreSloplingMetadata(tokenId: number): Promise<void> {
  const tokenUri = `${SLOPLING_METADATA_BASE}${tokenId}`;
  const res = await fetch(tokenUri);
  if (!res.ok) {
    throw new Error(`failed to fetch Slopling metadata ${tokenId}: ${res.status}`);
  }

  const metadata = (await res.json()) as SloplingMetadata;
  const staticAttributes = normalizeStaticAttributes(metadata.attributes ?? []);
  await db.transaction(async (tx) => {
    await tx
      .insert(indexedNftTokens)
      .values({
        collection: COLLECTION,
        tokenId,
        tokenUri,
        name: typeof metadata.name === "string" ? metadata.name : null,
        image: typeof metadata.image === "string" ? metadata.image : null,
        metadataJson: metadata,
        attributesJson: staticAttributes,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [indexedNftTokens.collection, indexedNftTokens.tokenId],
        set: {
          tokenUri,
          name: typeof metadata.name === "string" ? metadata.name : null,
          image: typeof metadata.image === "string" ? metadata.image : null,
          metadataJson: metadata,
          attributesJson: staticAttributes,
          updatedAt: new Date(),
        },
      });

    await tx
      .delete(indexedNftAttributes)
      .where(and(eq(indexedNftAttributes.collection, COLLECTION), eq(indexedNftAttributes.tokenId, tokenId)));

    if (staticAttributes.length > 0) {
      await tx.insert(indexedNftAttributes).values(
        staticAttributes.map((attribute) => ({
          collection: COLLECTION,
          tokenId,
          traitType: attribute.trait_type,
          value: attribute.value,
        })),
      );
    }
  });
}

function normalizeStaticAttributes(attributes: NonNullable<SloplingMetadata["attributes"]>): NftAttribute[] {
  return attributes
    .map((attribute) => ({
      trait_type: String(attribute.trait_type ?? ""),
      value: String(attribute.value ?? ""),
    }))
    .filter((attribute) => attribute.trait_type !== "" && attribute.value !== "")
    .filter((attribute) => attribute.trait_type.toLowerCase() !== "state");
}

async function runConcurrent<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      await worker(items[index] as T);
    }
  });
  await Promise.all(workers);
}
