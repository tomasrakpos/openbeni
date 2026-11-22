// chat feature: IntelligencePicker; change its UI/flow here and keep related state/API calls in sync.
import { Brain, ChevronDown } from "lucide-react";
import * as React from "react";
import { GlassButton } from "@/components/ui/glass-button";
import { MorphMenu, type MorphMenuItem } from "@/components/ui/morph-menu";
import { useT } from "@/lib/i18n";
import type { ChatParams } from "@/lib/types";

export type ReasoningEffort = ChatParams["reasoningEffort"];

const LEVELS = ["off", "low", "medium", "high"] as const;

/**
 * Compact, visible reasoning-effort picker for the composer toolbar. It sits
 * next to the model pill so the intelligence level is one click away instead
 * of being buried in the parameters dialog.
 */
export function IntelligencePicker({
  value,
  onChange,
}: {
  value?: ReasoningEffort;
  onChange: (value: ReasoningEffort) => void;
}) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const effortLabel = value ? t(`chat.${value}`) : t("chat.off");

  const items: MorphMenuItem[] = LEVELS.map((level) => ({
    id: level,
    label: t(`chat.${level}`),
    checked: (value ?? "off") === level,
    icon:
      level === "off" ? (
        <span className="block size-1.5 rounded-full bg-current" />
      ) : (
        <Brain size={14} strokeWidth={1.75} />
      ),
    onSelect: () => onChange(level === "off" ? undefined : level),
  }));

  return (
    <MorphMenu
      open={open}
      onOpenChange={setOpen}
      items={items}
      label={t("chat.intelligence")}
      heading={t("chat.intelligence")}
      align="end"
      width={228}
      trigger={(props) => (
        <GlassButton
          {...props}
          variant="pill"
          active={Boolean(value)}
          aria-label={t("chat.intelligence")}
        >
          <Brain size={14} strokeWidth={1.75} className="ppc-pill-ic" aria-hidden="true" />
          <span className="hidden opacity-75 lg:inline">{t("chat.intelligence")}</span>
          <span className="max-[440px]:hidden">{effortLabel}</span>
          <ChevronDown size={12} strokeWidth={1.8} aria-hidden="true" className="ppc-chev" />
        </GlassButton>
      )}
    />
  );
}
