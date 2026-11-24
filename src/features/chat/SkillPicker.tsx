// chat feature: SkillPicker — compact Auto + category selector inside the prompt
// composer toolbar. Defaults to Auto (fast LLM classifier routes each turn to
// website | game | chat | deep_thinking | other), while letting users pin a category.
import {
  Brain,
  ChevronDown,
  Compass,
  Gamepad2,
  Globe,
  MessageCircle,
  Sparkles,
} from "lucide-react";
import * as React from "react";
import { GlassButton } from "@/components/ui/glass-button";
import { MorphMenu, type MorphMenuItem } from "@/components/ui/morph-menu";
import { useT } from "@/lib/i18n";
import type { SkillId, SkillMode } from "@/lib/types";

const SKILL_MODES: SkillMode[] = [
  "auto",
  "chat",
  "website",
  "game",
  "deep_thinking",
];

export function SkillIcon({
  mode,
  size = 14,
}: {
  mode: SkillMode | SkillId;
  size?: number;
}) {
  switch (mode) {
    case "chat":
      return <MessageCircle size={size} strokeWidth={1.75} aria-hidden="true" />;
    case "website":
      return <Globe size={size} strokeWidth={1.75} aria-hidden="true" />;
    case "game":
      return <Gamepad2 size={size} strokeWidth={1.75} aria-hidden="true" />;
    case "deep_thinking":
      return <Brain size={size} strokeWidth={1.75} aria-hidden="true" />;
    case "other":
      return <Sparkles size={size} strokeWidth={1.75} aria-hidden="true" />;
    case "auto":
    default:
      return <Compass size={size} strokeWidth={1.75} aria-hidden="true" />;
  }
}

export function SkillPicker({
  value,
  onChange,
}: {
  value: SkillMode;
  onChange: (mode: SkillMode) => void;
}) {
  const t = useT();
  const [open, setOpen] = React.useState(false);

  const items: MorphMenuItem[] = SKILL_MODES.map((mode) => ({
    id: mode,
    checked: value === mode,
    icon: <SkillIcon mode={mode} size={15} />,
    label: (
      <span className="flex min-w-0 flex-col py-0.5 leading-tight">
        <span className="truncate text-[13px] font-medium">{t(`skill.${mode}`)}</span>
        <span className="mt-0.5 truncate text-[10.5px] font-normal opacity-60">
          {t(`skill.${mode}Desc`)}
        </span>
      </span>
    ),
    onSelect: () => onChange(mode),
  }));

  const isPinned = value !== "auto";

  return (
    <MorphMenu
      open={open}
      onOpenChange={setOpen}
      items={items}
      label={t("skill.menuTitle")}
      heading={t("skill.menuTitle")}
      align="start"
      width={296}
      trigger={(props) => (
        <GlassButton
          {...props}
          variant="pill"
          active={isPinned}
          aria-label={t("skill.menuTitle")}
        >
          <span className="ppc-pill-ic">
            <SkillIcon mode={value} size={14} />
          </span>
          <span className="max-[440px]:hidden">{t(`skill.${value}`)}</span>
          <ChevronDown size={12} strokeWidth={1.8} aria-hidden="true" className="ppc-chev" />
        </GlassButton>
      )}
    />
  );
}
