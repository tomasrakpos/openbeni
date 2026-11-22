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
import { WaterRippleTile } from "@/components/ui/water-ripple-image";
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

function hashString(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return hash;
}

function colorForKey(key: string): string {
  return PALETTE[hashString(key) % PALETTE.length]!;
}

function hexToRgb01(hex: string): [number, number, number] {
  const clean = hex.trim().replace(/^#/, "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  if (!/^[0-9a-f]{6}$/i.test(full)) return [0.38, 0.55, 0.92];
  return [
    parseInt(full.slice(0, 2), 16) / 255,
    parseInt(full.slice(2, 4), 16) / 255,
    parseInt(full.slice(4, 6), 16) / 255,
  ];
}

function mixRgb(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function iconWaterPalette(brandHex: string) {
  const base = hexToRgb01(brandHex);
  // Keep very dark/monochrome brands (e.g. OpenAI/xAI/Ollama) aquatic & luminous
  // while preserving vivid hue for colourful brands (Anthropic, Google, DeepSeek...).
  const lum = 0.2126 * base[0] + 0.7152 * base[1] + 0.0722 * base[2];
  const tinted: [number, number, number] =
    lum < 0.18 ? mixRgb(base, [0.18, 0.58, 0.88], 0.55) : base;
  return {
    colorA: mixRgb(tinted, [0.06, 0.14, 0.24], 0.22),
    colorB: mixRgb(tinted, [0.85, 0.96, 1.0], 0.28),
    colorDeep: mixRgb(tinted, [0.02, 0.06, 0.12], 0.52),
  };
}

interface ProviderIconProps {
  icon?: string;
  name: string;
  color?: string;
  baseUrl?: string;
  modelName?: string;
  modelId?: string;
  size?: number;
  /** Apply live WebGL water-ripple fill inside the icon tile (used on Providers views). */
  water?: boolean;
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
  water = false,
  className,
}: ProviderIconProps) {
  const isImage = !!icon && /^(data:|https?:|blob:)/.test(icon);
  const key = isImage ? undefined : resolveIconKey(icon, name, baseUrl, modelName, modelId);
  const Icon = key ? ICON_MAP[key] : undefined;
  const seed = key ?? `${name}${modelId ?? ""}${baseUrl ?? ""}`;
  const brand = color ?? colorForKey(seed);
  const waterColors = water && !isImage ? iconWaterPalette(brand) : null;
  const phaseOffset = (hashString(seed) % 9) * 950;
  const style: CSSProperties = {
    width: size,
    height: size,
    borderRadius: Math.round(size * 0.3),
    background: waterColors
      ? `linear-gradient(145deg, color-mix(in oklab, ${brand} 55%, #0c1420), color-mix(in oklab, ${brand} 35%, #080d16))`
      : `linear-gradient(145deg, color-mix(in oklab, ${brand} 24%, var(--surface-2)), color-mix(in oklab, ${brand} 8%, var(--surface-1)))`,
    border: waterColors
      ? `1px solid color-mix(in oklab, ${brand} 38%, rgba(255,255,255,0.28))`
      : `1px solid color-mix(in oklab, ${brand} 24%, var(--border))`,
    color: waterColors ? "#ffffff" : `color-mix(in oklab, ${brand} 68%, var(--foreground))`,
  };
  return (
    <span
      className={cn("relative inline-flex shrink-0 items-center justify-center overflow-hidden shadow-xs", className)}
      style={style}
      aria-hidden
    >
      {waterColors ? (
        <>
          <span className="pointer-events-none absolute inset-0 z-0">
            <WaterRippleTile
              colorA={waterColors.colorA}
              colorB={waterColors.colorB}
              colorDeep={waterColors.colorDeep}
              scale={4.8}
              illumination={0.34}
              surfaceDistortion={0.055}
              waterDistortion={0.032}
              speed={0.95}
              phaseOffset={phaseOffset}
            />
          </span>
          <span
            className="pointer-events-none absolute inset-0 z-[1]"
            style={{
              background:
                "radial-gradient(120% 130% at 28% 0%, rgba(255,255,255,0.42), rgba(255,255,255,0) 56%)",
              boxShadow: "inset 0 1px 1px rgba(255,255,255,0.65), inset 0 -2px 5px rgba(0,0,0,0.28)",
            }}
          />
        </>
      ) : null}
      {isImage ? (
        <img src={icon} alt="" className="relative z-10 size-full object-cover" />
      ) : Icon ? (
        <Icon
          size={Math.round(size * 0.56)}
          className={waterColors ? "relative z-10 drop-shadow-[0_1px_2px_rgba(0,0,0,0.45)]" : "relative z-10"}
        />
      ) : (
        <span
          className={waterColors ? "relative z-10 drop-shadow-[0_1px_2px_rgba(0,0,0,0.45)]" : "relative z-10"}
          style={{ fontSize: Math.round(size * 0.32), fontWeight: 650, letterSpacing: "0.02em" }}
        >
          {initials(name)}
        </span>
      )}
    </span>
  );
}
