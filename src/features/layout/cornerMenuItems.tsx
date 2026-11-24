// layout feature: cornerMenuItems; change its UI/flow here and keep related state/API calls in sync.
import { Pencil, Pin, Trash2 } from "lucide-react";
import * as React from "react";
import {
  SidebarAutoIcon,
  SidebarConnectionsIcon,
  SidebarNewIcon,
  SidebarProjectsIcon,
  SidebarSearchIcon,
  sidebarHue,
  type CornerMenuItem,
  type CornerMenuSection,
} from "@/features/layout/CornerMenu";
import { useT } from "@/lib/i18n";
import { useChatsStore } from "@/stores/chats";
import { useUiStore } from "@/stores/ui";

export interface ChatActions {
  onRename: (chatId: string) => void;
  onDelete: (chatId: string) => void;
}

export interface CornerMenuFilterOptions {
  searchOpen: boolean;
  onToggleSearch: () => void;
  searchQuery: string;
  showAllProjects: boolean;
  onShowAllProjects: () => void;
  showAllChats: boolean;
  onShowAllChats: () => void;
}

const INITIAL_PROJECTS_LIMIT = 5;
const INITIAL_CHATS_LIMIT = 6;

function tileChar(title: string): string {
  const clean = title.trim();
  if (!clean) return "•";
  const first = Array.from(clean)[0] ?? "•";
  return first.toUpperCase();
}

/**
 * Items for the left navigation corner menu — built from the Sidebar v2.html
 * structure, SVG icons, hue glows, project letter tiles (`.pt`), chat dots
 * (`.dot`), inline search filtering, and "Show all" expansion.
 */
export function useCornerMenuSections(
  actions?: ChatActions,
  filter?: CornerMenuFilterOptions,
): CornerMenuSection[] {
  const t = useT();
  const view = useUiStore((s) => s.view);
  const setView = useUiStore((s) => s.setView);
  const setSearchOpen = useUiStore((s) => s.setSearchOpen);
  const setPaletteOpen = useUiStore((s) => s.setPaletteOpen);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const chats = useChatsStore((s) => s.chats);
  const activeChatId = useChatsStore((s) => s.activeChatId);
  const startNewChat = useChatsStore((s) => s.startNewChat);
  const selectChat = useChatsStore((s) => s.selectChat);
  const togglePin = useChatsStore((s) => s.togglePin);

  const query = (filter?.searchQuery ?? "").trim().toLowerCase();
  const showAllProjects = Boolean(filter?.showAllProjects || query);
  const showAllChats = Boolean(filter?.showAllChats || query);

  return React.useMemo(() => {
    const visibleChats = chats
      .filter((item) => item.currentLeafId !== null || item.title.trim().length > 0)
      .sort(
        (a, b) =>
          Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt - a.updatedAt,
      );

    const allProjects = visibleChats.filter((item) => Boolean(item.previewEnabled));
    const allRegularChats = visibleChats.filter((item) => !item.previewEnabled);

    const matchingProjects = query
      ? allProjects.filter((item) => (item.title || "").toLowerCase().includes(query))
      : allProjects;
    const matchingChats = query
      ? allRegularChats.filter((item) => (item.title || "").toLowerCase().includes(query))
      : allRegularChats;

    const displayedProjects = showAllProjects
      ? matchingProjects
      : matchingProjects.slice(0, INITIAL_PROJECTS_LIMIT);
    const displayedChats = showAllChats
      ? matchingChats
      : matchingChats.slice(0, INITIAL_CHATS_LIMIT);

    const buildChatMenuActions = (chatId: string, pinned?: boolean): CornerMenuItem[] => [
      {
        id: `pin-${chatId}`,
        label: pinned ? t("common.unpin") : t("common.pin"),
        icon: Pin,
        onClick: () => void togglePin(chatId),
      },
      {
        id: `rename-${chatId}`,
        label: t("common.rename"),
        icon: Pencil,
        onClick: () => actions?.onRename(chatId),
      },
      {
        id: `delete-${chatId}`,
        label: t("common.delete"),
        icon: Trash2,
        hue: 0,
        onClick: () => actions?.onDelete(chatId),
      },
    ];

    const navItems: CornerMenuItem[] = [
      {
        id: "new-chat",
        label: t("nav.newChat"),
        icon: SidebarNewIcon,
        hue: 262,
        onClick: () => {
          startNewChat();
          setView("chat");
        },
      },
      {
        id: "search",
        label: t("nav.search"),
        icon: SidebarSearchIcon,
        hue: 200,
        active: Boolean(filter?.searchOpen),
        keepOpen: Boolean(filter),
        onClick: () => {
          if (filter) filter.onToggleSearch();
          else setSearchOpen(true);
        },
      },
      {
        id: "palette",
        label: t("palette.actions"),
        icon: SidebarProjectsIcon,
        hue: 150,
        onClick: () => setPaletteOpen(true),
      },
      {
        id: "providers-page",
        label: t("nav.providers"),
        icon: SidebarConnectionsIcon,
        hue: 42,
        active: view === "providers",
        onClick: () => setView("providers"),
      },
      {
        id: "settings",
        label: t("nav.settings"),
        icon: SidebarAutoIcon,
        hue: 350,
        onClick: () => setSettingsOpen(true),
      },
    ];

    const sections: CornerMenuSection[] = [
      {
        id: "nav",
        items: navItems,
      },
    ];

    if (allProjects.length > 0) {
      const projectItems: CornerMenuItem[] = displayedProjects.map((item) => {
        const label = item.title.trim() || t("chat.newChatTitle");
        return {
          id: `proj-${item.id}`,
          label,
          tile: tileChar(label),
          hue: item.pinned ? 42 : sidebarHue(label),
          active: view === "chat" && item.id === activeChatId,
          onClick: () => {
            void selectChat(item.id).then(() => setView("chat"));
          },
          menuLabel: t("nav.more"),
          menuItems: buildChatMenuActions(item.id, item.pinned),
        };
      });

      if (!showAllProjects && matchingProjects.length > INITIAL_PROJECTS_LIMIT && filter) {
        projectItems.push({
          id: "__all_projects",
          label: t("corner.showAll"),
          variant: "more",
          keepOpen: true,
          onClick: filter.onShowAllProjects,
        });
      }

      sections.push({
        id: "projects",
        title: t("corner.projects"),
        items: projectItems,
        emptyText: query ? t("corner.noProjects") : undefined,
      });
    }

    if (allRegularChats.length > 0 || query) {
      const chatItems: CornerMenuItem[] = displayedChats.map((item) => {
        const label = item.title.trim() || "…";
        return {
          id: `chat-${item.id}`,
          label,
          dot: true,
          variant: "chat",
          hue: item.pinned ? 42 : sidebarHue(label),
          active: view === "chat" && item.id === activeChatId,
          onClick: () => {
            void selectChat(item.id).then(() => setView("chat"));
          },
          menuLabel: t("nav.more"),
          menuItems: buildChatMenuActions(item.id, item.pinned),
        };
      });

      if (!showAllChats && matchingChats.length > INITIAL_CHATS_LIMIT && filter) {
        chatItems.push({
          id: "__all_chats",
          label: t("corner.showAll"),
          variant: "more",
          keepOpen: true,
          onClick: filter.onShowAllChats,
        });
      }

      sections.push({
        id: "chats",
        title: t("corner.chats"),
        items: chatItems,
        emptyText: query ? t("corner.noChats") : undefined,
      });
    }

    return sections;
  }, [
    actions,
    activeChatId,
    chats,
    filter,
    query,
    selectChat,
    setPaletteOpen,
    setSearchOpen,
    setSettingsOpen,
    setView,
    showAllChats,
    showAllProjects,
    startNewChat,
    t,
    togglePin,
    view,
  ]);
}
