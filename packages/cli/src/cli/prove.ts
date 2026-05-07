#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { hexToBytes } from "@blockhash/slonks-core/hex";
import { renderEmbeddingPixelsLocal } from "@blockhash/slonks-core/imageModel";
import {
  buildProverToml,
  bytesToHex,
  ensureEmbeddingHex,
  isEmptyHexBytes,
  parseTokenId,
  splitBytes32Fields,
  type ProofInputSource,
} from "@blockhash/slonks-core/proof";
import { createPublicClient, getAddress, http, zeroAddress, type Address, type Hex } from "viem";
import { logStatus, requireValue } from "./common.ts";

type Args = {
  help: boolean;
  tokenId: number | null;
  rpcUrl: string | null;
  slonks: Address | null;
  workDir: string;
  outDir: string | null;
  nargo: string;
  bb: string;
  json: boolean;
};

type DiscoveredContracts = {
  slonks: Address;
  renderer: Address;
  imageModel: Address;
  mergeManager: Address;
  activeState: Address | null;
};

type ResolvedProofInput = {
  sourceId: number;
  inputSource: ProofInputSource;
  embeddingHex: Hex;
};

const DEFAULT_WORK_DIR = join(homedir(), ".slonks", "prover", "slop_model_proof");

const DEFAULT_SLONKS_BY_CHAIN: Record<number, Address> = {
  1: getAddress("0x832233ddb7bcffd0ed53127dd6be3f1aa5845108"),
  11155111: getAddress("0xF855BeaFd068717307EBf92B1f763E5CD4A0e6f9"),
};

const slonksAbi = [
  {
    type: "function",
    name: "sourceIdFor",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "sourceId", type: "uint256" }],
  },
  {
    type: "function",
    name: "slonksRenderer",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "renderer", type: "address" }],
  },
] as const;

const rendererAbi = [
  {
    type: "function",
    name: "imageModel",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "imageModel", type: "address" }],
  },
  {
    type: "function",
    name: "mergeManager",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "mergeManager", type: "address" }],
  },
  {
    type: "function",
    name: "activeState",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "activeState", type: "address" }],
  },
] as const;

const imageModelAbi = [
  {
    type: "function",
    name: "sourceEmbedding",
    stateMutability: "view",
    inputs: [{ name: "sourceId", type: "uint256" }],
    outputs: [{ name: "embedding", type: "bytes" }],
  },
] as const;

const mergeManagerAbi = [
  {
    type: "function",
    name: "mergeEmbedding",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "embedding", type: "bytes" }],
  },
] as const;

const activeStateAbi = [
  {
    type: "function",
    name: "hasActiveEmbedding",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "hasActiveEmbedding", type: "bool" }],
  },
  {
    type: "function",
    name: "activeEmbedding",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "embedding", type: "bytes" }],
  },
] as const;

const slopGameStateAbi = [
  {
    type: "function",
    name: "imageModel",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "imageModel", type: "address" }],
  },
  {
    type: "function",
    name: "mergeState",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "mergeState", type: "address" }],
  },
] as const;

export async function runProve(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  if (args.help) {
    usage();
    return;
  }
  if (args.tokenId == null) {
    usage();
    process.exit(1);
  }
  if (!args.rpcUrl) throw new Error("set RPC_URL or pass --rpc-url");

  const client = createPublicClient({ transport: http(args.rpcUrl) });
  const chainId = await client.getChainId();
  const slonks = args.slonks ?? defaultSlonksForChain(chainId);
  if (!slonks) throw new Error(`no default Slonks contract for chain ${chainId}; pass --slonks`);

  logStatus(args.json, `Reading Slonk #${args.tokenId} on ${chainLabel(chainId)}`);
  const contracts = await discoverContracts(client, slonks);
  const proofInput = await resolveProofInput(client, contracts, args.tokenId);
  logStatus(
    args.json,
    `Using ${proofInput.inputSource} ${proofInput.embeddingHex} for source #${proofInput.sourceId}`,
  );

  const workDir = resolve(args.workDir);
  await ensureCircuitFiles(workDir);
  const embedding = hexToBytes(proofInput.embeddingHex);
  const pixels = renderEmbeddingPixelsLocal(embedding);
  await writeProverInputs(workDir, embedding, pixels);

  logStatus(args.json, `Writing proof workspace to ${workDir}`);
  await runCommand(args.nargo, ["execute"], workDir, args.json);
  await ensureVerificationKey(args, workDir);
  await runCommand(
    args.bb,
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
      "--verify",
    ],
    workDir,
    args.json,
  );

  const artifacts = await readProofArtifacts(workDir, args.outDir, args.tokenId);
  if (args.json) {
    console.log(
      JSON.stringify(
        {
          tokenId: args.tokenId,
          chainId,
          contracts,
          sourceId: proofInput.sourceId,
          inputSource: proofInput.inputSource,
          embedding: proofInput.embeddingHex,
          workDir,
          proofPath: artifacts.proofPath,
          publicInputsPath: artifacts.publicInputsPath,
          proof: artifacts.proofHex,
          publicInputs: artifacts.publicInputs,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log("");
  console.log(`Proof ready for Slonk #${args.tokenId}`);
  console.log(`  input: ${proofInput.inputSource}`);
  console.log(`  source: #${proofInput.sourceId}`);
  console.log(`  embedding: ${proofInput.embeddingHex}`);
  console.log(`  proof: ${artifacts.proofPath}`);
  console.log(`  public inputs: ${artifacts.publicInputsPath}`);
  console.log(`  public input fields: ${artifacts.publicInputs.length}`);
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    help: false,
    tokenId: null,
    rpcUrl: defaultRpcUrl(),
    slonks: null,
    workDir: process.env.SLONKS_PROVER_WORK_DIR ?? DEFAULT_WORK_DIR,
    outDir: null,
    nargo: process.env.NARGO_BIN ?? "nargo",
    bb: process.env.BB_BIN ?? defaultBbBin(),
    json: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }
    if (arg === "--json") {
      args.json = true;
      continue;
    }
    if (arg === "--rpc-url") {
      args.rpcUrl = requireValue(arg, argv[++i]);
      continue;
    }
    if (arg === "--slonks") {
      args.slonks = getAddress(requireValue(arg, argv[++i]));
      continue;
    }
    if (arg === "--work-dir") {
      args.workDir = requireValue(arg, argv[++i]);
      continue;
    }
    if (arg === "--out") {
      args.outDir = requireValue(arg, argv[++i]);
      continue;
    }
    if (arg === "--nargo") {
      args.nargo = requireValue(arg, argv[++i]);
      continue;
    }
    if (arg === "--bb") {
      args.bb = requireValue(arg, argv[++i]);
      continue;
    }
    if (arg.startsWith("--")) throw new Error(`unknown option ${arg}`);
    if (args.tokenId != null) throw new Error(`unexpected extra argument ${arg}`);
    args.tokenId = parseTokenId(arg);
  }

  return args;
}

function defaultRpcUrl(): string | null {
  return (
    process.env.RPC_URL ??
    process.env.ETH_RPC_URL ??
    process.env.MAINNET_RPC_URL ??
    process.env.ALCHEMY_RPC_URL ??
    process.env.SEPOLIA_RPC_URL ??
    null
  );
}

function defaultBbBin(): string {
  const localBb = join(homedir(), ".bb", "bb");
  return existsSync(localBb) ? localBb : "bb";
}

function defaultSlonksForChain(chainId: number): Address | null {
  return DEFAULT_SLONKS_BY_CHAIN[chainId] ?? null;
}

async function discoverContracts(
  client: ReturnType<typeof createPublicClient>,
  slonks: Address,
): Promise<DiscoveredContracts> {
  const renderer = await client.readContract({
    address: slonks,
    abi: slonksAbi,
    functionName: "slonksRenderer",
  });
  const [imageModel, mergeManager, activeState] = await Promise.all([
    client.readContract({ address: renderer, abi: rendererAbi, functionName: "imageModel" }),
    client.readContract({ address: renderer, abi: rendererAbi, functionName: "mergeManager" }),
    readRendererActiveState(client, renderer),
  ]);
  const proofState = activeState ? await readSlopGameProofState(client, activeState) : null;

  return {
    slonks,
    renderer: getAddress(renderer),
    imageModel: proofState?.imageModel ?? getAddress(imageModel),
    mergeManager: proofState?.mergeManager ?? getAddress(mergeManager),
    activeState,
  };
}

async function readRendererActiveState(
  client: ReturnType<typeof createPublicClient>,
  renderer: Address,
): Promise<Address | null> {
  try {
    const activeState = await client.readContract({
      address: renderer,
      abi: rendererAbi,
      functionName: "activeState",
    });
    return activeState === zeroAddress ? null : getAddress(activeState);
  } catch {
    return null;
  }
}

async function readSlopGameProofState(
  client: ReturnType<typeof createPublicClient>,
  activeState: Address,
): Promise<{ imageModel: Address; mergeManager: Address } | null> {
  try {
    const [imageModel, mergeManager] = await Promise.all([
      client.readContract({ address: activeState, abi: slopGameStateAbi, functionName: "imageModel" }),
      client.readContract({ address: activeState, abi: slopGameStateAbi, functionName: "mergeState" }),
    ]);
    if (imageModel === zeroAddress || mergeManager === zeroAddress) return null;
    return { imageModel: getAddress(imageModel), mergeManager: getAddress(mergeManager) };
  } catch {
    return null;
  }
}

async function resolveProofInput(
  client: ReturnType<typeof createPublicClient>,
  contracts: DiscoveredContracts,
  tokenId: number,
): Promise<ResolvedProofInput> {
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
      abi: activeStateAbi,
      functionName: "hasActiveEmbedding",
      args: [BigInt(tokenId)],
    });
    if (hasActiveEmbedding) {
      const activeEmbedding = await client.readContract({
        address: contracts.activeState,
        abi: activeStateAbi,
        functionName: "activeEmbedding",
        args: [BigInt(tokenId)],
      });
      if (!isEmptyHexBytes(activeEmbedding)) {
        return {
          sourceId,
          inputSource: "active embedding",
          embeddingHex: ensureEmbeddingHex(activeEmbedding, "active embedding"),
        };
      }
    }
  }

  const mergeEmbedding = await client.readContract({
    address: contracts.mergeManager,
    abi: mergeManagerAbi,
    functionName: "mergeEmbedding",
    args: [BigInt(tokenId)],
  });
  if (!isEmptyHexBytes(mergeEmbedding)) {
    return {
      sourceId,
      inputSource: "merge embedding",
      embeddingHex: ensureEmbeddingHex(mergeEmbedding, "merge embedding"),
    };
  }

  const sourceEmbedding = await client.readContract({
    address: contracts.imageModel,
    abi: imageModelAbi,
    functionName: "sourceEmbedding",
    args: [BigInt(sourceId)],
  });
  return {
    sourceId,
    inputSource: "source embedding",
    embeddingHex: ensureEmbeddingHex(sourceEmbedding, "source embedding"),
  };
}

async function ensureCircuitFiles(workDir: string): Promise<void> {
  const files = [
    {
      from: new URL("../../assets/slop_model_proof/Nargo.toml", import.meta.url),
      to: join(workDir, "Nargo.toml"),
    },
    {
      from: new URL("../../assets/slop_model_proof/src/main.nr", import.meta.url),
      to: join(workDir, "src", "main.nr"),
    },
  ];

  let changed = false;
  for (const file of files) {
    changed = (await copyIfChanged(file.from, file.to)) || changed;
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

async function ensureVerificationKey(args: Args, workDir: string): Promise<void> {
  if (existsSync(join(workDir, "target", "proof-keccak", "vk", "vk"))) return;
  await runCommand(
    args.bb,
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
    args.json,
  );
}

async function runCommand(command: string, argv: string[], cwd: string, json: boolean): Promise<void> {
  logStatus(json, `$ ${command} ${argv.join(" ")}`);
  let proc: Bun.Subprocess<"ignore", "pipe" | "inherit", "pipe" | "inherit">;
  try {
    proc = Bun.spawn([command, ...argv], {
      cwd,
      stdin: "ignore",
      stdout: json ? "pipe" : "inherit",
      stderr: json ? "pipe" : "inherit",
    });
  } catch (err) {
    throw new Error(`failed to start ${command}: ${err instanceof Error ? err.message : String(err)}`);
  }

  const stdout = json ? new Response(proc.stdout).text() : Promise.resolve("");
  const stderr = json ? new Response(proc.stderr).text() : Promise.resolve("");
  const [exitCode, out, err] = await Promise.all([proc.exited, stdout, stderr]);
  if (exitCode !== 0) {
    const detail = [out.trim(), err.trim()].filter(Boolean).join("\n").slice(0, 2_000);
    throw new Error(`${command} exited with code ${exitCode}${detail ? `:\n${detail}` : ""}`);
  }
}

async function readProofArtifacts(
  workDir: string,
  outDir: string | null,
  tokenId: number,
): Promise<{
  proofPath: string;
  publicInputsPath: string;
  proofHex: Hex;
  publicInputs: Hex[];
}> {
  const generatedProofPath = join(workDir, "target", "proof-keccak", "proof", "proof");
  const generatedPublicInputsPath = join(workDir, "target", "proof-keccak", "proof", "public_inputs");
  let proofPath = generatedProofPath;
  let publicInputsPath = generatedPublicInputsPath;

  if (outDir) {
    const resolvedOut = resolve(outDir);
    await mkdir(resolvedOut, { recursive: true });
    proofPath = join(resolvedOut, `slonk-${tokenId}-proof`);
    publicInputsPath = join(resolvedOut, `slonk-${tokenId}-public_inputs`);
    await copyFile(generatedProofPath, proofPath);
    await copyFile(generatedPublicInputsPath, publicInputsPath);
  }

  const proof = await readFile(proofPath);
  const publicInputsBytes = await readFile(publicInputsPath);
  return {
    proofPath,
    publicInputsPath,
    proofHex: bytesToHex(proof),
    publicInputs: splitBytes32Fields(publicInputsBytes),
  };
}

function chainLabel(chainId: number): string {
  if (chainId === 1) return "Ethereum mainnet";
  if (chainId === 11155111) return "Sepolia";
  return `chain ${chainId}`;
}

function usage(): void {
  console.log(`Usage:
  slonks prove <tokenId> [options]

Generates an UltraHonk proof and public inputs for voiding a Slonk.
The command reads the Slonk's current chain state and automatically uses
an active revival embedding, merge embedding, or source embedding.

Options:
  --rpc-url URL      Ethereum RPC URL. Defaults to RPC_URL / ETH_RPC_URL.
  --slonks ADDRESS  Slonks contract address. Defaults by chain.
  --work-dir DIR    Prover workspace. Default: ${DEFAULT_WORK_DIR}
  --out DIR         Copy proof artifacts to this directory.
  --nargo PATH      nargo binary. Default: nargo
  --bb PATH         bb binary. Default: ~/.bb/bb when present, otherwise bb
  --json            Print proof and public inputs as JSON.
  --help            Show this help.

Requirements:
  nargo and bb must be installed and available on PATH unless overridden.
`);
}
