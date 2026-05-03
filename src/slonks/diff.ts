import { PALETTE_RGBA, PALETTE_SIZE, SLONK_PIXELS } from "./palette.ts";

export type DiffResult = {
  mask: Uint8Array; // 72 bytes, MSB-first within each byte
  count: number;
  slopLevel: number;
};

// Mirrors SlonksRenderer._diffMaskAndCount: palette-index pixels vs raw RGBA.
// Bit-identical to slonks-web/src/lib/slonks/diff.ts.
export function diffPixels(generatedPixels: Uint8Array, originalRgba: Uint8Array): DiffResult {
  if (generatedPixels.length !== SLONK_PIXELS) {
    throw new Error(`generated pixels expected ${SLONK_PIXELS} bytes, got ${generatedPixels.length}`);
  }
  if (originalRgba.length !== SLONK_PIXELS * 4) {
    throw new Error(`original RGBA expected ${SLONK_PIXELS * 4} bytes, got ${originalRgba.length}`);
  }

  const mask = new Uint8Array(SLONK_PIXELS / 8);
  let count = 0;

  for (let pixel = 0; pixel < SLONK_PIXELS; pixel++) {
    const paletteIndex = generatedPixels[pixel]! % PALETTE_SIZE;
    const pOffset = paletteIndex * 4;
    const rOffset = pixel * 4;

    const differs =
      PALETTE_RGBA[pOffset] !== originalRgba[rOffset] ||
      PALETTE_RGBA[pOffset + 1] !== originalRgba[rOffset + 1] ||
      PALETTE_RGBA[pOffset + 2] !== originalRgba[rOffset + 2] ||
      PALETTE_RGBA[pOffset + 3] !== originalRgba[rOffset + 3];

    if (differs) {
      const byteIndex = pixel >> 3;
      mask[byteIndex]! |= 1 << (7 - (pixel % 8));
      count++;
    }
  }

  return { mask, count, slopLevel: Math.floor(count / 50) };
}
