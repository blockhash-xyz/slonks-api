import { inflateSync } from "node:zlib";
import { describe, expect, test } from "bun:test";
import { PALETTE_RGBA, SLONK_PIXELS } from "./palette.ts";
import { encodeSlonkPng } from "./png.ts";

describe("encodeSlonkPng", () => {
  test("encodes scaled RGBA PNGs from palette pixels", () => {
    const pixels = new Uint8Array(SLONK_PIXELS);
    pixels.fill(1);
    pixels[0] = 2;

    const png = encodeSlonkPng(pixels, 2);
    expect(Array.from(png.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);

    const chunks = readChunks(png);
    const ihdr = chunks.get("IHDR")!;
    expect(readU32(ihdr, 0)).toBe(48);
    expect(readU32(ihdr, 4)).toBe(48);
    expect(ihdr[8]).toBe(8);
    expect(ihdr[9]).toBe(6);

    const raw = new Uint8Array(inflateSync(chunks.get("IDAT")!));
    const stride = 1 + 48 * 4;
    expect(raw.length).toBe(stride * 48);
    expect(raw[0]).toBe(0);
    expect(Array.from(raw.slice(1, 5))).toEqual(Array.from(PALETTE_RGBA.slice(2 * 4, 2 * 4 + 4)));
    expect(Array.from(raw.slice(5, 9))).toEqual(Array.from(PALETTE_RGBA.slice(2 * 4, 2 * 4 + 4)));
    expect(Array.from(raw.slice(1 + 2 * 4, 1 + 3 * 4))).toEqual(Array.from(PALETTE_RGBA.slice(1 * 4, 1 * 4 + 4)));
  });

  test("defaults to 1200x1200 output", () => {
    const chunks = readChunks(encodeSlonkPng(new Uint8Array(SLONK_PIXELS)));
    const ihdr = chunks.get("IHDR")!;
    expect(readU32(ihdr, 0)).toBe(1200);
    expect(readU32(ihdr, 4)).toBe(1200);
  });

  test("validates input sizes", () => {
    expect(() => encodeSlonkPng(new Uint8Array(1), 1)).toThrow("pixels expected 576 bytes");
    expect(() => encodeSlonkPng(new Uint8Array(SLONK_PIXELS), 0)).toThrow("scale must be an integer");
    expect(() => encodeSlonkPng(new Uint8Array(SLONK_PIXELS), 101)).toThrow("scale must be an integer");
  });
});

function readChunks(png: Uint8Array): Map<string, Uint8Array> {
  const chunks = new Map<string, Uint8Array>();
  let offset = 8;
  while (offset < png.length) {
    const length = readU32(png, offset);
    const type = new TextDecoder().decode(png.slice(offset + 4, offset + 8));
    chunks.set(type, png.slice(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  return chunks;
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! << 24) >>> 0) +
    (bytes[offset + 1]! << 16) +
    (bytes[offset + 2]! << 8) +
    bytes[offset + 3]!
  );
}
