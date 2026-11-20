// layout feature: CommandPalette; change its UI/flow here and keep related state/API calls in sync.
import {
  ArrowRight,
  Command as CommandIcon,
  Cpu,
  Download,
  Languages,
  MessageSquarePlus,
  Moon,
  PanelLeft,
  PanelRight,
  Search,
  Server,
  Settings,
  Sun,
  TextCursorInput,
  Zap,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { ProviderIcon } from "@/components/ProviderIcon";
import { Command, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { chatToMarkdown, downloadText, safeFilename } from "@/lib/export";
import { providerDisplayName } from "@/lib/bundled";
import { useT } from "@/lib/i18n";
import { modelIdentityKeys } from "@/lib/modelRoutes";
import { cn } from "@/lib/utils";
import { activeThread, useChatsStore } from "@/stores/chats";
import { useProvidersStore } from "@/stores/providers";
import { useSettingsStore } from "@/stores/settings";
import { useUiStore } from "@/stores/ui";

export function CommandPalette() {
  const t = useT();
  const open = useUiStore((s) => s.paletteOpen);
  const setOpen = useUiStore((s) => s.setPaletteOpen);
  const setView = useUiStore((s) => s.setView);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const setSearchOpen = useUiStore((s) => s.setSearchOpen);
  const setModelPickerOpen = useUiStore((s) => s.setModelPickerOpen);
  const requestComposerFocus = useUiStore((s) => s.requestComposerFocus);
  const setSidebarMobileOpen = useUiStore((s) => s.setSidebarMobileOpen);

  const chats = useChatsStore((s) => s.chats);
  const messages = useChatsStore((s) => s.messages);
  const activeChatId = useChatsStore((s) => s.activeChatId);
  const createChat = useChatsStore((s) => s.createChat);
  const selectChat = useChatsStore((s) => s.selectChat);
  const setChatModel = useChatsStore((s) => s.setChatModel);

  const providers = useProvidersStore((s) => s.providers);
  const models = useProvidersStore((s) => s.models);
  const pingAll = useProvidersStore((s) => s.pingAll);

  const settings = useSettingsStore((s) => s.settings);
  const toggleTheme = useSettingsStore((s) => s.toggleTheme);
  const toggleLang = useSettingsStore((s) => s.toggleLang);
  const update = useSettingsStore((s) => s.update);

  const enabledModels = React.useMemo(() => {
    const enabledProviders = [...providers]
      .filter((provider) => provider.enabled)
      .sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.order - b.order);
    const seen = new Set<string>();
    const out: (typeof models)[number][] = [];
    for (const provider of enabledProviders) {
      const providerModels = models
        .filter((model) => model.enabled && model.providerId === provider.id)
        .sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.order - b.order);
      for (const model of providerModels) {
        const identity = modelIdentityKeys(model)[0] ?? model.id;
        if (seen.has(identity)) continue;
        seen.add(identity);
        out.push(model);
        if (out.length >= 24) return out;
      }
    }
    return out;
  }, [models, providers]);

  const recentChats = React.useMemo(() => chats.slice(0, 8), [chats]);
  const chat = chats.find((item) => item.id === activeChatId);

  const run = (action: () => void | Promise<void>) => {
    setOpen(false);
    void action();
  };

  const exportCurrent = () => {
    if (!chat) {
      toast.error(t("chat.noModel"));
      return;
    }
    downloadText(
      chatToMarkdown(chat, activeThread(messages, chat)),
      `${safeFilename(chat.title || "chat")}.md`,
      "text/markdown;charset=utf-8",
    );
    toast.success(t("toast.exported"));
  };

  const switchToModel = async (providerId: string, modelId: string) => {
    let target = useChatsStore.getState().chats.find((item) => item.id === useChatsStore.getState().activeChatId);
    if (!target) target = await createChat({ providerId, modelId });
    await setChatModel(providerId, modelId);
    setView("chat");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent frame hideClose className="gap-0 p-0 sm:w-[min(620px,calc(100vw-2rem))]">
        <DialogTitle className="sr-only">{t("palette.placeholder")}</DialogTitle>
        <DialogDescription className="sr-only">{t("palette.shortcuts")}</DialogDescription>
        <Command shouldFilter className="bg-transparent">
          <CommandInput placeholder={t("palette.placeholder")} aria-label={t("palette.placeholder")} />
          <CommandList className="max-h-[min(60vh,480px)]">
            <CommandGroup heading={t("palette.actions")}>
              <CommandItem
                value={`${t("palette.newChat")} new chat`}
                onSelect={() => run(async () => {
                  await createChat();
                  setView("chat");
                })}
              >
                <MessageSquarePlus />
                {t("palette.newChat")}
                <CommandShortcut>⌘⇧O</CommandShortcut>
              </CommandItem>
              <CommandItem
                value={`${t("palette.focusComposer")} focus input`}
                onSelect={() =>
                  run(() => {
                    setView("chat");
                    requestComposerFocus();
                  })
                }
              >
                <TextCursorInput />
                {t("palette.focusComposer")}
                <CommandShortcut>⌘/</CommandShortcut>
              </CommandItem>
              <CommandItem
                value={`${t("palette.switchModel")} model`}
                onSelect={() => run(() => setModelPickerOpen(true))}
              >
                <Cpu />
                {t("palette.switchModel")}
                <CommandShortcut>⌘M</CommandShortcut>
              </CommandItem>
              <CommandItem value={`${t("palette.providers")} providers`} onSelect={() => run(() => setView("providers"))}>
                <Server />
                {t("palette.providers")}
              </CommandItem>
              <CommandItem value={`${t("palette.settings")} settings`} onSelect={() => run(() => setSettingsOpen(true))}>
                <Settings />
                {t("palette.settings")}
              </CommandItem>
              <CommandItem
                value={`${t("nav.search")} search messages`}
                onSelect={() => run(() => setSearchOpen(true))}
              >
                <Search />
                {t("nav.search")}
                <CommandShortcut>⌘K</CommandShortcut>
              </CommandItem>
              <CommandItem
                value={`${t("palette.toggleTheme")} theme dark light`}
                onSelect={() => run(() => toggleTheme())}
              >
                {settings.theme === "dark" ? <Sun /> : <Moon />}
                {t("palette.toggleTheme")}
              </CommandItem>
              <CommandItem
                value={`${t("palette.toggleLang")} language english persian`}
                onSelect={() => run(() => toggleLang())}
              >
                <Languages />
                {t("palette.toggleLang")}
              </CommandItem>
              <CommandItem value={`${t("palette.toggleSidebar")} sidebar`} onSelect={() => run(() => setSidebarMobileOpen(true))}>
                <PanelLeft />
                {t("palette.toggleSidebar")}
              </CommandItem>
              <CommandItem
                value={`${t("palette.togglePanel")} panel preview`}
                onSelect={() =>
                  run(() => {
                    if (window.innerWidth >= 1280) void update({ rightPanelOpen: !settings.rightPanelOpen });
                    else useUiStore.getState().setMobilePanelOpen(true);
                  })
                }
              >
                <PanelRight />
                {t("palette.togglePanel")}
              </CommandItem>
              <CommandItem
                value={`${t("palette.pingAll")} ping latency`}
                onSelect={() => run(async () => {
                  await pingAll();
                  toast.success(t("toast.pingDone"));
                })}
              >
                <Zap />
                {t("palette.pingAll")}
              </CommandItem>
              <CommandItem value={`${t("palette.exportChat")} export markdown`} onSelect={() => run(exportCurrent)}>
                <Download />
                {t("palette.exportChat")}
              </CommandItem>
            </CommandGroup>

            {recentChats.length > 0 ? (
              <CommandGroup heading={t("palette.chats")}>
                {recentChats.map((item) => (
                  <CommandItem
                    key={item.id}
                    value={`chat ${item.title} ${item.id}`}
                    onSelect={() =>
                      run(async () => {
                        await selectChat(item.id);
                        setView("chat");
                      })
                    }
                  >
                    <MessageSquarePlus />
                    <span className="truncate">{item.title || t("chat.newChatTitle")}</span>
                    {item.id === activeChatId ? (
                      <span className="ml-auto rounded-full bg-[var(--primary-soft)] px-1.5 text-[9px] text-[var(--primary)]">
                        {t("common.open")}
                      </span>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}

            {enabledModels.length > 0 ? (
              <CommandGroup heading={t("nav.models")}>
                {enabledModels.map((model) => {
                  const provider = providers.find((item) => item.id === model.providerId);
                  if (!provider) return null;
                  const active = chat?.modelId === model.id && chat?.providerId === provider.id;
                  const label = providerDisplayName(provider);
                  return (
                    <CommandItem
                      key={model.id}
                      value={`model ${model.displayName} ${model.modelId} ${label}`}
                      onSelect={() => run(() => switchToModel(provider.id, model.id))}
                    >
                      <ProviderIcon
                        icon={provider.icon}
                        name={label}
                        color={provider.color}
                        baseUrl={provider.baseUrl}
                        size={18}
                      />
                      <span className="truncate">{model.displayName}</span>
                      <span                       className={cn("ml-auto truncate font-mono text-[9.5px]", active ? "text-[var(--primary)]" : "text-[var(--faint)]")}>
                        {active ? t("common.open") : label}
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ) : null}
          </CommandList>
          <div className="flex items-center justify-between gap-2 border-t border-[var(--border)] px-3 py-2">
            <span className="inline-flex items-center gap-1.5 text-[10px] text-[var(--faint)]">
              <CommandIcon className="size-3" />
              {t("palette.hint")}
            </span>
            <span className="inline-flex items-center gap-1 text-[10px] text-[var(--faint)]">
              {t("app.name")}
              <ArrowRight className="size-2.5" />
            </span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
