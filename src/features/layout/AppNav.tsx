// layout feature: AppNav; change its UI/flow here and keep related state/API calls in sync.
import {
  Cpu,
  MessageSquare,
  Search,
  Server,
  Settings,
  SquarePen,
} from "lucide-react";
import * as React from "react";
import {
  AppleSpotlight,
  type SpotlightSearchResult,
  type SpotlightShortcut,
} from "@/components/ui/apple-spotlight";
import {
  LiquidNavbar,
  type LiquidNavItem,
} from "@/components/ui/liquid-glass-navbar";
import { CreditJellyGauge } from "@/features/layout/CreditJellyGauge";
import { snippet, useChatSearch } from "@/features/layout/useChatSearch";
import { isBundledProvider } from "@/lib/bundled";
import { useT } from "@/lib/i18n";
import { formatRelativeTime } from "@/lib/tokens";
import { cn } from "@/lib/utils";
import { useAllModels, useAllProviders } from "@/stores/catalog";
import { useChatsStore } from "@/stores/chats";
import { useSettingsStore } from "@/stores/settings";
import { useUiStore } from "@/stores/ui";

/**
 * Main navigation pill. Normally displays the liquid-glass Nimbus navbar; tapping
 * Search fades out the TopBar corner menus, slides the navbar pill itself to the
 * right while morphing it into the AppleSpotlight search bar (with 4 shortcut orbs
 * on the left and live search results below), and reverses the entire animation on
 * Back / Esc / outside click.
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
  const navSearchOpen = useUiStore((s) => s.navSearchOpen);
  const setNavSearchOpen = useUiStore((s) => s.setNavSearchOpen);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const theme = useSettingsStore((s) => s.settings.theme);
  const lang = useSettingsStore((s) => s.settings.lang);
  const wide = useMediaQuery("(min-width: 1280px)");
  const prefersDark = useMediaQuery("(prefers-color-scheme: dark)");

  const resolvedTone: "light" | "dark" =
    theme === "dark" || (theme === "system" && prefersDark) ? "dark" : "light";

  const selectChat = useChatsStore((s) => s.selectChat);
  const createChat = useChatsStore((s) => s.createChat);
  const chats = useChatsStore((s) => s.chats);
  const providers = useAllProviders();
  const models = useAllModels();

  const [searchMode, setSearchMode] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const { results: messageHits, loading } = useChatSearch(query, searchMode);

  const closeSearch = React.useCallback(() => {
    setSearchMode(false);
    setQuery("");
  }, []);

  const openSearch = React.useCallback(() => {
    setQuery("");
    setSearchMode(true);
  }, []);

  // Ensure TopBar chrome is restored if AppNav ever unmounts during search.
  React.useEffect(() => {
    return () => setNavSearchOpen(false);
  }, [setNavSearchOpen]);

  // The global search dialog (⌘K) takes over: retire the spotlight bar.
  React.useEffect(() => {
    if (searchDialogOpen) closeSearch();
  }, [searchDialogOpen, closeSearch]);

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

  // 4 left-aligned spotlight shortcut orbs
  const spotlightShortcuts = React.useMemo<SpotlightShortcut[]>(
    () => [
      {
        id: "chats",
        label: t("nav.chats"),
        icon: <MessageSquare />,
        onSelect: () => {
          closeSearch();
          setView("chat");
        },
      },
      {
        id: "new-chat",
        label: t("chat.new"),
        icon: <SquarePen />,
        onSelect: () => {
          closeSearch();
          setView("chat");
          void createChat();
        },
      },
      {
        id: "providers",
        label: t("nav.providers"),
        icon: <Server />,
        onSelect: () => {
          closeSearch();
          setView("providers");
        },
      },
      {
        id: "settings",
        label: t("nav.settings"),
        icon: <Settings />,
        onSelect: () => {
          closeSearch();
          setSettingsOpen(true);
        },
      },
    ],
    [t, closeSearch, setView, createChat, setSettingsOpen],
  );

  const spotlightResults = React.useMemo<SpotlightSearchResult[]>(() => {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const needle = trimmed.toLowerCase();
    const out: SpotlightSearchResult[] = [];
    const seenChatIds = new Set<string>();

    // 1. Matching message hits across all chats
    for (const hit of messageHits.slice(0, 8)) {
      const parts = snippet(hit.message.content, trimmed);
      const previewText = `${parts.before}${parts.match}${parts.after}`.replace(/\s+/g, " ").trim();
      seenChatIds.add(hit.chat.id);
      out.push({
        id: `msg-${hit.message.id}`,
        icon: <MessageSquare />,
        label: hit.chat.title || t("chat.newChatTitle"),
        description: previewText,
        meta: formatRelativeTime(hit.message.createdAt, lang),
        onSelect: () => {
          closeSearch();
          setView("chat");
          void selectChat(hit.chat.id);
        },
      });
    }

    // 2. Matching chat titles not already listed from message content
    for (const chat of chats) {
      if (out.length >= 12) break;
      if (seenChatIds.has(chat.id)) continue;
      const title = chat.title || t("chat.newChatTitle");
      if (!title.toLowerCase().includes(needle)) continue;
      seenChatIds.add(chat.id);
      out.push({
        id: `chat-${chat.id}`,
        icon: <MessageSquare />,
        label: title,
        description: t("nav.chats"),
        meta: formatRelativeTime(chat.updatedAt, lang),
        onSelect: () => {
          closeSearch();
          setView("chat");
          void selectChat(chat.id);
        },
      });
    }

    // 3. Matching user providers
    for (const provider of providers) {
      if (out.length >= 14) break;
      if (isBundledProvider(provider)) continue;
      if (
        !provider.name.toLowerCase().includes(needle) &&
        !provider.baseUrl.toLowerCase().includes(needle)
      ) {
        continue;
      }
      out.push({
        id: `provider-${provider.id}`,
        icon: <Server />,
        label: provider.name,
        description: provider.baseUrl.replace(/^https?:\/\//, ""),
        meta: t("nav.providers"),
        onSelect: () => {
          closeSearch();
          setView("providers");
        },
      });
    }

    // 4. Matching enabled models
    for (const model of models) {
      if (out.length >= 16) break;
      if (!model.enabled) continue;
      if (
        !model.displayName.toLowerCase().includes(needle) &&
        !model.modelId.toLowerCase().includes(needle)
      ) {
        continue;
      }
      out.push({
        id: `model-${model.id}`,
        icon: <Cpu />,
        label: model.displayName,
        description: model.modelId,
        meta: t("nav.models"),
        onSelect: () => {
          closeSearch();
          setView("providers");
        },
      });
    }

    // 5. Quick navigation actions matching query
    const quickActions = [
      {
        id: "act-new",
        keywords: [t("chat.new"), "new chat", "گفتگوی جدید", "جدید"],
        label: t("chat.new"),
        description: t("nav.chats"),
        icon: <SquarePen />,
        run: () => {
          closeSearch();
          setView("chat");
          void createChat();
        },
      },
      {
        id: "act-providers",
        keywords: [t("nav.providers"), "providers", "models", "پرووایدر", "مدل"],
        label: t("nav.providers"),
        description: t("providers.subtitle"),
        icon: <Server />,
        run: () => {
          closeSearch();
          setView("providers");
        },
      },
      {
        id: "act-settings",
        keywords: [t("nav.settings"), "settings", "theme", "تنظیمات", "تم"],
        label: t("nav.settings"),
        description: t("settings.appearance"),
        icon: <Settings />,
        run: () => {
          closeSearch();
          setSettingsOpen(true);
        },
      },
    ];

    for (const act of quickActions) {
      if (act.keywords.some((k) => k.toLowerCase().includes(needle))) {
        out.push({
          id: act.id,
          icon: act.icon,
          label: act.label,
          description: act.description,
          onSelect: act.run,
        });
      }
    }

    return out;
  }, [
    query,
    messageHits,
    chats,
    providers,
    models,
    lang,
    t,
    closeSearch,
    setView,
    selectChat,
    createChat,
    setSettingsOpen,
  ]);

  const isFa = lang === "fa";

  return (
    <div className="relative flex h-[42px] shrink-0 items-start justify-center">
      <AppleSpotlight
        navbar={
          <LiquidNavbar
            className={className}
            ariaLabel={t("app.name")}
            items={items}
            active={view === "chat" ? 0 : 1}
            tone={resolvedTone}
            compact={!wide}
            onChange={onSelect}
          />
        }
        isOpen={searchMode}
        handleClose={closeSearch}
        onChromeFadeChange={setNavSearchOpen}
        tone={resolvedTone}
        wide={wide}
        shortcuts={spotlightShortcuts}
        searchResults={spotlightResults}
        searchValue={query}
        onSearchValueChange={setQuery}
        loading={loading}
        placeholder={t("chat.searchPlaceholder")}
        backLabel={isFa ? "بازگشت" : "Back"}
        clearLabel={isFa ? "پاک کردن" : "Clear"}
        loadingLabel={t("common.loading")}
        emptyLabel={t("chat.searchEmpty")}
      />

      <div
        className={cn(
          "transition-opacity duration-200 ease-out",
          navSearchOpen && "pointer-events-none opacity-0",
        )}
        aria-hidden={navSearchOpen || undefined}
      >
        <CreditJellyGauge />
      </div>
    </div>
  );
}
