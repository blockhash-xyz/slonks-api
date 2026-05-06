#!/usr/bin/env bun

import { blendEmbeddings, blendEmbeddingsInto } from "@blockhash/slonks-core/blend";
import { hexToBytes } from "@blockhash/slonks-core/hex";
import { diffRenderedEmbeddingLocal } from "@blockhash/slonks-core/imageModel";
import {
  DEFAULT_API,
  getJson,
  logStatus as writeLogStatus,
  normalizeApiUrl,
  parseNonNegativeNumber,
  parsePositiveInt,
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
  slop: number | null;
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
  slop: number;
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
  slop: number;
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
  target: number | null;
  once: boolean;
  tui: boolean;
  top: number;
  json: boolean;
  onProgress?: (progress: MinerProgress) => void;
};

type SerializedState = ReturnType<typeof serializeState>;

type MinerProgress = {
  phase?: string;
  message?: string;
  pass?: number;
  level?: number;
  maxLevel?: number;
  poolSize?: number;
  generated?: number;
  checked?: number;
  kept?: number;
  possible?: number;
  totalGenerated?: number;
  best?: SerializedState | null;
  done?: boolean;
};

const LISTING_PAGE_LIMIT = 100;
const DEFAULT_LISTING_DELAY_MS = 1_000;
const LISTING_PROGRESS_EVERY = 5;
const DEFAULT_L1_FRONTIER = 512;
const DEFAULT_L2_BUDGET = 1_000_000;
const DEFAULT_LISTING_FLOOR_MULTIPLE = 2;

export async function runSlopMiner(argv = process.argv.slice(2)) {
  const args = parseArgs(normalizeMineArgs(argv));
  if (!args.owner) {
    usage();
    process.exit(1);
  }
  if (args.json && !args.once && args.target == null) {
    throw new Error("--json requires --once or --target because mining runs forever by default");
  }

  const started = Date.now();
  const ui = args.tui && !args.json && process.stdout.isTTY ? new MinerUi(args, started) : null;
  if (ui) args.onProgress = (progress) => ui.update(progress);

  logStatus(args, `Fetching Slonks for ${args.owner} from ${args.api}`);
  const minerTokens = await fetchPlannerTokens(args);
  const baseStates = snapshotsToStates(minerTokens.tokens);
  if (baseStates.length === 0) throw new Error("no mineable tokens found");

  const currentBest = [...baseStates].sort(compareStates)[0]!;
  const listingCapSummary = minerTokens.listingCapped ? ", capped" : "";
  const listingPriceSummary =
    minerTokens.listingPriceCapEth == null
      ? ""
      : `, floor ${minerTokens.listingFloorPriceEth} ETH, cap ${minerTokens.listingPriceCapEth} ETH`;
  const listedSummary = args.includeListings
    ? ` + ${minerTokens.addedListingCount} listed tokens (${minerTokens.listingCount} listings across ${minerTokens.listingPages} pages${listingCapSummary}${listingPriceSummary})`
    : "";
  logStatus(
    args,
    `Loaded ${minerTokens.ownedCount} owned tokens${listedSummary}. Search pool: ${baseStates.length}. Current best: #${currentBest.anchorTokenId} merge L${currentBest.level} slop ${currentBest.slop} slop level ${currentBest.slopLevel}`,
  );

  const mineResult = await mine(baseStates, args, started);
  ui?.finish(mineResult.best, mineResult.exitReason);

  if (args.json) {
    console.log(JSON.stringify({ ...mineResult, elapsedSeconds: elapsedSeconds(started) }, null, 2));
    return;
  }

  if (!ui) printMineResult(mineResult, started);
}

function logStatus(args: Args, message: string): void {
  args.onProgress?.({ message });
  if (args.onProgress) return;
  writeLogStatus(args.json, message);
}

type MineResult = {
  ownerTokenCount: number;
  poolSize: number;
  passes: Array<{
    pass: number;
    mode: Args["mode"];
    maxLevel: number;
    beamSize: number;
    generated: number;
    best: SerializedState | null;
    targetHit: boolean;
  }>;
  best: SerializedState | null;
  target: number | null;
  targetHit: boolean;
  exitReason: string;
};

async function mine(baseStates: State[], args: Args, started: number): Promise<MineResult> {
  const passes: MineResult["passes"] = [];
  let best: SerializedState | null = null;
  let totalGenerated = 0;
  let pass = 0;

  for (;;) {
    pass++;
    const profile = miningProfile(pass, args.once);
    const passArgs: Args = {
      ...args,
      mode: profile.mode,
      maxLevel: profile.maxLevel,
      beamSize: profile.beamSize,
      l1Frontier: profile.l1Frontier,
      l2Budget: profile.l2Budget,
      perAnchor: profile.perAnchor,
      diversity: profile.diversity,
      refineL2: profile.refineL2,
    };

    reportProgress(args, {
      phase: profile.label,
      pass,
      maxLevel: profile.maxLevel,
      totalGenerated,
      best,
    });

    const result = passArgs.mode === "deep-l2" ? mineDeepL2(baseStates, passArgs) : mineBeam(baseStates, passArgs);
    const generated = generatedCount(result);
    totalGenerated += generated;
    const passBest = result.best[0] ?? null;
    if (passBest && (!best || compareSerializedStates(passBest, best) < 0)) {
      best = passBest;
      reportProgress(args, {
        phase: "new best",
        pass,
        maxLevel: profile.maxLevel,
        generated,
        totalGenerated,
        best,
      });
    }

    const targetHit = Boolean(best && args.target != null && best.slop >= args.target);
    passes.push({
      pass,
      mode: passArgs.mode,
      maxLevel: passArgs.maxLevel,
      beamSize: passArgs.beamSize,
      generated,
      best: passBest,
      targetHit,
    });

    reportProgress(args, {
      phase: targetHit ? "target hit" : args.once ? "complete" : "expanding",
      pass,
      maxLevel: profile.maxLevel,
      generated,
      totalGenerated,
      best,
      done: targetHit || args.once,
    });

    if (targetHit) {
      return {
        ownerTokenCount: baseStates.length,
        poolSize: baseStates.length,
        passes,
        best,
        target: args.target,
        targetHit: true,
        exitReason: `target ${args.target} reached`,
      };
    }
    if (args.once) {
      return {
        ownerTokenCount: baseStates.length,
        poolSize: baseStates.length,
        passes,
        best,
        target: args.target,
        targetHit: false,
        exitReason: "one pass complete",
      };
    }

    await sleep(Math.min(1_000, 200 + pass * 50));
    if (elapsedSeconds(started) > Number.MAX_SAFE_INTEGER) break;
  }

  return {
    ownerTokenCount: baseStates.length,
    poolSize: baseStates.length,
    passes,
    best,
    target: args.target,
    targetHit: false,
    exitReason: "stopped",
  };
}

function miningProfile(pass: number, once: boolean) {
  if (once) {
    return {
      label: "single mining pass",
      mode: "deep-l2" as const,
      maxLevel: 2,
      beamSize: 128,
      l1Frontier: 512,
      l2Budget: 1_000_000,
      perAnchor: 4,
      diversity: 0.25,
      refineL2: 0,
    };
  }

  const level = Math.min(6, Math.max(1, Math.floor((pass + 1) / 2)));
  const beamSize = Math.min(512, 64 + pass * 32);
  const l1Frontier = Math.min(2_048, 256 + pass * 128);
  const l2Budget = Math.min(10_000_000, 250_000 * pass);

  if (pass === 1) {
    return {
      label: "mining level 1",
      mode: "beam" as const,
      maxLevel: 1,
      beamSize,
      l1Frontier,
      l2Budget,
      perAnchor: 4,
      diversity: 0.25,
      refineL2: 0,
    };
  }

  if (level <= 2) {
    return {
      label: `mining level ${level}`,
      mode: "deep-l2" as const,
      maxLevel: 2,
      beamSize,
      l1Frontier,
      l2Budget,
      perAnchor: 4,
      diversity: 0.25,
      refineL2: 0,
    };
  }

  return {
    label: `mining level ${level}`,
    mode: "beam" as const,
    maxLevel: level,
    beamSize,
    l1Frontier,
    l2Budget,
    perAnchor: 4,
    diversity: 0.25,
    refineL2: Math.min(512, pass * 32),
  };
}

function generatedCount(result: { levels: Array<{ generated: number }>; refinements: Array<{ generated: number }> }): number {
  return (
    result.levels.reduce((sum, row) => sum + row.generated, 0) +
    result.refinements.reduce((sum, row) => sum + row.generated, 0)
  );
}

function reportProgress(args: Args, progress: MinerProgress): void {
  args.onProgress?.(progress);
}

function mineBeam(baseStates: State[], args: Args) {
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
    reportProgress(args, { phase: `mining L${level + 1}`, level: level + 1, maxLevel: args.maxLevel, poolSize: pool.length });

    const candidates: State[] = [];
    let checked = 0;
    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        const a = pool[i]!;
        const b = pool[j]!;
        if ((a.mask & b.mask) !== 0n) continue;
        const ab = mergeStates(a, b, ++nextId);
        checked++;
        if (checked % 100_000 === 0) reportProgress(args, { phase: `mining L${level + 1}`, level: level + 1, checked });
        if (stateWithinBudget(ab, args)) candidates.push(ab);
        const ba = mergeStates(b, a, ++nextId);
        checked++;
        if (checked % 100_000 === 0) reportProgress(args, { phase: `mining L${level + 1}`, level: level + 1, checked });
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
    reportProgress(args, {
      phase: `finished L${outputLevel}`,
      level: outputLevel,
      maxLevel: args.maxLevel,
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

function mineDeepL2(baseStates: State[], args: Args) {
  const level0States = baseStates.filter((state) => state.level === 0);
  const existingLevel1States = baseStates.filter((state) => state.level === 1);
  const generatedLevel1States: State[] = [];
  const allLevel1States: State[] = [...existingLevel1States];
  let nextId = 0;
  let l1Checked = 0;
  reportProgress(args, { phase: "mining L1 frontier", level: 1, maxLevel: 2, poolSize: level0States.length });

  for (let i = 0; i < level0States.length; i++) {
    for (let j = i + 1; j < level0States.length; j++) {
      const a = level0States[i]!;
      const b = level0States[j]!;
      const ab = mergeStates(a, b, ++nextId);
      l1Checked++;
      if (l1Checked % 100_000 === 0) reportProgress(args, { phase: "mining L1 frontier", level: 1, checked: l1Checked });
      if (stateWithinBudget(ab, args)) {
        generatedLevel1States.push(ab);
        allLevel1States.push(ab);
      }
      const ba = mergeStates(b, a, ++nextId);
      l1Checked++;
      if (l1Checked % 100_000 === 0) reportProgress(args, { phase: "mining L1 frontier", level: 1, checked: l1Checked });
      if (stateWithinBudget(ba, args)) {
        generatedLevel1States.push(ba);
        allLevel1States.push(ba);
      }
    }
  }

  const l1Frontier = selectBeam(allLevel1States, args.l1Frontier, args.perAnchor, args.diversity);
  const donors = uniqueDonorStates(allLevel1States);
  reportProgress(args, {
    phase: "mining L2",
    level: 2,
    maxLevel: 2,
    generated: generatedLevel1States.length,
    kept: l1Frontier.length,
  });
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
        reportProgress(args, {
          phase: "mining L2",
          level: 2,
          checked: generated,
          possible: possibleBranches,
          generated,
        });
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
    slop: diff.count,
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
        slop: diff.count,
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
    slop: diff.count,
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
        slop: diff.count,
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
      slop: snapshot.slop ?? 0,
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
    b.slop - a.slop ||
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
    slop: state.slop,
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
    target: null,
    once: false,
    tui: true,
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
      case "--listings":
        args.includeListings = true;
        args.maxListingFloorMultiple ??= DEFAULT_LISTING_FLOOR_MULTIPLE;
        break;
      case "--budget":
        args.includeListings = true;
        args.maxListingFloorMultiple ??= DEFAULT_LISTING_FLOOR_MULTIPLE;
        args.maxTotalListingPriceEth = parseNonNegativeNumber(requireValue(arg, next), arg);
        i++;
        break;
      case "--target":
        args.target = parseSlopTarget(requireValue(arg, next), arg);
        i++;
        break;
      case "--once":
        args.once = true;
        break;
      case "--no-tui":
        args.tui = false;
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

function normalizeMineArgs(argv: string[]): string[] {
  if (argv[0] === "mine") return argv.slice(1);
  return argv;
}

function parseSlopTarget(raw: string, name: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 576) throw new Error(`${name} must be an integer from 0 to 576`);
  return value;
}

class TopStates {
  private states: State[] = [];
  private sorted = true;

  constructor(private readonly limit: number) {}

  wouldKeep(survivor: State, donor: State, slop: number, slopLevel: number): boolean {
    if (this.states.length < this.limit) return true;
    if (!this.sorted) this.trim();
    const worst = this.states[this.states.length - 1]!;
    return compareCandidate(survivor, donor, slop, slopLevel, worst) < 0;
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
  slop: number,
  slopLevel: number,
  state: State,
): number {
  const tokenCount = survivor.tokenIds.length + donor.tokenIds.length;
  return (
    state.slopLevel - slopLevel ||
    state.slop - slop ||
    state.level - (survivor.level + 1) ||
    tokenCount - state.tokenIds.length ||
    survivor.anchorTokenId - state.anchorTokenId
  );
}

function compareSerializedStates(a: SerializedState, b: SerializedState): number {
  return (
    b.slopLevel - a.slopLevel ||
    b.slop - a.slop ||
    b.level - a.level ||
    a.tokenIds.length - b.tokenIds.length ||
    a.survivorTokenId - b.survivorTokenId
  );
}

function printMineResult(result: MineResult, started: number): void {
  console.log("");
  console.log(`Mining stopped: ${result.exitReason}`);
  console.log(`Elapsed: ${elapsedSeconds(started)}s`);
  console.log(`Passes: ${result.passes.length}`);
  if (result.best) {
    console.log("");
    printState(result.best, 1);
  }
}

function printState(state: SerializedState, rank: number): void {
  console.log(
    `${rank}. ${state.label}: merge L${state.level}, slop ${state.slop}, slop level ${state.slopLevel}, survivor #${state.survivorTokenId}, uses ${state.tokenIds.map((id) => `#${id}`).join(", ")}`,
  );
  if (state.listedTokens.length > 0) {
    const total = totalListingPriceEth(state.listedTokens);
    const totalLabel = total == null ? "unknown total" : `${total} ETH total`;
    console.log(`   buy listed (${totalLabel}): ${state.listedTokens.map(formatListing).join(", ")}`);
  }
  for (const [stepIndex, step] of state.steps.entries()) {
    console.log(
      `   ${stepIndex + 1}. ${step.survivor} <- ${step.donor} => ${step.result} (merge L${step.resultLevel}, slop ${step.slop}, slop level ${step.slopLevel})`,
    );
  }
}

function elapsedSeconds(started: number): number {
  return Number(((Date.now() - started) / 1000).toFixed(2));
}

class MinerUi {
  private progress: MinerProgress = {};
  private best: SerializedState | null = null;
  private lastRender = 0;
  private finished = false;

  constructor(
    private readonly args: Args,
    private readonly started: number,
  ) {
    process.stdout.write("\x1b[?25l");
    process.once("exit", () => process.stdout.write("\x1b[?25h"));
  }

  update(progress: MinerProgress): void {
    this.progress = { ...this.progress, ...progress };
    if (progress.best !== undefined) this.best = progress.best;
    const now = Date.now();
    if (!progress.done && now - this.lastRender < 100) return;
    this.lastRender = now;
    this.render();
  }

  finish(best: SerializedState | null, reason: string): void {
    this.best = best;
    this.progress = { ...this.progress, phase: reason, done: true };
    this.finished = true;
    this.render();
    process.stdout.write("\x1b[?25h");
    process.stdout.write("\n");
  }

  private render(): void {
    const best = this.best;
    const target = this.args.target == null ? "none" : String(this.args.target);
    const listings = this.args.includeListings ? "on" : "off";
    const budget = this.args.maxTotalListingPriceEth == null ? "none" : `${this.args.maxTotalListingPriceEth} ETH`;
    const lines = [
      "+------------------------------------------------------------+",
      "| Slonks Miner                                               |",
      "+------------------------------------------------------------+",
      `Owner     ${shortAddress(this.args.owner)}`,
      `Target    ${target}    Listings ${listings}    Budget ${budget}`,
      `Elapsed   ${elapsedSeconds(this.started)}s    Pass ${this.progress.pass ?? 0}    Phase ${this.progress.phase ?? "starting"}`,
      `Level     ${this.progress.level ?? "-"} / ${this.progress.maxLevel ?? "-"}    Pool ${this.progress.poolSize ?? "-"}`,
      `Checked   ${formatNumber(this.progress.checked)}    Generated ${formatNumber(this.progress.generated)}    Total ${formatNumber(this.progress.totalGenerated)}`,
      `Kept      ${formatNumber(this.progress.kept)}    Possible ${formatNumber(this.progress.possible)}`,
      "",
      "Best",
      best ? `  slop ${best.slop}  slop level ${best.slopLevel}  merge level ${best.level}  survivor #${best.survivorTokenId}` : "  none yet",
      best ? `  uses ${best.tokenIds.map((id) => `#${id}`).join(", ")}` : "",
      best && best.listedTokens.length > 0 ? `  buys ${best.listedTokens.map(formatListing).join(", ")}` : "",
      "",
      this.progress.message ? `Status: ${this.progress.message}` : "Status: mining uses local compute; Ctrl-C to stop",
      this.finished ? "" : "Tip: add --target N to stop automatically when a slop target is found",
    ].filter((line) => line !== "");

    process.stdout.write("\x1b[H\x1b[J");
    process.stdout.write(`${lines.join("\n")}\n`);
  }
}

function shortAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatNumber(value: number | undefined): string {
  if (value == null) return "-";
  return value.toLocaleString("en-US");
}

function usage() {
  console.log(`Usage:
  slonks mine --owner 0x... [options]

Options:
  --owner 0x...   Holder address to mine from
  --target N      Stop when a path reaches slop N
  --listings      Include listed Slonks up to ${DEFAULT_LISTING_FLOOR_MULTIPLE}x floor
  --budget ETH    Include listings, but only show paths at or below this total ETH spend
  --once          Run one strong mining pass and exit
  --top N         Number of paths to keep/show, default 10
  --json          Print final JSON; requires --once or --target
  --api URL       API base URL, default ${DEFAULT_API}
`);
}

if (import.meta.main) {
  runSlopMiner().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
