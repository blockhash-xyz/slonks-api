#!/usr/bin/env bun

import { blendEmbeddings, blendEmbeddingsInto } from "../slonks/blend.ts";
import { hexToBytes } from "../slonks/hex.ts";
import { diffRenderedEmbeddingLocal } from "../slonks/imageModel.ts";
import {
  DEFAULT_API,
  getJson,
  logStatus as writeLogStatus,
  normalizeApiUrl,
  parseNonNegativeInt,
  parseNonNegativeNumber,
  parsePositiveInt,
  parseRatio,
  requireValue,
  sleep,
} from "./common.ts";

type TokenSnapshot = {
  tokenId: string;
  exists: boolean;
  owner: string | null;
  sourceId: number | null;
  mergeLevel: number;
  embedding: `0x${string}` | null;
  originalRgba: `0x${string}` | null;
  diffCount: number | null;
  slopLevel: number | null;
};

type ListingInfo = {
  tokenId: number;
  priceWei: string | null;
  priceEth: number | null;
  currency: string | null;
  orderHash: string;
};

type PlannerToken = {
  snapshot: TokenSnapshot;
  source: "owned" | "listed";
  listing?: ListingInfo;
};

type ListingsResponse = {
  enabled: boolean;
  error?: string;
  reason?: string;
  next?: string | null;
  listings: Array<{
    tokenId: string;
    priceWei: string | null;
    priceEth: number | null;
    currency: string | null;
    orderHash: string;
  }>;
};

type PlanStep = {
  survivor: string;
  donor: string;
  result: string;
  resultLevel: number;
  diffCount: number;
  slopLevel: number;
};

type State = {
  label: string;
  mask: bigint;
  level: number;
  anchorTokenId: number;
  tokenIds: number[];
  embedding: Uint8Array;
  embeddingKey: string;
  originalRgba: Uint8Array;
  diffCount: number;
  slopLevel: number;
  steps: PlanStep[];
  listedTokens: ListingInfo[];
};

type Args = {
  owner: string;
  api: string;
  mode: "beam" | "deep-l2";
  includeListings: boolean;
  listingDelayMs: number;
  maxListingPages: number;
  maxListingPriceEth: number | null;
  maxListingFloorMultiple: number | null;
  maxTotalListingPriceEth: number | null;
  maxLevel: number;
  beamSize: number;
  l1Frontier: number;
  l2Budget: number;
  perAnchor: number;
  diversity: number;
  refineL2: number;
  top: number;
  json: boolean;
};

const LISTING_PAGE_LIMIT = 100;
const DEFAULT_LISTING_DELAY_MS = 1_000;
const LISTING_PROGRESS_EVERY = 5;
const DEFAULT_L1_FRONTIER = 512;
const DEFAULT_L2_BUDGET = 1_000_000;

export async function runSlopPlanner(argv = process.argv.slice(2)) {
  const args = parseArgs(normalizePlannerArgs(argv));
  if (!args.owner) {
    usage();
    process.exit(1);
  }

  const started = Date.now();
  logStatus(args, `Fetching Slonks for ${args.owner} from ${args.api}`);
  const plannerTokens = await fetchPlannerTokens(args);
  const baseStates = snapshotsToStates(plannerTokens.tokens);
  if (baseStates.length === 0) throw new Error("no plannable tokens found");

  const currentBest = [...baseStates].sort(compareStates)[0]!;
  const listingCapSummary = plannerTokens.listingCapped ? ", capped" : "";
  const listingPriceSummary =
    plannerTokens.listingPriceCapEth == null
      ? ""
      : `, floor ${plannerTokens.listingFloorPriceEth} ETH, cap ${plannerTokens.listingPriceCapEth} ETH`;
  const listedSummary = args.includeListings
    ? ` + ${plannerTokens.addedListingCount} listed tokens (${plannerTokens.listingCount} listings across ${plannerTokens.listingPages} pages${listingCapSummary}${listingPriceSummary})`
    : "";
  logStatus(
    args,
    `Loaded ${plannerTokens.ownedCount} owned tokens${listedSummary}. Search pool: ${baseStates.length}. Current best: #${currentBest.anchorTokenId} L${currentBest.level} slop ${currentBest.slopLevel} diff ${currentBest.diffCount}`,
  );

  const result = args.mode === "deep-l2" ? planDeepL2(baseStates, args) : plan(baseStates, args);
  const elapsed = ((Date.now() - started) / 1000).toFixed(2);

  if (args.json) {
    console.log(JSON.stringify({ ...result, elapsedSeconds: Number(elapsed) }, null, 2));
    return;
  }

  console.log("");
  console.log("Search summary");
  for (const row of result.levels) {
    console.log(
      `  L${row.inputLevel} -> L${row.outputLevel}: ${row.poolSize} states, ${row.generated} previews, kept ${row.kept}`,
    );
  }
  for (const row of result.refinements) {
    console.log(
      `  refine L${row.level}: ${row.survivors} survivor branches x ${row.donors} donor branches, ${row.generated} previews, kept ${row.kept}`,
    );
  }

  console.log("");
  console.log(`Top ${result.best.length} generated paths`);
  for (let i = 0; i < result.best.length; i++) {
    const state = result.best[i]!;
    console.log("");
    console.log(
      `${i + 1}. ${state.label}: L${state.level}, slop ${state.slopLevel}, diff ${state.diffCount}, survivor #${state.survivorTokenId}, uses ${state.tokenIds.map((id) => `#${id}`).join(", ")}`,
    );
    if (state.listedTokens.length > 0) {
      const total = totalListingPriceEth(state.listedTokens);
      const totalLabel = total == null ? "unknown total" : `${total} ETH total`;
      console.log(`   buy listed (${totalLabel}): ${state.listedTokens.map(formatListing).join(", ")}`);
    }
    for (const [stepIndex, step] of state.steps.entries()) {
      console.log(
        `   ${stepIndex + 1}. ${step.survivor} <- ${step.donor} => ${step.result} (L${step.resultLevel}, slop ${step.slopLevel}, diff ${step.diffCount})`,
      );
    }
  }

  console.log("");
  console.log(`Finished in ${elapsed}s`);
}

function logStatus(args: Args, message: string): void {
  writeLogStatus(args.json, message);
}

function plan(baseStates: State[], args: Args) {
  const statesByLevel = new Map<number, State[]>();
  const allLevel1States: State[] = [];
  const collectAllLevel1States = args.refineL2 > 0 && args.maxLevel >= 2;
  for (const state of baseStates) {
    const list = statesByLevel.get(state.level) ?? [];
    list.push(state);
    statesByLevel.set(state.level, list);
    if (collectAllLevel1States && state.level === 1) allLevel1States.push(state);
  }

  const generatedStates: State[] = [];
  const levels: Array<{ inputLevel: number; outputLevel: number; poolSize: number; generated: number; kept: number }> = [];
  const refinements: Array<{ level: number; survivors: number; donors: number; generated: number; kept: number }> = [];
  let nextId = 0;

  for (let level = 0; level < args.maxLevel; level++) {
    const pool = statesByLevel.get(level) ?? [];
    if (pool.length < 2) continue;

    const candidates: State[] = [];
    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        const a = pool[i]!;
        const b = pool[j]!;
        if ((a.mask & b.mask) !== 0n) continue;
        const ab = mergeStates(a, b, ++nextId);
        if (stateWithinBudget(ab, args)) candidates.push(ab);
        const ba = mergeStates(b, a, ++nextId);
        if (stateWithinBudget(ba, args)) candidates.push(ba);
      }
    }

    const selected = selectBeam(candidates, args.beamSize, args.perAnchor, args.diversity);
    generatedStates.push(...selected);
    if (collectAllLevel1States && level === 0) {
      for (const candidate of candidates) allLevel1States.push(candidate);
    }

    const outputLevel = level + 1;
    const existing = statesByLevel.get(outputLevel) ?? [];
    const keepCount = Math.max(args.beamSize, existing.length);
    statesByLevel.set(outputLevel, selectBeam([...existing, ...selected], keepCount, args.perAnchor, args.diversity));

    levels.push({
      inputLevel: level,
      outputLevel,
      poolSize: pool.length,
      generated: candidates.length,
      kept: selected.length,
    });

    if (collectAllLevel1States && outputLevel === 2 && allLevel1States.length > 1) {
      const refined = refineLevel2(allLevel1States, args, () => ++nextId);
      generatedStates.push(...refined.states);
      refinements.push({
        level: 2,
        survivors: refined.survivors,
        donors: refined.donors,
        generated: refined.generated,
        kept: refined.states.length,
      });

      const refinedExisting = statesByLevel.get(outputLevel) ?? [];
      const refinedKeepCount = Math.max(args.beamSize, refinedExisting.length);
      statesByLevel.set(
        outputLevel,
        selectBeam([...refinedExisting, ...refined.states], refinedKeepCount, args.perAnchor, args.diversity),
      );
    }
  }

  return {
    ownerTokenCount: baseStates.length,
    levels,
    refinements,
    best: selectBeam(generatedStates, args.top, 0, 0).map(serializeState),
  };
}

function planDeepL2(baseStates: State[], args: Args) {
  const level0States = baseStates.filter((state) => state.level === 0);
  const existingLevel1States = baseStates.filter((state) => state.level === 1);
  const generatedLevel1States: State[] = [];
  const allLevel1States: State[] = [...existingLevel1States];
  let nextId = 0;

  for (let i = 0; i < level0States.length; i++) {
    for (let j = i + 1; j < level0States.length; j++) {
      const a = level0States[i]!;
      const b = level0States[j]!;
      const ab = mergeStates(a, b, ++nextId);
      if (stateWithinBudget(ab, args)) {
        generatedLevel1States.push(ab);
        allLevel1States.push(ab);
      }
      const ba = mergeStates(b, a, ++nextId);
      if (stateWithinBudget(ba, args)) {
        generatedLevel1States.push(ba);
        allLevel1States.push(ba);
      }
    }
  }

  const l1Frontier = selectBeam(allLevel1States, args.l1Frontier, args.perAnchor, args.diversity);
  const donors = uniqueDonorStates(allLevel1States);
  const topL2 = new TopStates(Math.max(args.beamSize, args.top * 16));
  const scratch = new Uint8Array(l1Frontier[0]?.embedding.length ?? 0);
  const possibleBranches = l1Frontier.length * donors.length;
  const budgetLimit = args.l2Budget > 0 ? args.l2Budget : Number.POSITIVE_INFINITY;
  const progressEvery = 500_000;
  let branchesVisited = 0;
  let generated = 0;
  let budgetHit = false;

  scan: for (const survivor of l1Frontier) {
    for (const donor of donors) {
      branchesVisited++;
      if (survivor === donor || (survivor.mask & donor.mask) !== 0n) continue;
      if (generated >= budgetLimit) {
        budgetHit = true;
        break scan;
      }

      generated++;
      if (generated % progressEvery === 0) {
        logStatus(args, `Deep L2 scanned ${generated} valid previews (${branchesVisited}/${possibleBranches} branches visited)`);
      }

      blendEmbeddingsInto(survivor.embedding, donor.embedding, scratch);
      const diff = diffRenderedEmbeddingLocal(scratch, survivor.originalRgba);
      if (!topL2.wouldKeep(survivor, donor, diff.count, diff.slopLevel)) continue;

      const state = mergeStatesWithDiff(survivor, donor, ++nextId, scratch.slice(), diff);
      if (stateWithinBudget(state, args)) topL2.add(state);
    }
  }

  const l2States = topL2.values();
  return {
    mode: "deep-l2",
    ownerTokenCount: baseStates.length,
    levels: [
      {
        inputLevel: 0,
        outputLevel: 1,
        poolSize: level0States.length,
        generated: generatedLevel1States.length,
        kept: l1Frontier.length,
        existingLevel1: existingLevel1States.length,
        totalLevel1: allLevel1States.length,
      },
    ],
    refinements: [
      {
        level: 2,
        survivors: l1Frontier.length,
        donors: donors.length,
        possible: possibleBranches,
        visited: branchesVisited,
        generated,
        kept: l2States.length,
        budget: args.l2Budget,
        budgetHit,
      },
    ],
    bestL1: selectBeam(generatedLevel1States, args.top, 0, 0).map(serializeState),
    best: selectBeam(l2States, args.top, 0, 0).map(serializeState),
  };
}

function mergeStates(survivor: State, donor: State, id: number): State {
  const embedding = blendEmbeddings(survivor.embedding, donor.embedding);
  const diff = diffRenderedEmbeddingLocal(embedding, survivor.originalRgba);
  const label = `m${id}`;
  return {
    label,
    mask: survivor.mask | donor.mask,
    level: survivor.level + 1,
    anchorTokenId: survivor.anchorTokenId,
    tokenIds: [...survivor.tokenIds, ...donor.tokenIds].sort((a, b) => a - b),
    embedding,
    embeddingKey: embeddingKey(embedding),
    originalRgba: survivor.originalRgba,
    diffCount: diff.count,
    slopLevel: diff.slopLevel,
    listedTokens: mergeListings(survivor.listedTokens, donor.listedTokens),
    steps: [
      ...survivor.steps,
      ...donor.steps,
      {
        survivor: survivor.label,
        donor: donor.label,
        result: label,
        resultLevel: survivor.level + 1,
        diffCount: diff.count,
        slopLevel: diff.slopLevel,
      },
    ],
  };
}

function refineLevel2(allLevel1States: State[], args: Args, nextId: () => number) {
  const survivors = selectBeam(allLevel1States, args.refineL2, args.perAnchor, args.diversity);
  const donors = uniqueDonorStates(allLevel1States);
  const top = new TopStates(Math.max(args.beamSize, args.top * 16));
  const scratch = new Uint8Array(survivors[0]?.embedding.length ?? 0);
  let generated = 0;
  let seen = 0;
  const progressEvery = 500_000;
  const total = survivors.length * donors.length;

  for (const survivor of survivors) {
    for (const donor of donors) {
      seen++;
      if (survivor === donor || (survivor.mask & donor.mask) !== 0n) continue;
      generated++;
      if (!args.json && generated % progressEvery === 0) {
        console.error(`  refine L2 scanned ${generated} valid previews (${seen}/${total} branches checked)`);
      }
      blendEmbeddingsInto(survivor.embedding, donor.embedding, scratch);
      const diff = diffRenderedEmbeddingLocal(scratch, survivor.originalRgba);
      if (!top.wouldKeep(survivor, donor, diff.count, diff.slopLevel)) continue;
      const state = mergeStatesWithDiff(survivor, donor, nextId(), scratch.slice(), diff);
      if (stateWithinBudget(state, args)) top.add(state);
    }
  }

  return {
    states: top.values(),
    survivors: survivors.length,
    donors: donors.length,
    generated,
  };
}

function mergeStatesWithDiff(
  survivor: State,
  donor: State,
  id: number,
  embedding: Uint8Array,
  diff: { count: number; slopLevel: number },
): State {
  const label = `m${id}`;
  return {
    label,
    mask: survivor.mask | donor.mask,
    level: survivor.level + 1,
    anchorTokenId: survivor.anchorTokenId,
    tokenIds: [...survivor.tokenIds, ...donor.tokenIds].sort((a, b) => a - b),
    embedding,
    embeddingKey: embeddingKey(embedding),
    originalRgba: survivor.originalRgba,
    diffCount: diff.count,
    slopLevel: diff.slopLevel,
    listedTokens: mergeListings(survivor.listedTokens, donor.listedTokens),
    steps: [
      ...survivor.steps,
      ...donor.steps,
      {
        survivor: survivor.label,
        donor: donor.label,
        result: label,
        resultLevel: survivor.level + 1,
        diffCount: diff.count,
        slopLevel: diff.slopLevel,
      },
    ],
  };
}

function uniqueDonorStates(states: State[]): State[] {
  const out = new Map<string, State>();
  for (const state of states) {
    const key = `${state.level}:${state.mask.toString(16)}:${state.embeddingKey}`;
    const existing = out.get(key);
    if (!existing || compareStates(state, existing) < 0) out.set(key, state);
  }
  return [...out.values()].sort(compareStates);
}

function snapshotsToStates(tokens: PlannerToken[]): State[] {
  const states: State[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    const snapshot = token.snapshot;
    if (!snapshot.exists || !snapshot.embedding || !snapshot.originalRgba) continue;
    const tokenId = Number(snapshot.tokenId);
    states.push({
      label: `#${tokenId}`,
      mask: 1n << BigInt(i),
      level: snapshot.mergeLevel,
      anchorTokenId: tokenId,
      tokenIds: [tokenId],
      embedding: hexToBytes(snapshot.embedding),
      embeddingKey: embeddingKey(snapshot.embedding),
      originalRgba: hexToBytes(snapshot.originalRgba),
      diffCount: snapshot.diffCount ?? 0,
      slopLevel: snapshot.slopLevel ?? 0,
      listedTokens: token.source === "listed" && token.listing ? [token.listing] : [],
      steps: [],
    });
  }
  return states;
}

async function fetchPlannerTokens(args: Args): Promise<{
  tokens: PlannerToken[];
  ownedCount: number;
  listingCount: number;
  addedListingCount: number;
  listingPages: number;
  listingCapped: boolean;
  listingFloorPriceEth: number | null;
  listingPriceCapEth: number | null;
}> {
  const owned = await fetchOwnedSnapshots(args.api, args.owner);
  const byId = new Map<number, PlannerToken>();
  for (const snapshot of owned) {
    byId.set(Number(snapshot.tokenId), { snapshot, source: "owned" });
  }

  let listingCount = 0;
  let addedListingCount = 0;
  let listingPages = 0;
  let listingCapped = false;
  let listingFloorPriceEth: number | null = null;
  let listingPriceCapEth: number | null = null;
  if (args.includeListings) {
    const listings = await fetchListings(args);
    listingCount = listings.items.length;
    listingPages = listings.pages;
    listingCapped = listings.capped;
    listingFloorPriceEth = listings.floorPriceEth;
    listingPriceCapEth = listings.priceCapEth;
    const snapshots = await fetchSnapshotsByIds(args.api, listings.items.map((listing) => listing.tokenId));
    const snapshotsById = new Map(snapshots.map((snapshot) => [Number(snapshot.tokenId), snapshot]));

    for (const listing of listings.items) {
      if (byId.has(listing.tokenId)) continue;
      const snapshot = snapshotsById.get(listing.tokenId);
      if (!snapshot?.exists) continue;
      byId.set(listing.tokenId, { snapshot, source: "listed", listing });
      addedListingCount++;
    }
  }

  return {
    tokens: [...byId.values()].sort((a, b) => Number(a.snapshot.tokenId) - Number(b.snapshot.tokenId)),
    ownedCount: owned.length,
    listingCount,
    addedListingCount,
    listingPages,
    listingCapped,
    listingFloorPriceEth,
    listingPriceCapEth,
  };
}

async function fetchOwnedSnapshots(api: string, owner: string): Promise<TokenSnapshot[]> {
  const owned = await getJson<{ tokens: Array<{ tokenId: number }> }>(`${api}/owners/${owner}/tokens`);
  return fetchSnapshotsByIds(api, owned.tokens.map((token) => token.tokenId));
}

async function fetchSnapshotsByIds(api: string, ids: number[]): Promise<TokenSnapshot[]> {
  const out: TokenSnapshot[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    if (chunk.length === 0) continue;
    const data = await getJson<{ items: TokenSnapshot[] }>(`${api}/tokens?ids=${chunk.join(",")}`);
    out.push(...data.items);
  }
  return out.sort((a, b) => Number(a.tokenId) - Number(b.tokenId));
}

async function fetchListings(args: Args): Promise<{
  items: ListingInfo[];
  pages: number;
  capped: boolean;
  floorPriceEth: number | null;
  priceCapEth: number | null;
}> {
  const byTokenId = new Map<number, ListingInfo>();
  let cursor: string | null = null;
  let pages = 0;
  let capped = false;
  const seenCursors = new Set<string>();

  for (;;) {
    const url = new URL(`${args.api}/listings`);
    url.searchParams.set("limit", String(LISTING_PAGE_LIMIT));
    if (cursor) url.searchParams.set("cursor", cursor);

    const data = await getListingsPage(url.toString(), args);
    pages++;

    if (data.enabled === false) throw new Error(data.reason || "listings are not enabled");
    if (data.error && data.listings.length === 0) throw new Error(data.error);

    for (const listing of data.listings) {
      const tokenId = Number(listing.tokenId);
      if (!Number.isInteger(tokenId) || tokenId < 0 || tokenId >= 10_000) continue;
      const normalized = { ...listing, tokenId };
      const existing = byTokenId.get(tokenId);
      if (!existing || isCheaperListing(normalized, existing)) byTokenId.set(tokenId, normalized);
    }

    if (pages % LISTING_PROGRESS_EVERY === 0) {
      logStatus(args, `Fetched ${byTokenId.size} unique listed tokens across ${pages} listing pages`);
    }

    if (!data.next) break;
    if (args.maxListingPages > 0 && pages >= args.maxListingPages) {
      capped = true;
      break;
    }
    if (seenCursors.has(data.next)) {
      throw new Error("listings cursor repeated; aborting to avoid an endless pagination loop");
    }
    seenCursors.add(data.next);
    cursor = data.next;
    if (args.listingDelayMs > 0) await sleep(args.listingDelayMs);
  }

  const allItems = [...byTokenId.values()];
  const floorPriceEth = listingFloorPriceEth(allItems);
  const priceCapEth = listingPriceCapEth(args, floorPriceEth);
  const items = allItems
    .filter((listing) => listingWithinBudget(listing, priceCapEth))
    .sort((a, b) => a.tokenId - b.tokenId);

  return {
    items,
    pages,
    capped,
    floorPriceEth,
    priceCapEth,
  };
}

async function getListingsPage(url: string, args: Args): Promise<ListingsResponse> {
  const attempts = 6;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const data = await getJson<ListingsResponse>(url);
    const rateLimited = data.error?.includes("429") || data.error?.toLowerCase().includes("rate");
    if (!rateLimited || attempt === attempts - 1) return data;
    const waitMs = Math.max(args.listingDelayMs, 1_500 * 2 ** attempt);
    logStatus(args, `Listings API was rate limited; waiting ${Math.round(waitMs / 1000)}s before retry ${attempt + 2}/${attempts}`);
    await sleep(waitMs);
  }
  throw new Error("failed to fetch listings");
}

function selectBeam(states: State[], limit: number, perAnchor: number, diversity = 0): State[] {
  const sorted = [...states].sort(compareStates);
  if (perAnchor <= 0 && diversity <= 0) return sorted.slice(0, limit);

  const picked: State[] = [];
  const seen = new Set<string>();
  const scoreLimit = Math.max(0, Math.min(limit, Math.ceil(limit * (1 - diversity))));

  pickScored(sorted, picked, seen, scoreLimit, perAnchor);

  if (diversity > 0 && picked.length < limit) {
    const buckets = new Map<string, State>();
    for (const state of sorted) {
      const key = stateKey(state);
      if (seen.has(key)) continue;
      const bucket = embeddingBucketKey(state.embedding);
      const existing = buckets.get(bucket);
      if (!existing || compareStates(state, existing) < 0) buckets.set(bucket, state);
    }
    pickScored([...buckets.values()].sort(compareStates), picked, seen, limit, 0);
  }

  pickScored(sorted, picked, seen, limit, 0);
  return picked;
}

function pickScored(
  sorted: State[],
  picked: State[],
  seen: Set<string>,
  limit: number,
  perAnchor: number,
): void {
  const anchorCounts = new Map<number, number>();
  for (const state of picked) {
    anchorCounts.set(state.anchorTokenId, (anchorCounts.get(state.anchorTokenId) ?? 0) + 1);
  }

  for (const state of sorted) {
    if (picked.length >= limit) break;
    const count = anchorCounts.get(state.anchorTokenId) ?? 0;
    if (perAnchor > 0 && count >= perAnchor) continue;
    const key = stateKey(state);
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(state);
    anchorCounts.set(state.anchorTokenId, count + 1);
  }
}

function compareStates(a: State, b: State): number {
  return (
    b.slopLevel - a.slopLevel ||
    b.diffCount - a.diffCount ||
    b.level - a.level ||
    a.tokenIds.length - b.tokenIds.length ||
    a.anchorTokenId - b.anchorTokenId
  );
}

function stateKey(state: State): string {
  return `${state.level}:${state.anchorTokenId}:${state.mask.toString(16)}:${state.embeddingKey}`;
}

function embeddingKey(embedding: Uint8Array | `0x${string}`): string {
  if (typeof embedding === "string") return embedding.toLowerCase();
  return Array.from(embedding).join(",");
}

function embeddingBucketKey(embedding: Uint8Array): string {
  return Array.from(embedding, (value) => {
    const signed = value >= 128 ? value - 256 : value;
    return Math.trunc(signed / 8);
  }).join(",");
}

function serializeState(state: State) {
  return {
    label: state.label,
    level: state.level,
    survivorTokenId: state.anchorTokenId,
    tokenIds: state.tokenIds,
    diffCount: state.diffCount,
    slopLevel: state.slopLevel,
    listedTokens: state.listedTokens,
    totalListingPriceEth: totalListingPriceEth(state.listedTokens),
    steps: state.steps,
  };
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    owner: "",
    api: DEFAULT_API,
    mode: "beam",
    includeListings: false,
    listingDelayMs: DEFAULT_LISTING_DELAY_MS,
    maxListingPages: 0,
    maxListingPriceEth: null,
    maxListingFloorMultiple: null,
    maxTotalListingPriceEth: null,
    maxLevel: 4,
    beamSize: 32,
    l1Frontier: DEFAULT_L1_FRONTIER,
    l2Budget: DEFAULT_L2_BUDGET,
    perAnchor: 4,
    diversity: 0.25,
    refineL2: 0,
    top: 10,
    json: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = argv[i + 1];
    switch (arg) {
      case "--owner":
        args.owner = requireValue(arg, next);
        i++;
        break;
      case "--api":
        args.api = normalizeApiUrl(requireValue(arg, next));
        i++;
        break;
      case "--mode":
        args.mode = parseMode(requireValue(arg, next), arg);
        i++;
        break;
      case "--include-listings":
        args.includeListings = true;
        break;
      case "--listing-delay-ms":
        args.listingDelayMs = parseNonNegativeInt(requireValue(arg, next), arg);
        i++;
        break;
      case "--max-listing-pages":
        args.includeListings = true;
        args.maxListingPages = parseNonNegativeInt(requireValue(arg, next), arg);
        i++;
        break;
      case "--max-listing-price-eth":
        args.includeListings = true;
        args.maxListingPriceEth = parseNonNegativeNumber(requireValue(arg, next), arg);
        i++;
        break;
      case "--max-listing-floor-multiple":
        args.includeListings = true;
        args.maxListingFloorMultiple = parseNonNegativeNumber(requireValue(arg, next), arg);
        i++;
        break;
      case "--max-total-listing-price-eth":
        args.includeListings = true;
        args.maxTotalListingPriceEth = parseNonNegativeNumber(requireValue(arg, next), arg);
        i++;
        break;
      case "--max-level":
        args.maxLevel = parsePositiveInt(requireValue(arg, next), arg);
        i++;
        break;
      case "--beam-size":
        args.beamSize = parsePositiveInt(requireValue(arg, next), arg);
        i++;
        break;
      case "--l1-frontier":
        args.l1Frontier = parsePositiveInt(requireValue(arg, next), arg);
        i++;
        break;
      case "--l2-budget":
        args.l2Budget = parseNonNegativeInt(requireValue(arg, next), arg);
        i++;
        break;
      case "--per-anchor":
        args.perAnchor = parseNonNegativeInt(requireValue(arg, next), arg);
        i++;
        break;
      case "--diversity":
        args.diversity = parseRatio(requireValue(arg, next), arg);
        i++;
        break;
      case "--refine-l2":
        args.refineL2 = parseNonNegativeInt(requireValue(arg, next), arg);
        i++;
        break;
      case "--top":
        args.top = parsePositiveInt(requireValue(arg, next), arg);
        i++;
        break;
      case "--json":
        args.json = true;
        break;
      case "--help":
      case "-h":
        usage();
        process.exit(0);
      default:
        throw new Error(`unknown argument ${arg}`);
    }
  }

  return args;
}

function mergeListings(a: ListingInfo[], b: ListingInfo[]): ListingInfo[] {
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  const byId = new Map<number, ListingInfo>();
  for (const listing of [...a, ...b]) {
    const existing = byId.get(listing.tokenId);
    if (!existing || isCheaperListing(listing, existing)) byId.set(listing.tokenId, listing);
  }
  return [...byId.values()].sort((left, right) => left.tokenId - right.tokenId);
}

function isCheaperListing(a: ListingInfo, b: ListingInfo): boolean {
  if (a.priceEth == null) return false;
  if (b.priceEth == null) return true;
  return a.priceEth < b.priceEth;
}

function formatListing(listing: ListingInfo): string {
  const price = listing.priceEth == null ? "unknown price" : `${listing.priceEth} ${listing.currency ?? "ETH"}`;
  return `#${listing.tokenId} (${price})`;
}

function listingWithinBudget(listing: ListingInfo, priceCapEth: number | null): boolean {
  if (priceCapEth == null) return true;
  return listing.priceEth != null && listing.priceEth <= priceCapEth;
}

function listingFloorPriceEth(listings: ListingInfo[]): number | null {
  let floor: number | null = null;
  for (const listing of listings) {
    if (listing.priceEth == null) continue;
    if (floor == null || listing.priceEth < floor) floor = listing.priceEth;
  }
  return floor == null ? null : Number(floor.toFixed(8));
}

function listingPriceCapEth(args: Args, floorPriceEth: number | null): number | null {
  let cap = args.maxListingPriceEth;
  if (args.maxListingFloorMultiple != null && floorPriceEth != null) {
    const floorCap = floorPriceEth * args.maxListingFloorMultiple;
    cap = cap == null ? floorCap : Math.min(cap, floorCap);
  }
  return cap == null ? null : Number(cap.toFixed(8));
}

function stateWithinBudget(state: State, args: Args): boolean {
  if (args.maxTotalListingPriceEth == null) return true;
  const total = totalListingPriceEth(state.listedTokens);
  return total != null && total <= args.maxTotalListingPriceEth;
}

function totalListingPriceEth(listings: ListingInfo[]): number | null {
  let total = 0;
  for (const listing of listings) {
    if (listing.priceEth == null) return null;
    total += listing.priceEth;
  }
  return Number(total.toFixed(8));
}

function normalizePlannerArgs(argv: string[]): string[] {
  if (argv[0] === "plan") return argv.slice(1);
  if (argv[0] === "slop" && argv[1] === "plan") return argv.slice(2);
  return argv;
}

function parseMode(raw: string, name: string): Args["mode"] {
  if (raw === "beam" || raw === "deep-l2") return raw;
  throw new Error(`${name} must be beam or deep-l2`);
}

class TopStates {
  private states: State[] = [];
  private sorted = true;

  constructor(private readonly limit: number) {}

  wouldKeep(survivor: State, donor: State, diffCount: number, slopLevel: number): boolean {
    if (this.states.length < this.limit) return true;
    if (!this.sorted) this.trim();
    const worst = this.states[this.states.length - 1]!;
    return compareCandidate(survivor, donor, diffCount, slopLevel, worst) < 0;
  }

  add(state: State): void {
    this.states.push(state);
    this.sorted = false;
    if (this.states.length > this.limit * 4) this.trim();
  }

  values(): State[] {
    this.trim();
    return this.states.slice();
  }

  private trim(): void {
    this.states.sort(compareStates);
    if (this.states.length > this.limit) this.states.length = this.limit;
    this.sorted = true;
  }
}

function compareCandidate(
  survivor: State,
  donor: State,
  diffCount: number,
  slopLevel: number,
  state: State,
): number {
  const tokenCount = survivor.tokenIds.length + donor.tokenIds.length;
  return (
    state.slopLevel - slopLevel ||
    state.diffCount - diffCount ||
    state.level - (survivor.level + 1) ||
    tokenCount - state.tokenIds.length ||
    survivor.anchorTokenId - state.anchorTokenId
  );
}

function usage() {
  console.log(`Usage:
  slonks plan --owner 0x... [options]
  bun run slop:plan -- --owner 0x... [options]

Options:
  --api URL          API base URL, default ${DEFAULT_API}
  --mode MODE        Search mode: beam or deep-l2, default beam
  --include-listings Include all currently listed Slonks in the search pool
  --listing-delay-ms N Delay between listing pages, default ${DEFAULT_LISTING_DELAY_MS}
  --max-listing-pages N Listing page cap for testing, default 0 means all pages
  --max-listing-price-eth N Skip listed tokens above this ETH price
  --max-listing-floor-multiple N Skip listed tokens above N x current floor price
  --max-total-listing-price-eth N Skip paths whose listed-token total exceeds this ETH price
  --max-level N     Highest result merge level to search, default 4
  --beam-size N     States to keep per generated level, default 32
  --l1-frontier N   L1 survivor frontier for deep-l2 mode, default ${DEFAULT_L1_FRONTIER}
  --l2-budget N     Valid L2 previews to scan in deep-l2 mode, default ${DEFAULT_L2_BUDGET}; 0 means no cap
  --per-anchor N    Diversity cap per survivor anchor inside beam, default 4
  --diversity N     Fraction of each beam reserved for embedding diversity, default 0.25
  --refine-l2 N     Exact L2 donor scan for top N L1 survivor branches, default 0
  --top N           Number of paths to print, default 10
  --json            Print JSON
`);
}

if (import.meta.main) {
  runSlopPlanner().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
