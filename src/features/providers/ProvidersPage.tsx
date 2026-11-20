// providers feature: ProvidersPage; change its UI/flow here and keep related state/API calls in sync.
import { Activity, AlertTriangle, Cpu, Info, Plus, Search, Server, Zap } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { ProviderIcon } from "@/components/ProviderIcon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProviderCard } from "@/features/providers/ProviderCard";
import { ModelEditor } from "@/features/models/ModelEditor";
import { isBundledProvider } from "@/lib/bundled";
import { useT } from "@/lib/i18n";
import { latestPing } from "@/lib/ping";
import { cn } from "@/lib/utils";
import { useProvidersStore } from "@/stores/providers";
import { useUiStore } from "@/stores/ui";
import type { AIModel } from "@/lib/types";

function StatCard({
  label,
  value,
  hint,
  icon,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  icon: React.ReactNode;
  tone?: "primary" | "success" | "accent";
}) {
  const colors =
    tone === "success"
      ? "text-[var(--success)] bg-[var(--success-soft)]"
      : tone === "accent"
        ? "text-[var(--accent)] bg-[var(--accent-soft)]"
        : "text-[var(--primary)] bg-[var(--primary-soft)]";
  return (
    <div className="surface-card flex items-center gap-3 p-3.5">
      <span className={cn("grid size-9 shrink-0 place-items-center rounded-[11px]", colors)}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--faint)]">
          {label}
        </span>
        <span className="mt-0.5 flex items-baseline gap-1.5">
          <span className="text-[17px] font-semibold leading-none tabular-nums text-foreground">{value}</span>
          <span className="truncate text-[10.5px] text-[var(--muted-foreground)]">{hint}</span>
        </span>
      </span>
    </div>
  );
}

function ProviderAddButton() {
  const t = useT();
  const openWizard = useUiStore((s) => s.openWizard);
  return (
    <Button size="sm" onClick={() => openWizard()} aria-haspopup="dialog">
      <Plus className="size-3.5" /> {t("providers.add")}
    </Button>
  );
}

export function ProvidersPage() {
  const t = useT();
  const providers = useProvidersStore((s) => s.providers);
  const models = useProvidersStore((s) => s.models);
  const pings = useProvidersStore((s) => s.pings);
  const loading = useProvidersStore((s) => s.loading);
  const working = useProvidersStore((s) => s.working);
  const pingAll = useProvidersStore((s) => s.pingAll);

  const [query, setQuery] = React.useState("");
  const [editingModel, setEditingModel] = React.useState<AIModel | null>(null);
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [pingingAll, setPingingAll] = React.useState(false);

  const sorted = React.useMemo(
    () =>
      providers
        .filter((provider) => !isBundledProvider(provider))
        .sort(
          (a, b) => Number(b.favorite) - Number(a.favorite) || a.order - b.order || a.name.localeCompare(b.name),
        ),
    [providers],
  );

  // Bundled gateways are project-owned: they power the model list but never
  // appear as accounts the user can edit or delete.
  const visibleModels = React.useMemo(() => {
    const ids = new Set(sorted.map((provider) => provider.id));
    return models.filter((model) => ids.has(model.providerId));
  }, [models, sorted]);

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return sorted;
    return sorted.filter((provider) => {
      if (provider.name.toLowerCase().includes(needle)) return true;
      if (provider.baseUrl.toLowerCase().includes(needle)) return true;
      return visibleModels.some(
        (model) =>
          model.providerId === provider.id &&
          (model.displayName.toLowerCase().includes(needle) || model.modelId.toLowerCase().includes(needle)),
      );
    });
  }, [visibleModels, query, sorted]);

  const enabledProviders = sorted.filter((provider) => provider.enabled);
  const enabledModels = visibleModels.filter((model) => model.enabled);
  const online = sorted.filter((provider) => latestPing(pings, provider.id)?.ok).length;
  const anyWorking = Object.values(working).some(Boolean);

  const runPingAll = async () => {
    if (enabledProviders.length === 0) return;
    setPingingAll(true);
    try {
      await pingAll();
      toast.success(t("toast.pingDone"));
    } finally {
      setPingingAll(false);
    }
  };

  const editModel = (model: AIModel) => {
    setEditingModel(model);
    setEditorOpen(true);
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[1080px] px-4 pb-16 pt-5 sm:px-6 sm:pt-7">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="grid size-8 place-items-center rounded-[10px] border border-[var(--border)] bg-[var(--surface-1)] text-[var(--primary)] shadow-xs">
                <Server className="size-4" />
              </span>
              <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-foreground sm:text-[26px]">
                {t("providers.title")}
              </h1>
              <Badge variant="primary" className="hidden sm:inline-flex">
                {sorted.length}
              </Badge>
            </div>
            <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--muted-foreground)]">
              {t("providers.subtitle")}{" "}
              <span className="text-[var(--faint)]">{t("capture.working")}.</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={runPingAll}
              disabled={pingingAll || anyWorking || enabledProviders.length === 0}
            >
              {pingingAll ? <Activity className="size-3.5 animate-pulse" /> : <Zap className="size-3.5" />}
              {pingingAll ? t("providers.pinging") : t("providers.pingAll")}
            </Button>
            <ProviderAddButton />
          </div>
        </header>

        {sorted.length > 0 && (
          <>
            <div className="mt-5 grid gap-2.5 sm:grid-cols-3">
              <StatCard
                label={t("providers.title")}
                value={String(sorted.length)}
                hint={`${enabledProviders.length} ${t("common.enabled").toLowerCase()}`}
                icon={<Server className="size-4" />}
              />
              <StatCard
                label={t("nav.models")}
                value={String(visibleModels.length)}
                hint={`${enabledModels.length} ${t("common.enabled").toLowerCase()}`}
                icon={<Cpu className="size-4" />}
                tone="accent"
              />
              <StatCard
                label={t("providers.lastPing")}
                value={String(online)}
                hint={`/ ${sorted.length} ${t("common.status").toLowerCase()}`}
                icon={<Activity className="size-4" />}
                tone="success"
              />
            </div>

            <div className="relative mt-4">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[var(--faint)]" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={`${t("common.search")} ${t("providers.title").toLowerCase()}, ${t("nav.models").toLowerCase()}…`}
                className="h-9 pl-9 text-[12.5px]"
                aria-label={t("common.search")}
              />
            </div>
          </>
        )}

        <div className="mt-4 space-y-3">
          {loading && sorted.length === 0
            ? [0, 1, 2].map((index) => (
                <div key={index} className="surface-card flex animate-pulse items-center gap-3 p-4">
                  <span className="size-[42px] rounded-[12px] bg-[var(--surface-2)]" />
                  <div className="flex-1 space-y-2">
                    <span className="block h-3 w-36 rounded bg-[var(--surface-2)]" />
                    <span className="block h-2.5 w-56 rounded bg-[var(--surface-2)]" />
                  </div>
                </div>
              ))
            : null}

          {!loading && sorted.length === 0 ? (
            <div className="surface-card relative overflow-hidden">
              <div className="absolute inset-0 bg-[radial-gradient(28rem_18rem_at_50%_-20%,var(--primary-soft),transparent_70%)]" />
              <div className="relative flex flex-col items-center px-6 py-14 text-center">
                <div className="flex -space-x-2.5">
                  {["OpenAI", "Anthropic", "Google", "Groq"].map((name) => (
                    <ProviderIcon key={name} name={name} size={38} className="ring-2 ring-[var(--surface-1)]" />
                  ))}
                </div>
                <h2 className="mt-5 text-[17px] font-semibold text-foreground">{t("providers.empty")}</h2>
                <p className="mt-1.5 max-w-[460px] text-balance text-[12.5px] leading-relaxed text-[var(--muted-foreground)]">
                  {t("providers.emptyDesc")}
                </p>
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  <ProviderAddButton />
                </div>
                <p className="mt-5 max-w-[420px] text-[10.5px] leading-relaxed text-[var(--faint)]">
                  {t("providers.apiKeyHint")}
                </p>
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="surface-card flex flex-col items-center gap-2 px-6 py-12 text-center">
              <AlertTriangle className="size-5 text-[var(--warning)]" />
              <p className="text-[13px] font-medium text-foreground">{t("palette.noResults")}</p>
              <p className="text-[11.5px] text-[var(--muted-foreground)]">{query}</p>
              <Button variant="ghost" size="sm" onClick={() => setQuery("")}>
                {t("common.refresh")}
              </Button>
            </div>
          ) : (
            filtered.map((provider) => (
              <ProviderCard key={provider.id} provider={provider} onEditModel={editModel} />
            ))
          )}
        </div>

        {sorted.length > 0 && (
          <div className="mt-8 flex items-start gap-2 rounded-[13px] border border-[var(--border)] bg-[var(--surface-1)]/60 px-3.5 py-3">
            <Info className="mt-0.5 size-3.5 shrink-0 text-[var(--primary)]" />
            <p className="text-[11px] leading-relaxed text-[var(--muted-foreground)]">
              {t("models.tierSource")} · {t("providers.apiKeyHint")}
            </p>
          </div>
        )}
      </div>

      <ModelEditor model={editingModel} open={editorOpen} onOpenChange={setEditorOpen} />
    </div>
  );
}
