import { describe, expect, test } from "bun:test";
import {
  MODEL_PROOF_PUBLIC_INPUTS,
  SLONK_PIXELS,
  buildProverToml,
  bytesToHex,
  ensureEmbeddingHex,
  hexByteLength,
  isEmptyHexBytes,
  packBytesLittleEndian,
  packPixels,
  parseTokenId,
  splitBytes32Fields,
  stripHexPrefix,
} from "./proof.ts";

describe("proof helpers", () => {
  test("parses token ids", () => {
    expect(parseTokenId("0")).toBe(0);
    expect(parseTokenId("9999")).toBe(9999);
    expect(() => parseTokenId("-1")).toThrow("0 to 9999");
    expect(() => parseTokenId("10000")).toThrow("0 to 9999");
    expect(() => parseTokenId("1.5")).toThrow("0 to 9999");
  });

  test("validates and normalizes hex byte lengths", () => {
    expect(stripHexPrefix("0x1234")).toBe("1234");
    expect(stripHexPrefix("0X1234")).toBe("1234");
    expect(stripHexPrefix("1234")).toBe("1234");
    expect(hexByteLength("0x1234")).toBe(2);
    expect(isEmptyHexBytes("0x")).toBe(true);
    expect(isEmptyHexBytes(null)).toBe(true);
    expect(isEmptyHexBytes(undefined)).toBe(true);
    expect(isEmptyHexBytes("0x00")).toBe(false);
    expect(ensureEmbeddingHex("0x00010203040506070809", "embedding")).toBe("0x00010203040506070809");
    expect(() => hexByteLength("0x123")).toThrow("invalid hex length");
    expect(() => ensureEmbeddingHex("0x00", "embedding")).toThrow("expected 10 bytes");
  });

  test("packs embeddings and pixels for the circuit", () => {
    expect(packBytesLittleEndian(new Uint8Array([1, 2, 3]))).toBe(197121n);

    const pixels = new Uint8Array(SLONK_PIXELS);
    for (let i = 0; i < 16; i++) pixels[i] = i + 1;
    const packed = packPixels(pixels);
    expect(packed).toHaveLength(36);
    expect(packed[0]).toBe(packBytesLittleEndian(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])));
    expect(packed[1]).toBe(0n);
    expect(() => packPixels(new Uint8Array(1))).toThrow("expected 576 pixels");
  });

  test("writes Prover.toml", () => {
    const embedding = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const pixels = new Uint8Array(SLONK_PIXELS);
    const toml = buildProverToml(embedding, pixels);
    expect(toml).toContain('embedding = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]');
    expect(toml).toContain('packed_embedding_input = "42649378395939397566720"');
    expect(toml).toContain("packed_pixels = [");
    expect(() => buildProverToml(new Uint8Array(9), pixels)).toThrow("embedding expected 10 bytes");
  });

  test("formats proof bytes and public inputs", () => {
    const proofBytes = new Uint8Array([0, 1, 254, 255]);
    expect(bytesToHex(proofBytes)).toBe("0x0001feff");

    const publicInputs = new Uint8Array(MODEL_PROOF_PUBLIC_INPUTS * 32);
    publicInputs[31] = 1;
    publicInputs[63] = 2;
    const fields = splitBytes32Fields(publicInputs);
    expect(fields).toHaveLength(MODEL_PROOF_PUBLIC_INPUTS);
    expect(fields[0]).toBe("0x0000000000000000000000000000000000000000000000000000000000000001");
    expect(fields[1]).toBe("0x0000000000000000000000000000000000000000000000000000000000000002");
    expect(() => splitBytes32Fields(new Uint8Array(31))).toThrow("divisible by 32");
    expect(() => splitBytes32Fields(new Uint8Array(32))).toThrow("expected 37 public inputs");
  });
});
