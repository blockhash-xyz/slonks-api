# slonks

Command-line tools for Slonks.

## Run

```bash
bunx @blockhash/slonks plan --owner 0x...
bunx @blockhash/slonks --owner 0x...
```

Or install globally:

```bash
bun add -g @blockhash/slonks
slonks plan --owner 0x...
```

General commands:

- `slonks --help`: show top-level help.
- `slonks help <command>`: show help for a command.
- `slonks --version`: print the installed CLI version.

## `slonks plan`

Find high-slop merge paths for a holder. The planner fetches indexed token
snapshots from `https://api.slonks.xyz`, then runs the combinatorial merge search
locally using the bundled Slonks model weights.

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
- `--beam-size N`: states to keep per generated level. Default: `32`.
- `--l1-frontier N`: L1 survivor frontier size for `deep-l2`. Default: `512`.
- `--l2-budget N`: valid L2 previews to scan in `deep-l2`. Default: `1000000`; `0` means no cap.
- `--per-anchor N`: diversity cap per survivor anchor inside the beam. Default: `4`.
- `--diversity N`: `0..1` fraction of each beam reserved for embedding-diverse candidates. Default: `0.25`.
- `--refine-l2 N`: exact L2 donor scan for the top `N` L1 survivor branches. Default: `0`.
- `--top N`: number of paths to print. Default: `10`.
- `--json`: emit machine-readable JSON on stdout.
- `--help`: show command help.

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
