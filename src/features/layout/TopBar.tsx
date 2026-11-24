// layout feature: TopBar; change its UI/flow here and keep related state/API calls in sync.
import {
  Copy,
  Cpu,
  FileJson,
  FileText,
  HelpCircle,
  Lock,
  LogIn,
  LogOut,
  Moon,
  MoreVertical,
  Palette,
  PanelRight,
  PanelRightClose,
  Pencil,
  Pin,
  Settings,
  Settings2,
  Sun,
  Trash2,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Logo } from "@/components/Logo";
import { AccountCard, type AccountMenuItem, type AccountUser } from "@/components/ui/account-card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { chatToJson, chatToMarkdown, copyToClipboard, downloadJson, downloadText, safeFilename } from "@/lib/export";
import { useT } from "@/lib/i18n";
import { setAccent, useAccent, type Accent } from "@/lib/useAccent";
import { useIsDesktopPanel } from "@/lib/useMediaQuery";
import { cn } from "@/lib/utils";
import { AppNav } from "@/features/layout/AppNav";
import { CornerMenu, type CornerMenuSection } from "@/features/layout/CornerMenu";
import { useCornerMenuSections } from "@/features/layout/cornerMenuItems";
import { loadChatSettingsDialog } from "@/lib/preload";
import { activeThread, isChatPreviewAvailable, useChatsStore } from "@/stores/chats";

const ChatSettingsDialog = React.lazy(loadChatSettingsDialog);
import { useAuthStore } from "@/stores/auth";
import { useSettingsStore } from "@/stores/settings";
import { useUiStore } from "@/stores/ui";

const DOCS_URL = ((import.meta.env.VITE_DOCS_URL as string | undefined) ?? "").trim();

const ChatMetaBadge = React.memo(function ChatMetaBadge({
  chat,
}: {
  chat: ReturnType<typeof useChatsStore.getState>["chats"][number] | undefined;
}) {
  const t = useT();
  const streaming = useChatsStore((s) => s.streaming);
  const messages = useChatsStore((s) => s.messages);
  const threadLen = React.useMemo(
    () => (streaming || !chat ? 0 : activeThread(messages, chat).length),
    [streaming, messages, chat],
  );

  if (streaming) {
    return (
      <span className="hidden items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2 py-0.5 text-[10px] font-medium text-[var(--primary)] sm:inline-flex">
        <span className="size-1.5 animate-pulse rounded-full bg-[var(--primary)]" />
        {t("chat.streaming")}
      </span>
    );
  }
  if (chat && threadLen > 0) {
    return (
      <span className="hidden text-[10.5px] text-[var(--faint)] sm:inline">
        {threadLen} · {t("nav.chats").toLowerCase()}
      </span>
    );
  }
  return null;
});

/*
 * The top bar keeps only what you touch while chatting: the chat title, the
 * navigation pill, the left navigation menu (with the bottom account card),
 * and the right current-conversation menu.
 */
export function TopBar() {
  const t = useT();
  const view = useUiStore((s) => s.view);
  const setView = useUiStore((s) => s.setView);
  const isDesktopPanel = useIsDesktopPanel();
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const chatSettingsOpen = useUiStore((s) => s.chatSettingsOpen);
  const setChatSettingsOpen = useUiStore((s) => s.setChatSettingsOpen);
  const setModelPickerOpen = useUiStore((s) => s.setModelPickerOpen);
  const setAuthOpen = useUiStore((s) => s.setAuthOpen);
  const setAuthGateOpen = useUiStore((s) => s.setAuthGateOpen);
  const navSearchOpen = useUiStore((s) => s.navSearchOpen);
  const authUser = useAuthStore((s) => s.user);
  const signedIn = useAuthStore((s) => s.signedIn);
  const profile = useAuthStore((s) => s.profile);
  const signOut = useAuthStore((s) => s.signOut);

  const chats = useChatsStore((s) => s.chats);
  const activeChatId = useChatsStore((s) => s.activeChatId);
  const hasChatMessages = useChatsStore((s) => {
    if (!s.activeChatId) return false;
    for (let i = 0; i < s.messages.length; i++) {
      if (s.messages[i].chatId === s.activeChatId) return true;
    }
    return false;
  });
  const previewAvailable = useChatsStore((s) => {
    if (!s.activeChatId) return false;
    const active = s.chats.find((c) => c.id === s.activeChatId);
    return isChatPreviewAvailable(active, s.messages);
  });
  const togglePin = useChatsStore((s) => s.togglePin);
  const renameChat = useChatsStore((s) => s.renameChat);
  const deleteChat = useChatsStore((s) => s.deleteChat);

  const settings = useSettingsStore((s) => s.settings);
  const locked = useSettingsStore((s) => s.locked);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const update = useSettingsStore((s) => s.update);
  const accent = useAccent();

  const chat = React.useMemo(
    () => chats.find((item) => item.id === activeChatId),
    [chats, activeChatId],
  );

  const [renameTargetId, setRenameTargetId] = React.useState<string | null>(null);
  const [renameValue, setRenameValue] = React.useState("");
  const [deleteTargetId, setDeleteTargetId] = React.useState<string | null>(null);
  const [menuSearchOpen, setMenuSearchOpen] = React.useState(false);
  const [menuSearchQuery, setMenuSearchQuery] = React.useState("");
  const [showAllProjects, setShowAllProjects] = React.useState(false);
  const [showAllChats, setShowAllChats] = React.useState(false);

  const chatActions = React.useMemo(
    () => ({
      onRename: (id: string) => {
        const target = useChatsStore.getState().chats.find((c) => c.id === id);
        setRenameValue(target?.title ?? "");
        setRenameTargetId(id);
      },
      onDelete: (id: string) => setDeleteTargetId(id),
    }),
    [],
  );

  const menuFilter = React.useMemo(
    () => ({
      searchOpen: menuSearchOpen,
      onToggleSearch: () => {
        setMenuSearchOpen((prev) => {
          if (prev) setMenuSearchQuery("");
          return !prev;
        });
      },
      searchQuery: menuSearchQuery,
      showAllProjects,
      onShowAllProjects: () => setShowAllProjects(true),
      showAllChats,
      onShowAllChats: () => setShowAllChats(true),
    }),
    [menuSearchOpen, menuSearchQuery, showAllProjects, showAllChats],
  );

  const cornerMenuSections = useCornerMenuSections(chatActions, menuFilter);
  const renameTarget = chats.find((c) => c.id === renameTargetId);
  const deleteTarget = chats.find((c) => c.id === deleteTargetId);

  const title =
    view === "providers"
      ? t("providers.title")
      : chat?.title?.trim() || t("chat.newChatTitle");

  const exportChat = React.useCallback((format: "md" | "json") => {
    if (!chat) return;
    const thread = activeThread(useChatsStore.getState().messages, chat);
    const suffix = safeFilename(chat.title || "chat");
    if (format === "md") downloadText(chatToMarkdown(chat, thread), `${suffix}.md`, "text/markdown;charset=utf-8");
    else downloadJson(chatToJson(chat, thread), `${suffix}.json`);
    toast.success(t("toast.exported"));
  }, [chat, t]);

  const copyChat = React.useCallback(async () => {
    if (!chat) return;
    const thread = activeThread(useChatsStore.getState().messages, chat);
    const ok = await copyToClipboard(chatToMarkdown(chat, thread));
    if (ok) toast.success(t("toast.copied"));
    else toast.error(t("toast.clipboardFailed"));
  }, [chat, t]);

  const togglePanel = () => {
    void update({ rightPanelOpen: !settings.rightPanelOpen });
  };

  const menuBrand = (
    <div className="flex w-full items-center justify-start py-0.5">
      <img
        src="/brand/wordmark.png"
        alt={t("app.name")}
        draggable={false}
        decoding="async"
        loading="lazy"
        className="h-[38px] w-auto max-w-[236px] select-none object-contain"
      />
    </div>
  );

  const isFa = settings.lang === "fa";
  const resolvedDark =
    settings.theme === "dark" ||
    (settings.theme === "system" &&
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);

  const appearanceSubmenu = (
    <div className="space-y-2.5 text-[12px]" dir="ltr">
      <div>
        <div className="mb-1.5 text-[10.5px] font-medium text-[var(--muted-foreground)]">
          {t("settings.theme")}
        </div>
        <Tabs
          value={resolvedDark ? "dark" : "light"}
          onValueChange={(value) => void setTheme(value as "light" | "dark")}
        >
          <TabsList className="w-full">
            <TabsTrigger value="light" className="flex-1">
              <Sun />
              <span>{t("settings.light")}</span>
            </TabsTrigger>
            <TabsTrigger value="dark" className="flex-1">
              <Moon />
              <span>{t("settings.dark")}</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div>
        <div className="mb-1.5 text-[10.5px] font-medium text-[var(--muted-foreground)]">
          {isFa ? "رنگ تم" : "Accent"}
        </div>
        <Tabs
          value={accent}
          onValueChange={(value) => setAccent(value as Accent)}
        >
          <TabsList className="w-full">
            <TabsTrigger value="violet" className="flex-1">
              <span className="size-2.5 rounded-full bg-[#7c4dff]" aria-hidden="true" />
              <span>{isFa ? "بنفش" : "Violet"}</span>
            </TabsTrigger>
            <TabsTrigger value="ember" className="flex-1">
              <span className="size-2.5 rounded-full bg-[#e0531a]" aria-hidden="true" />
              <span>{isFa ? "نارنجی" : "Ember"}</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div>
        <div className="mb-1.5 text-[10.5px] font-medium text-[var(--muted-foreground)]">
          {t("settings.language")}
        </div>
        <Tabs
          value={settings.lang}
          onValueChange={(value) => void update({ lang: value as "en" | "fa" })}
        >
          <TabsList className="w-full">
            <TabsTrigger value="en" className="flex-1">
              English
            </TabsTrigger>
            <TabsTrigger value="fa" className="flex-1">
              فارسی
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
    </div>
  );

  const rightSections: CornerMenuSection[] = [
    ...(view === "chat" && chat && hasChatMessages
      ? [
          {
            id: "session",
            items: [
              {
                id: "switch-model",
                label: t("palette.switchModel"),
                icon: Cpu,
                onClick: () => {
                  if (chat.providerId && chat.modelId) setModelPickerOpen(true);
                  else setView("providers");
                },
              },
              {
                id: "params",
                label: t("chat.params"),
                icon: Settings2,
                onClick: () => setChatSettingsOpen(true),
              },
              ...(isDesktopPanel && previewAvailable
                ? [
                    {
                      id: "panel",
                      label: t("palette.togglePanel"),
                      icon: settings.rightPanelOpen ? PanelRightClose : PanelRight,
                      active: settings.rightPanelOpen,
                      onClick: togglePanel,
                    },
                  ]
                : []),
            ],
          },
          {
            id: "conversation",
            items: [
              {
                id: "rename-chat",
                label: t("common.rename"),
                icon: Pencil,
                onClick: () => chatActions.onRename(chat.id),
              },
              {
                id: "pin-chat",
                label: chat.pinned ? t("common.unpin") : t("common.pin"),
                icon: Pin,
                active: chat.pinned,
                onClick: () => void togglePin(chat.id),
              },
              {
                id: "copy-chat",
                label: isFa ? "کپی گفتگو" : "Copy conversation",
                icon: Copy,
                onClick: () => void copyChat(),
              },
              { id: "export-md", label: t("chat.exportMd"), icon: FileText, onClick: () => exportChat("md") },
              { id: "export-json", label: t("chat.exportJson"), icon: FileJson, onClick: () => exportChat("json") },
              {
                id: "delete-chat",
                label: t("common.delete"),
                icon: Trash2,
                hue: 0,
                onClick: () => chatActions.onDelete(chat.id),
              },
            ],
          },
        ]
      : []),
    ...(!signedIn
      ? [
          {
            id: "guest",
            items: [
              {
                id: "guest-sign-in",
                label: t("auth.signIn"),
                icon: LogIn,
                onClick: () => setAuthGateOpen(true),
              },
              {
                id: "guest-appearance",
                label: t("settings.appearance"),
                icon: Palette,
                submenu: appearanceSubmenu,
              },
            ],
          },
        ]
      : []),
    ...(locked
      ? [
          {
            id: "app",
            items: [
              {
                id: "locked",
                label: t("settings.lockedBadge"),
                icon: Lock,
                hue: 38,
                onClick: () => setSettingsOpen(true),
              },
            ],
          },
        ]
      : []),
  ];

  const accountUser: AccountUser | null =
    signedIn && (authUser || profile)
      ? {
          name:
            authUser?.name ||
            profile?.displayName ||
            authUser?.email ||
            profile?.email ||
            t("auth.account"),
          email: authUser?.email || profile?.email || undefined,
          avatarUrl: authUser?.avatarUrl ?? null,
        }
      : null;

  const renderAccountFooter = (closeMenu: () => void) => {
    const accountItems: AccountMenuItem[] = [
      {
        id: "account-settings",
        label: isFa ? "تنظیمات حساب" : "Account settings",
        icon: <Settings />,
        onClick: () => {
          closeMenu();
          setAuthOpen(true);
        },
      },
      {
        id: "appearance",
        label: t("settings.appearance"),
        icon: <Palette />,
        submenu: appearanceSubmenu,
      },
      ...(DOCS_URL
        ? [
            {
              id: "help",
              label: isFa ? "راهنما" : "Help",
              icon: <HelpCircle />,
              href: DOCS_URL,
              onClick: () => closeMenu(),
            },
          ]
        : []),
      {
        id: "sign-out",
        label: t("auth.signOut"),
        icon: <LogOut />,
        danger: true,
        separatorBefore: true,
        onClick: () => {
          closeMenu();
          void signOut();
        },
      },
    ];

    return (
      <AccountCard
        user={accountUser}
        items={accountItems}
        onSignIn={() => {
          closeMenu();
          setAuthGateOpen(true);
        }}
      />
    );
  };

  return (
    <>
    <header
      className={cn(
        "pointer-events-none absolute inset-x-0 top-0 grid h-[var(--header-h)] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 px-2.5 pt-[env(safe-area-inset-top,0px)] sm:px-4",
        navSearchOpen ? "z-40" : "z-30",
      )}
    >
      <div
        className={cn(
          "pointer-events-auto flex min-w-0 items-center gap-2 transition-[opacity,transform,filter] duration-200 ease-out",
          navSearchOpen && "pointer-events-none scale-[0.96] opacity-0 blur-[2px]",
        )}
        aria-hidden={navSearchOpen || undefined}
      >
        <CornerMenu
          sections={cornerMenuSections}
          label={t("nav.more")}
          header={menuBrand}
          footer={renderAccountFooter}
          searchOpen={menuSearchOpen}
          onSearchOpenChange={(next) => {
            setMenuSearchOpen(next);
            if (!next) setMenuSearchQuery("");
          }}
          searchQuery={menuSearchQuery}
          onSearchQueryChange={setMenuSearchQuery}
          searchPlaceholder={t("corner.searchPlaceholder")}
        />

        <div className="flex min-w-0 items-center gap-2">
          {view === "chat" ? (
            <>
              <h1 className="min-w-0 max-w-full text-[13px] font-semibold tracking-[-0.01em] text-foreground sr-only sm:not-sr-only sm:max-w-[28rem]">
                <span className="block truncate">{title}</span>
              </h1>
              <ChatMetaBadge chat={chat} />
            </>
          ) : (
            <>
              <h1 className="truncate text-[13px] font-semibold tracking-[-0.01em] text-foreground sr-only sm:not-sr-only">
                {title}
              </h1>
            </>
          )}
        </div>
      </div>

      {/* The pill is centred in its own grid column, so it stays on the exact
          middle of the header regardless of the title width. The wrapper must
          not use a transform: that would become the backdrop root and kill the
          nav's `url(#…)` refraction. The header likewise runs no backdrop
          filter. */}
      <div className="pointer-events-auto flex min-w-0 items-center justify-center">
        <AppNav />
      </div>

      <div
        className={cn(
          "pointer-events-auto flex min-w-0 items-center justify-end gap-1.5 transition-[opacity,transform,filter] duration-200 ease-out",
          navSearchOpen && "pointer-events-none scale-[0.96] opacity-0 blur-[2px]",
        )}
        aria-hidden={navSearchOpen || undefined}
      >
        {!(view === "chat" && !hasChatMessages) && rightSections.length > 0 ? (
          <div className="right-menu-enter">
            <CornerMenu
              sections={rightSections}
              label={t("nav.more")}
              anchor="right"
              icon={MoreVertical}
              header={menuBrand}
            />
          </div>
        ) : null}
      </div>
      {chatSettingsOpen ? (
        <React.Suspense fallback={null}>
          <ChatSettingsDialog open={chatSettingsOpen} onOpenChange={setChatSettingsOpen} />
        </React.Suspense>
      ) : null}
    </header>

    <Dialog open={!!renameTargetId} onOpenChange={(open) => !open && setRenameTargetId(null)}>
      <DialogContent className="sm:w-[min(440px,calc(100vw-2rem))]">
        <DialogHeader>
          <DialogTitle>{t("common.rename")}</DialogTitle>
        </DialogHeader>
        <Input
          value={renameValue}
          onChange={(event) => setRenameValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && renameTargetId) {
              event.preventDefault();
              void renameChat(renameTargetId, renameValue);
              setRenameTargetId(null);
            }
          }}
          autoFocus
          maxLength={120}
          aria-label={t("common.rename")}
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => setRenameTargetId(null)}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={() => {
              if (renameTargetId) void renameChat(renameTargetId, renameValue);
              setRenameTargetId(null);
            }}
          >
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <ConfirmDialog
      open={!!deleteTargetId}
      onOpenChange={(open) => !open && setDeleteTargetId(null)}
      title={t("common.delete")}
      description={t("chat.deleteConfirm", { title: deleteTarget?.title || t("chat.newChatTitle") })}
      confirmLabel={t("common.delete")}
      cancelLabel={t("common.cancel")}
      destructive
      onConfirm={async () => {
        if (!deleteTargetId) return;
        await deleteChat(deleteTargetId);
        setDeleteTargetId(null);
        toast.success(t("toast.chatDeleted"));
      }}
    />
    </>
  );
}
