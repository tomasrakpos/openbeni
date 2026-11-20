/**
 * Server-only secret encryption (AES-256-GCM).
 *
 * Provider API keys are encrypted at rest in Postgres. The master key never
 * exists in the browser, the repo or logs — it is read from
 * `MASTER_ENCRYPTION_KEY` at request time.
 *
 * Accepted formats for the master key:
 * - base64 of 32 random bytes (recommended: `openssl rand -base64 32`)
 * - 64 hex characters
 * - any long passphrase (derived with SHA-256)
 */

const VERSION = "v1";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function hexToBytes(value: string): Uint8Array | null {
  if (!/^[0-9a-f]{64}$/i.test(value)) return null;
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) out[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function masterKey(secret: string): Promise<CryptoKey> {
  const trimmed = secret.trim();
  if (!trimmed) throw new Error("MASTER_ENCRYPTION_KEY is not configured.");
  let raw: Uint8Array | null = hexToBytes(trimmed);
  if (!raw) {
    try {
      const decoded = base64ToBytes(trimmed);
      if (decoded.length === 32) raw = decoded;
    } catch {
      raw = null;
    }
  }
  if (!raw) {
    // Passphrase: derive a stable 32-byte key. A high-entropy env value is
    // still strongly recommended.
    raw = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(trimmed)));
  }
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(secret: string, plaintext: string): Promise<string> {
  const key = await masterKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  return `${VERSION}.${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(cipher))}`;
}

export async function decryptSecret(secret: string, stored: string): Promise<string> {
  const [version, ivPart, dataPart] = stored.split(".");
  if (version !== VERSION || !ivPart || !dataPart) throw new Error("Unsupported secret format.");
  const key = await masterKey(secret);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(ivPart) },
    key,
    base64ToBytes(dataPart),
  );
  return new TextDecoder().decode(plain);
}

