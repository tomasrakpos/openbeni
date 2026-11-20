// Shared component ProviderIcon; change its presentation here and update consumers if props change.
import type { ComponentType, CSSProperties } from "react";
import Anthropic from "@lobehub/icons/es/Anthropic/components/Mono.js";
import DeepSeek from "@lobehub/icons/es/DeepSeek/components/Mono.js";
import Google from "@lobehub/icons/es/Google/components/Mono.js";
import Groq from "@lobehub/icons/es/Groq/components/Mono.js";
import Mistral from "@lobehub/icons/es/Mistral/components/Mono.js";
import Ollama from "@lobehub/icons/es/Ollama/components/Mono.js";
import OpenAI from "@lobehub/icons/es/OpenAI/components/Mono.js";
import OpenRouter from "@lobehub/icons/es/OpenRouter/components/Mono.js";
import Pollinations from "@lobehub/icons/es/Pollinations/components/Mono.js";
import Together from "@lobehub/icons/es/Together/components/Mono.js";
import XAI from "@lobehub/icons/es/XAI/components/Mono.js";
import { SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

type BrandIcon = ComponentType<{ size?: number; className?: string; style?: CSSProperties; "aria-hidden"?: boolean }>;

const ICON_MAP: Record<string, BrandIcon> = {
  openai: OpenAI as BrandIcon,
  anthropic: Anthropic as BrandIcon,
  google: Google as BrandIcon,
  gemini: Google as BrandIcon,
  openrouter: OpenRouter as BrandIcon,
  pollinations: Pollinations as BrandIcon,
  groq: Groq as BrandIcon,
  mistral: Mistral as BrandIcon,
  deepseek: DeepSeek as BrandIcon,
  xai: XAI as BrandIcon,
  together: Together as BrandIcon,
  ollama: Ollama as BrandIcon,
  custom: SlidersHorizontal as BrandIcon,
};

const NAME_HINTS: [RegExp, string][] = [
  [/openai|gpt|chatgpt|o1|o3|o4/i, "openai"],
  [/anthropic|claude/i, "anthropic"],
  [/gemini|google|bard|palm/i, "google"],
  [/openrouter/i, "openrouter"],
  [/groq/i, "groq"],
  [/mistral|codestral|mixtral|pixtral/i, "mistral"],
  [/deepseek/i, "deepseek"],
  [/xai|grok/i, "xai"],
  [/together/i, "together"],
  [/ollama|localhost/i, "ollama"],
];

export function resolveIconKey(
  icon?: string,
  name?: string,
  baseUrl?: string,
  modelName?: string,
  modelId?: string,
): string | undefined {
  if (icon && ICON_MAP[icon]) return icon;
  const haystack = `${icon ?? ""} ${name ?? ""} ${modelName ?? ""} ${modelId ?? ""} ${baseUrl ?? ""}`;
  for (const [pattern, key] of NAME_HINTS) if (pattern.test(haystack)) return key;
  return undefined;
}

const PALETTE = ["#8b7bff", "#2dd4e8", "#f472b6", "#34d399", "#fbbf24", "#fb7185", "#60a5fa", "#c084fc"];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}

function colorForKey(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length]!;
}

interface ProviderIconProps {
  icon?: string;
  name: string;
  color?: string;
  baseUrl?: string;
  modelName?: string;
  modelId?: string;
  size?: number;
  className?: string;
}

export function ProviderIcon({
  icon,
  name,
  color,
  baseUrl,
  modelName,
  modelId,
  size = 38,
  className,
}: ProviderIconProps) {
  const isImage = !!icon && /^(data:|https?:|blob:)/.test(icon);
  const key = isImage ? undefined : resolveIconKey(icon, name, baseUrl, modelName, modelId);
  const Icon = key ? ICON_MAP[key] : undefined;
  const brand = color ?? (key ? colorForKey(key) : colorForKey(`${name}${modelId ?? ""}${baseUrl ?? ""}`));
  const style: CSSProperties = {
    width: size,
    height: size,
    borderRadius: Math.round(size * 0.3),
    background: `linear-gradient(145deg, color-mix(in oklab, ${brand} 24%, var(--surface-2)), color-mix(in oklab, ${brand} 8%, var(--surface-1)))`,
    border: `1px solid color-mix(in oklab, ${brand} 24%, var(--border))`,
    color: `color-mix(in oklab, ${brand} 68%, var(--foreground))`,
  };
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center overflow-hidden shadow-xs", className)}
      style={style}
      aria-hidden
    >
      {isImage ? (
        <img src={icon} alt="" className="size-full object-cover" />
      ) : Icon ? (
        <Icon size={Math.round(size * 0.56)} />
      ) : (
        <span style={{ fontSize: Math.round(size * 0.32), fontWeight: 650, letterSpacing: "0.02em" }}>
          {initials(name)}
        </span>
      )}
    </span>
  );
}
