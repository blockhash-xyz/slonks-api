import { describe, expect, test } from "bun:test";
import { includeParam, mergeDto, tokenListDto, transferDto } from "./dto.ts";

describe("API DTO helpers", () => {
  test("builds lightweight token list rows", () => {
    expect(
      tokenListDto(
        {
          tokenId: 7,
          owner: "0xabc",
          sourceId: 1,
          baseSourceId: 2,
          mergeLevel: 0,
          slop: 10,
          slopLevel: 0,
          punkType: "Male",
          attributesText: "Male, Hoodie",
        },
        false,
      ),
    ).toEqual({
      tokenId: 7,
      owner: "0xabc",
      sourceId: 1,
      baseSourceId: 2,
      mergeLevel: 0,
      slop: 10,
      slopLevel: 0,
      punkType: "Male",
      attributesText: "Male, Hoodie",
    });
  });

  test("optionally includes token pixel hex with token pixels preferred over source pixels", () => {
    expect(
      tokenListDto(
        {
          tokenId: 8,
          sourceId: null,
          baseSourceId: null,
          mergeLevel: 1,
          slop: null,
          slopLevel: null,
          punkType: null,
          attributesText: null,
          generatedPixels: new Uint8Array([1, 2]),
          sourceGeneratedPixels: new Uint8Array([3, 4]),
          originalRgba: new Uint8Array([5, 6]),
        },
        true,
      ),
    ).toMatchObject({
      tokenId: 8,
      generatedPixels: "0x0102",
      originalRgba: "0x0506",
    });

    expect(
      tokenListDto(
        {
          tokenId: 9,
          sourceId: null,
          baseSourceId: null,
          mergeLevel: 0,
          slop: null,
          slopLevel: null,
          punkType: null,
          attributesText: null,
          sourceGeneratedPixels: new Uint8Array([3, 4]),
        },
        true,
      ),
    ).toMatchObject({ generatedPixels: "0x0304", originalRgba: null });
  });

  test("detects include params case-insensitively", () => {
    expect(includeParam(undefined, "pixels")).toBe(false);
    expect(includeParam("tokens, Pixels", "pixels")).toBe(true);
    expect(includeParam("tokens", "pixels")).toBe(false);
  });

  test("serializes transfer and merge rows", () => {
    const date = new Date("2026-01-02T03:04:05.000Z");
    expect(
      transferDto({
        blockNumber: 123n,
        logIndex: 4,
        txHash: "0xtx",
        tokenId: 5,
        from: "0xfrom",
        to: "0xto",
        blockTimestamp: date,
      }),
    ).toEqual({
      blockNumber: "123",
      logIndex: 4,
      txHash: "0xtx",
      tokenId: 5,
      from: "0xfrom",
      to: "0xto",
      blockTimestamp: date.toISOString(),
    });

    expect(
      mergeDto({
        blockNumber: 456n,
        logIndex: 7,
        txHash: "0xmerge",
        survivorTokenId: 1,
        burnedTokenId: 2,
        burnedSourceId: 3,
        mergeLevel: 4,
        blockTimestamp: date,
      }),
    ).toEqual({
      blockNumber: "456",
      logIndex: 7,
      txHash: "0xmerge",
      survivorTokenId: 1,
      burnedTokenId: 2,
      burnedSourceId: 3,
      mergeLevel: 4,
      blockTimestamp: date.toISOString(),
    });
  });
});
