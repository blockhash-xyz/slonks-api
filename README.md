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
- `SlonksRenderer`: `0x12b6f7572bcdd175b97b080ce3a6b2211a59c299`
- `SlonksImageModel`: `0xca116243a2013ed33015c776ee37310b199ee80c`
- `SlonksMergeManager`: `0x3e5bb2a724dbe9a6afe04ae7581639367693f51c`
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

## Repository

The npm org is `@blockhash`; the GitHub org is `@blockhash-xyz`.
