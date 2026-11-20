/**
 * ProviderWizard: the "Add provider" dialog, built from the two reference screens.
 *   Step 1 (wide layout, horizontal stepper): pick a preset or "Custom".
 *   Steps 2-4 (side stepper + form): Connection, Models, Review.
 * UI only. It collects values and calls your functions:
 *   onDetectModels(draft)  -> list of models (optional, step 3)
 *   onSubmit({...draft, models})  -> save it (throw to show an error)
 * Frame = the corner menu card. Buttons = GlowButton (jelly press).
 * Needs "@/components/ui/dialog", "@/components/ui/glow-button", lucide-react.
 */
"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Box, Check, ChevronDown, ChevronRight, Clock, Eye, EyeOff, Info, KeyRound, Link2, Monitor, Plus, X, Zap } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { GlowButton } from "@/components/ui/glow-button";
import { ProviderIcon } from "@/components/ProviderIcon";

export type ApiFormat = "auto" | "openai" | "anthropic" | "gemini";
export type ProviderPreset = { id: string; name: string; baseUrl: string; color: string; format?: ApiFormat; local?: boolean; icon?: string };
export type ProviderDraft = { presetId: string | null; name: string; baseUrl: string; apiKey: string; format: ApiFormat; timeout: number };
export type ProviderWizardProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (p: ProviderDraft & { models: string[] }) => void | Promise<void>;
  onDetectModels?: (p: ProviderDraft) => Promise<{ id: string }[]>;
  presets?: ProviderPreset[];
  docsUrl?: string;
  /** Optional values used when editing an existing provider. */
  initialDraft?: Partial<ProviderDraft>;
  initialModels?: string[];
  initialStep?: number;
};

export const PROVIDER_PRESETS: ProviderPreset[] = [
  { id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", color: "#10a37f" },
  { id: "anthropic", name: "Anthropic", baseUrl: "https://api.anthropic.com/v1", color: "#d97757", format: "anthropic" },
  { id: "google", name: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta", color: "#4285f4", format: "gemini" },
  { id: "openrouter", name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", color: "#6467f2" },
  { id: "pollinations", name: "Pollinations", baseUrl: "https://gen.pollinations.ai/v1", color: "#e0a030" },
  { id: "groq", name: "Groq", baseUrl: "https://api.groq.com/openai/v1", color: "#f55036" },
  { id: "mistral", name: "Mistral", baseUrl: "https://api.mistral.ai/v1", color: "#fa520f" },
  { id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", color: "#4d6bfe" },
  { id: "xai", name: "xAI", baseUrl: "https://api.x.ai/v1", color: "#8b8b95" },
  { id: "together", name: "Together AI", baseUrl: "https://api.together.xyz/v1", color: "#3b9cff" },
  { id: "ollama", name: "Ollama (Local)", baseUrl: "http://localhost:11434/v1", color: "#9aa3b2", local: true },
];

const T = {
  fa: {
    title: "افزودن پرووایدر", sub1: "یک پرووایدر انتخاب کنید", sub2: "تنظیمات اتصال",
    steps: ["پیش‌تنظیم", "اتصال", "مدل‌ها", "بررسی"], side: [["اتصال", "تنظیمات پایه"], ["مدل‌ها", "مدل‌های موجود"], ["بررسی", "تأیید و ذخیره"]],
    pick: "یک پیش‌تنظیم انتخاب کنید یا از صفر شروع کنید", pickSub: "برای پرووایدرهای آماده فقط آدرس و روش احراز هویت پر می‌شود.",
    custom: "پرووایدر دلخواه", customSub: "هر آدرس و کلید", local: "محلی",
    detect: "تشخیص خودکار", detectSub: "با بررسی آدرس مدل‌ها، فرمت درست خودکار انتخاب می‌شود.",
    name: "اسم نمایشی", namePh: "مثلاً OpenAI", timeout: "زمان انتظار (ثانیه)", url: "آدرس پایه", key: "کلید API", keyPh: "sk-...", fmt: "فرمت API",
    auto: "تشخیص خودکار", fmtHint: "فرمت از خود پرووایدر تشخیص داده می‌شود.",
    models: "مدل‌ها", loading: "در حال گرفتن لیست مدل‌ها…", none: "مدلی پیدا نشد. اسم مدل را دستی اضافه کنید.", retry: "تلاش دوباره",
    addModel: "افزودن مدل", modelPh: "اسم مدل", review: "بررسی نهایی", count: "مدل فعال",
    cancel: "انصراف", back: "بازگشت", next: "ادامه", save: "افزودن پرووایدر", close: "بستن", show: "نمایش کلید", hide: "پنهان کردن کلید",
    help: "کمک می‌خواهید؟", helpSub: "مستندات را ببینید", step: (n: number) => `مرحله ${n} از ۴`,
    eName: "اسم را بنویسید.", eUrl: "آدرس معتبر نیست. با https:// شروع کنید.", eKey: "کلید را وارد کنید.", eSave: "افزودن انجام نشد.",
  },
  en: {
    title: "Add provider", sub1: "Pick a provider", sub2: "Connection settings",
    steps: ["Preset", "Connection", "Models", "Review"], side: [["Connection", "Basic settings"], ["Models", "Available models"], ["Review", "Confirm & save"]],
    pick: "Pick a preset or start from scratch", pickSub: "Presets only fill in the base URL and auth style.",
    custom: "Custom provider", customSub: "Any base URL and key", local: "Local",
    detect: "Auto-detect", detectSub: "It probes the models endpoint and picks the right format for you.",
    name: "Display name", namePh: "e.g. OpenAI", timeout: "Timeout (seconds)", url: "Base URL", key: "API key", keyPh: "sk-...", fmt: "API format",
    auto: "Auto-detect", fmtHint: "The format is detected from the provider.",
    models: "Models", loading: "Fetching the model list…", none: "No models found. Add a model name by hand.", retry: "Try again",
    addModel: "Add model", modelPh: "Model name", review: "Final check", count: "models enabled",
    cancel: "Cancel", back: "Back", next: "Continue", save: "Add provider", close: "Close", show: "Show key", hide: "Hide key",
    help: "Need help?", helpSub: "Check the documentation", step: (n: number) => `Step ${n} of 4`,
    eName: "Enter a name.", eUrl: "That URL is not valid. Start with https://", eKey: "Enter the key.", eSave: "Could not add the provider.",
  },
};

const FRAME: CSSProperties = {
  border: "1px solid var(--border-strong)",
  background: "linear-gradient(180deg,color-mix(in oklab,var(--foreground) 6%,transparent),color-mix(in oklab,var(--foreground) 1.5%,transparent)),var(--surface-1)",
  boxShadow: "inset 0 1px 0 var(--glass-inner-top,rgba(255,255,255,.14)),0 24px 48px color-mix(in oklab,hsl(var(--shadow-color,0 0% 0%)) 55%,transparent)",
};

const CSS = `
.apw-head{display:flex;align-items:center;gap:16px;flex:none;padding:22px 24px 18px}
.apw-pr{display:grid;place-items:center;width:56px;height:56px;flex:none;border-radius:16px;font-size:20px;font-weight:700;color:#2fd9d0;background:color-mix(in oklab,#2fd9d0 14%,var(--surface-1));box-shadow:inset 0 0 0 1px color-mix(in oklab,#2fd9d0 26%,transparent)}
.apw-ttl{flex:1;min-width:0}.apw-title{margin:0;font-size:21px;font-weight:600;letter-spacing:-.01em;color:var(--foreground)}
.apw-sub{margin:3px 0 0;font-size:13.5px;color:var(--muted-foreground)}
.apw-x{display:grid;place-items:center;width:40px;height:40px;flex:none;border-radius:12px;border:1px solid var(--border-strong);background:color-mix(in oklab,var(--foreground) 5%,transparent);color:var(--foreground);cursor:pointer;transition:background .15s}
.apw-x:hover{background:color-mix(in oklab,var(--foreground) 10%,transparent)}
.apw-hs{display:flex;align-items:center;gap:14px;flex:none;padding:0 24px 16px;border-bottom:1px solid var(--border)}
.apw-hs .st{display:flex;align-items:center;gap:10px;font-size:14px;color:var(--muted-foreground);white-space:nowrap}
.apw-hs .ln{flex:1;height:1px;background:var(--border-strong);min-width:12px}
.apw-dot{display:grid;place-items:center;width:30px;height:30px;flex:none;border-radius:50%;font-size:13px;font-weight:600;border:1px solid var(--border-strong);background:color-mix(in oklab,var(--foreground) 4%,transparent);color:var(--muted-foreground)}
.on>.apw-dot{color:#fff;border-color:transparent;background:linear-gradient(135deg,var(--primary),color-mix(in oklab,var(--primary) 55%,#fff));box-shadow:0 0 0 4px color-mix(in oklab,var(--primary) 22%,transparent)}
.on{color:var(--foreground)!important;font-weight:600}
.done>.apw-dot{color:var(--primary);border-color:color-mix(in oklab,var(--primary) 50%,transparent)}
.apw-body{display:grid;grid-template-columns:minmax(0,1fr);flex:1 1 auto;min-height:0;overflow:hidden}.apw-body.side{grid-template-columns:230px minmax(0,1fr)}
.apw-side{display:flex;flex-direction:column;min-height:0;overflow-y:auto;padding:22px 18px;border-inline-end:1px solid var(--border)}
.apw-vs{display:flex;gap:12px;position:relative;padding-bottom:26px}
.apw-vs:not(:last-of-type)::before{content:"";position:absolute;inset-inline-start:14px;top:34px;bottom:2px;width:1px;background:var(--border-strong)}
.apw-vs b{display:block;font-size:14.5px;font-weight:600;color:var(--muted-foreground)}.apw-vs small{font-size:12px;color:var(--faint,var(--muted-foreground))}
.apw-vs.on b{color:var(--primary)}
.apw-help{margin-top:auto;display:flex;align-items:center;gap:10px;padding:12px;border-radius:14px;border:1px solid var(--border);background:color-mix(in oklab,var(--foreground) 3%,transparent);color:var(--foreground);text-decoration:none;font-size:13px}
.apw-help small{display:block;font-size:11.5px;color:var(--muted-foreground)}
.apw-main{flex:1 1 auto;min-height:0;padding:22px 24px;overflow-y:auto;scrollbar-width:thin;scrollbar-color:var(--border-strong) transparent;animation:apw-in .38s cubic-bezier(.16,1,.3,1) both}
@keyframes apw-in{from{opacity:0;translate:0 8px}}
.apw-h{display:flex;align-items:center;gap:10px;margin:0 0 4px;font-size:17px;font-weight:600;color:var(--foreground)}.apw-h svg{color:var(--primary)}
.apw-p{margin:0 0 18px;font-size:13px;color:var(--muted-foreground);line-height:1.8}
.apw-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
@media(max-width:860px){.apw-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:560px){.apw-grid{grid-template-columns:minmax(0,1fr)}.apw-hs .st span{display:none}.apw-hs .st.on span{display:inline}}
@media(max-width:720px){.apw-body.side{grid-template-columns:minmax(0,1fr)}.apw-side{display:none}}
.apw-card{position:relative;display:flex;align-items:center;gap:14px;min-width:0;padding:14px;text-align:start;font:inherit;color:var(--foreground);cursor:pointer;border-radius:18px;border:1px solid var(--border);background:color-mix(in oklab,var(--foreground) 3%,transparent);transition:background .15s,border-color .2s,transform .25s cubic-bezier(.3,1.5,.5,1)}
.apw-card:hover{background:color-mix(in oklab,var(--foreground) 6%,transparent);transform:translateY(-2px)}
.apw-card[aria-pressed=true]{border-color:color-mix(in oklab,var(--primary) 70%,transparent);background:color-mix(in oklab,var(--primary) 11%,transparent);box-shadow:0 0 0 3px color-mix(in oklab,var(--primary) 18%,transparent)}
.apw-card.dash{border-style:dashed}.apw-card:focus-visible{outline:2px solid var(--ring,var(--primary));outline-offset:2px}
.apw-tilewrap{position:relative;display:inline-flex;flex:none;isolation:isolate;overflow:hidden;border-radius:14px;transition:transform .25s cubic-bezier(.3,1.5,.5,1)}
.apw-card:hover .apw-tilewrap{transform:translateY(-1px) scale(1.04)}
.apw-water{position:absolute;inset:0;overflow:hidden;border-radius:inherit;pointer-events:none;mix-blend-mode:soft-light;opacity:.6}
.apw-water::before,.apw-water::after{content:"";position:absolute;inset:-60%;will-change:transform}
.apw-water::before{background:radial-gradient(closest-side at 32% 28%,rgba(255,255,255,.9),transparent 70%),radial-gradient(closest-side at 70% 74%,rgba(140,225,255,.8),transparent 72%);animation:apw-water-drift 7s ease-in-out infinite alternate}
.apw-water::after{inset:-80%;background:repeating-radial-gradient(circle at 50% 50%,rgba(255,255,255,.32) 0 .8px,transparent 1.6px 9px);opacity:.55;animation:apw-water-ripple 11s ease-in-out infinite alternate}
@keyframes apw-water-drift{from{transform:translate3d(-8%,-6%,0) rotate(-4deg) scale(1.05)}to{transform:translate3d(8%,7%,0) rotate(5deg) scale(1.16)}}
@keyframes apw-water-ripple{from{transform:scale(.9)}to{transform:scale(1.3)}}
.apw-meta{min-width:0;flex:1;display:flex;flex-direction:column;gap:3px}.apw-name{font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.apw-host{font:11.5px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted-foreground);direction:ltr;text-align:start;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.apw-chev{flex:none;color:var(--muted-foreground)}[dir=rtl] .apw-chev{scale:-1 1}
.apw-badge{position:absolute;top:10px;inset-inline-end:10px;padding:2px 10px;border-radius:99px;font-size:11.5px;color:#2fd9d0;background:color-mix(in oklab,#2fd9d0 12%,transparent);box-shadow:inset 0 0 0 1px color-mix(in oklab,#2fd9d0 35%,transparent)}
.apw-info{display:flex;gap:12px;margin-top:16px;padding:14px 16px;border-radius:16px;border:1px solid var(--border);background:color-mix(in oklab,var(--foreground) 3%,transparent)}
.apw-info svg{flex:none;color:#f5923e;margin-top:2px}.apw-info b{display:block;font-size:14px;margin-bottom:3px}.apw-info span{font-size:12.5px;line-height:1.8;color:var(--muted-foreground)}
.apw-f{margin-bottom:18px}.apw-l{display:flex;align-items:center;gap:8px;margin:0 2px 8px;font-size:14px;font-weight:500;color:var(--foreground)}.apw-l svg{color:var(--muted-foreground)}
.apw-fw{position:relative}
.apw-in{width:100%;height:50px;padding:0 16px;border-radius:14px;border:1px solid var(--border-strong);background:color-mix(in oklab,var(--foreground) 4%,transparent);color:var(--foreground);font:inherit;font-size:15px;outline:none;transition:border-color .2s,box-shadow .2s;appearance:none;-webkit-appearance:none}
.apw-in.ltr{direction:ltr;text-align:start}.apw-in.pw{padding-inline-end:48px}
.apw-in::placeholder{color:var(--faint,var(--muted-foreground));opacity:.7}
.apw-in:focus{border-color:var(--primary);box-shadow:0 0 0 4px color-mix(in oklab,var(--primary) 18%,transparent)}
.apw-ic{position:absolute;top:50%;inset-inline-end:8px;translate:0 -50%;display:grid;place-items:center;width:36px;height:36px;border:0;background:none;border-radius:10px;color:var(--muted-foreground);cursor:pointer;pointer-events:auto}
.apw-ic.nopt{pointer-events:none}
.apw-hint{display:flex;align-items:center;gap:7px;margin:8px 2px 0;font-size:12.5px;color:var(--muted-foreground)}
.apw-err{margin:4px 2px 0;font-size:12.5px;color:var(--destructive,#ef4444)}
.apw-row{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:12px;font-size:14px}.apw-row:hover{background:color-mix(in oklab,var(--foreground) 5%,transparent)}
.apw-row input{accent-color:var(--primary);width:17px;height:17px}.apw-row span{direction:ltr;font-family:ui-monospace,Menlo,monospace;font-size:13px}
.apw-add{display:flex;gap:8px;margin-top:12px}.apw-add .apw-in{height:44px}
.apw-sum{border:1px solid var(--border);border-radius:16px;overflow:hidden}.apw-sum div{display:flex;justify-content:space-between;gap:16px;padding:12px 16px;font-size:14px}.apw-sum div+div{border-top:1px solid var(--border)}
.apw-sum span{color:var(--muted-foreground)}.apw-sum b{font-weight:500;direction:ltr;text-align:end;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.apw-foot{display:flex;align-items:center;gap:10px;flex:none;padding:14px 24px 26px;border-top:1px solid var(--border)}
.apw-stp{display:flex;align-items:center;gap:9px;font-size:13px;color:var(--muted-foreground)}.apw-stp i{width:10px;height:10px;border-radius:50%;background:color-mix(in oklab,var(--primary) 70%,var(--surface-1))}
.apw-fill{flex:1}
@media(max-width:560px){
.apw-head{gap:10px;padding:12px 14px 10px}
.apw-pr{display:none}
.apw-title{font-size:17px}.apw-sub{font-size:12px;margin-top:1px}
.apw-x{width:32px;height:32px;border-radius:10px}
.apw-hs{display:none}
.apw-main{padding:13px 14px 15px}
.apw-h{font-size:15px;gap:8px}
.apw-p{font-size:12px;line-height:1.65;margin-bottom:11px}
.apw-grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}
.apw-card{flex-direction:column;align-items:center;text-align:center;gap:6px;padding:9px 6px;border-radius:13px}
.apw-card:hover{transform:none}
.apw-meta{width:100%;gap:1px;align-items:center}
.apw-name{font-size:11.5px;line-height:1.25;white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.apw-host{display:none}
.apw-chev{display:none}
.apw-badge{top:6px;inset-inline-end:6px;padding:0 5px;font-size:9px}
.apw-info{gap:9px;padding:10px 12px;margin-top:10px;border-radius:12px}
.apw-info svg{width:17px;height:17px}
.apw-info b{font-size:12.5px}.apw-info span{font-size:11.5px;line-height:1.6}
.apw-f{margin-bottom:13px}
.apw-l{font-size:13px;margin-bottom:6px}
.apw-in{height:44px;font-size:16px;border-radius:12px;padding:0 13px}
.apw-in.pw{padding-inline-end:42px}
.apw-ic{width:32px;height:32px}
.apw-hint{font-size:11.5px;margin-top:6px}
.apw-err{font-size:11.5px}
.apw-add{flex-wrap:wrap;gap:6px}
.apw-add .apw-in{flex:1 1 100%}
.apw-row{padding:8px 10px;font-size:13px}
.apw-row input{width:16px;height:16px}
.apw-row span{font-size:11.5px}
.apw-sum{border-radius:13px}
.apw-sum div{padding:9px 12px;font-size:12.5px;gap:10px}
.apw-foot{gap:6px;padding:10px 14px calc(12px + env(safe-area-inset-bottom))}
.apw-foot .apw-stp{display:inline-flex;font-size:11.5px;gap:6px}
.apw-foot .apw-stp i{width:8px;height:8px}
.apw-foot button{height:38px;font-size:13px}
.apw-btn-back{padding-inline:8px}
.apw-btn-cancel{padding-inline:10px}
.apw-btn-main{flex:1;min-width:0}
}
@media(max-width:360px){
.apw-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
.apw-foot .apw-stp{display:none}
}
@media(prefers-reduced-motion:reduce){.apw-main{animation:none}.apw-card{transition:none}.apw-water::before,.apw-water::after{animation:none}}
`;

const okUrl = (v: string) => {
  try {
    const u = new URL(v);
    return u.protocol === "https:" || (u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname));
  } catch {
    return false;
  }
};
const hostOf = (v: string) => v.replace(/^https?:\/\//, "").replace(/\/+$/, "");

export function ProviderWizard({ open, onOpenChange, onSubmit, onDetectModels, presets = PROVIDER_PRESETS, docsUrl, initialDraft, initialModels, initialStep }: ProviderWizardProps) {
  const fa = typeof document !== "undefined" && document.documentElement.lang.startsWith("fa");
  const t = fa ? T.fa : T.en;
  const [compact, setCompact] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 560px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 560px)");
    const sync = () => setCompact(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  const iconSize = compact ? 38 : 46;
  const [step, setStep] = useState(0);
  const [sel, setSel] = useState(null as string | null);
  const [d, setD] = useState({ name: "", baseUrl: "", apiKey: "", format: "auto" as ApiFormat, timeout: 45 });
  const [show, setShow] = useState(false);
  const [errs, setErrs] = useState({} as Record<string, string>);
  const [models, setModels] = useState([] as { id: string; on: boolean }[]);
  const [mState, setMState] = useState("idle" as "idle" | "loading" | "error");
  const [manual, setManual] = useState("");
  const [busy, setBusy] = useState(false);
  const [saveErr, setSaveErr] = useState("");
  const detected = useRef(false);

  const preset = presets.find((p) => p.id === sel) ?? null;
  const draft: ProviderDraft = { presetId: preset ? preset.id : null, ...d, baseUrl: d.baseUrl.trim().replace(/\/+$/, ""), name: d.name.trim(), apiKey: d.apiKey.trim() };

  useEffect(() => {
    if (open) return;
    const id = window.setTimeout(() => {
      setStep(0); setSel(null); setD({ name: "", baseUrl: "", apiKey: "", format: "auto", timeout: 45 });
      setShow(false); setErrs({}); setModels([]); setMState("idle"); setManual(""); setSaveErr(""); detected.current = false;
    }, 250);
    return () => clearTimeout(id);
  }, [open]);

  useEffect(() => {
    if (!open || !initialDraft) return;
    setStep(Math.min(3, Math.max(0, initialStep ?? 1)));
    setSel(initialDraft.presetId ?? null);
    setD({
      name: initialDraft.name ?? "",
      baseUrl: initialDraft.baseUrl ?? "",
      apiKey: "",
      format: initialDraft.format ?? "auto",
      timeout: initialDraft.timeout ?? 45,
    });
    setModels((initialModels ?? []).map((id) => ({ id, on: true })));
    setShow(false); setErrs({}); setMState("idle"); setManual(""); setSaveErr(""); detected.current = false;
  }, [open, initialDraft, initialModels, initialStep]);

  const choose = (id: string) => {
    setSel(id);
    const p = presets.find((x) => x.id === id);
    setD((v) => ({ ...v, name: p ? p.name : "", baseUrl: p ? p.baseUrl : "", format: p?.format ?? "auto" }));
    setErrs({});
  };

  const runDetect = async () => {
    if (!onDetectModels) return;
    setMState("loading");
    try {
      const list = await onDetectModels(draft);
      setModels(list.map((m) => ({ id: m.id, on: true })));
      setMState("idle");
    } catch {
      setMState("error");
    }
  };
  useEffect(() => {
    if (step === 2 && !detected.current) {
      detected.current = true;
      void runDetect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!draft.name) e.name = t.eName;
    if (!okUrl(draft.baseUrl)) e.baseUrl = t.eUrl;
    if (!draft.apiKey && !preset?.local) e.apiKey = t.eKey;
    setErrs(e);
    return !Object.keys(e).length;
  };

  const save = async () => {
    setBusy(true);
    setSaveErr("");
    try {
      await onSubmit({ ...draft, models: models.filter((m) => m.on).map((m) => m.id) });
      onOpenChange(false);
    } catch (e) {
      setSaveErr(e instanceof Error && e.message ? e.message : t.eSave);
    } finally {
      setBusy(false);
    }
  };

  const next = () => {
    if (step === 0 && sel) return setStep(1);
    if (step === 1 && validate()) { detected.current = false; setModels([]); return setStep(2); }
    if (step === 2) return setStep(3);
    if (step === 3) void save();
  };
  const addManual = () => {
    const id = manual.trim();
    if (id && !models.some((m) => m.id === id)) setModels([...models, { id, on: true }]);
    setManual("");
  };
  const set = (k: keyof typeof d, v: string | number) => setD((x) => ({ ...x, [k]: v }));

  const field = (k: "name" | "timeout" | "baseUrl" | "apiKey", icon: ReactNode, label: string, props: Record<string, unknown>) => (
    <div className="apw-f">
      <label className="apw-l" htmlFor={`apw-${k}`}>{icon}{label}</label>
      <div className="apw-fw">
        <input id={`apw-${k}`} className={"apw-in" + (k === "baseUrl" || k === "apiKey" ? " ltr" : "") + (k === "apiKey" ? " pw" : "")} {...props} />
        {k === "apiKey" && (
          <button type="button" className="apw-ic" onClick={() => setShow(!show)} aria-label={show ? t.hide : t.show}>
            {show ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        )}
      </div>
      {errs[k] ? <p className="apw-err">{errs[k]}</p> : null}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent hideClose dir={fa ? "rtl" : "ltr"} style={FRAME} className="flex flex-col gap-0 overflow-hidden p-0 sm:w-[min(980px,calc(100vw-2rem))] sm:max-w-none sm:rounded-[28px] rounded-t-[24px]">
        <style>{CSS}</style>
        <div className="apw-head">
          <span className="apw-pr">PR</span>
          <div className="apw-ttl">
            <DialogTitle className="apw-title">{t.title}</DialogTitle>
            <DialogDescription className="apw-sub">{step === 0 ? t.sub1 : t.sub2}</DialogDescription>
          </div>
          <button type="button" className="apw-x" onClick={() => onOpenChange(false)} aria-label={t.close}><X size={18} /></button>
        </div>

        {step === 0 && (
          <div className="apw-hs" aria-hidden="true">
            {t.steps.map((s, i) => (
              <div key={s} style={{ display: "contents" }}>
                <div className={"st" + (i === 0 ? " on" : "")}><span className="apw-dot">{i + 1}</span><span>{s}</span></div>
                {i < 3 && <i className="ln" />}
              </div>
            ))}
          </div>
        )}

        <div className={"apw-body" + (step > 0 ? " side" : "")}>
          {step > 0 && (
            <aside className="apw-side">
              {t.side.map(([a, b], i) => (
                <div key={a} className={"apw-vs " + (step - 1 === i ? "on" : step - 1 > i ? "done" : "")}>
                  <span className="apw-dot">{step - 1 > i ? <Check size={15} /> : i + 1}</span>
                  <div><b>{a}</b><small>{b}</small></div>
                </div>
              ))}
              {docsUrl && (
                <a className="apw-help" href={docsUrl} target="_blank" rel="noreferrer">
                  <Zap size={18} color="#f5b83e" />
                  <span style={{ flex: 1 }}>{t.help}<small>{t.helpSub}</small></span>
                  <ChevronRight size={16} className="apw-chev" />
                </a>
              )}
            </aside>
          )}

          <div className="apw-main" key={step}>
            {step === 0 && (
              <>
                <h3 className="apw-h"><Plus size={18} />{t.pick}</h3>
                <p className="apw-p">{t.pickSub}</p>
                <div className="apw-grid">
                  {presets.map((p) => (
                    <button type="button" key={p.id} className="apw-card" aria-pressed={sel === p.id} onClick={() => choose(p.id)}>
                      <span className="apw-tilewrap" style={{ borderRadius: Math.round(iconSize * 0.3) }}>
                        <ProviderIcon icon={p.icon ?? p.id} name={p.name} color={p.color} baseUrl={p.baseUrl} size={iconSize} />
                        <span className="apw-water" aria-hidden />
                      </span>
                      <span className="apw-meta"><span className="apw-name">{p.name}</span><span className="apw-host" title={p.baseUrl}>{hostOf(p.baseUrl)}</span></span>
                      {p.local ? <span className="apw-badge">{t.local}</span> : <ChevronRight size={18} className="apw-chev" />}
                    </button>
                  ))}
                  <button type="button" className="apw-card dash" aria-pressed={sel === "custom"} onClick={() => choose("custom")}>
                    <span className="apw-tilewrap" style={{ borderRadius: Math.round(iconSize * 0.3) }}>
                      <ProviderIcon icon="custom" name={t.custom} color="#8b7bff" size={iconSize} />
                      <span className="apw-water" aria-hidden />
                    </span>
                    <span className="apw-meta"><span className="apw-name">{t.custom}</span><span className="apw-host">{t.customSub}</span></span>
                  </button>
                </div>
                <div className="apw-info"><Info size={20} /><div><b>{t.detect}</b><span>{t.detectSub}</span></div></div>
              </>
            )}

            {step === 1 && (
              <>
                {field("name", <Monitor size={17} />, t.name, { value: d.name, placeholder: t.namePh, onChange: (e: React.ChangeEvent<HTMLInputElement>) => set("name", e.target.value) })}
                {field("timeout", <Clock size={17} />, t.timeout, { type: "number", min: 5, max: 300, value: d.timeout, onChange: (e: React.ChangeEvent<HTMLInputElement>) => set("timeout", Number(e.target.value) || 45) })}
                {field("baseUrl", <Link2 size={17} />, t.url, { value: d.baseUrl, placeholder: "https://api.example.com/v1", spellCheck: false, autoCapitalize: "off", onChange: (e: React.ChangeEvent<HTMLInputElement>) => set("baseUrl", e.target.value) })}
                {field("apiKey", <KeyRound size={17} />, t.key, { type: show ? "text" : "password", value: d.apiKey, placeholder: t.keyPh, autoComplete: "new-password", spellCheck: false, autoCapitalize: "off", onChange: (e: React.ChangeEvent<HTMLInputElement>) => set("apiKey", e.target.value) })}
                <div className="apw-f">
                  <label className="apw-l" htmlFor="apw-fmt"><Box size={17} />{t.fmt}</label>
                  <div className="apw-fw">
                    <select id="apw-fmt" className="apw-in" value={d.format} onChange={(e) => set("format", e.target.value)}>
                      <option value="auto">{t.auto}</option>
                      <option value="openai">OpenAI</option>
                      <option value="anthropic">Anthropic</option>
                      <option value="gemini">Gemini</option>
                    </select>
                    <span className="apw-ic nopt"><ChevronDown size={18} /></span>
                  </div>
                  <p className="apw-hint"><Info size={14} />{t.fmtHint}</p>
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <h3 className="apw-h">{t.models}</h3>
                <p className="apw-p">{mState === "loading" ? t.loading : mState === "error" ? t.eSave : models.length ? `${models.filter((m) => m.on).length} ${t.count}` : t.none}</p>
                {mState === "error" && <GlowButton variant="secondary" size="sm" onClick={() => void runDetect()}>{t.retry}</GlowButton>}
                {models.map((m) => (
                  <label key={m.id} className="apw-row">
                    <input type="checkbox" checked={m.on} onChange={() => setModels(models.map((x) => (x.id === m.id ? { ...x, on: !x.on } : x)))} />
                    <span>{m.id}</span>
                  </label>
                ))}
                <div className="apw-add">
                  <input className="apw-in ltr" value={manual} placeholder={t.modelPh} onChange={(e) => setManual(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addManual())} />
                  <GlowButton variant="secondary" onClick={addManual}>{t.addModel}</GlowButton>
                </div>
              </>
            )}

            {step === 3 && (
              <>
                <h3 className="apw-h">{t.review}</h3>
                <p className="apw-p">&nbsp;</p>
                <div className="apw-sum">
                  <div><span>{t.name}</span><b>{draft.name}</b></div>
                  <div><span>{t.url}</span><b>{hostOf(draft.baseUrl)}</b></div>
                  <div><span>{t.fmt}</span><b>{d.format === "auto" ? t.auto : d.format}</b></div>
                  <div><span>{t.timeout}</span><b>{d.timeout}</b></div>
                  <div><span>{t.key}</span><b>{draft.apiKey ? "••••••••" : "-"}</b></div>
                  <div><span>{t.models}</span><b>{models.filter((m) => m.on).length}</b></div>
                </div>
                {saveErr ? <p className="apw-err" role="alert" style={{ marginTop: 12 }}>{saveErr}</p> : null}
              </>
            )}
          </div>
        </div>

        <div className="apw-foot">
          {step === 0 ? (
            <span className="apw-stp"><i />{t.step(1)}</span>
          ) : (
            <GlowButton variant="ghost" className="apw-btn-back" onClick={() => setStep(step - 1)} disabled={busy}>{t.back}</GlowButton>
          )}
          <span className="apw-fill" />
          <GlowButton variant="secondary" className="apw-btn-cancel" onClick={() => onOpenChange(false)} disabled={busy}>{t.cancel}</GlowButton>
          <GlowButton className="apw-btn-main" loading={busy} disabled={step === 0 && !sel} onClick={next}>{step === 3 ? t.save : t.next}</GlowButton>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ProviderWizard;
