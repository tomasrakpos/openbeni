// settings feature: SettingsDialog; change its UI/flow here and keep related state/API calls in sync.
import {
  CheckCircle2,
  Database,
  Download,
  Info,
  KeyRound,
  Loader2,
  Lock,
  Network,
  Palette,
  Plus,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Upload,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { db } from "@/db";
import { CoarenaPoolStatus } from "@/features/settings/CoarenaPoolStatus";
import { downloadJson, settingsExportPayload, type SettingsExport } from "@/lib/export";
import { useT } from "@/lib/i18n";
import { uid } from "@/lib/id";
import { cn } from "@/lib/utils";
import { useProvidersStore } from "@/stores/providers";
import { useSettingsStore } from "@/stores/settings";
import { useUiStore } from "@/stores/ui";
import type { Settings } from "@/lib/types";

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
    <section className="rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)] p-3.5">
      <header className="mb-3">
        <h3 className="text-[12.5px] font-semibold text-foreground">{title}</h3>
        {description ? (
          <p className="mt-0.5 text-[10.5px] leading-relaxed text-[var(--muted-foreground)]">{description}</p>
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
      <Label className="text-[11.5px]">{label}</Label>
      {children}
      {hint ? <p className="text-[10px] leading-relaxed text-[var(--faint)]">{hint}</p> : null}
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
        <p className="text-[11.5px] font-medium text-foreground">{label}</p>
        {description ? <p className="mt-0.5 text-[10px] leading-relaxed text-[var(--muted-foreground)]">{description}</p> : null}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
  );
}

export function SettingsDialog() {
  const t = useT();
  const open = useUiStore((s) => s.settingsOpen);
  const setOpen = useUiStore((s) => s.setSettingsOpen);

  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const toggleTheme = useSettingsStore((s) => s.toggleTheme);
  const vaultMode = useSettingsStore((s) => s.vaultMode);
  const enableEncryption = useSettingsStore((s) => s.enableEncryption);
  const disableEncryption = useSettingsStore((s) => s.disableEncryption);
  const lock = useSettingsStore((s) => s.lock);

  const providers = useProvidersStore((s) => s.providers);
  const models = useProvidersStore((s) => s.models);
  const createProvider = useProvidersStore((s) => s.createProvider);
  const addModels = useProvidersStore((s) => s.addModels);

  const [draft, setDraft] = React.useState({
    proxyUrl: settings.proxyUrl,
    autoPingMinutes: settings.autoPingMinutes,
    temperature: settings.temperature,
    topP: settings.topP,
    maxTokens: settings.maxTokens,
    showBackground: settings.showBackground,
    showReasoning: settings.showReasoning,
  });
  const [presets, setPresets] = React.useState(settings.systemPresets);
  const [presetName, setPresetName] = React.useState("");
  const [presetPrompt, setPresetPrompt] = React.useState("");
  const [passphrase, setPassphrase] = React.useState("");
  const [confirmPassphrase, setConfirmPassphrase] = React.useState("");
  const [passBusy, setPassBusy] = React.useState(false);
  const [passError, setPassError] = React.useState<string | null>(null);
  const [importing, setImporting] = React.useState(false);
  const [resetOpen, setResetOpen] = React.useState(false);
  const importRef = React.useRef<HTMLInputElement>(null);

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

  const exportSettings = async () => {
    const payload = settingsExportPayload(
      { ...settings, ...draft, systemPresets: presets },
      providers,
      models,
    );
    downloadJson(payload, `openharneks-settings-${new Date().toISOString().slice(0, 10)}.json`);
    toast.success(t("settings.exported"));
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

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent frame className="flex max-h-[92dvh] flex-col gap-0 overflow-hidden p-0 sm:max-h-[86vh]">
          <DialogHeader className="shrink-0 border-b border-[var(--border)] px-4 py-3.5 pr-12 sm:px-5">
            <DialogTitle className="flex items-center gap-2">
              <Settings2 className="size-4 text-[var(--primary)]" />
              {t("settings.title")}
            </DialogTitle>
            <DialogDescription>{t("settings.aboutBody")}</DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="appearance" className="flex min-h-0 flex-1 flex-col">
            <div className="shrink-0 overflow-x-auto border-b border-[var(--border)] px-3 py-2 sm:px-4">
              <TabsList className="h-8 w-max">
                <TabsTrigger value="appearance">
                  <Palette /> {t("settings.appearance")}
                </TabsTrigger>
                <TabsTrigger value="chat">
                  <SlidersHorizontal /> {t("settings.chatDefaults")}
                </TabsTrigger>
                <TabsTrigger value="network">
                  <Network /> {t("settings.network")}
                </TabsTrigger>
                <TabsTrigger value="security">
                  <ShieldCheck /> {t("settings.security")}
                </TabsTrigger>
                <TabsTrigger value="data">
                  <Database /> {t("settings.data")}
                </TabsTrigger>
                <TabsTrigger value="about">
                  <Info /> {t("settings.about")}
                </TabsTrigger>
              </TabsList>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
              <TabsContent value="appearance" className="space-y-3">
                <Section title={t("settings.theme")} description={t("settings.backgroundDesc")}>
                  <div className="grid grid-cols-3 gap-2">
                    {(
                      [
                        { value: "dark", label: t("settings.dark") },
                        { value: "light", label: t("settings.light") },
                        { value: "system", label: t("settings.system") },
                      ] as const
                    ).map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => void update({ theme: option.value })}
                        aria-pressed={settings.theme === option.value}
                        className={cn(
                          "flex h-16 flex-col items-center justify-center gap-1.5 rounded-[11px] border text-[11.5px] font-medium transition-colors",
                          settings.theme === option.value
                            ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary)]"
                            : "border-[var(--border)] bg-[var(--surface-2)]/50 text-[var(--muted-foreground)] hover:border-[var(--border-strong)] hover:text-foreground",
                        )}
                      >
                        <span
                          className={cn(
                            "h-5 w-8 rounded-[5px] border",
                            option.value === "dark"
                              ? "border-white/15 bg-[#0a0c12]"
                              : option.value === "light"
                                ? "border-black/10 bg-white"
                                : "border-[var(--border)] bg-[linear-gradient(110deg,#0a0c12_50%,#ffffff_50%)]",
                          )}
                        />
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-[11.5px]">{t("settings.language")}</Label>
                    <Select value={settings.lang} onValueChange={(value) => void update({ lang: value as "en" | "fa" })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="en">{t("settings.english")}</SelectItem>
                        <SelectItem value="fa">{t("settings.persian")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <ToggleRow
                    label={t("settings.background")}
                    description={t("settings.backgroundDesc")}
                    checked={draft.showBackground}
                    onChange={(value) => {
                      setDraft((current) => ({ ...current, showBackground: value }));
                      void update({ showBackground: value });
                    }}
                  />
                  <ToggleRow
                    label={t("settings.reasoning")}
                    description={t("settings.reasoningDesc")}
                    checked={draft.showReasoning}
                    onChange={(value) => {
                      setDraft((current) => ({ ...current, showReasoning: value }));
                      void update({ showReasoning: value });
                    }}
                  />
                  <div className="flex items-center justify-between gap-2 rounded-[10px] border border-[var(--border)] bg-[var(--surface-2)]/40 px-2.5 py-2">
                    <span className="inline-flex items-center gap-1.5 text-[10.5px] text-[var(--muted-foreground)]">
                      <Palette className="size-3" /> {t("palette.toggleTheme")}
                    </span>
                    <Button size="xs" variant="secondary" onClick={() => void toggleTheme()}>
                      {t("palette.toggleTheme")}
                    </Button>
                  </div>
                </Section>
              </TabsContent>

              <TabsContent value="chat" className="space-y-3">
                <Section title={t("settings.chatDefaults")} description={t("chat.params")}>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-[11.5px]">{t("settings.temperature")}</Label>
                      <span className="font-mono text-[11px] text-[var(--muted-foreground)]">
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
                      <Label className="text-[11.5px]">{t("settings.topP")}</Label>
                      <span className="font-mono text-[11px] text-[var(--muted-foreground)]">{draft.topP.toFixed(2)}</span>
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
                  <Field label={t("settings.maxTokens")}>
                    <Input
                      value={String(draft.maxTokens)}
                      onChange={(event) => {
                        const value = Number(event.target.value.replace(/[^0-9]/g, ""));
                        setDraft((current) => ({ ...current, maxTokens: value || 1 }));
                      }}
                      inputMode="numeric"
                      className="font-mono"
                    />
                  </Field>
                </Section>

                <Section title={t("chat.systemPresets")} description={t("chat.systemPromptPlaceholder")}>
                  <ul className="space-y-1">
                    {presets.map((preset) => (
                      <li
                        key={preset.id}
                        className="flex items-start gap-2 rounded-[9px] border border-[var(--border)] bg-[var(--surface-2)]/40 px-2.5 py-1.5"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[11.5px] font-medium text-foreground">{preset.name}</span>
                          <span className="mt-0.5 line-clamp-1 block text-[10px] text-[var(--faint)]">{preset.prompt}</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => void removePreset(preset.id)}
                          aria-label={`${t("common.delete")} ${preset.name}`}
                          className="grid size-6 shrink-0 place-items-center rounded-[6px] text-[var(--faint)] hover:bg-[var(--destructive-soft)] hover:text-[var(--destructive)]"
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </li>
                    ))}
                  </ul>
                  <div className="grid gap-2 rounded-[10px] border border-dashed border-[var(--border-strong)] p-2.5">
                    <Input
                      value={presetName}
                      onChange={(event) => setPresetName(event.target.value)}
                      placeholder={t("common.name")}
                      className="h-8 text-[12px]"
                    />
                    <Textarea
                      value={presetPrompt}
                      onChange={(event) => setPresetPrompt(event.target.value)}
                      placeholder={t("chat.systemPromptPlaceholder")}
                      rows={2}
                      className="text-[12px]"
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
                <Section title={t("settings.network")} description={t("settings.proxyDesc")}>
                  <Field label={t("settings.proxy")} hint={t("providers.proxyNotice")}>
                    <Input
                      value={draft.proxyUrl}
                      onChange={(event) => setDraft((current) => ({ ...current, proxyUrl: event.target.value }))}
                      placeholder="https://your-worker.workers.dev"
                      spellCheck={false}
                      className="font-mono text-[12px]"
                    />
                  </Field>
                  <Field label={t("settings.autoPing")}>
                    <Select
                      value={String(draft.autoPingMinutes)}
                      onValueChange={(value) =>
                        setDraft((current) => ({ ...current, autoPingMinutes: Number(value) }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">{t("providers.autoPingOff")}</SelectItem>
                        <SelectItem value="5">{t("providers.everyMinutes", { n: 5 })}</SelectItem>
                        <SelectItem value="15">{t("providers.everyMinutes", { n: 15 })}</SelectItem>
                        <SelectItem value="30">{t("providers.everyMinutes", { n: 30 })}</SelectItem>
                        <SelectItem value="60">{t("providers.everyMinutes", { n: 60 })}</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <p className="rounded-[9px] border border-[var(--border)] bg-[var(--surface-2)]/40 px-2.5 py-2 text-[10px] leading-relaxed text-[var(--muted-foreground)]">
                    {t("providers.proxyUrlMissing")}
                  </p>
                </Section>
                <Section title={t("settings.coarenaSection")} description={t("settings.coarenaSectionDesc")}>
                  <CoarenaPoolStatus />
                </Section>
              </TabsContent>

              <TabsContent value="security" className="space-y-3">
                <Section title={t("settings.encryption")} description={t("settings.encryptionDesc")}>
                  <div className="flex items-center justify-between gap-3 rounded-[10px] border border-[var(--border)] bg-[var(--surface-2)]/40 px-2.5 py-2">
                    <span className="inline-flex items-center gap-2 text-[11.5px] text-foreground">
                      <KeyRound className="size-3.5 text-[var(--primary)]" />
                      {vaultMode === "passphrase" ? t("settings.encryptionPass") : t("settings.encryptionDevice")}
                    </span>
                    <Badge variant={vaultMode === "passphrase" ? "free" : "default"}>
                      {vaultMode === "passphrase" ? "AES-GCM + PBKDF2" : "AES-GCM"}
                    </Badge>
                  </div>

                  {vaultMode === "device" ? (
                    <div className="space-y-2.5">
                      <Field label={t("settings.passphrase")} hint={t("settings.passphraseShort")}>
                        <Input
                          type="password"
                          value={passphrase}
                          onChange={(event) => setPassphrase(event.target.value)}
                          autoComplete="new-password"
                          className="font-mono"
                        />
                      </Field>
                      <Field label={t("settings.passphraseConfirm")}>
                        <Input
                          type="password"
                          value={confirmPassphrase}
                          onChange={(event) => setConfirmPassphrase(event.target.value)}
                          autoComplete="new-password"
                          className="font-mono"
                        />
                      </Field>
                      {passError ? (
                        <p role="alert" className="text-[11px] text-[var(--destructive)]">
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
                      <p className="flex items-start gap-1.5 rounded-[9px] bg-[var(--success-soft)] px-2.5 py-2 text-[10.5px] leading-relaxed text-[var(--success)]">
                        <CheckCircle2 className="mt-0.5 size-3 shrink-0" />
                        {t("settings.encryptionDesc")}
                      </p>
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
                <p className="rounded-[10px] border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-[10px] leading-relaxed text-[var(--faint)]">
                  {t("settings.keyStorage")}
                </p>
              </TabsContent>

              <TabsContent value="data" className="space-y-3">
                <Section title={t("settings.data")} description={t("settings.exportNote")}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="secondary" onClick={() => void exportSettings()}>
                      <Download className="size-3.5" /> {t("settings.exportSettings")}
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => importRef.current?.click()} disabled={importing}>
                      {importing ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
                      {t("settings.importSettings")}
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
                </Section>

                <Section title={t("settings.reset")} description={t("settings.resetDesc")}>
                  <Button variant="destructive" size="sm" onClick={() => setResetOpen(true)}>
                    <Trash2 className="size-3.5" /> {t("settings.reset")}
                  </Button>
                </Section>
              </TabsContent>

              <TabsContent value="about" className="space-y-3">
                <Section title={t("settings.about")} description={t("settings.aboutBody")}>
                  <dl className="grid grid-cols-2 gap-2">
                    <div className="rounded-[9px] border border-[var(--border)] bg-[var(--surface-2)]/40 px-2.5 py-2">
                      <dt className="text-[9.5px] uppercase tracking-[0.12em] text-[var(--faint)]">
                        {t("settings.version")}
                      </dt>
                      <dd className="mt-0.5 font-mono text-[11.5px] text-foreground">1.0.0</dd>
                    </div>
                    <div className="rounded-[9px] border border-[var(--border)] bg-[var(--surface-2)]/40 px-2.5 py-2">
                      <dt className="text-[9.5px] uppercase tracking-[0.12em] text-[var(--faint)]">
                        {t("providers.title")}
                      </dt>
                      <dd className="mt-0.5 font-mono text-[11.5px] text-foreground">
                        {providers.length} / {models.length}
                      </dd>
                    </div>
                  </dl>
                  <div className="space-y-1 text-[10.5px] leading-relaxed text-[var(--muted-foreground)]">
                    <p>{t("capture.local")} · {t("capture.private")}</p>
                    <p>{t("settings.keyStorage")}</p>
                  </div>
                </Section>
              </TabsContent>
            </div>
          </Tabs>

          <div className="flex shrink-0 items-center justify-between gap-2 border-t border-[var(--border)] bg-[var(--surface-1)] px-4 py-2.5 sm:px-5">
            <span className="hidden text-[10px] text-[var(--faint)] sm:inline">{t("settings.aboutBody")}</span>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                {t("common.close")}
              </Button>
              <Button size="sm" onClick={() => void save()}>
                {t("settings.save")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

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
