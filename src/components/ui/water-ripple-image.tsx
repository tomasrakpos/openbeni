import React, { useEffect, useRef, useState } from "react";

type Params = {
  blueish: number;
  scale: number;
  illumination: number;
  surfaceDistortion: number;
  waterDistortion: number;
  /** default image to load initially */
  src: string;
};

export type WaterRippleImageProps = Partial<Params> & {
  showControls?: boolean;
  /** Extra class on the canvas wrapper */
  className?: string;
};

const VERT = `
precision mediump float;
varying vec2 vUv;
attribute vec2 a_position;
void main() {
  vUv = .5 * (a_position + 1.);
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const NOISE_GLSL = `
#define TWO_PI 6.28318530718
#define PI 3.14159265358979323846

vec3 mod289(vec3 x) { return x - floor(x * (1. / 289.)) * 289.; }
vec2 mod289(vec2 x) { return x - floor(x * (1. / 289.)) * 289.; }
vec3 permute(vec3 x) { return mod289(((x*34.)+1.)*x); }
float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1;
  i1 = (x0.x > x0.y) ? vec2(1., 0.) : vec2(0., 1.);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute(permute(i.y + vec3(0., i1.y, 1.)) + i.x + vec3(0., i1.x, 1.));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.);
  m = m*m;
  m = m*m;
  vec3 x = 2. * fract(p * C.www) - 1.;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130. * dot(m, g);
}

mat2 rotate2D(float r) {
  return mat2(cos(r), sin(r), -sin(r), cos(r));
}

float surface_noise(vec2 uv, float t, float scale) {
  vec2 n = vec2(.1);
  vec2 N = vec2(.1);
  mat2 m = rotate2D(.5);
  for (int j = 0; j < 10; j++) {
    uv *= m;
    n *= m;
    vec2 q = uv * scale + float(j) + n + (.5 + .5 * float(j)) * (mod(float(j), 2.) - 1.) * t;
    n += sin(q);
    N += cos(q) / scale;
    scale *= 1.2;
  }
  return (N.x + N.y + .1);
}
`;

const FRAG = `
precision mediump float;

varying vec2 vUv;
uniform sampler2D u_image_texture;
uniform float u_time;
uniform float u_ratio;
uniform float u_img_ratio;
uniform float u_blueish;
uniform float u_scale;
uniform float u_illumination;
uniform float u_surface_distortion;
uniform float u_water_distortion;
${NOISE_GLSL}
void main() {
  vec2 uv = vUv;
  uv.y = 1. - uv.y;
  uv.x *= u_ratio;

  float t = .002 * u_time;
  vec3 color = vec3(0.);
  float opacity = 0.;

  float outer_noise = snoise((.3 + .1 * sin(t)) * uv + vec2(0., .2 * t));
  vec2 surface_noise_uv = 2. * uv + (outer_noise * .2);

  float surf = surface_noise(surface_noise_uv, t, u_scale);
  surf *= pow(uv.y, .3);
  surf = pow(surf, 2.);

  vec2 img_uv = vUv;
  img_uv -= .5;
  if (u_ratio > u_img_ratio) {
    img_uv.x = img_uv.x * u_ratio / u_img_ratio;
  } else {
    img_uv.y = img_uv.y * u_img_ratio / u_ratio;
  }
  float scale_factor = 1.4;
  img_uv *= scale_factor;
  img_uv += .5;
  img_uv.y = 1. - img_uv.y;

  img_uv += (u_water_distortion * outer_noise);
  img_uv += (u_surface_distortion * surf);

  vec4 img = texture2D(u_image_texture, img_uv);
  img *= (1. + u_illumination * surf);

  color += img.rgb;
  color += u_illumination * vec3(1. - u_blueish, 1., 1.) * surf;
  opacity += img.a;

  float edge_width = .02;
  float edge_alpha = smoothstep(0., edge_width, img_uv.x) * smoothstep(1., 1. - edge_width, img_uv.x);
  edge_alpha *= smoothstep(0., edge_width, img_uv.y) * smoothstep(1., 1. - edge_width, img_uv.y);
  color *= edge_alpha;
  opacity *= edge_alpha;

  gl_FragColor = vec4(color, opacity);
}
`;

/* Same water-ripple shader applied to a dynamic gradient water body (used
   inside the credit bar so it renders live caustics & refraction over the
   green -> orange -> red palette with zero external image dependency). */
const FILL_FRAG = `
precision mediump float;

varying vec2 vUv;
uniform float u_time;
uniform float u_ratio;
uniform float u_scale;
uniform float u_illumination;
uniform float u_surface_distortion;
uniform float u_water_distortion;
uniform vec3 u_color_a;
uniform vec3 u_color_b;
uniform vec3 u_color_deep;
${NOISE_GLSL}
void main() {
  vec2 uv = vUv;
  uv.y = 1. - uv.y;
  uv.x *= u_ratio;

  float t = .0016 * u_time;

  float outer_noise = snoise((.35 + .1 * sin(t)) * uv + vec2(.18 * t, .12 * t));
  vec2 surface_noise_uv = 1.65 * uv + (outer_noise * .24);

  float surf = surface_noise(surface_noise_uv, t, u_scale);
  surf *= pow(clamp(0.35 + 0.65 * (1. - vUv.y), 0.0, 1.0), .35);
  surf = pow(max(surf, 0.0), 1.85);

  vec2 water_uv = vUv;
  water_uv += (u_water_distortion * outer_noise);
  water_uv += (u_surface_distortion * surf);

  float grad = clamp(water_uv.x * 0.85 + (1.0 - water_uv.y) * 0.25, 0.0, 1.0);
  vec3 base = mix(u_color_a, u_color_b, grad);
  // Subtle depth shadow along the lower edge and luminous top meniscus
  base = mix(u_color_deep, base, smoothstep(0.0, 0.72, vUv.y));

  vec3 caustic_tint = mix(u_color_b, vec3(1.0), 0.72);
  vec3 color = base * (1.0 + u_illumination * 0.85 * surf);
  color += u_illumination * caustic_tint * surf * 1.15;

  // Gentle glossy specular sheen along the upper waterline
  float sheen = smoothstep(0.58, 0.98, vUv.y) * (0.22 + 0.12 * surf);
  color = mix(color, vec3(1.0), clamp(sheen, 0.0, 0.42));

  gl_FragColor = vec4(color, 0.92);
}
`;

function compileShader(gl: WebGLRenderingContext, src: string, type: number) {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`Shader compile error: ${info || "unknown"}`);
  }
  return sh;
}

function createProgram(gl: WebGLRenderingContext, vs: string, fs: string) {
  const v = compileShader(gl, vs, gl.VERTEX_SHADER);
  const f = compileShader(gl, fs, gl.FRAGMENT_SHADER);
  const prog = gl.createProgram()!;
  gl.attachShader(prog, v);
  gl.attachShader(prog, f);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error(`Program link error: ${info || "unknown"}`);
  }
  return prog;
}

export interface WaterRippleFillProps {
  /** Base start RGB (0..1) */
  colorA: [number, number, number];
  /** Base end RGB (0..1) */
  colorB: [number, number, number];
  /** Deeper bottom-edge RGB (0..1) */
  colorDeep: [number, number, number];
  /** Wave frequency scale. Default 4.2 */
  scale?: number;
  /** Caustic illumination intensity. Default 0.28 */
  illumination?: number;
  /** Surface distortion amount. Default 0.05 */
  surfaceDistortion?: number;
  /** Outer water distortion amount. Default 0.03 */
  waterDistortion?: number;
  /** Flow speed multiplier (boosted while draining). Default 1 */
  speed?: number;
  className?: string;
}

/**
 * Compact WebGL water-ripple surface sized to its container (used inside the
 * credit bar). Shares the exact snoise + surface_noise shader from
 * WaterRippleImage, rendered over dynamic RGB uniforms with automatic fallback.
 */
export function WaterRippleFill({
  colorA,
  colorB,
  colorDeep,
  scale = 4.2,
  illumination = 0.28,
  surfaceDistortion = 0.05,
  waterDistortion = 0.03,
  speed = 1,
  className = "",
}: WaterRippleFillProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const propsRef = useRef({
    colorA,
    colorB,
    colorDeep,
    scale,
    illumination,
    surfaceDistortion,
    waterDistortion,
    speed,
  });
  propsRef.current = {
    colorA,
    colorB,
    colorDeep,
    scale,
    illumination,
    surfaceDistortion,
    waterDistortion,
    speed,
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl =
      canvas.getContext("webgl", { alpha: true, antialias: true, powerPreference: "low-power" }) ||
      (canvas.getContext("experimental-webgl") as WebGLRenderingContext | null);
    if (!gl) return;

    let program: WebGLProgram;
    try {
      program = createProgram(gl, VERT, FILL_FRAG);
    } catch {
      return;
    }
    gl.useProgram(program);

    const uniforms: Record<string, WebGLUniformLocation | null> = {};
    const uniformCount = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < uniformCount; i++) {
      const info = gl.getActiveUniform(program, i);
      if (info) uniforms[info.name] = gl.getUniformLocation(program, info.name);
    }

    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const posLoc = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const syncSize = () => {
      const w = Math.max(2, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(2, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
      if (uniforms["u_ratio"]) {
        gl.uniform1f(uniforms["u_ratio"], canvas.width / Math.max(1, canvas.height));
      }
    };

    syncSize();
    const ro = new ResizeObserver(syncSize);
    ro.observe(canvas);

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let rafId = 0;
    let simTime = 1200;
    let lastNow = performance.now();
    let inView = true;
    let docVisible = typeof document === "undefined" || !document.hidden;

    const schedule = () => {
      if (rafId || reducedMotion || !inView || !docVisible) return;
      lastNow = performance.now();
      rafId = requestAnimationFrame(draw);
    };

    const draw = (now: number) => {
      rafId = 0;
      if (!inView || !docVisible) return;
      const dt = Math.min(64, Math.max(0, now - lastNow));
      lastNow = now;
      const p = propsRef.current;
      if (!reducedMotion) {
        simTime += dt * p.speed;
      }

      if (uniforms["u_time"]) gl.uniform1f(uniforms["u_time"], simTime);
      if (uniforms["u_scale"]) gl.uniform1f(uniforms["u_scale"], p.scale);
      if (uniforms["u_illumination"]) gl.uniform1f(uniforms["u_illumination"], p.illumination);
      if (uniforms["u_surface_distortion"]) gl.uniform1f(uniforms["u_surface_distortion"], p.surfaceDistortion);
      if (uniforms["u_water_distortion"]) gl.uniform1f(uniforms["u_water_distortion"], p.waterDistortion);
      if (uniforms["u_color_a"]) gl.uniform3f(uniforms["u_color_a"], p.colorA[0], p.colorA[1], p.colorA[2]);
      if (uniforms["u_color_b"]) gl.uniform3f(uniforms["u_color_b"], p.colorB[0], p.colorB[1], p.colorB[2]);
      if (uniforms["u_color_deep"]) gl.uniform3f(uniforms["u_color_deep"], p.colorDeep[0], p.colorDeep[1], p.colorDeep[2]);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (!reducedMotion && inView && docVisible) {
        rafId = requestAnimationFrame(draw);
      }
    };

    const io =
      typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver(([entry]) => {
            inView = entry?.isIntersecting ?? true;
            if (inView) {
              syncSize();
              schedule();
            } else if (rafId) {
              cancelAnimationFrame(rafId);
              rafId = 0;
            }
          })
        : null;
    io?.observe(canvas);

    const onVis = () => {
      docVisible = !document.hidden;
      if (docVisible) schedule();
      else if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
    };
    document.addEventListener("visibilitychange", onVis);

    rafId = requestAnimationFrame(draw);

    return () => {
      ro.disconnect();
      io?.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      if (rafId) cancelAnimationFrame(rafId);
      gl.deleteBuffer(vbo);
      gl.useProgram(null);
      gl.deleteProgram(program);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`pointer-events-none block h-full w-full ${className}`}
    />
  );
}

/* --------------------------------------------------------------------------
 * Shared single-context WebGL water renderer for multiple icon tiles.
 * Browsers cap concurrent WebGL contexts (~16); sharing one offscreen GL
 * context lets dozens of provider icons animate with the exact same shader
 * without ever losing a WebGL context.
 * -------------------------------------------------------------------------- */

interface SharedTileTarget {
  canvas: HTMLCanvasElement;
  ctx2d: CanvasRenderingContext2D;
  cw: number;
  ch: number;
  visible: boolean;
  props: {
    colorA: [number, number, number];
    colorB: [number, number, number];
    colorDeep: [number, number, number];
    scale: number;
    illumination: number;
    surfaceDistortion: number;
    waterDistortion: number;
    speed: number;
    phaseOffset: number;
  };
}

interface SharedEngine {
  offscreen: HTMLCanvasElement;
  gl: WebGLRenderingContext;
  uniforms: Record<string, WebGLUniformLocation | null>;
  targets: Set<SharedTileTarget>;
  rafId: number;
  simTime: number;
  lastNow: number;
  reducedMotion: boolean;
  visAttached: boolean;
}

let sharedEngine: SharedEngine | null = null;
const OFFSCREEN_MAX = 128;

function getSharedWaterEngine(): SharedEngine | null {
  if (sharedEngine) return sharedEngine;
  if (typeof document === "undefined") return null;

  const offscreen = document.createElement("canvas");
  offscreen.width = OFFSCREEN_MAX;
  offscreen.height = OFFSCREEN_MAX;
  const gl =
    offscreen.getContext("webgl", { alpha: true, antialias: true, powerPreference: "low-power" }) ||
    (offscreen.getContext("experimental-webgl") as WebGLRenderingContext | null);
  if (!gl) return null;

  let program: WebGLProgram;
  try {
    program = createProgram(gl, VERT, FILL_FRAG);
  } catch {
    return null;
  }
  gl.useProgram(program);

  const uniforms: Record<string, WebGLUniformLocation | null> = {};
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(program, i);
    if (info) uniforms[info.name] = gl.getUniformLocation(program, info.name);
  }

  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const posLoc = gl.getAttribLocation(program, "a_position");
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

  sharedEngine = {
    offscreen,
    gl,
    uniforms,
    targets: new Set(),
    rafId: 0,
    simTime: 1800,
    lastNow: performance.now(),
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    visAttached: false,
  };
  if (!sharedEngine.visAttached) {
    sharedEngine.visAttached = true;
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) wakeSharedWater();
    });
  }
  return sharedEngine;
}

function wakeSharedWater() {
  const engine = sharedEngine;
  if (!engine || engine.rafId || engine.targets.size === 0) return;
  if (typeof document !== "undefined" && document.hidden) return;
  let anyVisible = false;
  for (const t of engine.targets) {
    if (t.visible) {
      anyVisible = true;
      break;
    }
  }
  if (!anyVisible) return;
  engine.lastNow = performance.now();
  engine.rafId = requestAnimationFrame(tickSharedWater);
}

function tickSharedWater(now: number) {
  const engine = sharedEngine;
  if (!engine) return;
  engine.rafId = 0;
  if (engine.targets.size === 0) return;
  if (typeof document !== "undefined" && document.hidden) return;

  const dt = Math.min(64, Math.max(0, now - engine.lastNow));
  engine.lastNow = now;
  if (!engine.reducedMotion) {
    engine.simTime += dt;
  }

  const { gl, uniforms, offscreen } = engine;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let rendered = 0;

  for (const target of engine.targets) {
    if (!target.visible) continue;
    const { canvas, ctx2d, props, cw, ch } = target;
    if (cw < 2 || ch < 2) continue;
    rendered++;

    const rw = Math.min(OFFSCREEN_MAX, Math.max(2, Math.round(cw * dpr)));
    const rh = Math.min(OFFSCREEN_MAX, Math.max(2, Math.round(ch * dpr)));
    if (canvas.width !== rw || canvas.height !== rh) {
      canvas.width = rw;
      canvas.height = rh;
    }

    gl.viewport(0, OFFSCREEN_MAX - rh, rw, rh);
    if (uniforms["u_ratio"]) gl.uniform1f(uniforms["u_ratio"], rw / Math.max(1, rh));
    if (uniforms["u_time"]) gl.uniform1f(uniforms["u_time"], engine.simTime * props.speed + props.phaseOffset);
    if (uniforms["u_scale"]) gl.uniform1f(uniforms["u_scale"], props.scale);
    if (uniforms["u_illumination"]) gl.uniform1f(uniforms["u_illumination"], props.illumination);
    if (uniforms["u_surface_distortion"]) gl.uniform1f(uniforms["u_surface_distortion"], props.surfaceDistortion);
    if (uniforms["u_water_distortion"]) gl.uniform1f(uniforms["u_water_distortion"], props.waterDistortion);
    if (uniforms["u_color_a"]) gl.uniform3f(uniforms["u_color_a"], props.colorA[0], props.colorA[1], props.colorA[2]);
    if (uniforms["u_color_b"]) gl.uniform3f(uniforms["u_color_b"], props.colorB[0], props.colorB[1], props.colorB[2]);
    if (uniforms["u_color_deep"]) gl.uniform3f(uniforms["u_color_deep"], props.colorDeep[0], props.colorDeep[1], props.colorDeep[2]);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    ctx2d.clearRect(0, 0, rw, rh);
    ctx2d.drawImage(offscreen, 0, 0, rw, rh, 0, 0, rw, rh);
  }

  if (!engine.reducedMotion && rendered > 0) {
    engine.rafId = requestAnimationFrame(tickSharedWater);
  }
}

export interface WaterRippleTileProps extends WaterRippleFillProps {
  /** Time phase offset (ms) so adjacent icons ripple naturally out of sync. */
  phaseOffset?: number;
}

/**
 * Multi-instance water-ripple tile backed by a single shared WebGL context.
 * Ideal for grids of provider icons.
 */
export function WaterRippleTile({
  colorA,
  colorB,
  colorDeep,
  scale = 4.6,
  illumination = 0.28,
  surfaceDistortion = 0.05,
  waterDistortion = 0.03,
  speed = 0.9,
  phaseOffset = 0,
  className = "",
}: WaterRippleTileProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const targetRef = useRef<SharedTileTarget | null>(null);

  if (targetRef.current) {
    targetRef.current.props = {
      colorA,
      colorB,
      colorDeep,
      scale,
      illumination,
      surfaceDistortion,
      waterDistortion,
      speed,
      phaseOffset,
    };
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx2d = canvas.getContext("2d");
    const engine = getSharedWaterEngine();
    if (!ctx2d || !engine) return;

    const target: SharedTileTarget = {
      canvas,
      ctx2d,
      cw: canvas.clientWidth,
      ch: canvas.clientHeight,
      visible: true,
      props: {
        colorA,
        colorB,
        colorDeep,
        scale,
        illumination,
        surfaceDistortion,
        waterDistortion,
        speed,
        phaseOffset,
      },
    };
    targetRef.current = target;
    engine.targets.add(target);

    const ro = new ResizeObserver(() => {
      target.cw = canvas.clientWidth;
      target.ch = canvas.clientHeight;
      if (target.visible && target.cw >= 2 && target.ch >= 2) wakeSharedWater();
    });
    ro.observe(canvas);

    const io =
      typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver(([entry]) => {
            target.visible = entry?.isIntersecting ?? true;
            if (target.visible) {
              target.cw = canvas.clientWidth;
              target.ch = canvas.clientHeight;
              wakeSharedWater();
            }
          })
        : null;
    io?.observe(canvas);

    wakeSharedWater();

    return () => {
      ro.disconnect();
      io?.disconnect();
      engine.targets.delete(target);
      targetRef.current = null;
      if (engine.targets.size === 0 && engine.rafId) {
        cancelAnimationFrame(engine.rafId);
        engine.rafId = 0;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`pointer-events-none block h-full w-full ${className}`}
    />
  );
}

export default function WaterRippleImage({
  blueish = 0.6,
  scale = 7,
  illumination = 0.15,
  surfaceDistortion = 0.07,
  waterDistortion = 0.03,
  src = "https://cdn.21st.dev/assets/mirror/e7/e702fd6cb0650a2b72ccae34504b088191f3e2c2919e96041979779573843b67.jpg",
  className = "",
}: WaterRippleImageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const glRef = useRef<WebGLRenderingContext | null>(null);
  const programRef = useRef<WebGLProgram | null>(null);
  const uniformsRef = useRef<Record<string, WebGLUniformLocation | null>>({});
  const texRef = useRef<WebGLTexture | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const animRef = useRef<number | null>(null);

  const [params] = useState<Params>({
    blueish,
    scale,
    illumination,
    surfaceDistortion,
    waterDistortion,
    src,
  });

  const dpr = typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 2) : 1;

  const updateUniforms = (gl: WebGLRenderingContext) => {
    const u = uniformsRef.current;
    gl.uniform1f(u["u_blueish"], params.blueish);
    gl.uniform1f(u["u_scale"], params.scale);
    gl.uniform1f(u["u_illumination"], params.illumination);
    gl.uniform1f(u["u_surface_distortion"], params.surfaceDistortion);
    gl.uniform1f(u["u_water_distortion"], params.waterDistortion);
  };

  const setTextureFromImage = (gl: WebGLRenderingContext, image: HTMLImageElement) => {
    if (texRef.current) gl.deleteTexture(texRef.current);
    const texture = gl.createTexture()!;
    texRef.current = texture;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);

    const u = uniformsRef.current;
    gl.uniform1i(u["u_image_texture"], 0);

    const imgRatio = image.naturalWidth / image.naturalHeight;
    const canvas = canvasRef.current!;
    gl.uniform1f(u["u_ratio"], canvas.width / canvas.height);
    gl.uniform1f(u["u_img_ratio"], imgRatio);
  };

  const loadImage = (srcUrl: string, gl: WebGLRenderingContext) =>
    new Promise<void>((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        imgRef.current = img;
        setTextureFromImage(gl, img);
        resolve();
      };
      img.onerror = reject;
      img.src = srcUrl;
    });

  const resize = () => {
    const gl = glRef.current;
    const canvas = canvasRef.current;
    if (!gl || !canvas) return;

    const w = Math.floor(window.innerWidth * dpr);
    const h = Math.floor(window.innerHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);

    const u = uniformsRef.current;
    gl.uniform1f(u["u_ratio"], canvas.width / canvas.height);

    if (imgRef.current) {
      const imgRatio = imgRef.current.naturalWidth / imgRef.current.naturalHeight;
      gl.uniform1f(u["u_img_ratio"], imgRatio);
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current!;
    const gl =
      canvas.getContext("webgl", { alpha: true, antialias: true }) ||
      (canvas.getContext("experimental-webgl") as WebGLRenderingContext | null);

    if (!gl) return;
    glRef.current = gl;

    const program = createProgram(gl, VERT, FRAG);
    programRef.current = program;
    gl.useProgram(program);

    const uniformCount = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < uniformCount; i++) {
      const info = gl.getActiveUniform(program, i);
      if (!info) continue;
      uniformsRef.current[info.name] = gl.getUniformLocation(program, info.name);
    }

    const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    const posLoc = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    updateUniforms(gl);
    loadImage(params.src, gl).catch(() => undefined);

    resize();
    const onResize = () => resize();
    window.addEventListener("resize", onResize);

    const render = () => {
      const u = uniformsRef.current;
      if (u["u_time"]) {
        gl.uniform1f(u["u_time"], performance.now());
      }
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      animRef.current = requestAnimationFrame(render);
    };
    animRef.current = requestAnimationFrame(render);

    return () => {
      window.removeEventListener("resize", onResize);
      if (animRef.current) cancelAnimationFrame(animRef.current);
      if (texRef.current) gl.deleteTexture(texRef.current);
      gl.useProgram(null);
      if (programRef.current) gl.deleteProgram(programRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const gl = glRef.current;
    if (!gl) return;
    updateUniforms(gl);
  }, [params.blueish, params.scale, params.illumination, params.surfaceDistortion, params.waterDistortion]);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;

    const onChange = () => {
      const [file] = input.files ?? [];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        const gl = glRef.current;
        if (!gl) return;
        loadImage(dataUrl, gl).catch(() => undefined);
      };
      reader.readAsDataURL(file);
    };

    input.addEventListener("change", onChange);
    return () => input.removeEventListener("change", onChange);
  }, []);

  return (
    <div className={`relative w-screen h-screen ${className}`}>
      <input ref={inputRef} id="image-selector-input" type="file" className="hidden" />
      <canvas ref={canvasRef} className="fixed inset-0 w-screen" style={{ top: 0, left: 0 }} />
    </div>
  );
}

export { WaterRippleImage };
