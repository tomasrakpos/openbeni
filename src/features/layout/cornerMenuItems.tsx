// layout feature: cornerMenuItems; change its UI/flow here and keep related state/API calls in sync.
import { Command, MessageSquare, Pencil, Pin, Search, Server, SquarePen, Trash2 } from "lucide-react";
import * as React from "react";
import type { CornerMenuItem, CornerMenuSection } from "@/features/layout/CornerMenu";
import { useT } from "@/lib/i18n";
import { useChatsStore } from "@/stores/chats";
import { useUiStore } from "@/stores/ui";

export interface ChatActions {
  onRename: (chatId: string) => void;
  onDelete: (chatId: string) => void;
}

/**
 * Items for the left navigation corner menu.
 */
export function useCornerMenuSections(actions?: ChatActions): CornerMenuSection[] {
  const t = useT();
  const view = useUiStore((s) => s.view);
  const setView = useUiStore((s) => s.setView);
  const setSearchOpen = useUiStore((s) => s.setSearchOpen);
  const setPaletteOpen = useUiStore((s) => s.setPaletteOpen);
  const chats = useChatsStore((s) => s.chats);
  const activeChatId = useChatsStore((s) => s.activeChatId);
  const startNewChat = useChatsStore((s) => s.startNewChat);
  const selectChat = useChatsStore((s) => s.selectChat);
  const togglePin = useChatsStore((s) => s.togglePin);

  return React.useMemo(() => {
    const recent = chats
      .filter((item) => item.currentLeafId !== null || item.title.trim().length > 0)
      .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt - a.updatedAt)
      .slice(0, 8);
    return [
      {
        id: "workspace",
        items: [
          {
            id: "new-chat",
            label: t("nav.newChat"),
            icon: SquarePen,
            hue: 24,
            onClick: () => {
              startNewChat();
              setView("chat");
            },
          },
          {
            id: "search",
            label: t("nav.search"),
            icon: Search,
            onClick: () => setSearchOpen(true),
          },
          {
            id: "palette",
            label: t("palette.actions"),
            icon: Command,
            onClick: () => setPaletteOpen(true),
          },
        ],
      },
      {
        id: "providers",
        items: [
          {
            id: "providers-page",
            label: t("palette.providers"),
            icon: Server,
            active: view === "providers",
            onClick: () => setView("providers"),
          },
        ],
      },
      ...(recent.length > 0
        ? [
            {
              id: "recent",
              title: t("corner.recent"),
              items: recent.map((item): CornerMenuItem => ({
                id: `chat-${item.id}`,
                label: item.title.trim() || "…",
                icon: item.pinned ? Pin : MessageSquare,
                hue: item.pinned ? 38 : undefined,
                active: item.id === activeChatId,
                onClick: () => {
                  void selectChat(item.id).then(() => setView("chat"));
                },
                menuLabel: t("nav.more"),
                menuItems: [
                  {
                    id: `pin-${item.id}`,
                    label: item.pinned ? t("common.unpin") : t("common.pin"),
                    icon: Pin,
                    onClick: () => void togglePin(item.id),
                  },
                  {
                    id: `rename-${item.id}`,
                    label: t("common.rename"),
                    icon: Pencil,
                    onClick: () => actions?.onRename(item.id),
                  },
                  {
                    id: `delete-${item.id}`,
                    label: t("common.delete"),
                    icon: Trash2,
                    hue: 0,
                    onClick: () => actions?.onDelete(item.id),
                  },
                ],
              })),
            },
          ]
        : []),
    ];
  }, [
    actions,
    activeChatId,
    chats,
    startNewChat,
    setPaletteOpen,
    setSearchOpen,
    setView,
    selectChat,
    t,
    togglePin,
    view,
  ]);
}
