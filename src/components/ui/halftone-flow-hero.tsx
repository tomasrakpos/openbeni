// Reusable UI primitive halftone-flow-hero; adjust its default appearance and behavior here.
"use client"

import * as React from "react"

// A SaaS hero card whose background is liquid marbling printed through a
// halftone screen: one fragment shader warps the flow, then draws it as dots
// that swell where the colour runs thick and bloom under the pointer. Over it,
// a serif headline blurs in word by word above a prompt bar that types itself.

export type HalftonePalette = {
  /** Card ground, flow colour, hot highlight, text. */
  ground: string
  flow: string
  hot: string
  text: string
}

export const HALFTONE_PALETTES = {
  ember: { ground: "#110d0b", flow: "#d9521d", hot: "#ffb27c", text: "#fbf3ea" },
  cobalt: { ground: "#070a16", flow: "#3360f2", hot: "#a8c0ff", text: "#eef2ff" },
  jade: { ground: "#06110d", flow: "#1f9a6b", hot: "#a6f0c8", text: "#ecfbf3" },
} satisfies Record<string, HalftonePalette>

export type HalftonePaletteName = keyof typeof HALFTONE_PALETTES

export type HalftoneFlowHeroProps = {
  badge?: string
  /** Headline. Wrap a word in *asterisks* for italic, 
 for a line break. */
  title?: string
  description?: React.ReactNode
  /** Placeholders the prompt bar types out in turn. */
  prompts?: string[]
  ctaLabel?: string
  /** Called with the typed value (or the current placeholder) on submit. */
  onSubmit?: (value: string) => void
  /** Small social-proof line under the bar. */
  proof?: string
  /** Initials for the avatar stack beside the proof line. */
  avatars?: string[]
  palette?: HalftonePaletteName | HalftonePalette
  /** Halftone cell size in CSS pixels. */
  dotSize?: number
  /** Stage height. Keep it a definite length; percentages collapse once installed. */
  height?: string
  className?: string
  /** Render only the animated background, without the hero card content. */
  backgroundOnly?: boolean
}

// #region helpers
export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "").trim()
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  const n = parseInt(h.slice(0, 6), 16)
  if (Number.isNaN(n) || h.length < 6) return [0, 0, 0]
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

export function backing(css: number, dpr: number): number {
  return Math.max(1, Math.round(css * Math.min(2, Math.max(1, dpr || 1))))
}

export function runs(line: string): { text: string; em: boolean }[] {
  return line.split("*").map((text, i) => ({ text, em: i % 2 === 1 })).filter((r) => r.text)
}

/**
 * The typewriter as a pure step: given the full text, how many characters are
 * showing and whether it is deleting, return the next count and direction, and
 * how long to wait before the step after.
 */
export function typeStep(text: string, shown: number, deleting: boolean): { shown: number; deleting: boolean; wait: number; next: boolean } {
  if (!deleting) {
    if (shown < text.length) return { shown: shown + 1, deleting: false, wait: 38, next: false }
    return { shown, deleting: true, wait: 1700, next: false }
  }
  if (shown > 0) return { shown: shown - 1, deleting: true, wait: 18, next: false }
  return { shown: 0, deleting: false, wait: 280, next: true }
}
// #endregion

const VERT = "attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}"

const FRAG =
  "precision highp float;" +
  "uniform vec2 uRes;uniform float uTime;uniform vec2 uMouse;uniform float uHover;uniform float uIntro;uniform float uCell;" +
  "uniform vec3 uGround;uniform vec3 uFlow;uniform vec3 uHot;" +
  "float flow(vec2 p,float t){vec2 w=p*2.;for(int i=1;i<6;i++){float fi=float(i);" +
  "w+=vec2(.85/fi*sin(fi*w.y*1.2+t*.42+fi*2.3),.7/fi*cos(fi*w.x*1.05-t*.31+fi*1.1));}" +
  // thin bright streaks where the bands crest
  "float b=.5+.5*sin(w.x*2.6-w.y*1.7);return smoothstep(.15,1.,pow(b,2.2));}" +
  "void main(){" +
  "float a=.5236;mat2 R=mat2(cos(a),-sin(a),sin(a),cos(a));" +
  "vec2 px=R*gl_FragCoord.xy;vec2 cell=floor(px/uCell);vec2 cc=(cell+.5)*uCell;" +
  "vec2 cs=(cc*R-.5*uRes)/uRes.y;" + // v*R is the transpose: back to screen space +
  "vec2 p=(gl_FragCoord.xy-.5*uRes)/uRes.y;" +
  "float I=flow(cs,uTime);" +
  "float md=length(cs-uMouse);I=clamp(I+uHover*.55*exp(-md*md*14.),0.,1.);" +
  "I*=uIntro;" +
  "float r=sqrt(I)*.54*uCell;float d=length(px-cc);" +
  "float dotm=1.-smoothstep(r-1.,r+.6,d);" +
  // a soft unscreened glow under the dots, so the flow reads at a distance
  "float g=flow(p,uTime)*uIntro;" +
  "vec3 col=uGround+uFlow*g*.16;" +
  "vec3 ink=mix(uFlow,uHot,smoothstep(.7,1.,I)*.85);" +
  "col=mix(col,ink,dotm);" +
  "vec2 uv=gl_FragCoord.xy/uRes;col*=mix(.6,1.,smoothstep(1.1,.3,length((uv-.5)*vec2(1.,1.25))));" +
  "gl_FragColor=vec4(col,1.);}"

const CSS =
  ".hfh-root{position:relative;width:100%;padding:12px;background:var(--color-background,#fff);font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif}" +
  ".hfh-root *{box-sizing:border-box}" +
  ".hfh-card{position:relative;width:100%;height:100%;overflow:hidden;isolation:isolate;border-radius:28px;background:var(--hfh-ground);color:var(--hfh-text);" +
  "box-shadow:0 40px 80px -40px rgba(0,0,0,.45),inset 0 0 0 1px rgba(255,255,255,.06);transform:scale(.965);opacity:0;transition:transform 1.4s cubic-bezier(.16,1,.3,1),opacity .8s ease}" +
  ".hfh-in .hfh-card{transform:none;opacity:1}" +
  ".hfh-root.hfh-background-only{padding:0;background:transparent}" +
  ".hfh-background-only .hfh-card{border-radius:0;box-shadow:none;transform:none;opacity:1}" +
  ".hfh-host{position:absolute;inset:0}" +
  ".hfh-canvas{position:absolute;inset:0;width:100%;height:100%;display:block}" +
  ".hfh-fallback{position:absolute;inset:0;background:radial-gradient(70% 60% at 30% 30%,color-mix(in oklab,var(--hfh-flow) 55%,transparent),transparent 70%),radial-gradient(60% 50% at 75% 75%,color-mix(in oklab,var(--hfh-flow) 40%,transparent),transparent 70%)}" +
  ".hfh-scrim{position:absolute;inset:0;pointer-events:none;background:radial-gradient(55% 48% at 50% 50%,color-mix(in oklab,var(--hfh-ground) 82%,transparent),transparent 100%)}" +
  ".hfh-inner{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:32px 20px;pointer-events:none}" +
  ".hfh-background-only .hfh-inner,.hfh-background-only .hfh-scrim{display:none}" +
  ".hfh-badge{display:inline-flex;align-items:center;gap:8px;height:30px;padding:0 12px;border-radius:999px;font-size:12.5px;font-weight:500;letter-spacing:.01em;" +
  "background:color-mix(in oklab,var(--hfh-text) 9%,transparent);box-shadow:inset 0 0 0 1px color-mix(in oklab,var(--hfh-text) 18%,transparent);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}" +
  ".hfh-badge i{width:6px;height:6px;border-radius:50%;background:var(--hfh-hot);box-shadow:0 0 10px var(--hfh-hot)}" +
  ".hfh-h{margin:22px 0 0;font-family:'HFH Serif',ui-serif,Georgia,serif;font-weight:400;font-size:clamp(46px,7.2vw,112px);line-height:.95;letter-spacing:-.025em}" +
  ".hfh-h em{font-style:italic;color:var(--hfh-hot)}" +
  ".hfh-line{display:block}" +
  ".hfh-w{display:inline-block;opacity:0;filter:blur(12px);transform:translateY(.25em);transition:opacity .9s ease,filter 1s ease,transform 1.1s cubic-bezier(.16,1,.3,1)}" +
  ".hfh-in .hfh-w{opacity:1;filter:none;transform:none}" +
  ".hfh-desc{margin:22px 0 0;max-width:44ch;font-size:clamp(15px,1.2vw,17px);line-height:1.6;opacity:.74;text-wrap:balance}" +
  ".hfh-fade{opacity:0;transform:translateY(12px);transition:opacity .9s ease,transform 1.1s cubic-bezier(.16,1,.3,1)}" +
  ".hfh-in .hfh-fade{opacity:1;transform:none}" +
  ".hfh-form{position:relative;display:flex;align-items:center;gap:8px;width:min(560px,100%);height:60px;margin-top:32px;padding:6px 6px 6px 22px;border-radius:999px;pointer-events:auto;" +
  "background:color-mix(in oklab,var(--hfh-ground) 55%,transparent);box-shadow:inset 0 0 0 1px color-mix(in oklab,var(--hfh-text) 16%,transparent),0 20px 50px -20px rgba(0,0,0,.6);backdrop-filter:blur(18px) saturate(1.2);-webkit-backdrop-filter:blur(18px) saturate(1.2);transition:box-shadow .35s}" +
  ".hfh-form:focus-within{box-shadow:inset 0 0 0 1px color-mix(in oklab,var(--hfh-hot) 70%,transparent),0 0 0 6px color-mix(in oklab,var(--hfh-hot) 14%,transparent),0 20px 50px -20px rgba(0,0,0,.6)}" +
  ".hfh-spark{flex:none;color:var(--hfh-hot)}" +
  ".hfh-field{position:relative;flex:1;min-width:0;height:100%}" +
  ".hfh-input{position:absolute;inset:0;width:100%;border:0;outline:0;background:transparent;color:inherit;font:inherit;font-size:16px}" +
  ".hfh-ph{position:absolute;inset:0;display:flex;align-items:center;font-size:16px;opacity:.55;pointer-events:none;white-space:nowrap;overflow:hidden}" +
  ".hfh-caret{display:inline-block;width:2px;height:1.1em;margin-left:2px;background:var(--hfh-hot);animation:hfh-blink 1s steps(1) infinite}" +
  ".hfh-go{flex:none;display:inline-flex;align-items:center;gap:8px;height:100%;padding:0 20px;border:0;border-radius:999px;cursor:pointer;font:inherit;font-size:15px;font-weight:600;" +
  "color:var(--hfh-ground);background:var(--hfh-text);transition:transform .4s cubic-bezier(.3,1.5,.5,1),background-color .25s}" +
  ".hfh-go:hover{transform:translateX(-2px)}" +
  ".hfh-go:active{transform:scale(.95)}" +
  ".hfh-go:focus-visible{outline:2px solid var(--hfh-hot);outline-offset:3px}" +
  ".hfh-go svg{transition:transform .4s cubic-bezier(.3,1.5,.5,1)}" +
  ".hfh-go:hover svg{transform:translateX(3px)}" +
  ".hfh-proof{display:flex;align-items:center;gap:12px;margin-top:22px;font-size:13px;opacity:.72}" +
  ".hfh-avs{display:flex}" +
  ".hfh-av{display:grid;place-items:center;width:28px;height:28px;margin-left:-6px;letter-spacing:-.02em;border-radius:50%;font-size:10px;font-weight:700;color:var(--hfh-ground);background:var(--hfh-hot);box-shadow:0 0 0 2px var(--hfh-ground)}" +
  ".hfh-av:first-child{margin-left:0}" +
  ".hfh-av:nth-child(2){background:var(--hfh-text)}.hfh-av:nth-child(3){background:var(--hfh-flow);color:var(--hfh-text)}" +
  "@keyframes hfh-blink{50%{opacity:0}}" +
  "@media (max-width:560px){.hfh-go span{display:none}.hfh-go{padding:0 16px}.hfh-root{padding:8px}.hfh-card{border-radius:22px}}" +
  "@media (prefers-reduced-motion:reduce){.hfh-caret{animation:none}.hfh-card,.hfh-w,.hfh-fade,.hfh-go,.hfh-go svg{transition:none}}"

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const s = gl.createShader(type)
  if (!s) return null
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.warn("halftone-flow-hero:", gl.getShaderInfoLog(s))
    gl.deleteShader(s)
    return null
  }
  return s
}

const DEFAULT_PROMPTS = [
  "Rewrite this launch email so it sounds like us…",
  "Turn my meeting notes into a crisp update…",
  "Draft a reply that says no, kindly…",
]

export default function HalftoneFlowHero({
  badge = "Writing that sounds like you",
  title = "Your words,\n*only sooner.*",
  description = "Quill learns your voice from what you've already written, then drafts emails, docs and replies you'd actually send.",
  prompts = DEFAULT_PROMPTS,
  ctaLabel = "Start writing",
  onSubmit,
  proof = "Trusted by 2,400 teams who hate a blank page",
  avatars = ["MK", "JL", "AS"],
  palette = "ember",
  dotSize = 7,
  height = "100svh",
  className,
  backgroundOnly = false,
}: HalftoneFlowHeroProps) {
  const root = React.useRef(null as HTMLElement | null)
  const host = React.useRef(null as HTMLDivElement | null)
  const [ready, setReady] = React.useState(false)
  const [failed, setFailed] = React.useState(false)
  const [fontCss, setFontCss] = React.useState("")
  const [value, setValue] = React.useState("")
  const [typed, setTyped] = React.useState({ i: 0, shown: 0 })
  const pal = typeof palette === "string" ? HALFTONE_PALETTES[palette] || HALFTONE_PALETTES.ember : palette
  const live = React.useRef({ pal, dotSize })
  live.current = { pal, dotSize }

  React.useEffect(() => {
    if (backgroundOnly) return
    let active = true
    void import("./halftone-flow-font").then(({ HFH_FONT_CSS }) => {
      if (active) setFontCss(HFH_FONT_CSS)
    })
    return () => {
      active = false
    }
  }, [backgroundOnly])

  // The placeholder types itself out, holds, deletes, and moves to the next prompt.
  React.useEffect(() => {
    if (backgroundOnly || !prompts.length) return
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)")
    if (reduce.matches) {
      setTyped({ i: 0, shown: prompts[0].length })
      return
    }
    let i = 0
    let shown = 0
    let deleting = false
    let id = 0
    const tick = () => {
      const s = typeStep(prompts[i], shown, deleting)
      shown = s.shown
      deleting = s.deleting
      if (s.next) i = (i + 1) % prompts.length
      setTyped({ i, shown })
      id = window.setTimeout(tick, s.wait)
    }
    id = window.setTimeout(tick, 900)
    return () => window.clearTimeout(id)
  }, [prompts, backgroundOnly])

  React.useEffect(() => {
    const el = root.current
    const holder = host.current
    if (!el || !holder) return
    // A fresh canvas per mount: a context lost on unmount can't be reused (StrictMode remounts).
    const cv = document.createElement("canvas")
    cv.className = "hfh-canvas"
    holder.appendChild(cv)
    const gl = cv.getContext("webgl", { antialias: false, alpha: false })
    const vs = gl && compile(gl, gl.VERTEX_SHADER, VERT)
    const fs = gl && compile(gl, gl.FRAGMENT_SHADER, FRAG)
    const prog = gl && gl.createProgram()
    if (!gl || !vs || !fs || !prog) {
      cv.remove()
      setFailed(true)
      setReady(true)
      return
    }
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    gl.useProgram(prog)
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(prog, "p")
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    const u = (n: string) => gl.getUniformLocation(prog, n)
    const U = { res: u("uRes"), time: u("uTime"), mouse: u("uMouse"), hover: u("uHover"), intro: u("uIntro"), cell: u("uCell"), ground: u("uGround"), flow: u("uFlow"), hot: u("uHot") }

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)")
    // Measured on init and resize only; the frame loop reads these numbers.
    const size = { w: 1, h: 1, left: 0, top: 0, dpr: 1 }
    const pointer = { x: 0, y: 0, tx: 0, ty: 0, hover: 0, thover: 0 }
    let raf = 0
    let running = false
    let onScreen = true
    let t = 0
    let last = performance.now()
    const start = performance.now()

    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const L = live.current
      if (!reduce.matches) t += dt
      const intro = reduce.matches ? 1 : Math.min(1, Math.max(0, (now - start - 250) / 1800))
      pointer.x += (pointer.tx - pointer.x) * 0.08
      pointer.y += (pointer.ty - pointer.y) * 0.08
      pointer.hover += (pointer.thover - pointer.hover) * 0.06
      const g = hexToRgb(L.pal.ground)
      const f = hexToRgb(L.pal.flow)
      const h = hexToRgb(L.pal.hot)
      gl.uniform2f(U.res, cv.width, cv.height)
      gl.uniform1f(U.time, t + 4)
      gl.uniform2f(U.mouse, pointer.x, pointer.y)
      gl.uniform1f(U.hover, reduce.matches ? 0 : pointer.hover)
      gl.uniform1f(U.intro, 1 - Math.pow(1 - intro, 3))
      gl.uniform1f(U.cell, Math.max(3, L.dotSize) * size.dpr)
      gl.uniform3f(U.ground, g[0], g[1], g[2])
      gl.uniform3f(U.flow, f[0], f[1], f[2])
      gl.uniform3f(U.hot, h[0], h[1], h[2])
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }
    const measure = () => {
      const r = cv.getBoundingClientRect()
      size.w = r.width
      size.h = r.height
      size.left = r.left
      size.top = r.top
      size.dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1))
      cv.width = backing(r.width, size.dpr)
      cv.height = backing(r.height, size.dpr)
      gl.viewport(0, 0, cv.width, cv.height)
      if (!running) draw(performance.now())
    }
    const loop = (now: number) => {
      draw(now)
      // Once the intro is in, a reduced-motion user gets one still frame.
      raf = running ? requestAnimationFrame(loop) : 0
    }
    const sync = () => {
      const want = onScreen && !document.hidden && !reduce.matches
      if (want && !running) {
        running = true
        last = performance.now()
        raf = requestAnimationFrame(loop)
      } else if (!want && running) {
        running = false
        cancelAnimationFrame(raf)
        draw(performance.now())
      }
    }
    // The pointer is tracked on the whole card (the text layer sits over the canvas).
    const card = holder.parentElement || holder
    const onEnter = () => {
      const r = cv.getBoundingClientRect()
      size.left = r.left
      size.top = r.top
      pointer.thover = 1
    }
    const onMove = (e: PointerEvent) => {
      if (size.h <= 0) return
      pointer.tx = (e.clientX - size.left - size.w / 2) / size.h
      pointer.ty = (size.h / 2 - (e.clientY - size.top)) / size.h
    }
    const onLeave = () => (pointer.thover = 0)

    const ro = new ResizeObserver(measure)
    ro.observe(cv)
    const io = new IntersectionObserver(([e]) => {
      onScreen = e.isIntersecting
      sync()
    })
    io.observe(el)
    document.addEventListener("visibilitychange", sync)
    reduce.addEventListener("change", sync)
    card.addEventListener("pointerenter", onEnter)
    card.addEventListener("pointermove", onMove)
    card.addEventListener("pointerleave", onLeave)
    measure()
    sync()
    setReady(true)

    return () => {
      running = false
      cancelAnimationFrame(raf)
      ro.disconnect()
      io.disconnect()
      document.removeEventListener("visibilitychange", sync)
      reduce.removeEventListener("change", sync)
      card.removeEventListener("pointerenter", onEnter)
      card.removeEventListener("pointermove", onMove)
      card.removeEventListener("pointerleave", onLeave)
      gl.deleteBuffer(buf)
      gl.deleteProgram(prog)
      gl.deleteShader(vs)
      gl.deleteShader(fs)
      gl.getExtension("WEBGL_lose_context")?.loseContext()
      cv.remove()
    }
  }, [])

  const lines = title.split("\n")
  let word = 0
  const current = prompts.length ? prompts[typed.i % prompts.length] : ""
  return (
    <section
      ref={root}
      className={
        "hfh-root" +
        (ready ? " hfh-in" : "") +
        (backgroundOnly ? " hfh-background-only" : "") +
        (className ? " " + className : "")
      }
      aria-hidden={backgroundOnly || undefined}
      style={
        {
          height,
          "--hfh-ground": pal.ground,
          "--hfh-flow": pal.flow,
          "--hfh-hot": pal.hot,
          "--hfh-text": pal.text,
        } as React.CSSProperties
      }
    >
      <style>{fontCss ? fontCss + CSS : CSS}</style>
      <div className="hfh-card">
        {failed ? <div className="hfh-fallback" aria-hidden="true" /> : null}
        <div ref={host} className="hfh-host" aria-hidden="true" />
        {!backgroundOnly ? (
          <>
            <div className="hfh-scrim" aria-hidden="true" />
            <div className="hfh-inner">
              {badge ? (
                <span className="hfh-badge hfh-fade" style={{ transitionDelay: ".2s" }}>
                  <i aria-hidden="true" />
                  {badge}
                </span>
              ) : null}
              <h1 className="hfh-h">
                {lines.map((line, i) => (
                  <span className="hfh-line" key={i}>
                    {runs(line).map((r, j) => {
                      const parts = r.text.split(/(\s+)/)
                      const out = parts.map((part, k) => {
                        if (/^\s+$/.test(part) || !part) return part
                        const d = 0.3 + word++ * 0.09
                        return (
                          <span className="hfh-w" key={k} style={{ transitionDelay: d + "s" }}>
                            {part}
                          </span>
                        )
                      })
                      return r.em ? <em key={j}>{out}</em> : <React.Fragment key={j}>{out}</React.Fragment>
                    })}
                  </span>
                ))}
              </h1>
              {description ? (
                <p className="hfh-desc hfh-fade" style={{ transitionDelay: ".75s" }}>
                  {description}
                </p>
              ) : null}
              <form
                className="hfh-form hfh-fade"
                style={{ transitionDelay: ".9s" }}
                onSubmit={(e) => {
                  e.preventDefault()
                  onSubmit?.(value.trim() || current)
                }}
              >
                <svg className="hfh-spark" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z" fill="currentColor" />
                  <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" fill="currentColor" opacity=".7" />
                </svg>
                <label className="hfh-field">
                  <input
                    className="hfh-input"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    aria-label="Tell it what to write"
                    autoComplete="off"
                  />
                  {!value ? (
                    <span className="hfh-ph" aria-hidden="true">
                      {current.slice(0, typed.shown)}
                      <span className="hfh-caret" />
                    </span>
                  ) : null}
                </label>
                <button type="submit" className="hfh-go">
                  <span>{ctaLabel}</span>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </form>
              {proof ? (
                <div className="hfh-proof hfh-fade" style={{ transitionDelay: "1.05s" }}>
                  {avatars.length ? (
                    <span className="hfh-avs" aria-hidden="true">
                      {avatars.slice(0, 3).map((a) => (
                        <span className="hfh-av" key={a}>
                          {a}
                        </span>
                      ))}
                    </span>
                  ) : null}
                  {proof}
                </div>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </section>
  )
}
