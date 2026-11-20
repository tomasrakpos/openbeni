// App state ui; change state/actions here and keep local persistence in sync.
import { create } from "zustand";

export type View = "chat" | "providers";
export type RightTab = "preview" | "files" | "versions";
export type PreviewDevice = "desktop" | "tablet" | "mobile";

interface UiState {
  view: View;
  paletteOpen: boolean;
  wizardOpen: boolean;
  wizardProviderId: string | null;
  settingsOpen: boolean;
  chatSettingsOpen: boolean;
  authOpen: boolean;
  /** The Google sign-up page, shown on demand over the app. */
  authGateOpen: boolean;
  searchOpen: boolean;
  modelPickerOpen: boolean;
  providerPanelOpen: boolean;
  rightTab: RightTab;
  previewDevice: PreviewDevice;
  sidebarMobileOpen: boolean;
  mobilePanelOpen: boolean;
  focusComposer: number;
  setView: (view: View) => void;
  setPaletteOpen: (open: boolean) => void;
  openWizard: (providerId?: string) => void;
  closeWizard: () => void;
  setSettingsOpen: (open: boolean) => void;
  setChatSettingsOpen: (open: boolean) => void;
  setAuthOpen: (open: boolean) => void;
  setAuthGateOpen: (open: boolean) => void;
  setSearchOpen: (open: boolean) => void;
  setModelPickerOpen: (open: boolean) => void;
  setProviderPanelOpen: (open: boolean) => void;
  setRightTab: (tab: RightTab) => void;
  setPreviewDevice: (device: PreviewDevice) => void;
  setSidebarMobileOpen: (open: boolean) => void;
  setMobilePanelOpen: (open: boolean) => void;
  requestComposerFocus: () => void;
}

export const useUiStore = create<UiState>()((set) => ({
  view: "chat",
  paletteOpen: false,
  wizardOpen: false,
  wizardProviderId: null,
  settingsOpen: false,
  chatSettingsOpen: false,
  authOpen: false,
  authGateOpen: false,
  searchOpen: false,
  modelPickerOpen: false,
  providerPanelOpen: false,
  rightTab: "preview",
  previewDevice: "desktop",
  sidebarMobileOpen: false,
  mobilePanelOpen: false,
  focusComposer: 0,
  setView: (view) => set({ view }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  openWizard: (providerId) => set({ wizardOpen: true, wizardProviderId: providerId ?? null }),
  closeWizard: () => set({ wizardOpen: false, wizardProviderId: null }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setChatSettingsOpen: (chatSettingsOpen) => set({ chatSettingsOpen }),
  setAuthOpen: (authOpen) => set({ authOpen }),
  setAuthGateOpen: (authGateOpen) => set({ authGateOpen }),
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  setModelPickerOpen: (modelPickerOpen) => set({ modelPickerOpen }),
  setProviderPanelOpen: (providerPanelOpen) => set({ providerPanelOpen }),
  setRightTab: (rightTab) => set({ rightTab }),
  setPreviewDevice: (previewDevice) => set({ previewDevice }),
  setSidebarMobileOpen: (sidebarMobileOpen) => set({ sidebarMobileOpen }),
  setMobilePanelOpen: (mobilePanelOpen) => set({ mobilePanelOpen }),
  requestComposerFocus: () => set((state) => ({ focusComposer: state.focusComposer + 1 })),
}));
