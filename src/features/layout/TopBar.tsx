// layout feature: TopBar; change its UI/flow here and keep related state/API calls in sync.
import {
  Command,
  FileJson,
  FileText,
  Languages,
  Lock,
  Moon,
  MoreVertical,
  PanelRight,
  PanelRightClose,
  Settings2,
  Sun,
  UserRound,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { chatToJson, chatToMarkdown, downloadJson, downloadText, safeFilename } from "@/lib/export";
import { useT } from "@/lib/i18n";
import { AppNav } from "@/features/layout/AppNav";
import { CornerMenu, type CornerMenuSection } from "@/features/layout/CornerMenu";
import { useCornerMenuSections } from "@/features/layout/cornerMenuItems";
import { ChatSettingsDialog } from "@/features/chat/ChatSettingsDialog";
import { activeThread, useChatsStore } from "@/stores/chats";
import { useAuthStore } from "@/stores/auth";
import { useSettingsStore } from "@/stores/settings";
import { useUiStore } from "@/stores/ui";

/*
 * The top bar keeps only what you touch while chatting: the chat title, the
 * model picker and a single overflow menu. Search, the command palette, the
 * theme switch, the preview panel toggle and settings all live inside that
 * menu, so the header stays calm on a phone and on a wide desktop alike.
 */
export function TopBar() {
  const t = useT();
  const view = useUiStore((s) => s.view);
  const setMobilePanelOpen = useUiStore((s) => s.setMobilePanelOpen);
  const setSearchOpen = useUiStore((s) => s.setSearchOpen);
  const setPaletteOpen = useUiStore((s) => s.setPaletteOpen);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const chatSettingsOpen = useUiStore((s) => s.chatSettingsOpen);
  const setChatSettingsOpen = useUiStore((s) => s.setChatSettingsOpen);
  const setModelPickerOpen = useUiStore((s) => s.setModelPickerOpen);
  const setAuthOpen = useUiStore((s) => s.setAuthOpen);
  const setAuthGateOpen = useUiStore((s) => s.setAuthGateOpen);
  const signedIn = useAuthStore((s) => s.signedIn);
  const profile = useAuthStore((s) => s.profile);

  const chats = useChatsStore((s) => s.chats);
  const messages = useChatsStore((s) => s.messages);
  const activeChatId = useChatsStore((s) => s.activeChatId);
  const createChat = useChatsStore((s) => s.createChat);
  const togglePin = useChatsStore((s) => s.togglePin);
  const renameChat = useChatsStore((s) => s.renameChat);
  const deleteChat = useChatsStore((s) => s.deleteChat);
  const streaming = useChatsStore((s) => s.streaming);

  const settings = useSettingsStore((s) => s.settings);
  const locked = useSettingsStore((s) => s.locked);
  const toggleTheme = useSettingsStore((s) => s.toggleTheme);
  const update = useSettingsStore((s) => s.update);

  const chat = chats.find((item) => item.id === activeChatId);

  const [renameTargetId, setRenameTargetId] = React.useState<string | null>(null);
  const [renameValue, setRenameValue] = React.useState("");
  const [deleteTargetId, setDeleteTargetId] = React.useState<string | null>(null);

  const chatActions = React.useMemo(
    () => ({
      onRename: (id: string) => {
        const target = chats.find((c) => c.id === id);
        setRenameValue(target?.title ?? "");
        setRenameTargetId(id);
      },
      onDelete: (id: string) => setDeleteTargetId(id),
    }),
    [chats],
  );
  const cornerMenuSections = useCornerMenuSections(chatActions);
  const renameTarget = chats.find((c) => c.id === renameTargetId);
  const deleteTarget = chats.find((c) => c.id === deleteTargetId);

  const title =
    view === "providers"
      ? t("providers.title")
      : chat?.title?.trim() || t("chat.newChatTitle");
  const thread = React.useMemo(() => activeThread(messages, chat ?? null), [messages, chat]);

  const exportChat = (format: "md" | "json") => {
    if (!chat) return;
    const suffix = safeFilename(chat.title || "chat");
    if (format === "md") downloadText(chatToMarkdown(chat, thread), `${suffix}.md`, "text/markdown;charset=utf-8");
    else downloadJson(chatToJson(chat, thread), `${suffix}.json`);
    toast.success(t("toast.exported"));
  };

  const togglePanel = () => {
    if (window.innerWidth >= 1280) void update({ rightPanelOpen: !settings.rightPanelOpen });
    else setMobilePanelOpen(true);
  };

  const menuBrand = (
    <div className="flex min-w-0 items-center gap-2.5">
      <Logo size={22} />
      <span className="min-w-0">
        <span className="cm-brand-name block">{t("app.name")}</span>
        <span className="cm-brand-sub">{t("app.tagline")}</span>
      </span>
    </div>
  );

  const rightSections: CornerMenuSection[] = [
    ...(view === "chat" && chat
      ? [
          {
            id: "session",
            items: [
              {
                id: "params",
                label: t("chat.params"),
                icon: Settings2,
                onClick: () => setChatSettingsOpen(true),
              },
              {
                id: "panel",
                label: t("palette.togglePanel"),
                icon: settings.rightPanelOpen ? PanelRightClose : PanelRight,
                active: settings.rightPanelOpen,
                onClick: togglePanel,
              },
              { id: "export-md", label: t("chat.exportMd"), icon: FileText, onClick: () => exportChat("md") },
              { id: "export-json", label: t("chat.exportJson"), icon: FileJson, onClick: () => exportChat("json") },
            ],
          },
        ]
      : []),
    {
      id: "account",
      items: [
        {
          id: "account-open",
          label: signedIn && profile ? t("auth.signedInAs", { email: profile.email }) : t("auth.signIn"),
          icon: UserRound,
          onClick: () => {
            if (signedIn) setAuthOpen(true);
            else setAuthGateOpen(true);
          },
        },
      ],
    },
    {
      id: "appearance",
      items: [
        {
          id: "theme",
          label: t("palette.toggleTheme"),
          icon: settings.theme === "dark" ? Sun : Moon,
          onClick: () => void toggleTheme(),
        },
        {
          id: "lang",
          label: t("palette.toggleLang"),
          icon: Languages,
          onClick: () => void update({ lang: settings.lang === "fa" ? "en" : "fa" }),
        },
      ],
    },
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

  return (
    <>
    <header className="pointer-events-none absolute inset-x-0 top-0 z-30 grid h-[var(--header-h)] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 px-2.5 pt-[env(safe-area-inset-top,0px)] sm:px-4">
      <div className="pointer-events-auto flex min-w-0 items-center gap-2">
        <CornerMenu sections={cornerMenuSections} label={t("nav.more")} header={menuBrand} />

        <div className="flex min-w-0 items-center gap-2">
          {view === "chat" ? (
            <>
              <h1 className="min-w-0 max-w-full text-[13px] font-semibold tracking-[-0.01em] text-foreground sr-only sm:not-sr-only sm:max-w-[28rem]">
                <span className="block truncate">{title}</span>
              </h1>
              {streaming ? (
                <span className="hidden items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2 py-0.5 text-[10px] font-medium text-[var(--primary)] sm:inline-flex">
                  <span className="size-1.5 animate-pulse rounded-full bg-[var(--primary)]" />
                  {t("chat.streaming")}
                </span>
              ) : chat && thread.length > 0 ? (
                <span className="hidden text-[10.5px] text-[var(--faint)] sm:inline">
                  {thread.length} · {t("nav.chats").toLowerCase()}
                </span>
              ) : null}
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

      <div className="pointer-events-auto flex min-w-0 items-center justify-end gap-1">
        <CornerMenu
          sections={rightSections}
          label={t("nav.more")}
          anchor="right"
          icon={MoreVertical}
          header={menuBrand}
        />
      </div>
      <ChatSettingsDialog open={chatSettingsOpen} onOpenChange={setChatSettingsOpen} />
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
