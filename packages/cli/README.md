# slonks

Command-line tools for Slonks. The npm package is `@blockhash/slonks`, and the
installed binary is `slonks`.

The CLI fetches indexed token/listing data from `https://api.slonks.xyz`, then
runs merge search locally with `@blockhash/slonks-core`.

## Requirements

- Bun `>=1.2.0`

## Install

Run without installing:

```bash
bunx @blockhash/slonks mine --owner 0x...
bunx @blockhash/slonks --owner 0x...
```

Or install globally:

```bash
bun add -g @blockhash/slonks
slonks mine --owner 0x...
```

General commands:

- `slonks --help`: show top-level help.
- `slonks help <command>`: show help for a command.
- `slonks --version`: print the installed CLI version.

## `slonks mine`

Mine high-slop merge paths for a holder. The miner fetches indexed token
snapshots from `https://api.slonks.xyz`, then runs the combinatorial search
locally using the bundled Slonks model weights. By default it shows a live
terminal UI and keeps running, moving from level 1 to deeper/wider searches
until you stop it.

```bash
slonks mine --owner 0x2052051a0474fb0b98283b3f38c13b0b0b6a3677
```

Stop once a target slop value is found:

```bash
slonks mine --owner 0x... --target 330
```

Include currently listed Slonks up to `2x` floor in the same search pool:

```bash
slonks mine --owner 0x... --listings --budget 0.02 --target 330
```

Options:

- `--owner 0x...`: required holder address.
- `--target N`: stop when a path reaches slop `N`.
- `--listings`: include listed Slonks from `/listings`, capped to `2x` floor by default.
- `--budget ETH`: include listings, but only show paths at or below this total ETH spend.
- `--once`: run one strong mining pass and exit.
- `--top N`: number of paths to keep/show. Default: `10`.
- `--json`: emit final machine-readable JSON. Requires `--once` or `--target`.
- `--api URL`: API base URL. Default: `https://api.slonks.xyz`.
- `--help`: show command help.

JSON output shape:

```ts
{
  ownerTokenCount: number;
  poolSize: number;
  passes: Array<{
    pass: number;
    mode: "beam" | "deep-l2";
    maxLevel: number;
    beamSize: number;
    generated: number;
    best: MinedPath | null;
    targetHit: boolean;
  }>;
  best: MinedPath | null;
  target: number | null;
  targetHit: boolean;
  exitReason: string;
  elapsedSeconds: number;
}
```

## `slonks global-l1`

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

## Development

Run from the repo root:

```bash
bun run cli -- --help
bun run cli -- mine --owner 0x...
bun test packages/cli
```

## License

MIT
