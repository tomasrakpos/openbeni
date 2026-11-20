// Shared logic keyPool; change this helper here and update callers if its contract changes.
import type { ErrorKind, Provider } from "@/lib/types";

/**
 * Which provider is server-managed.
 *
 * Managed providers (currently Coarena) have no browser-side key at all: the
 * request goes to our same-origin endpoint and the server rotates the pool.
 * The client must never try to attach a key or rotate for them.
 */
export function isManagedProvider(provider: Provider): boolean {
  return provider.managed === true;
}

/**
 * In-memory health for the user's own keys (BYOK only).
 *
 * A user can attach one key per provider; the map exists so a key that was
 * rejected is not retried on every single turn. It stores a non-reversible
 * fingerprint, never the key itself, and it is cleared on reload.
 */
const cooldowns = new Map<string, number>();
let lastGood: string | null = null;

const COOLDOWN_MS: Partial<Record<ErrorKind, number>> = {
  "rate-limit": 10 * 60_000,
  auth: 30 * 60_000,
  "not-found": 30 * 60_000,
  http: 2 * 60_000,
  server: 60_000,
};

/** Non-reversible local id so no key value is ever kept in memory. */
function fingerprint(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Keys to try for this request. Managed providers yield a single empty
 * candidate (the server supplies the key); BYOK providers yield the stored key
 * when it is not cooling down.
 */
export function getProviderKeyCandidates(provider: Provider, storedKey: string | null): string[] {
  if (isManagedProvider(provider)) return [""];
  const key = storedKey?.trim();
  if (!key) return [];
  const until = cooldowns.get(fingerprint(key)) ?? 0;
  if (until > Date.now()) return [];
  return [key];
}

export function markKeySuccess(key: string): void {
  if (!key) return;
  lastGood = key;
  cooldowns.delete(fingerprint(key));
}

export function markKeyFailure(key: string, kind: ErrorKind): void {
  if (!key) return;
  const ms = COOLDOWN_MS[kind];
  if (!ms) return;
  if (lastGood === key) lastGood = null;
  cooldowns.set(fingerprint(key), Date.now() + ms);
}

/** Errors where a different key can plausibly succeed with the same model. */
export function canRotateKey(kind: ErrorKind | undefined): boolean {
  return kind === "rate-limit" || kind === "auth" || kind === "http" || kind === "server" || kind === "not-found";
}

export const MAX_KEY_ATTEMPTS = 8;

export function resetKeyHealth(): void {
  cooldowns.clear();
  lastGood = null;
}
