import { describe, expect, test } from "bun:test";
import type { PublicClient } from "viem";
import { resolvedProofCacheKey } from "./cacheKey.ts";
import { resolveProofInput, type ResolvedVoidProofRequest } from "./voidProof.ts";

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
    activeState: "0x76c61b6140600429f50de5ac987e41672047cc28",
    claimContract: "0xe49eb1e77dfa92d00e3d0e2302524a066216ad63",
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
          activeState: "0x76C61B6140600429F50De5aC987E41672047cc28",
          claimContract: "0xE49eb1e77DFa92D00E3D0e2302524A066216aD63",
        },
      }),
    );
  });
});

describe("resolveProofInput", () => {
  test("prefers active embeddings", async () => {
    const client = mockClient([9964n, "0x1bf8eae1132003dc12db", "0x22f6e5010e4cfbf847e2"]);

    await expect(resolveProofInput(client, request.contracts, 5481)).resolves.toEqual({
      sourceId: 9964,
      inputSource: "active embedding",
      embedding: "0x1bf8eae1132003dc12db",
    });
  });

  test("uses merge embeddings when no active embedding exists", async () => {
    const client = mockClient([9964n, "0x", "0x22f6e5010e4cfbf847e2"]);

    await expect(resolveProofInput(client, request.contracts, 5481)).resolves.toEqual({
      sourceId: 9964,
      inputSource: "merge embedding",
      embedding: "0x22f6e5010e4cfbf847e2",
    });
  });

  test("does not fall back to source embedding on RPC read failure", async () => {
    const client = {
      multicall: async () => {
        throw new Error("rpc failed");
      },
    } as unknown as PublicClient;

    await expect(resolveProofInput(client, request.contracts, 5481)).rejects.toThrow("rpc failed");
  });
});

function mockClient(result: [bigint, `0x${string}`, `0x${string}`]): PublicClient {
  return {
    multicall: async (args: { allowFailure?: boolean }) => {
      expect(args.allowFailure).toBe(false);
      return result;
    },
  } as unknown as PublicClient;
}
