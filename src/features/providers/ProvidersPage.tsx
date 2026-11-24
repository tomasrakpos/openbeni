// providers feature: ProvidersPage; connects ProviderManager to providers, models, and local routers stores.
import { Plus } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ProviderIcon } from "@/components/ProviderIcon";
import { GlowButton } from "@/components/ui/glow-button";
import { MenuFrame } from "@/components/ui/menu-frame";
import { ModelEditor } from "@/features/models/ModelEditor";
import {
  ProviderManager,
  type PProvider,
  type PRouter,
} from "@/features/providers/ProviderManager";
import { isBundledProvider } from "@/lib/bundled";
import { formatLabel } from "@/lib/detect";
import { copyToClipboard } from "@/lib/export";
import { useT } from "@/lib/i18n";
import { latestPing } from "@/lib/ping";
import { loadProviderWizard } from "@/lib/preload";
import { effectiveTier } from "@/lib/registry";
import type { AIModel, Provider } from "@/lib/types";
import { useCatalogStore } from "@/stores/catalog";
import { useProvidersStore } from "@/stores/providers";
import {
  eligibleFreeModelsForLocalProviders,
  localRouterProviderIds,
  useRoutersStore,
} from "@/stores/routers";
import { useSettingsStore } from "@/stores/settings";
import { useUiStore } from "@/stores/ui";

const MENU_HL = { "--hl": 1 } as React.CSSProperties;

export function ProvidersPage() {
  const t = useT();
  const lang = useSettingsStore((s) => s.settings.lang);
  const providers = useProvidersStore((s) => s.providers);
  const models = useProvidersStore((s) => s.models);
  const pings = useProvidersStore((s) => s.pings);
  const loading = useProvidersStore((s) => s.loading);
  const working = useProvidersStore((s) => s.working);
  const pingAll = useProvidersStore((s) => s.pingAll);
  const pingOne = useProvidersStore((s) => s.pingOne);
  const pingModelById = useProvidersStore((s) => s.pingModelById);
  const setProviderEnabled = useProvidersStore((s) => s.setProviderEnabled);
  const setProviderFavorite = useProvidersStore((s) => s.setProviderFavorite);
  const duplicateProvider = useProvidersStore((s) => s.duplicateProvider);
  const deleteProvider = useProvidersStore((s) => s.deleteProvider);
  const updateModel = useProvidersStore((s) => s.updateModel);
  const deleteModel = useProvidersStore((s) => s.deleteModel);
  const addModels = useProvidersStore((s) => s.addModels);
  const openWizard = useUiStore((s) => s.openWizard);

  const localRouters = useRoutersStore((s) => s.localRouters);
  const createLocalRouter = useRoutersStore((s) => s.createLocalRouter);
  const toggleLocalRouter = useRoutersStore((s) => s.toggleLocalRouter);
  const deleteLocalRouter = useRoutersStore((s) => s.deleteLocalRouter);
  const catalogModels = useCatalogStore((s) => s.models);

  const [editingModel, setEditingModel] = React.useState<AIModel | null>(null);
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [pingingAll, setPingingAll] = React.useState(false);
  const [confirmDeleteProvider, setConfirmDeleteProvider] = React.useState<Provider | null>(null);

  const warmWizard = React.useCallback(() => {
    void loadProviderWizard();
  }, []);

  const sorted = React.useMemo(
    () =>
      providers
        .filter((provider) => !isBundledProvider(provider))
        .sort(
          (a, b) => Number(b.favorite) - Number(a.favorite) || a.order - b.order || a.name.localeCompare(b.name),
        ),
    [providers],
  );

  const providerMap = React.useMemo(() => new Map(sorted.map((p) => [p.id, p])), [sorted]);
  const modelMap = React.useMemo(() => new Map(models.map((m) => [m.id, m])), [models]);

  const viewProviders: PProvider[] = React.useMemo(
    () =>
      sorted.map((provider) => {
        const providerPing = latestPing(pings, provider.id);
        const providerModels = models
          .filter((m) => m.providerId === provider.id)
          .sort((a, b) => a.order - b.order || a.displayName.localeCompare(b.displayName))
          .map((m) => {
            const mPing = latestPing(pings, provider.id, m.id);
            const tier = effectiveTier(m, provider);
            return {
              id: m.id,
              modelId: m.modelId,
              name: m.displayName,
              pricing: tier,
              context: m.contextWindow,
              enabled: m.enabled,
              latencyMs: mPing?.ok ? mPing.latencyMs : null,
              failed: mPing ? !mPing.ok : false,
            };
          });

        return {
          id: provider.id,
          name: provider.name,
          baseUrl: provider.baseUrl,
          format: formatLabel(provider.apiFormat),
          color: provider.color ?? "#8b7bff",
          icon: provider.icon,
          enabled: provider.enabled,
          keyStored: Boolean(provider.hasKey),
          managed: provider.managed,
          favorite: provider.favorite,
          latencyMs: providerPing?.ok ? providerPing.latencyMs : null,
          failed: providerPing ? !providerPing.ok : false,
          models: providerModels,
        };
      }),
    [sorted, models, pings],
  );

  const viewRouters: PRouter[] = React.useMemo(
    () =>
      localRouters.map((router) => {
        const pIds = localRouterProviderIds(router);
        const attached = pIds
          .map((pid) => providerMap.get(pid))
          .filter((p): p is Provider => Boolean(p));
        return {
          id: router.id,
          name: router.name,
          providerId: router.providerId,
          providerIds: pIds,
          providerNames: attached.map((p) => p.name),
          members: eligibleFreeModelsForLocalProviders(attached, models).length,
          enabled: router.enabled,
        };
      }),
    [localRouters, providerMap, models],
  );

  const anyWorking = Object.values(working).some(Boolean);

  const runPingAll = async () => {
    if (pingingAll || anyWorking || sorted.every((p) => !p.enabled)) return;
    setPingingAll(true);
    try {
      await pingAll();
      toast.success(t("toast.pingDone"));
    } finally {
      setPingingAll(false);
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="page-rise mx-auto w-full max-w-[860px] px-4 pb-20 pt-5 sm:px-6 sm:pt-7">
        {loading && sorted.length === 0 ? (
          <div className="mx-auto max-w-[780px] space-y-3">
            {[0, 1, 2].map((index) => (
              <MenuFrame key={index} style={MENU_HL} className="flex animate-pulse items-center gap-3 p-4">
                <span className="size-[44px] rounded-[13px] bg-[var(--surface-2)]" />
                <div className="flex-1 space-y-2">
                  <span className="block h-3 w-36 rounded bg-[var(--surface-2)]" />
                  <span className="block h-2.5 w-56 rounded bg-[var(--surface-2)]" />
                </div>
              </MenuFrame>
            ))}
          </div>
        ) : !loading && sorted.length === 0 ? (
          <MenuFrame style={MENU_HL} className="relative mx-auto max-w-[780px] overflow-hidden">
            <div className="absolute inset-0 bg-[radial-gradient(28rem_18rem_at_50%_-20%,var(--primary-soft),transparent_70%)]" />
            <div className="relative flex flex-col items-center px-6 py-14 text-center">
              <div className="flex -space-x-2.5">
                {["OpenAI", "Anthropic", "Google", "Groq"].map((name) => (
                  <ProviderIcon key={name} name={name} size={38} water className="ring-2 ring-[var(--surface-1)]" />
                ))}
              </div>
              <h2 className="mt-5 text-[17px] font-semibold text-foreground">{t("providers.empty")}</h2>
              <p className="mt-1.5 max-w-[460px] text-balance text-[12.5px] leading-relaxed text-[var(--muted-foreground)]">
                {t("providers.emptyDesc")}
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                <GlowButton
                  size="sm"
                  icon={<Plus />}
                  onClick={() => openWizard()}
                  onPointerEnter={warmWizard}
                  onFocus={warmWizard}
                  aria-haspopup="dialog"
                >
                  {t("providers.add")}
                </GlowButton>
              </div>
            </div>
          </MenuFrame>
        ) : (
          <ProviderManager
            providers={viewProviders}
            routers={viewRouters}
            lang={lang}
            pingingAll={pingingAll || anyWorking}
            working={working}
            onAddProvider={() => openWizard()}
            onWarmAddProvider={warmWizard}
            onPingAll={() => void runPingAll()}
            onToggleProvider={(providerId) => {
              const target = providerMap.get(providerId);
              if (target) void setProviderEnabled(providerId, !target.enabled);
            }}
            onPingProvider={async (providerId) => {
              const target = providerMap.get(providerId);
              if (!target) return;
              const result = await pingOne(providerId);
              if (result.ok) toast.success(`${target.name}: ${result.latencyMs}ms`);
              else toast.error(`${target.name}: ${result.message ?? result.kind}`);
            }}
            onEditProvider={(providerId) => openWizard(providerId)}
            onCopyBaseUrl={(_providerId, baseUrl) => {
              void copyToClipboard(baseUrl).then((ok) =>
                ok ? toast.success(t("toast.copied")) : toast.error(t("toast.clipboardFailed")),
              );
            }}
            onToggleFavorite={(providerId) => {
              const target = providerMap.get(providerId);
              if (target) void setProviderFavorite(providerId, !target.favorite);
            }}
            onDuplicateProvider={(providerId) => void duplicateProvider(providerId)}
            onDeleteProvider={(providerId) => {
              const target = providerMap.get(providerId);
              if (target) setConfirmDeleteProvider(target);
            }}
            onToggleModel={(_providerId, modelId) => {
              const target = modelMap.get(modelId);
              if (target) void updateModel(modelId, { enabled: !target.enabled });
            }}
            onPingModel={async (_providerId, modelId) => {
              const result = await pingModelById(modelId);
              if (!result) return;
              if (result.ok) toast.success(t("providers.testOk", { ms: result.latencyMs }));
              else toast.error(`${t("providers.testFail")}: ${result.message ?? result.kind}`);
            }}
            onEditModel={(_providerId, modelId) => {
              const target = modelMap.get(modelId);
              if (!target) return;
              setEditingModel(target);
              setEditorOpen(true);
            }}
            onDeleteModel={(_providerId, modelId) => void deleteModel(modelId)}
            onAddModel={async (providerId, rawModelId) => {
              const count = await addModels(providerId, [{ modelId: rawModelId, source: "manual" }]);
              if (count > 0) toast.success(t("toast.modelAdded"));
            }}
            onCreateRouter={async (providerId, name) => {
              const provider = providerMap.get(providerId);
              if (!provider) throw new Error(t("common.error"));
              const res = await createLocalRouter({
                provider,
                name,
                allModels: models,
                extraModelNames: catalogModels.flatMap((m) => [m.id, m.displayName]),
              });
              if (!res.ok) throw new Error(res.error);
              toast.success(t("router.created"));
            }}
            onCreateMultiRouter={async (providerIds, name) => {
              const selectedProviders = providerIds
                .map((pid) => providerMap.get(pid))
                .filter((p): p is Provider => Boolean(p));
              const res = await createLocalRouter({
                providers: selectedProviders,
                name,
                allModels: models,
                extraModelNames: catalogModels.flatMap((m) => [m.id, m.displayName]),
              });
              if (!res.ok) throw new Error(res.error);
              toast.success(t("router.created"));
            }}
            onToggleRouter={(routerId, enabled) => void toggleLocalRouter(routerId, enabled)}
            onDeleteRouter={(routerId) => {
              void deleteLocalRouter(routerId);
              toast.success(t("router.deleted"));
            }}
          />
        )}
      </div>

      <ModelEditor model={editingModel} open={editorOpen} onOpenChange={setEditorOpen} />

      <ConfirmDialog
        open={Boolean(confirmDeleteProvider)}
        onOpenChange={(open) => {
          if (!open) setConfirmDeleteProvider(null);
        }}
        title={t("common.delete")}
        description={
          confirmDeleteProvider ? t("providers.deleteConfirm", { name: confirmDeleteProvider.name }) : ""
        }
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        destructive
        onConfirm={async () => {
          if (!confirmDeleteProvider) return;
          await deleteProvider(confirmDeleteProvider.id);
          setConfirmDeleteProvider(null);
          toast.success(t("providers.deleted"));
        }}
      />
    </div>
  );
}
