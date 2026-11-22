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
  const id = window.setTimeout(cb, Math.min(timeoutMs, 180));
  return () => window.clearTimeout(id);
}

/**
 * Warms the primary navigation surfaces right after first paint (while the
 * entrance finishes), then warms secondary dialogs and chat rendering chunks
 * during idle time so first-click navigation is instant everywhere.
 */
export function startBackgroundPreload(): () => void {
  if (typeof window === "undefined") return () => undefined;

  let cancelled = false;
  let cancelWave2: (() => void) | null = null;

  // Wave 1: highest-priority surfaces visitors open right away.
  const wave1Timer = window.setTimeout(() => {
    if (cancelled) return;
    void Promise.allSettled([
      loadProvidersPage(),
      loadSettingsDialog(),
      loadProviderWizard(),
      loadModelPicker(),
    ]).then(() => {
      if (cancelled) return;
      // Wave 2: remaining interactive surfaces + active-conversation chunks.
      cancelWave2 = scheduleIdle(() => {
        if (cancelled) return;
        void Promise.allSettled([
          loadSearchDialog(),
          loadCommandPalette(),
          loadChatSettingsDialog(),
          loadAuthPanel(),
          loadMessageItem(),
          loadThreadComposer(),
          loadRightPanel(),
        ]);
      }, 900);
    });
  }, 60);

  return () => {
    cancelled = true;
    window.clearTimeout(wave1Timer);
    cancelWave2?.();
  };
}
