// Shared logic registry; change this helper here and update callers if its contract changes.
import registry from "@/data/models.json";
import type { AIModel, Capability, ModelPricing, Provider, Tier } from "@/lib/types";

export interface RegistryEntry {
  match: string;
  tier: Tier;
  context?: number;
  capabilities?: Capability[];
  pricing?: ModelPricing;
}

const ENTRIES = registry as RegistryEntry[];

export function curatedFor(modelId: string): RegistryEntry | undefined {
  const id = modelId.toLowerCase();
  let best: RegistryEntry | undefined;
  for (const entry of ENTRIES) {
    if (id.includes(entry.match.toLowerCase())) {
      if (!best || entry.match.length > best.match.length) best = entry;
    }
  }
  return best;
}

const VISION = /(gpt-4o|gpt-4\.1|gpt-5|claude|gemini|llava|vision|qwen[\d.]*-?vl|gemma3|pixtral|internvl|grok-.*vision|o3|o4)/i;
const VIDEO = /(gemini|video|veo)/i;
const AUDIO = /(audio|realtime|speech|whisper|tts)/i;
const TOOLS = /(gpt|claude|gemini|qwen|llama-?3|llama-?4|mistral|mixtral|deepseek|grok|command|phi-?4|glm|kimi|minimax)/i;
const REASONING = /(^|[-_.])(o1|o3|o4)([-_.]|$)|reason|thinking|qwq|r1|deepseek-r/i;

export function inferCapabilities(modelId: string): Capability[] {
  const curated = curatedFor(modelId)?.capabilities;
  if (curated?.length) return [...curated];
  const caps = new Set<Capability>(["text"]);
  if (VISION.test(modelId)) caps.add("vision");
  if (VIDEO.test(modelId)) caps.add("video");
  if (AUDIO.test(modelId)) caps.add("audio");
  if (TOOLS.test(modelId)) caps.add("tools");
  if (REASONING.test(modelId)) caps.add("reasoning");
  return [...caps];
}

export function inferContextWindow(modelId: string): number | undefined {
  return curatedFor(modelId)?.context;
}

export function isLocalProvider(provider?: Pick<Provider, "baseUrl">): boolean {
  if (!provider) return false;
  try {
    const host = new URL(provider.baseUrl).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host.endsWith(".local");
  } catch {
    return false;
  }
}

const PAID_ONLY_HOSTS = new Set([
  "api.openai.com",
  "api.anthropic.com",
  "api.deepseek.com",
  "api.x.ai",
  "api.perplexity.ai",
  "api.cohere.com",
  "api.cohere.ai",
  "api.mistral.ai",
  "api.together.xyz",
  "api.fireworks.ai",
]);

const FREE_TIER_HOSTS = new Set([
  "api.groq.com",
  "api.cerebras.ai",
  "models.inference.ai.azure.com",
  "models.github.ai",
  "api.sambanova.ai",
  "gen.pollinations.ai",
]);

export function tierSortRank(tier: Tier): number {
  if (tier === "free") return 0;
  if (tier === "unknown") return 1;
  return 2;
}

/**
 * Free/Paid source of truth, in order:
 *  1. user override
 *  2. provider metadata pricing (zero = free, above zero = paid)
 *  3. explicit ":free" / "-free" suffix or local provider
 *  4. stored tier from smart live inspection ("free" | "paid")
 *  5. provider host policy + bundled curated registry
 *  6. unknown — never guess
 */
export function resolveTier(args: {
  modelId: string;
  tierOverride?: Tier;
  pricing?: ModelPricing;
  provider?: Pick<Provider, "baseUrl">;
  /** The tier stored on the model when it was added from a preset or smart inspector. */
  suggestedTier?: Tier;
}): Tier {
  if (args.tierOverride) return args.tierOverride;
  if (args.pricing) {
    return args.pricing.prompt === 0 && args.pricing.completion === 0 ? "free" : "paid";
  }
  if (/(?::free|\/free|-free)$/i.test(args.modelId) || args.modelId.toLowerCase().includes(":free")) return "free";
  if (isLocalProvider(args.provider)) return "free";
  if (args.suggestedTier === "free" || args.suggestedTier === "paid") return args.suggestedTier;

  let host = "";
  if (args.provider?.baseUrl) {
    try {
      host = new URL(args.provider.baseUrl).hostname.toLowerCase();
    } catch {
      host = "";
    }
  }
  if (host && FREE_TIER_HOSTS.has(host)) return "free";
  if (host && PAID_ONLY_HOSTS.has(host)) return "paid";
  if (host === "openrouter.ai" || host === "www.openrouter.ai") return "paid";

  const curated = curatedFor(args.modelId);
  if (curated?.tier) return curated.tier;
  return "unknown";
}

export function suggestedMeta(modelId: string, provider?: Pick<Provider, "baseUrl">): {
  tier: Tier;
  contextWindow?: number;
  capabilities: Capability[];
  pricing?: ModelPricing;
} {
  const curated = curatedFor(modelId);
  return {
    tier: resolveTier({ modelId, provider, pricing: curated?.pricing }),
    contextWindow: curated?.context,
    capabilities: curated?.capabilities ? [...curated.capabilities] : inferCapabilities(modelId),
    pricing: curated?.pricing,
  };
}

export function effectiveTier(model: AIModel, provider?: Pick<Provider, "baseUrl">): Tier {
  return resolveTier({
    modelId: model.modelId,
    tierOverride: model.tierOverride,
    pricing: model.pricing,
    provider,
    suggestedTier: model.tier,
  });
}

export const CAPABILITY_LABELS: Record<Capability, string> = {
  text: "Text",
  vision: "Vision",
  video: "Video",
  audio: "Audio",
  tools: "Tools",
  reasoning: "Reasoning",
};

export const ALL_CAPABILITIES: Capability[] = ["text", "vision", "video", "audio", "tools", "reasoning"];
