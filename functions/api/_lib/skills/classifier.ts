// Fast, lightweight LLM-based category classifier with strict JSON output,
// multi-turn history awareness, configurable env model, safe fallback to "chat",
// and privacy-safe logging (logs category metadata only, never user text).

import type { ApiFormat, ProviderRow } from "../providerKeys";
import { buildUpstreamRequest, normalizeJson } from "../upstream";
import { getSkillRegistry } from "./registry";
import {
  extractPlainText,
  isSkillCategory,
  normalizeSkillMode,
  type ClassificationResult,
  type SkillCategory,
  type SkillChatMessage,
  type SkillMode,
  type SkillRuntimeEnv,
} from "./types";

export const CLASSIFIER_SYSTEM_PROMPT = [
  "You are a fast request category classifier.",
  "Classify the user's conversation (using recent turns for follow-up context) into EXACTLY ONE category:",
  '- "website": building, designing, styling, fixing, or editing a website, landing page, web app, dashboard, portfolio, UI component, CSS/HTML/React/Next.js frontend, or 3D web experience.',
  '- "game": building, designing, coding, or editing a video game or game system (2D/3D browser game, Godot, Unity, Unreal, Phaser, PixiJS, Three.js game, Pygame, Roblox, platformer, shooter, RPG, shaders/physics for games).',
  '- "chat": casual greetings, small talk, simple factual questions, quick translations, short writing/editing, or everyday conversation.',
  '- "deep_thinking": hard analytical questions, complex trade-off comparisons, system architecture design, scientific/mathematical/economic reasoning, root-cause debugging, or rigorous strategic analysis.',
  '- "other": requests that do not fit any of the four categories above.',
  "",
  "Rules:",
  "- If the latest user turn is a short follow-up (e.g. 'make the hero darker', 'add double jump', 'go deeper on option 2'), keep the active category from earlier turns.",
  '- Return ONLY strict JSON with no markdown or extra text: {"category":"website|game|chat|deep_thinking|other","confidence":0.0}',
].join("\n");

export interface ClassifierTransportCredentials {
  baseUrl: string;
  apiKey: string;
  apiFormat: ApiFormat;
  model: string;
  authHeader?: string | null;
  authPrefix?: string | null;
  extraHeaders?: Record<string, string> | null;
}

export type ClassifierCaller = (args: {
  systemPrompt: string;
  transcript: string;
  model: string;
  timeoutMs: number;
}) => Promise<string>;

export interface ClassifyRequestOptions {
  messages: SkillChatMessage[];
  skillMode?: SkillMode | string;
  env?: SkillRuntimeEnv;
  /** Optional fallback upstream credentials if dedicated SKILL_CLASSIFIER_* env vars are not set. */
  fallbackCredentials?: ClassifierTransportCredentials | null;
  /** Optional DI hook (for tests or custom runners). */
  callClassifier?: ClassifierCaller;
  /** Optional custom logger (defaults to console.info). */
  logger?: (message: string) => void;
}

/**
 * Formats the last N user/assistant messages into a compact transcript for the
 * classifier so follow-ups keep their active category without sending large payloads.
 */
export function buildClassifierTranscript(
  messages: SkillChatMessage[],
  maxMessages = 6
): string {
  const nonSystem = messages.filter(
    (m) => m.role === "user" || m.role === "assistant"
  );
  const recent = nonSystem.slice(-Math.max(1, maxMessages));
  return recent
    .map((m, idx) => {
      const label = m.role === "user" ? "User" : "Assistant";
      const text = extractPlainText(m.content).replace(/\s+/g, " ").trim();
      const cap = idx === recent.length - 1 ? 600 : 280;
      const clipped = text.length > cap ? `${text.slice(0, cap)}...` : text;
      return `${label}: ${clipped}`;
    })
    .filter((line) => line.length > 6)
    .join("\n");
}

/**
 * Parses strict JSON output from the classifier LLM.
 * Returns null if invalid JSON, unknown category, or below minimum confidence.
 */
export function parseClassifierResponse(
  raw: string,
  minConfidence = 0.45
): { category: SkillCategory; confidence: number } | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  const tryParse = (candidate: string): Record<string, unknown> | null => {
    try {
      const parsed = JSON.parse(candidate);
      return parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  };

  let obj = tryParse(trimmed);
  if (!obj) {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start !== -1 && end > start) {
      obj = tryParse(trimmed.slice(start, end + 1));
    }
  }
  if (!obj) return null;

  const rawCat = typeof obj.category === "string" ? obj.category.trim().toLowerCase() : "";
  if (!isSkillCategory(rawCat)) return null;

  const rawConf =
    typeof obj.confidence === "number" && Number.isFinite(obj.confidence)
      ? Math.max(0, Math.min(1, obj.confidence))
      : 0.85;

  if (rawConf < minConfidence) return null;

  return { category: rawCat, confidence: rawConf };
}

/**
 * Resolves the classifier model, timeout, and credentials from env + skills.config.json.
 */
export function resolveClassifierSettings(
  env?: SkillRuntimeEnv,
  fallbackCredentials?: ClassifierTransportCredentials | null
): {
  model: string;
  timeoutMs: number;
  historyMessages: number;
  fallbackCategory: SkillCategory;
  minConfidence: number;
  credentials: ClassifierTransportCredentials | null;
} {
  const cfg = getSkillRegistry().config.defaults.classifier;
  const envModel =
    typeof env?.SKILL_CLASSIFIER_MODEL === "string" && env.SKILL_CLASSIFIER_MODEL.trim()
      ? env.SKILL_CLASSIFIER_MODEL.trim()
      : "";
  const envTimeout = Number(env?.SKILL_CLASSIFIER_TIMEOUT_MS);
  const timeoutMs =
    Number.isFinite(envTimeout) && envTimeout >= 300
      ? Math.min(20000, envTimeout)
      : cfg.timeoutMs;

  const envBase =
    typeof env?.SKILL_CLASSIFIER_BASE_URL === "string"
      ? env.SKILL_CLASSIFIER_BASE_URL.trim()
      : "";
  const envKey =
    typeof env?.SKILL_CLASSIFIER_API_KEY === "string"
      ? env.SKILL_CLASSIFIER_API_KEY.trim()
      : "";
  const envFormatRaw =
    typeof env?.SKILL_CLASSIFIER_API_FORMAT === "string"
      ? env.SKILL_CLASSIFIER_API_FORMAT.trim().toLowerCase()
      : "openai";
  const envFormat: ApiFormat =
    envFormatRaw === "anthropic" ||
    envFormatRaw === "gemini" ||
    envFormatRaw === "custom"
      ? envFormatRaw
      : "openai";

  let credentials: ClassifierTransportCredentials | null = null;
  let model = envModel || cfg.model;

  if (envBase && envKey) {
    credentials = {
      baseUrl: envBase,
      apiKey: envKey,
      apiFormat: envFormat,
      model,
    };
  } else if (fallbackCredentials && fallbackCredentials.baseUrl && fallbackCredentials.apiKey) {
    // Reuse active provider credentials with configured classifier model (if explicitly set in env)
    // or the active provider's model so we never fail due to an incompatible model slug on another provider.
    model = envModel || fallbackCredentials.model || cfg.model;
    credentials = {
      ...fallbackCredentials,
      model,
    };
  }

  return {
    model,
    timeoutMs,
    historyMessages: cfg.historyMessages,
    fallbackCategory: cfg.fallbackCategory,
    minConfidence: cfg.minConfidence,
    credentials,
  };
}

/**
 * Default HTTP LLM call for the classifier, provider-agnostic across OpenAI / Anthropic / Gemini / custom.
 */
async function callClassifierOverHttp(
  credentials: ClassifierTransportCredentials,
  args: { systemPrompt: string; transcript: string; model: string; timeoutMs: number }
): Promise<string> {
  const defaultAuthHeader =
    credentials.apiFormat === "anthropic"
      ? "x-api-key"
      : credentials.apiFormat === "gemini"
        ? null
        : "Authorization";
  const defaultAuthPrefix =
    credentials.apiFormat === "anthropic" || credentials.apiFormat === "gemini"
      ? null
      : "Bearer ";

  const now = new Date().toISOString();
  const providerRow: ProviderRow = {
    id: "skill-classifier",
    name: "Skill Classifier",
    base_url: credentials.baseUrl,
    api_format: credentials.apiFormat,
    auth_header:
      credentials.authHeader !== undefined ? credentials.authHeader : defaultAuthHeader,
    auth_prefix:
      credentials.authPrefix !== undefined ? credentials.authPrefix : defaultAuthPrefix,
    extra_headers: credentials.extraHeaders ?? null,
    icon: null,
    color: null,
    notes: null,
    enabled: true,
    created_at: now,
    updated_at: now,
  };

  const built = buildUpstreamRequest(
    providerRow,
    credentials.apiKey,
    {
      model: args.model,
      stream: false,
      temperature: 0,
      max_tokens: 64,
      messages: [
        { role: "system", content: args.systemPrompt },
        { role: "user", content: args.transcript },
      ],
    },
    false
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs);
  try {
    const res = await fetch(built.url, {
      ...built.init,
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`classifier_http_${res.status}`);
    }
    const raw = await res.json();
    const normalized = normalizeJson(credentials.apiFormat, raw);
    return normalized.choices[0]?.message?.content || "";
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Classifies a conversation turn into: website | game | chat | deep_thinking | other.
 * - Honors explicit manual override if provided (skillMode !== "auto").
 * - Runs fast LLM JSON classifier using the last few messages.
 * - Safely falls back to "chat" on error, timeout, invalid JSON, or low confidence.
 * - Logs ONLY category/source/confidence (no user text or private content).
 */
export async function classifyRequestCategory(
  options: ClassifyRequestOptions
): Promise<ClassificationResult> {
  const log =
    options.logger ||
    ((line: string) => {
      try {
        console.info(line);
      } catch {
        // ignore logging failures
      }
    });

  const mode = normalizeSkillMode(options.skillMode);
  if (mode !== "auto") {
    const result: ClassificationResult = {
      category: mode,
      source: "manual",
      confidence: 1,
      reason: "manual_override",
    };
    log(`[skills] category=${result.category} source=manual`);
    return result;
  }

  const settings = resolveClassifierSettings(
    options.env,
    options.fallbackCredentials
  );
  const transcript = buildClassifierTranscript(
    options.messages,
    settings.historyMessages
  );

  if (!transcript) {
    const result: ClassificationResult = {
      category: settings.fallbackCategory,
      source: "fallback",
      confidence: 0,
      reason: "empty_transcript",
    };
    log(`[skills] category=${result.category} source=fallback reason=empty_transcript`);
    return result;
  }

  const runner: ClassifierCaller | null = options.callClassifier
    ? options.callClassifier
    : settings.credentials
      ? (args) => callClassifierOverHttp(settings.credentials!, args)
      : null;

  if (!runner) {
    const result: ClassificationResult = {
      category: settings.fallbackCategory,
      source: "fallback",
      confidence: 0,
      reason: "no_classifier_credentials",
    };
    log(`[skills] category=${result.category} source=fallback reason=no_credentials`);
    return result;
  }

  try {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const rawResponse = await Promise.race<string>([
      runner({
        systemPrompt: CLASSIFIER_SYSTEM_PROMPT,
        transcript,
        model: settings.model,
        timeoutMs: settings.timeoutMs,
      }),
      new Promise<string>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error("classifier_timeout")),
          settings.timeoutMs
        );
      }),
    ]).finally(() => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    });

    const parsed = parseClassifierResponse(rawResponse, settings.minConfidence);
    if (!parsed) {
      const result: ClassificationResult = {
        category: settings.fallbackCategory,
        source: "fallback",
        confidence: 0,
        model: settings.model,
        reason: "invalid_or_low_confidence_json",
      };
      log(`[skills] category=${result.category} source=fallback reason=invalid_json`);
      return result;
    }

    const result: ClassificationResult = {
      category: parsed.category,
      source: "llm",
      confidence: parsed.confidence,
      model: settings.model,
    };
    log(
      `[skills] category=${result.category} source=llm confidence=${result.confidence.toFixed(2)}`
    );
    return result;
  } catch (err) {
    const reason =
      err instanceof Error && err.message ? err.message.slice(0, 48) : "classifier_error";
    const result: ClassificationResult = {
      category: settings.fallbackCategory,
      source: "fallback",
      confidence: 0,
      model: settings.model,
      reason,
    };
    log(`[skills] category=${result.category} source=fallback reason=${reason}`);
    return result;
  }
}
