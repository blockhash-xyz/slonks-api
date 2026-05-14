// Hand-curated subsets of the Slonks contract ABIs. Mirrors slonks-web's abis.ts
// plus the events the indexer needs.

export const slonksAbi = [
  // reads
  { type: "function", name: "MAX_SUPPLY", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "revealed", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "revealBlockNumber", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "revealSeed", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "shuffleOffset", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "remainingSourceIds", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "baseSourceIdFor",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "sourceIdFor",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "slonksRenderer",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },

  // events
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "tokenId", type: "uint256", indexed: true },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "RevealCommitted",
    inputs: [{ name: "targetBlock", type: "uint256", indexed: true }],
    anonymous: false,
  },
  {
    type: "event",
    name: "Revealed",
    inputs: [
      { name: "seed", type: "bytes32", indexed: true },
      { name: "offset", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "BatchMetadataUpdate",
    inputs: [
      { name: "_fromTokenId", type: "uint256", indexed: false },
      { name: "_toTokenId", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "MetadataUpdate",
    inputs: [{ name: "_tokenId", type: "uint256", indexed: false }],
    anonymous: false,
  },
] as const;

export const slonksRendererAbi = [
  {
    type: "function",
    name: "imageModel",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "mergeManager",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "activeState",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
] as const;

export const slonksImageModelAbi = [
  {
    type: "function",
    name: "renderSourcePixels",
    stateMutability: "view",
    inputs: [{ name: "sourceId", type: "uint256" }],
    outputs: [{ type: "bytes" }],
  },
  {
    type: "function",
    name: "sourceEmbedding",
    stateMutability: "view",
    inputs: [{ name: "sourceId", type: "uint256" }],
    outputs: [{ type: "bytes" }],
  },
  {
    type: "function",
    name: "renderEmbeddingPixels",
    stateMutability: "view",
    inputs: [{ name: "embedding", type: "bytes" }],
    outputs: [{ type: "bytes" }],
  },
] as const;

export const slonksActiveStateAbi = [
  {
    type: "function",
    name: "hasActiveEmbedding",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "activeEmbedding",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "bytes" }],
  },
] as const;

export const slopGameProofStateAbi = [
  {
    type: "function",
    name: "imageModel",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "mergeState",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
] as const;

export const slopGameAbi = [
  {
    type: "function",
    name: "voidedTokenAt",
    stateMutability: "view",
    inputs: [{ name: "index", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "isSlopClaimPending",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "slopClaimRecipient",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "slopClaimed",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "event",
    name: "SlonkLockedForSlop",
    inputs: [
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "owner", type: "address", indexed: true },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "ExtensionActiveEmbeddingSet",
    inputs: [
      { name: "extension", type: "address", indexed: true },
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "embeddingHash", type: "bytes32", indexed: true },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "ExtensionActiveEmbeddingCleared",
    inputs: [
      { name: "extension", type: "address", indexed: true },
      { name: "tokenId", type: "uint256", indexed: true },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "SlonkUnlockedFromSlop",
    inputs: [
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "owner", type: "address", indexed: true },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "SlonkVoided",
    inputs: [
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "slop", type: "uint256", indexed: false },
      { name: "mintedAmount", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "SlopClaimed",
    inputs: [
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "recipient", type: "address", indexed: true },
      { name: "submitter", type: "address", indexed: true },
      { name: "slop", type: "uint256", indexed: false },
      { name: "mintedAmount", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "ExtensionSlopClaimed",
    inputs: [
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "recipient", type: "address", indexed: true },
      { name: "submitter", type: "address", indexed: true },
      { name: "mergeLevel", type: "uint8", indexed: false },
      { name: "slop", type: "uint256", indexed: false },
      { name: "mintedAmount", type: "uint256", indexed: false },
      { name: "wasLocked", type: "bool", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "SlonkProtocolVoided",
    inputs: [
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "voider", type: "address", indexed: true },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "SlonkBoughtAndVoided",
    inputs: [
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "buyer", type: "address", indexed: true },
      { name: "target", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
      { name: "spent", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "VoidPriceInitialized",
    inputs: [
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "slop", type: "uint256", indexed: false },
      { name: "price", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "SlonkPurchasedFromVoid",
    inputs: [
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "buyer", type: "address", indexed: true },
      { name: "recipient", type: "address", indexed: true },
      { name: "price", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
] as const;

export const slopFixedPriceVoidAbi = [
  {
    type: "function",
    name: "voidPriceInitialized",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "voidPrice",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "buyFromVoid",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "maxPrice", type: "uint256" },
    ],
    outputs: [{ name: "price", type: "uint256" }],
  },
  {
    type: "function",
    name: "buyFromVoidTo",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "recipient", type: "address" },
      { name: "maxPrice", type: "uint256" },
    ],
    outputs: [{ name: "price", type: "uint256" }],
  },
] as const;

export const slopSignedDutchAuctionAbi = [
  {
    type: "function",
    name: "pendingRevival",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "requester", type: "address" },
      { name: "targetBlock", type: "uint64" },
      { name: "expiresBlock", type: "uint64" },
      { name: "eligibleSlonkCount", type: "uint32" },
      { name: "revivalNonce", type: "uint64" },
      { name: "cost", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "claimDigest",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "entropySigner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "game",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "claimRevival",
    stateMutability: "nonpayable",
    inputs: [{ name: "signature", type: "bytes" }],
    outputs: [],
  },
] as const;

export const slonksMergeManagerAbi = [
  {
    type: "function",
    name: "mergeLevel",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "mergeEmbedding",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "bytes" }],
  },
  {
    type: "event",
    name: "SlonkMerged",
    inputs: [
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "burnedTokenId", type: "uint256", indexed: true },
      { name: "burnedSourceId", type: "uint256", indexed: false },
      { name: "mergeLevel", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
] as const;

export const cryptoPunksDataAbi = [
  {
    type: "function",
    name: "punkImage",
    stateMutability: "view",
    inputs: [{ name: "index", type: "uint16" }],
    outputs: [{ type: "bytes" }],
  },
  {
    type: "function",
    name: "punkAttributes",
    stateMutability: "view",
    inputs: [{ name: "index", type: "uint16" }],
    outputs: [{ type: "string" }],
  },
] as const;
