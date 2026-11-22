// Shared server logic usage; update API callers when changing its contract.
import { eq, sbJson, type SupabaseEnv } from "./supabase";
import type { AppSettingsRow, ProfileRow } from "./auth";

export interface UsageTotals {
  input: number;
  output: number;
}

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

export function estimateMessageTokens(messages: unknown): number {
  if (!Array.isArray(messages)) return 0;
  let chars = 0;
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const content = (message as { content?: unknown }).content;
    if (typeof content === "string") chars += content.length;
    else if (Array.isArray(content)) {
      for (const part of content) {
        if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
          chars += ((part as { text: string }).text).length;
        }
      }
    }
  }
  return Math.max(1, Math.ceil(chars / 4));
}

export function dayStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function monthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function usageSince(env: SupabaseEnv, userId: string, since: Date): Promise<UsageTotals> {
  try {
    const result = await sbJson<{ input_tokens?: number; output_tokens?: number }[]>(
      env,
      "rpc/user_usage_totals",
      {
        method: "POST",
        body: JSON.stringify({ p_user: userId, p_since: since.toISOString() }),
      },
    );
    const row = Array.isArray(result) ? result[0] : (result as { input_tokens?: number; output_tokens?: number });
    return { input: Number(row?.input_tokens ?? 0), output: Number(row?.output_tokens ?? 0) };
  } catch {
    // Fallback for a deployment where the RPC has not been created yet.
    const baseQuery = `usage_events?select=prompt_tokens,completion_tokens&user_id=${eq(userId)}&created_at=gte.${encodeURIComponent(
      since.toISOString(),
    )}&limit=50000`;
    try {
      let rows: { prompt_tokens: number | null; completion_tokens: number | null }[];
      try {
        rows = await sbJson<{ prompt_tokens: number | null; completion_tokens: number | null }[]>(
          env,
          `${baseQuery}&billing_source=eq.site`,
        );
      } catch {
        rows = await sbJson<{ prompt_tokens: number | null; completion_tokens: number | null }[]>(
          env,
          baseQuery,
        );
      }
      return rows.reduce(
        (sum, row) => ({
          input: sum.input + Number(row.prompt_tokens ?? 0),
          output: sum.output + Number(row.completion_tokens ?? 0),
        }),
        { input: 0, output: 0 },
      );
    } catch {
      return { input: 0, output: 0 };
    }
  }
}

export interface QuotaResult {
  allowed: boolean;
  reason?: "blocked" | "daily" | "monthly";
  dailyUsed: number;
  monthlyUsed: number;
  dailyLimit: number | null;
  monthlyLimit: number | null;
}

export function limitsFor(profile: ProfileRow, settings: AppSettingsRow): { daily: number | null; monthly: number | null } {
  return {
    daily: profile.daily_token_limit ?? settings.default_daily_token_limit ?? null,
    monthly: profile.monthly_token_limit ?? settings.default_monthly_token_limit ?? null,
  };
}

export async function checkQuota(
  env: SupabaseEnv,
  profile: ProfileRow,
  settings: AppSettingsRow,
): Promise<QuotaResult> {
  const limits = limitsFor(profile, settings);
  const [day, month] = await Promise.all([
    usageSince(env, profile.id, dayStart()),
    usageSince(env, profile.id, monthStart()),
  ]);
  const dailyUsed = day.input + day.output;
  const monthlyUsed = month.input + month.output;
  if (profile.status !== "active") {
    return { allowed: false, reason: "blocked", dailyUsed, monthlyUsed, dailyLimit: limits.daily, monthlyLimit: limits.monthly };
  }
  if (limits.daily !== null && dailyUsed >= limits.daily) {
    return { allowed: false, reason: "daily", dailyUsed, monthlyUsed, dailyLimit: limits.daily, monthlyLimit: limits.monthly };
  }
  if (limits.monthly !== null && monthlyUsed >= limits.monthly) {
    return { allowed: false, reason: "monthly", dailyUsed, monthlyUsed, dailyLimit: limits.daily, monthlyLimit: limits.monthly };
  }
  return { allowed: true, dailyUsed, monthlyUsed, dailyLimit: limits.daily, monthlyLimit: limits.monthly };
}

export interface UsageRecord {
  user_id: string;
  provider_id: string | null;
  model_id: string | null;
  model_name: string;
  provider_name: string;
  prompt_tokens: number;
  completion_tokens: number;
  status: string;
  latency_ms?: number;
  billing_source?: "site" | "byok";
  credits_charged?: number;
  user_provider_id?: string | null;
}

export async function recordUsage(env: SupabaseEnv, record: UsageRecord): Promise<void> {
  try {
    await sbJson(env, "usage_events", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify([record]),
    });
  } catch {
    // Fallback for deployments that have not applied 0005_user_providers.sql yet.
    if (
      record.billing_source !== undefined ||
      record.credits_charged !== undefined ||
      record.user_provider_id !== undefined
    ) {
      const { billing_source: _b, credits_charged: _c, user_provider_id: _u, ...legacy } = record;
      try {
        await sbJson(env, "usage_events", {
          method: "POST",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify([legacy]),
        });
      } catch {
        // Usage accounting must never break the chat response.
      }
    }
  }
}
