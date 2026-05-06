import { describe, expect, test } from "bun:test";
import { sourceEmbeddingLocal } from "@blockhash/slonks-core/imageModel";
import { bytesToHex } from "@blockhash/slonks-core/hex";
import { blendEmbeddings } from "@blockhash/slonks-core/blend";
import { computeMergePreview, type TokenSourceRow } from "./mergePreviewCompute.ts";

function token(id: number, overrides: Partial<TokenSourceRow["token"]> = {}): TokenSourceRow["token"] {
  return {
    tokenId: id,
    exists: true,
    owner: "0x2052051a0474fb0b98283b3f38c13b0b0b6a3677",
    baseSourceId: id,
    sourceId: id,
    mergeLevel: 0,
    mergeEmbedding: null,
    generatedPixels: null,
    slop: null,
    slopLevel: null,
    mintedAtBlock: 1n,
    lastEventBlock: 2n,
    updatedAt: new Date(),
    ...overrides,
  };
}

function source(id: number, overrides: Partial<NonNullable<TokenSourceRow["source"]>> = {}): NonNullable<TokenSourceRow["source"]> {
  return {
    sourceId: id,
    punkType: "Male",
    attributesText: "Male",
    attributesJson: [],
    originalRgba: new Uint8Array(24 * 24 * 4),
    sourceEmbedding: sourceEmbeddingLocal(id),
    generatedPixels: new Uint8Array(24 * 24),
    baseSlopMask: new Uint8Array(72),
    baseSlop: 0,
    baseSlopLevel: 0,
    ...overrides,
  };
}

function rows(...items: TokenSourceRow[]): Map<number, TokenSourceRow> {
  return new Map(items.map((item) => [item.token.tokenId, item]));
}

describe("computeMergePreview", () => {
  test("validates impossible preview pairs", () => {
    expect(computeMergePreview({ survivorTokenId: 1, donorTokenId: 1 }, new Map())).toEqual({
      error: { survivorTokenId: 1, donorTokenId: 1, error: "cannot merge token into itself", status: 400 },
    });
    expect(computeMergePreview({ survivorTokenId: 1, donorTokenId: 2 }, rows({ token: token(2), source: source(2) }))).toEqual({
      error: { survivorTokenId: 1, donorTokenId: 2, error: "survivor token 1 not found", status: 404 },
    });
    expect(
      computeMergePreview(
        { survivorTokenId: 1, donorTokenId: 2 },
        rows({ token: token(1), source: source(1) }, { token: token(2, { exists: false }), source: source(2) }),
      ),
    ).toEqual({
      error: { survivorTokenId: 1, donorTokenId: 2, error: "donor token 2 not found", status: 404 },
    });
  });

  test("validates merge levels and source readiness", () => {
    expect(
      computeMergePreview(
        { survivorTokenId: 1, donorTokenId: 2 },
        rows({ token: token(1, { mergeLevel: 1 }), source: source(1) }, { token: token(2), source: source(2) }),
      ),
    ).toEqual({
      error: {
        survivorTokenId: 1,
        donorTokenId: 2,
        error: "merge level mismatch",
        status: 409,
        survivorMergeLevel: 1,
        donorMergeLevel: 0,
      },
    });
    expect(
      computeMergePreview(
        { survivorTokenId: 1, donorTokenId: 2 },
        rows(
          { token: token(1, { mergeLevel: 255 }), source: source(1) },
          { token: token(2, { mergeLevel: 255 }), source: source(2) },
        ),
      ),
    ).toEqual({
      error: { survivorTokenId: 1, donorTokenId: 2, error: "merge level overflow", status: 409 },
    });
    expect(
      computeMergePreview(
        { survivorTokenId: 1, donorTokenId: 2 },
        rows({ token: token(1), source: null }, { token: token(2), source: source(2) }),
      ),
    ).toEqual({
      error: { survivorTokenId: 1, donorTokenId: 2, error: "token embeddings are not ready", status: 409 },
    });
    expect(
      computeMergePreview(
        { survivorTokenId: 1, donorTokenId: 2 },
        rows(
          { token: token(1, { mergeEmbedding: sourceEmbeddingLocal(1), sourceId: null }), source: source(1) },
          { token: token(2), source: source(2) },
        ),
      ),
    ).toEqual({
      error: { survivorTokenId: 1, donorTokenId: 2, error: "token source data is not ready", status: 409 },
    });
  });

  test("computes a cross-owner preview without enforcing ownership", () => {
    const survivorEmbedding = sourceEmbeddingLocal(10);
    const donorEmbedding = sourceEmbeddingLocal(20);
    const result = computeMergePreview(
      { survivorTokenId: 10, donorTokenId: 20 },
      rows(
        {
          token: token(10, { mergeEmbedding: survivorEmbedding }),
          source: source(10),
        },
        {
          token: token(20, { owner: "bad-owner" }),
          source: source(20, { sourceEmbedding: donorEmbedding }),
        },
      ),
    );

    expect("item" in result).toBe(true);
    if (!("item" in result)) throw new Error("expected preview item");
    expect(result.item).toMatchObject({
      chainId: 1,
      survivorTokenId: 10,
      donorTokenId: 20,
      owner: "0x2052051A0474fB0B98283b3F38C13b0B0B6a3677",
      survivorOwner: "0x2052051A0474fB0B98283b3F38C13b0B0B6a3677",
      donorOwner: "bad-owner",
      survivorSourceId: 10,
      donorSourceId: 20,
      currentMergeLevel: 0,
      previewMergeLevel: 1,
      embedding: bytesToHex(blendEmbeddings(survivorEmbedding, donorEmbedding)),
    });
    expect(result.item.generatedPixels.length).toBe(2 + 24 * 24 * 2);
    expect(result.item.originalRgba.length).toBe(2 + 24 * 24 * 4 * 2);
    expect(result.item.slopMask.length).toBe(2 + 72 * 2);
  });
});
