// Dedicated preview HTML builder kept separate from `codefiles.ts` so the
// ~75 KB Preview Studio bridge script never enters the initial app bundle.
import { PREVIEW_STUDIO_BRIDGE_SCRIPT } from "@/features/preview/previewBridge";
import type { VirtualFile } from "@/lib/types";

const CONSOLE_SNIPPET = `<script>
(function(){
  var send=function(type,args){try{parent.postMessage({__apiset:true,type:type,args:args},"*")}catch(e){}};
  ["log","warn","error","info","debug"].forEach(function(m){
    var original=console[m];
    console[m]=function(){var args=Array.prototype.slice.call(arguments).map(function(a){try{return typeof a==="string"?a:JSON.stringify(a)}catch(e){return String(a)}});send(m,args);if(original)original.apply(console,arguments)};
  });
  window.addEventListener("error",function(e){send("error",[e.message+" ("+e.filename+":"+e.lineno+")"])});
  window.addEventListener("unhandledrejection",function(e){send("error",["Unhandled rejection: "+String(e.reason)])});
  var postPager=function(msg){try{msg.__ohPager=true;parent.postMessage(msg,"*")}catch(e){}};
  var sx=0,sy=0,lx=0,lt=0,vx=0,st=0,mode="";
  function canScrollLeft(el){
    while(el&&el!==document.documentElement){
      var s=getComputedStyle(el);
      if((s.overflowX==="auto"||s.overflowX==="scroll")&&el.scrollWidth>el.clientWidth+2&&el.scrollLeft>2)return true;
      el=el.parentElement;
    }
    return (document.scrollingElement&&document.scrollingElement.scrollLeft>2);
  }
  function begin(m,x,y,t){
    if(window.__ohStudioMode&&window.__ohStudioMode!=="off")return;
    if(t&&t.closest&&t.closest("input,textarea,select,[contenteditable=true]"))return;
    mode=m;sx=lx=x;sy=y;lt=Date.now();vx=0;st=1;
  }
  function move(x,y,ev){
    if(!st)return;
    var dx=x-sx,dy=y-sy;
    if(st===1){
      if(Math.hypot(dx,dy)<6)return;
      if(Math.abs(dy)>Math.abs(dx)||dx<=0||canScrollLeft(ev.target)){st=0;return;}
      st=2;postPager({phase:"start"});
    }
    if(st===2){
      if(ev.cancelable)ev.preventDefault();
      var now=Date.now(),dt=Math.max(1,now-lt);
      vx=vx*0.4+((x-lx)/dt)*0.6;lx=x;lt=now;
      postPager({phase:"move",dx:dx});
    }
  }
  function finish(cancel){
    if(st===2)postPager({phase:"end",dx:lx-sx,vx:vx,cancel:!!cancel});
    st=0;mode="";
  }
  window.addEventListener("touchstart",function(e){if(e.touches.length===1){var t=e.touches[0];begin("t",t.clientX,t.clientY,e.target)}else if(st===2)finish(true)},{passive:true});
  window.addEventListener("touchmove",function(e){if(mode==="t"&&e.touches.length===1){var t=e.touches[0];move(t.clientX,t.clientY,e)}},{passive:false});
  window.addEventListener("touchend",function(){if(mode==="t")finish(false)},{passive:true});
  window.addEventListener("touchcancel",function(){if(mode==="t")finish(true)},{passive:true});
  window.addEventListener("mousedown",function(e){if(e.button===0)begin("m",e.clientX,e.clientY,e.target)});
  window.addEventListener("mousemove",function(e){if(mode==="m")move(e.clientX,e.clientY,e)});
  window.addEventListener("mouseup",function(){if(mode==="m")finish(false)});
})();
</script>`;

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inlineAssets(html: string, files: VirtualFile[]): string {
  const byPath = new Map(files.map((f) => [f.path.replace(/^\.?\//, ""), f]));
  const lookup = (href: string) => byPath.get(href.replace(/^\.?\//, ""));

  let output = html.replace(
    /<link\b[^>]*href=["']([^"']+)["'][^>]*>/gi,
    (tag, href: string) => {
      const file = lookup(href);
      if (!file || file.language !== "css") return tag;
      return `<style>\n${file.content}\n</style>`;
    },
  );

  output = output.replace(
    /<script\b([^>]*)\bsrc=["']([^"']+)["']([^>]*)>\s*<\/script>/gi,
    (tag, attrs: string, src: string) => {
      const file = lookup(src);
      if (!file) return tag;
      return `<script${attrs}>${file.content}</script>`;
    },
  );

  // keep the console hook and studio bridge first in <head> when possible
  const injectedHead = `${CONSOLE_SNIPPET}${PREVIEW_STUDIO_BRIDGE_SCRIPT}`;
  if (/<head[^>]*>/i.test(output)) {
    output = output.replace(/<head([^>]*)>/i, `<head$1>${injectedHead}`);
  } else {
    output = `${injectedHead}${output}`;
  }

  return output;
}

export function buildPreviewHtml(files: VirtualFile[]): { html: string; entry?: string; runnable: boolean } {
  if (files.length === 0) {
    return { html: "", runnable: false };
  }
  const entry = files.find((f) => f.path === "index.html") ?? files.find((f) => f.language === "html");
  if (entry) {
    return { html: inlineAssets(entry.content, files), entry: entry.path, runnable: true };
  }

  const css = files.filter((f) => f.language === "css").map((f) => f.content).join("\n");
  const js = files.filter((f) => f.language === "javascript").map((f) => f.content).join("\n");
  const jsx = files.filter((f) => f.language === "jsx" || f.language === "tsx" || f.language === "typescript");
  const fonts =
    "font-family:Inter,system-ui,-apple-system,sans-serif;margin:0;background:#0b0e15;color:#e9edf9;min-height:100vh;display:grid;place-items:center;padding:2rem;";

  if (jsx.length > 0) {
    const previewCode = escapeHtml(jsx[0]?.content.slice(0, 4000) ?? "");
    return {
      entry: jsx[0]?.path,
      runnable: false,
      html: `${CONSOLE_SNIPPET}${PREVIEW_STUDIO_BRIDGE_SCRIPT}<div style="${fonts}"><div style="max-width:720px;width:100%">
        <div style="font:600 13px Inter,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#8b7bff;margin-bottom:12px">JSX source</div>
        <h1 style="font-size:20px;margin:0 0 8px">This block needs a build step</h1>
        <p style="color:#939bb1;font-size:13px;line-height:1.6;margin:0 0 16px">Preview runs plain HTML, CSS and JS in a sandbox. JSX/TSX is shown as source — export the project or ask the model for a single HTML file to preview it live.</p>
        <pre style="background:#141824;border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:16px;overflow:auto;font:12px/1.6 'JetBrains Mono',monospace;color:#c6cddf">${previewCode}</pre>
      </div></div>`,
    };
  }

  const body = js || css
    ? `<div id="app"></div>`
    : `<div style="${fonts}"><p style="color:#939bb1;font-size:13px">No runnable HTML, CSS or JS found in this response.</p></div>`;

  return {
    entry: files[0]?.path,
    runnable: true,
    html: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>${body}${CONSOLE_SNIPPET}${PREVIEW_STUDIO_BRIDGE_SCRIPT}<script>${js}</script></body></html>`,
  };
}
