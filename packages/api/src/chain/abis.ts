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
