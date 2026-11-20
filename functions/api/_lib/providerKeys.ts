// Shared server logic providerKeys; update API callers when changing its contract.
import { decryptSecret } from "./crypto";
import { eq, sbJson, type SupabaseEnv } from "./supabase";
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
      response = await fetch(request.url, {
        ...request.init,
        redirect: "manual",
        signal: AbortSignal.timeout(45_000),
      });
    } catch {
      log(`key ${index}: timeout`);
      void markKeyFailure(env, key, "timeout", "Request timed out.");
      last = { status: 503, message: "The provider did not respond in time. Please retry." };
      continue;
    }

    if (response.ok) {
      // Health bookkeeping must never sit between the user and their answer.
      void markKeySuccess(env, key.id);
      return { response, keyId: key.id, keyIndex: index, usedKeys: attempts };
    }

    const text = await response.text().catch(() => "");
    const message = extractMessage(text) || `HTTP ${response.status}`;
    if (!isRetryable(response.status, message)) {
      return { failure: { status: response.status, message }, usedKeys: attempts };
    }

    const reason = cooldownReason(response.status, message);
    void markKeyFailure(env, key, reason, message);
    log(`key ${index}: ${reason} (HTTP ${response.status})`);
    last = { status: response.status, message };
  }

  return {
    failure: {
      status: 503,
      message:
        last?.status === 401 || last?.status === 403
          ? "This model is temporarily unavailable. Please try again in a few minutes."
          : "This model is temporarily unavailable. Please try again in a few minutes.",
    },
    usedKeys: attempts,
  };
}

function extractMessage(text: string): string {
  if (!text) return "";
  try {
    const parsed = JSON.parse(text) as {
      error?: { message?: string } | string;
      message?: string;
    };
    if (typeof parsed.error === "string") return parsed.error.slice(0, 300);
    if (parsed.error && typeof parsed.error.message === "string") return parsed.error.message.slice(0, 300);
    if (typeof parsed.message === "string") return parsed.message.slice(0, 300);
  } catch {
    return text.slice(0, 300);
  }
  return text.slice(0, 300);
}
