import { describe, expect, test } from "bun:test";
import { diffPixels } from "./diff.ts";
import { PALETTE_RGBA, SLONK_PIXELS } from "./palette.ts";

describe("diffPixels", () => {
  test("returns an empty mask when generated palette pixels match original RGBA", () => {
    const generated = new Uint8Array(SLONK_PIXELS);
    const original = new Uint8Array(SLONK_PIXELS * 4);
    for (let pixel = 0; pixel < SLONK_PIXELS; pixel++) {
      original.set(PALETTE_RGBA.slice(0, 4), pixel * 4);
    }

    expect(diffPixels(generated, original)).toEqual({
      mask: new Uint8Array(SLONK_PIXELS / 8),
      count: 0,
      slopLevel: 0,
    });
  });

  test("sets mask bits MSB-first and computes slop level", () => {
    const generated = new Uint8Array(SLONK_PIXELS);
    const original = new Uint8Array(SLONK_PIXELS * 4);
    for (let pixel = 0; pixel < SLONK_PIXELS; pixel++) {
      original.set(PALETTE_RGBA.slice(0, 4), pixel * 4);
    }
    for (let pixel = 0; pixel < 51; pixel++) {
      generated[pixel] = 1;
    }

    const result = diffPixels(generated, original);

    expect(result.count).toBe(51);
    expect(result.slopLevel).toBe(1);
    expect(result.mask[0]).toBe(0xff);
    expect(result.mask[6]).toBe(0b11100000);
  });

  test("rejects wrong-sized pixel buffers", () => {
    expect(() => diffPixels(new Uint8Array(1), new Uint8Array(SLONK_PIXELS * 4))).toThrow("generated pixels expected");
    expect(() => diffPixels(new Uint8Array(SLONK_PIXELS), new Uint8Array(1))).toThrow("original RGBA expected");
  });
});
