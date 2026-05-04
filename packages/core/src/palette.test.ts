import { describe, expect, test } from "bun:test";
import { decodePaletteHex, PALETTE_RGBA, PALETTE_SIZE, SLONK_PIXELS, SLONK_SIZE } from "./palette.ts";

describe("palette", () => {
  test("decodes RGBA palette hex", () => {
    expect(decodePaletteHex("00000000ffffffff", 2)).toEqual(new Uint8Array([0, 0, 0, 0, 255, 255, 255, 255]));
    expect(PALETTE_RGBA.length).toBe(PALETTE_SIZE * 4);
    expect(SLONK_SIZE).toBe(24);
    expect(SLONK_PIXELS).toBe(576);
  });

  test("rejects palette hex with the wrong size", () => {
    expect(() => decodePaletteHex("00", 1)).toThrow("palette length mismatch");
  });
});
