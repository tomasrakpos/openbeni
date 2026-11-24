// Shared Free Model Router engine — pure TypeScript used by Cloudflare Pages
// Functions, the Vite frontend, and Vitest.
// Zero secrets, zero browser-only or Node-only APIs.

export type ModelPricingClass = "free" | "paid" | "unknown";
export type RouterType = "free";

export interface RouterMemberCandidate {
  id: string;
  modelId: string;
  displayName?: string;
  pricing: ModelPricingClass;
  enabled: boolean;
  locked?: boolean;
  providerEnabled?: boolean;
  position?: number;
}

export interface RouterRecord {
  id: string;
  ownerUserId: string | null; // null => public admin router
  providerId: string | null;
  userProviderId: string | null;
  providerName?: string;
  name: string;
  type: RouterType;
  enabled: boolean;
  activeMemberCount: number;
  memberModelIds: string[];
  createdAt: string;
  updatedAt?: string;
}

export type RouterNameErrorCode =
  | "empty"
  | "too_short"
  | "too_long"
  | "control_chars"
  | "duplicate_name"
  | "collides_with_model";

export interface RouterNameValidationResult {
  ok: boolean;
  normalized: string;
  code?: RouterNameErrorCode;
  message?: string;
}

export const ROUTER_NAME_MIN_LENGTH = 2;
export const ROUTER_NAME_MAX_LENGTH = 32;
export const ROUTER_MAX_FAILOVER_ATTEMPTS = 3;
export const ROUTER_DEFAULT_COOLDOWN_MS = 60_000;
export const ROUTER_DEFAULT_STICKY_MS = 30_000;

const CONTROL_CHAR_RE = /[\u0000-\u001F\u007F-\u009F]/;

export function normalizeRouterKey(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Validates a router name against:
 * - 2–32 characters (after trim)
 * - No ASCII/Unicode control characters
 * - Unique within its owner scope (case-insensitive)
 * - No collision with any real model name or model ID (case-insensitive)
 */
export function validateRouterName(
  rawName: string,
  options: {
    existingRouterNames?: Iterable<string>;
    existingModelNames?: Iterable<string>;
  } = {},
): RouterNameValidationResult {
  if (typeof rawName !== "string") {
    return {
      ok: false,
      normalized: "",
      code: "empty",
      message: "Router name is required.",
    };
  }
  if (CONTROL_CHAR_RE.test(rawName)) {
    return {
      ok: false,
      normalized: rawName.trim(),
      code: "control_chars",
      message: "Router name must not contain control characters.",
    };
  }
  const normalized = rawName.trim();
  if (!normalized) {
    return {
      ok: false,
      normalized,
      code: "empty",
      message: "Router name is required.",
    };
  }
  if (normalized.length < ROUTER_NAME_MIN_LENGTH) {
    return {
      ok: false,
      normalized,
      code: "too_short",
      message: `Router name must be at least ${ROUTER_NAME_MIN_LENGTH} characters.`,
    };
  }
  if (normalized.length > ROUTER_NAME_MAX_LENGTH) {
    return {
      ok: false,
      normalized,
      code: "too_long",
      message: `Router name must be at most ${ROUTER_NAME_MAX_LENGTH} characters.`,
    };
  }

  const lower = normalizeRouterKey(normalized);
  if (options.existingRouterNames) {
    for (const existing of options.existingRouterNames) {
      if (normalizeRouterKey(existing) === lower) {
        return {
          ok: false,
          normalized,
          code: "duplicate_name",
          message: "A router with this name already exists.",
        };
      }
    }
  }
  if (options.existingModelNames) {
    for (const modelName of options.existingModelNames) {
      if (normalizeRouterKey(modelName) === lower) {
        return {
          ok: false,
          normalized,
          code: "collides_with_model",
          message: "Router name cannot match an existing model name.",
        };
      }
    }
  }

  return { ok: true, normalized };
}

/**
 * Strictly filters models eligible for a Free Router:
 * ONLY models explicitly classified as `pricing === "free"` that are enabled
 * and unlocked. Models marked `paid` or `unknown` are ALWAYS excluded.
 */
export function filterFreeEligibleModels<T extends RouterMemberCandidate>(
  models: readonly T[],
): T[] {
  return models
    .filter(
      (m) =>
        m.pricing === "free" &&
        m.enabled === true &&
        m.locked !== true &&
        m.providerEnabled !== false,
    )
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

/**
 * Normalizes any pricing string into a strict `'free' | 'paid' | 'unknown'`.
 * Never guesses `'free'` when pricing is missing or unrecognized.
 */
export function normalizeModelPricing(value: unknown): ModelPricingClass {
  if (value === "free" || value === "paid" || value === "unknown") return value;
  return "unknown";
}

/**
 * Returns true if an HTTP status code from an upstream provider should trigger
 * automatic router failover before streaming begins.
 */
export function isRetryableRouterStatus(status: number | null | undefined): boolean {
  if (typeof status !== "number" || !Number.isFinite(status)) return false;
  if (status === 401 || status === 403 || status === 404 || status === 429) return true;
  if (status >= 500 && status <= 599) return true;
  return false;
}

export function isTimeoutOrNetworkError(err: unknown): boolean {
  if (!err) return false;
  const name = err instanceof Error ? err.name : "";
  const message = err instanceof Error ? err.message : String(err);
  if (name === "AbortError" || name === "TimeoutError") return true;
  return /(timeout|timed\s*out|econnreset|econnrefused|enotfound|fetch failed|network|socket hang up|upstream unreachable)/i.test(
    message,
  );
}

export interface RouterAttemptError {
  status?: number | null;
  message: string;
  timeout?: boolean;
  network?: boolean;
}

export function isRetryableRouterFailure(error: RouterAttemptError): boolean {
  if (error.timeout || error.network) return true;
  if (isRetryableRouterStatus(error.status)) return true;
  return false;
}

interface RouterRuntimeState {
  cursor: number;
  lastSuccessMemberId: string | null;
  lastSuccessAt: number;
  lastFailoverAt: number;
  cooldownUntil: Map<string, number>;
}

export interface RouterSchedulerOptions {
  cooldownMs?: number;
  stickyWindowMs?: number;
}

/**
 * Round-robin router scheduler with short-term priority for the last
 * successful model and temporary cooldown for failing members.
 *
 * Behavior:
 * - Healthy steady-state: rotates evenly across all active members via Round-robin.
 * - After a member failure/cooldown or failover recovery: prioritizes the last
 *   successful healthy member within `stickyWindowMs` so immediate follow-up
 *   requests land on the proven healthy model first, while keeping other healthy
 *   members ordered via Round-robin as fallbacks.
 * - During any single request's failover chain, if the Round-robin pick fails,
 *   the last successful healthy member is tried next before other fallbacks.
 */
export class RouterScheduler {
  private readonly states = new Map<string, RouterRuntimeState>();
  private readonly cooldownMs: number;
  private readonly stickyWindowMs: number;

  constructor(options: RouterSchedulerOptions = {}) {
    this.cooldownMs = options.cooldownMs ?? ROUTER_DEFAULT_COOLDOWN_MS;
    this.stickyWindowMs = options.stickyWindowMs ?? ROUTER_DEFAULT_STICKY_MS;
  }

  private getState(routerId: string): RouterRuntimeState {
    let state = this.states.get(routerId);
    if (!state) {
      state = {
        cursor: 0,
        lastSuccessMemberId: null,
        lastSuccessAt: 0,
        lastFailoverAt: 0,
        cooldownUntil: new Map(),
      };
      this.states.set(routerId, state);
    }
    return state;
  }

  public isMemberCoolingDown(
    routerId: string,
    memberId: string,
    now = Date.now(),
  ): boolean {
    const state = this.states.get(routerId);
    if (!state) return false;
    const until = state.cooldownUntil.get(memberId);
    if (until == null) return false;
    if (until <= now) {
      state.cooldownUntil.delete(memberId);
      return false;
    }
    return true;
  }

  public recordSuccess(
    routerId: string,
    memberId: string,
    options: { viaFailover?: boolean; now?: number } = {},
  ): void {
    const now = options.now ?? Date.now();
    const state = this.getState(routerId);
    state.lastSuccessMemberId = memberId;
    state.lastSuccessAt = now;
    if (options.viaFailover) {
      state.lastFailoverAt = now;
    }
    state.cooldownUntil.delete(memberId);
  }

  public recordFailure(
    routerId: string,
    memberId: string,
    cooldownMs = this.cooldownMs,
    now = Date.now(),
  ): void {
    const state = this.getState(routerId);
    if (cooldownMs > 0) {
      state.cooldownUntil.set(memberId, now + cooldownMs);
    }
    if (state.lastSuccessMemberId === memberId) {
      state.lastSuccessMemberId = null;
    }
  }

  /**
   * Returns ordered candidate members for a single request and advances the
   * Round-robin cursor.
   */
  public nextOrder<T extends { id: string }>(
    routerId: string,
    members: readonly T[],
    now = Date.now(),
  ): T[] {
    if (members.length === 0) return [];
    const state = this.getState(routerId);

    // Prune expired cooldowns
    for (const [id, until] of state.cooldownUntil) {
      if (until <= now) state.cooldownUntil.delete(id);
    }

    const healthy: T[] = [];
    const cooling: T[] = [];
    for (const member of members) {
      if (state.cooldownUntil.has(member.id)) {
        cooling.push(member);
      } else {
        healthy.push(member);
      }
    }

    // Sort cooling members by earliest expiry so if everything is cooling we still try best-first
    cooling.sort(
      (a, b) =>
        (state.cooldownUntil.get(a.id) ?? 0) - (state.cooldownUntil.get(b.id) ?? 0),
    );

    const activePool = healthy.length > 0 ? healthy : cooling;
    const startIdx = state.cursor % activePool.length;
    state.cursor = (state.cursor + 1) % Math.max(1, activePool.length);

    // Base Round-robin order across the active pool
    const rrOrder: T[] = [];
    for (let i = 0; i < activePool.length; i++) {
      rrOrder.push(activePool[(startIdx + i) % activePool.length]);
    }

    // Short-term priority for the last successful healthy member:
    // - If a failover occurred recently OR any sibling is in cooldown within
    //   `stickyWindowMs`, promote `lastSuccessMemberId` to position 0.
    // - Otherwise (all peers healthy), place `lastSuccessMemberId` as the first
    //   fallback right after the Round-robin primary pick so steady-state traffic
    //   still rotates evenly while failover immediately hits the proven model.
    const stickyValid =
      Boolean(state.lastSuccessMemberId) &&
      now - state.lastSuccessAt <= this.stickyWindowMs;

    if (stickyValid && state.lastSuccessMemberId) {
      const idx = rrOrder.findIndex((m) => m.id === state.lastSuccessMemberId);
      if (idx > 0) {
        const [stickyMember] = rrOrder.splice(idx, 1);
        const recentDegradation =
          cooling.length > 0 || now - state.lastFailoverAt <= this.stickyWindowMs;
        if (recentDegradation) {
          rrOrder.unshift(stickyMember);
        } else {
          rrOrder.splice(1, 0, stickyMember);
        }
      }
    }

    // Append cooling members at the tail only if healthy pool wasn't empty
    return healthy.length > 0 ? [...rrOrder, ...cooling] : rrOrder;
  }

  public reset(routerId?: string): void {
    if (routerId) {
      this.states.delete(routerId);
    } else {
      this.states.clear();
    }
  }
}

export interface RouterFailoverAttemptLog<T> {
  attempt: number;
  member: T;
  ok: boolean;
  status?: number | null;
  error?: string;
}

export interface RouterFailoverResult<T, R> {
  ok: boolean;
  value?: R;
  usedMember?: T;
  attempts: RouterFailoverAttemptLog<T>[];
  midStreamInterrupted: boolean;
  error?: string;
  status?: number | null;
}

/**
 * Executes a router request across ordered members with:
 * - Up to `maxAttempts` (default 3) retries on pre-stream retryable errors
 *   (401, 403, 404, 429, 5xx, timeout, network).
 * - Immediate halt (NO failover / NO restart) if `markStreamStarted()` has been
 *   invoked and the stream subsequently drops.
 */
export async function executeWithRouterFailover<T extends { id: string }, R>(
  options: {
    routerId: string;
    members: readonly T[];
    scheduler: RouterScheduler;
    maxAttempts?: number;
    now?: () => number;
    execute: (
      member: T,
      controls: {
        attempt: number;
        markStreamStarted: () => void;
      },
    ) => Promise<
      | { ok: true; value: R }
      | { ok: false; error: RouterAttemptError }
    >;
  },
): Promise<RouterFailoverResult<T, R>> {
  const nowFn = options.now ?? (() => Date.now());
  const ordered = options.scheduler.nextOrder(options.routerId, options.members, nowFn());
  if (ordered.length === 0) {
    return {
      ok: false,
      attempts: [],
      midStreamInterrupted: false,
      status: 503,
      error: "No active free models are available in this router.",
    };
  }

  const maxAttempts = Math.min(
    Math.max(1, options.maxAttempts ?? ROUTER_MAX_FAILOVER_ATTEMPTS),
    ordered.length,
  );
  const attempts: RouterFailoverAttemptLog<T>[] = [];
  let lastError = "Router request failed.";
  let lastStatus: number | null | undefined = 502;

  for (let i = 0; i < maxAttempts; i++) {
    const member = ordered[i];
    const attemptNumber = i + 1;
    let streamStarted = false;
    const markStreamStarted = () => {
      streamStarted = true;
    };

    try {
      const outcome = await options.execute(member, {
        attempt: attemptNumber,
        markStreamStarted,
      });

      if (outcome.ok) {
        options.scheduler.recordSuccess(options.routerId, member.id, {
          viaFailover: i > 0,
          now: nowFn(),
        });
        attempts.push({ attempt: attemptNumber, member, ok: true });
        return {
          ok: true,
          value: outcome.value,
          usedMember: member,
          attempts,
          midStreamInterrupted: false,
        };
      }

      lastError = outcome.error.message || "Upstream model error.";
      lastStatus = outcome.error.status ?? null;
      attempts.push({
        attempt: attemptNumber,
        member,
        ok: false,
        status: lastStatus,
        error: lastError,
      });

      if (streamStarted) {
        // Stream already delivered output — NEVER restart from scratch on another model.
        return {
          ok: false,
          usedMember: member,
          attempts,
          midStreamInterrupted: true,
          status: lastStatus,
          error: lastError,
        };
      }

      options.scheduler.recordFailure(options.routerId, member.id, undefined, nowFn());

      if (!isRetryableRouterFailure(outcome.error)) {
        return {
          ok: false,
          usedMember: member,
          attempts,
          midStreamInterrupted: false,
          status: lastStatus,
          error: lastError,
        };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isTimeoutNet = isTimeoutOrNetworkError(err);
      lastError = message || "Router request failed.";
      lastStatus = isTimeoutNet ? 504 : 500;
      attempts.push({
        attempt: attemptNumber,
        member,
        ok: false,
        status: lastStatus,
        error: lastError,
      });

      if (streamStarted) {
        return {
          ok: false,
          usedMember: member,
          attempts,
          midStreamInterrupted: true,
          status: lastStatus,
          error: lastError,
        };
      }

      options.scheduler.recordFailure(options.routerId, member.id, undefined, nowFn());

      if (!isTimeoutNet) {
        return {
          ok: false,
          usedMember: member,
          attempts,
          midStreamInterrupted: false,
          status: lastStatus,
          error: lastError,
        };
      }
    }
  }

  return {
    ok: false,
    attempts,
    midStreamInterrupted: false,
    status: lastStatus ?? 502,
    error: `All ${attempts.length} router attempts failed: ${lastError}`,
  };
}
