// Shared logic id; change this helper here and update callers if its contract changes.
const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

export function uid(prefix = ""): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return prefix ? `${prefix}_${out}` : out;
}

export function shortId(): string {
  return uid().slice(0, 8);
}
