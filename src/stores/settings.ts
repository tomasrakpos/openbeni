// App state settings; change state/actions here and keep local persistence in sync.
import { create } from "zustand";
import { loadSettings, saveSettings } from "@/db";
import {
  disablePassphrase,
  enablePassphrase,
  initVault,
  lockVault,
  subscribeVault,
  unlockVault,
  vaultStatus,
} from "@/db/vault";
import type { Settings } from "@/lib/types";

type Theme = Settings["theme"];

function resolvedTheme(theme: Theme): "dark" | "light" {
  if (theme === "system") {
    return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return theme;
}

export function applyDocumentTheme(settings: Settings): void {
  if (typeof document === "undefined") return;
  const theme = resolvedTheme(settings.theme);
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.dataset.theme = theme;
  root.lang = settings.lang;
  root.dir = "ltr";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "dark" ? "#0b0716" : "#f6f7fb");
}

interface SettingsState {
  settings: Settings;
  ready: boolean;
  locked: boolean;
  vaultMode: "device" | "passphrase";
  error?: string;
  load: () => Promise<void>;
  update: (patch: Partial<Settings>) => Promise<void>;
  setTheme: (theme: Theme) => Promise<void>;
  toggleTheme: () => Promise<void>;
  toggleLang: () => Promise<void>;
  unlock: (passphrase: string) => Promise<boolean>;
  lock: () => void;
  enableEncryption: (passphrase: string) => Promise<void>;
  disableEncryption: () => Promise<void>;
}

let mediaListenerAttached = false;

export const useSettingsStore = create<SettingsState>()((set, get) => ({
  settings: {
    theme: "dark",
    lang: "en",
    showBackground: true,
    proxyUrl: "",
    autoPingMinutes: 0,
    sidebarCollapsed: false,
    rightPanelOpen: true,
    temperature: 0.7,
    topP: 1,
    maxTokens: 4096,
    systemPresets: [],
    encryption: "device",
    onboardingDone: false,
    showReasoning: true,
  },
  ready: false,
  locked: false,
  vaultMode: "device",

  load: async () => {
    const settings = await loadSettings();
    applyDocumentTheme(settings);
    set({ settings, ready: true });
    const status = await initVault(settings.encryption);
    set({ locked: status.locked, vaultMode: status.mode });
    subscribeVault(() => {
      const next = vaultStatus();
      set({ locked: next.locked, vaultMode: next.mode });
    });
    if (!mediaListenerAttached && typeof window !== "undefined") {
      mediaListenerAttached = true;
      window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
        const current = get().settings;
        if (current.theme === "system") applyDocumentTheme(current);
      });
    }
  },

  update: async (patch) => {
    const next = { ...get().settings, ...patch };
    applyDocumentTheme(next);
    set({ settings: next });
    await saveSettings(next);
  },

  setTheme: async (theme) => {
    await get().update({ theme });
  },

  toggleTheme: async () => {
    const current = get().settings.theme;
    await get().update({ theme: resolvedTheme(current) === "dark" ? "light" : "dark" });
  },

  toggleLang: async () => {
    await get().update({ lang: get().settings.lang === "fa" ? "en" : "fa" });
  },

  unlock: async (passphrase) => {
    const salt = get().settings.kdfSalt;
    if (!salt) {
      set({ error: "settings.incorrectPassphrase" });
      return false;
    }
    const ok = await unlockVault(passphrase, salt);
    if (!ok) {
      set({ error: "settings.incorrectPassphrase" });
      return false;
    }
    set({ locked: false, error: undefined });
    return true;
  },

  lock: () => {
    lockVault();
    set({ locked: true });
  },

  enableEncryption: async (passphrase) => {
    const { salt } = await enablePassphrase(passphrase);
    await get().update({ encryption: "passphrase", kdfSalt: salt });
    set({ locked: false, vaultMode: "passphrase" });
  },

  disableEncryption: async () => {
    await disablePassphrase();
    await get().update({ encryption: "device" });
    set({ locked: false, vaultMode: "device" });
  },
}));
