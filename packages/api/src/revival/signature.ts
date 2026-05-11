import { concatHex, getAddress, isHex, keccak256, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const PRIVATE_KEY_RE = /^0x[0-9a-fA-F]{64}$/;
const DIGEST_RE = /^0x[0-9a-fA-F]{64}$/;
const SIGNATURE_RE = /^0x[0-9a-fA-F]{130}$/;

export type RevivalClaimSignature = {
  signer: Address;
  digest: Hex;
  signature: Hex;
};

export function normalizeSignerPrivateKey(raw: string | undefined): Hex | null {
  if (!raw) return null;
  const key = raw.trim();
  if (!PRIVATE_KEY_RE.test(key)) {
    throw new Error("SLONKS_SIGNER_PRIVATE_KEY must be a 32-byte 0x-prefixed hex string");
  }
  return key as Hex;
}

export function normalizeDigest(raw: Hex): Hex {
  if (!isHex(raw) || !DIGEST_RE.test(raw)) {
    throw new Error("claim digest must be a 32-byte hex string");
  }
  return raw;
}

export async function signRevivalClaimDigest(privateKey: Hex, digest: Hex): Promise<RevivalClaimSignature> {
  const account = privateKeyToAccount(normalizeSignerPrivateKey(privateKey)!);
  const normalizedDigest = normalizeDigest(digest);
  return {
    signer: getAddress(account.address),
    digest: normalizedDigest,
    signature: await account.sign({ hash: normalizedDigest }),
  };
}

export function revivalSeedFromSignature(signature: Hex): Hex {
  if (!isHex(signature) || !SIGNATURE_RE.test(signature)) {
    throw new Error("claim signature must be 65 bytes");
  }
  return keccak256(signature);
}

export function revivalSourcePercent(seed: Hex): number {
  const normalizedSeed = normalizeDigest(seed);
  const roll = BigInt(keccak256(concatHex([normalizedSeed, toHex("SOURCE_PERCENT")]))) % 100n;
  if (roll < 50n) return 100;
  if (roll < 85n) return 75;
  if (roll < 95n) return 50;
  if (roll < 99n) return 25;
  return 0;
}
