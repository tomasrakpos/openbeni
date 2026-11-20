// layout feature: SearchDialog; change its UI/flow here and keep related state/API calls in sync.
import { MessageSquare, Search } from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { snippet, useChatSearch, type SearchHit } from "@/features/layout/useChatSearch";
import { useT } from "@/lib/i18n";
import { formatRelativeTime } from "@/lib/tokens";
import { useChatsStore } from "@/stores/chats";
import { useSettingsStore } from "@/stores/settings";
import { useUiStore } from "@/stores/ui";

export function SearchDialog() {
  const t = useT();
  const lang = useSettingsStore((s) => s.settings.lang);
  const open = useUiStore((s) => s.searchOpen);
  const setOpen = useUiStore((s) => s.setSearchOpen);
  const setView = useUiStore((s) => s.setView);
  const selectChat = useChatsStore((s) => s.selectChat);
  const [query, setQuery] = React.useState("");
  const { results, groups, loading } = useChatSearch(query, open);

  React.useEffect(() => {
    if (!open) return;
    setQuery("");
  }, [open]);

  const openHit = async (hit: SearchHit) => {
    setOpen(false);
    setView("chat");
    await selectChat(hit.chat.id);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent frame hideClose className="gap-0 overflow-hidden p-0 sm:w-[min(680px,calc(100vw-2rem))]">
        <DialogHeader className="border-b border-[var(--border)] px-4 py-3 pr-12">
          <DialogTitle className="flex items-center gap-2 text-[15px]">
            <Search className="size-4 text-[var(--primary)]" />
            {t("nav.search")}
          </DialogTitle>
          <DialogDescription className="text-[11.5px]">{t("chat.searchPlaceholder")}</DialogDescription>
        </DialogHeader>

        <div className="border-b border-[var(--border)] px-3 py-2">
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("chat.searchPlaceholder")}
            aria-label={t("chat.searchPlaceholder")}
            className="h-9 border-0 bg-transparent pl-1 text-[13.5px] shadow-none focus-visible:outline-none"
          />
        </div>

        <div className="max-h-[min(56vh,460px)] min-h-[120px] overflow-y-auto p-2">
          {loading ? (
            <p className="py-8 text-center text-[12px] text-[var(--faint)]">{t("common.loading")}</p>
          ) : !query.trim() ? (
            <p className="py-8 text-center text-[12px] text-[var(--faint)]">{t("chat.searchPlaceholder")}</p>
          ) : groups.length === 0 ? (
            <p className="py-8 text-center text-[12px] text-[var(--faint)]">{t("chat.searchEmpty")}</p>
          ) : (
            groups.map((group) => {
              const chat = group.chat;
              const hits = group.hits;
              return (
                <section key={chat.id} className="mb-2">
                  <header className="sticky top-0 z-10 flex items-center gap-2 bg-[var(--surface-1)]/95 px-2 py-1.5 backdrop-blur">
                    <MessageSquare className="size-3 text-[var(--faint)]" />
                    <span className="truncate text-[11.5px] font-semibold text-foreground">
                      {chat.title || t("chat.newChatTitle")}
                    </span>
                    <Badge variant="default" className="ml-auto">
                      {hits.length}
                    </Badge>
                  </header>
                  <ul>
                    {hits.map((hit) => {
                      const parts = snippet(hit.message.content, query);
                      return (
                        <li key={hit.message.id}>
                          <button
                            type="button"
                            onClick={() => void openHit(hit)}
                            className="flex w-full flex-col gap-1 rounded-[9px] px-2.5 py-2 text-start transition-colors hover:bg-[var(--surface-2)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]"
                          >
                            <span className="flex items-center gap-2 text-[10px] text-[var(--faint)]">
                              <span className="font-medium uppercase tracking-wide">
                                {hit.message.role === "user" ? t("chat.you") : t("chat.assistant")}
                              </span>
                              <span>{formatRelativeTime(hit.message.createdAt, lang)}</span>
                            </span>
                            <span className="line-clamp-2 text-[12px] leading-relaxed text-[var(--foreground-soft)]">
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
                </section>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-[var(--border)] px-3 py-2">
          <span className="text-[10px] text-[var(--faint)]">{t("chat.searchResults")}</span>
          <span className="text-[10px] text-[var(--faint)]">
            {results.length} · {t("common.search")}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
