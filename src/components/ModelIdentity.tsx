// Shared component ModelIdentity; change its presentation here and update consumers if props change.
import * as React from "react";
import { ProviderIcon } from "@/components/ProviderIcon";
import { TierBadge } from "@/components/TierBadge";
import { useAllModels, useAllProviders } from "@/stores/catalog";
import { useSettingsStore } from "@/stores/settings";

export function useObjectUrl(blob?: Blob | null): string | undefined {
  const [url, setUrl] = React.useState<string>();
  React.useEffect(() => {
    if (!blob) {
      setUrl(undefined);
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}

export function ModelIdentity({
  providerId,
  modelId,
  size = 32,
  showTier = false,
  subtitle,
}: {
  providerId?: string;
  modelId?: string;
  size?: number;
  showTier?: boolean;
  subtitle?: React.ReactNode;
}) {
  const providers = useAllProviders();
  const models = useAllModels();
  const provider = providers.find((p) => p.id === providerId);
  const model = models.find((m) => m.modelId === modelId && (!providerId || m.providerId === providerId)) ??
    models.find((m) => m.modelId === modelId);
  const name = model?.displayName ?? modelId ?? "Unknown model";
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <ProviderIcon
        icon={provider?.icon ?? model?.icon}
        name={provider?.name ?? name}
        color={provider?.color}
        baseUrl={provider?.baseUrl}
        modelName={model?.displayName ?? modelId}
        modelId={model?.modelId ?? modelId}
        size={size}
      />
      <span className="flex min-w-0 flex-col">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[13px] font-medium text-foreground">{name}</span>
          {showTier && model && <TierBadge tier={model.tierOverride ?? model.tier} />}
        </span>
        {subtitle ? <span className="truncate text-[11px] text-[var(--faint)]">{subtitle}</span> : null}
      </span>
    </span>
  );
}

export function useShowReasoning(): boolean {
  return useSettingsStore((s) => s.settings.showReasoning);
}
