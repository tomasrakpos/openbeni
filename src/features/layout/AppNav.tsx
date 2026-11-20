// layout feature: AppNav; change its UI/flow here and keep related state/API calls in sync.
import { MessageSquare, Search, Server, Settings } from "lucide-react";
import * as React from "react";
import {
  LiquidNavbar,
  type LiquidNavItem,
} from "@/components/ui/liquid-glass-navbar";
import { snippet, useChatSearch, type SearchHit } from "@/features/layout/useChatSearch";
import { useT } from "@/lib/i18n";
import { formatRelativeTime } from "@/lib/tokens";
import { useChatsStore } from "@/stores/chats";
import { useSettingsStore } from "@/stores/settings";
import { useUiStore } from "@/stores/ui";

/**
 * Main navigation pill. It reuses the composer's liquid-glass material and the
 * water physics of the Nimbus navbar: the active drop glides between Chats and
 * Providers, while Search and Settings act as one-shot destinations that open
 * their dialogs without stealing the indicator.
 *
 * Search is different: it morphs the pill itself into a field. The icon lifts
 * out of its item and lands in the trailing bubble while the water drop travels
 * to the same corner, then results stream in right under the pill.
 */

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = React.useState(() =>
    typeof window === "undefined" ? false : window.matchMedia(query).matches,
  );
  React.useEffect(() => {
    const mq = window.matchMedia(query);
    const sync = () => setMatches(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [query]);
  return matches;
}

const SEARCH_INDEX = 2;

export function AppNav({ className }: { className?: string }) {
  const t = useT();
  const view = useUiStore((s) => s.view);
  const setView = useUiStore((s) => s.setView);
  const searchDialogOpen = useUiStore((s) => s.searchOpen);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const theme = useSettingsStore((s) => s.settings.theme);
  const lang = useSettingsStore((s) => s.settings.lang);
  const wide = useMediaQuery("(min-width: 1280px)");

  const selectChat = useChatsStore((s) => s.selectChat);
  const chats = useChatsStore((s) => s.chats);

  const [searchMode, setSearchMode] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const { results, loading } = useChatSearch(query, searchMode);

  const closeSearch = React.useCallback(() => {
    setSearchMode(false);
    setQuery("");
  }, []);

  const openSearch = React.useCallback(() => {
    setQuery("");
    setSearchMode(true);
  }, []);

  // Focus must wait for the input to become interactive (the slot is always
  // mounted so the glass never re-lays-out during the morph).
  React.useEffect(() => {
    if (!searchMode) return;
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [searchMode]);

  React.useEffect(() => {
    if (searchMode) return;
    if (document.activeElement === inputRef.current) inputRef.current?.blur();
  }, [searchMode]);

  // The global search dialog (⌘K) takes over: retire the inline field.
  React.useEffect(() => {
    if (searchDialogOpen) closeSearch();
  }, [searchDialogOpen, closeSearch]);

  // Click-away closes the inline search, including the results panel.
  React.useEffect(() => {
    if (!searchMode) return;
    const onDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) closeSearch();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [searchMode, closeSearch]);

  const items = React.useMemo<LiquidNavItem[]>(
    () => [
      { label: t("nav.chats"), icon: <MessageSquare size={16} strokeWidth={1.8} />, fx: "glow" },
      { label: t("nav.providers"), icon: <Server size={16} strokeWidth={1.8} />, fx: "spin" },
      { label: t("nav.search"), icon: <Search size={16} strokeWidth={1.8} />, fx: "pop" },
      { label: t("nav.settings"), icon: <Settings size={16} strokeWidth={1.8} />, fx: "wave" },
    ],
    [t],
  );

  const onSelect = (index: number) => {
    if (index === 0) setView("chat");
    else if (index === 1) setView("providers");
    else if (index === SEARCH_INDEX) openSearch();
    else setSettingsOpen(true);
  };

  const openHit = async (hit: SearchHit) => {
    closeSearch();
    setView("chat");
    await selectChat(hit.chat.id);
  };

  const showPanel = searchMode && query.trim().length > 0;
  const trimmed = query.trim();

  return (
    <div ref={wrapRef} className="relative flex shrink-0 justify-center">
      <LiquidNavbar
        className={className}
        ariaLabel={t("app.name")}
        items={items}
        active={view === "chat" ? 0 : 1}
        tone={theme === "dark" ? "dark" : "light"}
        compact={!wide}
        onChange={onSelect}
        search={searchMode}
        searchAnchor={SEARCH_INDEX}
        searchIcon={<Search size={16} strokeWidth={1.9} />}
        searchSlot={
          <input
            ref={inputRef}
            type="search"
            className="nimbus-searchinput"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                closeSearch();
              }
            }}
            placeholder={t("chat.searchPlaceholder")}
            aria-label={t("chat.searchPlaceholder")}
            tabIndex={searchMode ? 0 : -1}
            autoComplete="off"
            spellCheck={false}
          />
        }
      />

      {showPanel ? (
        <div
          className="absolute top-[calc(100%+10px)] left-1/2 z-50 w-[min(92vw,430px)] -translate-x-1/2 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_22px_48px_-18px_rgba(0,0,0,0.45)]"
          role="region"
          aria-label={t("nav.search")}
        >
          <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--faint)]">
              {t("nav.search")}
            </span>
            <span className="text-[10px] text-[var(--faint)]">
              {loading ? t("common.loading") : `${results.length} · ${t("chat.searchResults")}`}
            </span>
          </div>

          <div className="max-h-[min(52vh,320px)] overflow-y-auto p-1.5">
            {loading ? (
              <p className="px-3 py-6 text-center text-[11.5px] text-[var(--faint)]">{t("common.loading")}</p>
            ) : results.length === 0 ? (
              <p className="px-3 py-6 text-center text-[11.5px] text-[var(--faint)]">{t("chat.searchEmpty")}</p>
            ) : (
              <ul>
                {results.slice(0, 8).map((hit) => {
                  const parts = snippet(hit.message.content, trimmed);
                  return (
                    <li key={hit.message.id}>
                      <button
                        type="button"
                        onClick={() => void openHit(hit)}
                        className="flex w-full flex-col gap-1 rounded-[10px] px-2.5 py-2 text-start transition-colors hover:bg-[var(--surface-2)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]"
                      >
                        <span className="flex w-full items-center gap-1.5 text-[10px] text-[var(--faint)]">
                          <MessageSquare className="size-2.5 shrink-0" />
                          <span className="truncate font-semibold text-[var(--foreground-soft)]">
                            {hit.chat.title || t("chat.newChatTitle")}
                          </span>
                          <span className="ml-auto shrink-0">
                            {formatRelativeTime(hit.message.createdAt, lang)}
                          </span>
                        </span>
                        <span className="line-clamp-2 text-[11.5px] leading-relaxed text-[var(--foreground-soft)]">
                          {parts.before}
                          <mark className="rounded-[3px] bg-[var(--primary-soft)] px-0.5 text-[var(--primary)]">
                            {parts.match}
                          </mark>
                          {parts.after}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-[var(--border)] px-3 py-1.5">
            <span className="text-[9.5px] text-[var(--faint)]">
              {results.length > 8 ? `+${results.length - 8}` : chats.length ? `${chats.length} · ${t("nav.chats")}` : ""}
            </span>
            <kbd className="rounded-[4px] border border-[var(--border)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--faint)]">
              Esc
            </kbd>
          </div>
        </div>
      ) : null}
    </div>
  );
}
