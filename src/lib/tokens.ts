// Shared logic tokens; change this helper here and update callers if its contract changes.
const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/;
const RTL = /[\u0590-\u05ff\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]/g;
const RTL_CHAR = /[\u0590-\u05ff\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]/;

/** Cheap but stable token estimate: words for Latin script, characters for CJK/RTL. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let tokens = 0;
  const words = text.split(/\s+/).filter(Boolean);
  for (const word of words) {
    if (CJK.test(word)) tokens += Math.ceil(word.length * 1.05);
    else if (RTL_CHAR.test(word)) tokens += Math.ceil(word.length / 2.4) + 1;
    else tokens += Math.max(1, Math.ceil(word.length / 4));
  }
  tokens += Math.ceil((text.match(/[{}()\[\];:,.<>]/g)?.length ?? 0) / 4);
  return Math.max(1, Math.round(tokens));
}

export function estimateMessages(messages: { content: string }[], extra = 0): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content) + 4, extra);
}

export function usageRatio(tokens: number, contextWindow?: number): number {
  if (!contextWindow || contextWindow <= 0) return 0;
  return Math.min(1, tokens / contextWindow);
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(tokens % 1000 === 0 ? 0 : 1)}k`;
  return `${tokens}`;
}

export function formatPricing(pricing?: { prompt: number; completion: number }): string {
  if (!pricing) return "—";
  const fmt = (n: number) => (n === 0 ? "$0" : n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);
  return `${fmt(pricing.prompt)} / ${fmt(pricing.completion)} per 1M`;
}

/** Auto titles: first meaningful line, cleaned of markdown noise. */
export function deriveTitle(text: string, max = 48): string {
  const cleaned = text
    .replace(/```[\s\S]*?```/g, " code ")
    .replace(/[#>*_`~[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "New chat";
  const firstSentence = cleaned.split(/(?<=[.!?؟])\s/)[0] ?? cleaned;
  const title = firstSentence.length > max ? `${firstSentence.slice(0, max).trimEnd()}…` : firstSentence;
  return title.charAt(0).toUpperCase() + title.slice(1);
}

export function detectDirection(text: string): "rtl" | "ltr" {
  const rtlCount = text.match(RTL)?.length ?? 0;
  const latinCount = text.match(/[A-Za-z]/g)?.length ?? 0;
  return rtlCount > latinCount / 3 ? "rtl" : "ltr";
}

export function formatRelativeTime(timestamp: number, lang: "en" | "fa"): string {
  const delta = Date.now() - timestamp;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (lang === "fa") {
    if (delta < minute) return "همین حالا";
    if (delta < hour) return `${Math.floor(delta / minute)} دقیقه پیش`;
    if (delta < day) return `${Math.floor(delta / hour)} ساعت پیش`;
    if (delta < 7 * day) return `${Math.floor(delta / day)} روز پیش`;
    return new Date(timestamp).toLocaleDateString("fa-IR", { month: "short", day: "numeric" });
  }
  if (delta < minute) return "just now";
  if (delta < hour) return `${Math.floor(delta / minute)}m ago`;
  if (delta < day) return `${Math.floor(delta / hour)}h ago`;
  if (delta < 7 * day) return `${Math.floor(delta / day)}d ago`;
  return new Date(timestamp).toLocaleDateString("en", { month: "short", day: "numeric" });
}

export function dateBucket(timestamp: number): "today" | "yesterday" | "week" | "month" | "older" {
  const now = new Date();
  const date = new Date(timestamp);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (timestamp >= startOfToday) return "today";
  if (timestamp >= startOfToday - 86_400_000) return "yesterday";
  if (timestamp >= startOfToday - 7 * 86_400_000) return "week";
  if (timestamp >= startOfToday - 30 * 86_400_000) return "month";
  if (date.getFullYear() === now.getFullYear()) return "month";
  return "older";
}
