import { describe, expect, test } from "bun:test";
import { blendEmbeddings, blendEmbeddingsInto } from "./blend.ts";

describe("blendEmbeddings", () => {
  test("averages signed bytes with Solidity-style truncation toward zero", () => {
    const a = new Uint8Array([2, 255, 128, 5]);
    const b = new Uint8Array([5, 2, 127, 250]);

    expect([...blendEmbeddings(a, b)]).toEqual([3, 0, 0, 0]);
  });

  test("writes into a caller-provided output buffer", () => {
    const out = new Uint8Array(2);
    const returned = blendEmbeddingsInto(new Uint8Array([10, 250]), new Uint8Array([12, 252]), out);

    expect(returned).toBe(out);
    expect([...out]).toEqual([11, 251]);
  });

  test("rejects mismatched, empty, and overly-wide embeddings", () => {
    expect(() => blendEmbeddings(new Uint8Array([1]), new Uint8Array([1, 2]))).toThrow("1 vs 2");
    expect(() => blendEmbeddings(new Uint8Array(), new Uint8Array())).toThrow("must be > 0");
    expect(() => blendEmbeddings(new Uint8Array(33), new Uint8Array(33))).toThrow("too wide");
    expect(() => blendEmbeddingsInto(new Uint8Array([1]), new Uint8Array([1]), new Uint8Array(2))).toThrow(
      "1 vs 1 vs 2",
    );
    expect(() => blendEmbeddingsInto(new Uint8Array(), new Uint8Array(), new Uint8Array())).toThrow("must be > 0");
    expect(() => blendEmbeddingsInto(new Uint8Array(33), new Uint8Array(33), new Uint8Array(33))).toThrow("too wide");
  });
});
