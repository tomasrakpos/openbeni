// models feature: ModelEditor; change its UI/flow here and keep related state/API calls in sync.
import { Activity, Loader2, Save } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { CapabilityChips } from "@/components/CapabilityChips";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import { ALL_CAPABILITIES, CAPABILITY_LABELS, effectiveTier, inferCapabilities } from "@/lib/registry";
import { formatPricing } from "@/lib/tokens";
import { cn } from "@/lib/utils";
import { useProvidersStore } from "@/stores/providers";
import type { AIModel, Capability, Tier } from "@/lib/types";

export function ModelEditor({
  model,
  open,
  onOpenChange,
}: {
  model: AIModel | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const updateModel = useProvidersStore((s) => s.updateModel);
  const pingModelById = useProvidersStore((s) => s.pingModelById);
  const working = useProvidersStore((s) => s.working);
  const provider = useProvidersStore((s) => s.providers.find((p) => p.id === model?.providerId));

  const [displayName, setDisplayName] = React.useState("");
  const [contextWindow, setContextWindow] = React.useState("");
  const [capabilities, setCapabilities] = React.useState<Capability[]>(["text"]);
  const [tierOverride, setTierOverride] = React.useState<"auto" | Tier>("auto");
  const [enabled, setEnabled] = React.useState(true);
  const [favorite, setFavorite] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!model) return;
    setDisplayName(model.displayName);
    setContextWindow(model.contextWindow ? String(model.contextWindow) : "");
    setCapabilities(model.capabilities);
    setTierOverride(model.tierOverride ?? "auto");
    setEnabled(model.enabled);
    setFavorite(model.favorite);
  }, [model]);

  if (!model) return null;
  const tier = effectiveTier(model, provider);

  const toggle = (capability: Capability) => {
    setCapabilities((current) =>
      current.includes(capability) ? current.filter((c) => c !== capability || c === "text") : [...current, capability],
    );
  };

  const save = async () => {
    setBusy(true);
    try {
      const parsed = Number(contextWindow);
      await updateModel(model.id, {
        displayName: displayName.trim() || model.modelId,
        contextWindow: Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : undefined,
        capabilities,
        tierOverride: tierOverride === "auto" ? undefined : tierOverride,
        enabled,
        favorite,
      });
      toast.success(t("models.saved"));
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    const result = await pingModelById(model.id);
    if (!result) return;
    if (result.ok) toast.success(t("providers.testOk", { ms: result.latencyMs }));
    else toast.error(`${t("providers.testFail")}: ${result.message ?? result.kind}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent frame className="sm:w-[min(560px,calc(100vw-2rem))]">
        <DialogHeader>
          <DialogTitle>{t("models.editTitle")}</DialogTitle>
          <DialogDescription className="font-mono text-[11.5px]">{model.modelId}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3.5">
          <div className="grid gap-1.5">
            <Label htmlFor="model-display-name">{t("models.displayName")}</Label>
            <Input
              id="model-display-name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder={model.modelId}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="model-context">{t("models.contextWindow")}</Label>
            <Input
              id="model-context"
              value={contextWindow}
              onChange={(event) => setContextWindow(event.target.value.replace(/[^0-9]/g, ""))}
              placeholder="128000"
              inputMode="numeric"
              className="font-mono"
            />
            {model.pricing ? (
              <span className="text-[10.5px] text-[var(--faint)]">{formatPricing(model.pricing)}</span>
            ) : null}
          </div>

          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label>{t("models.capabilities")}</Label>
              <button
                type="button"
                onClick={() => setCapabilities(inferCapabilities(model.modelId))}
                className="text-[10.5px] text-[var(--accent)] hover:underline"
              >
                {t("common.refresh")} suggestions
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {ALL_CAPABILITIES.map((capability) => {
                const active = capabilities.includes(capability);
                return (
                  <button
                    key={capability}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggle(capability)}
                    className={cn(
                      "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11.5px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]",
                      active
                        ? "border-[color-mix(in_oklab,var(--primary)_40%,transparent)] bg-[var(--primary-soft)] text-[var(--primary)]"
                        : "border-[var(--border)] bg-[var(--surface-2)] text-[var(--muted-foreground)] hover:text-foreground",
                    )}
                  >
                    {CAPABILITY_LABELS[capability]}
                  </button>
                );
              })}
               <span className="ml-auto self-center">
                <CapabilityChips capabilities={capabilities} max={6} />
              </span>
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="model-tier">{t("models.tierOverride")}</Label>
            <Select value={tierOverride} onValueChange={(value) => setTierOverride(value as "auto" | Tier)}>
              <SelectTrigger id="model-tier">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">{t("models.tierAuto")} — {t(`common.${tier}`)}</SelectItem>
                <SelectItem value="free">{t("common.free")}</SelectItem>
                <SelectItem value="paid">{t("common.paid")}</SelectItem>
                <SelectItem value="unknown">{t("common.unknown")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between rounded-[12px] border border-[var(--border)] bg-[var(--surface-2)]/50 px-3 py-2.5">
            <div className="flex flex-col">
              <Label htmlFor="model-enabled">{t("models.enabled")}</Label>
              <span className="text-[10.5px] text-[var(--faint)]">{t("providers.enableToChat")}</span>
            </div>
            <Switch id="model-enabled" checked={enabled} onCheckedChange={setEnabled} />
          </div>

          <div className="flex items-center justify-between rounded-[12px] border border-[var(--border)] bg-[var(--surface-2)]/50 px-3 py-2.5">
            <Label htmlFor="model-favorite">{t("models.favorite")}</Label>
            <Switch id="model-favorite" checked={favorite} onCheckedChange={setFavorite} />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="secondary" size="sm" onClick={test} disabled={working[model.id]}>
            {working[model.id] ? <Loader2 className="size-3.5 animate-spin" /> : <Activity className="size-3.5" />}
            {working[model.id] ? t("common.testing") : t("providers.testModel")}
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button size="sm" onClick={save} disabled={busy}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              {t("models.saveModel")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
