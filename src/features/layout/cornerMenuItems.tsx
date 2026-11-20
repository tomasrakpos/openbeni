// layout feature: cornerMenuItems; change its UI/flow here and keep related state/API calls in sync.
import { Command, Cpu, LogOut, MessageSquare, MessageSquarePlus, Pencil, Pin, Trash2 } from "lucide-react";
import * as React from "react";
import type { CornerMenuItem, CornerMenuSection } from "@/features/layout/CornerMenu";
import { useT } from "@/lib/i18n";
import { useAuthStore, type AuthUser } from "@/stores/auth";
import { useChatsStore } from "@/stores/chats";
import { useUiStore } from "@/stores/ui";

export interface ChatActions {
  onRename: (chatId: string) => void;
  onDelete: (chatId: string) => void;
}

/**
 * The account chip: the provider picture when there is one, otherwise the first
 * letter of the name (or the email). It fills the same 28px chip as every other
 * menu icon, so the row looks untouched.
 */
function userAvatar(user: AuthUser) {
  return function UserAvatar() {
    if (user.avatarUrl) {
      return (
        <img
          src={user.avatarUrl}
          alt=""
          referrerPolicy="no-referrer"
          style={{ width: 18, height: 18, borderRadius: 9999, objectFit: "cover" }}
        />
      );
    }
    const initial = (user.name || user.email || "?").trim().charAt(0).toUpperCase() || "?";
    return (
      <span aria-hidden="true" style={{ fontSize: 12, fontWeight: 600, lineHeight: 1 }}>
        {initial}
      </span>
    );
  };
}

/**
 * Items for the corner menu. Kept out of the component so the menu stays
 * generic: point it at a different config (or pass sections directly) and it
 * renders that instead.
 */
export function useCornerMenuSections(actions?: ChatActions): CornerMenuSection[] {
  const t = useT();
  const setView = useUiStore((s) => s.setView);
  const setPaletteOpen = useUiStore((s) => s.setPaletteOpen);
  const setModelPickerOpen = useUiStore((s) => s.setModelPickerOpen);
  const chats = useChatsStore((s) => s.chats);
  const activeChatId = useChatsStore((s) => s.activeChatId);
  const createChat = useChatsStore((s) => s.createChat);
  const selectChat = useChatsStore((s) => s.selectChat);
  const togglePin = useChatsStore((s) => s.togglePin);
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);

  return React.useMemo(() => {
    const chat = chats.find((item) => item.id === activeChatId);
    const recent = [...chats].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8);
    return [
      {
        id: "workspace",
        items: [
          {
            id: "new-chat",
            label: t("nav.newChat"),
            icon: MessageSquarePlus,
            onClick: () => {
              void createChat().then(() => setView("chat"));
            },
          },
          {
            id: "palette",
            label: t("palette.actions"),
            icon: Command,
            onClick: () => setPaletteOpen(true),
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
                icon: MessageSquare,
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
      {
        id: "model",
        items: [
          {
            id: "switch-model",
            label: t("palette.switchModel"),
            icon: Cpu,
            onClick: () => {
              if (chat?.providerId && chat.modelId) setModelPickerOpen(true);
              else setView("providers");
            },
          },
        ],
      },
      ...(user
        ? [
            {
              id: "account",
              title: t("auth.account"),
              items: [
                {
                  id: "account-user",
                  label: user.name || user.email || t("auth.account"),
                  icon: userAvatar(user),
                },
                {
                  id: "sign-out",
                  label: t("auth.signOut"),
                  icon: LogOut,
                  hue: 0,
                  onClick: () => void signOut(),
                },
              ],
            },
          ]
        : []),
    ];
  }, [
    actions,
    activeChatId,
    chats,
    createChat,
    setModelPickerOpen,
    setPaletteOpen,
    setView,
    selectChat,
    signOut,
    t,
    togglePin,
    user,
  ]);
}
