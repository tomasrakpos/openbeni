// chat feature: IntelligencePicker; change its UI/flow here and keep related state/API calls in sync.
import { Brain, ChevronDown } from "lucide-react";
import * as React from "react";
import { MorphMenu, type MorphMenuItem } from "@/components/ui/morph-menu";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
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
        <button
          {...props}
          type="button"
          aria-label={t("chat.intelligence")}
          className={cn(
            "inline-flex h-[30px] shrink-0 items-center gap-1.5 rounded-[9px] px-2 text-[12px] font-medium transition-colors duration-150",
            "text-[color-mix(in_oklab,var(--foreground)_55%,transparent)]",
            "hover:bg-[color-mix(in_oklab,var(--foreground)_10%,transparent)] hover:text-[color-mix(in_oklab,var(--foreground)_90%,transparent)]",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]",
            value && "text-[var(--primary)] hover:text-[var(--primary)]",
          )}
        >
          <Brain size={14} strokeWidth={1.75} aria-hidden="true" />
          <span className="hidden text-[var(--faint)] lg:inline">{t("chat.intelligence")}</span>
          <span className="max-[370px]:hidden">{effortLabel}</span>
          <ChevronDown size={12} strokeWidth={1.75} aria-hidden="true" className="opacity-60" />
        </button>
      )}
    />
  );
}
