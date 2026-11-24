// Shared lazy-module loaders with memoized preloading so heavy surfaces stay out
// of the initial bundle yet open instantaneously on first click.

function once<T>(loader: () => Promise<T>): () => Promise<T> {
  let promise: Promise<T> | null = null;
  return () => {
    if (!promise) {
      promise = loader().catch((error) => {
        promise = null;
        throw error;
      });
    }
    return promise;
  };
}

export const loadProvidersPage = once(() =>
  import("@/features/providers/ProvidersPage").then((m) => ({ default: m.ProvidersPage })),
);

export const loadProviderWizard = once(() =>
  import("@/features/providers/ProviderWizard").then((m) => ({ default: m.ProviderWizard })),
);

export const loadSettingsDialog = once(() =>
  import("@/features/settings/SettingsDialog").then((m) => ({ default: m.SettingsDialog })),
);

export const loadModelPicker = once(() =>
  import("@/features/models/ModelPicker").then((m) => ({ default: m.ModelPicker })),
);

export const loadSearchDialog = once(() =>
  import("@/features/layout/SearchDialog").then((m) => ({ default: m.SearchDialog })),
);

export const loadCommandPalette = once(() =>
  import("@/features/layout/CommandPalette").then((m) => ({ default: m.CommandPalette })),
);

export const loadAuthPanel = once(() =>
  import("@/features/auth/AuthPanel").then((m) => ({ default: m.AuthPanel })),
);

export const loadSmokeLogin = once(() =>
  import("@/components/ui/smoke-login").then((m) => ({ default: m.SmokeLogin })),
);

export const loadChatSettingsDialog = once(() =>
  import("@/features/chat/ChatSettingsDialog").then((m) => ({ default: m.ChatSettingsDialog })),
);

export const loadRightPanel = once(() =>
  import("@/features/layout/RightPanel").then((m) => ({ default: m.RightPanel })),
);

export const loadRightPanelBody = once(() =>
  import("@/features/layout/RightPanel").then((m) => ({ default: m.RightPanelBody })),
);

export const loadMessageItem = once(() =>
  import("@/features/chat/MessageItem").then((m) => ({ default: m.MessageItem })),
);

export const loadThreadComposer = once(() =>
  import("@/features/chat/ThreadComposer").then((m) => ({ default: m.ThreadComposer })),
);

export const loadHalftoneFlowHero = once(() =>
  import("@/components/ui/halftone-flow-hero"),
);

export const loadGlassIntro = once(() =>
  import("@/features/intro/GlassIntro").then((m) => ({ default: m.GlassIntro })),
);

type IdleHandle = number;

function scheduleIdle(cb: () => void, timeoutMs: number): () => void {
  const win = window as Window & {
    requestIdleCallback?: (fn: () => void, opts?: { timeout: number }) => IdleHandle;
    cancelIdleCallback?: (handle: IdleHandle) => void;
  };
  if (typeof win.requestIdleCallback === "function") {
    const id = win.requestIdleCallback(cb, { timeout: timeoutMs });
    return () => win.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(cb, Math.min(timeoutMs, 400));
  return () => window.clearTimeout(id);
}

function isConstrainedNetwork(): boolean {
  const nav = navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string };
  };
  const conn = nav.connection;
  if (!conn) return false;
  if (conn.saveData) return true;
  return conn.effectiveType === "slow-2g" || conn.effectiveType === "2g";
}

/**
 * Waits until the initial page has finished loading and settled, then gently
 * warms only the most likely next-click chunks during browser idle time so
 * first-load bandwidth and main-thread CPU are never contested.
 */
export function startBackgroundPreload(): () => void {
  if (typeof window === "undefined") return () => undefined;

  let cancelled = false;
  let timer1: number | null = null;
  let cancelIdle1: (() => void) | null = null;
  let cancelIdle2: (() => void) | null = null;

  const begin = () => {
    if (cancelled || isConstrainedNetwork()) return;
    timer1 = window.setTimeout(() => {
      if (cancelled) return;
      cancelIdle1 = scheduleIdle(() => {
        if (cancelled) return;
        // Wave 1: lightweight surfaces a first-time visitor is most likely to open.
        void Promise.allSettled([loadModelPicker(), loadSettingsDialog(), loadAuthPanel()]).then(
          () => {
            if (cancelled) return;
            cancelIdle2 = scheduleIdle(() => {
              if (cancelled) return;
              // Wave 2: chat message renderer ready right before their first send.
              void Promise.allSettled([loadThreadComposer(), loadMessageItem()]);
            }, 3000);
          },
        );
      }, 2000);
    }, 2200);
  };

  const onLoad = () => begin();
  if (document.readyState === "complete") {
    begin();
  } else {
    window.addEventListener("load", onLoad, { once: true });
  }

  return () => {
    cancelled = true;
    window.removeEventListener("load", onLoad);
    if (timer1 !== null) window.clearTimeout(timer1);
    cancelIdle1?.();
    cancelIdle2?.();
  };
}
