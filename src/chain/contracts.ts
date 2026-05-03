import type { Address } from "viem";
import { mainnet } from "viem/chains";

// Verified live on mainnet via slonks.slonksRenderer() / renderer.imageModel() etc.
// Same as slonks-web's MAINNET_DEPLOYMENT.
export const CONTRACTS = {
  slonks: "0x832233ddb7bcffd0ed53127dd6be3f1aa5845108" as Address,
  renderer: "0x103d4ef6e7d87ea27355b402a4ae0875c3fb32a1" as Address,
  imageModel: "0xca116243a2013ed33015c776ee37310b199ee80c" as Address,
  mergeManager: "0x3e5bb2a724dbe9a6afe04ae7581639367693f51c" as Address,
  cryptoPunksData: "0x16f5a35647d6f03d5d3da7b35409d65ba03af3b2" as Address,
} as const;

export const CHAIN = mainnet;
export const CHAIN_ID = 1;

// Deployment block of the Slonks contract. Override with START_BLOCK env var if needed.
// If you don't know it offhand, set START_BLOCK in .env to the block of the first
// Slonks tx and the indexer will start there.
export const SLONKS_DEPLOY_BLOCK = 24_998_760n;

export const MAX_SUPPLY = 10_000;

// renderEmbeddingPixels eth_call is ~140M gas. Alchemy accepts it under 550M.
export const ETH_CALL_GAS = 600_000_000n;
