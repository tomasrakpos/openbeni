// Local persistence vault; change storage setup here and preserve upgrade behavior.
import { db } from "@/db";
import {
  decryptText,
  deriveKey,
  encryptText,
  generateDeviceKey,
  randomSaltBase64,
  type EncryptedBlob,
} from "@/lib/crypto";

type VaultMode = "device" | "passphrase";

interface VaultState {
  key: CryptoKey | null;
  mode: VaultMode;
  initialized: boolean;
}

const state: VaultState = { key: null, mode: "device", initialized: false };
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export function subscribeVault(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function vaultStatus(): { mode: VaultMode; locked: boolean; initialized: boolean } {
  return { mode: state.mode, locked: state.key === null, initialized: state.initialized };
}

function requireKey(): CryptoKey {
  if (!state.key) throw new Error("Vault is locked");
  return state.key;
}

/** Prepare encryption for the session. Device mode auto-unlocks with a non-extractable key. */
export async function initVault(mode: VaultMode): Promise<{ locked: boolean; mode: VaultMode }> {
  state.mode = mode;
  state.initialized = true;
  if (mode === "passphrase") {
    state.key = null;
    notify();
    return { locked: true, mode };
  }
  const row = await db.meta.get("deviceKey");
  let key = row?.v as CryptoKey | undefined;
  if (!key || !(key instanceof CryptoKey)) {
    key = await generateDeviceKey();
    await db.meta.put({ k: "deviceKey", v: key });
  }
  state.key = key;
  notify();
  return { locked: false, mode };
}

export async function unlockVault(passphrase: string, salt: string): Promise<boolean> {
  if (!passphrase || !salt) return false;
  const key = await deriveKey(passphrase, salt);
  const check = await db.meta.get("vaultCheck");
  if (check?.v) {
    try {
      await decryptText(check.v as EncryptedBlob, key);
    } catch {
      return false;
    }
  }
  state.key = key;
  state.mode = "passphrase";
  notify();
  return true;
}

export function lockVault(): void {
  if (state.mode !== "passphrase") return;
  state.key = null;
  notify();
}

async function encryptAllWith(key: CryptoKey): Promise<void> {
  const secrets = await db.secrets.toArray();
  for (const secret of secrets) {
    // re-encrypt only possible if the previous key is available
    if (!state.key) throw new Error("Cannot re-encrypt while locked");
    const plain = await decryptText(secret, state.key);
    const blob = await encryptText(plain, key);
    await db.secrets.put({ ...secret, ...blob, updatedAt: Date.now() });
  }
}

export async function enablePassphrase(passphrase: string): Promise<{ salt: string }> {
  if (passphrase.length < 8) throw new Error("Use at least 8 characters.");
  const salt = randomSaltBase64();
  const key = await deriveKey(passphrase, salt);
  await encryptAllWith(key);
  const check = await encryptText("apiset-vault-ok", key);
  await db.meta.put({ k: "vaultCheck", v: check });
  await db.meta.put({ k: "vaultSalt", v: salt });
  state.key = key;
  state.mode = "passphrase";
  notify();
  return { salt };
}

export async function disablePassphrase(): Promise<void> {
  const deviceKey = await generateDeviceKey();
  await encryptAllWith(deviceKey);
  await db.meta.put({ k: "deviceKey", v: deviceKey });
  await db.meta.delete("vaultCheck");
  await db.meta.delete("vaultSalt");
  state.key = deviceKey;
  state.mode = "device";
  notify();
}

export async function saveProviderKey(providerId: string, plain: string): Promise<void> {
  const key = requireKey();
  const blob = await encryptText(plain, key);
  await db.secrets.put({ providerId, ...blob, updatedAt: Date.now() });
}

export async function getProviderKey(providerId: string): Promise<string | null> {
  const secret = await db.secrets.get(providerId);
  if (!secret) return null;
  try {
    return await decryptText(secret, requireKey());
  } catch {
    throw new Error("Could not decrypt this key. Unlock the vault with the right passphrase.");
  }
}

export async function removeProviderKey(providerId: string): Promise<void> {
  await db.secrets.delete(providerId);
}

export async function hasStoredSecret(providerId: string): Promise<boolean> {
  return (await db.secrets.get(providerId)) !== undefined;
}
