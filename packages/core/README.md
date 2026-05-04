# @blockhash/slonks-core

Shared Slonks utilities for the API and CLI. This package keeps the local
rendering, merge, palette, attribute, and diff logic in one place so API
previews and CLI mining use the same math.

## Install

```bash
bun add @blockhash/slonks-core
```

Inside this monorepo it is consumed by `@blockhash/slonks-api` and
`@blockhash/slonks`.

## Exports

- `@blockhash/slonks-core/attributes`: parse CryptoPunks attribute text into token traits.
- `@blockhash/slonks-core/blend`: blend two 10-byte embeddings with Solidity-compatible integer rounding.
- `@blockhash/slonks-core/diff`: compare generated palette pixels to original RGBA and produce diff count, slop level, and mask.
- `@blockhash/slonks-core/hex`: convert between `Uint8Array` and `0x` hex.
- `@blockhash/slonks-core/imageModel`: load bundled model weights, render source/merge embeddings, and compute rendered diff locally.
- `@blockhash/slonks-core/palette`: CryptoPunks palette constants and decoder.

## Model Data

The package includes `assets/model_weights_slonk_candidate_10k_18x10_canonical.bin`.
By default `imageModel` loads that bundled file. Set
`SLONKS_MODEL_WEIGHTS_PATH` to point at another compatible weights file when
testing a different model artifact.

Important dimensions:

- Source vocabulary: `10,000`
- Embedding width: `10` signed bytes
- Output image: `24 x 24`, or `576` palette indexes
- Original image input: `2304` RGBA bytes
- Diff mask: `72` bytes, MSB-first within each byte

## Examples

Blend two source embeddings and diff the rendered result against one original:

```ts
import { blendEmbeddings } from "@blockhash/slonks-core/blend";
import { diffRenderedEmbeddingLocal, sourceEmbeddingLocal } from "@blockhash/slonks-core/imageModel";

const survivorEmbedding = sourceEmbeddingLocal(1819);
const donorEmbedding = sourceEmbeddingLocal(7606);
const blended = blendEmbeddings(survivorEmbedding, donorEmbedding);

const originalRgba = new Uint8Array(24 * 24 * 4);
const diff = diffRenderedEmbeddingLocal(blended, originalRgba);
```

Parse CryptoPunks attribute text:

```ts
import { parseAttributesText } from "@blockhash/slonks-core/attributes";

const { punkType, attributes } = parseAttributesText("Male, Hoodie, Earring");
```

Compute a diff from already-rendered palette pixels:

```ts
import { diffPixels } from "@blockhash/slonks-core/diff";

const generatedPixels = new Uint8Array(24 * 24);
const originalRgba = new Uint8Array(24 * 24 * 4);
const { count, slopLevel, mask } = diffPixels(generatedPixels, originalRgba);
```

## Development

Run from the repo root:

```bash
bun test packages/core
bun run test:core
```

## License

MIT
