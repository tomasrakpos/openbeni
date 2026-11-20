// Tests for crypto.test; add or update cases here to match observable behavior.
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "../functions/api/_lib/crypto";

const MASTER = "test-master-key-that-is-long-enough-for-sha256-derivation";

describe("AES-GCM secret storage", () => {
  it("round-trips a key", async () => {
    const ciphertext = await encryptSecret(MASTER, "sk-live-1234567890");
    expect(ciphertext).toMatch(/^v1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/);
    expect(ciphertext).not.toContain("sk-live");
    await expect(decryptSecret(MASTER, ciphertext)).resolves.toBe("sk-live-1234567890");
  });

  it("uses a fresh IV for every encryption", async () => {
    const first = await encryptSecret(MASTER, "same-value");
    const second = await encryptSecret(MASTER, "same-value");
    expect(first).not.toBe(second);
    await expect(decryptSecret(MASTER, first)).resolves.toBe("same-value");
    await expect(decryptSecret(MASTER, second)).resolves.toBe("same-value");
  });

  it("rejects a different master key and tampered ciphertext", async () => {
    const ciphertext = await encryptSecret(MASTER, "secret");
    await expect(decryptSecret(`${MASTER}-other`, ciphertext)).rejects.toBeTruthy();
    const parts = ciphertext.split(".");
    const tampered = `${parts[0]}.${parts[1]}.${parts[2]!.slice(0, -4)}AAAA`;
    await expect(decryptSecret(MASTER, tampered)).rejects.toBeTruthy();
  });

  it("accepts 64-hex masters", async () => {
    const hex = "a".repeat(64);
    const ciphertext = await encryptSecret(hex, "value");
    await expect(decryptSecret(hex, ciphertext)).resolves.toBe("value");
  });

  it("refuses an empty master key", async () => {
    await expect(encryptSecret("", "value")).rejects.toThrow(/MASTER_ENCRYPTION_KEY/);
  });

  it("rejects malformed envelopes", async () => {
    await expect(decryptSecret(MASTER, "not-a-ciphertext")).rejects.toThrow(/Unsupported/);
  });
});
