/**
 * Smoke login: Google-only, with the brand mark floating in the smoke.
 * Based on Aakash Mehra's "Smoke Login". Needs: framer-motion, lucide-react, "@/lib/utils" (cn).
 * The default brand mark lives in /public/brand/ (or pass logoSrc).
 */
"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { LoaderCircle, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export type SmokeLoginProps = {
  /** Call supabase.auth.signInWithOAuth({ provider: "google" }) here. */
  onGoogleSignIn?: () => void | Promise<void>;
  logoSrc?: string;
  className?: string;
};

const TEXT = {
  fa: {
    title: "خوش اومدی",
    subtitle: "با حساب گوگلت وارد شو تا ادامه بدیم.",
    note: "ثبت‌نام فقط با گوگل ممکنه. اینجوری هر حساب مال یه آدم واقعیه و کسی با ایمیل‌های الکی چندتا حساب نمی‌سازه.",
    button: "ادامه با Google",
  },
  en: {
    title: "Welcome",
    subtitle: "Sign in with your Google account to get going.",
    note: "Sign-up is Google-only, so every account belongs to a real person and nobody can spin up a pile of throwaway emails.",
    button: "Continue with Google",
  },
};

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Theme-aware glow for the brand mark: hue-rotate only bites in the ember
// accent (the purple artwork turns orange); colours come from index.css.
const LOGO_FILTER =
  "drop-shadow(0 0 26px color-mix(in oklab, var(--accent-glow) 75%, transparent)) drop-shadow(0 0 70px color-mix(in oklab, var(--accent-glow) 45%, transparent))";

const VARS = {
  "--bg": "#0a0911",
  "--paper": "#0f0e19",
  "--sheet": "#181629",
  "--ink": "#ecebf6",
  "--muted": "#9390ad",
  "--line": "#272443",
  // Accent colours come from the app-wide ember/violet theme (index.css).
  "--accent": "var(--accent-from)",
  "--accent-deep": "var(--accent-to)",
} as CSSProperties;

const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 .5 0 0 0 0 .5 0 0 0 0 .5 0 0 0 .6 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

export function SmokeLogin({ onGoogleSignIn = () => wait(1400), logoSrc = "/brand/openharness-mark.png", className }: SmokeLoginProps) {
  const [busy, setBusy] = useState(false);
  const reduce = useReducedMotion();
  const fa = typeof document !== "undefined" && document.documentElement.lang.startsWith("fa");
  const t = fa ? TEXT.fa : TEXT.en;

  const google = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onGoogleSignIn();
    } finally {
      setBusy(false);
    }
  };

  const rise = (i: number) => ({
    initial: reduce ? { opacity: 0 } : { opacity: 0, y: 10, filter: "blur(10px)" },
    animate: { opacity: 1, y: 0, filter: "blur(0px)" },
    transition: { duration: 0.9, delay: 0.15 + i * 0.08, ease: [0.22, 1, 0.36, 1] as const },
  });

  return (
    <div
      dir="ltr"
      style={VARS}
      className={cn(
        "relative grid min-h-dvh w-full grid-cols-[minmax(0,1fr)] gap-3 overflow-x-clip bg-[var(--bg)] p-3 text-[var(--ink)] lg:grid-cols-[1.08fr_1fr]",
        className,
      )}
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 z-0 opacity-40" style={{ backgroundImage: GRAIN, mixBlendMode: "soft-light" }} />

      {/* Left: smoke on a small stack of paper, brand mark dead centre */}
      <section className="relative z-[1] min-h-[42vh] lg:min-h-0">
        <div aria-hidden className="absolute inset-0 rotate-[-1.4deg] rounded-[28px] bg-[var(--sheet)]" />
        <div aria-hidden className="absolute inset-0 rotate-[0.9deg] rounded-[28px] bg-[var(--paper)] shadow-[0_8px_24px_-12px_rgb(0_0_0/0.5)]" />
        <div className="relative h-full overflow-hidden rounded-[28px] bg-[var(--paper)] shadow-[0_24px_48px_-24px_rgb(0_0_0/0.6)]">
          <SmokeCanvas />
          <div aria-hidden className="pointer-events-none absolute inset-0 opacity-60" style={{ backgroundImage: GRAIN, mixBlendMode: "soft-light" }} />

          <div className="pointer-events-none absolute inset-0 grid grid-rows-1 place-items-center">
            {/* Breathing violet halo that lets the mark melt into the smoke. */}
            <motion.div
              aria-hidden
              className="absolute size-[min(78%,460px)] rounded-full"
              style={{ background: "radial-gradient(circle, color-mix(in oklab, var(--accent-glow) 55%, transparent) 0%, color-mix(in oklab, var(--accent-glow) 22%, transparent) 38%, transparent 68%)", filter: "blur(18px)" }}
              animate={reduce ? undefined : { scale: [0.92, 1.08, 0.92], opacity: [0.7, 1, 0.7] }}
              transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.img
              src={logoSrc}
              alt=""
              draggable={false}
              className="relative h-auto max-h-[78%] w-auto max-w-[min(58%,340px)] select-none"
              style={{ filter: LOGO_FILTER }}
              initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.9, filter: "blur(14px)" }}
              animate={reduce ? { opacity: 1, filter: LOGO_FILTER } : { opacity: 1, scale: 1, y: [0, -7, 0], filter: LOGO_FILTER }}
              transition={{
                opacity: { duration: 1.2 },
                scale: { duration: 1.2, ease: [0.22, 1, 0.36, 1] },
                y: { duration: 7, repeat: Infinity, ease: "easeInOut" },
                filter: { duration: 1.2 },
              }}
            />
          </div>
        </div>
      </section>

      {/* Right: Google only */}
      <section className="relative z-[1] flex items-center justify-center px-5 py-16 sm:px-10">
        <div dir="ltr" className="w-full max-w-[380px] text-start">
          <motion.h1 {...rise(0)} className={cn("text-[34px] font-semibold leading-tight", !fa && "tracking-[-0.04em]")}>
            {t.title}
          </motion.h1>
          <motion.p {...rise(1)} className="mt-3 text-[15px] leading-7 text-[var(--muted)]">
            {t.subtitle}
          </motion.p>

          <motion.div {...rise(2)} className="mt-8">
            <Button
              type="button"
              onClick={google}
              disabled={busy}
              size="lg"
              className="h-12 w-full gap-3 rounded-[14px] px-4 text-[15px] focus-visible:outline-[var(--accent-ring)]"
            >
              {busy ? (
                <LoaderCircle className="size-[18px] animate-spin" />
              ) : (
                <>
                  <span className="grid size-6 place-items-center rounded-full bg-white">
                    <GoogleIcon className="size-[14px]" />
                  </span>
                  {t.button}
                </>
              )}
            </Button>
          </motion.div>
        </div>
      </section>
    </div>
  );
}

/* ---- Smoke shader (dark, violet) ---- */

const RENDER_SCALE = 0.4;
const VERT = `attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}`;
const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec2 uMouse;
uniform vec3 uVein; // accent glow, follows the ember/violet theme
float hash(vec2 p){ p = fract(p * vec2(234.34, 435.345)); p += dot(p, p + 34.23); return fract(p.x * p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0., a = .5;
  mat2 r = mat2(.8, .6, -.6, .8);
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = r * p * 2.02 + vec2(1.7, 9.2); a *= .5; }
  return v;
}
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float ar = uRes.x / uRes.y;
  vec2 p = vec2(uv.x * ar, uv.y) * 1.25;
  float t = uTime * .07;
  vec2 d = p - vec2(uMouse.x * ar, uMouse.y) * 1.25;
  float k = exp(-dot(d, d) * 1.6);
  p += vec2(-d.y, d.x) * k * .55;
  vec2 q = vec2(fbm(p + vec2(0., t)), fbm(p + vec2(5.2, 1.3) - t * .8));
  vec2 r = vec2(fbm(p + 3. * q + vec2(1.7, 9.2) + t * 1.2), fbm(p + 3. * q + vec2(8.3, 2.8) - t));
  float f = fbm(p + 2.6 * r + vec2(t * .4, -t * .3));
  float smoke = smoothstep(.3, .85, f);
  smoke *= smoke;
  float wisp = smoothstep(.55, .75, f) * (1. - smoothstep(.75, .95, f));
  float vein = (1. - smoothstep(.0, .04, abs(f - .58))) * smoothstep(.42, .62, r.y);
  vec3 purple = uVein;
  vec3 col = mix(vec3(.035, .03, .06), vec3(.025, .022, .045), uv.y);
  col += vec3(.70, .66, .88) * smoke * .58 + vec3(.85, .8, 1.) * wisp * .08;
  col += purple * vein * .85;
  col += (hash(gl_FragCoord.xy + fract(t)) - .5) / 255.;
  gl_FragColor = vec4(col, 1.);
}`;

function SmokeCanvas() {
  const ref = useRef(null as HTMLCanvasElement | null);

  useEffect(() => {
    const canvas = ref.current;
    const gl = canvas?.getContext("webgl", { antialias: false, alpha: false, depth: false });
    if (!canvas || !gl) return; // the paper colour behind stands in

    const shader = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, shader(gl.VERTEX_SHADER, VERT));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const uRes = gl.getUniformLocation(program, "uRes");
    const uTime = gl.getUniformLocation(program, "uTime");
    const uMouse = gl.getUniformLocation(program, "uMouse");
    const uVein = gl.getUniformLocation(program, "uVein");

    // The smoke vein takes the current ember/violet accent. Only the uniform
    // changes on a theme switch; the shader is never rebuilt.
    const VEIN: Record<string, [number, number, number]> = {
      violet: [0.6, 0.4, 1.0],
      ember: [1.0, 0.45, 0.2],
    };
    const applyVein = () => {
      let accent = "violet";
      try {
        accent = document.documentElement.dataset.accent === "ember" ? "ember" : "violet";
      } catch {
        /* default violet */
      }
      gl.uniform3fv(uVein, VEIN[accent] ?? VEIN.violet!);
    };
    applyVein();
    const accentObserver = new MutationObserver(applyVein);
    accentObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-accent"] });

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const start = performance.now();
    const mouse = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5 };
    let time = 40;
    let raf = 0;
    let last = 0;

    const draw = () => {
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, time);
      gl.uniform2f(uMouse, mouse.x, mouse.y);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < 1000 / 30 - 2) return;
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      time = 40 + (now - start) / 1000;
      mouse.x += (mouse.tx - mouse.x) * Math.min(1, dt * 2.2);
      mouse.y += (mouse.ty - mouse.y) * Math.min(1, dt * 2.2);
      draw();
    };
    const play = () => {
      cancelAnimationFrame(raf);
      if (reduce.matches) draw();
      else raf = requestAnimationFrame(loop);
    };
    // The logo layer ignores the pointer, so listen on the window and map into the canvas.
    const onMove = (e: PointerEvent) => {
      const b = canvas.getBoundingClientRect();
      mouse.tx = Math.min(1, Math.max(0, (e.clientX - b.left) / b.width));
      mouse.ty = 1 - Math.min(1, Math.max(0, (e.clientY - b.top) / b.height));
    };
    const ro = new ResizeObserver(() => {
      const s = Math.min(window.devicePixelRatio || 1, 2) * RENDER_SCALE;
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * s));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * s));
      gl.viewport(0, 0, canvas.width, canvas.height);
      draw();
    });
    ro.observe(canvas);
    window.addEventListener("pointermove", onMove);
    reduce.addEventListener("change", play);
    play();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      accentObserver.disconnect();
      window.removeEventListener("pointermove", onMove);
      reduce.removeEventListener("change", play);
    };
  }, []);

  return <canvas ref={ref} aria-hidden className="absolute inset-0 size-full" />;
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}
