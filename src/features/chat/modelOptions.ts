// chat feature: modelOptions; change its UI/flow here and keep related state/API calls in sync.
import type { PromptComposerModel } from "@/components/ui/prompt-composer";
import { isBundledProvider, providerDisplayName } from "@/lib/bundled";
import { isSameModel, modelIdentityKeys } from "@/lib/modelRoutes";
import { effectiveTier, tierSortRank } from "@/lib/registry";
import { isAdminPublicRouter, type CombinedRouterItem } from "@/stores/routers";
import type { AIModel, Provider } from "@/lib/types";

/**
 * Enabled models from enabled providers, ordered with Free Model Routers and
 * FREE models FIRST at the top of the chat menu, followed by unclassified models
 * and PAID models below.
 */
export function buildComposerModels(
  providers: Provider[],
  models: AIModel[],
  routers: readonly CombinedRouterItem[] = [],
  lang: "en" | "fa" = "en",
): PromptComposerModel[] {
  const providerMap = new Map(
    providers
      .filter((provider) => provider.enabled)
      .map((provider) => [provider.id, provider]),
  );
  const orderedProviders = [...providerMap.values()].sort(
    (a, b) => Number(b.favorite) - Number(a.favorite) || a.order - b.order,
  );
  const providerRank = new Map(orderedProviders.map((provider, idx) => [provider.id, idx]));

  const userRouterOptions: PromptComposerModel[] = [];
  const adminNativeOptions: PromptComposerModel[] = [];

  for (const r of routers) {
    if (!r.enabled) continue;
    const empty = r.activeMemberCount === 0;
    if (isAdminPublicRouter(r)) {
      // Admin public routers appear on the public site as native OpenHarneks
      // models: custom admin name + native brand icon, no router badge/icon
      // and no underlying provider or member count exposed.
      adminNativeOptions.push({
        id: r.selectionId,
        label: r.name,
        note: "OpenHarneks",
        tier: "free",
        userAdded: false,
        isRouter: false,
        isNativeBrand: true,
        disabled: empty,
      });
    } else {
      const countText = empty
        ? lang === "fa"
          ? "بدون مدل فعال"
          : "No active models"
        : lang === "fa"
          ? `${r.activeMemberCount} مدل فعال`
          : `${r.activeMemberCount} active`;
      userRouterOptions.push({
        id: r.selectionId,
        label: r.name,
        note: countText,
        tier: "free",
        userAdded: true,
        isRouter: true,
        routerActiveCount: r.activeMemberCount,
        disabled: empty,
      });
    }
  }

  const seen = new Set<string>();
  const collected: {
    option: PromptComposerModel;
    tierRank: number;
    providerIdx: number;
    favorite: boolean;
    order: number;
  }[] = [];

  for (const provider of orderedProviders) {
    const userAdded = !isBundledProvider(provider) && !provider.managed;
    const providerModels = models
      // Locked site models stay visible in the model picker with a Paid badge,
      // but they must never be selectable here.
      .filter((model) => model.enabled && !model.locked && model.providerId === provider.id)
      .sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.order - b.order);

    for (const model of providerModels) {
      const identity = modelIdentityKeys(model)[0] ?? model.id;
      if (seen.has(identity)) continue;
      seen.add(identity);
      const tier = effectiveTier(model, provider);
      collected.push({
        option: {
          id: model.id,
          label: model.displayName,
          note: providerDisplayName(provider),
          tier,
          userAdded,
        },
        // Free models always appear FIRST at the top of the menu; paid models below.
        tierRank: tierSortRank(tier),
        providerIdx: providerRank.get(provider.id) ?? 999,
        favorite: Boolean(model.favorite),
        order: model.order,
      });
    }
  }

  collected.sort(
    (a, b) =>
      a.tierRank - b.tierRank ||
      a.providerIdx - b.providerIdx ||
      Number(b.favorite) - Number(a.favorite) ||
      a.order - b.order,
  );

  return [...userRouterOptions, ...adminNativeOptions, ...collected.map((entry) => entry.option)];
}

/**
 * The chat may still point at a gateway row that was folded into a visible
 * duplicate, or at an active Free Model Router (`router::...`).
 */
export function resolveComposerModelId(
  options: PromptComposerModel[],
  models: AIModel[],
  id: string,
): string {
  const direct = id ? options.find((option) => option.id === id) : undefined;
  if (direct && !direct.disabled) return direct.id;
  const selected = id ? models.find((model) => model.id === id) : undefined;
  if (selected) {
    const match = options.find((option) => {
      if (option.disabled) return false;
      const candidate = models.find((model) => model.id === option.id);
      return candidate ? isSameModel(selected, candidate) : false;
    });
    if (match) return match.id;
  }
  return options.find((option) => !option.disabled)?.id ?? options[0]?.id ?? "";
}
