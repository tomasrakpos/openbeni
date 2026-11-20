// Reusable UI primitive liquid-glass-panel; adjust its default appearance and behavior here.
import * as React from "react";

/**
 * Rdev-style liquid glass material.
 *
 * This is the material from the reference snippet: one pre-baked displacement
 * map (PNG, exactly the size of the surface), a single `feDisplacementMap`
 * pass, and a CSS chain of `blur() brightness() saturate()` applied AFTER the
 * refraction. There is no tone table and no fill layer, so the backdrop keeps
 * its colour and brightness instead of turning into a grey slab.
 *
 * The map is generated on a canvas the first time a given geometry is seen and
 * then cached. Chromium can use an SVG filter inside `backdrop-filter`; other
 * engines get a plain frosted blur with the same brightness/saturation.
 */

export interface LiquidGlassPanelProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Light or dark calibration of the rim lights. Default "light". */
  appearance?: "light" | "dark";
  /** Width (px) of the curved edge, i.e. how far the bend reaches inward. */
  bezel?: number;
  /** Smoothing blur applied after the refraction. Default 3. */
  blur?: number;
  /** Backdrop brightness after refraction. Default 1.2. */
  brightness?: number;
  /** Backdrop saturation after refraction. Default 1.2. */
  saturation?: number;
  /** Blur used where SVG filters cannot run in `backdrop-filter`. Default 18. */
  fallbackBlur?: number;
}

let chromium: boolean | null = null;

function isChromium(): boolean {
  if (chromium !== null) return chromium;
  if (typeof navigator === "undefined") {
    chromium = false;
    return chromium;
  }
  const ua = navigator.userAgent;
  if (/Firefox\//.test(ua)) {
    chromium = false;
    return chromium;
  }
  const brands = (
    navigator as Navigator & { userAgentData?: { brands?: { brand: string }[] } }
  ).userAgentData?.brands;
  chromium = brands?.length
    ? brands.some((b) => /Chromium|Google Chrome|Microsoft Edge/i.test(b.brand))
    : /(Chrome|Chromium|Edg|OPR|SamsungBrowser)\/\d+/.test(ua);
  return chromium;
}

// --------------------------------------------------------------------------
// Displacement map
// --------------------------------------------------------------------------

const MAP_CACHE = new Map<string, string>();
const MAP_CACHE_LIMIT = 16;

/**
 * Renders the displacement field: 128 is "no offset", values below/above pull
 * the sampled backdrop inward/outward. Near the rounded edge the pull points to
 * the centre and fades out over `bezel` pixels, which is what produces the
 * compressed rim seen through real glass.
 */
function displacementMap(
  width: number,
  height: number,
  radius: number,
  bezel: number,
): string {
  if (typeof document === "undefined") return "";
  const key = `${width}|${height}|${radius}|${bezel}`;
  const cached = MAP_CACHE.get(key);
  if (cached !== undefined) return cached;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  let url = "";
  try {
    const image = ctx.createImageData(width, height);
    const data = image.data;
    const hw = width / 2;
    const hh = height / 2;
    const r = Math.max(0, Math.min(radius, hw, hh));
    const span = Math.max(2, Math.min(bezel, hw, hh));
    const rw = hw - r;
    const rh = hh - r;

    for (let y = 0; y < height; y++) {
      const py = y + 0.5 - hh;
      const qy = Math.abs(py) - rh;
      for (let x = 0; x < width; x++) {
        const px = x + 0.5 - hw;
        const qx = Math.abs(px) - rw;
        const o = (y * width + x) * 4;

        // Signed distance to the rounded rectangle (negative inside).
        const sdf =
          Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) +
          Math.min(Math.max(qx, qy), 0) -
          r;
        const depth = -sdf;

        if (depth <= 0 || depth >= span) {
          data[o] = 128;
          data[o + 1] = 128;
          data[o + 2] = 128;
          data[o + 3] = 255;
          continue;
        }

        // Outward normal of the closest edge.
        let nx = 0;
        let ny = 0;
        if (qx > 0 || qy > 0) {
          const gx = Math.sign(px) * Math.max(qx, 0);
          const gy = Math.sign(py) * Math.max(qy, 0);
          const len = Math.hypot(gx, gy) || 1;
          nx = gx / len;
          ny = gy / len;
        } else if (qx > qy) {
          nx = Math.sign(px) || 1;
        } else {
          ny = Math.sign(py) || 1;
        }

        const t = depth / span;
        const pull = Math.pow(1 - t, 1.7);
        data[o] = Math.round(127.5 - nx * pull * 127.5);
        data[o + 1] = Math.round(127.5 - ny * pull * 127.5);
        data[o + 2] = 128;
        data[o + 3] = 255;
      }
    }

    ctx.putImageData(image, 0, 0);
    url = canvas.toDataURL("image/png");
  } catch {
    url = "";
  }

  if (url) {
    if (MAP_CACHE.size >= MAP_CACHE_LIMIT) {
      const oldest = MAP_CACHE.keys().next().value;
      if (oldest !== undefined) MAP_CACHE.delete(oldest);
    }
    MAP_CACHE.set(key, url);
  }
  return url;
}

// --------------------------------------------------------------------------
// Shared filter host (document body, zero size, never painted)
// --------------------------------------------------------------------------

let host: SVGSVGElement | null = null;

function filterHost(): SVGSVGElement {
  if (host && host.isConnected) return host;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.style.position = "fixed";
  svg.style.width = "0";
  svg.style.height = "0";
  svg.style.overflow = "hidden";
  svg.style.pointerEvents = "none";
  svg.style.zIndex = "-1";
  document.body.appendChild(svg);
  host = svg;
  return svg;
}

// --------------------------------------------------------------------------
// Component
// --------------------------------------------------------------------------

interface Frame {
  width: number;
  height: number;
  url: string;
}

export const LiquidGlassPanel = React.forwardRef<HTMLDivElement, LiquidGlassPanelProps>(
  function LiquidGlassPanel(
    {
      appearance = "light",
      bezel = 32,
      blur = 3,
      brightness = 1.2,
      saturation = 1.2,
      fallbackBlur = 18,
      className,
      style,
      children,
      ...props
    },
    forwardedRef,
  ) {
    const localRef = React.useRef<HTMLDivElement | null>(null);
    const uid = React.useId().replace(/[^a-zA-Z0-9_-]/g, "");
    const filterId = `lgp${uid}`;
    const [frame, setFrame] = React.useState<Frame | null>(null);
    const refract = React.useMemo(isChromium, []);

    const ref = React.useCallback(
      (node: HTMLDivElement | null) => {
        localRef.current = node;
        if (typeof forwardedRef === "function") forwardedRef(node);
        else if (forwardedRef) forwardedRef.current = node;
      },
      [forwardedRef],
    );

    React.useLayoutEffect(() => {
      const element = localRef.current;
      if (!element || !refract) return;
      let raf = 0;

      const measure = () => {
        raf = 0;
        const width = Math.round(element.offsetWidth);
        const height = Math.round(element.offsetHeight);
        if (width < 4 || height < 4) return;
        const radius = Math.round(
          parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0,
        );
        const url = displacementMap(width, height, radius, bezel);
        setFrame((prev) =>
          prev && prev.width === width && prev.height === height && prev.url === url
            ? prev
            : { width, height, url },
        );
      };

      const observer = new ResizeObserver(() => {
        if (!raf) raf = requestAnimationFrame(measure);
      });
      measure();
      observer.observe(element);
      return () => {
        observer.disconnect();
        cancelAnimationFrame(raf);
      };
    }, [bezel, refract]);

    React.useLayoutEffect(() => {
      if (!refract || !frame || !frame.url) return;
      const svg = filterHost();
      const filter = document.createElementNS("http://www.w3.org/2000/svg", "filter");
      filter.setAttribute("id", filterId);
      filter.setAttribute("filterUnits", "userSpaceOnUse");
      filter.setAttribute("x", "0");
      filter.setAttribute("y", "0");
      filter.setAttribute("width", String(frame.width));
      filter.setAttribute("height", String(frame.height));
      filter.setAttribute("color-interpolation-filters", "sRGB");
      filter.innerHTML =
        `<feImage href="${frame.url}" x="0" y="0" width="${frame.width}" height="${frame.height}" preserveAspectRatio="none" result="map"/>` +
        `<feDisplacementMap in="SourceGraphic" in2="map" xChannelSelector="R" yChannelSelector="G" scale="${Math.max(2, bezel * 2)}"/>`;
      svg.appendChild(filter);
      return () => {
        filter.remove();
      };
    }, [refract, frame, filterId, bezel]);

    const active = refract && frame !== null && frame.url !== "";
    const backdrop = active
      ? `url(#${filterId}) blur(${blur}px) brightness(${brightness}) saturate(${saturation})`
      : `blur(${fallbackBlur}px) brightness(${brightness}) saturate(${saturation})`;

    // The reference material: a hard 1px white glint, a soft inner shade and a
    // small drop shadow. The light calibration keeps the glint ~25% quieter
    // than the reference so content behind the glass stays legible. Dark glass
    // gets a real white rim plus an inner halo: on a near-black canvas a pure
    // transparent pane would otherwise disappear completely.
    const glint = appearance === "dark" ? 0.34 : 0.55;
    const shade = appearance === "dark" ? 0.24 : 0.13;
    const boxShadow =
      appearance === "dark"
        ? [
            "0 4px 8px rgba(0, 0, 0, 0.25)",
            "0 0 0 1px rgba(255, 255, 255, 0.10)",
            "inset 0 0 0 1px rgba(255, 255, 255, 0.30)",
            "inset 0 0 22px rgba(255, 255, 255, 0.08)",
            `inset 0 -10px 25px rgba(0, 0, 0, ${shade})`,
            `inset 0 -1px 4px 1px rgba(255, 255, 255, ${glint})`,
          ].join(", ")
        : `0 4px 8px rgba(0, 0, 0, 0.25), inset 0 -10px 25px rgba(0, 0, 0, ${shade}), inset 0 -1px 4px 1px rgba(255, 255, 255, ${glint})`;

    // Dark glass carries a whisper of the accent so the material reads as part
    // of the app's palette instead of a neutral grey pane. It is a real
    // background layer (open alpha) painted over the refracted backdrop, so
    // nothing behind the glass is hidden.
    const tint =
      appearance === "dark"
        ? "linear-gradient(135deg, color-mix(in oklab, var(--primary) 16%, transparent) 0%, color-mix(in oklab, var(--primary) 7%, transparent) 48%, color-mix(in oklab, var(--primary) 13%, transparent) 100%)"
        : undefined;

    return (
      <div
        {...props}
        ref={ref}
        data-liquid-glass="panel"
        data-appearance={appearance}
        className={className}
        style={{
          ...style,
          ...(tint ? { background: tint } : {}),
          overflow: "hidden",
          boxShadow,
          backdropFilter: backdrop,
          WebkitBackdropFilter: active
            ? `blur(${blur}px) brightness(${brightness}) saturate(${saturation})`
            : backdrop,
        }}
      >
        {children}
      </div>
    );
  },
);
LiquidGlassPanel.displayName = "LiquidGlassPanel";
