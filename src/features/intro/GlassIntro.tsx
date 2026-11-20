// intro feature: GlassIntro; change its UI/flow here and keep related state/API calls in sync.
import * as React from "react";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Site entrance: the HX mark is sculpted out of liquid glass by a WebGL shader,
 * then flattens into the plain logo before the app fades in underneath.
 *
 * Ported from the standalone "HX Glass Reveal" prototype. The animation plays
 * once per page load, can be skipped by clicking or pressing any key, and
 * honours `prefers-reduced-motion` by showing the settled logo instead.
 */

const VERT = `#version 300 es
in vec2 aPos; void main(){gl_Position=vec4(aPos,0.,1.);}`;

const FRAG = `#version 300 es
precision highp float;
out vec4 o;
uniform vec2 uRes; uniform float uTile,uScale,uN,uL,uOptics,uAlpha,uSweep,uAng,uDrop,uBare,uDome,uFrost,uCorner,uLit,uHalo;
uniform sampler2D uTex;
vec4 logo(vec2 q){return texture(uTex,vec2(.5+q.x*.5/uL,.5-q.y*.5/uL));}
vec2 rot(vec2 v,float a){float c=cos(a),s=sin(a);return vec2(c*v.x-s*v.y,s*v.x+c*v.y);}
float bump(float x,float c,float w){float d=(x-c)/w;return exp(-.5*d*d);}
vec3 spectrum(float x){return vec3(bump(x,.34,.2)+.08*bump(x,.93,.05),bump(x,.58,.1),bump(x,.8,.11));}
float hash(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
void main(){
  float px=2./uTile;
  vec2 p=(gl_FragCoord.xy-.5*uRes)*px;
  vec3 bg=vec3(.02,.02,.04);
  vec4 lb=logo(p);
  vec3 plain=bg*(1.-lb.a)+lb.rgb;
  plain=mix(bg,plain,uBare);
  vec2 pp=p/uScale; vec2 a=max(abs(pp),vec2(1e-5));
  float g=pow(pow(a.x,uN)+pow(a.y,uN),1./uN);
  vec2 dg=sign(pp)*pow(a,vec2(uN-1.))*pow(max(g,1e-5),1.-uN);
  float dl=max(length(dg),1e-5); vec2 nO=dg/dl;
  float sd=(g-1.)/dl*uScale;
  float s=-sd;
  float bw=mix(.16,.38,uDrop)*uScale;
  float x=clamp(s/bw,0.,1.);
  float e=1.-x;
  float cn=smoothstep(.1,.9,4.*nO.x*nO.x*nO.y*nO.y);
  vec2 dirOut=normalize(mix(nO,p/max(length(p),1e-4),.2));
  float off=.55*pow(e,2.2)*bw*(1.+.9*cn*uCorner)*uOptics;
  vec3 backG=bg+vec3(.015);
  vec3 acc=vec3(0.),ws=vec3(0.);
  for(int i=0;i<14;i++){
    float lam=(float(i)+.5)/14.;
    float f=1.+.6*(1.-2.*lam);
    vec2 q=p-dirOut*off*f-p*uDome*uOptics;
    vec4 l=logo(q);
    vec3 w=spectrum(lam);
    acc+=(backG*(1.-l.a)+l.rgb)*w; ws+=w;
  }
  vec3 tr=acc/ws;
  float tl=dot(tr,vec3(.2126,.7152,.0722));
  tr=clamp(tl+(tr-tl)*(1.+.7*uOptics),0.,1.);
  tr=mix(tr,vec3(.5,.52,.62),uFrost*.3);
  float fres=pow(e,1.5);
  vec2 ld=rot(normalize(vec2(-.62,.78)),uAng);
  float side=dot(nO,ld);
  vec3 rimCol=vec3(.8,.87,.97);
  vec3 rim=rimCol*fres*(.35+.65*max(side,-side*.8))*.65*(1.+.8*uDrop);
  float el=exp(-.5*pow((s-.005*uScale)/(.0045*uScale),2.));
  rim+=vec3(.55)*el*(.4+.6*smoothstep(-.85,.5,side));
  vec3 glass=tr*(1.-.25*fres)+rim*uLit;
  glass=mix(glass,rimCol,uDrop*.4*uLit*(1.-smoothstep(0.,.1*uScale,s)));
  float sw=dot(p/uScale,normalize(vec2(.8,.6)))-uSweep;
  float sheen=exp(-sw*sw/.03)*(.55+.45*e)*uLit;
  glass=mix(glass,vec3(1.),sheen*.2);
  float cov=clamp(.5-sd/px,0.,1.);
  float outside=max(sd,0.);
  vec3 bgo=bg+vec3(.35,.2,.9)*uHalo*(.12*exp(-outside/(.04*uScale))+.04*exp(-outside/(.25*uScale)))*step(0.,sd);
  vec3 col=mix(bgo,glass,cov);
  vec3 outc=mix(plain,col,uAlpha);
  outc+=(hash(gl_FragCoord.xy)-.5)/255.;
  o=vec4(outc,1.);
}`;

const PRESENT = 2.4;
const LOGO_SCALE = 0.62;
const FINAL_SCALE = 0.85;
const START_ZOOM = 2.3;
const GLIDE = 2.3;
const TILE = 340;
const HOLD_AFTER = 320;
const FADE_MS = 620;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const smoother = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * t * (t * (t * 6 - 15) + 10);
};
const spring = (t: number, r: number) => {
  if (t <= 0) return 0;
  const w = (2 * Math.PI) / r;
  return 1 - Math.exp(-w * t) * (1 + w * t);
};

function frame(T: number) {
  const grow = spring(T + 0.01, 0.42);
  const morph = spring(T - 0.32, 0.4);
  const drop = 1 - smooth(0.05, 1, morph);
  const appear = smooth(0, 0.08, T);
  const zoomIn = 0.25 * spring(T, 0.7) + 0.75 * smoother(0, GLIDE, T);
  const settle = spring(T - 0.5, 2.4);
  const exit = spring(T - PRESENT, 0.95);
  const release = spring(T - PRESENT - 0.05, 0.65);
  const view = (1 + (START_ZOOM - 1) * (1 - zoomIn)) * (1 - 0.045 * settle) * mix(1, FINAL_SCALE, exit);
  return {
    uScale: mix(0.2, 1, grow) * (1 + 0.12 * spring(T - 0.3, 2.2)) * (1 + 0.14 * release),
    uN: mix(2, 5, morph),
    uL: LOGO_SCALE * view,
    uOptics: 1 - smooth(0.55, 1, release),
    uAlpha: appear * (1 - smooth(0.45, 1, release)),
    uSweep: mix(-1.6, 1.6, smoother(0.9, PRESENT - 0.1, T)),
    uAng: 0.9 * smoother(0.4, PRESENT + 0.4, T),
    uDrop: drop,
    uBare: smooth(PRESENT - 0.25, PRESENT, T),
    uDome: 0.15 * (1 - smooth(0.4, 0.95, grow)),
    uFrost: 1 - smooth(0.5, 0.95, grow),
    uCorner: smooth(0.35, 1, morph),
    uLit: Math.pow(1 - release, 1.5),
    uHalo: (0.5 + 0.5 * drop) * appear,
  };
}

type Props = {
  /** Boot finished; hold the settled logo until this flips, then fade out. */
  ready: boolean;
  onFinish: () => void;
};

export function GlassIntro({ ready, onFinish }: Props) {
  const t = useT();
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const fallbackRef = React.useRef<HTMLImageElement | null>(null);
  const [leaving, setLeaving] = React.useState(false);
  const finishedRef = React.useRef(false);
  const onFinishRef = React.useRef(onFinish);
  const readyRef = React.useRef(ready);
  const finishRef = React.useRef<() => void>(() => undefined);

  onFinishRef.current = onFinish;
  readyRef.current = ready;

  finishRef.current = () => {
    if (finishedRef.current) return;
    // Fade only once the app behind the overlay has booted; otherwise the
    // reveal would uncover a blank screen on a slow device.
    if (!readyRef.current) {
      window.setTimeout(() => finishRef.current(), 150);
      return;
    }
    finishedRef.current = true;
    setLeaving(true);
    window.setTimeout(() => onFinishRef.current(), FADE_MS);
  };

  React.useEffect(() => {
    const canvas = canvasRef.current;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const skip = () => finishRef.current();
    const onKey = () => skip();
    window.addEventListener("keydown", onKey);

    if (!canvas) {
      const timer = window.setTimeout(skip, 900);
      return () => {
        window.clearTimeout(timer);
        window.removeEventListener("keydown", onKey);
      };
    }

    const gl = canvas.getContext("webgl2", { antialias: false, alpha: false });
    if (!gl) {
      canvas.style.display = "none";
      if (fallbackRef.current) fallbackRef.current.style.display = "block";
      const timer = window.setTimeout(skip, 1100);
      return () => {
        window.clearTimeout(timer);
        window.removeEventListener("keydown", onKey);
      };
    }

    let program: WebGLProgram | null = null;
    let buffer: WebGLBuffer | null = null;
    let texture: WebGLTexture | null = null;
    let raf = 0;
    let stopped = false;
    let rt = 0;
    let last = performance.now();
    let scheduled = 0;
    let drawn = false;
    let textureReady = false;

    const holdAndFinish = () => {
      if (scheduled) return;
      scheduled = window.setTimeout(() => {
        if (!stopped) finishRef.current();
      }, HOLD_AFTER);
    };

    try {
      const sh = (type: number, source: string) => {
        const shader = gl.createShader(type)!;
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
          throw new Error(gl.getShaderInfoLog(shader) ?? "shader");
        }
        return shader;
      };
      program = gl.createProgram()!;
      gl.attachShader(program, sh(gl.VERTEX_SHADER, VERT));
      gl.attachShader(program, sh(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(program) ?? "program");
      }
      gl.useProgram(program);

      buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(program, "aPos");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

      const uniforms: Record<string, WebGLUniformLocation | null> = {};
      const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
      for (let i = 0; i < count; i += 1) {
        const name = gl.getActiveUniform(program, i)!.name;
        uniforms[name] = gl.getUniformLocation(program, name);
      }

      const draw = () => {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
        const height = Math.max(1, Math.round(canvas.clientHeight * dpr));
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        gl.viewport(0, 0, width, height);
        gl.uniform2f(uniforms.uRes, width, height);
        gl.uniform1f(
          uniforms.uTile,
          Math.min(TILE, Math.min(canvas.clientWidth, canvas.clientHeight) / 1.75) * dpr,
        );
        const values = frame(Math.min(rt, PRESENT));
        for (const key in values) {
          const uniform = uniforms[key];
          if (uniform) gl.uniform1f(uniform, values[key as keyof typeof values]);
        }
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        drawn = true;
      };

      const image = new Image();
      image.onload = () => {
        if (stopped) return;
        texture = gl.createTexture();
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.uniform1i(uniforms.uTex, 0);
        textureReady = true;
        if (reduce) {
          rt = PRESENT;
          draw();
          holdAndFinish();
        }
      };
      image.onerror = () => {
        canvas.style.display = "none";
        if (fallbackRef.current) fallbackRef.current.style.display = "block";
        holdAndFinish();
      };
      image.src = "/brand/openharness-mark.png";

      if (reduce) rt = PRESENT;

      const tick = (now: number) => {
        if (stopped) return;
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        if (!reduce && rt < PRESENT) rt = Math.min(PRESENT, rt + dt);
        if (textureReady) draw();
        if (rt >= PRESENT && textureReady && !scheduled) {
          if (readyRef.current) holdAndFinish();
          else if (!drawn && reduce) holdAndFinish();
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);

      // If boot is instant, still let the reveal finish, then hold and fade.
      const waitBoot = window.setInterval(() => {
        if (stopped) return;
        if (rt >= PRESENT && textureReady && readyRef.current) {
          window.clearInterval(waitBoot);
          holdAndFinish();
        }
      }, 120);

      const resize = () => {
        if (!stopped && textureReady) draw();
      };
      window.addEventListener("resize", resize);

      return () => {
        stopped = true;
        cancelAnimationFrame(raf);
        window.clearInterval(waitBoot);
        window.clearTimeout(scheduled);
        window.removeEventListener("resize", resize);
        window.removeEventListener("keydown", onKey);
        if (texture) gl.deleteTexture(texture);
        if (buffer) gl.deleteBuffer(buffer);
        if (program) gl.deleteProgram(program);
      };
    } catch (error) {
      console.warn("GlassIntro: falling back to static logo", error);
      canvas.style.display = "none";
      if (fallbackRef.current) fallbackRef.current.style.display = "block";
      const timer = window.setTimeout(skip, 1100);
      return () => {
        window.clearTimeout(timer);
        window.removeEventListener("keydown", onKey);
      };
    }
  }, []);

  return (
    <div
      className={cn(
        "fixed inset-0 z-[200] overflow-hidden bg-[#05050a] transition-opacity duration-[620ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
        leaving ? "pointer-events-none opacity-0" : "opacity-100",
      )}
      onClick={() => finishRef.current()}
      data-slot="glass-intro"
    >
      <canvas ref={canvasRef} className="absolute inset-0 size-full cursor-pointer" aria-label="OpenHarneks" role="img" />
      <img
        ref={fallbackRef}
        src="/brand/openharness-mark.png"
        alt=""
        aria-hidden
        draggable={false}
        className="absolute inset-0 m-auto hidden w-[40%] max-w-[320px] select-none"
      />
      <p className="pointer-events-none absolute inset-x-0 bottom-[calc(18px+env(safe-area-inset-bottom,0px))] text-center text-[11px] tracking-[0.08em] text-[var(--faint,#8b8aa5)]">
        {t("intro.skip")}
      </p>
    </div>
  );
}
