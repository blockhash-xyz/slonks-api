import { Hono } from "hono";
import { encodeFunctionData, getAddress, isAddress, keccak256, type Address, type Hex } from "viem";
import { slopGameAbi, slopSignedDutchAuctionAbi } from "../../chain/abis.ts";
import { CHAIN_ID } from "../../chain/contracts.ts";
import { publicClient } from "../../chain/client.ts";
import { env } from "../../env.ts";
import {
  normalizeSignerPrivateKey,
  revivalSeedFromSignature,
  revivalSourcePercent,
  signRevivalClaimDigest,
} from "../../revival/signature.ts";
import { setNoStore } from "../cache.ts";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export const revival = new Hono();

revival.post("/claim-signature", async (c) => {
  setNoStore(c);

  const auction = configuredAuctionAddress();
  if (!auction.ok) return c.json({ error: auction.error }, 503);

  let privateKey: Hex | null;
  try {
    privateKey = normalizeSignerPrivateKey(env.SLONKS_SIGNER_PRIVATE_KEY);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "invalid signer private key" }, 503);
  }
  if (!privateKey) return c.json({ error: "SLONKS_SIGNER_PRIVATE_KEY is not configured" }, 503);

  const client = publicClient();
  let pending: readonly [Address, bigint, bigint, number, bigint, bigint];
  let entropySigner: Address;
  let game: Address;
  let blockNumber: bigint;
  try {
    [pending, entropySigner, game, blockNumber] = await Promise.all([
      client.readContract({ address: auction.address, abi: slopSignedDutchAuctionAbi, functionName: "pendingRevival" }),
      client.readContract({
        address: auction.address,
        abi: slopSignedDutchAuctionAbi,
        functionName: "entropySigner",
      }) as Promise<Address>,
      client.readContract({
        address: auction.address,
        abi: slopSignedDutchAuctionAbi,
        functionName: "game",
      }) as Promise<Address>,
      client.getBlockNumber(),
    ]);
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed to read signed Dutch auction state";
    return c.json({ error: message }, 502);
  }

  const [requester, targetBlock, expiresBlock, eligibleSlonkCount, revivalNonce, cost] = pending;
  if (requester.toLowerCase() === ZERO_ADDRESS) return c.json({ error: "no pending revival" }, 409);
  if (blockNumber > expiresBlock) {
    return c.json({ error: "pending revival is expired", blockNumber: blockNumber.toString() }, 409);
  }
  if (eligibleSlonkCount === 0) return c.json({ error: "pending revival has no eligible Slonks" }, 409);

  let digest: Hex;
  try {
    digest = (await client.readContract({
      address: auction.address,
      abi: slopSignedDutchAuctionAbi,
      functionName: "claimDigest",
    })) as Hex;
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed to read revival claim digest";
    return c.json({ error: message }, 502);
  }

  const signed = await signRevivalClaimDigest(privateKey, digest);
  if (getAddress(entropySigner) !== signed.signer) {
    return c.json(
      {
        error: "configured signer does not match auction entropySigner",
        apiSigner: signed.signer,
        entropySigner: getAddress(entropySigner),
      },
      409,
    );
  }

  const seed = revivalSeedFromSignature(signed.signature);
  const voidIndex = BigInt(seed) % BigInt(eligibleSlonkCount);
  const expectedTokenId = await client
    .readContract({ address: game, abi: slopGameAbi, functionName: "voidedTokenAt", args: [voidIndex] })
    .catch(() => null);
  const claimCalldata = encodeFunctionData({
    abi: slopSignedDutchAuctionAbi,
    functionName: "claimRevival",
    args: [signed.signature],
  });

  return c.json({
    chainId: CHAIN_ID,
    auction: auction.address,
    game: getAddress(game),
    signer: signed.signer,
    digest: signed.digest,
    signature: signed.signature,
    signatureHash: keccak256(signed.signature),
    pendingRevival: {
      requester: getAddress(requester),
      targetBlock: targetBlock.toString(),
      expiresBlock: expiresBlock.toString(),
      eligibleSlonkCount,
      revivalNonce: revivalNonce.toString(),
      cost: cost.toString(),
    },
    expected: {
      voidIndex: voidIndex.toString(),
      tokenId: typeof expectedTokenId === "bigint" ? expectedTokenId.toString() : null,
      sourcePercent: revivalSourcePercent(seed),
    },
    transaction: {
      to: auction.address,
      data: claimCalldata,
      functionName: "claimRevival",
      args: [signed.signature],
    },
    generatedAt: new Date().toISOString(),
  });
});

type AuctionAddressResult = { ok: true; address: Address } | { ok: false; error: string };

function configuredAuctionAddress(): AuctionAddressResult {
  const raw = env.SLOP_SIGNED_DUTCH_AUCTION_EXTENSION?.trim();
  if (!raw) return { ok: false, error: "SLOP_SIGNED_DUTCH_AUCTION_EXTENSION is not configured" };
  if (!isAddress(raw)) return { ok: false, error: "SLOP_SIGNED_DUTCH_AUCTION_EXTENSION is not a valid address" };
  return { ok: true, address: getAddress(raw) };
}
