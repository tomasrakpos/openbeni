// settings feature: SettingsDialog; change its UI/flow here and keep related state/API calls in sync.
import {
  Activity,
  CheckCircle2,
  Download,
  KeyRound,
  Loader2,
  Lock,
  MessageSquare,
  Network,
  Plus,
  Server,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { GlowButton } from "@/components/ui/glow-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { clearAllData, db } from "@/db";
import { downloadJson, settingsExportPayload, type SettingsExport } from "@/lib/export";
import { useT } from "@/lib/i18n";
import { uid } from "@/lib/id";
import { useAuthStore } from "@/stores/auth";
import { useChatsStore } from "@/stores/chats";
import { useProvidersStore } from "@/stores/providers";
import { useSettingsStore } from "@/stores/settings";
import { useUiStore } from "@/stores/ui";
import type { Settings } from "@/lib/types";

/** Exact same frame material as ProviderWizard for visual consistency. */
const FRAME: React.CSSProperties = {
  border: "1px solid var(--border-strong)",
  background:
    "linear-gradient(180deg,color-mix(in oklab,var(--foreground) 6%,transparent),color-mix(in oklab,var(--foreground) 1.5%,transparent)),var(--surface-1)",
  boxShadow:
    "inset 0 1px 0 var(--glass-inner-top,rgba(255,255,255,.14)),0 24px 48px color-mix(in oklab,hsl(var(--shadow-color,0 0% 0%)) 55%,transparent)",
};

const CSS = `
.stg-head{display:flex;align-items:center;gap:14px;flex:none;padding:20px 22px 16px}
.stg-badge{display:grid;place-items:center;width:48px;height:48px;flex:none;border-radius:15px;color:var(--primary);background:color-mix(in oklab,var(--primary) 14%,var(--surface-1));box-shadow:inset 0 0 0 1px color-mix(in oklab,var(--primary) 26%,transparent)}
.stg-ttl{flex:1;min-width:0}
.stg-title{margin:0;font-size:19px;font-weight:600;letter-spacing:-.01em;color:var(--foreground)}
.stg-sub{margin:2px 0 0;font-size:12.5px;color:var(--muted-foreground)}
.stg-x{display:grid;place-items:center;width:38px;height:38px;flex:none;border-radius:12px;border:1px solid var(--border-strong);background:color-mix(in oklab,var(--foreground) 5%,transparent);color:var(--foreground);cursor:pointer;transition:background .15s}
.stg-x:hover{background:color-mix(in oklab,var(--foreground) 10%,transparent)}
.stg-tabs{flex:none;padding:0 22px 14px;border-bottom:1px solid var(--border)}
.stg-main{flex:1 1 auto;min-height:0;overflow-y:auto;padding:18px 22px;scrollbar-width:thin;scrollbar-color:var(--border-strong) transparent}
.stg-card{border-radius:18px;border:1px solid var(--border);background:color-mix(in oklab,var(--foreground) 3%,transparent);padding:14px 16px}
.stg-stat{border-radius:14px;border:1px solid var(--border);background:color-mix(in oklab,var(--foreground) 3.5%,transparent);padding:10px 8px;text-align:center}
.stg-foot{display:flex;align-items:center;justify-content:flex-end;gap:10px;flex:none;padding:14px 22px 22px;border-top:1px solid var(--border)}
@media(max-width:560px){
  .stg-head{gap:10px;padding:14px 16px 12px}
  .stg-badge{width:38px;height:38px;border-radius:12px}
  .stg-title{font-size:16.5px}
  .stg-sub{font-size:11.5px}
  .stg-x{width:32px;height:32px;border-radius:10px}
  .stg-tabs{padding:0 16px 12px}
  .stg-main{padding:14px 16px}
  .stg-card{border-radius:15px;padding:12px 13px}
  .stg-foot{padding:12px 16px calc(16px + env(safe-area-inset-bottom,0px))}
}
`;

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="stg-card">
      <header className="mb-3">
        <h3 className="text-[13px] font-semibold text-foreground">{title}</h3>
        {description ? (
          <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--muted-foreground)]">{description}</p>
        ) : null}
      </header>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-[12px]">{label}</Label>
      {children}
      {hint ? <p className="text-[10.5px] leading-relaxed text-[var(--faint)]">{hint}</p> : null}
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[12.5px] font-medium text-foreground">{label}</p>
        {description ? (
          <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--muted-foreground)]">{description}</p>
        ) : null}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
  );
}

export function SettingsDialog() {
  const t = useT();
  const open = useUiStore((s) => s.settingsOpen);
  const setOpen = useUiStore((s) => s.setSettingsOpen);
  const setView = useUiStore((s) => s.setView);
  const setAuthOpen = useUiStore((s) => s.setAuthOpen);
  const setAuthGateOpen = useUiStore((s) => s.setAuthGateOpen);

  const signedIn = useAuthStore((s) => s.signedIn);

  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const vaultMode = useSettingsStore((s) => s.vaultMode);
  const enableEncryption = useSettingsStore((s) => s.enableEncryption);
  const disableEncryption = useSettingsStore((s) => s.disableEncryption);
  const lock = useSettingsStore((s) => s.lock);

  const providers = useProvidersStore((s) => s.providers);
  const models = useProvidersStore((s) => s.models);
  const createProvider = useProvidersStore((s) => s.createProvider);
  const addModels = useProvidersStore((s) => s.addModels);
  const pingAll = useProvidersStore((s) => s.pingAll);

  const chats = useChatsStore((s) => s.chats);
  const loadChats = useChatsStore((s) => s.load);

  const [draft, setDraft] = React.useState({
    proxyUrl: settings.proxyUrl,
    autoPingMinutes: settings.autoPingMinutes,
    temperature: settings.temperature,
    topP: settings.topP,
    maxTokens: settings.maxTokens,
    showBackground: settings.showBackground,
    showReasoning: settings.showReasoning,
    rightPanelOpen: settings.rightPanelOpen,
  });
  const [presets, setPresets] = React.useState(settings.systemPresets);
  const [presetName, setPresetName] = React.useState("");
  const [presetPrompt, setPresetPrompt] = React.useState("");
  const [passphrase, setPassphrase] = React.useState("");
  const [confirmPassphrase, setConfirmPassphrase] = React.useState("");
  const [passBusy, setPassBusy] = React.useState(false);
  const [passError, setPassError] = React.useState<string | null>(null);
  const [pinging, setPinging] = React.useState(false);
  const [exportingChats, setExportingChats] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const [clearChatsOpen, setClearChatsOpen] = React.useState(false);
  const [resetOpen, setResetOpen] = React.useState(false);
  const importRef = React.useRef<HTMLInputElement>(null);

  const isFa = settings.lang === "fa";

  React.useEffect(() => {
    if (!open) return;
    setDraft({
      proxyUrl: settings.proxyUrl,
      autoPingMinutes: settings.autoPingMinutes,
      temperature: settings.temperature,
      topP: settings.topP,
      maxTokens: settings.maxTokens,
      showBackground: settings.showBackground,
      showReasoning: settings.showReasoning,
      rightPanelOpen: settings.rightPanelOpen,
    });
    setPresets(settings.systemPresets);
    setPassphrase("");
    setConfirmPassphrase("");
    setPassError(null);
    // Reset only when the dialog opens; settings update while typing must not clobber the draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const save = async () => {
    await update({ ...draft, systemPresets: presets });
    toast.success(t("settings.saved"));
    setOpen(false);
  };

  const addPreset = async () => {
    if (!presetName.trim() || !presetPrompt.trim()) return;
    const next = [...presets, { id: uid("preset"), name: presetName.trim(), prompt: presetPrompt.trim() }];
    setPresets(next);
    setPresetName("");
    setPresetPrompt("");
    await update({ systemPresets: next });
  };

  const removePreset = async (id: string) => {
    const next = presets.filter((preset) => preset.id !== id);
    setPresets(next);
    await update({ systemPresets: next });
  };

  const runPingAll = async () => {
    setPinging(true);
    try {
      await pingAll();
      toast.success(isFa ? "بررسی اتصال پرووایدرها انجام شد" : "Provider health check completed");
    } catch {
      toast.error(t("toast.failed"));
    } finally {
      setPinging(false);
    }
  };

  const exportSettings = async () => {
    const payload = settingsExportPayload(
      { ...settings, ...draft, systemPresets: presets },
      providers,
      models,
    );
    await downloadJson(payload, `openharneks-settings-${new Date().toISOString().slice(0, 10)}.json`);
    toast.success(t("settings.exported"));
  };

  const exportAllChats = async () => {
    setExportingChats(true);
    try {
      const [allChats, allMessages] = await Promise.all([db.chats.toArray(), db.messages.toArray()]);
      const payload = {
        format: "apiset-pro-chats-backup",
        version: 1,
        exportedAt: new Date().toISOString(),
        chats: allChats,
        messages: allMessages,
      };
      await downloadJson(payload, `openharneks-chats-${new Date().toISOString().slice(0, 10)}.json`);
      toast.success(t("toast.exported"));
    } catch {
      toast.error(t("toast.failed"));
    } finally {
      setExportingChats(false);
    }
  };

  const importSettings = async (file: File) => {
    setImporting(true);
    try {
      const payload = JSON.parse(await file.text()) as SettingsExport;
      if (payload.format !== "apiset-pro-settings") {
        toast.error(t("toast.failed"));
        return;
      }
      if (payload.settings) {
        await update(payload.settings as Partial<Settings>);
      }
      const idMap = new Map<string, string>();
      for (const provider of payload.providers ?? []) {
        const existing = providers.find(
          (item) => item.baseUrl === provider.baseUrl && item.name === provider.name,
        );
        if (existing) {
          idMap.set(provider.id, existing.id);
          continue;
        }
        const created = await createProvider(provider);
        idMap.set(provider.id, created.id);
      }
      for (const model of payload.models ?? []) {
        const providerId = idMap.get(model.providerId);
        if (!providerId) continue;
        await addModels(providerId, [
          {
            modelId: model.modelId,
            displayName: model.displayName,
            contextWindow: model.contextWindow,
            pricing: model.pricing,
            capabilities: model.capabilities,
            tier: model.tier,
            source: "preset",
          },
        ]);
      }
      toast.success(t("settings.imported"));
    } catch {
      toast.error(t("toast.failed"));
    } finally {
      setImporting(false);
    }
  };

  const enablePass = async () => {
    setPassError(null);
    if (passphrase.length < 8) {
      setPassError(t("settings.passphraseShort"));
      return;
    }
    if (passphrase !== confirmPassphrase) {
      setPassError(t("settings.passphraseMismatch"));
      return;
    }
    setPassBusy(true);
    try {
      await enableEncryption(passphrase);
      setPassphrase("");
      setConfirmPassphrase("");
      toast.success(t("settings.passphraseSet"));
    } catch {
      toast.error(t("toast.failed"));
    } finally {
      setPassBusy(false);
    }
  };

  const disablePass = async () => {
    setPassBusy(true);
    try {
      await disableEncryption();
      toast.success(t("settings.saved"));
    } catch {
      toast.error(t("toast.failed"));
    } finally {
      setPassBusy(false);
    }
  };

  const visibleProvidersCount = providers.filter((p) => !p.bundled).length;

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          hideClose
          rise
          dir="ltr"
          style={FRAME}
          className="flex max-h-[88dvh] flex-col gap-0 overflow-hidden rounded-t-[24px] p-0 sm:max-h-[84vh] sm:w-[min(620px,calc(100vw-2rem))] sm:max-w-none sm:rounded-[28px]"
        >
          <style>{CSS}</style>

          <div className="stg-head">
            <span className="stg-badge" aria-hidden="true">
              <Settings2 size={20} />
            </span>
            <div className="stg-ttl">
              <DialogTitle className="stg-title">{t("settings.title")}</DialogTitle>
              <DialogDescription className="stg-sub">
                {isFa ? "تنظیمات گفتگو، اتصال و حریم خصوصی" : "Chat defaults, connection, and privacy"}
              </DialogDescription>
            </div>
            <button
              type="button"
              className="stg-x"
              onClick={() => setOpen(false)}
              aria-label={t("common.close")}
            >
              <X size={18} />
            </button>
          </div>

          <Tabs defaultValue="chat" className="flex min-h-0 flex-1 flex-col">
            <div className="stg-tabs">
              <TabsList className="w-full sm:w-auto">
                <TabsTrigger value="chat" className="flex-1 sm:flex-none">
                  <SlidersHorizontal />
                  <span>{isFa ? "گفتگو" : "Chat"}</span>
                </TabsTrigger>
                <TabsTrigger value="network" className="flex-1 sm:flex-none">
                  <Network />
                  <span>{isFa ? "سرویس و شبکه" : "Network"}</span>
                </TabsTrigger>
                <TabsTrigger value="privacy" className="flex-1 sm:flex-none">
                  <ShieldCheck />
                  <span>{isFa ? "امنیت و داده" : "Data"}</span>
                </TabsTrigger>
              </TabsList>
            </div>

            <div className="stg-main">
              <TabsContent value="chat" className="space-y-3">
                <Section title={t("settings.chatDefaults")}>
                  <ToggleRow
                    label={t("settings.reasoning")}
                    description={t("settings.reasoningDesc")}
                    checked={draft.showReasoning}
                    onChange={(value) => {
                      setDraft((current) => ({ ...current, showReasoning: value }));
                      void update({ showReasoning: value });
                    }}
                  />
                  <ToggleRow
                    label={t("palette.togglePanel")}
                    description={
                      isFa
                        ? "نمایش پیش‌نمایش زنده و فایل‌ها کنار گفتگو"
                        : "Show the live preview panel beside chats."
                    }
                    checked={draft.rightPanelOpen}
                    onChange={(value) => {
                      setDraft((current) => ({ ...current, rightPanelOpen: value }));
                      void update({ rightPanelOpen: value });
                    }}
                  />
                  <ToggleRow
                    label={t("settings.background")}
                    description={t("settings.backgroundDesc")}
                    checked={draft.showBackground}
                    onChange={(value) => {
                      setDraft((current) => ({ ...current, showBackground: value }));
                      void update({ showBackground: value });
                    }}
                  />

                  <div className="h-px bg-[var(--border)]" />

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <Label className="text-[12px]">{t("settings.temperature")}</Label>
                        <span className="font-mono text-[11.5px] text-[var(--muted-foreground)]">
                          {draft.temperature.toFixed(2)}
                        </span>
                      </div>
                      <Slider
                        value={[draft.temperature]}
                        min={0}
                        max={2}
                        step={0.05}
                        onValueChange={([value]) =>
                          setDraft((current) => ({ ...current, temperature: value ?? 0.7 }))
                        }
                        aria-label={t("settings.temperature")}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <Label className="text-[12px]">{t("settings.topP")}</Label>
                        <span className="font-mono text-[11.5px] text-[var(--muted-foreground)]">
                          {draft.topP.toFixed(2)}
                        </span>
                      </div>
                      <Slider
                        value={[draft.topP]}
                        min={0.05}
                        max={1}
                        step={0.01}
                        onValueChange={([value]) => setDraft((current) => ({ ...current, topP: value ?? 1 }))}
                        aria-label={t("settings.topP")}
                      />
                    </div>
                  </div>

                  <Field label={t("settings.maxTokens")}>
                    <Input
                      value={String(draft.maxTokens)}
                      onChange={(event) => {
                        const value = Number(event.target.value.replace(/[^0-9]/g, ""));
                        setDraft((current) => ({ ...current, maxTokens: value || 1 }));
                      }}
                      inputMode="numeric"
                      className="h-10 rounded-[12px] font-mono"
                    />
                  </Field>
                </Section>

                <Section title={t("chat.systemPresets")}>
                  {presets.length > 0 ? (
                    <ul className="space-y-1.5">
                      {presets.map((preset) => (
                        <li
                          key={preset.id}
                          className="flex items-start gap-2 rounded-[12px] border border-[var(--border)] bg-[var(--surface-2)]/40 px-3 py-2"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[12px] font-medium text-foreground">
                              {preset.name}
                            </span>
                            <span className="mt-0.5 line-clamp-1 block text-[10.5px] text-[var(--faint)]">
                              {preset.prompt}
                            </span>
                          </span>
                          <button
                            type="button"
                            onClick={() => void removePreset(preset.id)}
                            aria-label={`${t("common.delete")} ${preset.name}`}
                            className="grid size-6 shrink-0 place-items-center rounded-[7px] text-[var(--faint)] hover:bg-[var(--destructive-soft)] hover:text-[var(--destructive)]"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="grid gap-2 rounded-[14px] border border-dashed border-[var(--border-strong)] p-3">
                    <Input
                      value={presetName}
                      onChange={(event) => setPresetName(event.target.value)}
                      placeholder={t("common.name")}
                      className="h-9 rounded-[11px] text-[12.5px]"
                    />
                    <Textarea
                      value={presetPrompt}
                      onChange={(event) => setPresetPrompt(event.target.value)}
                      placeholder={t("chat.systemPromptPlaceholder")}
                      rows={2}
                      className="rounded-[11px] text-[12.5px]"
                    />
                    <Button
                      size="xs"
                      variant="secondary"
                      onClick={() => void addPreset()}
                      disabled={!presetName.trim() || !presetPrompt.trim()}
                    >
                      <Plus className="size-3" /> {t("common.add")}
                    </Button>
                  </div>
                </Section>
              </TabsContent>

              <TabsContent value="network" className="space-y-3">
                <Section
                  title={isFa ? "وضعیت سرویس و دسترسی سریع" : "Workspace & health"}
                  description={
                    isFa
                      ? "تست اتصال پرووایدرها و دسترسی سریع به مدل‌ها و کلیدهای API"
                      : "Test provider connectivity and jump straight to models or API tokens."
                  }
                >
                  <div className="grid grid-cols-3 gap-2">
                    <div className="stg-stat">
                      <div className="font-mono text-[15px] font-semibold text-foreground">{chats.length}</div>
                      <div className="text-[10.5px] text-[var(--muted-foreground)]">{t("nav.chats")}</div>
                    </div>
                    <div className="stg-stat">
                      <div className="font-mono text-[15px] font-semibold text-foreground">
                        {visibleProvidersCount}
                      </div>
                      <div className="text-[10.5px] text-[var(--muted-foreground)]">{t("nav.providers")}</div>
                    </div>
                    <div className="stg-stat">
                      <div className="font-mono text-[15px] font-semibold text-foreground">{models.length}</div>
                      <div className="text-[10.5px] text-[var(--muted-foreground)]">
                        {isFa ? "مدل‌ها" : "Models"}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onClick={() => void runPingAll()} disabled={pinging}>
                      {pinging ? <Loader2 className="size-3.5 animate-spin" /> : <Activity className="size-3.5" />}
                      {t("palette.pingAll")}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setOpen(false);
                        setView("providers");
                      }}
                    >
                      <Server className="size-3.5" /> {t("palette.providers")}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setOpen(false);
                        if (signedIn) setAuthOpen(true);
                        else setAuthGateOpen(true);
                      }}
                    >
                      <KeyRound className="size-3.5" /> {t("auth.tokensTitle")}
                    </Button>
                  </div>
                </Section>

                <Section title={t("settings.network")}>
                  <div className="grid gap-1.5">
                    <Label className="text-[12px]">{t("settings.autoPing")}</Label>
                    <Tabs
                      value={String(draft.autoPingMinutes)}
                      onValueChange={(value) => {
                        const minutes = Number(value);
                        setDraft((current) => ({ ...current, autoPingMinutes: minutes }));
                        void update({ autoPingMinutes: minutes });
                      }}
                    >
                      <TabsList className="w-full">
                        <TabsTrigger value="0" className="flex-1">
                          {isFa ? "خاموش" : "Off"}
                        </TabsTrigger>
                        <TabsTrigger value="5" className="flex-1">
                          5m
                        </TabsTrigger>
                        <TabsTrigger value="15" className="flex-1">
                          15m
                        </TabsTrigger>
                        <TabsTrigger value="30" className="flex-1">
                          30m
                        </TabsTrigger>
                        <TabsTrigger value="60" className="flex-1">
                          60m
                        </TabsTrigger>
                      </TabsList>
                    </Tabs>
                  </div>

                  <Field label={t("settings.proxy")}>
                    <Input
                      value={draft.proxyUrl}
                      onChange={(event) => setDraft((current) => ({ ...current, proxyUrl: event.target.value }))}
                      placeholder="https://..."
                      spellCheck={false}
                      dir="ltr"
                      className="h-10 rounded-[12px] font-mono text-[12.5px]"
                    />
                  </Field>
                </Section>
              </TabsContent>

              <TabsContent value="privacy" className="space-y-3">
                <Section title={t("settings.encryption")}>
                  <div className="flex items-center justify-between gap-2 rounded-[12px] border border-[var(--border)] bg-[var(--surface-2)]/40 px-3 py-2.5">
                    <span className="inline-flex min-w-0 items-center gap-2 text-[12px] text-foreground">
                      <KeyRound className="size-3.5 shrink-0 text-[var(--primary)]" />
                      <span className="truncate">
                        {vaultMode === "passphrase" ? t("settings.encryptionPass") : t("settings.encryptionDevice")}
                      </span>
                    </span>
                  </div>

                  {vaultMode === "device" ? (
                    <div className="space-y-2.5">
                      <Field label={t("settings.passphrase")} hint={t("settings.passphraseShort")}>
                        <Input
                          type="password"
                          value={passphrase}
                          onChange={(event) => setPassphrase(event.target.value)}
                          autoComplete="new-password"
                          className="h-10 rounded-[12px] font-mono"
                        />
                      </Field>
                      <Field label={t("settings.passphraseConfirm")}>
                        <Input
                          type="password"
                          value={confirmPassphrase}
                          onChange={(event) => setConfirmPassphrase(event.target.value)}
                          autoComplete="new-password"
                          className="h-10 rounded-[12px] font-mono"
                        />
                      </Field>
                      {passError ? (
                        <p role="alert" className="text-[11.5px] text-[var(--destructive)]">
                          {passError}
                        </p>
                      ) : null}
                      <Button size="sm" onClick={() => void enablePass()} disabled={passBusy || !passphrase}>
                        {passBusy ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />}
                        {t("settings.enablePassphrase")}
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setOpen(false);
                            lock();
                          }}
                        >
                          <Lock className="size-3.5" /> {t("settings.lock")}
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => void disablePass()} disabled={passBusy}>
                          {passBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                          {t("settings.disablePassphrase")}
                        </Button>
                      </div>
                    </div>
                  )}
                </Section>

                <Section title={t("settings.data")} description={t("settings.exportNote")}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="secondary" onClick={() => void exportSettings()}>
                      <Download className="size-3.5" /> {t("settings.exportSettings")}
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => importRef.current?.click()} disabled={importing}>
                      {importing ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
                      {t("settings.importSettings")}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void exportAllChats()}
                      disabled={exportingChats || chats.length === 0}
                    >
                      {exportingChats ? <Loader2 className="size-3.5 animate-spin" /> : <MessageSquare className="size-3.5" />}
                      {isFa ? "پشتیبان همه‌ی گفتگوها" : "Backup all chats"}
                    </Button>
                    <input
                      ref={importRef}
                      type="file"
                      accept="application/json,.json"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (file) void importSettings(file);
                      }}
                    />
                  </div>

                  <div className="h-px bg-[var(--border)]" />

                  <div className="space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[11.5px] text-[var(--muted-foreground)]">
                        {isFa
                          ? "پاک کردن تاریخچه‌ی گفتگوها بدون حذف پرووایدرها و کلیدها"
                          : "Clear all chats while keeping providers, keys, and settings."}
                      </p>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setClearChatsOpen(true)}
                        disabled={chats.length === 0}
                      >
                        <Trash2 className="size-3.5" /> {isFa ? "پاک کردن گفتگوها" : "Clear chats"}
                      </Button>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[11.5px] text-[var(--muted-foreground)]">{t("settings.resetDesc")}</p>
                      <Button variant="destructive" size="sm" onClick={() => setResetOpen(true)}>
                        <Trash2 className="size-3.5" /> {t("settings.reset")}
                      </Button>
                    </div>
                  </div>
                </Section>
              </TabsContent>
            </div>
          </Tabs>

          <div className="stg-foot">
            <GlowButton variant="secondary" size="sm" onClick={() => setOpen(false)}>
              {t("common.close")}
            </GlowButton>
            <GlowButton size="sm" onClick={() => void save()}>
              {t("settings.save")}
            </GlowButton>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={clearChatsOpen}
        onOpenChange={setClearChatsOpen}
        title={isFa ? "پاک کردن همه‌ی گفتگوها" : "Clear all chats"}
        description={
          isFa
            ? "تمام گفتگوها و پیام‌های محلی پاک می‌شوند، اما پرووایدرها، کلیدها و تنظیمات شما حفظ می‌شوند."
            : "All local chats and messages will be deleted, while your providers, API keys, and settings stay intact."
        }
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        destructive
        onConfirm={async () => {
          await clearAllData();
          await loadChats();
          setClearChatsOpen(false);
          toast.success(isFa ? "همه‌ی گفتگوها پاک شدند" : "All chats cleared");
        }}
      />

      <ConfirmDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        title={t("settings.reset")}
        description={t("settings.resetConfirm")}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        destructive
        onConfirm={async () => {
          await db.delete();
          window.location.reload();
        }}
      />
    </>
  );
}
