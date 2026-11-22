// chat feature: SkillPicker — compact hybrid Auto + 4-Skill selector inside
// the prompt composer toolbar. Defaults to Auto (backend automatically routes
// each message to the right skill), while letting users pin any skill manually.
import {
  ChevronDown,
  Compass,
  Gamepad2,
  Globe,
  MessageCircle,
  Search,
} from "lucide-react";
import * as React from "react";
import { GlassButton } from "@/components/ui/glass-button";
import { MorphMenu, type MorphMenuItem } from "@/components/ui/morph-menu";
import { useT } from "@/lib/i18n";
import type { SkillId, SkillMode } from "@/lib/types";

const SKILL_MODES: SkillMode[] = [
  "auto",
  "chat",
  "web_builder",
  "game_builder",
  "deep_research",
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
    case "web_builder":
      return <Globe size={size} strokeWidth={1.75} aria-hidden="true" />;
    case "game_builder":
      return <Gamepad2 size={size} strokeWidth={1.75} aria-hidden="true" />;
    case "deep_research":
      return <Search size={size} strokeWidth={1.75} aria-hidden="true" />;
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
