// Shared server logic providerKeys; update API callers when changing its contract.
import { decryptSecret } from "./crypto";
import { eq, sbJson, type SupabaseEnv } from "./supabase";
import { scrubSecretText, stripStreamOptions } from "./upstream";
import { safeFetch } from "./urlGuard";
import type { AuthEnv } from "./auth";

export type ApiFormat = "openai" | "anthropic" | "gemini" | "custom";

export interface ProviderRow {
  id: string;
  name: string;
  base_url: string;
  api_format: ApiFormat;
  auth_header: string | null;
  auth_prefix: string | null;
  extra_headers: Record<string, string> | null;
  icon: string | null;
  color: string | null;
  notes: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProviderKeyRow {
  id: string;
  provider_id: string;
  ciphertext: string;
  label: string | null;
  enabled: boolean;
  cooldown_until: string | null;
  fail_count: number;
  last_error: string | null;
  created_at: string;
}

export interface KeySummary {
  id: string;
  label: string | null;
  enabled: boolean;
  status: "ok" | "cooling" | "disabled";
  cooldownUntil: string | null;
  failCount: number;
  lastError: string | null;
}

export interface ProviderSummary extends ProviderRow {
  keyCount: number;
  healthyKeys: number;
  keys: KeySummary[];
}

export const COOLDOWN_MS = {
  auth: 10 * 60_000,
  quota: 15 * 60_000,
  rate: 60_000,
  server: 60_000,
  timeout: 30_000,
  network: 30_000,
} as const;

export function keyStatus(row: ProviderKeyRow): KeySummary["status"] {
  if (!row.enabled) return "disabled";
  if (row.cooldown_until && new Date(row.cooldown_until).getTime() > Date.now()) return "cooling";
  return "ok";
}

export function summarizeKeys(rows: ProviderKeyRow[]): KeySummary[] {
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    enabled: row.enabled,
    status: keyStatus(row),
    cooldownUntil: row.cooldown_until,
    failCount: row.fail_count,
    lastError: row.last_error,
  }));
}

export function summarizeProvider(provider: ProviderRow, keys: ProviderKeyRow[]): ProviderSummary {
  const summaries = summarizeKeys(keys);
  return {
    ...provider,
    keyCount: keys.length,
    healthyKeys: summaries.filter((key) => key.status === "ok").length,
    keys: summaries,
  };
}

export async function listProviderKeys(env: SupabaseEnv, providerId: string): Promise<ProviderKeyRow[]> {
  return sbJson<ProviderKeyRow[]>(
    env,
    `provider_keys?select=*&provider_id=${eq(providerId)}&order=created_at.asc`,
  );
}

export async function getProvider(env: SupabaseEnv, id: string): Promise<ProviderRow | null> {
  const rows = await sbJson<ProviderRow[]>(env, `providers?select=*&id=${eq(id)}&limit=1`);
  return rows[0] ?? null;
}

export async function markKeySuccess(env: SupabaseEnv, keyId: string): Promise<void> {
  try {
    await sbJson(env, `provider_keys?id=${eq(keyId)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ cooldown_until: null, fail_count: 0, last_error: null, last_used_at: new Date().toISOString() }),
    });
  } catch {
    // Health bookkeeping is best-effort.
  }
}

export async function markKeyFailure(
  env: SupabaseEnv,
  key: ProviderKeyRow,
  reason: keyof typeof COOLDOWN_MS,
  message: string,
): Promise<void> {
  try {
    const until = new Date(Date.now() + COOLDOWN_MS[reason]).toISOString();
    await sbJson(env, `provider_keys?id=${eq(key.id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        cooldown_until: until,
        fail_count: (key.fail_count ?? 0) + 1,
        last_error: message.slice(0, 240),
        last_used_at: new Date().toISOString(),
      }),
    });
  } catch {
    // Ignore.
  }
}

export interface RotationEnv extends SupabaseEnv, AuthEnv {
  MASTER_ENCRYPTION_KEY?: string;
}

export interface RotationOutcome {
  response?: Response;
  keyId?: string;
  keyIndex?: number;
  failure?: { status: number; message: string };
  usedKeys: number;
}

function isRetryable(status: number, message: string): boolean {
  if ([401, 402, 403, 408, 429].includes(status)) return true;
  if (status >= 500) return true;
  return /(quota|usage limit|rate.?limit|too many requests|insufficient|credit|limit (?:has been )?reached)/i.test(message);
}

function cooldownReason(status: number, message: string): keyof typeof COOLDOWN_MS {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate";
  if (status === 402 || /quota|usage limit|insufficient|credit/i.test(message)) return "quota";
  if (status === 408) return "timeout";
  if (status >= 500) return "server";
  return "quota";
}

/** Try healthy keys in order, replaying the same request after a retryable failure. */
export async function callWithRotation(
  env: RotationEnv,
  provider: ProviderRow,
  keys: ProviderKeyRow[],
  build: (apiKey: string) => Promise<{ url: string; init: RequestInit }>,
  log: (line: string) => void = () => undefined,
): Promise<RotationOutcome> {
  const healthy = keys
    .filter((key) => key.enabled && keyStatus(key) === "ok")
    .sort((a, b) => a.fail_count - b.fail_count || a.created_at.localeCompare(b.created_at));

  if (healthy.length === 0) {
    return {
      failure: {
        status: 503,
        message: "This model is temporarily unavailable. Please try again in a few minutes.",
      },
      usedKeys: 0,
    };
  }

  let attempts = 0;
  let last: { status: number; message: string } | undefined;

  for (const key of healthy) {
    attempts += 1;
    const index = keys.findIndex((entry) => entry.id === key.id) + 1;
    let plain: string;
    try {
      plain = await decryptSecret(env.MASTER_ENCRYPTION_KEY ?? "", key.ciphertext);
    } catch {
      // A bad master key must not leak ciphertext or key material.
      log(`key ${index}: decrypt-failed`);
      last = { status: 503, message: "The server could not read its stored credentials." };
      continue;
    }

    let request: { url: string; init: RequestInit };
    try {
      request = await build(plain);
    } catch {
      return { failure: { status: 400, message: "The provider configuration is invalid." }, usedKeys: attempts };
    }

    let response: Response;
    try {
      response = await safeFetch(new URL(request.url), request.init, { timeoutMs: 45_000 });
    } catch (err) {
      const isTimeout =
        err instanceof Error &&
        (err.name === "TimeoutError" || err.name === "AbortError" || /timed out/i.test(err.message));
      const reason = isTimeout ? "timeout" : "server";
      const errMsg = isTimeout ? "Request timed out." : "Provider host unreachable.";
      log(`key ${index}: ${reason}`);
      void markKeyFailure(env, key, reason, errMsg);
      last = {
        status: isTimeout ? 504 : 502,
        message: isTimeout
          ? "The provider did not respond in time. Please retry."
          : "Could not reach the provider endpoint. Please retry.",
      };
      continue;
    }

    // Retry once without `stream_options` if an OpenAI-compatible gateway rejects
    // it with HTTP 400/422 — without burning or cooling down the API key.
    if (!response.ok && (response.status === 400 || response.status === 422)) {
      const stripped = stripStreamOptions(request.init);
      if (stripped) {
        const preview = await response.clone().text().catch(() => "");
        if (/stream_options|extra_forbidden|unrecognized|unknown field|additional properties/i.test(preview)) {
          try {
            await response.body?.cancel().catch(() => undefined);
            response = await safeFetch(new URL(request.url), stripped, { timeoutMs: 45_000 });
          } catch {
            // Fall through to standard error handling below.
          }
        }
      }
    }

    if (response.ok) {
      // Health bookkeeping must never sit between the user and their answer.
      void markKeySuccess(env, key.id);
      return { response, keyId: key.id, keyIndex: index, usedKeys: attempts };
    }

    const text = await response.text().catch(() => "");
    const message = extractMessage(text, plain) || `HTTP ${response.status}`;
    if (!isRetryable(response.status, message)) {
      return { failure: { status: response.status, message }, usedKeys: attempts };
    }

    const reason = cooldownReason(response.status, message);
    void markKeyFailure(env, key, reason, message);
    log(`key ${index}: ${reason} (HTTP ${response.status})`);
    last = { status: response.status, message };
  }

  const finalStatus = last?.status === 504 ? 504 : 503;
  const finalMessage =
    last?.status === 401 || last?.status === 403
      ? "The provider rejected the configured API keys. Check the provider credentials in the admin panel."
      : last?.status === 429
        ? "This model is currently rate-limited by the upstream provider. Please retry shortly."
        : last?.status === 504
          ? "The upstream provider timed out. Please retry shortly."
          : "This model is temporarily unavailable. Please try again in a few minutes.";

  return {
    failure: {
      status: finalStatus,
      message: finalMessage,
    },
    usedKeys: attempts,
  };
}

function extractMessage(text: string, activeKey?: string): string {
  if (!text) return "";
  let raw = "";
  try {
    const parsed = JSON.parse(text) as {
      error?: { message?: string } | string;
      message?: string;
    };
    if (typeof parsed.error === "string") raw = parsed.error.slice(0, 300);
    else if (parsed.error && typeof parsed.error.message === "string") raw = parsed.error.message.slice(0, 300);
    else if (typeof parsed.message === "string") raw = parsed.message.slice(0, 300);
    else raw = text.slice(0, 300);
  } catch {
    raw = text.slice(0, 300);
  }
  let safe = scrubSecretText(raw);
  if (activeKey && activeKey.length >= 6) {
    safe = safe.split(activeKey).join("[redacted]");
  }
  return safe;
}
