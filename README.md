# slonks

Monorepo for the Slonks API, shared model code, and `slonks` CLI.

Public API:

```text
https://api.slonks.xyz
```

## Packages

- `packages/api`: private `@blockhash/slonks-api` package for the indexer, HTTP API, Fly config, Dockerfile, and migrations.
- `packages/core`: shared `@blockhash/slonks-core` package for attributes, embedding blending, local rendering, palette data, and slop math.
- `packages/cli`: public `@blockhash/slonks` package for the downloadable Slonks CLI.

## Docs

- [API package](packages/api/README.md): endpoint reference, PNG images, indexed events, void proof generation, data shapes, environment variables, and Fly deploy notes.
- [Core package](packages/core/README.md): shared rendering, blending, diff, palette, and attribute utilities.
- [CLI package](packages/cli/README.md): install and command reference for `slonks mine`, `slonks global-l1`, and `slonks prove`.

## Contracts

- Chain: Ethereum mainnet, `chainId: 1`
- Slonks deploy block: `24998760`
- `Slonks`: `0x832233ddb7bcffd0ed53127dd6be3f1aa5845108`
- `SlonksRenderer`: `0xA5CC6B20e0fA329Ca721Df832dfd609C104fB6fd`
- `SlonksImageModel`: `0xca116243a2013ed33015c776ee37310b199ee80c`
- `SlonksMergeManager`: `0x5D56D3527F470CA24aF864CC5571d8Fb8De785d2`
- `SLOP`: `0x999b49c0d1612e619a4a4f6280733184da025108`
- `SlopGameV2`: `0x76c61b6140600429f50de5ac987e41672047cc28`
- `SlopMergeLevelClaimExtension`: `0xF251D1D665229bd6A7045aCBfbeC132CD1934b06`
- `Previous SlopGame`: `0xb4ffbcce990a9a0b5f84722ba2d5db4e7bfc9d11`
- `False-start SlopGameV2`: `0x886612a7a8dba8bbced8f86d26c1114857ccd9da`
- `SlopDutchAuctionExtension`: `0xf79822c2331db455087b51b6c97e4064138bb635`
- `SlopSignedDutchAuctionExtension`: `0x9454262f710c04db1c5a1e016a3cc038857660a5`
- `HonkVerifier`: `0x5cbe9cbedc27dd4f082119586f5d924645064eb3`
- `CryptoPunksData`: `0x16f5a35647d6f03d5d3da7b35409d65ba03af3b2`

## Local Development

Install dependencies:

```bash
bun install
```

Run tests:

```bash
bun test
bun run test:coverage
```

Run the API locally:

```bash
bun run dev:web
bun run dev:indexer
```

Run the CLI from source:

```bash
bun run cli -- --help
bun run cli -- mine --owner 0x...
bun run cli -- prove 1819
```

Deploy the API:

```bash
bun run deploy:api
```

Deploy the proof-only Fly app:

```bash
bun run deploy:prover
```

## Repository

The npm org is `@blockhash`; the GitHub org is `@blockhash-xyz`.
