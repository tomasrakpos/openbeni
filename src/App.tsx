// App bootstrap: change app mounting and top-level view selection here.
import * as React from "react";
import { Toaster, toast } from "sonner";
import { ChatView } from "@/app/ChatView";
import { resetProvidersOnce } from "@/db/defaults";
import HalftoneFlowHero from "@/components/ui/halftone-flow-hero";
import { ArrowLeft } from "lucide-react";
import { GlassIntro } from "@/features/intro/GlassIntro";
import { HeaderBlur } from "@/features/layout/HeaderBlur";
import { MobilePreviewPager } from "@/features/layout/MobilePreviewPager";
import { TopBar } from "@/features/layout/TopBar";
import { UnlockGate } from "@/features/settings/UnlockGate";
import { localizeError } from "@/lib/errors";
import {
  loadAuthPanel,
  loadCommandPalette,
  loadModelPicker,
  loadProvidersPage,
  loadProviderWizard,
  loadRightPanel,
  loadRightPanelBody,
  loadSearchDialog,
  loadSettingsDialog,
  loadSmokeLogin,
  startBackgroundPreload,
} from "@/lib/preload";
import { useAccent } from "@/lib/useAccent";
import { useIsDesktopPanel } from "@/lib/useMediaQuery";
import { useDocumentLanguage, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useChatsStore, activeThread, isChatPreviewAvailable } from "@/stores/chats";
import { useAuthStore } from "@/stores/auth";
import { useCatalogStore } from "@/stores/catalog";
import { useRoutersStore } from "@/stores/routers";
import { useProvidersStore } from "@/stores/providers";
import { useSettingsStore } from "@/stores/settings";
import { useUiStore } from "@/stores/ui";

// Heavy, on-demand surfaces stay out of the entry chunk, and startBackgroundPreload()
// warms them right after first paint so opening any section feels instant.
const CommandPalette = React.lazy(loadCommandPalette);
const SearchDialog = React.lazy(loadSearchDialog);
const ModelPicker = React.lazy(loadModelPicker);
const ProvidersPage = React.lazy(loadProvidersPage);
const ProviderWizard = React.lazy(loadProviderWizard);
const SettingsDialog = React.lazy(loadSettingsDialog);
const AuthPanel = React.lazy(loadAuthPanel);
const SmokeLogin = React.lazy(loadSmokeLogin);
const RightPanel = React.lazy(loadRightPanel);
const RightPanelBody = React.lazy(loadRightPanelBody);

const INTRO_SEEN_KEY = "openharness.intro.seen";

function hasSeenIntroThisSession(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.sessionStorage.getItem(INTRO_SEEN_KEY) === "1") return true;
  } catch {
    // Fall back to window.name when sessionStorage is blocked (e.g. sandboxed iframe).
  }
  try {
    return typeof window.name === "string" && window.name.includes(INTRO_SEEN_KEY);
  } catch {
    return false;
  }
}

function markIntroSeenThisSession(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(INTRO_SEEN_KEY, "1");
  } catch {
    // Ignore storage errors; window.name fallback below still covers reloads in this tab.
  }
  try {
    if (typeof window.name === "string" && !window.name.includes(INTRO_SEEN_KEY)) {
      window.name = window.name ? `${window.name}|${INTRO_SEEN_KEY}` : INTRO_SEEN_KEY;
    }
  } catch {
    // Ignore window.name access errors.
  }
}

function ViewLoadingFallback() {
  return (
    <div
      className="flex flex-1 items-center justify-center p-8"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="size-6 animate-spin rounded-full border-2 border-[var(--border)] border-t-foreground/80" />
    </div>
  );
}

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
  const startNewChat = useChatsStore((s) => s.startNewChat);

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
  const mobilePanelOpen = useUiStore((s) => s.mobilePanelOpen);
  const isDesktopPanel = useIsDesktopPanel();

  const showSearch = useLatched(searchOpen);
  const showPalette = useLatched(paletteOpen);
  const showModelPicker = useLatched(modelPickerOpen);
  const showWizard = useLatched(wizardOpen);
  const showSettings = useLatched(settingsOpen);
  const showAuth = useLatched(authOpen);
  const showRightPanel = useLatched(settings.rightPanelOpen, mobilePanelOpen);

  const signedIn = useAuthStore((s) => s.signedIn);
  const authGateOpen = useUiStore((s) => s.authGateOpen);
  const setAuthGateOpen = useUiStore((s) => s.setAuthGateOpen);
  // The app opens straight onto the main screen: signing up is a step the
  // visitor can take from the menu whenever they want, not a gate in front of
  // the product. The page also never shows for a signed-in visitor.
  const showLogin = !signedIn && authGateOpen;
  const closeAuthGate = React.useCallback(() => setAuthGateOpen(false), [setAuthGateOpen]);
  const googleSignIn = React.useCallback(async () => {
    const wasSignedIn = useAuthStore.getState().signedIn;
    await useAuthStore.getState().signInWithGoogle();
    if (!wasSignedIn && useAuthStore.getState().signedIn) {
      setAuthGateOpen(false);
      toast.success(t("auth.welcomeCreditsToast"));
    }
  }, [setAuthGateOpen, t]);

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
  const activeChat = React.useMemo(
    () => chats.find((item) => item.id === activeChatId) ?? null,
    [chats, activeChatId],
  );
  // The colorful background belongs to the landing state. As soon as a real
  // conversation exists it settles into a dark, quiet canvas behind the thread,
  // which keeps the text readable and the glass composer calm.
  const inConversation = React.useMemo(
    () => view === "chat" && activeThread(messages, activeChat).length > 0,
    [messages, activeChat, view],
  );
  const previewAvailable = React.useMemo(
    () => view === "chat" && isChatPreviewAvailable(activeChat, messages),
    [view, activeChat, messages],
  );

  React.useEffect(() => {
    if ((isDesktopPanel || !previewAvailable) && mobilePanelOpen) {
      setMobilePanelOpen(false);
    }
  }, [isDesktopPanel, previewAvailable, mobilePanelOpen, setMobilePanelOpen]);

  const [booted, setBooted] = React.useState(false);
  // The glass intro plays once per browser tab session; reloads or redirects
  // within the same tab skip it until the user closes and reopens the site.
  const [introDone, setIntroDone] = React.useState(hasSeenIntroThisSession);
  React.useEffect(() => {
    if (!introDone) markIntroSeenThisSession();
  }, [introDone]);
  const finishIntro = React.useCallback(() => {
    markIntroSeenThisSession();
    setIntroDone(true);
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    const stopPreload = startBackgroundPreload();

    // Start remote auth + catalog hydration in parallel without blocking local
    // IndexedDB boot or initial paint.
    void useAuthStore
      .getState()
      .init()
      .then(() => {
        if (!cancelled) {
          useCatalogStore.getState().init();
          void useRoutersStore.getState().hydrate();
        }
      })
      .catch(() => {
        if (!cancelled) {
          useCatalogStore.getState().init();
          void useRoutersStore.getState().hydrate();
        }
      });

    const boot = async () => {
      try {
        await Promise.all([
          loadSettings(),
          // One-time wipe: every provider is removed and nothing is seeded back,
          // so a fresh browser and an existing one both start with an empty list.
          resetProvidersOnce().then(() => loadProviders()),
          loadChats(),
        ]);
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
      stopPreload();
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
        startNewChat();
        setView("chat");
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
        const chatState = useChatsStore.getState();
        const currentChat = chatState.chats.find((c) => c.id === chatState.activeChatId) ?? null;
        if (!isChatPreviewAvailable(currentChat, chatState.messages)) return;
        if (window.innerWidth >= 1280) void update({ rightPanelOpen: !current.rightPanelOpen });
        else setMobilePanelOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    startNewChat,
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
      {booted ? (
        showLogin ? (
          <div className="relative min-h-dvh w-full">
            <React.Suspense fallback={<ViewLoadingFallback />}>
              <SmokeLogin onGoogleSignIn={googleSignIn} />
            </React.Suspense>
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

          {!isDesktopPanel ? (
            <MobilePreviewPager
              enabled={view === "chat" && previewAvailable}
              open={mobilePanelOpen}
              onOpenChange={setMobilePanelOpen}
              dir="ltr"
              main={
                <>
                  <TopBar />
                  <div className="flex min-h-0 flex-1">
                    <main
                      className={cn(
                        "relative flex min-h-0 min-w-0 flex-1 flex-col",
                        view === "providers" && "pt-[calc(var(--header-h)+36px)]",
                      )}
                      aria-label={view === "chat" ? t("nav.chats") : t("providers.title")}
                    >
                      {view === "chat" ? (
                        <ChatView />
                      ) : (
                        <React.Suspense fallback={<ViewLoadingFallback />}>
                          <ProvidersPage />
                        </React.Suspense>
                      )}
                      <HeaderBlur />
                    </main>
                  </div>
                </>
              }
              preview={
                <React.Suspense fallback={<ViewLoadingFallback />}>
                  <RightPanelBody mode="mobile" />
                </React.Suspense>
              }
            />
          ) : (
            <div className="relative z-10 flex min-w-0 flex-1 flex-col">
              <TopBar />
              <div className="flex min-h-0 flex-1">
                <main
                  className={cn(
                    "relative flex min-h-0 min-w-0 flex-1 flex-col",
                    // Chat pads itself inside the scroller so messages slide under
                    // the header (and the blur); the provider page is a normal
                    // scroller and just needs the header height reserved.
                    view === "providers" && "pt-[calc(var(--header-h)+36px)]",
                  )}
                  aria-label={view === "chat" ? t("nav.chats") : t("providers.title")}
                >
                  {view === "chat" ? (
                    <ChatView />
                  ) : (
                    <React.Suspense fallback={<ViewLoadingFallback />}>
                      <ProvidersPage />
                    </React.Suspense>
                  )}
                  <HeaderBlur />
                </main>
                {previewAvailable && showRightPanel ? (
                  <React.Suspense fallback={null}>
                    <RightPanel />
                  </React.Suspense>
                ) : null}
              </div>
            </div>
          )}

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

      {!introDone ? <GlassIntro ready={booted} onFinish={finishIntro} /> : null}
    </>
  );
}
