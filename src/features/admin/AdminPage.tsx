// admin feature: AdminPage; change its UI/flow here and keep related state/API calls in sync.
import {
  Activity,
  AlertTriangle,
  Ban,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Coins,
  Cpu,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  Route,
  Search,
  Server,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
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
import { useAdminT } from "@/features/admin/adminStrings";
import type { KeyHealthReport, ProviderInspectSummary } from "@/lib/providerInspectClient";
import { formatTokens } from "@/lib/tokens";
import { cn } from "@/lib/utils";
import { useCatalogStore } from "@/stores/catalog";
import { useRoutersStore } from "@/stores/routers";

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
  freeModelCount?: number;
  totalModelCount?: number;
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
  pricing?: "free" | "paid" | "unknown";
}

interface AdminRouter {
  id: string;
  providerId: string | null;
  providerIds?: string[];
  providerName?: string;
  providerNames?: string[];
  name: string;
  type: "free";
  enabled: boolean;
  activeMemberCount: number;
  memberModelIds: string[];
  createdAt: string;
}

interface AdminUserModelUsage {
  model: string;
  provider: string;
  source: "admin" | "default";
  messages: number;
  tokens: number;
  lastUsedAt: string;
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
  online?: boolean;
  offlineDays?: number | null;
  totalTokens: number;
  requests: number;
  messagesSent?: number;
  modelsUsed?: AdminUserModelUsage[];
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

function dateTimeLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function computePresence(
  user: AdminUser,
  t: (key: string, vars?: Record<string, string | number>) => string,
): {
  kind: "online" | "recent" | "offline" | "long-offline" | "never";
  label: string;
  offlineDays: number | null;
} {
  if (!user.last_seen_at) {
    return { kind: "never", label: t("admin.neverOnline"), offlineDays: null };
  }
  const ts = Date.parse(user.last_seen_at);
  if (!Number.isFinite(ts)) {
    return { kind: "never", label: t("admin.neverOnline"), offlineDays: null };
  }
  const diffMs = Math.max(0, Date.now() - ts);
  const mins = Math.floor(diffMs / 60_000);
  const hours = Math.floor(diffMs / 3_600_000);
  const days = typeof user.offlineDays === "number" ? user.offlineDays : Math.floor(diffMs / 86_400_000);

  if (user.online || diffMs <= 5 * 60_000) {
    return { kind: "online", label: t("admin.onlineNow"), offlineDays: 0 };
  }
  if (mins < 60) {
    return { kind: "recent", label: t("admin.minsAgo", { n: Math.max(1, mins) }), offlineDays: 0 };
  }
  if (hours < 24) {
    return { kind: "recent", label: t("admin.hoursAgo", { n: hours }), offlineDays: 0 };
  }
  return {
    kind: days >= 7 ? "long-offline" : "offline",
    label: t("admin.daysOffline", { n: days }),
    offlineDays: days,
  };
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

interface ProviderTestReport {
  tested: number;
  healthy: number;
  keyHealth?: KeyHealthReport;
  summary?: ProviderInspectSummary;
  testedAt: number;
}

function ProvidersTab() {
  const t = useAdminT();
  const refreshCatalog = useCatalogStore((s) => s.refresh);
  const refreshPublicRouters = useRoutersStore((s) => s.refresh);
  const [providers, setProviders] = React.useState<AdminProvider[]>([]);
  const [routers, setRouters] = React.useState<AdminRouter[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [models, setModels] = React.useState<Record<string, AdminModel[]>>({});
  const [testReports, setTestReports] = React.useState<Record<string, ProviderTestReport>>({});
  const [testing, setTesting] = React.useState<string | null>(null);
  const [form, setForm] = React.useState({ ...EMPTY_PROVIDER_FORM });
  const [selectedPreset, setSelectedPreset] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [multiProviderIds, setMultiProviderIds] = React.useState<string[]>([]);
  const [multiRouterName, setMultiRouterName] = React.useState("");
  const [creatingMultiRouter, setCreatingMultiRouter] = React.useState(false);

  const loadRouters = React.useCallback(async () => {
    try {
      const data = await apiFetch<{ routers: AdminRouter[] }>("/api/admin/routers");
      setRouters(data.routers ?? []);
    } catch {
      // Ignore when routers table is unavailable
    }
  }, []);

  const load = React.useCallback(async () => {
    try {
      const [data, routerData] = await Promise.all([
        apiFetch<{ providers: AdminProvider[] }>("/api/admin/providers"),
        apiFetch<{ routers: AdminRouter[] }>("/api/admin/routers").catch(() => ({ routers: [] })),
      ]);
      setProviders(data.providers ?? []);
      setRouters(routerData.routers ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("error.generic"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const createRouter = async (providerIdsInput: string | string[], name: string): Promise<boolean> => {
    const providerIds = (Array.isArray(providerIdsInput) ? providerIdsInput : [providerIdsInput]).filter(Boolean);
    if (providerIds.length === 0) return false;
    setBusy(providerIds.length === 1 ? providerIds[0]! : "multi-router");
    try {
      await apiFetch("/api/admin/routers", {
        method: "POST",
        body: { providerId: providerIds[0], providerIds, name },
      });
      await loadRouters();
      void refreshPublicRouters();
      toast.success(t("admin.routerCreated"));
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("error.generic"));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const providerFreeCount = React.useCallback(
    (provider: AdminProvider): number => {
      const loaded = models[provider.id];
      if (loaded) {
        return loaded.filter((m) => m.upstream_verified && !m.paid && m.pricing === "free").length;
      }
      const reportCount = testReports[provider.id]?.summary?.freeCount;
      if (typeof reportCount === "number") return reportCount;
      return provider.freeModelCount ?? 0;
    },
    [models, testReports],
  );

  // Drop deleted providers from the multi-provider router selection automatically.
  React.useEffect(() => {
    const validIds = new Set(providers.map((p) => p.id));
    setMultiProviderIds((prev) => {
      const next = prev.filter((id) => validIds.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [providers]);

  const toggleMultiProvider = (providerId: string) => {
    setMultiProviderIds((prev) =>
      prev.includes(providerId) ? prev.filter((id) => id !== providerId) : [...prev, providerId],
    );
  };

  const selectedMultiProviders = React.useMemo(
    () => providers.filter((p) => multiProviderIds.includes(p.id)),
    [providers, multiProviderIds],
  );
  const selectedMultiFreeTotal = React.useMemo(
    () => selectedMultiProviders.reduce((sum, p) => sum + providerFreeCount(p), 0),
    [selectedMultiProviders, providerFreeCount],
  );

  const submitMultiRouter = async () => {
    if (creatingMultiRouter || multiProviderIds.length === 0 || selectedMultiFreeTotal === 0) return;
    setCreatingMultiRouter(true);
    try {
      const ok = await createRouter(multiProviderIds, multiRouterName);
      if (ok) {
        setMultiRouterName("");
        setMultiProviderIds([]);
      }
    } finally {
      setCreatingMultiRouter(false);
    }
  };

  const toggleRouter = async (router: AdminRouter) => {
    setBusy(router.providerId ?? router.id);
    try {
      await apiFetch(`/api/admin/routers/${router.id}`, {
        method: "PATCH",
        body: { enabled: !router.enabled },
      });
      await loadRouters();
      void refreshPublicRouters();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("error.generic"));
    } finally {
      setBusy(null);
    }
  };

  const deleteRouter = async (router: AdminRouter) => {
    setBusy(router.providerId ?? router.id);
    try {
      await apiFetch(`/api/admin/routers/${router.id}`, { method: "DELETE" });
      await loadRouters();
      void refreshPublicRouters();
      toast.success(t("admin.routerDeleted"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("error.generic"));
    } finally {
      setBusy(null);
    }
  };

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
      const created = await apiFetch<{ provider: AdminProvider }>("/api/admin/providers", {
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
      toast.success(keys.length > 0 ? t("admin.autoPublishing") : t("admin.saved"));
      await load();
      // Immediately discover & publish enabled models to the public site when keys were supplied.
      if (created?.provider && keys.length > 0) {
        await testProvider(created.provider);
      } else {
        void refreshCatalog();
      }
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
      const data = await apiFetch<{
        tested: number;
        healthy: number;
        keyHealth?: KeyHealthReport;
        summary?: ProviderInspectSummary;
        models: AdminModel[];
      }>(
        `/api/admin/providers/${provider.id}/test`,
        { method: "POST" },
      );
      setModels((current) => ({ ...current, [provider.id]: data.models ?? [] }));
      setTestReports((current) => ({
        ...current,
        [provider.id]: {
          tested: data.tested,
          healthy: data.healthy,
          keyHealth: data.keyHealth,
          summary: data.summary,
          testedAt: Date.now(),
        },
      }));
      setExpanded(provider.id);
      if (data.keyHealth && data.summary) {
        const tierNote = `${data.summary.freeCount} Free · ${data.summary.paidCount} Paid`;
        if (data.keyHealth.status === "healthy") {
          toast.success(`${data.keyHealth.message} (${tierNote})`);
        } else if (data.keyHealth.status === "free_only" || data.keyHealth.status === "rate_limited") {
          toast.message(`${data.keyHealth.message} (${tierNote})`);
        } else {
          toast.error(`${data.keyHealth.message} (${tierNote})`);
        }
      } else {
        toast.success(t("admin.testResult", { ok: data.healthy, total: data.tested }));
      }
      await load();
      void refreshCatalog();
      void refreshPublicRouters();
    } catch (error) {
      const status =
        error && typeof error === "object" && "status" in error && typeof (error as { status?: unknown }).status === "number"
          ? (error as { status: number }).status
          : undefined;
      const message = error instanceof Error ? error.message : t("error.generic");
      const keyStatus =
        status === 401
          ? "invalid_key"
          : status === 403
            ? "forbidden"
            : status === 429
              ? "rate_limited"
              : "unreachable";
      setTestReports((current) => ({
        ...current,
        [provider.id]: {
          tested: 0,
          healthy: 0,
          keyHealth: {
            status: keyStatus,
            ok: false,
            ...(status ? { httpStatus: status } : {}),
            latencyMs: null,
            message,
          },
          testedAt: Date.now(),
        },
      }));
      toast.error(message);
    } finally {
      setTesting(null);
    }
  };

  const setModelVisibility = async (
    providerId: string,
    model: AdminModel,
    state: "free" | "paid" | "hidden",
  ) => {
    const enabled = state !== "hidden";
    const paid = state === "paid";
    try {
      await apiFetch(`/api/admin/models/${model.id}`, {
        method: "PATCH",
        body: enabled ? { enabled: true, paid } : { enabled: false },
      });
      setModels((current) => ({
        ...current,
        [providerId]: (current[providerId] ?? []).map((entry) =>
          entry.id === model.id
            ? { ...entry, enabled, ...(enabled ? { paid, pricing: paid ? "paid" : "free" } : {}) }
            : entry,
        ),
      }));
      void loadRouters();
      void refreshCatalog();
      void refreshPublicRouters();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("error.generic"));
    }
  };

  const bulkModels = async (
    providerId: string,
    action: "show_all" | "hide_all" | "free_all" | "paid_all",
  ) => {
    setBusy(providerId);
    try {
      const data = await apiFetch<{ models: AdminModel[] }>(
        `/api/admin/providers/${providerId}/models/bulk`,
        { method: "POST", body: { action } },
      );
      if (Array.isArray(data.models)) {
        setModels((current) => ({ ...current, [providerId]: data.models }));
      } else {
        await loadModels(providerId);
      }
      toast.success(t("admin.saved"));
      void loadRouters();
      void refreshCatalog();
      void refreshPublicRouters();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("error.generic"));
    } finally {
      setBusy(null);
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

          <section className={cn(CARD, "p-4")}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="flex items-center gap-2 text-[13px] font-semibold">
                  <Route className="size-4 text-[var(--primary)]" />
                  {t("admin.routerPoolTitle")}
                </h2>
                <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
                  {t("admin.routerPoolDesc")}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() =>
                    setMultiProviderIds(
                      providers.filter((p) => providerFreeCount(p) > 0).map((p) => p.id),
                    )
                  }
                  disabled={providers.every((p) => providerFreeCount(p) === 0)}
                >
                  {t("admin.routerSelectAll")}
                </Button>
                {multiProviderIds.length > 0 ? (
                  <Button size="xs" variant="ghost" onClick={() => setMultiProviderIds([])}>
                    {t("admin.routerClearSelection")}
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="mt-3">
              <p className="mb-1.5 text-[11px] font-medium text-[var(--muted-foreground)]">
                {t("admin.routerSelectProviders")}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {providers.map((provider) => {
                  const count = providerFreeCount(provider);
                  const selected = multiProviderIds.includes(provider.id);
                  return (
                    <button
                      key={provider.id}
                      type="button"
                      onClick={() => toggleMultiProvider(provider.id)}
                      aria-pressed={selected}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-[8px] border px-2.5 py-1 text-[11.5px] font-medium transition-colors",
                        selected
                          ? "border-[var(--primary)] bg-[var(--primary)]/14 text-foreground"
                          : "border-[var(--border)] bg-[var(--surface-2)]/60 text-[var(--muted-foreground)] hover:text-foreground",
                        !provider.enabled && "opacity-60",
                      )}
                    >
                      <span
                        className={cn(
                          "grid size-3.5 place-items-center rounded-[4px] border text-[9px]",
                          selected
                            ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]"
                            : "border-[var(--border)] bg-[var(--surface-1)]",
                        )}
                        aria-hidden="true"
                      >
                        {selected ? "✓" : ""}
                      </span>
                      <span className="max-w-[160px] truncate">{provider.name}</span>
                      <Badge variant={count > 0 ? "primary" : "unknown"} className="text-[9.5px]">
                        {count}
                      </Badge>
                    </button>
                  );
                })}
              </div>

              <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] text-[var(--muted-foreground)]">
                  {multiProviderIds.length > 0
                    ? t("admin.routerSelectedSummary", {
                        models: selectedMultiFreeTotal,
                        providers: multiProviderIds.length,
                      })
                    : t("admin.routerNoSelection")}
                </p>
              </div>

              <div className="mt-2 flex items-center gap-1.5">
                <Input
                  value={multiRouterName}
                  onChange={(event) => setMultiRouterName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void submitMultiRouter();
                  }}
                  placeholder={t("admin.routerNamePlaceholder")}
                  maxLength={32}
                  disabled={creatingMultiRouter || multiProviderIds.length === 0 || selectedMultiFreeTotal === 0}
                  className="h-8 flex-1 text-[12px]"
                />
                <Button
                  size="sm"
                  disabled={
                    creatingMultiRouter ||
                    multiProviderIds.length === 0 ||
                    selectedMultiFreeTotal === 0 ||
                    multiRouterName.trim().length < 2
                  }
                  onClick={() => void submitMultiRouter()}
                >
                  {creatingMultiRouter ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Route className="size-3.5" />
                  )}
                  {t("admin.routerCreate")}
                </Button>
              </div>
              <p className="mt-1.5 text-[10.5px] text-[var(--faint)]">{t("admin.routerHiddenHint")}</p>
            </div>

            {routers.length > 0 ? (
              <ul className="mt-3 flex flex-col gap-1.5 border-t border-[var(--border)] pt-3">
                {routers.map((router) => {
                  const pNames =
                    router.providerNames && router.providerNames.length > 0
                      ? router.providerNames
                      : router.providerName
                        ? [router.providerName]
                        : [];
                  return (
                    <li
                      key={router.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)]/50 px-2.5 py-2 text-[11.5px]"
                    >
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <Route className="size-3.5 shrink-0 text-[var(--primary)]" />
                        <span className="truncate font-semibold">{router.name}</span>
                        <Badge variant="primary" className="text-[9.5px]">
                          {router.activeMemberCount > 0
                            ? t("admin.routerActiveCount", { n: router.activeMemberCount })
                            : t("admin.routerEmpty")}
                        </Badge>
                        {pNames.map((pname) => (
                          <Badge key={pname} variant="unknown" className="text-[9.5px]">
                            {pname}
                          </Badge>
                        ))}
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={router.enabled}
                          onCheckedChange={() => void toggleRouter(router)}
                          disabled={busy === (router.providerId ?? router.id)}
                          aria-label={router.enabled ? t("admin.enabled") : t("admin.disabled")}
                        />
                        <button
                          type="button"
                          onClick={() => void deleteRouter(router)}
                          disabled={busy === (router.providerId ?? router.id)}
                          className="text-[var(--faint)] transition-colors hover:text-[var(--destructive)]"
                          aria-label={t("common.delete")}
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </section>

          {providers.map((provider) => (
            <ProviderCard
              key={provider.id}
              provider={provider}
              models={models[provider.id]}
              routers={routers.filter(
                (r) =>
                  r.providerId === provider.id ||
                  (Array.isArray(r.providerIds) && r.providerIds.includes(provider.id)),
              )}
              report={testReports[provider.id]}
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
              onSetModelVisibility={(model, state) => void setModelVisibility(provider.id, model, state)}
              onBulkModels={(action) => void bulkModels(provider.id, action)}
              onRenameModel={(model, name) => void renameModel(provider.id, model, name)}
              onCreateRouter={(name) => createRouter([provider.id], name)}
              onToggleRouter={(router) => void toggleRouter(router)}
              onDeleteRouter={(router) => void deleteRouter(router)}
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
  routers,
  report,
  busy,
  testing,
  expanded,
  onExpand,
  onToggle,
  onRemove,
  onTest,
  onAddKeys,
  onRemoveKey,
  onSetModelVisibility,
  onBulkModels,
  onRenameModel,
  onCreateRouter,
  onToggleRouter,
  onDeleteRouter,
}: {
  provider: AdminProvider;
  models?: AdminModel[];
  routers: AdminRouter[];
  report?: ProviderTestReport;
  busy: boolean;
  testing: boolean;
  expanded: boolean;
  onExpand: () => void;
  onToggle: () => void;
  onRemove: () => void;
  onTest: () => void;
  onAddKeys: (raw: string) => void;
  onRemoveKey: (keyId: string) => void;
  onSetModelVisibility: (model: AdminModel, state: "free" | "paid" | "hidden") => void;
  onBulkModels: (action: "show_all" | "hide_all" | "free_all" | "paid_all") => void;
  onRenameModel: (model: AdminModel, name: string) => void;
  onCreateRouter: (name: string) => Promise<boolean>;
  onToggleRouter: (router: AdminRouter) => void;
  onDeleteRouter: (router: AdminRouter) => void;
}) {
  const t = useAdminT();
  const [newKeys, setNewKeys] = React.useState("");
  const [tierFilter, setTierFilter] = React.useState<"all" | "free" | "paid" | "hidden">("all");
  const [modelSearch, setModelSearch] = React.useState("");
  const [routerName, setRouterName] = React.useState("");
  const [creatingRouter, setCreatingRouter] = React.useState(false);
  const freeModelsCount = models
    ? models.filter((m) => m.enabled && !m.paid && m.pricing === "free").length
    : (report?.summary?.freeCount ?? 0);
  // Admin free routers stay active on verified free models even when hidden from the public model list.
  const routerFreeModelsCount = models
    ? models.filter((m) => m.upstream_verified && !m.paid && m.pricing === "free").length
    : (report?.summary?.freeCount ?? provider.freeModelCount ?? 0);
  const paidModelsCount = models
    ? models.filter((m) => m.enabled && (m.paid || m.pricing === "paid")).length
    : (report?.summary?.paidCount ?? 0);
  const hiddenModelsCount = models ? models.filter((m) => !m.enabled).length : 0;
  const filteredModels = React.useMemo(() => {
    if (!models) return [];
    const q = modelSearch.trim().toLowerCase();
    return models.filter((m) => {
      if (tierFilter === "free" && (!m.enabled || m.paid || m.pricing !== "free")) return false;
      if (tierFilter === "paid" && (!m.enabled || (!m.paid && m.pricing !== "paid"))) return false;
      if (tierFilter === "hidden" && m.enabled) return false;
      if (!q) return true;
      return m.display_name.toLowerCase().includes(q) || m.upstream_id.toLowerCase().includes(q);
    });
  }, [models, tierFilter, modelSearch]);

  const submitRouter = async () => {
    if (creatingRouter || routerFreeModelsCount === 0) return;
    setCreatingRouter(true);
    try {
      const ok = await onCreateRouter(routerName);
      if (ok) setRouterName("");
    } finally {
      setCreatingRouter(false);
    }
  };
  const kh = report?.keyHealth;
  const khTone = kh
    ? kh.status === "healthy"
      ? "ok"
      : kh.status === "free_only" || kh.status === "rate_limited"
        ? "warn"
        : "bad"
    : null;

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
        {kh && khTone ? (
          <Badge
            variant={khTone === "ok" ? "primary" : "unknown"}
            className={cn(
              khTone === "ok" && "border-[var(--success)]/40 bg-[var(--success)]/12 text-[var(--success)]",
              khTone === "warn" && "border-[var(--warning)]/40 bg-[var(--warning)]/12 text-[var(--warning)]",
              khTone === "bad" && "border-[var(--destructive)]/40 bg-[var(--destructive)]/12 text-[var(--destructive)]",
            )}
          >
            {khTone === "ok" ? <CheckCircle2 className="size-3" /> : khTone === "warn" ? <AlertTriangle className="size-3" /> : <ShieldAlert className="size-3" />}
            {kh.status === "healthy"
              ? "Verified"
              : kh.status === "free_only"
                ? "Free Only"
                : kh.status === "rate_limited"
                  ? "Rate Limited"
                  : kh.status === "insufficient_balance"
                    ? "No Balance"
                    : kh.status === "invalid_key"
                      ? "Key Rejected"
                      : kh.status === "forbidden"
                        ? "Forbidden"
                        : "Unreachable"}
            {kh.latencyMs != null ? ` · ${kh.latencyMs}ms` : ""}
          </Badge>
        ) : null}
        {(models && models.length > 0) || report?.summary ? (
          <Badge variant="unknown" className="gap-1.5 font-mono text-[10.5px]">
            <span className="text-[var(--success)]">{freeModelsCount} {t("admin.free")}</span>
            <span className="opacity-40">/</span>
            <span className="text-[var(--warning)]">{paidModelsCount} {t("admin.paid")}</span>
            {hiddenModelsCount > 0 ? (
              <>
                <span className="opacity-40">/</span>
                <span className="text-[var(--faint)]">{hiddenModelsCount} {t("admin.hidden")}</span>
              </>
            ) : null}
          </Badge>
        ) : null}
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
        <div className="border-t border-[var(--border)]">
          {kh && khTone ? (
            <div
              className={cn(
                "mx-4 mt-4 flex flex-wrap items-start justify-between gap-3 rounded-[12px] border px-3.5 py-2.5 text-[11.5px]",
                khTone === "ok" && "border-[var(--success)]/35 bg-[var(--success)]/10",
                khTone === "warn" && "border-[var(--warning)]/35 bg-[var(--warning)]/10",
                khTone === "bad" && "border-[var(--destructive)]/40 bg-[var(--destructive)]/10",
              )}
            >
              <div className="flex min-w-0 items-start gap-2.5">
                {khTone === "ok" ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[var(--success)]" />
                ) : khTone === "warn" ? (
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--warning)]" />
                ) : (
                  <ShieldAlert className="mt-0.5 size-4 shrink-0 text-[var(--destructive)]" />
                )}
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{kh.message}</p>
                  <p className="mt-0.5 font-mono text-[10.5px] text-[var(--muted-foreground)]">
                    {kh.testedModel ? `Probe: ${kh.testedModel}` : "Models check"}
                    {kh.latencyMs != null ? ` · ${kh.latencyMs}ms` : ""}
                    {kh.httpStatus ? ` · HTTP ${kh.httpStatus}` : ""}
                  </p>
                </div>
              </div>
              {report?.summary ? (
                <div className="flex items-center gap-2 font-mono text-[11px]">
                  <span className="rounded-full bg-[var(--surface-2)] px-2 py-0.5">
                    Total {report.summary.totalModels}
                  </span>
                  <span className="rounded-full bg-[var(--success)]/15 px-2 py-0.5 text-[var(--success)]">
                    Free {report.summary.freeCount}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-[var(--warning)]/15 px-2 py-0.5 text-[var(--warning)]">
                    <Coins className="size-3" />
                    Paid {report.summary.paidCount}
                  </span>
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="grid gap-4 p-4 lg:grid-cols-2">
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
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-1.5 text-[12px] font-semibold">
                <Server className="size-3.5" />
                {t("admin.models")}
                {models && models.length > 0 ? (
                  <span className="font-mono text-[10.5px] font-normal text-[var(--faint)]">({models.length})</span>
                ) : null}
              </h3>
              {models && models.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1 text-[10.5px]">
                  <button
                    type="button"
                    onClick={() => setTierFilter("all")}
                    className={cn(
                      "rounded-full border px-2 py-0.5 transition-colors",
                      tierFilter === "all"
                        ? "border-[var(--primary)]/50 bg-[var(--primary)]/12 text-foreground"
                        : "border-[var(--border)] text-[var(--faint)] hover:text-foreground",
                    )}
                  >
                    {t("admin.filterAll")} ({models.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setTierFilter("free")}
                    className={cn(
                      "rounded-full border px-2 py-0.5 transition-colors",
                      tierFilter === "free"
                        ? "border-[var(--success)]/50 bg-[var(--success)]/15 text-[var(--success)]"
                        : "border-[var(--border)] text-[var(--faint)] hover:text-foreground",
                    )}
                  >
                    {t("admin.free")} ({freeModelsCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setTierFilter("paid")}
                    className={cn(
                      "rounded-full border px-2 py-0.5 transition-colors",
                      tierFilter === "paid"
                        ? "border-[var(--warning)]/50 bg-[var(--warning)]/15 text-[var(--warning)]"
                        : "border-[var(--border)] text-[var(--faint)] hover:text-foreground",
                    )}
                  >
                    {t("admin.paid")} ({paidModelsCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setTierFilter("hidden")}
                    className={cn(
                      "rounded-full border px-2 py-0.5 transition-colors",
                      tierFilter === "hidden"
                        ? "border-[var(--border-strong)] bg-[var(--surface-3)] text-foreground"
                        : "border-[var(--border)] text-[var(--faint)] hover:text-foreground",
                    )}
                  >
                    {t("admin.hidden")} ({hiddenModelsCount})
                  </button>
                </div>
              ) : null}
            </div>

            <p className="mb-2 flex items-center gap-1.5 text-[10.5px] text-[var(--muted-foreground)]">
              <EyeOff className="size-3 shrink-0 text-[var(--primary)]" />
              <span>{t("admin.publicPrivacyHint")}</span>
            </p>

            {models && models.length > 0 ? (
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                <div className="relative min-w-[140px] flex-1">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3 -translate-y-1/2 text-[var(--faint)]" />
                  <Input
                    value={modelSearch}
                    onChange={(event) => setModelSearch(event.target.value)}
                    placeholder={t("admin.searchModels")}
                    className="h-7 pl-7 text-[11px]"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <Button size="xs" variant="ghost" disabled={busy} onClick={() => onBulkModels("free_all")}>
                    {t("admin.bulkFreeAll")}
                  </Button>
                  <Button size="xs" variant="ghost" disabled={busy} onClick={() => onBulkModels("paid_all")}>
                    {t("admin.bulkPaidAll")}
                  </Button>
                  <Button size="xs" variant="ghost" disabled={busy} onClick={() => onBulkModels("show_all")}>
                    <Eye className="size-3" />
                    {t("admin.bulkShowAll")}
                  </Button>
                  <Button size="xs" variant="ghost" disabled={busy} onClick={() => onBulkModels("hide_all")}>
                    <EyeOff className="size-3" />
                    {t("admin.bulkHideAll")}
                  </Button>
                </div>
              </div>
            ) : null}

            {!models || models.length === 0 ? (
              <p className="text-[11.5px] text-[var(--muted-foreground)]">{t("admin.noModels")}</p>
            ) : (
              <ul className="flex max-h-[300px] flex-col gap-1.5 overflow-auto pr-1">
                {filteredModels.map((model) => {
                  const visState: "free" | "paid" | "hidden" = !model.enabled
                    ? "hidden"
                    : model.paid
                      ? "paid"
                      : "free";
                  return (
                    <li
                      key={model.id}
                      className={cn(
                        "flex items-center gap-2 rounded-[10px] border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1.5 transition-opacity",
                        visState === "hidden" && "opacity-60",
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <input
                            defaultValue={model.display_name}
                            onBlur={(event) => onRenameModel(model, event.target.value)}
                            className="w-full truncate bg-transparent text-[11.5px] font-medium outline-none"
                            aria-label={t("admin.modelName")}
                          />
                          {model.pricing === "unknown" && !model.paid ? (
                            <Badge variant="unknown" className="shrink-0 text-[9px]">
                              {t("admin.pricingUnknown")}
                            </Badge>
                          ) : null}
                        </div>
                        <p className="truncate font-mono text-[10px] text-[var(--faint)]">{model.upstream_id}</p>
                      </div>
                      <div className="inline-flex shrink-0 items-center gap-0.5 rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-0.5 text-[10px]">
                        <button
                          type="button"
                          onClick={() => onSetModelVisibility(model, "free")}
                          aria-pressed={visState === "free"}
                          className={cn(
                            "rounded-[6px] px-2 py-0.5 font-medium transition-colors",
                            visState === "free"
                              ? "bg-[var(--success)]/18 text-[var(--success)]"
                              : "text-[var(--faint)] hover:text-foreground",
                          )}
                        >
                          {t("admin.free")}
                        </button>
                        <button
                          type="button"
                          onClick={() => onSetModelVisibility(model, "paid")}
                          aria-pressed={visState === "paid"}
                          className={cn(
                            "rounded-[6px] px-2 py-0.5 font-medium transition-colors",
                            visState === "paid"
                              ? "bg-[var(--warning)]/18 text-[var(--warning)]"
                              : "text-[var(--faint)] hover:text-foreground",
                          )}
                        >
                          {t("admin.paid")}
                        </button>
                        <button
                          type="button"
                          onClick={() => onSetModelVisibility(model, "hidden")}
                          aria-pressed={visState === "hidden"}
                          className={cn(
                            "rounded-[6px] px-2 py-0.5 font-medium transition-colors",
                            visState === "hidden"
                              ? "bg-[var(--surface-3)] text-foreground"
                              : "text-[var(--faint)] hover:text-foreground",
                          )}
                        >
                          {t("admin.hidden")}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="mt-3 rounded-[10px] border border-[var(--border)] bg-[var(--surface-2)]/60 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-[11.5px] font-semibold">
                  <Route className="size-3.5 text-[var(--primary)]" />
                  <span>{t("admin.routerCreateFromFree")}</span>
                  <Badge variant="unknown" className="text-[9.5px]">
                    {t("admin.routerActiveCount", { n: routerFreeModelsCount })}
                  </Badge>
                </div>
              </div>
              <p className="mt-1 text-[10.5px] text-[var(--muted-foreground)]">
                {t("admin.routerHiddenHint")}
              </p>

              {routerFreeModelsCount === 0 ? (
                <p className="mt-1.5 text-[11px] text-[var(--muted-foreground)]">
                  {t("admin.routerNoFreeModels")}
                </p>
              ) : (
                <div className="mt-2 flex items-center gap-1.5">
                  <Input
                    value={routerName}
                    onChange={(event) => setRouterName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void submitRouter();
                    }}
                    placeholder={t("admin.routerNamePlaceholder")}
                    maxLength={32}
                    disabled={busy || creatingRouter}
                    className="h-7 flex-1 text-[11.5px]"
                  />
                  <Button
                    size="xs"
                    disabled={busy || creatingRouter || routerName.trim().length < 2}
                    onClick={() => void submitRouter()}
                  >
                    {creatingRouter ? <Loader2 className="size-3 animate-spin" /> : <Route className="size-3" />}
                    {t("admin.routerCreate")}
                  </Button>
                </div>
              )}

              {routers.length > 0 ? (
                <ul className="mt-2 flex flex-col gap-1.5">
                  {routers.map((router) => (
                    <li
                      key={router.id}
                      className="flex items-center justify-between gap-2 rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-2.5 py-1.5 text-[11.5px]"
                    >
                      <div className="flex min-w-0 items-center gap-1.5">
                        <Route className="size-3.5 shrink-0 text-[var(--primary)]" />
                        <span className="truncate font-medium">{router.name}</span>
                        <Badge variant="primary" className="text-[9.5px]">
                          {t("admin.routerBadge")}
                        </Badge>
                        <span className="text-[10.5px] text-[var(--muted-foreground)]">
                          {router.activeMemberCount > 0
                            ? t("admin.routerActiveCount", { n: router.activeMemberCount })
                            : t("admin.routerEmpty")}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={router.enabled}
                          onCheckedChange={() => onToggleRouter(router)}
                          disabled={busy}
                          aria-label={router.enabled ? t("admin.enabled") : t("admin.disabled")}
                        />
                        <button
                          type="button"
                          onClick={() => onDeleteRouter(router)}
                          disabled={busy}
                          className="text-[var(--faint)] transition-colors hover:text-[var(--destructive)]"
                          aria-label={t("common.delete")}
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
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
  const [status, setStatus] = React.useState<"all" | "online" | "active" | "blocked">("all");
  const [expandedUserId, setExpandedUserId] = React.useState<string | null>(null);

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

  const stats = React.useMemo(() => {
    let onlineCount = 0;
    let inactive3d = 0;
    let blockedCount = 0;
    let totalMessages = 0;
    for (const u of users) {
      const p = computePresence(u, t);
      if (p.kind === "online") onlineCount += 1;
      if (p.offlineDays !== null && p.offlineDays >= 3) inactive3d += 1;
      if (u.status === "blocked") blockedCount += 1;
      totalMessages += u.messagesSent ?? u.requests ?? 0;
    }
    return { total: users.length, onlineCount, inactive3d, blockedCount, totalMessages };
  }, [users, t]);

  const filtered = users.filter((user) => {
    const p = computePresence(user, t);
    if (status === "online" && p.kind !== "online") return false;
    if (status === "active" && user.status !== "active") return false;
    if (status === "blocked" && user.status !== "blocked") return false;
    const term = search.trim().toLowerCase();
    if (!term) return true;
    const inModels = (user.modelsUsed ?? []).some(
      (m) => m.model.toLowerCase().includes(term) || m.provider.toLowerCase().includes(term),
    );
    return (
      user.email.toLowerCase().includes(term) ||
      (user.display_name ?? "").toLowerCase().includes(term) ||
      inModels
    );
  });

  const update = async (user: AdminUser, patch: Record<string, unknown>) => {
    try {
      await apiFetch(`/api/admin/users/${user.id}`, { method: "PATCH", body: patch });
      const label = user.display_name || user.email;
      if (patch.status === "blocked") toast.success(t("admin.userBlockedToast", { name: label }));
      else if (patch.status === "active") toast.success(t("admin.userUnblockedToast", { name: label }));
      else toast.success(t("admin.limitsSaved"));
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
      {/* KPI summary cards */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
        <div className={cn(CARD, "p-3")}>
          <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--faint)]">
            {t("admin.usersTotal")}
          </p>
          <p className="mt-1 font-mono text-[18px] font-semibold">{stats.total}</p>
        </div>
        <div className={cn(CARD, "p-3")}>
          <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-[var(--success)]">
            <span className="size-1.5 animate-pulse rounded-full bg-[var(--success)]" />
            {t("admin.usersOnline")}
          </p>
          <p className="mt-1 font-mono text-[18px] font-semibold text-[var(--success)]">{stats.onlineCount}</p>
        </div>
        <div className={cn(CARD, "p-3")}>
          <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--warning)]">
            {t("admin.usersInactive3d")}
          </p>
          <p className="mt-1 font-mono text-[18px] font-semibold text-[var(--warning)]">{stats.inactive3d}</p>
        </div>
        <div className={cn(CARD, "p-3")}>
          <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--destructive)]">
            {t("admin.usersBlockedCount")}
          </p>
          <p className="mt-1 font-mono text-[18px] font-semibold text-[var(--destructive)]">{stats.blockedCount}</p>
        </div>
        <div className={cn(CARD, "col-span-2 p-3 sm:col-span-1")}>
          <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--faint)]">
            {t("admin.usersMessagesTotal")}
          </p>
          <p className="mt-1 font-mono text-[18px] font-semibold">{stats.totalMessages.toLocaleString()}</p>
        </div>
      </div>

      {/* Filter & search toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] max-w-[340px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--faint)]" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("admin.searchUsersHint")}
            className="pl-8"
          />
        </div>
        <div className="flex gap-1 rounded-[11px] border border-[var(--border)] bg-[var(--surface-2)] p-0.5">
          {(["all", "online", "active", "blocked"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setStatus(value)}
              className={cn(
                "h-7 rounded-[8px] px-2.5 text-[11.5px] font-medium transition-colors",
                status === value ? "bg-[var(--surface-1)] text-foreground shadow-sm" : "text-[var(--muted-foreground)] hover:text-foreground",
              )}
            >
              {value === "all"
                ? t("admin.statusAll")
                : value === "online"
                  ? t("admin.filterOnline")
                  : value === "active"
                    ? t("admin.statusActive")
                    : t("admin.statusBlocked")}
            </button>
          ))}
        </div>
        <Button size="xs" variant="ghost" onClick={() => void load()}>
          <RefreshCw className="size-3.5" />
          {t("common.refresh")}
        </Button>
      </div>

      {/* User cards list */}
      {filtered.length === 0 ? (
        <div className={cn(CARD, "p-5 text-center text-[12px] text-[var(--muted-foreground)]")}>
          {t("common.none")}
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {filtered.map((user) => (
            <UserActivityCard
              key={user.id}
              user={user}
              expanded={expandedUserId === user.id}
              onToggleExpand={() =>
                setExpandedUserId((cur) => (cur === user.id ? null : user.id))
              }
              onUpdate={(patch) => void update(user, patch)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function UserActivityCard({
  user,
  expanded,
  onToggleExpand,
  onUpdate,
}: {
  user: AdminUser;
  expanded: boolean;
  onToggleExpand: () => void;
  onUpdate: (patch: Record<string, unknown>) => void;
}) {
  const t = useAdminT();
  const [daily, setDaily] = React.useState(user.daily_token_limit?.toString() ?? "");
  const [monthly, setMonthly] = React.useState(user.monthly_token_limit?.toString() ?? "");

  React.useEffect(() => {
    setDaily(user.daily_token_limit?.toString() ?? "");
    setMonthly(user.monthly_token_limit?.toString() ?? "");
  }, [user.daily_token_limit, user.monthly_token_limit]);

  const presence = computePresence(user, t);
  const messagesSent = user.messagesSent ?? user.requests ?? 0;
  const modelsUsed = user.modelsUsed ?? [];
  const isBlocked = user.status === "blocked";

  const saveLimits = () => {
    onUpdate({
      dailyTokenLimit: daily.trim() === "" ? null : Number(daily),
      monthlyTokenLimit: monthly.trim() === "" ? null : Number(monthly),
    });
  };

  return (
    <article
      className={cn(
        CARD,
        "overflow-hidden transition-colors",
        isBlocked && "border-[var(--destructive)]/40 bg-[var(--destructive)]/[0.04]",
      )}
    >
      <div className="flex flex-wrap items-center gap-3 p-3.5">
        {/* Identity */}
        <div className="min-w-[180px] flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="truncate text-[13.5px] font-semibold">
              {user.display_name || user.email.split("@")[0]}
            </p>
            {user.role === "admin" ? (
              <Badge variant="primary" className="text-[10px]">
                {t("auth.admin")}
              </Badge>
            ) : null}
            {isBlocked ? (
              <Badge
                variant="unknown"
                className="border-[var(--destructive)]/45 bg-[var(--destructive)]/14 text-[10px] text-[var(--destructive)]"
              >
                <Ban className="size-2.5" />
                {t("admin.statusBlocked")}
              </Badge>
            ) : null}
          </div>
          <p className="truncate text-[11px] text-[var(--faint)]">
            {user.email} · {t("admin.createdAt")}: {dateLabel(user.created_at)}
          </p>
        </div>

        {/* Presence & Offline Duration */}
        <div
          title={user.last_seen_at ? dateTimeLabel(user.last_seen_at) : t("admin.neverOnline")}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium",
            presence.kind === "online" &&
              "border-[var(--success)]/45 bg-[var(--success)]/12 text-[var(--success)]",
            presence.kind === "recent" &&
              "border-[var(--primary)]/35 bg-[var(--primary)]/10 text-foreground",
            presence.kind === "offline" &&
              "border-[var(--warning)]/40 bg-[var(--warning)]/12 text-[var(--warning)]",
            presence.kind === "long-offline" &&
              "border-[var(--destructive)]/40 bg-[var(--destructive)]/12 text-[var(--destructive)]",
            presence.kind === "never" &&
              "border-[var(--border)] bg-[var(--surface-2)] text-[var(--faint)]",
          )}
        >
          {presence.kind === "online" ? (
            <span className="size-2 animate-pulse rounded-full bg-[var(--success)]" />
          ) : (
            <Clock className="size-3" />
          )}
          <span>{presence.label}</span>
        </div>

        {/* Messages & Tokens */}
        <div className="flex items-center gap-3 text-[11.5px]">
          <div className="flex items-center gap-1.5 rounded-[9px] border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1">
            <MessageSquare className="size-3.5 text-[var(--primary)]" />
            <span className="font-mono font-semibold tabular-nums">{messagesSent.toLocaleString()}</span>
            <span className="text-[10.5px] text-[var(--muted-foreground)]">{t("admin.messages")}</span>
          </div>
          <div className="hidden items-center gap-1 rounded-[9px] border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1 font-mono text-[11px] text-[var(--muted-foreground)] sm:flex">
            {formatTokens(user.totalTokens)}
          </div>
        </div>

        {/* Actions: Block / Unblock + Expand */}
        <div className="flex items-center gap-1.5">
          <Button
            size="xs"
            variant={isBlocked ? "secondary" : "ghost"}
            onClick={() => onUpdate({ status: isBlocked ? "active" : "blocked" })}
            className={cn(
              isBlocked
                ? "border-[var(--success)]/40 text-[var(--success)] hover:bg-[var(--success)]/12"
                : "text-[var(--destructive)] hover:bg-[var(--destructive)]/12 hover:text-[var(--destructive)]",
            )}
          >
            {isBlocked ? <ShieldCheck className="size-3.5" /> : <Ban className="size-3.5" />}
            {isBlocked ? t("admin.unblock") : t("admin.block")}
          </Button>
          <Button size="xs" variant="ghost" onClick={onToggleExpand} aria-expanded={expanded}>
            {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            {t("admin.details")}
          </Button>
        </div>
      </div>

      {/* Inline preview of models used */}
      <div className="flex flex-wrap items-center gap-1.5 border-t border-[var(--border)]/60 bg-[var(--surface-2)]/40 px-3.5 py-2">
        <span className="inline-flex items-center gap-1 text-[10.5px] font-medium text-[var(--muted-foreground)]">
          <Cpu className="size-3" />
          {t("admin.modelsUsed")}:
        </span>
        {modelsUsed.length === 0 ? (
          <span className="text-[11px] text-[var(--faint)]">{t("admin.noModelsUsed")}</span>
        ) : (
          modelsUsed.slice(0, expanded ? modelsUsed.length : 4).map((entry) => (
            <span
              key={`${entry.source}-${entry.model}`}
              title={`${entry.provider} · ${formatTokens(entry.tokens)} · ${dateTimeLabel(entry.lastUsedAt)}`}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px]",
                entry.source === "admin"
                  ? "border-[var(--primary)]/35 bg-[var(--primary)]/10 text-foreground"
                  : "border-[var(--border)] bg-[var(--surface-1)] text-[var(--muted-foreground)]",
              )}
            >
              {entry.source === "admin" ? (
                <Server className="size-2.5 text-[var(--primary)]" />
              ) : (
                <Sparkles className="size-2.5 text-[var(--faint)]" />
              )}
              <span className="max-w-[160px] truncate font-medium">{entry.model}</span>
              <span className="font-mono text-[10px] opacity-80">· {entry.messages}</span>
            </span>
          ))
        )}
        {!expanded && modelsUsed.length > 4 ? (
          <button
            type="button"
            onClick={onToggleExpand}
            className="text-[10.5px] font-medium text-[var(--primary)] hover:underline"
          >
            +{modelsUsed.length - 4}
          </button>
        ) : null}
      </div>

      {/* Expanded full breakdown & token limits */}
      {expanded ? (
        <div className="grid gap-4 border-t border-[var(--border)] bg-[var(--surface-1)]/60 p-3.5 lg:grid-cols-2">
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--faint)]">
              {t("admin.modelsUsed")}
            </p>
            {modelsUsed.length === 0 ? (
              <p className="text-[11.5px] text-[var(--muted-foreground)]">{t("admin.noModelsUsed")}</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {modelsUsed.map((entry) => (
                  <li
                    key={`detail-${entry.source}-${entry.model}`}
                    className="flex items-center justify-between gap-2 rounded-[9px] border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1.5 text-[11.5px]"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{entry.model}</p>
                      <p className="text-[10px] text-[var(--faint)]">
                        {entry.source === "admin" ? t("admin.sourceAdmin") : t("admin.sourceDefault")}
                        {" · "}
                        {entry.provider}
                      </p>
                    </div>
                    <div className="shrink-0 text-right font-mono text-[10.5px]">
                      <p className="font-semibold text-foreground">
                        {t("admin.msgsShort", { n: entry.messages })}
                      </p>
                      <p className="text-[var(--faint)]">{formatTokens(entry.tokens)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-col gap-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--faint)]">
              {t("admin.daily")} / {t("admin.monthly")}
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <Label className="text-[10.5px] text-[var(--muted-foreground)]">{t("admin.daily")}</Label>
                <Input
                  value={daily}
                  onChange={(event) => setDaily(event.target.value.replace(/[^\d]/g, ""))}
                  className="h-8 w-[120px] text-[11.5px]"
                  inputMode="numeric"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-[10.5px] text-[var(--muted-foreground)]">{t("admin.monthly")}</Label>
                <Input
                  value={monthly}
                  onChange={(event) => setMonthly(event.target.value.replace(/[^\d]/g, ""))}
                  className="h-8 w-[120px] text-[11.5px]"
                  inputMode="numeric"
                />
              </div>
              <Button size="xs" variant="secondary" onClick={saveLimits} className="h-8">
                {t("admin.saveLimits")}
              </Button>
            </div>
            <p className="text-[10.5px] text-[var(--faint)]">
              {t("admin.lastSeen")}: {user.last_seen_at ? dateTimeLabel(user.last_seen_at) : t("admin.neverOnline")}
            </p>
          </div>
        </div>
      ) : null}
    </article>
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
