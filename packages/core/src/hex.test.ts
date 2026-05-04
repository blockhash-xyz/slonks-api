import { describe, expect, test } from "bun:test";
import { bytesToHex, hexToBytes } from "./hex.ts";

describe("hex helpers", () => {
  test("round-trips bytes with and without a 0x prefix", () => {
    const bytes = new Uint8Array([0, 1, 15, 16, 254, 255]);

    expect(bytesToHex(bytes)).toBe("0x00010f10feff");
    expect([...hexToBytes("0x00010f10feff")]).toEqual([...bytes]);
    expect([...hexToBytes("00010f10feff")]).toEqual([...bytes]);
  });

  test("rejects odd-length hex", () => {
    expect(() => hexToBytes("0xabc")).toThrow("invalid hex length: 3");
  });
});
