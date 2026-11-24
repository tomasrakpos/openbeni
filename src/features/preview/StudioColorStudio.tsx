// Bespoke in-frame HSV + Alpha + HEX + Swatch color picker rendered directly
// inside the inspector's <MenuFrame> card — zero native Windows/Chrome popups.
import { motion } from "framer-motion";
import { ArrowLeft, Ban, Check } from "lucide-react";
import * as React from "react";
import { GlassButton } from "@/components/ui/glass-button";
import { useT } from "@/lib/i18n";

const DESIGNER_SWATCHES = [
  "#ffffff",
  "#f1f5f9",
  "#94a3b8",
  "#334155",
  "#0f172a",
  "#000000",
  "#c4b5fd",
  "#9b72ff",
  "#7c4dff",
  "#5b21b6",
  "#ffa066",
  "#e0531a",
  "#fb7185",
  "#ef4444",
  "#f59e0b",
  "#eab308",
  "#84cc16",
  "#10b981",
  "#14b8a6",
  "#06b6d4",
  "#0ea5e9",
  "#2563eb",
  "#6366f1",
  "#ec4899",
];

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0,
    g = 0,
    b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = 60 * (((gn - bn) / d) % 6);
    else if (max === gn) h = 60 * ((bn - rn) / d + 2);
    else h = 60 * ((rn - gn) / d + 4);
  }
  if (h < 0) h += 360;
  const s = max === 0 ? 0 : d / max;
  return [Math.round(h), s, max];
}

function rgbToHex(r: number, g: number, b: number) {
  return (
    "#" +
    [r, g, b]
      .map((n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0"))
      .join("")
  );
}

function parseColorString(raw: string): { h: number; s: number; v: number; a: number; hex: string } {
  const clean = (raw || "").trim();
  if (!clean || clean === "transparent") {
    return { h: 262, s: 0.7, v: 1, a: 0, hex: "#7c4dff" };
  }
  const rgbaMatch = clean.match(
    /rgba?\(\s*(\d+(?:\.\d+)?)\s*[,\s]\s*(\d+(?:\.\d+)?)\s*[,\s]\s*(\d+(?:\.\d+)?)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)/i,
  );
  if (rgbaMatch) {
    const r = clamp(Math.round(parseFloat(rgbaMatch[1] ?? "0")), 0, 255);
    const g = clamp(Math.round(parseFloat(rgbaMatch[2] ?? "0")), 0, 255);
    const b = clamp(Math.round(parseFloat(rgbaMatch[3] ?? "0")), 0, 255);
    const rawAlpha = rgbaMatch[4] !== undefined ? parseFloat(rgbaMatch[4]) : 1;
    const a = rgbaMatch[5] === "%" ? clamp(rawAlpha / 100, 0, 1) : clamp(rawAlpha, 0, 1);
    const [h, s, v] = rgbToHsv(r, g, b);
    return { h, s, v, a, hex: rgbToHex(r, g, b) };
  }
  const hexMatch = clean.replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(hexMatch)) {
    const r = parseInt(hexMatch[0] + hexMatch[0], 16);
    const g = parseInt(hexMatch[1] + hexMatch[1], 16);
    const b = parseInt(hexMatch[2] + hexMatch[2], 16);
    const [h, s, v] = rgbToHsv(r, g, b);
    return { h, s, v, a: 1, hex: rgbToHex(r, g, b) };
  }
  if (/^[0-9a-f]{6}$/i.test(hexMatch)) {
    const r = parseInt(hexMatch.slice(0, 2), 16);
    const g = parseInt(hexMatch.slice(2, 4), 16);
    const b = parseInt(hexMatch.slice(4, 6), 16);
    const [h, s, v] = rgbToHsv(r, g, b);
    return { h, s, v, a: 1, hex: rgbToHex(r, g, b) };
  }
  return { h: 262, s: 0.7, v: 1, a: 1, hex: "#7c4dff" };
}

function formatCssColor(h: number, s: number, v: number, a: number): { css: string; hex: string } {
  const [r, g, b] = hsvToRgb(h, s, v);
  const hex = rgbToHex(r, g, b);
  if (a <= 0.01) return { css: "transparent", hex };
  if (a >= 0.99) return { css: hex, hex };
  return { css: `rgba(${r}, ${g}, ${b}, ${a.toFixed(2)})`, hex };
}

export function StudioColorStudio({
  title,
  value,
  allowTransparent,
  onChange,
  onConfirm,
  onCancel,
}: {
  title: string;
  value: string;
  allowTransparent?: boolean;
  onChange: (cssColor: string) => void;
  onConfirm: (cssColor: string) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const initial = React.useMemo(() => parseColorString(value), [value]);
  const [h, setH] = React.useState(initial.h);
  const [s, setS] = React.useState(initial.s);
  const [v, setV] = React.useState(initial.v);
  const [a, setA] = React.useState(initial.a);
  const [hexDraft, setHexDraft] = React.useState(initial.hex.toUpperCase());
  const svRef = React.useRef<HTMLDivElement>(null);
  const draggingRef = React.useRef(false);

  const emitHsv = React.useCallback(
    (nh: number, ns: number, nv: number, na: number) => {
      const formatted = formatCssColor(nh, ns, nv, na);
      setHexDraft(formatted.hex.toUpperCase());
      onChange(formatted.css);
    },
    [onChange],
  );

  const updateSvFromPointer = (clientX: number, clientY: number) => {
    const el = svRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const ns = clamp((clientX - rect.left) / rect.width, 0, 1);
    const nv = clamp(1 - (clientY - rect.top) / rect.height, 0, 1);
    const nextA = a <= 0.01 ? 1 : a;
    setS(ns);
    setV(nv);
    if (nextA !== a) setA(nextA);
    emitHsv(h, ns, nv, nextA);
  };

  const current = formatCssColor(h, s, v, a);
  const pureHueHex = formatCssColor(h, 1, 1, 1).hex;

  return (
    <motion.div
      dir="ltr"
      initial={{ opacity: 0, x: 18 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 18 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      {/* In-frame header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 py-2">
        <button
          type="button"
          onClick={onCancel}
          aria-label={t("common.back")}
          className="grid size-6 shrink-0 place-items-center rounded-[7px] text-[var(--muted-foreground)] transition-colors hover:bg-[var(--surface-2)] hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
        </button>
        <span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold text-foreground">
          {title}
        </span>
        <span
          className="size-5 shrink-0 rounded-full border border-[var(--border-strong)] shadow-xs"
          style={{
            background:
              a <= 0.01
                ? "repeating-conic-gradient(#808080 0% 25%, transparent 0% 50%) 50% / 8px 8px"
                : current.css,
          }}
        />
      </div>

      {/* Scrollable color picker canvas + sliders + swatches */}
      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto overscroll-contain p-2.5">
        {/* 2D Saturation / Brightness pad */}
        <div
          ref={svRef}
          onPointerDown={(e) => {
            e.preventDefault();
            draggingRef.current = true;
            e.currentTarget.setPointerCapture?.(e.pointerId);
            updateSvFromPointer(e.clientX, e.clientY);
          }}
          onPointerMove={(e) => {
            if (!draggingRef.current) return;
            updateSvFromPointer(e.clientX, e.clientY);
          }}
          onPointerUp={() => {
            draggingRef.current = false;
          }}
          onPointerCancel={() => {
            draggingRef.current = false;
          }}
          className="relative h-[116px] w-full cursor-crosshair touch-none overflow-hidden rounded-[12px] border border-[var(--border-strong)] shadow-inner"
          style={{
            backgroundColor: pureHueHex,
            backgroundImage:
              "linear-gradient(to top, #000000, transparent), linear-gradient(to right, #ffffff, transparent)",
          }}
        >
          <span
            className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1.5px_rgba(0,0,0,0.45),0_4px_10px_rgba(0,0,0,0.45)]"
            style={{
              left: `${(s * 100).toFixed(1)}%`,
              top: `${((1 - v) * 100).toFixed(1)}%`,
              backgroundColor: current.hex,
            }}
          />
        </div>

        {/* Rainbow Hue slider */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[10px] text-[var(--muted-foreground)]">
            <span>{t("preview.studio.colorHue")}</span>
            <span className="font-mono tabular-nums">{Math.round(h)}°</span>
          </div>
          <input
            type="range"
            min={0}
            max={360}
            value={h}
            onChange={(e) => {
              const nh = parseFloat(e.target.value);
              const nextA = a <= 0.01 ? 1 : a;
              setH(nh);
              if (nextA !== a) setA(nextA);
              emitHsv(nh, s, v, nextA);
            }}
            className="oh-studio-range"
            style={{
              height: 8,
              background:
                "linear-gradient(90deg, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)",
            }}
          />
        </div>

        {/* Alpha / Transparency slider */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[10px] text-[var(--muted-foreground)]">
            <span>{t("preview.studio.colorAlpha")}</span>
            <span className="font-mono tabular-nums">{Math.round(a * 100)}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(a * 100)}
            onChange={(e) => {
              const na = parseFloat(e.target.value) / 100;
              setA(na);
              emitHsv(h, s, v, na);
            }}
            className="oh-studio-range"
            style={{
              height: 8,
              background: `linear-gradient(90deg, transparent 0%, ${current.hex} 100%), repeating-conic-gradient(rgba(128,128,128,0.35) 0% 25%, transparent 0% 50%) 50% / 8px 8px`,
            }}
          />
        </div>

        {/* Editable HEX + Transparent shortcut */}
        <div className="flex items-center gap-2">
          <div className="flex h-8 flex-1 items-center gap-2 rounded-[10px] border border-[var(--border-strong)] bg-[color-mix(in_oklab,var(--surface-2)_72%,transparent)] px-2.5">
            <span className="text-[10px] font-medium text-[var(--faint)]">HEX</span>
            <input
              type="text"
              value={hexDraft}
              onChange={(e) => {
                const raw = e.target.value.toUpperCase();
                setHexDraft(raw);
                const cleaned = raw.replace(/^#/, "");
                if (/^[0-9A-F]{6}$/.test(cleaned)) {
                  const parsed = parseColorString(`#${cleaned}`);
                  setH(parsed.h);
                  setS(parsed.s);
                  setV(parsed.v);
                  const nextA = a <= 0.01 ? 1 : a;
                  setA(nextA);
                  onChange(formatCssColor(parsed.h, parsed.s, parsed.v, nextA).css);
                }
              }}
              className="min-w-0 flex-1 bg-transparent font-mono text-[11.5px] uppercase text-foreground outline-none"
            />
          </div>
          {allowTransparent ? (
            <button
              type="button"
              onClick={() => {
                setA(0);
                onChange("transparent");
              }}
              className="inline-flex h-8 shrink-0 items-center gap-1 rounded-[10px] border border-[var(--border)] bg-[var(--surface-2)] px-2.5 text-[10.5px] font-medium text-[var(--muted-foreground)] transition-colors hover:border-[var(--border-strong)] hover:text-foreground"
            >
              <Ban className="size-3" />
              <span>{t("preview.studio.transparent")}</span>
            </button>
          ) : null}
        </div>

        {/* 24 Designer Swatches */}
        <div className="grid grid-cols-8 gap-1.5 pt-0.5">
          {DESIGNER_SWATCHES.map((hex) => (
            <button
              key={hex}
              type="button"
              onClick={() => {
                const parsed = parseColorString(hex);
                setH(parsed.h);
                setS(parsed.s);
                setV(parsed.v);
                setA(1);
                setHexDraft(hex.toUpperCase());
                onChange(hex);
              }}
              aria-label={hex}
              className="h-6 w-full rounded-[7px] border border-[var(--border-strong)] transition-transform hover:scale-110 active:scale-95"
              style={{ backgroundColor: hex }}
            />
          ))}
        </div>
      </div>

      {/* Confirm Footer — returns cleanly to inspector */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-[var(--border)] px-3 py-2">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-[11px] font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--surface-2)] hover:text-foreground"
        >
          {t("common.cancel")}
        </button>
        <GlassButton variant="pill" active onClick={() => onConfirm(current.css)}>
          <Check className="size-3.5" />
          <span>{t("preview.studio.colorConfirm")}</span>
        </GlassButton>
      </div>
    </motion.div>
  );
}
