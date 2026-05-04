import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PALETTE_RGBA, SLONK_PIXELS } from "./palette.ts";
import {
  diffRenderedEmbeddingLocal,
  clearImageModelCaches,
  renderEmbeddingPixelsLocal,
  sourceEmbeddingLocal,
} from "./imageModel.ts";
import { bytesToHex } from "./hex.ts";

afterEach(() => {
  delete process.env.SLONKS_MODEL_WEIGHTS_PATH;
  delete process.env.SLONKS_RENDER_CACHE_SIZE;
  clearImageModelCaches();
});

describe("image model", () => {
  test("loads source embeddings and wraps source ids by vocabulary size", () => {
    expect(sourceEmbeddingLocal(0).length).toBe(10);
    expect([...sourceEmbeddingLocal(0)]).toEqual([...sourceEmbeddingLocal(10_000)]);
  });

  test("rejects invalid source ids and bad model weight files", () => {
    expect(() => sourceEmbeddingLocal(-1)).toThrow("invalid source id");
    expect(() => sourceEmbeddingLocal(1.1)).toThrow("invalid source id");

    const dir = mkdtempSync(join(tmpdir(), "slonks-weights-"));
    process.env.SLONKS_MODEL_WEIGHTS_PATH = join(dir, "bad.bin");
    writeFileSync(process.env.SLONKS_MODEL_WEIGHTS_PATH, new Uint8Array([1, 2, 3]));
    clearImageModelCaches();

    expect(() => sourceEmbeddingLocal(0)).toThrow("model weights expected");
  });

  test("renders embedding pixels from bytes or hex and reuses the render cache", () => {
    process.env.SLONKS_RENDER_CACHE_SIZE = "1";
    const embeddingA = sourceEmbeddingLocal(0);
    const embeddingB = sourceEmbeddingLocal(1);
    const renderedA = renderEmbeddingPixelsLocal(embeddingA);
    const cachedA = renderEmbeddingPixelsLocal(bytesToHex(embeddingA));
    const renderedB = renderEmbeddingPixelsLocal(embeddingB);

    expect(renderedA.length).toBe(SLONK_PIXELS);
    expect([...cachedA]).toEqual([...renderedA]);
    expect(renderedB.length).toBe(SLONK_PIXELS);
    expect(() => renderEmbeddingPixelsLocal(new Uint8Array(9))).toThrow("embedding length expected 10");
  });

  test("diffs rendered embeddings against original RGBA", () => {
    const embedding = sourceEmbeddingLocal(0);
    const generated = renderEmbeddingPixelsLocal(embedding);
    const original = new Uint8Array(SLONK_PIXELS * 4);
    for (let pixel = 0; pixel < SLONK_PIXELS; pixel++) {
      const paletteIndex = generated[pixel]!;
      original.set(PALETTE_RGBA.slice(paletteIndex * 4, paletteIndex * 4 + 4), pixel * 4);
    }

    expect(diffRenderedEmbeddingLocal(bytesToHex(embedding), original)).toEqual({ count: 0, slopLevel: 0 });
    original[0] = original[0] === 0 ? 1 : 0;
    expect(diffRenderedEmbeddingLocal(embedding, original).count).toBe(1);
    expect(() => diffRenderedEmbeddingLocal(new Uint8Array(9), original)).toThrow("embedding length expected 10");
    expect(() => diffRenderedEmbeddingLocal(embedding, new Uint8Array(1))).toThrow("original RGBA expected");
  });
});
