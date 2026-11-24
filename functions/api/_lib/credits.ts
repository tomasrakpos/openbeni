// Server-only token-based credit engine: formula, atomic reservations, commit/release,
// one-time signup grant, and friendly credits_exhausted responses.
//
// Security invariant:
//   * Credits are calculated and deducted strictly on the server using service_role RPCs.
//   * Client-supplied credit amounts or weights are never accepted.
//   * No API keys, tokens, or secrets are ever logged or returned.

import { apiHeaders, type SecurityEnv } from "../security";
import { eq, sbJson, type SupabaseEnv } from "./supabase";

export const DEFAULT_SIGNUP_CREDITS = 5;
export const DEFAULT_MODEL_WEIGHT = 1;
export const DEFAULT_MIN_CREDITS_PER_REQUEST = 0.5;
export const DEFAULT_MAX_CREDITS_PER_REQUEST = 3;
export const CREDIT_STEP = 0.5;
export const DEFAULT_RESERVATION_MAX_TOKENS = 4096;
const MAX_RESERVATION_TOKENS_CAP = 32_768;

/**
 * Task weight lookup strictly derived from the selected skill (not ad-hoc guessing).
 * - Normal chat: 1.0
 * - Project building (website / game): 1.5
 * - Image analysis (`vision` / `image_analysis`, or chat messages containing images): 1.2
 * - Deep thinking / research (`deep_thinking`): 1.5
 * - Unrecognized/other skill: defaults explicitly to 1.0
 */
export const TASK_WEIGHTS: Readonly<Record<string, number>> = {
  chat: 1.0,
  website: 1.5,
  game: 1.5,
  deep_thinking: 1.5,
  vision: 1.2,
  image_analysis: 1.2,
  other: 1.0,
};

export interface CreditPolicy {
  signupCredits: number;
  minCreditsPerRequest: number;
  maxCreditsPerRequest: number;
}

export interface CreditSettingsLike {
  default_signup_credits?: number | string | null;
  min_credits_per_request?: number | string | null;
  max_credits_per_request?: number | string | null;
}

export function roundCredits(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

export function formatCreditNumber(value: number): string {
  const rounded = roundCredits(Math.max(0, value));
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(2).replace(/0$/, "");
}

function parseNonNegativeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

export function extractCreditPolicy(settings?: CreditSettingsLike | null): CreditPolicy {
  const signup = parseNonNegativeNumber(settings?.default_signup_credits) ?? DEFAULT_SIGNUP_CREDITS;
  const minReq =
    parseNonNegativeNumber(settings?.min_credits_per_request) ?? DEFAULT_MIN_CREDITS_PER_REQUEST;
  const rawMax =
    parseNonNegativeNumber(settings?.max_credits_per_request) ?? DEFAULT_MAX_CREDITS_PER_REQUEST;
  const maxReq = Math.max(minReq, rawMax);
  return {
    signupCredits: roundCredits(signup),
    minCreditsPerRequest: roundCredits(minReq),
    maxCreditsPerRequest: roundCredits(maxReq),
  };
}

/**
 * Resolves a model's billing weight. Defaults explicitly to 1 when no weight
 * is configured on the catalog model.
 */
export function resolveModelWeight(weight: number | string | null | undefined): number {
  const parsed = parseNonNegativeNumber(weight);
  if (parsed !== null && parsed > 0) return roundCredits(parsed);
  return DEFAULT_MODEL_WEIGHT;
}

/**
 * Resolves task weight strictly from the selected skill (plus explicit image attachments
 * for image-analysis tasks when the active skill is normal chat/other).
 */
export function resolveTaskWeight(
  skill: string | null | undefined,
  options?: { hasImages?: boolean },
): number {
  const normalized = (skill ?? "").trim().toLowerCase();
  if (normalized === "website" || normalized === "game") return TASK_WEIGHTS.website;
  if (normalized === "deep_thinking") return TASK_WEIGHTS.deep_thinking;
  if (normalized === "vision" || normalized === "image_analysis") return TASK_WEIGHTS.vision;
  if (options?.hasImages) return TASK_WEIGHTS.vision;
  return TASK_WEIGHTS[normalized] ?? 1.0;
}

/**
 * Detects whether any message in the request carries image content (for image-analysis weight).
 */
export function hasImagesInMessages(messages: unknown): boolean {
  if (!Array.isArray(messages)) return false;
  for (const msg of messages) {
    if (!msg || typeof msg !== "object") continue;
    const record = msg as { hasImages?: unknown; content?: unknown };
    if (record.hasImages === true) return true;
    if (Array.isArray(record.content)) {
      for (const part of record.content) {
        if (!part || typeof part !== "object") continue;
        const type = (part as { type?: unknown }).type;
        if (type === "image_url" || type === "image" || type === "input_image") return true;
      }
    }
  }
  return false;
}

/**
 * Fallback token estimator when an upstream provider omits `usage`:
 * divides character length by 4 (ceiling).
 */
export function estimateTokensFromLength(textOrChars: string | number): number {
  const chars = typeof textOrChars === "number" ? textOrChars : textOrChars.length;
  if (!Number.isFinite(chars) || chars <= 0) return 0;
  return Math.ceil(chars / 4);
}

/**
 * Ceiling to the 0.5 credit step so minimum charge (0.5 credits) works naturally
 * while keeping upward rounding (`ceil`) consistent with token-based billing:
 *   - 1..500 base tokens   -> 0.5 credits
 *   - 501..1000 base tokens -> 1.0 credits
 *   - 1001..1500 base tokens -> 1.5 credits
 *   etc., clamped to [minCreditsPerRequest, maxCreditsPerRequest].
 */
export function ceilToCreditStep(raw: number, step = CREDIT_STEP): number {
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  const safeStep = step > 0 ? step : CREDIT_STEP;
  return roundCredits(Math.ceil((raw - 1e-9) / safeStep) * safeStep);
}

export interface CreditCalculationInput {
  tokensIn: number;
  tokensOut: number;
  modelWeight?: number | null;
  taskWeight?: number | null;
  policy?: Partial<CreditPolicy>;
}

export function calculateTokenCredits(input: CreditCalculationInput): number {
  const tokensIn = Math.max(0, Math.floor(Number(input.tokensIn) || 0));
  const tokensOut = Math.max(0, Math.floor(Number(input.tokensOut) || 0));
  const totalTokens = tokensIn + tokensOut;
  if (totalTokens <= 0) return 0;

  const modelWeight = resolveModelWeight(input.modelWeight);
  const taskWeight =
    typeof input.taskWeight === "number" && Number.isFinite(input.taskWeight) && input.taskWeight > 0
      ? input.taskWeight
      : 1.0;

  const minCredits =
    input.policy?.minCreditsPerRequest !== undefined
      ? roundCredits(Math.max(0, input.policy.minCreditsPerRequest))
      : DEFAULT_MIN_CREDITS_PER_REQUEST;
  const maxCredits =
    input.policy?.maxCreditsPerRequest !== undefined
      ? roundCredits(Math.max(minCredits, input.policy.maxCreditsPerRequest))
      : DEFAULT_MAX_CREDITS_PER_REQUEST;

  const raw = (totalTokens / 1000) * modelWeight * taskWeight;
  const ceiled = ceilToCreditStep(raw, CREDIT_STEP);
  return roundCredits(Math.min(maxCredits, Math.max(minCredits, ceiled)));
}

export interface ReservationEstimateInput {
  promptTokens: number;
  maxTokens?: number | null;
  modelWeight?: number | null;
  taskWeight?: number | null;
  policy?: Partial<CreditPolicy>;
}

/**
 * Estimates the upper-bound credits to reserve before sending the upstream request,
 * based on prompt length + configured max_tokens, bounded by `maxCreditsPerRequest`.
 */
export function estimateReservationCredits(input: ReservationEstimateInput): number {
  const promptTokens = Math.max(1, Math.floor(Number(input.promptTokens) || 0));
  const rawMaxTokens =
    typeof input.maxTokens === "number" && Number.isFinite(input.maxTokens) && input.maxTokens > 0
      ? Math.min(Math.floor(input.maxTokens), MAX_RESERVATION_TOKENS_CAP)
      : DEFAULT_RESERVATION_MAX_TOKENS;
  return calculateTokenCredits({
    tokensIn: promptTokens,
    tokensOut: rawMaxTokens,
    modelWeight: input.modelWeight,
    taskWeight: input.taskWeight,
    policy: input.policy,
  });
}

export function creditsExhaustedMessage(remaining: number): string {
  const formatted = formatCreditNumber(remaining);
  if (roundCredits(remaining) <= 0) {
    return `You have used all your credits (${formatted} credits remaining). Add your own provider key or contact the administrator to continue.`;
  }
  return `You don't have enough credits for this request (${formatted} credits remaining). Add your own provider key or contact the administrator to continue.`;
}

export function creditsExhaustedResponse(
  request: Request,
  env: SecurityEnv,
  remaining: number,
): Response {
  const safeRemaining = roundCredits(Math.max(0, remaining));
  const message = creditsExhaustedMessage(safeRemaining);
  return new Response(
    JSON.stringify({
      error: {
        message,
        code: "credits_exhausted",
        status: 402,
        remaining: safeRemaining,
      },
    }),
    {
      status: 402,
      headers: apiHeaders(request, env, {
        "Content-Type": "application/json; charset=utf-8",
        "X-Credits-Remaining": formatCreditNumber(safeRemaining),
      }),
    },
  );
}

// ---------------------------------------------------------------------------
// Server-side Supabase RPC wrappers (service_role ONLY)
// ---------------------------------------------------------------------------

export interface EnsureCreditsResult {
  balance: number;
  granted: boolean;
}

export interface CreditReservationHandle {
  ok: boolean;
  reservationId: string | null;
  reservedAmount: number;
  availableBalance: number;
  balance: number;
  /** True when the deployment has not yet applied 0007_token_credits.sql and fell back to legacy mode. */
  legacy?: boolean;
}

export interface CommitCreditsInput {
  actualAmount: number;
  reason?: "chat_usage" | "chat_stream_partial" | string;
  modelId?: string | null;
  tokensIn: number;
  tokensOut: number;
}

export interface CommitCreditsResult {
  charged: number;
  balance: number | null;
}

function firstRow<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/**
 * Ensures the user has an authoritative row in `user_credits` (one-time signup grant
 * with `reason = 'signup_grant'` enforced by primary key on `user_id`).
 */
export async function ensureUserCredits(
  env: SupabaseEnv,
  userId: string,
  signupCredits = DEFAULT_SIGNUP_CREDITS,
  fallbackProfileCredits?: number | null,
): Promise<EnsureCreditsResult> {
  try {
    const raw = await sbJson<
      Array<{ balance?: number | string; granted?: boolean }> | { balance?: number | string; granted?: boolean }
    >(env, "rpc/ensure_user_credits", {
      method: "POST",
      body: JSON.stringify({
        p_user: userId,
        p_signup_credits: roundCredits(Math.max(0, signupCredits)),
      }),
    });
    const row = firstRow(raw);
    const balance = parseNonNegativeNumber(row?.balance);
    if (balance !== null) {
      return { balance: roundCredits(balance), granted: Boolean(row?.granted) };
    }
  } catch {
    // Fall back to reading user_credits or profiles on older schemas.
  }

  try {
    const rows = await sbJson<Array<{ balance?: number | string }>>(
      env,
      `user_credits?select=balance&user_id=${eq(userId)}&limit=1`,
    );
    const balance = parseNonNegativeNumber(rows[0]?.balance);
    if (balance !== null) {
      return { balance: roundCredits(balance), granted: false };
    }
  } catch {
    // Older schema without user_credits table.
  }

  const legacy = parseNonNegativeNumber(fallbackProfileCredits);
  return {
    balance: roundCredits(legacy !== null ? legacy : signupCredits),
    granted: false,
  };
}

/**
 * Atomically reserves up to `estimatedAmount` credits in `credit_reservations`
 * using the Postgres `reserve_user_credits` RPC (`FOR UPDATE` row lock).
 */
export async function reserveUserCredits(
  env: SupabaseEnv,
  userId: string,
  estimatedAmount: number,
  minRequired = DEFAULT_MIN_CREDITS_PER_REQUEST,
  fallbackProfileCredits?: number | null,
): Promise<CreditReservationHandle> {
  const safeEstimated = roundCredits(Math.max(minRequired, estimatedAmount));
  const safeMin = roundCredits(Math.max(0, minRequired));

  try {
    const raw = await sbJson<
      | Array<{
          ok?: boolean;
          reservation_id?: string | null;
          reserved_amount?: number | string;
          available_balance?: number | string;
          balance?: number | string;
        }>
      | {
          ok?: boolean;
          reservation_id?: string | null;
          reserved_amount?: number | string;
          available_balance?: number | string;
          balance?: number | string;
        }
    >(env, "rpc/reserve_user_credits", {
      method: "POST",
      body: JSON.stringify({
        p_user: userId,
        p_amount: safeEstimated,
        p_min_required: safeMin,
      }),
    });
    const row = firstRow(raw);
    if (row && typeof row.ok === "boolean") {
      const balance = roundCredits(parseNonNegativeNumber(row.balance) ?? 0);
      const availableBalance = roundCredits(parseNonNegativeNumber(row.available_balance) ?? 0);
      const reservedAmount = roundCredits(parseNonNegativeNumber(row.reserved_amount) ?? 0);
      return {
        ok: row.ok,
        reservationId: typeof row.reservation_id === "string" ? row.reservation_id : null,
        reservedAmount,
        availableBalance,
        balance,
      };
    }
  } catch {
    // Fall back for deployments or unit tests that haven't mounted the 0007 RPCs yet.
  }

  const legacyBalance = roundCredits(parseNonNegativeNumber(fallbackProfileCredits) ?? 0);
  if (legacyBalance < safeMin) {
    return {
      ok: false,
      reservationId: null,
      reservedAmount: 0,
      availableBalance: legacyBalance,
      balance: legacyBalance,
      legacy: true,
    };
  }
  const held = roundCredits(Math.min(safeEstimated, legacyBalance));
  return {
    ok: true,
    reservationId: null,
    reservedAmount: held,
    availableBalance: roundCredits(Math.max(0, legacyBalance - held)),
    balance: legacyBalance,
    legacy: true,
  };
}

/**
 * Atomically commits the actual calculated credits for a reservation, writes
 * the `credit_ledger` entry, and releases any unspent portion of the reservation.
 */
export async function commitCreditReservation(
  env: SupabaseEnv,
  userId: string,
  reservation: CreditReservationHandle,
  input: CommitCreditsInput,
): Promise<CommitCreditsResult> {
  const actualAmount = roundCredits(Math.max(0, input.actualAmount));
  const tokensIn = Math.max(0, Math.floor(Number(input.tokensIn) || 0));
  const tokensOut = Math.max(0, Math.floor(Number(input.tokensOut) || 0));

  if (reservation.reservationId && !reservation.legacy) {
    try {
      const raw = await sbJson<
        Array<{ charged?: number | string; balance?: number | string }> | { charged?: number | string; balance?: number | string }
      >(env, "rpc/commit_credit_reservation", {
        method: "POST",
        body: JSON.stringify({
          p_reservation_id: reservation.reservationId,
          p_actual_amount: actualAmount,
          p_reason: input.reason ?? "chat_usage",
          p_model_id: input.modelId ?? null,
          p_tokens_in: tokensIn,
          p_tokens_out: tokensOut,
        }),
      });
      const row = firstRow(raw);
      const charged = parseNonNegativeNumber(row?.charged);
      const balance = parseNonNegativeNumber(row?.balance);
      if (charged !== null) {
        return {
          charged: roundCredits(charged),
          balance: balance !== null ? roundCredits(balance) : null,
        };
      }
    } catch {
      // Fall through to legacy fallback if RPC failed unexpectedly.
    }
  }

  // Legacy fallback (deployments before 0007_token_credits.sql)
  if (actualAmount <= 0) {
    return { charged: 0, balance: reservation.balance };
  }
  try {
    const remaining = await sbJson<number | null>(env, "rpc/consume_user_credit", {
      method: "POST",
      body: JSON.stringify({ p_user: userId, p_amount: actualAmount }),
    });
    const parsedRemaining = parseNonNegativeNumber(remaining);
    return {
      charged: actualAmount,
      balance: parsedRemaining !== null ? roundCredits(parsedRemaining) : null,
    };
  } catch {
    return { charged: 0, balance: null };
  }
}

/**
 * Releases an active reservation without deducting any credits.
 */
export async function releaseCreditReservation(
  env: SupabaseEnv,
  reservation: CreditReservationHandle,
): Promise<number | null> {
  if (!reservation.reservationId || reservation.legacy) {
    return reservation.balance;
  }
  try {
    const balance = await sbJson<number | string | null>(env, "rpc/release_credit_reservation", {
      method: "POST",
      body: JSON.stringify({ p_reservation_id: reservation.reservationId }),
    });
    const parsed = parseNonNegativeNumber(balance);
    return parsed !== null ? roundCredits(parsed) : null;
  } catch {
    return null;
  }
}
