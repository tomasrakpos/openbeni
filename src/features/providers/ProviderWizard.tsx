// providers feature: ProviderWizard adapter; keeps the existing save/detect logic.
import * as React from "react";
import { toast } from "sonner";
import {
  ProviderWizard as ProviderWizardUI,
  type ProviderDraft as WizardDraft,
  type ProviderPreset as WizardPreset,
} from "@/components/ui/provider-wizard";
import { PROVIDER_PRESETS, presetById } from "@/data/presets";
import { listModels } from "@/lib/chatClient";
import { detectFormat } from "@/lib/detect";
import { suggestedMeta } from "@/lib/registry";
import {
  prettyModelName,
  useProvidersStore,
  type ModelDraft,
  type ProviderDraft,
} from "@/stores/providers";
import { useSettingsStore } from "@/stores/settings";
import { useUiStore } from "@/stores/ui";
import type { ApiFormat, Provider } from "@/lib/types";

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
  const getKey = useProvidersStore((s) => s.getKey);
  const proxyUrl = useSettingsStore((s) => s.settings.proxyUrl);

  const editing = editingId ? providers.find((p) => p.id === editingId) : undefined;

  const [detected, setDetected] = React.useState<{ format: ApiFormat; baseUrl: string } | null>(null);

  React.useEffect(() => {
    setDetected(null);
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
        notes: preset?.notes,
        paths: {},
        hasKey: !!apiKey,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    },
    [editing?.id],
  );

  const detectModels = React.useCallback(
    async (draft: WizardDraft): Promise<{ id: string }[]> => {
      // Editing a custom-template provider: keep its saved models instead of probing and
      // overwriting a format the simplified wizard cannot edit.
      if (editing?.apiFormat === "custom" && draft.format === "auto") {
        return models.filter((model) => model.providerId === editing.id).map((model) => ({ id: model.modelId }));
      }
      const preset = draft.presetId ? presetById(draft.presetId) : undefined;
      const key = await resolveKey(draft.apiKey);
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
        return result.models.map((id) => ({ id }));
      }
      const provider = tempProvider(draft, draft.format, draft.baseUrl, key);
      const list = await listModels(provider, key, proxyUrl);
      setDetected({ format: draft.format, baseUrl: draft.baseUrl });
      return list.map((model) => ({ id: model.id }));
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
        notes: keepCustom ? editing?.notes : preset?.notes,
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
          const entries: ModelDraft[] = draft.models.map((modelId) => {
            const meta = suggestedMeta(modelId, { baseUrl });
            return {
              modelId,
              displayName: prettyModelName(modelId),
              contextWindow: meta.contextWindow,
              pricing: meta.pricing,
              capabilities: meta.capabilities,
              tier: meta.tier,
              source: "api" as const,
            };
          });
          const added = await addModels(providerId, entries);
          if (!editing && added > 0) toast.message(`${added} models added`);
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not save the provider.");
        throw error;
      }
    },
    [addModels, createProvider, detected, editing, resolveKey, updateProvider],
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
