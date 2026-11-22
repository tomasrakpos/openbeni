// providers feature: ProviderCard; change its UI/flow here and keep related state/API calls in sync.
import {
  Activity,
  ChevronDown,
  Copy,
  KeyRound,
  Loader2,
  MoreVertical,
  Pencil,
  Plus,
  RefreshCw,
  Route,
  Star,
  Trash2,
  Zap,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ProviderIcon } from "@/components/ProviderIcon";
import { Sparkline } from "@/components/Sparkline";
import { TierBadge } from "@/components/TierBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { MenuFrame, menuFrameClass } from "@/components/ui/menu-frame";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatLabel } from "@/lib/detect";
import { copyToClipboard } from "@/lib/export";
import { useT } from "@/lib/i18n";
import { latestPing, sparkline } from "@/lib/ping";
import { effectiveTier } from "@/lib/registry";
import { formatRelativeTime } from "@/lib/tokens";
import { cn } from "@/lib/utils";
import { prettyModelName, useProvidersStore } from "@/stores/providers";
import { eligibleFreeModelsForLocalProvider, useRoutersStore } from "@/stores/routers";
import { useCatalogStore } from "@/stores/catalog";
import { useSettingsStore } from "@/stores/settings";
import { useUiStore } from "@/stores/ui";
import type { AIModel, PingResult, Provider } from "@/lib/types";

function pingTone(ping?: PingResult): string {
  if (!ping) return "bg-[var(--faint)]";
  if (!ping.ok) return "bg-[var(--destructive)]";
  if (ping.latencyMs < 800) return "bg-[var(--success)]";
  if (ping.latencyMs < 2500) return "bg-[var(--warning)]";
  return "bg-[var(--destructive)]";
}

function PingMeta({ ping }: { ping?: PingResult }) {
  const lang = useSettingsStore((s) => s.settings.lang);
  const t = useT();
  if (!ping) {
    return <span className="text-[10px] text-[var(--faint)]">{t("providers.neverPinged")}</span>;
  }
  return (
    <span className="flex items-center gap-1.5 text-[10px] text-[var(--muted-foreground)]">
      <span className={cn("size-1.5 rounded-full", pingTone(ping), ping.ok && "status-live")} />
      <span className="font-mono tabular-nums">{ping.ok ? `${ping.latencyMs}ms` : ping.kind}</span>
      <span className="text-[var(--faint)]">{formatRelativeTime(ping.at, lang)}</span>
    </span>
  );
}

export function ProviderCard({
  provider,
  onEditModel,
}: {
  provider: Provider;
  onEditModel: (model: AIModel) => void;
}) {
  const t = useT();
  const lang = useSettingsStore((s) => s.settings.lang);
  const models = useProvidersStore((s) => s.models);
  const pings = useProvidersStore((s) => s.pings);
  const working = useProvidersStore((s) => s.working);
  const pingOne = useProvidersStore((s) => s.pingOne);
  const pingModelById = useProvidersStore((s) => s.pingModelById);
  const setProviderEnabled = useProvidersStore((s) => s.setProviderEnabled);
  const setProviderFavorite = useProvidersStore((s) => s.setProviderFavorite);
  const deleteProvider = useProvidersStore((s) => s.deleteProvider);
  const duplicateProvider = useProvidersStore((s) => s.duplicateProvider);
  const updateModel = useProvidersStore((s) => s.updateModel);
  const deleteModel = useProvidersStore((s) => s.deleteModel);
  const addModels = useProvidersStore((s) => s.addModels);
  const openWizard = useUiStore((s) => s.openWizard);

  const providerModels = models
    .filter((m) => m.providerId === provider.id)
    .sort((a, b) => a.order - b.order || a.displayName.localeCompare(b.displayName));
  const enabledModels = providerModels.filter((m) => m.enabled);
  const ping = latestPing(pings, provider.id);
  const history = sparkline(pings, provider.id);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);
  const [newModel, setNewModel] = React.useState("");
  const [adding, setAdding] = React.useState(false);
  const [routerComposerOpen, setRouterComposerOpen] = React.useState(false);
  const [routerName, setRouterName] = React.useState("");
  const [creatingRouter, setCreatingRouter] = React.useState(false);

  const localRouters = useRoutersStore((s) => s.localRouters);
  const createLocalRouter = useRoutersStore((s) => s.createLocalRouter);
  const deleteLocalRouter = useRoutersStore((s) => s.deleteLocalRouter);
  const catalogModels = useCatalogStore((s) => s.models);

  const freeEligibleModels = React.useMemo(
    () => eligibleFreeModelsForLocalProvider(provider, models),
    [provider, models],
  );
  const providerRouters = React.useMemo(
    () => localRouters.filter((r) => r.providerId === provider.id),
    [localRouters, provider.id],
  );

  const handleCreateRouter = async () => {
    if (creatingRouter) return;
    setCreatingRouter(true);
    try {
      const res = await createLocalRouter({
        provider,
        name: routerName,
        allModels: models,
        extraModelNames: catalogModels.flatMap((m) => [m.id, m.displayName]),
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setRouterName("");
      setRouterComposerOpen(false);
      toast.success(t("router.created"));
    } finally {
      setCreatingRouter(false);
    }
  };

  const add = async () => {
    const id = newModel.trim();
    if (!id) return;
    setAdding(true);
    try {
      const count = await addModels(provider.id, [{ modelId: id, source: "manual" }]);
      if (count > 0) {
        toast.success(t("toast.modelAdded"));
        setNewModel("");
      }
    } finally {
      setAdding(false);
    }
  };

  return (
    <article
      style={{ "--hl": 1 } as React.CSSProperties}
      className={cn(
        menuFrameClass,
        "group overflow-hidden transition-[border-color,box-shadow] duration-200",
        provider.enabled
          ? "hover:border-[color-mix(in_oklab,var(--primary)_26%,var(--border-strong))]"
          : "opacity-70",
      )}
    >
      <div className="flex items-start gap-3 p-4">
        <button
          type="button"
          onClick={() => openWizard(provider.id)}
          className="rounded-[12px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
          aria-label={`${t("providers.edit")}: ${provider.name}`}
        >
          <ProviderIcon icon={provider.icon} name={provider.name} color={provider.color} baseUrl={provider.baseUrl} size={42} water />
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="truncate text-[14px] font-semibold text-foreground">{provider.name}</h3>
            {provider.favorite ? <Star className="size-3.5 fill-[var(--warning)] text-[var(--warning)]" /> : null}
            <Badge variant="accent">{formatLabel(provider.apiFormat)}</Badge>
            {!provider.enabled ? <Badge variant="unknown">{t("common.disable")}</Badge> : null}
          </div>
          <p className="mt-0.5 truncate font-mono text-[10.5px] text-[var(--faint)]">{provider.baseUrl}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="inline-flex items-center gap-1 text-[10.5px] text-[var(--muted-foreground)]">
              <KeyRound
                className={cn(
                  "size-3",
                  provider.managed || provider.hasKey ? "text-[var(--success)]" : "text-[var(--faint)]",
                )}
              />
              {provider.managed
                ? t("providers.managedConnected")
                : provider.hasKey
                  ? t("providers.keyStored")
                  : t("providers.keyMissing")}
            </span>
            <span className="text-[10.5px] text-[var(--faint)]">
              {providerModels.length} {t("providers.modelsLabel")}
            </span>
            <PingMeta ping={ping} />
            {history.length > 1 ? (
              <Sparkline
                values={history.map((item) => item.latencyMs)}
                failures={history.map((item) => !item.ok)}
                width={72}
                height={16}
              />
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={async () => {
                    const result = await pingOne(provider.id);
                    if (result.ok) toast.success(`${provider.name}: ${result.latencyMs}ms`);
                    else toast.error(`${provider.name}: ${result.message ?? result.kind}`);
                  }}
                  disabled={working[provider.id]}
                  aria-label={t("providers.ping")}
                  className="grid size-8 place-items-center rounded-[9px] border border-[var(--border)] bg-[var(--surface-2)] text-[var(--muted-foreground)] transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)] disabled:opacity-50"
                >
                  {working[provider.id] ? <Loader2 className="size-3.5 animate-spin" /> : <Activity className="size-3.5" />}
                </button>
              </TooltipTrigger>
              <TooltipContent>{t("providers.ping")}</TooltipContent>
            </Tooltip>
            <Switch
              checked={provider.enabled}
              onCheckedChange={(value) => void setProviderEnabled(provider.id, value)}
              aria-label={provider.enabled ? t("common.disable") : t("common.enable")}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`${provider.name} menu`}
                  className="grid size-8 place-items-center rounded-[9px] text-[var(--faint)] transition-colors hover:bg-[var(--surface-2)] hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]"
                >
                  <MoreVertical className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel>{provider.name}</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => openWizard(provider.id)}>
                  <Pencil /> {t("providers.edit")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() =>
                    void copyToClipboard(provider.baseUrl).then((ok) =>
                      ok ? toast.success(t("toast.copied")) : toast.error(t("toast.clipboardFailed")),
                    )
                  }
                >
                  <Copy /> {t("providers.baseUrl")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void setProviderFavorite(provider.id, !provider.favorite)}>
                  <Star /> {provider.favorite ? t("common.unpin") : t("models.favorite")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void duplicateProvider(provider.id)}>
                  <Plus /> {t("common.duplicate")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem destructive onSelect={() => setConfirmDelete(true)}>
                  <Trash2 /> {t("common.delete")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            className="inline-flex items-center gap-1 rounded-[7px] px-1.5 py-0.5 text-[10.5px] font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--surface-2)] hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]"
          >
            {expanded ? t("common.close") : t("nav.models")}
            <ChevronDown className={cn("size-3 transition-transform", expanded && "rotate-180")} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-[var(--border)]">
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--faint)]">
              {t("nav.models")} · {enabledModels.length}/{providerModels.length}
            </span>
            <Button size="xs" variant="ghost" onClick={() => openWizard(provider.id)}>
              {t("providers.add")}
            </Button>
          </div>
          <ul className="max-h-[320px] divide-y divide-[var(--border)] overflow-y-auto">
            {providerModels.length === 0 ? (
              <li className="px-4 py-5 text-center text-[11.5px] text-[var(--muted-foreground)]">
                {t("providers.manualModelHint")}
              </li>
            ) : (
              providerModels.map((model) => {
                const modelPing = latestPing(pings, provider.id, model.id);
                const tier = effectiveTier(model, provider);
                return (
                  <li key={model.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-[var(--surface-2)]/50">
                    <Switch
                      checked={model.enabled}
                      onCheckedChange={(value) => void updateModel(model.id, { enabled: value })}
                      aria-label={`${model.displayName}: ${model.enabled ? t("common.disable") : t("common.enable")}`}
                      className="scale-90"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-[12px] text-foreground">{model.displayName}</span>
                        <TierBadge tier={tier} />
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5 font-mono text-[9px] text-[var(--faint)]">
                        <span className="truncate">{model.modelId}</span>
                        {model.contextWindow ? <span>· {model.contextWindow.toLocaleString(lang === "fa" ? "fa-IR" : "en")}</span> : null}
                      </span>
                    </span>
                    <PingMeta ping={modelPing} />
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={async () => {
                            const result = await pingModelById(model.id);
                            if (!result) return;
                            if (result.ok) toast.success(t("providers.testOk", { ms: result.latencyMs }));
                            else toast.error(`${t("providers.testFail")}: ${result.message ?? result.kind}`);
                          }}
                          disabled={working[model.id]}
                          aria-label={t("providers.testModel")}
                          className="grid size-7 place-items-center rounded-[7px] text-[var(--faint)] transition-colors hover:bg-[var(--surface-2)] hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)] disabled:opacity-40"
                        >
                          {working[model.id] ? <Loader2 className="size-3 animate-spin" /> : <Zap className="size-3" />}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{t("providers.testModel")}</TooltipContent>
                    </Tooltip>
                    <button
                      type="button"
                      onClick={() => onEditModel(model)}
                      aria-label={`${t("common.edit")} ${model.displayName}`}
                      className="grid size-7 place-items-center rounded-[7px] text-[var(--faint)] transition-colors hover:bg-[var(--surface-2)] hover:text-foreground"
                    >
                      <Pencil className="size-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteModel(model.id)}
                      aria-label={`${t("common.delete")} ${model.displayName}`}
                      className="grid size-7 place-items-center rounded-[7px] text-[var(--faint)] transition-colors hover:bg-[var(--destructive-soft)] hover:text-[var(--destructive)]"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </li>
                );
              })
            )}
          </ul>
          <div className="flex items-center gap-2 border-t border-[var(--border)] px-3 py-2">
            <Input
              value={newModel}
              onChange={(event) => setNewModel(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void add();
              }}
              placeholder={t("providers.manualModel")}
              className="h-7 flex-1 font-mono text-[11px]"
              aria-label={t("providers.manualModel")}
            />
            <Button size="xs" variant="secondary" onClick={add} disabled={!newModel.trim() || adding}>
              {adding ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />}
              {t("providers.addModel")}
            </Button>
          </div>

          <div className="border-t border-[var(--border)] bg-[var(--surface-2)]/30 px-3 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-foreground">
                <Route className="size-3.5 text-[var(--primary)]" />
                <span>{t("router.createFromFree")}</span>
                <Badge variant="unknown" className="text-[10px]">
                  {t("router.activeCount", { n: freeEligibleModels.length })}
                </Badge>
              </div>
              <Button
                size="xs"
                variant="secondary"
                disabled={freeEligibleModels.length === 0}
                title={freeEligibleModels.length === 0 ? t("router.noFreeModels") : undefined}
                onClick={() => setRouterComposerOpen((open) => !open)}
              >
                <Route className="size-3" />
                {t("router.create")}
              </Button>
            </div>

            {freeEligibleModels.length === 0 && (
              <p className="mt-1.5 text-[11px] text-[var(--muted-foreground)]">
                {t("router.noFreeModels")}
              </p>
            )}

            {routerComposerOpen && freeEligibleModels.length > 0 && (
              <div className="mt-2 flex flex-col gap-1.5">
                <div className="flex items-center gap-1.5">
                  <Input
                    value={routerName}
                    onChange={(event) => setRouterName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void handleCreateRouter();
                    }}
                    placeholder={t("router.namePlaceholder")}
                    maxLength={32}
                    className="h-7 flex-1 text-[11.5px]"
                    aria-label={t("router.nameLabel")}
                  />
                  <Button
                    size="xs"
                    onClick={() => void handleCreateRouter()}
                    disabled={creatingRouter || routerName.trim().length < 2}
                  >
                    {creatingRouter ? <Loader2 className="size-3 animate-spin" /> : t("router.create")}
                  </Button>
                </div>
                <span className="text-[10.5px] text-[var(--faint)]">{t("router.nameHint")}</span>
              </div>
            )}

            {providerRouters.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1">
                {providerRouters.map((router) => (
                  <li
                    key={router.id}
                    className="flex items-center justify-between gap-2 rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-2.5 py-1.5 text-[11.5px]"
                  >
                    <div className="flex min-w-0 items-center gap-1.5">
                      <Route className="size-3.5 shrink-0 text-[var(--primary)]" />
                      <span className="truncate font-medium text-foreground">{router.name}</span>
                      <Badge variant="primary" className="text-[9.5px]">
                        {t("router.badge")}
                      </Badge>
                      <span className="text-[10.5px] text-[var(--muted-foreground)]">
                        {freeEligibleModels.length > 0
                          ? t("router.activeCount", { n: freeEligibleModels.length })
                          : t("router.disabledEmpty")}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        void deleteLocalRouter(router.id);
                        toast.success(t("router.deleted"));
                      }}
                      aria-label={t("common.delete")}
                      className="grid size-6 place-items-center rounded-[6px] text-[var(--faint)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--destructive)]"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t("common.delete")}
        description={t("providers.deleteConfirm", { name: provider.name })}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        destructive
        onConfirm={async () => {
          await deleteProvider(provider.id);
          toast.success(t("providers.deleted"));
        }}
      />
    </article>
  );
}

export function ProviderModelRowSkeleton() {
  return (
    <MenuFrame style={{ "--hl": 1 } as React.CSSProperties} className="flex animate-pulse items-center gap-3 p-4">
      <span className="size-[42px] rounded-[12px] bg-[var(--surface-2)]" />
      <div className="flex-1 space-y-2">
        <span className="block h-3 w-32 rounded bg-[var(--surface-2)]" />
        <span className="block h-2.5 w-52 rounded bg-[var(--surface-2)]" />
      </div>
    </MenuFrame>
  );
}
