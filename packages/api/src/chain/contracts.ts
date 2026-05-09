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
  slopGame: "0x76c61b6140600429f50de5ac987e41672047cc28" as Address,
  oldSlopGame: "0xb4ffbcce990a9a0b5f84722ba2d5db4e7bfc9d11" as Address,
  falseStartSlopGame: "0x886612a7a8dba8bbced8f86d26c1114857ccd9da" as Address,
  legacySlopGames: [
    "0xb4ffbcce990a9a0b5f84722ba2d5db4e7bfc9d11" as Address,
    "0x886612a7a8dba8bbced8f86d26c1114857ccd9da" as Address,
  ],
  slopToken: "0x999b49c0d1612e619a4a4f6280733184da025108" as Address,
  honkVerifier: "0x5cbe9cbedc27dd4f082119586f5d924645064eb3" as Address,
  dutchAuctionExtension: "0xf79822c2331db455087b51b6c97e4064138bb635" as Address,
  oldGameSweepExtension: "0xabfe4e6dbcbf1468e6e50c2c2223a91eb8c43b18" as Address,
  cryptoPunksData: "0x16f5a35647d6f03d5d3da7b35409d65ba03af3b2" as Address,
} as const;

export const CHAIN = mainnet;
export const CHAIN_ID = 1;
export const SLOP_GAME_ADDRESSES = [CONTRACTS.slopGame, ...CONTRACTS.legacySlopGames] as const;

export function isKnownSlopGameAddress(address: string | null | undefined): boolean {
  if (!address) return false;
  const lower = address.toLowerCase();
  return SLOP_GAME_ADDRESSES.some((gameAddress) => gameAddress.toLowerCase() === lower);
}

// Deployment block of the Slonks contract. Override with START_BLOCK env var if needed.
// If you don't know it offhand, set START_BLOCK in .env to the block of the first
// Slonks tx and the indexer will start there.
export const SLONKS_DEPLOY_BLOCK = 24_998_760n;

export const MAX_SUPPLY = 10_000;

// renderEmbeddingPixels eth_call is ~140M gas. Alchemy accepts it under 550M.
export const ETH_CALL_GAS = 600_000_000n;
