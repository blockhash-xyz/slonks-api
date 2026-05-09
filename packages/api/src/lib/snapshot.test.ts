import { describe, expect, test } from "bun:test";
import { buildCollectionStatus, buildTokenSnapshot } from "./snapshot.ts";

const activeGame = "0x76c61b6140600429f50de5ac987e41672047cc28";

const collection = {
  id: 1,
  totalSupply: 10,
  remainingSourceIds: 9_990,
  revealed: true,
  revealBlockNumber: 123n,
  revealSeed: "0xseed",
  shuffleOffset: 42,
  sourcesPrecomputed: 10_000,
  lastIndexedBlock: 456n,
  proofWarmupLastIndexedBlock: 0n,
  gameClaimsLastIndexedBlock: 0n,
  updatedAt: new Date(),
};

const token = {
  tokenId: 1,
  exists: true,
  owner: "0x2052051a0474fb0b98283b3f38c13b0b0b6a3677",
  baseSourceId: 10,
  sourceId: 20,
  mergeLevel: 1,
  mergeEmbedding: new Uint8Array([9, 8]),
  generatedPixels: new Uint8Array([7, 6]),
  slop: 55,
  slopLevel: 1,
  mintedAtBlock: 1n,
  lastEventBlock: 2n,
  updatedAt: new Date(),
};

const source = {
  sourceId: 20,
  punkType: "Male",
  attributesText: "Male, Hoodie",
  attributesJson: [{ trait_type: "Type", value: "Male" }],
  originalRgba: new Uint8Array([1, 2]),
  sourceEmbedding: new Uint8Array([3, 4]),
  generatedPixels: new Uint8Array([5, 6]),
  baseSlopMask: new Uint8Array([0]),
  baseSlop: 10,
  baseSlopLevel: 0,
};

describe("buildTokenSnapshot", () => {
  test("returns null for missing tokens", () => {
    expect(buildTokenSnapshot(null, null, collection)).toBeNull();
  });

  test("builds revealed snapshots and prefers token merge bytes", () => {
    expect(buildTokenSnapshot(token, source, collection)).toMatchObject({
      chainId: 1,
      tokenId: "1",
      status: "active",
      exists: true,
      owner: "0x2052051A0474fB0B98283b3F38C13b0B0B6a3677",
      claimStatus: null,
      claimRecipient: null,
      lockedOn: null,
      revealed: true,
      baseSourceId: 10,
      sourceId: 20,
      punkAttributesText: "Male, Hoodie",
      attributes: [{ trait_type: "Type", value: "Male" }],
      mergeLevel: 1,
      embedding: "0x0908",
      generatedPixels: "0x0706",
      originalRgba: "0x0102",
      slop: 55,
      slopLevel: 1,
    });
  });

  test("marks claim-custodied tokens as locked or voided", () => {
    const gameToken = { ...token, owner: activeGame };
    expect(buildTokenSnapshot(gameToken, source, collection, { status: "pending", recipient: token.owner })).toMatchObject({
      status: "locked",
      claimStatus: "pending",
      claimRecipient: "0x2052051A0474fB0B98283b3F38C13b0B0B6a3677",
      lockedOn: "0x76C61B6140600429F50De5aC987E41672047cc28",
    });
    expect(buildTokenSnapshot(gameToken, source, collection, { status: "claimed", recipient: token.owner })).toMatchObject({
      status: "voided",
      claimStatus: "claimed",
    });
    expect(buildTokenSnapshot(token, source, collection, { status: "unlocked", recipient: token.owner })).toMatchObject({
      status: "active",
      claimStatus: "unlocked",
      lockedOn: null,
    });
  });

  test("keeps historical claim rows active once a token leaves game custody", () => {
    expect(buildTokenSnapshot(token, source, collection, { status: "claimed", recipient: token.owner })).toMatchObject({
      status: "active",
      claimStatus: "claimed",
      lockedOn: null,
    });
  });

  test("returns burned tokens with source-backed visual data", () => {
    expect(
      buildTokenSnapshot(
        {
          ...token,
          exists: false,
          owner: null,
          mergeLevel: 0,
          mergeEmbedding: null,
          generatedPixels: null,
          slop: null,
          slopLevel: null,
        },
        source,
        collection,
      ),
    ).toMatchObject({
      status: "burned",
      exists: false,
      owner: null,
      sourceId: 20,
      punkAttributesText: "Male, Hoodie",
      attributes: [{ trait_type: "Type", value: "Male" }],
      embedding: "0x0304",
      generatedPixels: "0x0506",
      originalRgba: "0x0102",
      slop: 10,
      slopLevel: 0,
    });
  });

  test("hides source data unless collection is revealed and source is ready", () => {
    expect(buildTokenSnapshot({ ...token, owner: "not-an-address" }, source, collection)).toMatchObject({
      owner: "not-an-address",
    });
    expect(buildTokenSnapshot(token, null, collection)).toMatchObject({ sourceId: null, embedding: null });
    expect(buildTokenSnapshot(token, source, { ...collection, revealed: false })).toMatchObject({
      revealed: false,
      sourceId: null,
    });
  });

  test("falls back to source bytes when token merge bytes are absent", () => {
    expect(buildTokenSnapshot({ ...token, mergeEmbedding: null, generatedPixels: null }, source, collection)).toMatchObject({
      embedding: "0x0304",
      generatedPixels: "0x0506",
    });
  });
});

describe("buildCollectionStatus", () => {
  test("reports all collection phases", () => {
    expect(buildCollectionStatus({ ...collection, revealed: true }).phase).toBe("revealed");
    expect(buildCollectionStatus({ ...collection, revealed: false, revealBlockNumber: 1n }).phase).toBe("reveal-committed");
    expect(
      buildCollectionStatus({ ...collection, revealed: false, revealBlockNumber: 0n, totalSupply: 10_000 }).phase,
    ).toBe("pre-reveal");
    expect(buildCollectionStatus({ ...collection, revealed: false, revealBlockNumber: 0n, totalSupply: 1 })).toMatchObject({
      chainId: 1,
      maxSupply: 10_000,
      phase: "minting",
      revealBlockNumber: 0,
      lastIndexedBlock: 456,
    });
  });
});
