// Mirrors SlonksMergeManager._blendEmbeddings.
//
// solidity:
//   int16 current = int16(int8(uint8(currentEmbedding[i])));
//   int16 burned  = int16(int8(uint8(burnedEmbedding[i])));
//   blended[i] = bytes1(uint8(int8((current + burned) / 2)));
//
// (a + b) / 2 in solidity int division truncates toward zero; we replicate that.
// Bit-identical to slonks-web/src/lib/slonks/blend.ts.
export function blendEmbeddings(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length !== b.length) {
    throw new Error(`embedding length mismatch: ${a.length} vs ${b.length}`);
  }
  if (a.length === 0) throw new Error("embedding length must be > 0");
  if (a.length > 32) throw new Error(`embedding too wide: ${a.length}`);

  const out = new Uint8Array(a.length);
  blendEmbeddingsInto(a, b, out);
  return out;
}

export function blendEmbeddingsInto(a: Uint8Array, b: Uint8Array, out: Uint8Array): Uint8Array {
  if (a.length !== b.length || a.length !== out.length) {
    throw new Error(`embedding length mismatch: ${a.length} vs ${b.length} vs ${out.length}`);
  }
  if (a.length === 0) throw new Error("embedding length must be > 0");
  if (a.length > 32) throw new Error(`embedding too wide: ${a.length}`);

  for (let i = 0; i < a.length; i++) {
    const ai = a[i]! >= 128 ? a[i]! - 256 : a[i]!;
    const bi = b[i]! >= 128 ? b[i]! - 256 : b[i]!;
    const sum = ai + bi;
    const truncated = sum >= 0 ? Math.floor(sum / 2) : Math.ceil(sum / 2);
    out[i] = truncated < 0 ? truncated + 256 : truncated;
  }
  return out;
}
