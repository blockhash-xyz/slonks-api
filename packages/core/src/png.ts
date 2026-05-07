import { deflateSync } from "node:zlib";
import { PALETTE_RGBA, PALETTE_SIZE, SLONK_PIXELS, SLONK_SIZE } from "./palette.ts";

export const DEFAULT_PNG_SCALE = 50;
export const MAX_PNG_SCALE = 100;
export const SLONK_BACKGROUND_RGBA = new Uint8Array([0x28, 0x31, 0x3d, 0xff]);

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC_TABLE = makeCrcTable();

export function encodeSlonkPng(pixels: Uint8Array, scale = DEFAULT_PNG_SCALE): Uint8Array {
  if (pixels.length !== SLONK_PIXELS) {
    throw new Error(`pixels expected ${SLONK_PIXELS} bytes, got ${pixels.length}`);
  }
  if (!Number.isInteger(scale) || scale < 1 || scale > MAX_PNG_SCALE) {
    throw new Error(`scale must be an integer from 1 to ${MAX_PNG_SCALE}`);
  }

  const width = SLONK_SIZE * scale;
  const height = SLONK_SIZE * scale;
  const stride = 1 + width * 4;
  const raw = new Uint8Array(stride * height);
  const row = new Uint8Array(stride);

  for (let sourceY = 0; sourceY < SLONK_SIZE; sourceY++) {
    row.fill(0);
    for (let sourceX = 0; sourceX < SLONK_SIZE; sourceX++) {
      const paletteIndex = pixels[sourceY * SLONK_SIZE + sourceX]! % PALETTE_SIZE;
      const paletteOffset = paletteIndex * 4;
      for (let dx = 0; dx < scale; dx++) {
        const out = 1 + (sourceX * scale + dx) * 4;
        writeCompositedPaletteColor(row, out, paletteOffset);
      }
    }

    for (let dy = 0; dy < scale; dy++) {
      raw.set(row, (sourceY * scale + dy) * stride);
    }
  }

  const ihdr = new Uint8Array(13);
  writeU32(ihdr, 0, width);
  writeU32(ihdr, 4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filters
  ihdr[12] = 0; // no interlace

  return concatBytes([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", new Uint8Array(deflateSync(raw, { level: 9 }))),
    pngChunk("IEND", new Uint8Array(0)),
  ]);
}

function writeCompositedPaletteColor(row: Uint8Array, offset: number, paletteOffset: number): void {
  const alpha = PALETTE_RGBA[paletteOffset + 3]!;
  if (alpha === 255) {
    row[offset] = PALETTE_RGBA[paletteOffset]!;
    row[offset + 1] = PALETTE_RGBA[paletteOffset + 1]!;
    row[offset + 2] = PALETTE_RGBA[paletteOffset + 2]!;
    row[offset + 3] = 255;
    return;
  }

  const inverseAlpha = 255 - alpha;
  row[offset] = Math.round(
    (PALETTE_RGBA[paletteOffset]! * alpha + SLONK_BACKGROUND_RGBA[0]! * inverseAlpha) / 255,
  );
  row[offset + 1] = Math.round(
    (PALETTE_RGBA[paletteOffset + 1]! * alpha + SLONK_BACKGROUND_RGBA[1]! * inverseAlpha) / 255,
  );
  row[offset + 2] = Math.round(
    (PALETTE_RGBA[paletteOffset + 2]! * alpha + SLONK_BACKGROUND_RGBA[2]! * inverseAlpha) / 255,
  );
  row[offset + 3] = 255;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  if (type.length !== 4) throw new Error("PNG chunk type must be 4 characters");
  const typeBytes = new TextEncoder().encode(type);
  const out = new Uint8Array(12 + data.length);
  writeU32(out, 0, data.length);
  out.set(typeBytes, 4);
  out.set(data, 8);
  writeU32(out, 8 + data.length, crc32(concatBytes([typeBytes, data])));
  return out;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function writeU32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < table.length; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}
