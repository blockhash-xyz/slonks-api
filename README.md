# slonks-api

Indexer, read API, OpenSea proxy, merge-preview engine, and local CLI for Slonks.
The API mirrors the on-chain Slonks rendering math so apps can read token snapshots,
pixels, merge previews, listings, holders, and activity without doing huge
`eth_call`s from the browser.

Public API:

```text
https://api.slonks.xyz
```

## Stack

- Bun + TypeScript
- Hono HTTP API
- viem mainnet reads
- drizzle-orm + Postgres
- Fly app with two process groups: `web` and `indexer`

## Contracts

- Chain: Ethereum mainnet, `chainId: 1`
- Slonks deploy block: `24998760`
- `Slonks`: `0x832233ddb7bcffd0ed53127dd6be3f1aa5845108`
- `SlonksRenderer`: `0x103d4ef6e7d87ea27355b402a4ae0875c3fb32a1`
- `SlonksImageModel`: `0xca116243a2013ed33015c776ee37310b199ee80c`
- `SlonksMergeManager`: `0x3e5bb2a724dbe9a6afe04ae7581639367693f51c`
- `CryptoPunksData`: `0x16f5a35647d6f03d5d3da7b35409d65ba03af3b2`

## What It Indexes

- `Slonks` `Transfer`: mint, burn, transfer, and current owner state.
- `Slonks` `RevealCommitted` and `Revealed`: collection phase and `shuffleOffset`.
- `Slonks` `BatchMetadataUpdate` / `MetadataUpdate`: cache invalidation hints.
- `SlonksMergeManager` `SlonkMerged`: donor-to-survivor merge edges, resulting merge level, and cumulative embedding.

## What It Precomputes

For all 10,000 source punks:

- `CryptoPunksData.punkImage(sourceId)` as 2304-byte RGBA.
- `CryptoPunksData.punkAttributes(sourceId)` as text plus parsed attributes.
- `SlonksImageModel.sourceEmbedding(sourceId)`.
- `SlonksImageModel.renderSourcePixels(sourceId)` as 576 palette indexes.
- Base diff mask, diff count, and slop level.

After reveal, token `sourceId` is computed as:

```text
(baseSourceId + shuffleOffset) % 10000
```

For merged tokens, the indexer stores the cumulative embedding and re-renders pixels
locally from the bundled model weights.

## API Conventions

- All responses are JSON.
- Addresses are returned checksummed when possible.
- Token ids are integers `0..9999`; full snapshots return `tokenId` as a string for frontend compatibility.
- Hex byte fields are `0x`-prefixed:
  - `embedding`: 10 bytes.
  - `generatedPixels`: 576 palette indexes.
  - `originalRgba`: 2304 RGBA bytes.
  - `diffMask`: 72 bytes.
- Most list endpoints use `page`, `limit`, `hasMore`, and `nextPage`.
- `/activity` uses cursor pagination with `nextCursor`.
- Errors are shaped like `{ "error": "message" }`.

## Data Shapes

### Token Snapshot

Returned by `GET /tokens/:id`, `GET /tokens?ids=...`, listing token embeds, and merge APIs where applicable.

```ts
type TokenSnapshot = {
  chainId: 1;
  tokenId: string;
  exists: boolean;
  owner: string | null;
  revealed: boolean;
  baseSourceId: number | null;
  sourceId: number | null;
  punkAttributesText: string | null;
  attributes: Array<{ trait_type: string; value: string }>;
  mergeLevel: number;
  embedding: `0x${string}` | null;
  generatedPixels: `0x${string}` | null;
  originalRgba: `0x${string}` | null;
  diffCount: number | null;
  slopLevel: number | null;
};
```

### Token List Item

Returned by `GET /tokens` and `GET /owners/:address/tokens`.

```ts
type TokenListItem = {
  tokenId: number;
  owner?: string | null;
  sourceId: number | null;
  baseSourceId: number | null;
  mergeLevel: number;
  diffCount: number | null;
  slopLevel: number | null;
  punkType: string | null;
  attributesText: string | null;
  generatedPixels?: `0x${string}` | null;
  originalRgba?: `0x${string}` | null;
};
```

Add `include=pixels` to include `generatedPixels` and `originalRgba`.

## API Reference

### `GET /health`

Checks that the API can talk to Postgres.

```json
{ "status": "ok" }
```

### `GET /collection/status`

Current indexed collection state.

```ts
type CollectionStatus = {
  chainId: 1;
  totalSupply: number;
  maxSupply: 10000;
  remainingSourceIds: number;
  revealed: boolean;
  revealBlockNumber: number;
  shuffleOffset: number;
  phase: "minting" | "pre-reveal" | "reveal-committed" | "revealed";
  sourcesPrecomputed: number;
  lastIndexedBlock: number;
};
```

### `GET /collection/distributions`

Histograms for collection views and rarity-ish UI.

Returns:

- `byMergeLevel`: `{ mergeLevel, count }[]`
- `bySlop`: `{ slopLevel, count }[]`
- `byType`: punk type rows from Postgres, ordered by count desc

### `GET /tokens/:id`

Full token snapshot.

Example:

```bash
curl -sS https://api.slonks.xyz/tokens/505
```

Responses:

- `200`: `TokenSnapshot`
- `400`: invalid token id
- `404`: token not found

### `GET /tokens`

Filterable token list.

Query params:

- `owner`: holder address.
- `ids`: comma-separated token ids. Up to 200. When present, returns full snapshots in requested order and ignores other filters.
- `mergeLevel`: exact merge level, `0..255`.
- `minDiff`, `maxDiff`: diff count range, `0..576`.
- `minSlop`, `maxSlop`: slop level range, `0..11`.
- `baseSourceId`, `sourceId`: exact source id, `0..9999`.
- `type`: exact punk type, for example `Male`, `Female`, `Zombie`, `Ape`, `Alien`.
- `attribute`: case-insensitive text match against attributes.
- `sort`: `id_asc` default, `id_desc`, `diff_asc`, `diff_desc`, `slop_desc`, `merge_desc`.
- `page`: default `1`.
- `limit`: default `50`, max `200`.
- `include`: add `pixels` to include `generatedPixels` and `originalRgba`.

Examples:

```bash
curl -sS "https://api.slonks.xyz/tokens?sort=slop_desc&limit=20"
curl -sS "https://api.slonks.xyz/tokens?ids=0,1,2,505"
curl -sS "https://api.slonks.xyz/tokens?owner=0x2052051a0474fb0b98283b3f38c13b0b0b6a3677&include=pixels"
```

Normal filtered response:

```ts
{
  items: TokenListItem[];
  page: number;
  limit: number;
  hasMore: boolean;
  nextPage: number | null;
}
```

`ids` response:

```ts
{
  items: TokenSnapshot[];
  count: number;
  missingIds: number[];
}
```

### `GET /tokens/:id/lineage`

Full merge tree for the token. This replaces the old flat survivor-only lineage
response. The tree includes the requested token itself, every donor subtree that
was merged into it, and the before/after state for each merge step.

Query params:

- `include=pixels`: include `generatedPixels` and `originalRgba` on each state.

Returns:

```ts
{
  tokenId: number;
  includePixels: boolean;
  tokenIds: number[];
  mergeCount: number;
  root: MergeTreeNode;
  merges: MergeEvent[];
}

type MergeTreeNode = {
  tokenId: number;
  exists: boolean;
  owner: string | null;
  sourceId: number | null;
  baseSourceId: number | null;
  punkType: string | null;
  attributesText: string | null;
  initial: MergeTreeState;
  current: MergeTreeState;
  mergeCount: number;
  leafCount: number;
  merges: Array<{
    event: MergeEvent;
    before: MergeTreeState;
    after: MergeTreeState;
    change: {
      mergeLevelDelta: number | null;
      diffCountDelta: number | null;
      slopLevelDelta: number | null;
    };
    donor: MergeTreeNode;
  }>;
};

type MergeTreeState = {
  tokenId: number;
  sourceId: number | null;
  mergeLevel: number;
  embedding: string | null;
  diffCount: number | null;
  slopLevel: number | null;
  generatedPixels?: string | null;
  originalRgba?: string | null;
};
```

### `GET /tokens/:id/history`

Per-token transfer and merge history.

Returns:

```ts
{
  tokenId: number;
  transfers: TransferEvent[];
  merges: MergeEvent[];
}
```

### `GET /owners/:address/tokens`

All currently held tokens for an owner.

Query params:

- `include=pixels`: include token pixels and original RGBA.

Example:

```bash
curl -sS "https://api.slonks.xyz/owners/0x2052051a0474fb0b98283b3f38c13b0b0b6a3677/tokens?include=pixels"
```

Returns:

```ts
{
  chainId: 1;
  owner: string;
  count: number;
  tokens: TokenListItem[];
}
```

### `GET /owners/:address/summary`

Owner aggregate stats.

Returns:

```ts
{
  chainId: 1;
  owner: string;
  total: number;
  avgDiff: number | null;
  byMergeLevel: Array<{ mergeLevel: number; count: number }>;
}
```

### `GET /holders`

Holder leaderboard.

Query params:

- `page`: default `1`.
- `limit`: default `50`, max `200`.
- `sort`: `count_desc` default, `max_merge_desc`, `merged_count_desc`, `avg_diff_desc`, `max_diff_desc`, `avg_slop_desc`.

Returns:

```ts
{
  chainId: 1;
  items: Array<{
    owner: string | null;
    count: number;
    mergedCount: number;
    avgDiff: number | null;
    maxDiff: number | null;
    avgSlop: number | null;
    maxSlop: number | null;
    maxMergeLevel: number;
  }>;
  page: number;
  limit: number;
  sort: string;
  hasMore: boolean;
  nextPage: number | null;
}
```

### `GET /activity`

Combined transfer and merge feed.

Query params:

- `token`: token id to filter.
- `owner`: address to filter.
- `type`: `transfer` or `merge`; omit for both.
- `limit`: default `50`, max `200`.
- `cursor`: value returned as `nextCursor`, shaped like `blockNumber:logIndex`.

Returns:

```ts
{
  items: Array<
    ({ kind: "transfer" } & TransferEvent) |
    ({ kind: "merge" } & MergeEvent)
  >;
  hasMore: boolean;
  nextCursor: string | null;
}
```

### `GET /listings`

OpenSea listings proxy for the Slonks collection. The API uses the server-side
`OPENSEA_API_KEY`, normalizes listings, dedupes to the cheapest listing per token,
and can embed token snapshots.

Query params:

- `limit`: default `50`, max `100`.
- `cursor`: pagination cursor returned as `next`; forwarded to OpenSea as `next`.
- `next`: alias for `cursor`.
- `include`: `tokens` or `snapshots` to include `tokens[tokenId] = TokenSnapshot`.
- `slug`: optional OpenSea collection slug override; defaults to `OPENSEA_SLUG`.
- `chain`: only `1` is supported.

Example:

```bash
curl -sS "https://api.slonks.xyz/listings?limit=25&include=tokens"
```

Returns:

```ts
{
  chainId: 1;
  enabled: boolean;
  slug?: string;
  chain?: "ethereum";
  next?: string | null;
  reason?: string;
  error?: string;
  listings: Array<{
    tokenId: string;
    priceWei: string | null;
    priceEth: number | null;
    currency: string | null;
    orderHash: string;
  }>;
  tokens?: Record<string, TokenSnapshot>;
}
```

### `POST /merge-preview`

Computes a single merge preview locally. This is a pure preview endpoint: it does
not require matching owners. The contract still enforces ownership when an actual
merge is submitted.

Body:

```json
{ "survivorTokenId": 505, "donorTokenId": 4938 }
```

Aliases accepted:

- `survivorTokenId` or `tokenId`
- `donorTokenId`, `burnedTokenId`, or `burnTokenId`

Returns:

```ts
type MergePreview = {
  chainId: 1;
  survivorTokenId: number;
  donorTokenId: number;
  owner: string | null;
  survivorOwner: string | null;
  donorOwner: string | null;
  survivorSourceId: number;
  donorSourceId: number;
  currentMergeLevel: number;
  previewMergeLevel: number;
  embedding: `0x${string}`;
  generatedPixels: `0x${string}`;
  originalRgba: `0x${string}`;
  diffMask: `0x${string}`;
  diffCount: number;
  slopLevel: number;
};
```

Errors:

- `400`: invalid body, invalid token id, self-merge.
- `404`: token not found.
- `409`: merge level mismatch, source data not ready, embedding not ready, merge level overflow.

### `POST /merge-previews`

Bulk merge preview endpoint.

Body:

```json
{
  "pairs": [
    { "survivorTokenId": 505, "donorTokenId": 4938 },
    { "survivorTokenId": 24, "donorTokenId": 2952 }
  ]
}
```

Limits:

- `pairs` must be non-empty.
- Max `1000` pairs.

Returns:

```ts
{
  chainId: 1;
  items: MergePreview[];
  errors: Array<{
    survivorTokenId: number;
    donorTokenId: number;
    error: string;
    status: number;
    survivorMergeLevel?: number;
    donorMergeLevel?: number;
  }>;
  count: number;
  errorCount: number;
}
```

## Event Shapes

```ts
type TransferEvent = {
  blockNumber: string;
  logIndex: number;
  txHash: string;
  tokenId: number;
  from: string;
  to: string;
  blockTimestamp: string;
};

type MergeEvent = {
  blockNumber: string;
  logIndex: number;
  txHash: string;
  survivorTokenId: number;
  burnedTokenId: number;
  burnedSourceId: number;
  mergeLevel: number;
  blockTimestamp: string;
};
```

## Slonks CLI

The CLI is intentionally named `slonks`, with subcommands. The planner is the
first command. The npm package is `@blockhash/slonks`.

Run without installing:

```bash
bunx @blockhash/slonks plan --owner 0x...
```

Install globally:

```bash
bun add -g @blockhash/slonks
slonks plan --owner 0x...
```

Installed command shape:

```bash
slonks <command> [options]
slonks plan --owner 0x...
slonks --owner 0x...
```

Repo-local command shape:

```bash
bun run cli -- plan --owner 0x...
bun run slop:plan -- --owner 0x...
```

General commands:

- `slonks --help`: show top-level help.
- `slonks help <command>`: show help for a command.
- `slonks --version`: print the installed CLI version.

### `slonks plan`

Find high-slop merge paths for a holder. The command fetches owned token snapshots
from the API, then runs the combinatorial merge search locally using the same
bundled model weights as the API. This keeps expensive path search off the hosted
API.

Example:

```bash
slonks plan --owner 0x2052051a0474fb0b98283b3f38c13b0b0b6a3677 --max-level 5 --beam-size 384 --per-anchor 24 --refine-l2 512 --top 10
```

Include currently listed Slonks in the same search pool:

```bash
slonks plan --owner 0x... --include-listings --max-level 5 --beam-size 384 --per-anchor 24 --refine-l2 512 --top 10
```

With `--include-listings`, the CLI walks every cursor page from
`https://api.slonks.xyz/listings` and never talks to OpenSea directly. It waits
between pages and backs off on rate limits. For quick testing, cap the scan:

```bash
slonks plan --owner 0x... --include-listings --max-listing-pages 1 --max-level 2 --beam-size 64 --top 5
```

Options:

- `--owner 0x...`: required holder address.
- `--api URL`: API base URL. Default: `https://api.slonks.xyz`.
- `--mode MODE`: search mode. `beam` is the default; `deep-l2` runs exact L1 and a bounded streaming L2 scan.
- `--include-listings`: include all currently listed Slonks from `/listings`.
- `--listing-delay-ms N`: delay between listing pages. Default: `1000`.
- `--max-listing-pages N`: optional listings page cap for testing. Default: `0`, meaning all pages.
- `--max-listing-price-eth N`: skip listed tokens above this ETH price.
- `--max-listing-floor-multiple N`: skip listed tokens above `N` times the current floor price.
- `--max-total-listing-price-eth N`: skip paths whose total listed-token price exceeds this ETH price.
- `--max-level N`: highest result merge level to search. Default: `4`.
- `--beam-size N`: states to keep per generated level. Higher is slower but explores more. Default: `32`.
- `--l1-frontier N`: L1 survivor frontier size for `deep-l2`. Default: `512`.
- `--l2-budget N`: valid L2 previews to scan in `deep-l2`. Default: `1000000`; `0` means no cap.
- `--per-anchor N`: diversity cap per survivor anchor inside the beam. Default: `4`.
- `--diversity N`: `0..1` fraction of each beam reserved for embedding-diverse candidates. Default: `0.25`.
- `--refine-l2 N`: exact L2 donor scan for the top `N` L1 survivor branches. Default: `0`.
- `--top N`: number of paths to print. Default: `10`.
- `--json`: emit machine-readable JSON on stdout; progress/status goes to stderr.
- `--help`: show command help.

Recommended deeper search:

```bash
slonks plan --owner 0x... --max-level 5 --beam-size 384 --per-anchor 24 --refine-l2 512 --top 10
```

Fast smoke search:

```bash
slonks plan --owner 0x... --max-level 2 --beam-size 64 --top 5
```

JSON output shape:

```ts
{
  ownerTokenCount: number;
  levels: Array<{
    inputLevel: number;
    outputLevel: number;
    poolSize: number;
    generated: number;
    kept: number;
  }>;
  refinements: Array<{
    level: number;
    survivors: number;
    donors: number;
    generated: number;
    kept: number;
  }>;
  best: Array<{
    label: string;
    level: number;
    survivorTokenId: number;
    tokenIds: number[];
    diffCount: number;
    slopLevel: number;
    steps: Array<{
      survivor: string;
      donor: string;
      result: string;
      resultLevel: number;
      diffCount: number;
      slopLevel: number;
    }>;
  }>;
  elapsedSeconds: number;
}
```

### `slonks global-l1`

Check every directed one-level merge between live unmerged tokens. The command
fetches `mergeLevel=0` tokens only, so burned tokens and tokens that already
survived a merge are ignored.

```bash
slonks global-l1 --top 20 --workers 8
```

Options:

- `--api URL`: API base URL. Default: `https://api.slonks.xyz`.
- `--top N`: number of pairs to print. Default: `20`.
- `--workers N`: local worker processes. Default: `min(cpu - 1, 8)`.
- `--max-tokens N`: testing cap; omit for the full unmerged collection.
- `--json`: emit machine-readable JSON.

## Local Development

```bash
cp .env.example .env
# Fill DATABASE_URL and either ALCHEMY_API_KEY or RPC_URL.

bun install
bun run db:generate
bun run db:migrate

# Terminal 1
bun run dev:web

# Terminal 2
bun run dev:indexer
```

Useful scripts:

- `bun run cli -- --help`
- `bun run slop:plan -- --help`
- `bun run typecheck`
- `bun run db:studio`

## Environment

- `DATABASE_URL`: required Postgres URL.
- `ALCHEMY_API_KEY`: preferred mainnet RPC provider key.
- `RPC_URL`: optional fallback RPC URL.
- `OPENSEA_API_KEY`: optional; enables `/listings`.
- `OPENSEA_SLUG`: optional; defaults to `slonks`.
- `START_BLOCK`: optional indexer start block override.
- `LOG_RANGE`: eth_getLogs block range. Default `2000`.
- `SYNC_INTERVAL_MS`: indexer loop delay. Default `12000`.
- `PORT`: web port. Default `8080`.
- `CORS_ORIGINS`: comma-separated allowlist. Empty means allow all.

## Fly Deploy

```bash
fly launch --no-deploy
fly secrets set DATABASE_URL=postgres://... ALCHEMY_API_KEY=...
fly secrets set OPENSEA_API_KEY=...
fly deploy
```

The `web` process serves HTTP. The `indexer` process runs the sync loop. Both share
the same Postgres database.
