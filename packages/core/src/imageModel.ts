import { readFileSync } from "node:fs";
import type { Hex } from "viem";
import { bytesToHex, hexToBytes } from "./hex.ts";
import { PALETTE_RGBA, PALETTE_SIZE } from "./palette.ts";

const VOCAB_SIZE = 10_000;
const EMBED_DIM = 10;
const CANDIDATES = 18;
const SLONK_PIXELS = 24 * 24;

const EMBEDDING_OFFSET = 0;
const CANDIDATE_OFFSET = VOCAB_SIZE * EMBED_DIM;
const HEAD_OFFSET = CANDIDATE_OFFSET + SLONK_PIXELS * CANDIDATES;
const WEIGHT_SIZE = HEAD_OFFSET + SLONK_PIXELS * CANDIDATES * EMBED_DIM;
const DEFAULT_WEIGHTS_URL = new URL("../assets/model_weights_slonk_candidate_10k_18x10_canonical.bin", import.meta.url);
let cachedWeights: Uint8Array | null = null;
let cachedSignedWeights: Int8Array | null = null;
const renderCache = new Map<string, Uint8Array>();

export function sourceEmbeddingLocal(sourceId: number): Uint8Array {
  if (!Number.isInteger(sourceId) || sourceId < 0) {
    throw new Error(`invalid source id ${sourceId}`);
  }
  const weights = modelWeights();
  const safeSource = sourceId % VOCAB_SIZE;
  return weights.slice(EMBEDDING_OFFSET + safeSource * EMBED_DIM, EMBEDDING_OFFSET + (safeSource + 1) * EMBED_DIM);
}

export function renderEmbeddingPixelsLocal(embeddingInput: Uint8Array | Hex): Uint8Array {
  const embedding = typeof embeddingInput === "string" ? hexToBytes(embeddingInput) : embeddingInput;
  if (embedding.length !== EMBED_DIM) {
    throw new Error(`embedding length expected ${EMBED_DIM}, got ${embedding.length}`);
  }

  const cacheKey = bytesToHex(embedding);
  const cached = renderCache.get(cacheKey);
  if (cached) return cached.slice();

  const weights = modelWeights();
  const signedWeights = signedModelWeights();
  const e0 = signedByte(embedding[0]!);
  const e1 = signedByte(embedding[1]!);
  const e2 = signedByte(embedding[2]!);
  const e3 = signedByte(embedding[3]!);
  const e4 = signedByte(embedding[4]!);
  const e5 = signedByte(embedding[5]!);
  const e6 = signedByte(embedding[6]!);
  const e7 = signedByte(embedding[7]!);
  const e8 = signedByte(embedding[8]!);
  const e9 = signedByte(embedding[9]!);
  const pixels = new Uint8Array(SLONK_PIXELS);

  for (let pixel = 0; pixel < SLONK_PIXELS; pixel++) {
    const candidateBase = CANDIDATE_OFFSET + pixel * CANDIDATES;
    const headBase = HEAD_OFFSET + pixel * CANDIDATES * EMBED_DIM;
    let best = Number.NEGATIVE_INFINITY;
    let bestSlot = 0;

    for (let slot = 0; slot < CANDIDATES; slot++) {
      const slotOffset = headBase + slot * EMBED_DIM;
      const acc =
        e0 * signedWeights[slotOffset]! +
        e1 * signedWeights[slotOffset + 1]! +
        e2 * signedWeights[slotOffset + 2]! +
        e3 * signedWeights[slotOffset + 3]! +
        e4 * signedWeights[slotOffset + 4]! +
        e5 * signedWeights[slotOffset + 5]! +
        e6 * signedWeights[slotOffset + 6]! +
        e7 * signedWeights[slotOffset + 7]! +
        e8 * signedWeights[slotOffset + 8]! +
        e9 * signedWeights[slotOffset + 9]!;
      if (acc > best) {
        best = acc;
        bestSlot = slot;
      }
    }

    pixels[pixel] = weights[candidateBase + bestSlot]!;
  }

  rememberRender(cacheKey, pixels);
  return pixels;
}

export function diffRenderedEmbeddingLocal(
  embeddingInput: Uint8Array | Hex,
  originalRgba: Uint8Array,
): { count: number; slopLevel: number } {
  const embedding = typeof embeddingInput === "string" ? hexToBytes(embeddingInput) : embeddingInput;
  if (embedding.length !== EMBED_DIM) {
    throw new Error(`embedding length expected ${EMBED_DIM}, got ${embedding.length}`);
  }
  if (originalRgba.length !== SLONK_PIXELS * 4) {
    throw new Error(`original RGBA expected ${SLONK_PIXELS * 4} bytes, got ${originalRgba.length}`);
  }

  const weights = modelWeights();
  const signedWeights = signedModelWeights();
  const e0 = signedByte(embedding[0]!);
  const e1 = signedByte(embedding[1]!);
  const e2 = signedByte(embedding[2]!);
  const e3 = signedByte(embedding[3]!);
  const e4 = signedByte(embedding[4]!);
  const e5 = signedByte(embedding[5]!);
  const e6 = signedByte(embedding[6]!);
  const e7 = signedByte(embedding[7]!);
  const e8 = signedByte(embedding[8]!);
  const e9 = signedByte(embedding[9]!);
  let count = 0;

  for (let pixel = 0; pixel < SLONK_PIXELS; pixel++) {
    const candidateBase = CANDIDATE_OFFSET + pixel * CANDIDATES;
    const headBase = HEAD_OFFSET + pixel * CANDIDATES * EMBED_DIM;
    let best = Number.NEGATIVE_INFINITY;
    let bestSlot = 0;

    for (let slot = 0; slot < CANDIDATES; slot++) {
      const slotOffset = headBase + slot * EMBED_DIM;
      const acc =
        e0 * signedWeights[slotOffset]! +
        e1 * signedWeights[slotOffset + 1]! +
        e2 * signedWeights[slotOffset + 2]! +
        e3 * signedWeights[slotOffset + 3]! +
        e4 * signedWeights[slotOffset + 4]! +
        e5 * signedWeights[slotOffset + 5]! +
        e6 * signedWeights[slotOffset + 6]! +
        e7 * signedWeights[slotOffset + 7]! +
        e8 * signedWeights[slotOffset + 8]! +
        e9 * signedWeights[slotOffset + 9]!;
      if (acc > best) {
        best = acc;
        bestSlot = slot;
      }
    }

    const paletteIndex = weights[candidateBase + bestSlot]! % PALETTE_SIZE;
    const paletteOffset = paletteIndex * 4;
    const rgbaOffset = pixel * 4;
    if (
      PALETTE_RGBA[paletteOffset] !== originalRgba[rgbaOffset] ||
      PALETTE_RGBA[paletteOffset + 1] !== originalRgba[rgbaOffset + 1] ||
      PALETTE_RGBA[paletteOffset + 2] !== originalRgba[rgbaOffset + 2] ||
      PALETTE_RGBA[paletteOffset + 3] !== originalRgba[rgbaOffset + 3]
    ) {
      count++;
    }
  }

  return { count, slopLevel: Math.floor(count / 50) };
}

function modelWeights(): Uint8Array {
  if (cachedWeights) return cachedWeights;

  const path = process.env.SLONKS_MODEL_WEIGHTS_PATH || DEFAULT_WEIGHTS_URL;
  const weights = new Uint8Array(readFileSync(path));
  if (weights.length !== WEIGHT_SIZE) {
    throw new Error(`model weights expected ${WEIGHT_SIZE} bytes, got ${weights.length}`);
  }
  cachedWeights = weights;
  return weights;
}

function signedModelWeights(): Int8Array {
  if (cachedSignedWeights) return cachedSignedWeights;
  const weights = modelWeights();
  cachedSignedWeights = new Int8Array(weights.buffer, weights.byteOffset, weights.byteLength);
  return cachedSignedWeights;
}

function signedByte(value: number): number {
  return value >= 128 ? value - 256 : value;
}

function rememberRender(key: string, pixels: Uint8Array): void {
  renderCache.set(key, pixels);
  if (renderCache.size <= maxRenderCache()) return;
  const first = renderCache.keys().next().value;
  if (first) renderCache.delete(first);
}

function maxRenderCache(): number {
  return Number(process.env.SLONKS_RENDER_CACHE_SIZE ?? 20_000);
}

export function clearImageModelCaches(): void {
  cachedWeights = null;
  cachedSignedWeights = null;
  renderCache.clear();
}
