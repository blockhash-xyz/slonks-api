import { describe, expect, test } from "bun:test";
import { keccak256, recoverAddress, toHex, type Hex } from "viem";
import {
  normalizeDigest,
  normalizeSignerPrivateKey,
  revivalSeedFromSignature,
  revivalSourcePercent,
  signRevivalClaimDigest,
} from "./signature.ts";

const privateKey = "0x1111111111111111111111111111111111111111111111111111111111111111" as const;
const digest = keccak256(toHex("claimDigest"));

describe("revival claim signatures", () => {
  test("normalizes signer inputs", () => {
    expect(normalizeSignerPrivateKey(undefined)).toBeNull();
    expect(normalizeSignerPrivateKey(` ${privateKey} `)).toBe(privateKey);
    expect(() => normalizeSignerPrivateKey("0x1234")).toThrow("SLONKS_SIGNER_PRIVATE_KEY");
    expect(normalizeDigest(digest)).toBe(digest);
    expect(() => normalizeDigest("0x1234")).toThrow("claim digest");
  });

  test("signs the raw claim digest deterministically", async () => {
    const first = await signRevivalClaimDigest(privateKey, digest);
    const second = await signRevivalClaimDigest(privateKey, digest);
    const recovered = await recoverAddress({ hash: digest, signature: first.signature });

    expect(first).toEqual(second);
    expect(first.signature).toMatch(/^0x[0-9a-f]{130}$/i);
    expect(recovered).toBe(first.signer);
  });

  test("derives the same entropy inputs as the signed Dutch contract", async () => {
    const { signature } = await signRevivalClaimDigest(privateKey, digest);
    const seed = revivalSeedFromSignature(signature);

    expect(seed).toBe(keccak256(signature));
    expect(() => revivalSeedFromSignature("0x1234")).toThrow("65 bytes");
  });

  test("maps source-percent rolls to contract buckets", () => {
    const seen = new Set<number>();
    for (let i = 0; seen.size < 5 && i < 10_000; i++) {
      seen.add(revivalSourcePercent(toHex(i, { size: 32 }) as Hex));
    }

    expect([...seen].sort((a, b) => a - b)).toEqual([0, 25, 50, 75, 100]);
  });
});
