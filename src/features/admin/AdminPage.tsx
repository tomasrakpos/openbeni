// admin feature: AdminPage; change its UI/flow here and keep related state/API calls in sync.
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  FlaskConical,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Server,
  Settings2,
  ShieldAlert,
  Trash2,
  Users,
  XCircle,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { PROVIDER_PRESETS } from "@/data/presets";
import { apiFetch } from "@/lib/api";
import { devAdminPreview, disableDevAdminPreview } from "@/lib/devAdminMock";
import { useAdminT } from "@/features/admin/adminStrings";
import { formatTokens } from "@/lib/tokens";
import { cn } from "@/lib/utils";
import { useCatalogStore } from "@/stores/catalog";

type Tab = "providers" | "users" | "usage" | "settings";

interface AdminKey {
  id: string;
  label: string | null;
  enabled: boolean;
  status: "ok" | "cooling" | "disabled";
  cooldownUntil: string | null;
  failCount: number;
  lastError: string | null;
}

interface AdminProvider {
  id: string;
  name: string;
  base_url: string;
  api_format: string;
  enabled: boolean;
  keyCount: number;
  healthyKeys: number;
  keys: AdminKey[];
}

interface AdminModel {
  id: string;
  display_name: string;
  upstream_id: string;
  enabled: boolean;
  upstream_verified: boolean;
  context_window: number | null;
  paid?: boolean;
}

interface AdminUser {
  id: string;
  email: string;
  display_name: string | null;
  role: "user" | "admin";
  status: "active" | "blocked";
  daily_token_limit: number | null;
  monthly_token_limit: number | null;
  created_at: string;
  last_seen_at: string;
  totalTokens: number;
  requests: number;
}

interface UsageStats {
  days: number;
  totals: { requests: number; tokens: number; errors: number };
  daily: { date: string; input: number; output: number }[];
  byModel: { model: string; tokens: number; requests: number }[];
  byProvider: { provider: string; tokens: number; requests: number }[];
  topUsers: { userId: string; tokens: number; requests: number }[];
}

interface AppSettings {
  signup_open: boolean;
  default_daily_token_limit: number | null;
  default_monthly_token_limit: number | null;
}

interface CheckResult {
  ok: boolean;
  detail: string;
  latencyMs?: number;
}

export interface AdminDiagnostics {
  ok: boolean;
  authMode: string;
  checks: {
    adminAuth: CheckResult;
    database: CheckResult;
    encryption: CheckResult;
  };
  counts: { providers?: number; models?: number; enabledModels?: number };
  checkedAt: string;
}

function dateLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

const CARD = "rounded-[16px] border border-[var(--border)] bg-[var(--surface-glass)] backdrop-blur-xl";
const EMPTY_PROVIDER_FORM = {
  name: "",
  baseUrl: "",
  apiFormat: "openai",
  keys: "",
  authHeader: "Authorization",
  authPrefix: "Bearer ",
};

export function AdminPage({ initialDiagnostics }: { initialDiagnostics?: AdminDiagnostics } = {}) {
  const t = useAdminT();
  const [tab, setTab] = React.useState<Tab>("providers");

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "providers", label: t("admin.tabProviders"), icon: <Server className="size-3.5" /> },
    { id: "users", label: t("admin.tabUsers"), icon: <Users className="size-3.5" /> },
    { id: "usage", label: t("admin.tabUsage"), icon: <BarChart3 className="size-3.5" /> },
    { id: "settings", label: t("admin.tabSettings"), icon: <Settings2 className="size-3.5" /> },
  ];

  return (
    <div className="mx-auto w-full max-w-[1120px] px-4 pb-24 pt-[calc(var(--header-h)+20px)] sm:px-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-[22px] font-semibold tracking-[-0.02em]">
            <ShieldAlert className="size-5 text-[var(--primary)]" />
            {t("admin.title")}
          </h1>
          <p className="mt-1 text-[12.5px] text-[var(--muted-foreground)]">{t("admin.subtitle")}</p>
        </div>
      </header>

      <DiagnosticsStrip initial={initialDiagnostics} />

      {devAdminPreview() ? (
        <div className="mb-4 flex flex-wrap items-start gap-3 rounded-[14px] border border-[var(--warning)]/35 bg-[var(--warning-soft)] p-3">
          <FlaskConical className="mt-0.5 size-4 shrink-0 text-[var(--warning)]" />
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-medium text-[var(--warning)]">{t("admin.previewTitle")}</p>
            <p className="mt-0.5 text-[11.5px] leading-relaxed text-[var(--muted-foreground)]">
              {t("admin.previewNote")}
            </p>
          </div>
          <Button
            size="xs"
            variant="secondary"
            onClick={async () => {
              await disableDevAdminPreview();
              window.location.assign("/");
            }}
          >
            {t("admin.previewExit")}
          </Button>
        </div>
      ) : null}

      <div className="mb-5 flex flex-wrap gap-1 rounded-[13px] border border-[var(--border)] bg-[var(--surface-2)] p-1">        {tabs.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setTab(entry.id)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-[9px] px-3 text-[12.5px] font-medium transition-colors",
              tab === entry.id
                ? "bg-[var(--surface-1)] text-foreground shadow-sm"
                : "text-[var(--muted-foreground)] hover:text-foreground",
            )}
            aria-pressed={tab === entry.id}
          >
            {entry.icon}
            {entry.label}
          </button>
        ))}
      </div>

      {tab === "providers" ? <ProvidersTab /> : null}
      {tab === "users" ? <UsersTab /> : null}
      {tab === "usage" ? <UsageTab /> : null}
      {tab === "settings" ? <SettingsTab /> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Diagnostics                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Tiny end-to-end indicator: the browser reached `/api/admin/*`, the handler
 * reached Postgres, and provider-key encryption is configured. It is the same
 * check the deployment test asserts.
 */
function DiagnosticsStrip({ initial }: { initial?: AdminDiagnostics }) {
  const t = useAdminT();
  const [data, setData] = React.useState<AdminDiagnostics | null>(initial ?? null);
  const [loading, setLoading] = React.useState(!initial);
  const [error, setError] = React.useState<string | null>(null);

  const run = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await apiFetch<AdminDiagnostics>("/api/admin/diagnostics"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("admin.diagUnavailable"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  React.useEffect(() => {
    if (!initial) void run();
  }, [initial, run]);

  const pill = (label: string, check?: CheckResult, hint?: string) => {
    const ok = Boolean(check?.ok);
    return (
      <div className="flex min-w-0 items-center gap-2 rounded-[10px] border border-[var(--border)] bg-[var(--surface-1)] px-2.5 py-1.5">
        <span
          className={cn("size-1.5 shrink-0 rounded-full", ok ? "bg-[var(--success)]" : "bg-[var(--warning)]")}
          aria-hidden="true"
        />
        <span className="text-[11.5px] font-medium text-foreground">{label}</span>
        <span className="truncate text-[11px] text-[var(--muted-foreground)]">
          {check ? (ok ? t("admin.diagOk") : check.detail || t("admin.diagFailed")) : t("admin.diagMissing")}
          {ok && hint ? ` · ${hint}` : ""}
        </span>
      </div>
    );
  };

  const counts = data?.counts;
  const countsHint =
    counts && typeof counts.providers === "number"
      ? t("admin.diagCounts", {
          providers: counts.providers,
          models: counts.models ?? 0,
          enabled: counts.enabledModels ?? 0,
        })
      : undefined;

  return (
    <section
      aria-label={t("admin.diagTitle")}
      className="mb-4 flex flex-wrap items-center gap-2 rounded-[13px] border border-[var(--border)] bg-[var(--surface-glass)] p-2 backdrop-blur-xl"
    >
      <span className="pl-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--faint)]">
        {t("admin.diagTitle")}
      </span>
      {pill(t("admin.diagAdminAuth"), data?.checks.adminAuth)}
      {pill(t("admin.diagDatabase"), data?.checks.database, countsHint)}
      {pill(t("admin.diagEncryption"), data?.checks.encryption)}
      <div className="ml-auto flex items-center gap-2">
        {error ? (
          <span className="max-w-[240px] truncate text-[11px] text-[var(--warning)]" title={error}>
            {error}
          </span>
        ) : null}
        <Button size="xs" variant="ghost" onClick={() => void run()} disabled={loading}>
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          {loading ? t("admin.diagChecking") : t("admin.diagRefresh")}
        </Button>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Providers                                                                  */
/* -------------------------------------------------------------------------- */

function ProvidersTab() {
  const t = useAdminT();
  const refreshCatalog = useCatalogStore((s) => s.refresh);
  const [providers, setProviders] = React.useState<AdminProvider[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [models, setModels] = React.useState<Record<string, AdminModel[]>>({});
  const [testing, setTesting] = React.useState<string | null>(null);
  const [form, setForm] = React.useState({ ...EMPTY_PROVIDER_FORM });
  const [selectedPreset, setSelectedPreset] = React.useState("");
  const [creating, setCreating] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const data = await apiFetch<{ providers: AdminProvider[] }>("/api/admin/providers");
      setProviders(data.providers ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("error.generic"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const selectPreset = (id: string) => {
    setSelectedPreset(id);
    if (!id) return;

    const preset = PROVIDER_PRESETS.find((entry) => entry.id === id);
    if (form.keys.trim()) toast.message(t("admin.presetChangedKeysCleared"));
    if (preset) {
      setForm({
        ...EMPTY_PROVIDER_FORM,
        name: preset.name,
        baseUrl: preset.local ? "" : preset.baseUrl,
        apiFormat: preset.apiFormat,
        authHeader: preset.auth.header,
        authPrefix: preset.auth.prefix,
      });
      return;
    }

    if (id === "custom") {
      setForm({ ...EMPTY_PROVIDER_FORM, apiFormat: "custom" });
    }
  };

  const loadModels = async (providerId: string) => {
    try {
      const data = await apiFetch<{ models: AdminModel[] }>(`/api/admin/providers/${providerId}/models`);
      setModels((current) => ({ ...current, [providerId]: data.models ?? [] }));
    } catch {
      setModels((current) => ({ ...current, [providerId]: [] }));
    }
  };

  const createProvider = async () => {
    if (!form.name.trim() || !form.baseUrl.trim()) return;
    const keys = form.keys
      .split("\n")
      .map((entry) => entry.trim())
      .filter(Boolean);
    setCreating(true);
    try {
      await apiFetch("/api/admin/providers", {
        method: "POST",
        body: {
          name: form.name.trim(),
          baseUrl: form.baseUrl.trim(),
          apiFormat: form.apiFormat,
          authHeader: form.authHeader,
          authPrefix: form.authPrefix,
          keys,
        },
      });
      setForm({ ...EMPTY_PROVIDER_FORM });
      setSelectedPreset("");
      toast.success(t("admin.saved"));
      await load();
      void refreshCatalog();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("error.generic"));
    } finally {
      setCreating(false);
    }
  };

  const patchProvider = async (provider: AdminProvider, patch: Record<string, unknown>) => {
    setBusy(provider.id);
    try {
      await apiFetch(`/api/admin/providers/${provider.id}`, { method: "PATCH", body: patch });
      await load();
      void refreshCatalog();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("error.generic"));
    } finally {
      setBusy(null);
    }
  };

  const removeProvider = async (provider: AdminProvider) => {
    if (!window.confirm(t("admin.confirmDelete"))) return;
    setBusy(provider.id);
    try {
      await apiFetch(`/api/admin/providers/${provider.id}`, { method: "DELETE" });
      await load();
      void refreshCatalog();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("error.generic"));
    } finally {
      setBusy(null);
    }
  };

  const removeAllProviders = async () => {
    if (!window.confirm(t("admin.confirmDeleteAll"))) return;
    setBusy("all");
    try {
      await apiFetch("/api/admin/providers", { method: "DELETE" });
      setModels({});
      setExpanded(null);
      await load();
      void refreshCatalog();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("error.generic"));
    } finally {
      setBusy(null);
    }
  };

  const addKeys = async (provider: AdminProvider, raw: string) => {
    const keys = raw
      .split("\n")
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (keys.length === 0) {
      toast.error(t("admin.pasteKeys"));
      return;
    }
    setBusy(provider.id);
    try {
      await apiFetch(`/api/admin/providers/${provider.id}/keys`, { method: "POST", body: { keys } });
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("error.generic"));
    } finally {
      setBusy(null);
    }
  };

  const removeKey = async (provider: AdminProvider, keyId: string) => {
    setBusy(provider.id);
    try {
      await apiFetch(`/api/admin/providers/${provider.id}/keys/${keyId}`, { method: "DELETE" });
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("error.generic"));
    } finally {
      setBusy(null);
    }
  };

  const testProvider = async (provider: AdminProvider) => {
    setTesting(provider.id);
    try {
      const data = await apiFetch<{ tested: number; healthy: number; models: AdminModel[] }>(
        `/api/admin/providers/${provider.id}/test`,
        { method: "POST" },
      );
      setModels((current) => ({ ...current, [provider.id]: data.models ?? [] }));
      setExpanded(provider.id);
      toast.success(t("admin.testResult", { ok: data.healthy, total: data.tested }));
      await load();
      void refreshCatalog();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("error.generic"));
    } finally {
      setTesting(null);
    }
  };

  const toggleModel = async (providerId: string, model: AdminModel) => {
    try {
      await apiFetch(`/api/admin/models/${model.id}`, {
        method: "PATCH",
        body: { enabled: !model.enabled },
      });
      setModels((current) => ({
        ...current,
        [providerId]: (current[providerId] ?? []).map((entry) =>
          entry.id === model.id ? { ...entry, enabled: !entry.enabled } : entry,
        ),
      }));
      void refreshCatalog();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("error.generic"));
    }
  };

  const toggleModelPaid = async (providerId: string, model: AdminModel) => {
    const paid = !model.paid;
    try {
      await apiFetch(`/api/admin/models/${model.id}`, { method: "PATCH", body: { paid } });
      setModels((current) => ({
        ...current,
        [providerId]: (current[providerId] ?? []).map((entry) =>
          entry.id === model.id ? { ...entry, paid } : entry,
        ),
      }));
      void refreshCatalog();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("error.generic"));
    }
  };

  const renameModel = async (providerId: string, model: AdminModel, displayName: string) => {
    const clean = displayName.trim();
    if (!clean || clean === model.display_name) return;
    try {
      await apiFetch(`/api/admin/models/${model.id}`, { method: "PATCH", body: { displayName: clean } });
      setModels((current) => ({
        ...current,
        [providerId]: (current[providerId] ?? []).map((entry) =>
          entry.id === model.id ? { ...entry, display_name: clean } : entry,
        ),
      }));
      void refreshCatalog();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("error.generic"));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <section className={cn(CARD, "p-4")}>
        <h2 className="mb-3 flex items-center gap-2 text-[13px] font-semibold">
          <Plus className="size-4 text-[var(--primary)]" />
          {t("admin.addProvider")}
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5 sm:col-span-3">
            <Label htmlFor="admin-preset">{t("admin.providerPreset")}</Label>
            <select
              id="admin-preset"
              value={selectedPreset}
              onChange={(event) => selectPreset(event.target.value)}
              className="h-9 rounded-[10px] border border-[var(--border)] bg-[var(--surface-2)] px-2.5 text-[13px]"
            >
              <option value="">{t("admin.selectPreset")}</option>
              {PROVIDER_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
              <option value="custom">{t("admin.customProvider")}</option>
            </select>
            {selectedPreset === "ollama" && !form.baseUrl.trim() ? (
              <p className="text-[10.5px] text-[var(--warning)]">{t("admin.localProviderHint")}</p>
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="admin-name">{t("admin.providerName")}</Label>
            <Input
              id="admin-name"
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="OpenAI"
            />
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="admin-url">{t("admin.baseUrl")}</Label>
            <Input
              id="admin-url"
              value={form.baseUrl}
              onChange={(event) => setForm((current) => ({ ...current, baseUrl: event.target.value }))}
              placeholder="https://api.openai.com/v1"
              inputMode="url"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="admin-format">{t("admin.format")}</Label>
            <select
              id="admin-format"
              value={form.apiFormat}
              onChange={(event) => {
                const apiFormat = event.target.value;
                setForm((current) => ({
                  ...current,
                  apiFormat,
                  authHeader:
                    apiFormat === "anthropic"
                      ? "x-api-key"
                      : apiFormat === "gemini"
                        ? "x-goog-api-key"
                        : "Authorization",
                  authPrefix: apiFormat === "anthropic" || apiFormat === "gemini" ? "" : "Bearer ",
                }));
              }}
              className="h-9 rounded-[10px] border border-[var(--border)] bg-[var(--surface-2)] px-2.5 text-[13px]"
            >
              <option value="openai">OpenAI compatible</option>
              <option value="anthropic">Anthropic</option>
              <option value="gemini">Gemini</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="admin-keys">{t("admin.keys")}</Label>
            <textarea
              id="admin-keys"
              value={form.keys}
              onChange={(event) => setForm((current) => ({ ...current, keys: event.target.value }))}
              rows={3}
              autoComplete="off"
              spellCheck={false}
              className="rounded-[10px] border border-[var(--border)] bg-[var(--surface-2)] p-2.5 font-mono text-[12px]"
            />
            <p className="text-[10.5px] text-[var(--faint)]">{t("admin.keysHint")}</p>
          </div>
        </div>
        <div className="mt-3 flex justify-end">
          <Button size="sm" onClick={() => void createProvider()} disabled={creating}>
            {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            {t("admin.addProvider")}
          </Button>
        </div>
      </section>

      {loading ? (
        <div className="flex items-center gap-2 text-[12px] text-[var(--muted-foreground)]">
          <Loader2 className="size-4 animate-spin" />
          {t("common.loading")}
        </div>
      ) : providers.length === 0 ? (
        <p className={cn(CARD, "p-4 text-[12.5px] text-[var(--muted-foreground)]")}>{t("admin.seed")}</p>
      ) : (
        <>
          <div className="flex justify-end">
            <Button
              variant="destructive"
              size="sm"
              onClick={() => void removeAllProviders()}
              disabled={busy === "all"}
            >
              {busy === "all" ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
              {t("admin.deleteAllProviders")}
            </Button>
          </div>
          {providers.map((provider) => (
            <ProviderCard
              key={provider.id}
              provider={provider}
              models={models[provider.id]}
              busy={busy === provider.id}
              testing={testing === provider.id}
              expanded={expanded === provider.id}
              onExpand={() => {
                setExpanded((current) => (current === provider.id ? null : provider.id));
                if (!models[provider.id]) void loadModels(provider.id);
              }}
              onToggle={() => void patchProvider(provider, { enabled: !provider.enabled })}
              onRemove={() => void removeProvider(provider)}
              onTest={() => void testProvider(provider)}
              onAddKeys={(raw) => void addKeys(provider, raw)}
              onRemoveKey={(keyId) => void removeKey(provider, keyId)}
              onToggleModel={(model) => void toggleModel(provider.id, model)}
              onTogglePaid={(model) => void toggleModelPaid(provider.id, model)}
              onRenameModel={(model, name) => void renameModel(provider.id, model, name)}
            />
          ))}
        </>
      )}
    </div>
  );
}

function ProviderCard({
  provider,
  models,
  busy,
  testing,
  expanded,
  onExpand,
  onToggle,
  onRemove,
  onTest,
  onAddKeys,
  onRemoveKey,
  onToggleModel,
  onTogglePaid,
  onRenameModel,
}: {
  provider: AdminProvider;
  models?: AdminModel[];
  busy: boolean;
  testing: boolean;
  expanded: boolean;
  onExpand: () => void;
  onToggle: () => void;
  onRemove: () => void;
  onTest: () => void;
  onAddKeys: (raw: string) => void;
  onRemoveKey: (keyId: string) => void;
  onToggleModel: (model: AdminModel) => void;
  onTogglePaid: (model: AdminModel) => void;
  onRenameModel: (model: AdminModel, name: string) => void;
}) {
  const t = useAdminT();
  const [newKeys, setNewKeys] = React.useState("");

  return (
    <section className={cn(CARD, "overflow-hidden")}>
      <div className="flex flex-wrap items-center gap-3 p-4">
        <span
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-[11px] border border-[var(--border)]",
            provider.enabled ? "bg-[var(--primary)]/10 text-[var(--primary)]" : "text-[var(--faint)]",
          )}
        >
          <Server className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-medium">{provider.name}</p>
          <p className="truncate font-mono text-[10.5px] text-[var(--faint)]">{provider.base_url}</p>
        </div>
        <Badge variant={provider.healthyKeys > 0 ? "primary" : "unknown"}>
          <KeyRound className="size-3" />
          {t("admin.healthyKeys", { ok: provider.healthyKeys, total: provider.keyCount })}
        </Badge>
        <Badge variant="unknown">{provider.api_format}</Badge>
        <Switch checked={provider.enabled} onCheckedChange={onToggle} disabled={busy} aria-label={t("admin.enabled")} />
        <Button size="xs" variant="secondary" onClick={onTest} disabled={testing || busy}>
          {testing ? <Loader2 className="size-3.5 animate-spin" /> : <Activity className="size-3.5" />}
          {testing ? t("admin.testing") : t("admin.test")}
        </Button>
        <Button size="xs" variant="ghost" onClick={onExpand}>
          {t("admin.models")}
        </Button>
        <Button size="xs" variant="ghost" onClick={onRemove} disabled={busy} aria-label={t("admin.deleteProvider")}>
          <Trash2 className="size-3.5 text-[var(--destructive)]" />
        </Button>
      </div>

      {expanded ? (
        <div className="grid gap-4 border-t border-[var(--border)] p-4 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold">
              <KeyRound className="size-3.5" />
              {t("admin.keys")}
            </h3>
            {provider.keys.length === 0 ? (
              <p className="text-[11.5px] text-[var(--muted-foreground)]">{t("admin.noKeys")}</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {provider.keys.map((key, index) => (
                  <li
                    key={key.id}
                    className="flex items-center gap-2 rounded-[10px] border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1.5"
                  >
                    <span className="font-mono text-[11px] text-[var(--faint)]">#{index + 1}</span>
                    <span className="flex-1 truncate text-[11.5px]">
                      {key.label || `${t("admin.keyReady")} · ${key.id.slice(0, 6)}`}
                    </span>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px]",
                        key.status === "ok" && "bg-[var(--success)]/12 text-[var(--success)]",
                        key.status === "cooling" && "bg-[var(--destructive)]/12 text-[var(--destructive)]",
                        key.status === "disabled" && "bg-[var(--surface-3)] text-[var(--faint)]",
                      )}
                    >
                      {key.status === "ok" ? <CheckCircle2 className="size-3" /> : <XCircle className="size-3" />}
                      {key.status === "ok"
                        ? t("admin.keyReady")
                        : key.status === "cooling"
                          ? t("admin.cooldown")
                          : t("admin.keyDisabled")}
                    </span>
                    <button
                      type="button"
                      onClick={() => onRemoveKey(key.id)}
                      disabled={busy}
                      className="text-[var(--faint)] transition-colors hover:text-[var(--destructive)]"
                      aria-label={t("common.delete")}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-2.5 flex flex-col gap-1.5">
              <textarea
                value={newKeys}
                onChange={(event) => setNewKeys(event.target.value)}
                rows={2}
                placeholder={t("admin.newKeys")}
                autoComplete="off"
                spellCheck={false}
                className="rounded-[10px] border border-[var(--border)] bg-[var(--surface-2)] p-2 font-mono text-[11.5px]"
              />
              <Button
                size="xs"
                variant="secondary"
                className="self-start"
                disabled={busy}
                onClick={() => {
                  onAddKeys(newKeys);
                  setNewKeys("");
                }}
              >
                <Plus className="size-3.5" />
                {t("admin.addKey")}
              </Button>
            </div>
          </div>

          <div>
            <h3 className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold">
              <Server className="size-3.5" />
              {t("admin.models")}
            </h3>
            {!models || models.length === 0 ? (
              <p className="text-[11.5px] text-[var(--muted-foreground)]">{t("admin.noModels")}</p>
            ) : (
              <ul className="flex max-h-[280px] flex-col gap-1.5 overflow-auto pr-1">
                {models.map((model) => (
                  <li
                    key={model.id}
                    className="flex items-center gap-2 rounded-[10px] border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1.5"
                  >
                    <Switch
                      checked={model.enabled}
                      onCheckedChange={() => onToggleModel(model)}
                      aria-label={model.display_name}
                    />
                    <div className="min-w-0 flex-1">
                      <input
                        defaultValue={model.display_name}
                        onBlur={(event) => onRenameModel(model, event.target.value)}
                        className="w-full truncate bg-transparent text-[11.5px] font-medium outline-none"
                        aria-label={t("admin.modelName")}
                      />
                      <p className="truncate font-mono text-[10px] text-[var(--faint)]">{model.upstream_id}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onTogglePaid(model)}
                      title={t("admin.paidHint")}
                      aria-pressed={model.paid === true}
                      className={cn(
                        "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors",
                        model.paid
                          ? "border-[var(--warning)]/50 bg-[var(--warning)]/15 text-[var(--warning)]"
                          : "border-[var(--border)] text-[var(--faint)] hover:text-foreground",
                      )}
                    >
                      {t("admin.paid")}
                    </button>
                    {model.upstream_verified ? (
                      <CheckCircle2 className="size-3.5 text-[var(--success)]" />
                    ) : (
                      <AlertTriangle className="size-3.5 text-[var(--destructive)]" />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Users                                                                      */
/* -------------------------------------------------------------------------- */

function UsersTab() {
  const t = useAdminT();
  const [users, setUsers] = React.useState<AdminUser[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState("");
  const [status, setStatus] = React.useState<"all" | "active" | "blocked">("all");

  const load = React.useCallback(async () => {
    try {
      const data = await apiFetch<{ users: AdminUser[] }>("/api/admin/users");
      setUsers(data.users ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("error.generic"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const filtered = users.filter((user) => {
    if (status !== "all" && user.status !== status) return false;
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return user.email.toLowerCase().includes(term) || (user.display_name ?? "").toLowerCase().includes(term);
  });

  const update = async (user: AdminUser, patch: Record<string, unknown>) => {
    try {
      await apiFetch(`/api/admin/users/${user.id}`, { method: "PATCH", body: patch });
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("error.generic"));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-[12px] text-[var(--muted-foreground)]">
        <Loader2 className="size-4 animate-spin" />
        {t("common.loading")}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("admin.searchUsers")}
          className="max-w-[320px]"
        />
        <div className="flex gap-1 rounded-[11px] border border-[var(--border)] bg-[var(--surface-2)] p-0.5">
          {(["all", "active", "blocked"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setStatus(value)}
              className={cn(
                "h-7 rounded-[8px] px-2.5 text-[11.5px] font-medium",
                status === value ? "bg-[var(--surface-1)] shadow-sm" : "text-[var(--muted-foreground)]",
              )}
            >
              {value === "all" ? t("admin.statusAll") : value === "active" ? t("admin.statusActive") : t("admin.statusBlocked")}
            </button>
          ))}
        </div>
        <Button size="xs" variant="ghost" onClick={() => void load()}>
          <RefreshCw className="size-3.5" />
          {t("common.refresh")}
        </Button>
      </div>

      <div className={cn(CARD, "overflow-x-auto")}>
        <table className="w-full min-w-[820px] border-collapse text-left text-[12px]">
          <thead>
            <tr className="border-b border-[var(--border)] text-[10.5px] uppercase tracking-wide text-[var(--faint)]">
              <th className="px-3 py-2 font-medium">{t("admin.providerName")}</th>
              <th className="px-3 py-2 font-medium">{t("admin.createdAt")}</th>
              <th className="px-3 py-2 font-medium">{t("admin.lastSeen")}</th>
              <th className="px-3 py-2 font-medium">{t("admin.tokens")}</th>
              <th className="px-3 py-2 font-medium">{t("admin.requests")}</th>
              <th className="px-3 py-2 font-medium">{t("admin.daily")}</th>
              <th className="px-3 py-2 font-medium">{t("admin.monthly")}</th>
              <th className="px-3 py-2 font-medium">{t("common.status")}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((user) => (
              <UserRow key={user.id} user={user} onUpdate={(patch) => void update(user, patch)} />
            ))}
          </tbody>
        </table>
        {filtered.length === 0 ? (
          <p className="p-4 text-[12px] text-[var(--muted-foreground)]">{t("common.none")}</p>
        ) : null}
      </div>
    </div>
  );
}

function UserRow({ user, onUpdate }: { user: AdminUser; onUpdate: (patch: Record<string, unknown>) => void }) {
  const t = useAdminT();
  const [daily, setDaily] = React.useState(user.daily_token_limit?.toString() ?? "");
  const [monthly, setMonthly] = React.useState(user.monthly_token_limit?.toString() ?? "");

  React.useEffect(() => {
    setDaily(user.daily_token_limit?.toString() ?? "");
    setMonthly(user.monthly_token_limit?.toString() ?? "");
  }, [user.daily_token_limit, user.monthly_token_limit]);

  const saveLimits = () => {
    onUpdate({
      dailyTokenLimit: daily.trim() === "" ? null : Number(daily),
      monthlyTokenLimit: monthly.trim() === "" ? null : Number(monthly),
    });
  };

  return (
    <tr className="border-b border-[var(--border)]/60 last:border-0">
      <td className="px-3 py-2.5">
        <p className="truncate font-medium">{user.display_name || user.email.split("@")[0]}</p>
        <p className="truncate text-[10.5px] text-[var(--faint)]">{user.email}</p>
        {user.role === "admin" ? <Badge variant="primary" className="mt-1">{t("auth.admin")}</Badge> : null}
      </td>
      <td className="px-3 py-2.5 text-[11px] text-[var(--muted-foreground)]">{dateLabel(user.created_at)}</td>
      <td className="px-3 py-2.5 text-[11px] text-[var(--muted-foreground)]">{dateLabel(user.last_seen_at)}</td>
      <td className="px-3 py-2.5 font-mono text-[11px]">{formatTokens(user.totalTokens)}</td>
      <td className="px-3 py-2.5 font-mono text-[11px]">{user.requests}</td>
      <td className="px-3 py-2.5">
        <Input value={daily} onChange={(event) => setDaily(event.target.value.replace(/[^\d]/g, ""))} className="h-7 w-[92px] text-[11px]" inputMode="numeric" />
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-1">
          <Input value={monthly} onChange={(event) => setMonthly(event.target.value.replace(/[^\d]/g, ""))} className="h-7 w-[92px] text-[11px]" inputMode="numeric" />
          <Button size="xs" variant="ghost" onClick={saveLimits}>
            {t("admin.saveLimits")}
          </Button>
        </div>
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          <Badge variant={user.status === "active" ? "primary" : "unknown"}>
            {user.status === "active" ? t("admin.statusActive") : t("admin.statusBlocked")}
          </Badge>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => onUpdate({ status: user.status === "active" ? "blocked" : "active" })}
          >
            {user.status === "active" ? t("admin.block") : t("admin.unblock")}
          </Button>
        </div>
      </td>
    </tr>
  );
}

/* -------------------------------------------------------------------------- */
/* Usage                                                                      */
/* -------------------------------------------------------------------------- */

function UsageTab() {
  const t = useAdminT();
  const [days, setDays] = React.useState(30);
  const [stats, setStats] = React.useState<UsageStats | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch<UsageStats>(`/api/admin/usage?days=${days}`)
      .then((data) => {
        if (!cancelled) setStats(data);
      })
      .catch((error: unknown) => {
        if (!cancelled) toast.error(error instanceof Error ? error.message : t("error.generic"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [days, t]);

  const chart = React.useMemo(
    () => (stats?.daily ?? []).map((row) => ({ date: row.date.slice(5), tokens: row.input + row.output })),
    [stats],
  );

  const maxModel = Math.max(1, ...(stats?.byModel ?? []).map((row) => row.tokens));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[13px] font-semibold">
          <BarChart3 className="size-4 text-[var(--primary)]" />
          {t("admin.usageTitle")}
        </h2>
        <div className="flex gap-1 rounded-[11px] border border-[var(--border)] bg-[var(--surface-2)] p-0.5">
          {[7, 30, 90].map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setDays(value)}
              className={cn(
                "h-7 rounded-[8px] px-2.5 text-[11.5px] font-medium",
                days === value ? "bg-[var(--surface-1)] shadow-sm" : "text-[var(--muted-foreground)]",
              )}
            >
              {t("admin.usagePeriod", { days: value })}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-[12px] text-[var(--muted-foreground)]">
          <Loader2 className="size-4 animate-spin" />
          {t("common.loading")}
        </div>
      ) : !stats ? null : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { label: t("admin.totalTokens"), value: formatTokens(stats.totals.tokens) },
              { label: t("admin.totalRequests"), value: String(stats.totals.requests) },
              { label: t("admin.errors"), value: String(stats.totals.errors) },
            ].map((card) => (
              <div key={card.label} className={cn(CARD, "p-3.5")}>
                <p className="text-[10.5px] uppercase tracking-wide text-[var(--faint)]">{card.label}</p>
                <p className="mt-1 font-mono text-[19px] font-semibold">{card.value}</p>
              </div>
            ))}
          </div>

          <div className={cn(CARD, "p-4")}>
            <div className="h-[240px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chart} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="adminUsage" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.45} />
                      <stop offset="100%" stopColor="var(--primary)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: "var(--faint)" }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "var(--faint)" }} tickLine={false} axisLine={false} width={48} />
                  <RechartsTooltip
                    contentStyle={{
                      background: "var(--surface-1)",
                      border: "1px solid var(--border)",
                      borderRadius: 10,
                      fontSize: 11,
                    }}
                  />
                  <Area type="monotone" dataKey="tokens" stroke="var(--primary)" strokeWidth={2} fill="url(#adminUsage)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className={cn(CARD, "p-4")}>
              <h3 className="mb-2 text-[12px] font-semibold">{t("admin.byModel")}</h3>
              {(stats.byModel ?? []).length === 0 ? (
                <p className="text-[11.5px] text-[var(--muted-foreground)]">{t("admin.noUsage")}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {stats.byModel.map((row) => (
                    <li key={row.model} className="text-[11.5px]">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="truncate">{row.model}</span>
                        <span className="font-mono text-[10.5px] text-[var(--faint)]">{formatTokens(row.tokens)}</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-3)]">
                        <div
                          className="h-full rounded-full bg-[var(--primary)]"
                          style={{ width: `${Math.max(2, (row.tokens / maxModel) * 100)}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className={cn(CARD, "p-4")}>
              <h3 className="mb-2 text-[12px] font-semibold">{t("admin.byProvider")}</h3>
              {(stats.byProvider ?? []).length === 0 ? (
                <p className="text-[11.5px] text-[var(--muted-foreground)]">{t("admin.noUsage")}</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {stats.byProvider.map((row) => (
                    <li key={row.provider} className="flex items-center justify-between gap-2 text-[11.5px]">
                      <span className="truncate">{row.provider}</span>
                      <span className="font-mono text-[10.5px] text-[var(--faint)]">
                        {formatTokens(row.tokens)} · {row.requests}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <h3 className="mb-2 mt-4 text-[12px] font-semibold">{t("admin.topUsers")}</h3>
              <ul className="flex flex-col gap-1.5">
                {stats.topUsers.map((row) => (
                  <li key={row.userId} className="flex items-center justify-between gap-2 text-[11.5px]">
                    <span className="truncate font-mono text-[10.5px] text-[var(--muted-foreground)]">
                      {row.userId.slice(0, 8)}
                    </span>
                    <span className="font-mono text-[10.5px] text-[var(--faint)]">
                      {formatTokens(row.tokens)} · {row.requests}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Settings                                                                   */
/* -------------------------------------------------------------------------- */

function SettingsTab() {
  const t = useAdminT();
  const refreshCatalog = useCatalogStore((s) => s.refresh);
  const [settings, setSettings] = React.useState<AppSettings | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    apiFetch<{ settings: AppSettings }>("/api/admin/settings")
      .then((data) => setSettings(data.settings))
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : t("error.generic")))
      .finally(() => setLoading(false));
  }, [t]);

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      await apiFetch("/api/admin/settings", {
        method: "PATCH",
        body: {
          signupOpen: settings.signup_open,
          defaultDailyTokenLimit: settings.default_daily_token_limit,
          defaultMonthlyTokenLimit: settings.default_monthly_token_limit,
        },
      });
      toast.success(t("admin.saved"));
      void refreshCatalog();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("error.generic"));
    } finally {
      setSaving(false);
    }
  };

  if (loading || !settings) {
    return (
      <div className="flex items-center gap-2 text-[12px] text-[var(--muted-foreground)]">
        <Loader2 className="size-4 animate-spin" />
        {t("common.loading")}
      </div>
    );
  }

  return (
    <section className={cn(CARD, "flex max-w-[560px] flex-col gap-4 p-4")}>
      <h2 className="flex items-center gap-2 text-[13px] font-semibold">
        <Settings2 className="size-4 text-[var(--primary)]" />
        {t("admin.settingsTitle")}
      </h2>

      <label className="flex items-center justify-between gap-3 text-[12.5px]">
        <span>{t("admin.signupOpen")}</span>
        <Switch
          checked={settings.signup_open}
          onCheckedChange={(checked) => setSettings({ ...settings, signup_open: checked })}
          aria-label={t("admin.signupOpen")}
        />
      </label>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="admin-daily">{t("admin.defaultDaily")}</Label>
        <Input
          id="admin-daily"
          inputMode="numeric"
          value={settings.default_daily_token_limit?.toString() ?? ""}
          onChange={(event) => {
            const value = event.target.value.replace(/[^\d]/g, "");
            setSettings({ ...settings, default_daily_token_limit: value ? Number(value) : null });
          }}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="admin-monthly">{t("admin.defaultMonthly")}</Label>
        <Input
          id="admin-monthly"
          inputMode="numeric"
          value={settings.default_monthly_token_limit?.toString() ?? ""}
          onChange={(event) => {
            const value = event.target.value.replace(/[^\d]/g, "");
            setSettings({ ...settings, default_monthly_token_limit: value ? Number(value) : null });
          }}
        />
      </div>

      <Button size="sm" className="self-start" onClick={() => void save()} disabled={saving}>
        {saving ? <Loader2 className="size-4 animate-spin" /> : null}
        {t("common.save")}
      </Button>
    </section>
  );
}
