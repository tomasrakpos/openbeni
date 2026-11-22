/**
 * Backend Live Web & Image Search Engine for Skills #2 (Web Builder) and #4 (Deep Research).
 *
 * Priority chain:
 * 1. Configured search API keys in env (`TAVILY_API_KEY`, `SERPER_API_KEY`, `BRAVE_SEARCH_API_KEY`)
 * 2. Zero-key free public fallback (Wikipedia FA/EN API + DuckDuckGo Instant/HTML Lite +
 *    Wikimedia Commons MediaSearch for verified HTTPS reference photography).
 *
 * Every network call is strictly bounded by a short AbortSignal timeout and never
 * throws unhandled errors so chat requests stay fast and resilient.
 */
import type { SkillEnv, SkillImageResult, SkillSearchResult } from "./types";

const SEARCH_TIMEOUT_MS = 2_800;

function decodeHtml(raw: string): string {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function withTimeout(ms: number): AbortSignal {
  return AbortSignal.timeout(ms);
}

function cleanQuery(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function hasPersian(text: string): boolean {
  return /[\u0600-\u06FF]/.test(text);
}

function dedupeResults(items: SkillSearchResult[], limit: number): SkillSearchResult[] {
  const seen = new Set<string>();
  const out: SkillSearchResult[] = [];
  for (const item of items) {
    if (!item.url || !item.title) continue;
    const key = item.url.replace(/#.*$/, "").replace(/\/+$/, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      title: item.title.slice(0, 160),
      url: item.url,
      snippet: item.snippet.slice(0, 420),
      source: item.source,
    });
    if (out.length >= limit) break;
  }
  return out;
}

async function searchTavily(query: string, apiKey: string, limit: number): Promise<SkillSearchResult[]> {
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: "advanced",
        max_results: limit,
        include_answer: false,
      }),
      signal: withTimeout(SEARCH_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      results?: Array<{ title?: string; url?: string; content?: string }>;
    };
    return (data.results ?? [])
      .filter((r) => r.title && r.url)
      .map((r) => ({
        title: String(r.title),
        url: String(r.url),
        snippet: String(r.content ?? ""),
        source: "tavily",
      }));
  } catch {
    return [];
  }
}

async function searchSerper(query: string, apiKey: string, limit: number): Promise<SkillSearchResult[]> {
  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
      body: JSON.stringify({ q: query, num: limit }),
      signal: withTimeout(SEARCH_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      organic?: Array<{ title?: string; link?: string; snippet?: string }>;
    };
    return (data.organic ?? [])
      .filter((r) => r.title && r.link)
      .map((r) => ({
        title: String(r.title),
        url: String(r.link),
        snippet: String(r.snippet ?? ""),
        source: "serper",
      }));
  } catch {
    return [];
  }
}

async function searchBrave(query: string, apiKey: string, limit: number): Promise<SkillSearchResult[]> {
  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json", "X-Subscription-Token": apiKey },
      signal: withTimeout(SEARCH_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
    };
    return (data.web?.results ?? [])
      .filter((r) => r.title && r.url)
      .map((r) => ({
        title: String(r.title),
        url: String(r.url),
        snippet: decodeHtml(String(r.description ?? "")),
        source: "brave",
      }));
  } catch {
    return [];
  }
}

async function searchDuckDuckGoHtml(query: string, limit: number): Promise<SkillSearchResult[]> {
  try {
    const res = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml",
        },
        signal: withTimeout(SEARCH_TIMEOUT_MS),
      },
    );
    if (!res.ok) return [];
    const html = await res.text();
    const out: SkillSearchResult[] = [];
    const blockRe =
      /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div|span)>)?/gi;
    let m: RegExpExecArray | null;
    while ((m = blockRe.exec(html)) !== null && out.length < limit) {
      let href = m[1] ?? "";
      if (href.includes("uddg=")) {
        const uddg = /[?&]uddg=([^&]+)/.exec(href)?.[1];
        if (uddg) {
          try {
            href = decodeURIComponent(uddg);
          } catch {
            // keep original
          }
        }
      }
      if (!/^https?:\/\//i.test(href)) continue;
      const title = decodeHtml(m[2] ?? "");
      const snippet = decodeHtml(m[3] ?? "");
      if (title) out.push({ title, url: href, snippet, source: "duckduckgo" });
    }
    return out;
  } catch {
    return [];
  }
}

async function searchWikipedia(query: string, lang: "fa" | "en", limit: number): Promise<SkillSearchResult[]> {
  try {
    const endpoint =
      `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}` +
      `&srlimit=${limit}&utf8=1&format=json&origin=*`;
    const res = await fetch(endpoint, {
      headers: { Accept: "application/json", "User-Agent": "OpenHarnessSkillEngine/1.0" },
      signal: withTimeout(SEARCH_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      query?: { search?: Array<{ title?: string; snippet?: string }> };
    };
    return (data.query?.search ?? [])
      .filter((r) => r.title)
      .map((r) => {
        const title = String(r.title);
        return {
          title,
          url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`,
          snippet: decodeHtml(String(r.snippet ?? "")),
          source: `wikipedia-${lang}`,
        };
      });
  } catch {
    return [];
  }
}

/**
 * Primary server-side web search entry point. Automatically uses configured
 * paid search APIs when present, otherwise runs free parallel DuckDuckGo +
 * Wikipedia (FA/EN) queries with zero API keys required.
 */
export async function searchWeb(
  rawQuery: string,
  env: SkillEnv = {},
  limit = 5,
): Promise<SkillSearchResult[]> {
  const query = cleanQuery(rawQuery);
  if (!query) return [];

  if (env.TAVILY_API_KEY?.trim()) {
    const items = await searchTavily(query, env.TAVILY_API_KEY.trim(), limit);
    if (items.length > 0) return dedupeResults(items, limit);
  }
  if (env.SERPER_API_KEY?.trim()) {
    const items = await searchSerper(query, env.SERPER_API_KEY.trim(), limit);
    if (items.length > 0) return dedupeResults(items, limit);
  }
  if (env.BRAVE_SEARCH_API_KEY?.trim()) {
    const items = await searchBrave(query, env.BRAVE_SEARCH_API_KEY.trim(), limit);
    if (items.length > 0) return dedupeResults(items, limit);
  }

  // Zero-key free fallback: run DuckDuckGo + language-matched Wikipedia in parallel.
  const isFa = hasPersian(query);
  const [ddg, wikiPrimary, wikiSecondary] = await Promise.all([
    searchDuckDuckGoHtml(query, limit),
    searchWikipedia(query, isFa ? "fa" : "en", Math.min(3, limit)),
    isFa ? searchWikipedia(query, "en", 2) : Promise.resolve([]),
  ]);

  return dedupeResults([...ddg, ...wikiPrimary, ...wikiSecondary], limit);
}

/**
 * Fetches verified, real HTTPS photography URLs for Skill #2 (Web Builder) so
 * built websites use real visual assets instead of broken links or cheesy icons.
 */
export async function searchReferenceImages(
  rawQuery: string,
  env: SkillEnv = {},
  limit = 4,
): Promise<SkillImageResult[]> {
  const query = cleanQuery(rawQuery);
  if (!query) return [];

  if (env.UNSPLASH_ACCESS_KEY?.trim()) {
    try {
      const res = await fetch(
        `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${limit}&orientation=landscape`,
        {
          headers: { Authorization: `Client-ID ${env.UNSPLASH_ACCESS_KEY.trim()}` },
          signal: withTimeout(SEARCH_TIMEOUT_MS),
        },
      );
      if (res.ok) {
        const data = (await res.json()) as {
          results?: Array<{
            alt_description?: string;
            description?: string;
            width?: number;
            height?: number;
            urls?: { regular?: string };
          }>;
        };
        const photos = (data.results ?? [])
          .filter((p) => p.urls?.regular)
          .map((p) => ({
            title: String(p.alt_description ?? p.description ?? query).slice(0, 100),
            url: String(p.urls!.regular),
            width: p.width,
            height: p.height,
            source: "unsplash",
          }));
        if (photos.length > 0) return photos.slice(0, limit);
      }
    } catch {
      // fall through to Wikimedia Commons
    }
  }

  // Zero-key free fallback: Wikimedia Commons high-res verified HTTPS photography.
  try {
    const url =
      `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6` +
      `&gsrsearch=${encodeURIComponent(query)}&gsrlimit=${limit * 2}` +
      `&prop=imageinfo&iiprop=url|mime|size&iiurlwidth=1200&format=json&origin=*`;
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "OpenHarnessSkillEngine/1.0" },
      signal: withTimeout(SEARCH_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      query?: {
        pages?: Record<
          string,
          {
            title?: string;
            imageinfo?: Array<{
              thumburl?: string;
              url?: string;
              mime?: string;
              width?: number;
              height?: number;
            }>;
          }
        >;
      };
    };
    const pages = Object.values(data.query?.pages ?? {});
    const out: SkillImageResult[] = [];
    for (const page of pages) {
      const info = page.imageinfo?.[0];
      const imgUrl = info?.thumburl ?? info?.url ?? "";
      const mime = info?.mime ?? "";
      if (!imgUrl.startsWith("https://")) continue;
      if (!/^image\/(jpeg|jpg|png|webp)$/i.test(mime)) continue;
      if ((info?.width ?? 0) < 400) continue;
      out.push({
        title: (page.title ?? query).replace(/^File:/i, "").replace(/\.[^.]+$/, "").slice(0, 100),
        url: imgUrl,
        width: info?.width,
        height: info?.height,
        source: "wikimedia",
      });
      if (out.length >= limit) break;
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Multi-angle live web research for Skill #4 (Deep Research).
 * Runs complementary search queries in parallel and returns a deduplicated set
 * of grounded sources ready to inject into the model's reasoning context.
 */
export async function runDeepResearch(
  userPrompt: string,
  env: SkillEnv = {},
): Promise<SkillSearchResult[]> {
  const base = cleanQuery(userPrompt);
  if (!base) return [];
  const isFa = hasPersian(base);
  const secondary = isFa
    ? `${base} تحلیل مقایسه ۲۰۲۶`
    : `${base} analysis comparison 2026`;

  const [primaryRes, secondaryRes] = await Promise.all([
    searchWeb(base, env, 5),
    searchWeb(secondary, env, 4),
  ]);
  return dedupeResults([...primaryRes, ...secondaryRes], 7);
}

/**
 * Extracts a concise search topic for Skill #2 (Web Builder) so it fetches
 * relevant domain references & photography (e.g. "coffee roastery website"
 * instead of the entire instruction sentence).
 */
export function extractWebTopicQuery(userPrompt: string): string {
  const stripped = userPrompt
    .replace(
      /\b(build|create|make|design|generate|write|me|a|an|the|please|modern|website|landing page|web app|ui|component|page|responsive)\b/gi,
      " ",
    )
    .replace(
      /(?:بساز|طراحی کن|درست کن|برام|برای من|یک|یه|وبسایت|وب‌سایت|سایت|صفحه|مدرن|حرفه‌ای|شیک|خفن|لطفاً|لطفا)/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
  return (stripped.length >= 3 ? stripped : userPrompt).slice(0, 100);
}
