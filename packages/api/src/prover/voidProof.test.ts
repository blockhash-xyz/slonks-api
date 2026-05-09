import { describe, expect, test } from "bun:test";
import { resolvedProofCacheKey } from "./cacheKey.ts";
import type { ResolvedVoidProofRequest } from "./voidProof.ts";

const request: ResolvedVoidProofRequest = {
  tokenId: 42,
  sourceId: 8620,
  inputSource: "source embedding",
  embedding: "0x3f0fcdef0811dcfa01dc",
  contracts: {
    slonks: "0x832233ddb7bcffd0ed53127dd6be3f1aa5845108",
    renderer: "0x5e68c484ef6dba6e6f27243e6c668674065c1066",
    imageModel: "0xca116243a2013ed33015c776ee37310b199ee80c",
    mergeManager: "0x7bda4820dbcfe471a2e23d3fa069c1cd261401e1",
    activeState: "0x886612a7a8dba8bbced8f86d26c1114857ccd9da",
  },
};

describe("resolvedProofCacheKey", () => {
  test("is stable across address casing", () => {
    expect(resolvedProofCacheKey(request)).toBe(
      resolvedProofCacheKey({
        ...request,
        contracts: {
          slonks: "0x832233ddB7bcFFD0eD53127DD6bE3F1Aa5845108",
          renderer: "0x5e68c484ef6Dba6e6f27243e6c668674065c1066",
          imageModel: "0xCa116243a2013ED33015c776ee37310b199Ee80c",
          mergeManager: "0x7bDa4820DbcFE471a2e23D3fA069C1CD261401e1",
          activeState: "0x886612a7a8dbA8bBceD8f86D26c1114857ccd9DA",
        },
      }),
    );
  });
});
