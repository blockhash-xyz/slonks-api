import type { Address } from "viem";
import { mainnet } from "viem/chains";

// Verified live on mainnet via slonks.slonksRenderer() / renderer.imageModel() etc.
// Active mainnet addresses are mirrored from llm-punks docs/mainnet-addresses.md
// plus the fixed-price void deployment broadcast.
export const CONTRACTS = {
  slonks: "0x832233ddb7bcffd0ed53127dd6be3f1aa5845108" as Address,
  renderer: "0xa5cc6b20e0fa329ca721df832dfd609c104fb6fd" as Address,
  imageModel: "0xca116243a2013ed33015c776ee37310b199ee80c" as Address,
  mergeManager: "0x5d56d3527f470ca24af864cc5571d8fb8de785d2" as Address,
  legacyMergeManagers: [
    "0x7bda4820dbcfe471a2e23d3fa069c1cd261401e1" as Address,
    "0x3e5bb2a724dbe9a6afe04ae7581639367693f51c" as Address,
  ],
  slopGame: "0x76c61b6140600429f50de5ac987e41672047cc28" as Address,
  slopFixedPriceVoidExtension: "0xf50fdb3392396d06923f1971daec7f98dc33ca70" as Address,
  slopClaimExtension: "0xf50fdb3392396d06923f1971daec7f98dc33ca70" as Address,
  slopMergeLevelClaimExtension: "0xfe2d9f4f70b1dc2a7c3d940691eba293488178fa" as Address,
  legacySlopMergeLevelClaimExtensions: [
    "0xf251d1d665229bd6a7045acbfbec132cd1934b06" as Address,
    "0xe49eb1e77dfa92d00e3d0e2302524a066216ad63" as Address,
  ],
  oldSlopGame: "0xb4ffbcce990a9a0b5f84722ba2d5db4e7bfc9d11" as Address,
  falseStartSlopGame: "0x886612a7a8dba8bbced8f86d26c1114857ccd9da" as Address,
  legacySlopGames: [
    "0xb4ffbcce990a9a0b5f84722ba2d5db4e7bfc9d11" as Address,
    "0x886612a7a8dba8bbced8f86d26c1114857ccd9da" as Address,
    "0x6500f597644017bb20e8e59c2de7b78649a8bfa9" as Address,
  ],
  slopToken: "0x999b49c0d1612e619a4a4f6280733184da025108" as Address,
  honkVerifier: "0x5cbe9cbedc27dd4f082119586f5d924645064eb3" as Address,
  dutchAuctionExtension: "0xf79822c2331db455087b51b6c97e4064138bb635" as Address,
  signedDutchAuctionExtension: "0x9454262f710c04db1c5a1e016a3cc038857660a5" as Address,
  oldGameSweepExtension: "0xabfe4e6dbcbf1468e6e50c2c2223a91eb8c43b18" as Address,
  slopPacks: "0xcd1ac22e5175f1d5bb5b83e882e4b0311e2394e8" as Address,
  sloplings: "0xd449c4d5bb924384bbd31d2484f29c1b2b4a5108" as Address,
  slopPacksSeasonState: "0x862430c7d7fddeff2499562ccf1a4468939a5357" as Address,
  slopPacksSeasonController: "0x24a4fb2553b3dc596065e37f1d1d78085b216abd" as Address,
  cryptoPunksData: "0x16f5a35647d6f03d5d3da7b35409d65ba03af3b2" as Address,
} as const;

export const CHAIN = mainnet;
export const CHAIN_ID = 1;
export const SLOP_GAME_ADDRESSES = [CONTRACTS.slopGame, ...CONTRACTS.legacySlopGames] as const;
export const SLOP_CLAIM_CONTRACTS = [
  CONTRACTS.slopClaimExtension,
  CONTRACTS.slopMergeLevelClaimExtension,
  ...CONTRACTS.legacySlopMergeLevelClaimExtensions,
  CONTRACTS.slopGame,
] as const;
export const SLOP_CLAIM_EVENT_ADDRESSES = [
  CONTRACTS.slopGame,
  CONTRACTS.slopClaimExtension,
  CONTRACTS.slopMergeLevelClaimExtension,
  ...CONTRACTS.legacySlopMergeLevelClaimExtensions,
  ...CONTRACTS.legacySlopGames,
] as const;

export function isKnownSlopGameAddress(address: string | null | undefined): boolean {
  if (!address) return false;
  const lower = address.toLowerCase();
  return SLOP_GAME_ADDRESSES.some((gameAddress) => gameAddress.toLowerCase() === lower);
}

// Deployment block of the Slonks contract. Override with START_BLOCK env var if needed.
// If you don't know it offhand, set START_BLOCK in .env to the block of the first
// Slonks tx and the indexer will start there.
export const SLONKS_DEPLOY_BLOCK = 24_998_760n;
export const SLOP_PACKS_DEPLOY_BLOCK = 25_200_293n;
export const SLOPLINGS_DEPLOY_BLOCK = 25_197_167n;
export const SLOP_PACKS_SEASON_DEPLOY_BLOCK = SLOP_PACKS_DEPLOY_BLOCK;

export const MAX_SUPPLY = 10_000;

export const INDEXED_NFT_COLLECTIONS = [
  {
    slug: "slop-packs",
    name: "Slop Packs",
    symbol: "SLOPPACK",
    address: CONTRACTS.slopPacks,
    startBlock: SLOP_PACKS_DEPLOY_BLOCK,
  },
  {
    slug: "sloplings",
    name: "Sloplings",
    symbol: "SLOPLINGS",
    address: CONTRACTS.sloplings,
    startBlock: SLOPLINGS_DEPLOY_BLOCK,
  },
] as const;

export type IndexedNftCollection = (typeof INDEXED_NFT_COLLECTIONS)[number];
export type IndexedNftCollectionSlug = IndexedNftCollection["slug"];

export function indexedNftCollectionBySlug(slug: string): IndexedNftCollection | null {
  return INDEXED_NFT_COLLECTIONS.find((collection) => collection.slug === slug) ?? null;
}

export const SLOPLING_MAX_SUPPLY = 10_000;
export const SLOPLING_FEED_INTERVAL_SECONDS = 30 * 24 * 60 * 60;
export const SLOPLING_STATE_NAMES = ["alive", "starving", "dead", "immortal"] as const;
export type SloplingCareState = (typeof SLOPLING_STATE_NAMES)[number];

export const SLOPLING_METADATA_BASE = "https://cdn.slops.xyz/sloplings/alive/metadata/";

export const SLOP_PACK_VAULT_COLLECTIONS = [
  { address: "0x9251dec8df720c2adf3b6f46d968107cbbadf4d4" as Address, name: "1337 skulls" },
  { address: "0x57a204aa1042f6e66dd7730813f4024114d74f37" as Address, name: "CyberKongz" },
  { address: "0x7b1a5e0807383f84a66c8a1b1af494061a169336" as Address, name: "CyberKongz Evolution" },
  { address: "0x2acab3dea77832c09420663b0e1cb386031ba17b" as Address, name: "DeadFellaz" },
  { address: "0x8a90cab2b38dba80c64b7734e58ee1db38b8992e" as Address, name: "Doodles" },
  { address: "0x1fec856e25f757fed06eb90548b0224e91095738" as Address, name: "FrankenPunks" },
  { address: "0xb8ea78fcacef50d41375e44e6814ebba36bb33c4" as Address, name: "Good Vibes Club" },
  { address: "0x1dafd82031eff6863adf3a25907310faee72ca5f" as Address, name: "INX" },
  { address: "0x8943c7bac1914c9a7aba750bf2b6b09fd21037e0" as Address, name: "Lazy Lions" },
  { address: "0x7bd29408f11d2bfc23c34f18275bbf23bb716bc7" as Address, name: "Meebits" },
  { address: "0x9eb6e2025b64f340691e424b7fe7022ffde12438" as Address, name: "Normies" },
  { address: "0xbd3531da5cf5857e7cfaa92426877b022e612cf8" as Address, name: "PudgyPenguins" },
  { address: "0x8f1b132e9fd2b9a2b210baa186bf1ae650adf7ac" as Address, name: "Quirklings" },
  { address: CONTRACTS.slonks, name: "Slonks" },
  { address: "0xc9d198089d6c31d0ca5cc5b92c97a57a97bbfde2" as Address, name: "Space Riders" },
] as const;

export function slopPackPrizeCollectionName(address: string | null | undefined): string | null {
  if (!address) return null;
  const lower = address.toLowerCase();
  if (lower === CONTRACTS.sloplings.toLowerCase()) return "Sloplings";
  return SLOP_PACK_VAULT_COLLECTIONS.find((collection) => collection.address.toLowerCase() === lower)?.name ?? null;
}

// renderEmbeddingPixels eth_call is ~140M gas. Alchemy accepts it under 550M.
export const ETH_CALL_GAS = 600_000_000n;
