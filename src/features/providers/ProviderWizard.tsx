// providers feature: ProviderWizard adapter; keeps the existing save/detect logic.
import * as React from "react";
import { toast } from "sonner";
import {
  ProviderWizard as ProviderWizardUI,
  type DetectModelsOutput,
  type ProviderDraft as WizardDraft,
  type ProviderPreset as WizardPreset,
} from "@/components/ui/provider-wizard";
import { PROVIDER_PRESETS, presetById } from "@/data/presets";
import { listModels } from "@/lib/chatClient";
import { detectFormat } from "@/lib/detect";
import { normalizeBaseUrl } from "@/lib/normalize";
import {
  inspectProviderEndpoint,
  type InspectedModelInfo,
} from "@/lib/providerInspectClient";
import { suggestedMeta } from "@/lib/registry";
import {
  prettyModelName,
  useProvidersStore,
  type ModelDraft,
  type ProviderDraft,
} from "@/stores/providers";
import { useSettingsStore } from "@/stores/settings";
import { useUiStore } from "@/stores/ui";
import type { ApiFormat, Capability, Provider } from "@/lib/types";

function defaultAuthFor(format: ApiFormat): Provider["auth"] {
  if (format === "anthropic") return { header: "x-api-key", prefix: "" };
  if (format === "gemini") return { header: "x-goog-api-key", prefix: "" };
  return { header: "Authorization", prefix: "Bearer " };
}

const PRESETS: WizardPreset[] = PROVIDER_PRESETS.map((preset) => ({
  id: preset.id,
  name: preset.name,
  baseUrl: preset.baseUrl,
  color: preset.color,
  format: preset.apiFormat === "custom" ? "auto" : preset.apiFormat,
  local: preset.local,
  icon: preset.icon,
}));

function concreteFormat(format: WizardDraft["format"], fallback: ApiFormat = "openai"): ApiFormat {
  return format === "auto" ? fallback : format;
}

export function ProviderWizard() {
  const open = useUiStore((s) => s.wizardOpen);
  const editingId = useUiStore((s) => s.wizardProviderId);
  const close = useUiStore((s) => s.closeWizard);
  const providers = useProvidersStore((s) => s.providers);
  const models = useProvidersStore((s) => s.models);
  const createProvider = useProvidersStore((s) => s.createProvider);
  const updateProvider = useProvidersStore((s) => s.updateProvider);
  const addModels = useProvidersStore((s) => s.addModels);
  const applyModelPricing = useProvidersStore((s) => s.applyModelPricing);
  const getKey = useProvidersStore((s) => s.getKey);
  const proxyUrl = useSettingsStore((s) => s.settings.proxyUrl);

  const editing = editingId ? providers.find((p) => p.id === editingId) : undefined;

  const [detected, setDetected] = React.useState<{ format: ApiFormat; baseUrl: string } | null>(null);
  const inspectedModelsRef = React.useRef<Map<string, InspectedModelInfo>>(new Map());

  React.useEffect(() => {
    setDetected(null);
    inspectedModelsRef.current.clear();
  }, [open, editingId]);

  const resolveKey = React.useCallback(
    async (apiKey: string): Promise<string> => {
      if (apiKey) return apiKey;
      if (editing?.id) {
        try {
          return (await getKey(editing.id)) ?? "";
        } catch {
          return "";
        }
      }
      return "";
    },
    [editing?.id, getKey],
  );

  const tempProvider = React.useCallback(
    (draft: WizardDraft, format: ApiFormat, baseUrl: string, apiKey: string): Provider => {
      const preset = draft.presetId ? presetById(draft.presetId) : undefined;
      const auth = preset && preset.apiFormat === format ? preset.auth : defaultAuthFor(format);
      return {
        id: editing?.id ?? "wizard-temp",
        name: draft.name || preset?.name || "Provider",
        baseUrl,
        apiFormat: format,
        auth,
        extraHeaders: preset?.extraHeaders ?? {},
        timeoutMs: Math.max(5, draft.timeout || 45) * 1000,
        useProxy: preset?.useProxy ?? false,
        enabled: true,
        favorite: false,
        order: 0,
        icon: preset?.icon,
        color: preset?.color,
        notes: undefined,
        paths: {},
        hasKey: !!apiKey,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    },
    [editing?.id],
  );

  const detectModels = React.useCallback(
    async (draft: WizardDraft): Promise<DetectModelsOutput> => {
      // Editing a custom-template provider: keep its saved models instead of probing and
      // overwriting a format the simplified wizard cannot edit.
      if (editing?.apiFormat === "custom" && draft.format === "auto") {
        return models.filter((model) => model.providerId === editing.id).map((model) => ({ id: model.modelId }));
      }
      const preset = draft.presetId ? presetById(draft.presetId) : undefined;
      const key = await resolveKey(draft.apiKey);

      // 1. Primary path: Smart backend inspector (CORS-free, live 1-token API key
      // health probe + accurate Free vs Paid model classification).
      const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(\/|$)/i.test(draft.baseUrl.trim());
      if (!isLocal) {
        const format = draft.format === "auto" ? "auto" : draft.format;
        const auth = preset && (format === "auto" || preset.apiFormat === format) ? preset.auth : undefined;
        const report = await inspectProviderEndpoint({
          baseUrl: draft.baseUrl,
          apiKey: key,
          format,
          authHeader: auth?.header,
          authPrefix: auth?.prefix,
          extraHeaders: preset?.extraHeaders ?? {},
          verifyKeyLive: true,
        });
        if (report) {
          inspectedModelsRef.current = new Map(report.models.map((m) => [m.id, m]));
          if (report.format) {
            setDetected({ format: report.format, baseUrl: report.baseUrl });
          }
          if (report.models.length > 0 || report.keyHealth.status !== "unreachable") {
            return {
              models: report.models.map((m) => ({
                id: m.id,
                displayName: m.displayName,
                tier: m.tier,
                tierSource: m.tierSource,
                contextWindow: m.contextWindow,
                capabilities: m.capabilities,
              })),
              keyHealth: report.keyHealth,
              summary: report.summary,
            };
          }
        }
      }

      // 2. Fallback for local providers (e.g. Ollama) or when backend inspect is unavailable.
      if (draft.format === "auto") {
        const result = await detectFormat({
          baseUrl: draft.baseUrl,
          apiKey: key,
          extraHeaders: preset?.extraHeaders ?? {},
          proxyUrl,
          useProxy: preset?.useProxy ?? false,
        });
        if (!result.format) throw new Error(result.error ?? "No compatible models endpoint answered.");
        setDetected({ format: result.format, baseUrl: result.baseUrl });
        return result.models.map((id) => {
          const meta = suggestedMeta(id, { baseUrl: result.baseUrl });
          return { id, tier: isLocal ? "free" : meta.tier };
        });
      }
      const normalizedUrl = normalizeBaseUrl(draft.baseUrl, draft.format).baseUrl || draft.baseUrl;
      const provider = tempProvider(draft, draft.format, normalizedUrl, key);
      const list = await listModels(provider, key, proxyUrl);
      setDetected({ format: draft.format, baseUrl: normalizedUrl });
      return list.map((model) => {
        const meta = suggestedMeta(model.id, { baseUrl: normalizedUrl });
        return { id: model.id, tier: isLocal ? "free" : meta.tier };
      });
    },
    [editing?.apiFormat, editing?.id, models, proxyUrl, resolveKey, tempProvider],
  );

  const submit = React.useCallback(
    async (draft: WizardDraft & { models: string[] }) => {
      const preset = draft.presetId ? presetById(draft.presetId) : undefined;
      const keepCustom = editing?.apiFormat === "custom" && draft.format === "auto";
      const fallbackFormat = preset && preset.apiFormat !== "custom" ? preset.apiFormat : "openai";
      const format = keepCustom ? "custom" : concreteFormat(draft.format, detected?.format ?? fallbackFormat);
      const baseUrl = !keepCustom && draft.format === "auto" && detected ? detected.baseUrl : draft.baseUrl;
      const key = await resolveKey(draft.apiKey);
      const auth = keepCustom
        ? editing?.auth ?? defaultAuthFor(format)
        : preset && preset.apiFormat === format
          ? preset.auth
          : defaultAuthFor(format);
      const payload: ProviderDraft = {
        name: draft.name.trim() || preset?.name || "Untitled provider",
        baseUrl,
        apiFormat: format,
        auth,
        extraHeaders: keepCustom ? editing?.extraHeaders ?? {} : preset?.extraHeaders ?? {},
        timeoutMs: Math.max(5, draft.timeout || 45) * 1000,
        useProxy: keepCustom ? editing?.useProxy ?? false : preset?.useProxy ?? false,
        icon: keepCustom ? editing?.icon : preset?.icon,
        color: keepCustom ? editing?.color : preset?.color,
        notes: undefined,
        presetId: draft.presetId ?? (keepCustom ? editing?.presetId : undefined),
        paths: keepCustom ? editing?.paths ?? {} : {},
        custom: keepCustom ? editing?.custom : undefined,
        enabled: true,
      };

      try {
        let providerId = editing?.id;
        if (editing) {
          await updateProvider(editing.id, payload, key || undefined);
          toast.success("Provider updated");
        } else {
          const created = await createProvider(payload, key || undefined);
          providerId = created.id;
          toast.success("Provider saved");
        }
        if (providerId) {
          const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(\/|$)/i.test(baseUrl.trim());
          const validCaps = new Set<Capability>(["text", "vision", "video", "audio", "tools", "reasoning"]);
          const entries: ModelDraft[] = draft.models.map((modelId) => {
            const inspected = inspectedModelsRef.current.get(modelId);
            const meta = suggestedMeta(modelId, { baseUrl });
            const caps = inspected?.capabilities?.filter((c): c is Capability => validCaps.has(c as Capability));
            const pricing =
              inspected?.pricing &&
              typeof inspected.pricing.prompt === "number" &&
              typeof inspected.pricing.completion === "number"
                ? {
                    prompt: inspected.pricing.prompt,
                    completion: inspected.pricing.completion,
                  }
                : meta.pricing;
            // Strict pricing label: trust inspected classification (including "unknown"),
            // never guess "free" for unrecognized endpoints.
            const strictPricingTier: "free" | "paid" | "unknown" = inspected
              ? inspected.tier
              : isLocal
                ? "free"
                : /(?::free|\/free|-free)$/i.test(modelId) || modelId.toLowerCase().includes(":free")
                  ? "free"
                  : pricing
                    ? pricing.prompt === 0 && pricing.completion === 0
                      ? "free"
                      : "paid"
                    : "unknown";
            return {
              modelId,
              displayName: inspected?.displayName || prettyModelName(modelId),
              contextWindow: inspected?.contextWindow ?? meta.contextWindow,
              pricing,
              pricingTier: strictPricingTier,
              capabilities: caps && caps.length > 0 ? caps : meta.capabilities,
              tier: strictPricingTier,
              source: "api" as const,
            };
          });
          const added = await addModels(providerId, entries);
          if (!editing && added > 0) toast.message(`${added} models added`);

          // If saved without prior live inspection, run an automatic lightweight
          // ephemeral pricing probe so models receive verified free/paid/unknown labels.
          if (!isLocal && key && inspectedModelsRef.current.size === 0) {
            const targetProviderId = providerId;
            void inspectProviderEndpoint({
              baseUrl,
              apiKey: key,
              format,
              authHeader: auth.header ?? undefined,
              authPrefix: auth.prefix ?? undefined,
              extraHeaders: payload.extraHeaders,
              verifyKeyLive: true,
            })
              .then((report) => {
                if (!report || report.models.length === 0) return;
                const map = new Map<
                  string,
                  { pricingTier: "free" | "paid" | "unknown"; pricing?: { prompt: number; completion: number } }
                >();
                for (const m of report.models) {
                  map.set(m.id, {
                    pricingTier: m.tier,
                    ...(m.pricing ? { pricing: m.pricing } : {}),
                  });
                }
                return applyModelPricing(targetProviderId, map);
              })
              .catch(() => {
                // Keep models at 'unknown' on transient probe failure.
              });
          }
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not save the provider.");
        throw error;
      }
    },
    [addModels, applyModelPricing, createProvider, detected, editing, resolveKey, updateProvider],
  );

  const initialDraft = React.useMemo<Partial<WizardDraft> | undefined>(() => {
    if (!editing) return undefined;
    return {
      presetId: editing.presetId && PRESETS.some((p) => p.id === editing.presetId) ? editing.presetId : null,
      name: editing.name,
      baseUrl: editing.baseUrl,
      format: editing.apiFormat === "custom" ? "auto" : editing.apiFormat,
      timeout: Math.round(editing.timeoutMs / 1000) || 45,
    };
  }, [editing]);

  const initialModels = React.useMemo(
    () => (editing ? models.filter((model) => model.providerId === editing.id).map((model) => model.modelId) : []),
    // Snapshot the current model list when the dialog opens for an existing provider.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editing?.id, open],
  );

  return (
    <ProviderWizardUI
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      onSubmit={submit}
      onDetectModels={detectModels}
      presets={PRESETS}
      initialDraft={initialDraft}
      initialModels={initialModels}
      initialStep={editing ? 1 : 0}
    />
  );
}
