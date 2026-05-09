import type { Address } from "viem";
import { mainnet } from "viem/chains";

// Verified live on mainnet via slonks.slonksRenderer() / renderer.imageModel() etc.
// Active mainnet addresses are mirrored from ../llm-punks/docs/mainnet-addresses.md.
export const CONTRACTS = {
  slonks: "0x832233ddb7bcffd0ed53127dd6be3f1aa5845108" as Address,
  renderer: "0x5e68c484ef6dba6e6f27243e6c668674065c1066" as Address,
  imageModel: "0xca116243a2013ed33015c776ee37310b199ee80c" as Address,
  mergeManager: "0x7bda4820dbcfe471a2e23d3fa069c1cd261401e1" as Address,
  legacyMergeManagers: ["0x3e5bb2a724dbe9a6afe04ae7581639367693f51c" as Address],
  slopGame: "0x886612a7a8dba8bbced8f86d26c1114857ccd9da" as Address,
  slopToken: "0x999b49c0d1612e619a4a4f6280733184da025108" as Address,
  honkVerifier: "0x5cbe9cbedc27dd4f082119586f5d924645064eb3" as Address,
  dutchAuctionExtension: "0xfeff27e2b255e8656e083bcda6bfae5984913dfd" as Address,
  oldGameSweepExtension: "0x7663f7e1495d8c2894438c695f60327bf9f55697" as Address,
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
