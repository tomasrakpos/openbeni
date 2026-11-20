// chat feature: modelOptions; change its UI/flow here and keep related state/API calls in sync.
import type { PromptComposerModel } from "@/components/ui/prompt-composer";
import { providerDisplayName } from "@/lib/bundled";
import { isSameModel, modelIdentityKeys } from "@/lib/modelRoutes";
import type { AIModel, Provider } from "@/lib/types";

/**
 * Enabled models from enabled providers, ordered like the model picker:
 * favourite providers first, then provider order, then favourite models.
 *
 * A logical model can be served by several bundled gateways. Show it once and
 * label the row with the site name; the send path queues the other gateways as
 * automatic fallbacks if this one hits a limit.
 */
export function buildComposerModels(providers: Provider[], models: AIModel[]): PromptComposerModel[] {
  const providerMap = new Map(
    providers
      .filter((provider) => provider.enabled)
      .map((provider) => [provider.id, provider]),
  );
  const orderedProviders = [...providerMap.values()].sort(
    (a, b) => Number(b.favorite) - Number(a.favorite) || a.order - b.order,
  );

  const seen = new Set<string>();
  const out: PromptComposerModel[] = [];
  for (const provider of orderedProviders) {
    const providerModels = models
      // Locked site models stay visible in the model picker with a Paid badge,
      // but they must never be selectable here.
      .filter((model) => model.enabled && !model.locked && model.providerId === provider.id)
      .sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.order - b.order);
    for (const model of providerModels) {
      const identity = modelIdentityKeys(model)[0] ?? model.id;
      if (seen.has(identity)) continue;
      seen.add(identity);
      out.push({
        id: model.id,
        label: model.displayName,
        note: providerDisplayName(provider),
      });
    }
  }
  return out;
}

/**
 * The chat may still point at a gateway row that was folded into a visible
 * duplicate. Map it by model identity so the pill shows the same model.
 */
export function resolveComposerModelId(
  options: PromptComposerModel[],
  models: AIModel[],
  id: string,
): string {
  if (id && options.some((option) => option.id === id)) return id;
  const selected = id ? models.find((model) => model.id === id) : undefined;
  if (selected) {
    const match = options.find((option) => {
      const candidate = models.find((model) => model.id === option.id);
      return candidate ? isSameModel(selected, candidate) : false;
    });
    if (match) return match.id;
  }
  return options[0]?.id ?? "";
}
