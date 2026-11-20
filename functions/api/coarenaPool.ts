/**
 * Coarena key pool (server side only).
 *
 * The browser never sees a Coarena key. `COARENA_KEYS` is a comma-separated
 * environment variable that lives on the host (Cloudflare Pages/Worker, Vercel,
 * Netlify, Express, or a local `.env` file that is git-ignored).
 *
 * Behaviour required by the product:
 * - use the first healthy key;
 * - on 401/403/402/429/5xx/timeout/quota move that key to a cooldown and replay
 *   the same request with the next key, without telling the user;
 * - keys return to the rotation automatically when their cooldown expires;
 * - logs contain the key *number* and the reason, never the key;
 * - status exposes only counts.
 */

export interface CoarenaEnv {
  COARENA_KEYS?: string;
  COARENA_BASE_URL?: string;
}

/** Models verified against the live Coarena API (see README for the probe). */
export const COARENA_MODELS = [
  { id: "deepseek-v4-1-flash-1017", displayName: "DeepSeek V4.1 Flash 1017", contextWindow: 128000 },
  { id: "gemini-3-8-flash", displayName: "Gemini 3.8 Flash", contextWindow: 128000 },
  { id: "gemini-4-argon", displayName: "Gemini 4 Argon", contextWindow: 128000 },
  { id: "gemini-4-carbon", displayName: "Gemini 4 Carbon", contextWindow: 128000 },
  { id: "gpt-6-1-sol", displayName: "GPT-6.1 Sol", contextWindow: 128000 },
  { id: "gpt-6-1-terra", displayName: "GPT-6.1 Terra", contextWindow: 128000 },
  { id: "gpt-6-astra", displayName: "GPT-6 Astra", contextWindow: 128000 },
  { id: "gpt-6-luna", displayName: "GPT-6 Luna", contextWindow: 128000 },
  { id: "kimi-k3-1-pro", displayName: "Kimi K3.1 Pro", contextWindow: 128000 },
] as const;

export const COARENA_MODEL_IDS = new Set<string>(COARENA_MODELS.map((model) => model.id));

export const COARENA_DEFAULT_BASE = "https://coarena.ai/api/v1";

const KEY_PATTERN = /^coa_[A-Za-z0-9]{16,}$/;

/** Rounds/stages that can plausibly succeed with another key. */
export const RETRYABLE_STATUS = new Set([401, 402, 403, 408, 429]);

export interface KeyHealth {
  key: string;
  index: number;
  fingerprint: string;
  coolingUntil: number;
  reason?: string;
  lastUsedAt: number;
}

const health = new Map<string, { coolingUntil: number; reason?: string; lastUsedAt: number }>();

/** Non-reversible local id so the health map never uses the key as its key. */
export function fingerprint(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function parseKeys(env: CoarenaEnv): string[] {
  const raw = (env.COARENA_KEYS ?? "").split(/[\n,;]+/);
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const entry of raw) {
    const key = entry.trim();
    if (!KEY_PATTERN.test(key) || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

function poolState(env: CoarenaEnv): KeyHealth[] {
  const now = Date.now();
  return parseKeys(env).map((key, index) => {
    const id = fingerprint(key);
    const row = health.get(id);
    return {
      key,
      index,
      fingerprint: id,
      coolingUntil: row?.coolingUntil ?? 0,
      reason: row?.reason,
      lastUsedAt: row?.lastUsedAt ?? 0,
    };
  });
}

export interface PoolStatus {
  total: number;
  healthy: number;
  keys: Array<{ index: number; status: "ok" | "cooling"; retryInSeconds: number; reason?: string }>;
}

export function poolStatus(env: CoarenaEnv): PoolStatus {
  const now = Date.now();
  const rows = poolState(env);
  const keys = rows.map((row) => {
    const cooling = row.coolingUntil > now;
    return {
      index: row.index + 1,
      status: cooling ? ("cooling" as const) : ("ok" as const),
      retryInSeconds: cooling ? Math.ceil((row.coolingUntil - now) / 1000) : 0,
      ...(cooling && row.reason ? { reason: row.reason } : {}),
    };
  });
  return { total: rows.length, healthy: keys.filter((key) => key.status === "ok").length, keys };
}

export function markSuccess(key: string): void {
  const id = fingerprint(key);
  health.set(id, { coolingUntil: 0, lastUsedAt: Date.now() });
}

export function markFailure(key: string, reason: string, cooldownMs: number): void {
  const id = fingerprint(key);
  const previous = health.get(id);
  const until = Date.now() + Math.max(1000, cooldownMs);
  health.set(id, {
    coolingUntil: Math.max(until, previous?.coolingUntil ?? 0),
    reason,
    lastUsedAt: previous?.lastUsedAt ?? 0,
  });
}

/** Seconds until the next UTC midnight (Coarena's daily free quota reset). */
export function msUntilUtcMidnight(now = Date.now()): number {
  const date = new Date(now);
  const next = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
  return Math.max(60_000, next - now);
}

export function cooldownFor(status: number, message: string): { reason: string; ms: number } {
  const quota = /insufficient_quota|quota|usage limit|credit|daily.*limit|limit.*reached/i.test(message);
  if (status === 401 || status === 403) return { reason: "auth", ms: 30 * 60_000 };
  if (status === 402) return { reason: "quota", ms: msUntilUtcMidnight() };
  if (status === 429) {
    if (quota) return { reason: "quota", ms: msUntilUtcMidnight() };
    return { reason: "rate-limit", ms: 5 * 60_000 };
  }
  if (status === 408) return { reason: "timeout", ms: 30_000 };
  if (status >= 500) return { reason: "server", ms: 60_000 };
  return { reason: "error", ms: 60_000 };
}

/** First healthy key in configuration order, or null when every key is cooling. */
export function selectKey(env: CoarenaEnv): string | null {
  const now = Date.now();
  const healthy = poolState(env).find((row) => row.coolingUntil <= now);
  return healthy?.key ?? null;
}

export function coarenaBase(env: CoarenaEnv): string {
  const raw = (env.COARENA_BASE_URL ?? COARENA_DEFAULT_BASE).trim().replace(/\/+$/, "");
  return /^https:\/\/[^\s]+$/i.test(raw) ? raw : COARENA_DEFAULT_BASE;
}

/** Replace any key value that leaked into an upstream message. */
export function scrubKeys(text: string, env: CoarenaEnv): string {
  let out = text;
  for (const key of parseKeys(env)) out = out.split(key).join("[redacted]");
  return out;
}
