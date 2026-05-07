import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { hexToBytes } from "@blockhash/slonks-core/hex";
import { renderEmbeddingPixelsLocal } from "@blockhash/slonks-core/imageModel";
import {
  buildProverToml,
  bytesToHex,
  ensureEmbeddingHex,
  isEmptyHexBytes,
  splitBytes32Fields,
  type ProofInputSource,
} from "@blockhash/slonks-core/proof";
import { getAddress, zeroAddress, type Address, type Hex, type PublicClient } from "viem";
import {
  slonksAbi,
  slonksActiveStateAbi,
  slonksImageModelAbi,
  slonksMergeManagerAbi,
  slonksRendererAbi,
  slopGameProofStateAbi,
} from "../chain/abis.ts";
import { publicClient } from "../chain/client.ts";
import { CHAIN_ID, CONTRACTS } from "../chain/contracts.ts";
import { env } from "../env.ts";
import { resolvedProofCacheKey } from "./cacheKey.ts";

export type VoidProof = {
  chainId: 1;
  tokenId: number;
  sourceId: number;
  inputSource: ProofInputSource;
  embedding: Hex;
  proof: Hex;
  publicInputs: Hex[];
  proofBytes: number;
  publicInputsBytes: number;
  contracts: ProofContracts;
  timingsMs: VoidProofTimings;
  generatedAt: string;
};

export type VoidProofTimings = {
  total: number;
  ensureCircuit: number;
  renderPixels: number;
  writeInputs: number;
  nargoExecute: number;
  ensureVerificationKey: number;
  bbProve: number;
  readArtifacts: number;
};

export type ProofContracts = {
  slonks: Address;
  renderer: Address;
  imageModel: Address;
  mergeManager: Address;
  activeState: Address | null;
};

export type ProofInput = {
  sourceId: number;
  inputSource: ProofInputSource;
  embedding: Hex;
};

export type ResolvedVoidProofRequest = ProofInput & {
  tokenId: number;
  contracts: ProofContracts;
};

type CacheEntry = {
  expiresAt: number;
  value: VoidProof;
};

const CIRCUIT_FILES = [
  {
    from: new URL("../../../cli/assets/slop_model_proof/Nargo.toml", import.meta.url),
    to: "Nargo.toml",
  },
  {
    from: new URL("../../../cli/assets/slop_model_proof/src/main.nr", import.meta.url),
    to: join("src", "main.nr"),
  },
];

const cache = new Map<string, CacheEntry>();
let activeProof: { key: string; promise: Promise<VoidProof> } | null = null;

export class ProverBusyError extends Error {
  constructor() {
    super("prover is busy");
  }
}

export class ProverUnavailableError extends Error {
  constructor(message = "prover is unavailable") {
    super(message);
  }
}

export async function generateVoidProof(tokenId: number): Promise<VoidProof> {
  if (!env.SLOP_PROVER_ENABLED) throw new ProverUnavailableError("proof generation is disabled");

  const request = await resolveVoidProofRequest(tokenId);
  return generateVoidProofFromResolved(request);
}

export async function resolveVoidProofRequest(tokenId: number): Promise<ResolvedVoidProofRequest> {
  const client = publicClient();
  const contracts = await discoverProofContracts(client);
  const input = await resolveProofInput(client, contracts, tokenId);
  return { tokenId, contracts, ...input };
}

export async function generateVoidProofFromResolved(request: ResolvedVoidProofRequest): Promise<VoidProof> {
  if (!env.SLOP_PROVER_ENABLED) throw new ProverUnavailableError("proof generation is disabled");

  const { tokenId, contracts, ...input } = request;
  const key = resolvedProofCacheKey(request);
  const cached = readCache(key);
  if (cached) return cached;

  if (activeProof) {
    if (activeProof.key === key) return activeProof.promise;
    throw new ProverBusyError();
  }

  const promise = runProof(tokenId, input, contracts);
  activeProof = { key, promise };
  try {
    const proof = await promise;
    writeCache(key, proof);
    return proof;
  } finally {
    activeProof = null;
  }
}

async function discoverProofContracts(client: PublicClient): Promise<ProofContracts> {
  const slonks = getAddress(CONTRACTS.slonks);
  const renderer = getAddress(
    await client.readContract({
      address: slonks,
      abi: slonksAbi,
      functionName: "slonksRenderer",
    }),
  );
  const [rendererImageModel, rendererMergeManager, activeState] = await Promise.all([
    client.readContract({ address: renderer, abi: slonksRendererAbi, functionName: "imageModel" }),
    client.readContract({ address: renderer, abi: slonksRendererAbi, functionName: "mergeManager" }),
    readRendererActiveState(client, renderer),
  ]);
  const proofState = activeState ? await readSlopGameProofState(client, activeState) : null;

  return {
    slonks,
    renderer,
    imageModel: proofState?.imageModel ?? getAddress(rendererImageModel),
    mergeManager: proofState?.mergeManager ?? getAddress(rendererMergeManager),
    activeState,
  };
}

async function readRendererActiveState(client: PublicClient, renderer: Address): Promise<Address | null> {
  try {
    const activeState = await client.readContract({
      address: renderer,
      abi: slonksRendererAbi,
      functionName: "activeState",
    });
    return activeState === zeroAddress ? null : getAddress(activeState);
  } catch {
    return null;
  }
}

async function readSlopGameProofState(
  client: PublicClient,
  activeState: Address,
): Promise<{ imageModel: Address; mergeManager: Address } | null> {
  try {
    const [imageModel, mergeManager] = await Promise.all([
      client.readContract({ address: activeState, abi: slopGameProofStateAbi, functionName: "imageModel" }),
      client.readContract({ address: activeState, abi: slopGameProofStateAbi, functionName: "mergeState" }),
    ]);
    if (imageModel === zeroAddress || mergeManager === zeroAddress) return null;
    return { imageModel: getAddress(imageModel), mergeManager: getAddress(mergeManager) };
  } catch {
    return null;
  }
}

async function resolveProofInput(client: PublicClient, contracts: ProofContracts, tokenId: number): Promise<ProofInput> {
  const sourceId = Number(
    await client.readContract({
      address: contracts.slonks,
      abi: slonksAbi,
      functionName: "sourceIdFor",
      args: [BigInt(tokenId)],
    }),
  );

  if (contracts.activeState) {
    const hasActiveEmbedding = await client.readContract({
      address: contracts.activeState,
      abi: slonksActiveStateAbi,
      functionName: "hasActiveEmbedding",
      args: [BigInt(tokenId)],
    });
    if (hasActiveEmbedding) {
      const activeEmbedding = await client.readContract({
        address: contracts.activeState,
        abi: slonksActiveStateAbi,
        functionName: "activeEmbedding",
        args: [BigInt(tokenId)],
      });
      if (!isEmptyHexBytes(activeEmbedding)) {
        return {
          sourceId,
          inputSource: "active embedding",
          embedding: ensureEmbeddingHex(activeEmbedding, "active embedding"),
        };
      }
    }
  }

  const mergeEmbedding = await client.readContract({
    address: contracts.mergeManager,
    abi: slonksMergeManagerAbi,
    functionName: "mergeEmbedding",
    args: [BigInt(tokenId)],
  });
  if (!isEmptyHexBytes(mergeEmbedding)) {
    return {
      sourceId,
      inputSource: "merge embedding",
      embedding: ensureEmbeddingHex(mergeEmbedding, "merge embedding"),
    };
  }

  const sourceEmbedding = await client.readContract({
    address: contracts.imageModel,
    abi: slonksImageModelAbi,
    functionName: "sourceEmbedding",
    args: [BigInt(sourceId)],
  });
  return {
    sourceId,
    inputSource: "source embedding",
    embedding: ensureEmbeddingHex(sourceEmbedding, "source embedding"),
  };
}

async function runProof(tokenId: number, input: ProofInput, contracts: ProofContracts): Promise<VoidProof> {
  const totalStarted = performance.now();
  const timingsMs: VoidProofTimings = {
    total: 0,
    ensureCircuit: 0,
    renderPixels: 0,
    writeInputs: 0,
    nargoExecute: 0,
    ensureVerificationKey: 0,
    bbProve: 0,
    readArtifacts: 0,
  };

  const workDir = resolve(env.SLOP_PROVER_WORK_DIR);
  await timedProofPhase(timingsMs, "ensureCircuit", () => ensureCircuitFiles(workDir));
  const { embedding, pixels } = await timedProofPhase(timingsMs, "renderPixels", async () => {
    const embedding = hexToBytes(input.embedding);
    return { embedding, pixels: renderEmbeddingPixelsLocal(embedding) };
  });
  await timedProofPhase(timingsMs, "writeInputs", () => writeProverInputs(workDir, embedding, pixels));

  await timedProofPhase(timingsMs, "nargoExecute", () => runCommand(nargoBin(), ["execute"], workDir));
  await timedProofPhase(timingsMs, "ensureVerificationKey", () => ensureVerificationKey(workDir));
  await timedProofPhase(
    timingsMs,
    "bbProve",
    () =>
      runCommand(
        bbBin(),
        [
          "prove",
          "-s",
          "ultra_honk",
          "--disable_zk",
          "--oracle_hash",
          "keccak",
          "-b",
          "target/slop_model_proof.json",
          "-w",
          "target/slop_model_proof.gz",
          "-k",
          "target/proof-keccak/vk/vk",
          "-o",
          "target/proof-keccak/proof",
        ],
        workDir,
      ),
  );

  const { proof, publicInputs } = await timedProofPhase(timingsMs, "readArtifacts", async () => {
    const proofPath = join(workDir, "target", "proof-keccak", "proof", "proof");
    const publicInputsPath = join(workDir, "target", "proof-keccak", "proof", "public_inputs");
    return {
      proof: await readFile(proofPath),
      publicInputs: await readFile(publicInputsPath),
    };
  });
  timingsMs.total = roundMs(performance.now() - totalStarted);
  console.log(`void proof ${tokenId} timings`, timingsMs);

  return {
    chainId: CHAIN_ID,
    tokenId,
    sourceId: input.sourceId,
    inputSource: input.inputSource,
    embedding: input.embedding,
    proof: bytesToHex(proof),
    publicInputs: splitBytes32Fields(publicInputs),
    proofBytes: proof.length,
    publicInputsBytes: publicInputs.length,
    contracts,
    timingsMs,
    generatedAt: new Date().toISOString(),
  };
}

async function timedProofPhase<K extends keyof VoidProofTimings, T>(
  timings: VoidProofTimings,
  phase: K,
  fn: () => Promise<T>,
): Promise<T> {
  const started = performance.now();
  try {
    return await fn();
  } finally {
    timings[phase] = roundMs(performance.now() - started);
  }
}

function roundMs(value: number): number {
  return Math.round(value);
}

async function ensureCircuitFiles(workDir: string): Promise<void> {
  let changed = false;
  for (const file of CIRCUIT_FILES) {
    changed = (await copyIfChanged(file.from, join(workDir, file.to))) || changed;
  }
  if (changed) await rm(join(workDir, "target", "proof-keccak", "vk"), { recursive: true, force: true });
}

async function copyIfChanged(from: URL, to: string): Promise<boolean> {
  const next = new Uint8Array(await Bun.file(from).arrayBuffer());
  const current = existsSync(to) ? await readFile(to) : null;
  if (current && sameBytes(current, next)) return false;
  await mkdir(dirname(to), { recursive: true });
  await writeFile(to, next);
  return true;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

async function writeProverInputs(workDir: string, embedding: Uint8Array, pixels: Uint8Array): Promise<void> {
  await writeFile(join(workDir, "Prover.toml"), buildProverToml(embedding, pixels), "utf8");
  await writeFile(join(workDir, "expected_pixels.txt"), `${Array.from(pixels).join(",")}\n`, "utf8");
}

async function ensureVerificationKey(workDir: string): Promise<void> {
  if (existsSync(join(workDir, "target", "proof-keccak", "vk", "vk"))) return;
  await runCommand(
    bbBin(),
    [
      "write_vk",
      "-s",
      "ultra_honk",
      "--disable_zk",
      "--oracle_hash",
      "keccak",
      "-b",
      "target/slop_model_proof.json",
      "-o",
      "target/proof-keccak/vk",
    ],
    workDir,
  );
}

async function runCommand(command: string, argv: string[], cwd: string): Promise<void> {
  let timedOut = false;
  let proc: Bun.Subprocess<"ignore", "pipe", "pipe">;
  try {
    proc = Bun.spawn([command, ...argv], {
      cwd,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (err) {
    throw new ProverUnavailableError(`failed to start ${command}: ${err instanceof Error ? err.message : String(err)}`);
  }

  const timeout = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, env.SLOP_PROVER_TIMEOUT_MS);

  const stdout = new Response(proc.stdout).text();
  const stderr = new Response(proc.stderr).text();
  const [exitCode, out, err] = await Promise.all([proc.exited, stdout, stderr]);
  clearTimeout(timeout);
  if (timedOut) throw new Error(`${command} timed out after ${env.SLOP_PROVER_TIMEOUT_MS}ms`);
  if (exitCode !== 0) {
    const detail = [out.trim(), err.trim()].filter(Boolean).join("\n").slice(0, 2_000);
    throw new Error(`${command} exited with code ${exitCode}${detail ? `:\n${detail}` : ""}`);
  }
}

function nargoBin(): string {
  return env.NARGO_BIN ?? "nargo";
}

function bbBin(): string {
  if (env.BB_BIN) return env.BB_BIN;
  const home = process.env.HOME;
  const homeBb = home ? join(home, ".bb", "bb") : null;
  return homeBb && existsSync(homeBb) ? homeBb : "bb";
}

function readCache(key: string): VoidProof | null {
  const now = Date.now();
  pruneCache(now);
  const entry = cache.get(key);
  if (!entry || entry.expiresAt <= now) {
    cache.delete(key);
    return null;
  }
  cache.delete(key);
  cache.set(key, entry);
  return entry.value;
}

function writeCache(key: string, value: VoidProof): void {
  const ttl = env.SLOP_PROVER_CACHE_TTL_MS;
  if (ttl === 0) return;
  cache.set(key, { value, expiresAt: Date.now() + ttl });
  pruneCache(Date.now());
}

function pruneCache(now: number): void {
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
  for (const key of cache.keys()) {
    if (cache.size <= env.SLOP_PROVER_MAX_CACHE_ENTRIES) break;
    cache.delete(key);
  }
}
