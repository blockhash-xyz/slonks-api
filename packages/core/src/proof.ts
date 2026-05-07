export const MODEL_EMBED_DIM = 10;
export const SLONK_PIXELS = 24 * 24;
export const PIXELS_PER_PACKED_CHUNK = 16;
export const MODEL_PACKED_PIXEL_CHUNKS = SLONK_PIXELS / PIXELS_PER_PACKED_CHUNK;
export const MODEL_PROOF_PUBLIC_INPUTS = 1 + MODEL_PACKED_PIXEL_CHUNKS;

export type ProofInputSource = "active embedding" | "merge embedding" | "source embedding";

export function parseTokenId(raw: string): number {
  const tokenId = Number(raw);
  if (!Number.isInteger(tokenId) || tokenId < 0 || tokenId > 9_999) {
    throw new Error("token id must be an integer from 0 to 9999");
  }
  return tokenId;
}

export function hexByteLength(hex: string): number {
  const clean = stripHexPrefix(hex);
  if (clean.length % 2 !== 0) throw new Error(`invalid hex length: ${clean.length}`);
  return clean.length / 2;
}

export function isEmptyHexBytes(hex: string | null | undefined): boolean {
  return !hex || stripHexPrefix(hex).length === 0;
}

export function ensureEmbeddingHex(hex: `0x${string}`, label: string): `0x${string}` {
  const length = hexByteLength(hex);
  if (length !== MODEL_EMBED_DIM) throw new Error(`${label} expected ${MODEL_EMBED_DIM} bytes, got ${length}`);
  return hex;
}

export function packBytesLittleEndian(bytes: Uint8Array): bigint {
  let packed = 0n;
  let factor = 1n;
  for (const value of bytes) {
    packed += BigInt(value) * factor;
    factor *= 256n;
  }
  return packed;
}

export function packPixels(pixels: Uint8Array): bigint[] {
  if (pixels.length !== SLONK_PIXELS) throw new Error(`expected ${SLONK_PIXELS} pixels, got ${pixels.length}`);

  const chunks: bigint[] = [];
  for (let chunkStart = 0; chunkStart < pixels.length; chunkStart += PIXELS_PER_PACKED_CHUNK) {
    chunks.push(packBytesLittleEndian(pixels.slice(chunkStart, chunkStart + PIXELS_PER_PACKED_CHUNK)));
  }
  return chunks;
}

export function buildProverToml(embedding: Uint8Array, pixels: Uint8Array): string {
  if (embedding.length !== MODEL_EMBED_DIM) {
    throw new Error(`embedding expected ${MODEL_EMBED_DIM} bytes, got ${embedding.length}`);
  }

  const packedEmbedding = packBytesLittleEndian(embedding);
  const packedPixels = packPixels(pixels);
  return [
    `embedding = [${Array.from(embedding, (value) => `"${value}"`).join(", ")}]`,
    `packed_embedding_input = "${packedEmbedding}"`,
    "packed_pixels = [",
    packedPixels.map((value) => `  "${value}"`).join(",\n"),
    "]",
    "",
  ].join("\n");
}

export function bytesToHex(bytes: Uint8Array): `0x${string}` {
  const alphabet = "0123456789abcdef";
  let out = "0x";
  for (const byte of bytes) out += alphabet[byte >> 4]! + alphabet[byte & 0x0f]!;
  return out as `0x${string}`;
}

export function splitBytes32Fields(bytes: Uint8Array): `0x${string}`[] {
  if (bytes.length % 32 !== 0) throw new Error(`public inputs length must be divisible by 32, got ${bytes.length}`);
  const fields: `0x${string}`[] = [];
  for (let offset = 0; offset < bytes.length; offset += 32) {
    fields.push(bytesToHex(bytes.slice(offset, offset + 32)));
  }
  if (fields.length !== MODEL_PROOF_PUBLIC_INPUTS) {
    throw new Error(`expected ${MODEL_PROOF_PUBLIC_INPUTS} public inputs, got ${fields.length}`);
  }
  return fields;
}

export function stripHexPrefix(hex: string): string {
  return hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
}
