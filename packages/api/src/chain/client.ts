import {
  createPublicClient,
  decodeAbiParameters,
  encodeFunctionData,
  http,
  parseAbiParameters,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { rpcUrl } from "../env.ts";
import { CHAIN, CONTRACTS, ETH_CALL_GAS } from "./contracts.ts";
import { slonksImageModelAbi } from "./abis.ts";

let cached: PublicClient | null = null;

export function publicClient(): PublicClient {
  if (!cached) {
    cached = createPublicClient({
      chain: CHAIN,
      transport: http(rpcUrl(), { batch: true }),
    });
  }
  return cached;
}

// Heavy `bytes` returns (renderEmbeddingPixels, renderSourcePixels) need an
// explicit gas cap on eth_call. viem's `readContract` doesn't expose it so we
// hand-roll the call.
async function callBytes(to: Address, data: Hex): Promise<Uint8Array | null> {
  try {
    const result = await publicClient().call({ to, data, gas: ETH_CALL_GAS });
    if (!result.data || result.data === "0x") return null;
    const [decoded] = decodeAbiParameters(parseAbiParameters("bytes"), result.data);
    return hexToBytes(decoded);
  } catch {
    return null;
  }
}

export function callRenderSourcePixels(sourceId: number | bigint): Promise<Uint8Array | null> {
  const data = encodeFunctionData({
    abi: slonksImageModelAbi,
    functionName: "renderSourcePixels",
    args: [BigInt(sourceId)],
  });
  return callBytes(CONTRACTS.imageModel, data);
}

export function callRenderEmbeddingPixels(embedding: Hex): Promise<Uint8Array | null> {
  const data = encodeFunctionData({
    abi: slonksImageModelAbi,
    functionName: "renderEmbeddingPixels",
    args: [embedding],
  });
  return callBytes(CONTRACTS.imageModel, data);
}

// Local helper to avoid a slonks/hex.ts dependency from the chain layer.
function hexToBytes(hex: Hex): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length === 0) return new Uint8Array(0);
  if (clean.length % 2 !== 0) throw new Error(`odd-length hex: ${clean.length}`);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
