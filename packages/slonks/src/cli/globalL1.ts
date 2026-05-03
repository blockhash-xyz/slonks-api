#!/usr/bin/env bun

import { readFileSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { cpus, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { blendEmbeddingsInto } from "../slonks/blend.ts";
import { hexToBytes } from "../slonks/hex.ts";
import { diffRenderedEmbeddingLocal, sourceEmbeddingLocal } from "../slonks/imageModel.ts";
import {
  DEFAULT_API,
  getJson,
  logStatus as writeLogStatus,
  normalizeApiUrl,
  parseNonNegativeInt,
  parsePositiveInt,
  requireValue,
} from "./common.ts";

type TokenListItem = {
  tokenId: number;
  sourceId: number | null;
  mergeLevel: number;
  originalRgba: `0x${string}` | null;
};

type SerializedToken = {
  tokenId: number;
  sourceId: number;
  originalRgba: `0x${string}`;
};

type WorkerToken = {
  tokenId: number;
  sourceId: number;
  embedding: Uint8Array;
  originalRgba: Uint8Array;
};

type PairResult = {
  survivorTokenId: number;
  donorTokenId: number;
  survivorSourceId: number;
  donorSourceId: number;
  diffCount: number;
  slopLevel: number;
};

type Args = {
  api: string;
  top: number;
  workers: number;
  maxTokens: number | null;
  json: boolean;
  worker: boolean;
  input: string;
  from: number;
  to: number;
};

const PAGE_LIMIT = 200;
const DEFAULT_PROGRESS_EVERY = 1_000_000;

export async function runGlobalL1(argv = process.argv.slice(2)) {
  const args = parseArgs(normalizeArgs(argv));
  if (args.worker) {
    await runWorker(args);
    return;
  }

  const started = Date.now();
  log(args, `Fetching unmerged Slonks from ${args.api}`);
  const tokens = await fetchUnmergedTokens(args);
  if (tokens.length < 2) throw new Error("need at least two unmerged tokens");

  const comparisons = tokens.length * (tokens.length - 1);
  log(args, `Loaded ${tokens.length} unmerged tokens. Directed one-level previews to scan: ${comparisons}`);

  const workerCount = Math.max(1, Math.min(args.workers, tokens.length));
  const inputPath = join(tmpdir(), `slonks-global-l1-${process.pid}-${Date.now()}.json`);

  try {
    await writeFile(inputPath, JSON.stringify(tokens));
    const workerResults = await runWorkers(args, inputPath, tokens.length, workerCount);
    const top = new TopPairs(args.top);
    let checked = 0;
    for (const result of workerResults) {
      checked += result.checked;
      for (const pair of result.best) top.add(pair);
    }

    const elapsedSeconds = Number(((Date.now() - started) / 1000).toFixed(2));
    const output = {
      mode: "global-l1",
      ignoredMerged: true,
      tokenCount: tokens.length,
      checked,
      possible: comparisons,
      workers: workerCount,
      best: top.values(),
      elapsedSeconds,
    };

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
      return;
    }

    console.log("");
    console.log(`Scanned ${checked} directed L0 -> L1 previews across ${tokens.length} unmerged tokens`);
    console.log(`Finished in ${elapsedSeconds}s with ${workerCount} workers`);
    console.log("");
    console.log(`Top ${output.best.length} one-level merges`);
    for (let i = 0; i < output.best.length; i++) {
      const pair = output.best[i]!;
      console.log(
        `${i + 1}. #${pair.survivorTokenId} <- #${pair.donorTokenId}: slop ${pair.slopLevel}, diff ${pair.diffCount}`,
      );
    }
  } finally {
    await rm(inputPath, { force: true });
  }
}

async function runWorkers(
  args: Args,
  inputPath: string,
  tokenCount: number,
  workerCount: number,
): Promise<Array<{ checked: number; best: PairResult[] }>> {
  const scriptPath = fileURLToPath(import.meta.url);
  const workers = [];
  for (let worker = 0; worker < workerCount; worker++) {
    const from = Math.floor((tokenCount * worker) / workerCount);
    const to = Math.floor((tokenCount * (worker + 1)) / workerCount);
    const proc = Bun.spawn(
      [
        process.execPath,
        scriptPath,
        "--worker",
        "--input",
        inputPath,
        "--from",
        String(from),
        "--to",
        String(to),
        "--top",
        String(args.top),
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    workers.push(readWorker(proc, worker + 1, workerCount, args));
  }
  return Promise.all(workers);
}

async function readWorker(
  proc: ReturnType<typeof Bun.spawn>,
  worker: number,
  workerCount: number,
  args: Args,
): Promise<{ checked: number; best: PairResult[] }> {
  const stderrPromise = readStreamText(requirePipe(proc.stderr, "stderr"), (chunk) => {
    const trimmed = chunk.trim();
    if (trimmed) log(args, `[worker ${worker}/${workerCount}] ${trimmed}`);
  });
  const stdout = await readStreamText(requirePipe(proc.stdout, "stdout"));
  await stderrPromise;
  const code = await proc.exited;
  if (code !== 0) throw new Error(`worker ${worker} failed with code ${code}: ${stdout}`);
  return JSON.parse(stdout) as { checked: number; best: PairResult[] };
}

function requirePipe(
  stream: ReadableStream<Uint8Array> | number | undefined,
  name: string,
): ReadableStream<Uint8Array> {
  if (!stream || typeof stream === "number") throw new Error(`worker ${name} pipe is unavailable`);
  return stream;
}

async function readStreamText(
  stream: ReadableStream<Uint8Array>,
  onChunk?: (chunk: string) => void,
): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of stream) {
    const decoded = decoder.decode(chunk, { stream: true });
    text += decoded;
    onChunk?.(decoded);
  }
  text += decoder.decode();
  return text;
}

async function runWorker(args: Args): Promise<void> {
  if (!args.input) throw new Error("--input is required in worker mode");
  const raw = JSON.parse(readFileSync(args.input, "utf8")) as SerializedToken[];
  const tokens: WorkerToken[] = raw.map((token) => ({
    tokenId: token.tokenId,
    sourceId: token.sourceId,
    embedding: sourceEmbeddingLocal(token.sourceId),
    originalRgba: hexToBytes(token.originalRgba),
  }));

  const from = Math.max(0, Math.min(args.from, tokens.length));
  const to = Math.max(from, Math.min(args.to, tokens.length));
  const top = new TopPairs(args.top);
  const scratch = new Uint8Array(10);
  let checked = 0;

  for (let i = from; i < to; i++) {
    const survivor = tokens[i]!;
    for (const donor of tokens) {
      if (survivor.tokenId === donor.tokenId) continue;
      blendEmbeddingsInto(survivor.embedding, donor.embedding, scratch);
      const diff = diffRenderedEmbeddingLocal(scratch, survivor.originalRgba);
      checked++;
      if (checked % DEFAULT_PROGRESS_EVERY === 0) {
        console.error(`scanned ${checked} previews (${i - from + 1}/${to - from} survivors)`);
      }
      const pair = {
        survivorTokenId: survivor.tokenId,
        donorTokenId: donor.tokenId,
        survivorSourceId: survivor.sourceId,
        donorSourceId: donor.sourceId,
        diffCount: diff.count,
        slopLevel: diff.slopLevel,
      };
      if (top.wouldKeep(pair)) top.add(pair);
    }
  }

  console.log(JSON.stringify({ checked, best: top.values() }));
}

async function fetchUnmergedTokens(args: Args): Promise<SerializedToken[]> {
  const tokens: SerializedToken[] = [];
  for (let page = 1; ; page++) {
    const url = new URL(`${args.api}/tokens`);
    url.searchParams.set("mergeLevel", "0");
    url.searchParams.set("include", "pixels");
    url.searchParams.set("limit", String(PAGE_LIMIT));
    url.searchParams.set("page", String(page));
    const data = await getJson<{
      items: TokenListItem[];
      hasMore: boolean;
      nextPage: number | null;
    }>(url.toString());

    for (const item of data.items) {
      if (item.mergeLevel !== 0 || item.sourceId == null || !item.originalRgba) continue;
      tokens.push({
        tokenId: item.tokenId,
        sourceId: item.sourceId,
        originalRgba: item.originalRgba,
      });
      if (args.maxTokens != null && tokens.length >= args.maxTokens) return tokens;
    }

    log(args, `Fetched ${tokens.length} unmerged tokens`);
    if (!data.hasMore || data.nextPage == null) break;
  }
  return tokens.sort((a, b) => a.tokenId - b.tokenId);
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    api: DEFAULT_API,
    top: 20,
    workers: Math.max(1, Math.min(cpus().length - 1, 8)),
    maxTokens: null,
    json: false,
    worker: false,
    input: "",
    from: 0,
    to: 0,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = argv[i + 1];
    switch (arg) {
      case "--api":
        args.api = normalizeApiUrl(requireValue(arg, next));
        i++;
        break;
      case "--top":
        args.top = parsePositiveInt(requireValue(arg, next), arg);
        i++;
        break;
      case "--workers":
        args.workers = parsePositiveInt(requireValue(arg, next), arg);
        i++;
        break;
      case "--max-tokens":
        args.maxTokens = parsePositiveInt(requireValue(arg, next), arg);
        i++;
        break;
      case "--json":
        args.json = true;
        break;
      case "--worker":
        args.worker = true;
        break;
      case "--input":
        args.input = requireValue(arg, next);
        i++;
        break;
      case "--from":
        args.from = parseNonNegativeInt(requireValue(arg, next), arg);
        i++;
        break;
      case "--to":
        args.to = parseNonNegativeInt(requireValue(arg, next), arg);
        i++;
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

function normalizeArgs(argv: string[]): string[] {
  if (argv[0] === "global-l1") return argv.slice(1);
  return argv;
}

function comparePairs(a: PairResult, b: PairResult): number {
  return (
    b.slopLevel - a.slopLevel ||
    b.diffCount - a.diffCount ||
    a.survivorTokenId - b.survivorTokenId ||
    a.donorTokenId - b.donorTokenId
  );
}

class TopPairs {
  private pairs: PairResult[] = [];
  private sorted = true;

  constructor(private readonly limit: number) {}

  wouldKeep(pair: PairResult): boolean {
    if (this.pairs.length < this.limit) return true;
    if (!this.sorted) this.trim();
    const worst = this.pairs[this.pairs.length - 1]!;
    return comparePairs(pair, worst) < 0;
  }

  add(pair: PairResult): void {
    this.pairs.push(pair);
    this.sorted = false;
    if (this.pairs.length > this.limit * 4) this.trim();
  }

  values(): PairResult[] {
    this.trim();
    return this.pairs.slice();
  }

  private trim(): void {
    this.pairs.sort(comparePairs);
    if (this.pairs.length > this.limit) this.pairs.length = this.limit;
    this.sorted = true;
  }
}

function log(args: Args, message: string): void {
  writeLogStatus(args.json, message);
}

function usage() {
  console.log(`Usage:
  slonks global-l1 [options]

Checks every directed one-level merge between unmerged live tokens.
Merged survivors and burned tokens are ignored by fetching mergeLevel=0 only.

Options:
  --api URL       API base URL, default ${DEFAULT_API}
  --top N        Number of pairs to print, default 20
  --workers N    Local worker processes, default min(cpu - 1, 8)
  --max-tokens N Testing cap; omit for all unmerged tokens
  --json         Print JSON
`);
}

if (import.meta.main) {
  runGlobalL1().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
