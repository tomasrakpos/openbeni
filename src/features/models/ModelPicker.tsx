// models feature: ModelPicker; change its UI/flow here and keep related state/API calls in sync.
import { Check, Cpu, Search } from "lucide-react";
import * as React from "react";
import { CapabilityChips } from "@/components/CapabilityChips";
import { ProviderIcon } from "@/components/ProviderIcon";
import { TierBadge } from "@/components/TierBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { isBundledProvider, providerDisplayName } from "@/lib/bundled";
import { modelIdentityKeys } from "@/lib/modelRoutes";
import { useT } from "@/lib/i18n";
import { latestPing } from "@/lib/ping";
import { effectiveTier } from "@/lib/registry";
import { formatTokens } from "@/lib/tokens";
import { cn } from "@/lib/utils";
import { useChatsStore } from "@/stores/chats";
import { useAllModels, useAllProviders } from "@/stores/catalog";
import { useProvidersStore } from "@/stores/providers";
import { useUiStore } from "@/stores/ui";
import type { AIModel, Provider } from "@/lib/types";

function LatencyDot({ provider, model }: { provider: Provider; model?: AIModel }) {
  const t = useT();
  const pings = useProvidersStore((s) => s.pings);
  const ping = model ? latestPing(pings, provider.id, model.id) : latestPing(pings, provider.id);
  if (!ping) {
    return <span className="size-1.5 rounded-full bg-[var(--faint)] opacity-50" title={t("model.notPinged")} />;
  }
  const tone = !ping.ok
    ? "bg-[var(--destructive)]"
    : ping.latencyMs < 800
      ? "bg-[var(--success)]"
      : ping.latencyMs < 2500
        ? "bg-[var(--warning)]"
        : "bg-[var(--destructive)]";
  return (
    <span
      className={cn("size-1.5 shrink-0 rounded-full", tone, ping.ok && "status-live")}
      title={`${ping.ok ? `${ping.latencyMs}ms` : ping.message ?? "Failed"} · ${new Date(ping.at).toLocaleTimeString()}`}
    />
  );
}

export function ModelPicker() {
  const t = useT();
  const open = useUiStore((s) => s.modelPickerOpen);
  const setOpen = useUiStore((s) => s.setModelPickerOpen);
  const setView = useUiStore((s) => s.setView);
  const providers = useAllProviders();
  const models = useAllModels();
  const chats = useChatsStore((s) => s.chats);
  const activeChatId = useChatsStore((s) => s.activeChatId);
  const setChatModel = useChatsStore((s) => s.setChatModel);
  const chat = chats.find((c) => c.id === activeChatId);

  const enabledProviders = React.useMemo(
    () => providers.filter((p) => p.enabled).sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.order - b.order),
    [providers],
  );
  const enabledModels = React.useMemo(() => models.filter((m) => m.enabled), [models]);

  const groups = React.useMemo(() => {
    // A logical model may be served by several gateways. Show it once and let
    // the send path queue the other gateways as automatic fallbacks.
    const seen = new Set<string>();
    const out: {
      key: string;
      name: string;
      provider: Provider;
      entries: { provider: Provider; model: AIModel }[];
    }[] = [];
    const byName = new Map<string, (typeof out)[number]>();
    for (const provider of enabledProviders) {
      const name = providerDisplayName(provider);
      const providerModels = enabledModels
        .filter((m) => m.providerId === provider.id)
        .sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.order - b.order);
      for (const model of providerModels) {
        const identity = modelIdentityKeys(model)[0] ?? model.id;
        if (seen.has(identity)) continue;
        seen.add(identity);
        let group = byName.get(name);
        if (!group) {
          group = { key: name, name, provider, entries: [] };
          byName.set(name, group);
          out.push(group);
        }
        group.entries.push({ provider, model });
      }
    }
    return out;
  }, [enabledProviders, enabledModels]);

  const select = (providerId: string, model: AIModel) => {
    void setChatModel(providerId, model.id);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent frame className="gap-0 p-0 sm:w-[min(640px,calc(100vw-2rem))]" hideClose>
        <DialogHeader className="border-b border-[var(--border)] px-4 py-3 pr-12">
          <DialogTitle className="flex items-center gap-2 text-[15px]">
            <Cpu className="size-4 text-[var(--primary)]" />
            {t("models.pickerTitle")}
          </DialogTitle>
          <DialogDescription className="text-[11.5px]">{t("models.tierSource")}</DialogDescription>
        </DialogHeader>

        {groups.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <span className="grid size-11 place-items-center rounded-[14px] border border-[var(--border)] bg-[var(--surface-2)]">
              <Cpu className="size-5 text-[var(--faint)]" />
            </span>
            <p className="text-[13px] text-[var(--muted-foreground)]">{t("models.noProviders")}</p>
            <Button
              size="sm"
              onClick={() => {
                setOpen(false);
                setView("providers");
              }}
            >
              {t("providers.add")}
            </Button>
          </div>
        ) : (
          <Command shouldFilter className="bg-transparent">
            <CommandInput placeholder={t("models.pickerSearch")} aria-label={t("models.pickerSearch")} />
            <CommandList className="max-h-[min(56vh,480px)]">
              {groups.map((group) => (
                <CommandGroup key={group.key} heading={group.name}>
                  {group.entries.map(({ provider, model }) => {
                    const tier = effectiveTier(model, provider);
                    const active = chat?.modelId === model.id && chat?.providerId === provider.id;
                    const label = providerDisplayName(provider);
                    return (
                      <CommandItem
                        key={model.id}
                        value={`${label} ${model.displayName} ${model.modelId}`}
                        onSelect={() => (model.locked ? undefined : select(provider.id, model))}
                        disabled={model.locked}
                        className={cn("gap-2.5 rounded-[10px] py-2", model.locked && "opacity-60")}
                        aria-current={active}
                      >
                        <ProviderIcon
                          icon={model.icon ?? provider.icon}
                          name={isBundledProvider(provider) ? label : provider.name}
                          color={provider.color}
                          baseUrl={provider.baseUrl}
                          size={26}
                        />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span className="truncate text-[12.5px] font-medium text-foreground">
                              {model.displayName}
                            </span>
                            {model.locked ? (
                              <Badge variant="primary">{t("models.paid")}</Badge>
                            ) : (
                              <TierBadge tier={tier} />
                            )}
                            {model.favorite ? <Badge variant="primary">★</Badge> : null}
                          </span>
                          <span className="flex min-w-0 items-center gap-2 text-[10.5px] text-[var(--faint)]">
                            <span className="truncate font-mono">{model.modelId}</span>
                            {model.contextWindow ? <span>· {formatTokens(model.contextWindow)} ctx</span> : null}
                          </span>
                        </span>
                        <CapabilityChips capabilities={model.capabilities} max={3} />
                        <LatencyDot provider={provider} model={model} />
                        {active ? <Check className="size-3.5 text-[var(--primary)]" /> : null}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              ))}
            </CommandList>
            <div className="flex items-center justify-between gap-2 border-t border-[var(--border)] px-3 py-2">
              <span className="inline-flex items-center gap-1.5 text-[10.5px] text-[var(--faint)]">
                <Search className="size-3" />
                {t("palette.hint")}
              </span>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => {
                  setOpen(false);
                  setView("providers");
                }}
              >
                {t("models.manage")}
              </Button>
            </div>
          </Command>
        )}
      </DialogContent>
    </Dialog>
  );
}
