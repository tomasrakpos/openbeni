// Reusable UI primitive smoky-button — WebGL silk-smoke button adapted for
// OpenHarness light/dark + accent themes with optional jelly-stretch physics.
import {
  forwardRef,
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { useJellyStretch } from "@/lib/useJellyStretch";

export interface SmokeColors {
  primary: string;
  secondary: string;
  shadow: string;
}

export interface SmokyButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  colors?: SmokeColors;
  status?: string;
  speed?: number;
  /** Optional custom inner layout (replaces the default label + status stack). */
  customContent?: ReactNode;
  /** Disable jelly stretch physics if needed. */
  disableJelly?: boolean;
}

type RgbColor = readonly [number, number, number];

interface SmokeSettings {
  colors: readonly [RgbColor, RgbColor, RgbColor];
  speed: number;
}

interface SmokeRenderer {
  update: (settings: SmokeSettings) => void;
  destroy: () => void;
}

const VERTEX_SHADER = `
  attribute vec2 aPosition;

  void main() {
    gl_Position = vec4(aPosition, 0.0, 1.0);
  }
`;

const FRAGMENT_SHADER = `
  precision mediump float;

  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uSpeed;
  uniform vec3 uPrimary;
  uniform vec3 uSecondary;
  uniform vec3 uShadow;

  float random(vec2 position) {
    return fract(sin(dot(position, vec2(12.9898, 78.233))) * 43758.5453);
  }

  float noise(vec2 position) {
    vec2 cell = floor(position);
    vec2 offset = fract(position);
    float a = random(cell);
    float b = random(cell + vec2(1.0, 0.0));
    float c = random(cell + vec2(0.0, 1.0));
    float d = random(cell + vec2(1.0, 1.0));
    vec2 blend = offset * offset * (3.0 - 2.0 * offset);
    return mix(a, b, blend.x)
      + (c - a) * blend.y * (1.0 - blend.x)
      + (d - b) * blend.x * blend.y;
  }

  float fbm(vec2 position) {
    float value = 0.0;
    float amplitude = 0.5;
    mat2 rotation = mat2(0.8776, 0.4794, -0.4794, 0.8776);

    for (int i = 0; i < 7; i++) {
      value += amplitude * noise(position);
      position = rotation * position * 2.04 + vec2(13.7, 9.2);
      amplitude *= 0.5;
    }

    return value;
  }

  void main() {
    vec2 uv = gl_FragCoord.xy / uResolution.xy;
    vec2 position = (gl_FragCoord.xy - 0.5 * uResolution.xy) / uResolution.y;
    float time = uTime * uSpeed * 0.58;

    vec2 silkPosition = position;
    silkPosition.y += 0.20 * sin(position.x * 1.55 - time * 1.8)
      + 0.11 * sin(position.x * 3.2 + time * 1.35);
    silkPosition.x += 0.06 * sin(position.y * 4.2 - time * 1.1);

    vec2 warp = vec2(
      fbm(silkPosition * 1.15 + vec2(time * 0.28, -time * 0.17)),
      fbm(silkPosition * 1.05 + vec2(4.8, 1.3) - vec2(time * 0.18, time * 0.22))
    );
    vec2 current = silkPosition + (warp - 0.5) * 0.82;
    float body = fbm(current * 1.35 + vec2(-time * 0.24, time * 0.14));
    float detail = fbm(current * 2.7 + vec2(time * 0.31, -time * 0.27));
    float primaryPlume = fbm(current * 1.20 + vec2(-time * 0.38, time * 0.18));
    float secondaryPlume = fbm(
      current * 1.10 + vec2(time * 0.26, -time * 0.32) + vec2(7.2, 3.6)
    );
    float shadowPlume = fbm(
      current * 1.45 + vec2(-time * 0.18, time * 0.42) + vec2(2.4, 8.1)
    );
    float bottomPlume = fbm(
      vec2(current.x * 0.92 - time * 0.34, current.y * 0.76 + time * 0.16)
        + vec2(6.4, 2.3)
    );

    float sharedFlow = current.y * 6.8 + current.x * 1.35 + (warp.x - warp.y) * 5.2;
    float crossFlow = current.y * 5.4 - current.x * 2.1 + (warp.x + warp.y) * 3.5;
    float primaryRibbon = 0.5 + 0.5 * sin(sharedFlow - time * 2.75);
    float secondaryRibbon = 0.5 + 0.5 * sin(crossFlow + time * 2.35 + 2.1);
    float shadowRibbon = 0.5 + 0.5 * sin(
      sharedFlow * 0.78 - crossFlow * 0.22 - time * 3.25 + 4.2
    );
    primaryRibbon = smoothstep(0.08, 0.92, primaryRibbon);
    secondaryRibbon = smoothstep(0.08, 0.92, secondaryRibbon);
    shadowRibbon = smoothstep(0.12, 0.88, shadowRibbon);

    float primaryWeight = smoothstep(0.27, 0.76, primaryPlume + 0.24 * body)
      * (0.20 + 1.08 * primaryRibbon);
    float secondaryWeight = smoothstep(0.26, 0.74, secondaryPlume + 0.22 * body)
      * (0.22 + 1.04 * secondaryRibbon + 0.12 * detail);
    float shadowWeight = 0.16 + smoothstep(0.32, 0.80, shadowPlume + 0.14 * body)
      * (0.22 + 0.86 * shadowRibbon);
    float totalWeight = max(primaryWeight + secondaryWeight + shadowWeight, 0.001);
    vec3 color = (
      uPrimary * primaryWeight
      + uSecondary * secondaryWeight
      + uShadow * shadowWeight
    ) / totalWeight;

    float depth = smoothstep(0.15, 0.88, body * 0.78 + detail * 0.30);
    color *= 0.65 + depth * 0.62;
    float shadowVein = smoothstep(
      0.46,
      0.80,
      shadowPlume + 0.10 * body + 0.16 * shadowRibbon
    );
    color = mix(color, uShadow, shadowVein * (0.12 + 0.42 * shadowRibbon));

    float sheenWave = 0.5 + 0.5 * sin(sharedFlow * 1.22 - time * 3.2 + detail * 2.0);
    float sheen = pow(sheenWave, 6.0);
    color += mix(uSecondary, uPrimary, primaryRibbon) * sheen * (0.10 + 0.16 * depth);

    float bottomRidge = 0.26 + 0.24 * bottomPlume
      + 0.08 * sin(current.x * 2.35 - time * 2.6 + warp.x * 3.0);
    float bottomEnvelope = 1.0 - smoothstep(bottomRidge, bottomRidge + 0.24, uv.y);
    float bottomCloud = smoothstep(0.18, 0.72, bottomPlume + 0.22 * detail);
    float bottomMask = bottomEnvelope * (0.48 + 0.52 * bottomCloud);
    float bottomFlow = 0.5 + 0.5 * sin(current.x * 2.1 - time * 2.4 + warp.y * 4.0);
    vec3 bottomColor = mix(uPrimary, uSecondary, smoothstep(0.12, 0.88, bottomFlow));
    float bottomShadow = smoothstep(0.48, 0.78, shadowPlume + 0.18 * bottomPlume);
    bottomColor = mix(bottomColor, uShadow, bottomShadow * 0.72);
    float bottomSheen = pow(0.5 + 0.5 * sin(bottomFlow * 5.0 + time * 2.2), 5.0);
    bottomColor += mix(uSecondary, uPrimary, bottomFlow) * bottomSheen * 0.12;
    color = mix(color, bottomColor, bottomMask * 0.72);

    float feather = uv.x
      + 0.12 * (body - 0.5)
      + 0.08 * (bottomPlume - 0.5)
      + 0.04 * sin(current.y * 3.0 - time * 1.4);
    float alpha = smoothstep(0.24, 0.72, feather);

    gl_FragColor = vec4(clamp(color, 0.0, 1.0), alpha);
  }
`;

const SMOKY_CSS_ID = "oh-smoky-button-css";
const SMOKY_CSS = `
.smoky-button {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  overflow: hidden;
  isolation: isolate;
  border-radius: 16px;
  padding: 10px 12px;
  border: 1px solid color-mix(in oklab, var(--primary) 26%, var(--border-strong));
  background: linear-gradient(
    135deg,
    color-mix(in oklab, var(--surface-1) 92%, var(--primary) 8%),
    color-mix(in oklab, var(--surface-2) 86%, var(--primary) 14%)
  );
  color: var(--foreground);
  font: inherit;
  text-align: start;
  cursor: pointer;
  user-select: none;
  touch-action: none;
  -webkit-tap-highlight-color: transparent;
  box-shadow:
    inset 0 1px 0 var(--glass-inner-top, rgba(255, 255, 255, 0.18)),
    0 10px 26px -14px color-mix(in oklab, var(--accent-glow, var(--primary)) 45%, transparent);
  transition: border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
}
.dark .smoky-button {
  border-color: color-mix(in oklab, var(--primary) 30%, rgba(255, 255, 255, 0.12));
  background: linear-gradient(
    135deg,
    color-mix(in oklab, var(--surface-1) 94%, #000 6%),
    color-mix(in oklab, var(--surface-2) 88%, var(--primary) 12%)
  );
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.14),
    0 12px 28px -14px rgba(0, 0, 0, 0.72),
    0 0 0 1px color-mix(in oklab, var(--primary) 10%, transparent);
}
.smoky-button:hover:not(:disabled),
.smoky-button[aria-expanded="true"] {
  border-color: color-mix(in oklab, var(--primary) 48%, var(--border-strong));
  box-shadow:
    inset 0 1px 0 var(--glass-inner-top, rgba(255, 255, 255, 0.24)),
    0 14px 32px -12px color-mix(in oklab, var(--accent-glow, var(--primary)) 58%, transparent);
}
.smoky-button:focus-visible {
  outline: 2px solid var(--ring, var(--primary));
  outline-offset: 3px;
}
.smoky-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.smoky-button__canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 0;
  opacity: 0.82;
}
.dark .smoky-button__canvas {
  opacity: 0.94;
}
[dir="rtl"] .smoky-button__canvas {
  transform: scaleX(-1);
}
.smoky-button__content {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-width: 0;
}
.smoky-button__copy {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.smoky-button__label {
  font-size: 13.5px;
  font-weight: 600;
  line-height: 1.25;
  color: var(--foreground);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.smoky-button__status {
  font-size: 11px;
  color: var(--muted-foreground);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
`;

function ensureSmokyStyles() {
  if (typeof document === "undefined") return;
  const existing = document.getElementById(SMOKY_CSS_ID);
  if (existing) {
    existing.textContent = SMOKY_CSS;
    return;
  }
  const style = document.createElement("style");
  style.id = SMOKY_CSS_ID;
  style.textContent = SMOKY_CSS;
  document.head.appendChild(style);
}

const createShader = (gl: WebGLRenderingContext, type: number, source: string) => {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Unable to create WebGL shader.");

  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? "Unknown shader error.";
    gl.deleteShader(shader);
    throw new Error(message);
  }

  return shader;
};

const createProgram = (gl: WebGLRenderingContext) => {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = gl.createProgram();
  if (!program) throw new Error("Unable to create WebGL program.");

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) ?? "Unknown WebGL program error.";
    gl.deleteProgram(program);
    throw new Error(message);
  }

  return program;
};

const getUniform = (gl: WebGLRenderingContext, program: WebGLProgram, name: string) => {
  const location = gl.getUniformLocation(program, name);
  if (!location) throw new Error(`Missing WebGL uniform: ${name}`);
  return location;
};

export const hexToRgb = (hex: string): RgbColor => {
  const value = hex.replace("#", "").trim();
  const normalized =
    value.length === 3
      ? value
          .split("")
          .map((character) => character + character)
          .join("")
      : value;
  const parsed = Number.parseInt(normalized, 16);

  if (normalized.length !== 6 || Number.isNaN(parsed)) return [0, 0, 0];
  return [
    ((parsed >> 16) & 255) / 255,
    ((parsed >> 8) & 255) / 255,
    (parsed & 255) / 255,
  ];
};

const createSmokeRenderer = (
  canvas: HTMLCanvasElement,
  initialSettings: SmokeSettings,
): SmokeRenderer => {
  const gl = canvas.getContext("webgl", {
    alpha: true,
    antialias: false,
    premultipliedAlpha: true,
  });
  if (!gl) throw new Error("WebGL is not available in this browser.");

  const program = createProgram(gl);
  const buffer = gl.createBuffer();
  if (!buffer) throw new Error("Unable to create WebGL buffer.");

  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

  const position = gl.getAttribLocation(program, "aPosition");
  const resolution = getUniform(gl, program, "uResolution");
  const time = getUniform(gl, program, "uTime");
  const speed = getUniform(gl, program, "uSpeed");
  const primary = getUniform(gl, program, "uPrimary");
  const secondary = getUniform(gl, program, "uSecondary");
  const shadow = getUniform(gl, program, "uShadow");
  let settings = initialSettings;
  let frame = 0;
  let destroyed = false;

  const reducedMotion = Boolean(
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  );

  const resize = () => {
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w <= 0 || h <= 0) return false;
    const nextW = Math.max(1, Math.round(w * pixelRatio));
    const nextH = Math.max(1, Math.round(h * pixelRatio));
    if (canvas.width !== nextW || canvas.height !== nextH) {
      canvas.width = nextW;
      canvas.height = nextH;
    }
    return true;
  };

  const startedAt = performance.now();

  const drawFrame = (now: number) => {
    if (
      typeof canvas.checkVisibility === "function" &&
      !canvas.checkVisibility({ checkVisibilityCSS: true })
    ) {
      return;
    }
    if (!resize()) return;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(resolution, canvas.width, canvas.height);
    gl.uniform1f(time, reducedMotion ? 1.8 : (now - startedAt) / 1000);
    gl.uniform1f(speed, settings.speed);
    gl.uniform3f(primary, ...settings.colors[0]);
    gl.uniform3f(secondary, ...settings.colors[1]);
    gl.uniform3f(shadow, ...settings.colors[2]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const render = (now: number) => {
    if (destroyed) return;
    if (!document.hidden) {
      drawFrame(now);
    }
    if (!reducedMotion) {
      frame = requestAnimationFrame(render);
    } else {
      frame = 0;
    }
  };

  const resizeObserver = new ResizeObserver(() => {
    if (resize() && reducedMotion) {
      drawFrame(performance.now());
    }
  });
  resizeObserver.observe(canvas.parentElement ?? canvas);
  resize();
  frame = requestAnimationFrame(render);

  return {
    update(nextSettings) {
      settings = nextSettings;
      if (reducedMotion) {
        drawFrame(performance.now());
      }
    },
    destroy() {
      destroyed = true;
      if (frame) cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    },
  };
};

export const DEFAULT_SMOKE_COLORS: SmokeColors = {
  primary: "#7C4DFF",
  secondary: "#2DD4E8",
  shadow: "#090B14",
};

/** Returns site-theme-matched smoke colors for dark/light × violet/ember. */
export function resolveSiteSmokeColors(
  isDark: boolean,
  accent: string | null | undefined,
): SmokeColors {
  const isEmber = accent === "ember";
  if (isDark) {
    if (isEmber) {
      return {
        primary: "#E0531A",
        secondary: "#FF9B5E",
        shadow: "#0B0807",
      };
    }
    return {
      primary: "#7C4DFF",
      secondary: "#2DD4E8",
      shadow: "#090B14",
    };
  }

  if (isEmber) {
    return {
      primary: "#DE5A20",
      secondary: "#FFA86B",
      shadow: "#F5DFD2",
    };
  }
  return {
    primary: "#6D56F5",
    secondary: "#54C8DC",
    shadow: "#E4E0FA",
  };
}

export const SmokyButton = forwardRef<HTMLButtonElement, SmokyButtonProps>(
  (
    {
      children = "Smoky Button",
      className = "",
      colors = DEFAULT_SMOKE_COLORS,
      status = "ready",
      speed = 1,
      customContent,
      disableJelly = false,
      type = "button",
      ...props
    },
    ref,
  ) => {
    ensureSmokyStyles();
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const rendererRef = useRef<SmokeRenderer | null>(null);
    const colorsRef = useRef(colors);
    const speedRef = useRef(speed);
    colorsRef.current = colors;
    speedRef.current = speed;

    const jellyRef = useJellyStretch<HTMLButtonElement>(ref, {
      enabled: !disableJelly && !props.disabled,
    });

    useEffect(() => {
      if (!canvasRef.current) return;

      try {
        rendererRef.current = createSmokeRenderer(canvasRef.current, {
          colors: [
            hexToRgb(colorsRef.current.primary),
            hexToRgb(colorsRef.current.secondary),
            hexToRgb(colorsRef.current.shadow),
          ],
          speed: speedRef.current,
        });
      } catch {
        // Gracefully degrade to the themed CSS gradient when WebGL is unavailable.
      }

      return () => {
        rendererRef.current?.destroy();
        rendererRef.current = null;
      };
    }, []);

    useEffect(() => {
      rendererRef.current?.update({
        colors: [
          hexToRgb(colors.primary),
          hexToRgb(colors.secondary),
          hexToRgb(colors.shadow),
        ],
        speed,
      });
    }, [colors.primary, colors.secondary, colors.shadow, speed]);

    return (
      <button
        {...props}
        ref={jellyRef}
        type={type}
        className={`smoky-button ${className}`.trim()}
      >
        <canvas ref={canvasRef} className="smoky-button__canvas" aria-hidden="true" />
        {customContent !== undefined ? (
          <span className="smoky-button__content">{customContent}</span>
        ) : (
          <span className="smoky-button__copy">
            <span className="smoky-button__label">{children}</span>
            {status ? <span className="smoky-button__status">{status}</span> : null}
          </span>
        )}
      </button>
    );
  },
);

SmokyButton.displayName = "SmokyButton";

export default SmokyButton;
