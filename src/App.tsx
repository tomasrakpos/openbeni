// App bootstrap: change app mounting and top-level view selection here.
import * as React from "react";
import { Toaster, toast } from "sonner";
import { ChatView } from "@/app/ChatView";
import { SmokeLogin } from "@/components/ui/smoke-login";
import { resetProvidersOnce } from "@/db/defaults";
import HalftoneFlowHero from "@/components/ui/halftone-flow-hero";
import { ArrowLeft } from "lucide-react";
import { GlassIntro } from "@/features/intro/GlassIntro";
import { HeaderBlur } from "@/features/layout/HeaderBlur";
import { RightPanel } from "@/features/layout/RightPanel";
import { TopBar } from "@/features/layout/TopBar";
import { UnlockGate } from "@/features/settings/UnlockGate";
import { localizeError } from "@/lib/errors";
import { useAccent } from "@/lib/useAccent";
import { useDocumentLanguage, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useChatsStore, activeThread } from "@/stores/chats";
import { useAuthStore } from "@/stores/auth";
import { useCatalogStore } from "@/stores/catalog";
import { useProvidersStore } from "@/stores/providers";
import { useSettingsStore } from "@/stores/settings";
import { useUiStore } from "@/stores/ui";

// Heavy, on-demand surfaces: settings, providers, palette, search, model picker
// and the wizard stay out of the entry chunk until the user first needs them.
const CommandPalette = React.lazy(() =>
  import("@/features/layout/CommandPalette").then((m) => ({ default: m.CommandPalette })),
);
const SearchDialog = React.lazy(() =>
  import("@/features/layout/SearchDialog").then((m) => ({ default: m.SearchDialog })),
);
const ModelPicker = React.lazy(() =>
  import("@/features/models/ModelPicker").then((m) => ({ default: m.ModelPicker })),
);
const ProvidersPage = React.lazy(() =>
  import("@/features/providers/ProvidersPage").then((m) => ({ default: m.ProvidersPage })),
);
const ProviderWizard = React.lazy(() =>
  import("@/features/providers/ProviderWizard").then((m) => ({ default: m.ProviderWizard })),
);
const SettingsDialog = React.lazy(() =>
  import("@/features/settings/SettingsDialog").then((m) => ({ default: m.SettingsDialog })),
);
const AuthPanel = React.lazy(() =>
  import("@/features/auth/AuthPanel").then((m) => ({ default: m.AuthPanel })),
);

/**
 * Returns true once any of the flags has been true. Used to mount a lazy
 * dialog on first open and keep it mounted afterwards, so its exit animation
 * still plays when the flag flips back to false.
 */
function useLatched(...flags: boolean[]): boolean {
  const [latched, setLatched] = React.useState(false);
  React.useEffect(() => {
    if (flags.some(Boolean)) setLatched(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, flags);
  return latched || flags.some(Boolean);
}

export default function App() {
  const t = useT();
  useDocumentLanguage();

  const settings = useSettingsStore((s) => s.settings);
  const loadSettings = useSettingsStore((s) => s.load);
  const update = useSettingsStore((s) => s.update);
  const locked = useSettingsStore((s) => s.locked);

  const loadProviders = useProvidersStore((s) => s.load);
  const loadChats = useChatsStore((s) => s.load);
  const createChat = useChatsStore((s) => s.createChat);

  const view = useUiStore((s) => s.view);
  const setView = useUiStore((s) => s.setView);
  const setSearchOpen = useUiStore((s) => s.setSearchOpen);
  const setModelPickerOpen = useUiStore((s) => s.setModelPickerOpen);
  const setSidebarMobileOpen = useUiStore((s) => s.setSidebarMobileOpen);
  const setMobilePanelOpen = useUiStore((s) => s.setMobilePanelOpen);
  const requestComposerFocus = useUiStore((s) => s.requestComposerFocus);
  const paletteOpen = useUiStore((s) => s.paletteOpen);
  const searchOpen = useUiStore((s) => s.searchOpen);
  const modelPickerOpen = useUiStore((s) => s.modelPickerOpen);
  const wizardOpen = useUiStore((s) => s.wizardOpen);
  const settingsOpen = useUiStore((s) => s.settingsOpen);
  const authOpen = useUiStore((s) => s.authOpen);

  const showSearch = useLatched(searchOpen);
  const showPalette = useLatched(paletteOpen);
  const showModelPicker = useLatched(modelPickerOpen);
  const showWizard = useLatched(wizardOpen);
  const showSettings = useLatched(settingsOpen);
  const showAuth = useLatched(authOpen);

  const authReady = useAuthStore((s) => s.ready);
  const signedIn = useAuthStore((s) => s.signedIn);
  const authGateOpen = useUiStore((s) => s.authGateOpen);
  const setAuthGateOpen = useUiStore((s) => s.setAuthGateOpen);
  // The app opens straight onto the main screen: signing up is a step the
  // visitor can take from the menu whenever they want, not a gate in front of
  // the product. The page also never shows for a signed-in visitor.
  const showLogin = !signedIn && authGateOpen;
  const closeAuthGate = React.useCallback(() => setAuthGateOpen(false), [setAuthGateOpen]);
  const googleSignIn = React.useCallback(() => useAuthStore.getState().signInWithGoogle(), []);

  // Escape leaves the sign-up page, like any other overlay.
  React.useEffect(() => {
    if (!showLogin) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeAuthGate();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showLogin, closeAuthGate]);

  const chats = useChatsStore((s) => s.chats);
  const messages = useChatsStore((s) => s.messages);
  const activeChatId = useChatsStore((s) => s.activeChatId);
  // The colorful background belongs to the landing state. As soon as a real
  // conversation exists it settles into a dark, quiet canvas behind the thread,
  // which keeps the text readable and the glass composer calm.
  const inConversation = React.useMemo(() => {
    const chat = chats.find((item) => item.id === activeChatId) ?? null;
    return view === "chat" && activeThread(messages, chat).length > 0;
  }, [chats, messages, activeChatId, view]);

  const [booted, setBooted] = React.useState(false);
  // The glass intro owns the first seconds of the session. The app boots behind
  // it and is revealed as the overlay fades out.
  const [introDone, setIntroDone] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      try {
        await loadSettings();
        // One-time wipe: every provider is removed and nothing is seeded back,
        // so a fresh browser and an existing one both start with an empty list.
        await resetProvidersOnce();
        await loadProviders();
        await useAuthStore.getState().init();
        useCatalogStore.getState().init();
        await loadChats();
      } catch (error) {
        console.error("Bootstrap failed:", error);
        toast.error(t("error.generic"));
      } finally {
        if (!cancelled) setBooted(true);
      }
    };
    void boot();
    return () => {
      cancelled = true;
    };
    // Boot exactly once; the stores are singletons.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Surface chat errors once per occurrence, wherever they were triggered.
  React.useEffect(() => {
    const unsubscribe = useChatsStore.subscribe((state, previous) => {
      if (state.error && state.error !== previous.error) {
        toast.error(localizeError(state.error.message, t));
      }
    });
    return unsubscribe;
  }, [t]);

  // Optional background health checks.
  React.useEffect(() => {
    if (!booted || settings.autoPingMinutes <= 0) return;
    const ping = () => {
      const store = useProvidersStore.getState();
      if (store.providers.some((provider) => provider.enabled)) {
        void store.pingAll().catch(() => undefined);
      }
    };
    const first = window.setTimeout(ping, 1500);
    const interval = window.setInterval(ping, settings.autoPingMinutes * 60_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(interval);
    };
  }, [booted, settings.autoPingMinutes]);

  // Global keyboard shortcuts. They stay out of the way when a dialog has focus
  // because every dialog traps focus and stops propagation on its own layer.
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      const current = useSettingsStore.getState().settings;

      if (key === "k" && !event.shiftKey) {
        event.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (key === "o" && event.shiftKey) {
        event.preventDefault();
        void createChat().then(() => setView("chat"));
        return;
      }
      if (key === "/") {
        event.preventDefault();
        setView("chat");
        requestComposerFocus();
        return;
      }
      if (key === "m" && !event.shiftKey) {
        event.preventDefault();
        setModelPickerOpen(true);
        return;
      }
      if (key === "b" && !event.shiftKey) {
        event.preventDefault();
        if (window.innerWidth < 1024) setSidebarMobileOpen(true);
        else void update({ sidebarCollapsed: !current.sidebarCollapsed });
        return;
      }
      if (key === "p" && event.shiftKey) {
        event.preventDefault();
        if (window.innerWidth >= 1280) void update({ rightPanelOpen: !current.rightPanelOpen });
        else setMobilePanelOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    createChat,
    requestComposerFocus,
    setMobilePanelOpen,
    setModelPickerOpen,
    setSearchOpen,
    setSidebarMobileOpen,
    setView,
    update,
  ]);

  // Resolve "system" the same way applyDocumentTheme does.
  const lightBackground =
    settings.theme === "light" ||
    (settings.theme === "system" &&
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-color-scheme: light)").matches === true);
  const accent = useAccent();
  const backgroundPalette = lightBackground
    ? {
        ground: "#ffffff",
        flow: accent === "ember" ? "#e0531a" : "#3d46e8",
        hot: accent === "ember" ? "#ffa066" : "#a8c0ff",
        text: "#171923",
      }
    : accent === "ember"
      ? "ember"
      : "cobalt";
  const showBackground = settings.showBackground ? (
    <div
      aria-hidden="true"
      data-slot="warp-backdrop"
      className={cn(
        "pointer-events-none fixed inset-0 z-0 overflow-hidden transition-opacity duration-[1200ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
        inConversation ? "opacity-[0.12] dark:opacity-[0.08]" : "opacity-80 dark:opacity-70",
      )}
    >
      <HalftoneFlowHero palette={backgroundPalette} height="100%" backgroundOnly />
    </div>
  ) : null;

  return (
    <>
      {booted && authReady ? (
        showLogin ? (
          <div className="relative min-h-dvh w-full">
            <SmokeLogin onGoogleSignIn={googleSignIn} />
            <button
              type="button"
              onClick={closeAuthGate}
              className="absolute start-3 top-3 z-20 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[12px] font-medium text-white/70 backdrop-blur transition-colors hover:bg-white/10 hover:text-white focus-visible:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40"
            >
              <ArrowLeft className="size-3.5 rtl:rotate-180" />
              {t("common.back")}
            </button>
            <button
              type="button"
              onClick={closeAuthGate}
              className="absolute inset-x-0 bottom-4 z-10 mx-auto w-fit px-3 py-1 text-[12px] text-white/55 underline underline-offset-4 transition-colors hover:text-white/85 focus-visible:text-white focus-visible:outline-none"
            >
              {t("auth.guestContinue")}
            </button>
          </div>
        ) : (
        <div
          className={cn(
            "relative flex h-dvh w-full overflow-hidden bg-[var(--background)] text-foreground",
          )}
        >
          {showBackground}

          <div className="relative z-10 flex min-w-0 flex-1 flex-col">
            <TopBar />
            <div className="flex min-h-0 flex-1">
              <main
                className={cn(
                  "relative flex min-h-0 min-w-0 flex-1 flex-col",
                  // Chat pads itself inside the scroller so messages slide under
                  // the header (and the blur); the provider page is a normal
                  // scroller and just needs the header height reserved.
                  view === "providers" && "pt-[var(--header-h)]",
                )}
                aria-label={view === "chat" ? t("nav.chats") : t("providers.title")}
              >
                {view === "chat" ? (
                  <ChatView />
                ) : (
                  <React.Suspense fallback={null}>
                    <ProvidersPage />
                  </React.Suspense>
                )}
                <HeaderBlur />
              </main>
              {view === "chat" ? <RightPanel /> : null}
            </div>
          </div>

          <React.Suspense fallback={null}>
            {showSearch ? <SearchDialog /> : null}
            {showPalette ? <CommandPalette /> : null}
            {showModelPicker ? <ModelPicker /> : null}
            {showWizard ? <ProviderWizard /> : null}
            {showSettings ? <SettingsDialog /> : null}
            {showAuth ? <AuthPanel /> : null}
          </React.Suspense>
          <UnlockGate />

          <Toaster
            theme={settings.theme === "light" ? "light" : "dark"}
            position="bottom-right"
            closeButton
            richColors
            toastOptions={{
              classNames: {
                toast: "font-sans",
              },
            }}
            visibleToasts={4}
          />

          {locked ? <div className="sr-only" aria-live="polite">{t("settings.lockedBadge")}</div> : null}
        </div>
        )
      ) : null}

      {!introDone ? <GlassIntro ready={booted} onFinish={() => setIntroDone(true)} /> : null}
    </>
  );
}
