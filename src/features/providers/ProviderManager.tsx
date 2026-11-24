/**
 * ProviderManager: the providers page body (providers, models, free routers) redone
 * with smooth spring/ease animations for every collapsible panel, segmented pill,
 * row action drawer, and router chip.
 */
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Activity,
  Check,
  ChevronDown,
  Copy,
  KeyRound,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Route,
  Search,
  Star,
  Trash2,
  Zap,
} from "lucide-react";
import * as React from "react";
import { ProviderIcon, resolveIconKey } from "@/components/ProviderIcon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GlowButton } from "@/components/ui/glow-button";
import "./provider-manager.css";

export type PModel = {
  id: string;
  modelId: string;
  name: string;
  pricing: "free" | "paid" | "unknown";
  context?: number;
  enabled: boolean;
  latencyMs?: number | null;
  failed?: boolean;
};

export type PProvider = {
  id: string;
  name: string;
  baseUrl: string;
  format: string;
  color: string;
  icon?: string;
  enabled: boolean;
  keyStored: boolean;
  managed?: boolean;
  favorite?: boolean;
  latencyMs?: number | null;
  failed?: boolean;
  models: PModel[];
};

export type PRouter = {
  id: string;
  name: string;
  providerId: string;
  providerIds?: string[];
  providerNames?: string[];
  members: number;
  enabled?: boolean;
};

export type ProviderManagerProps = {
  providers: PProvider[];
  routers?: PRouter[];
  lang?: "fa" | "en";
  pingingAll?: boolean;
  working?: Record<string, boolean>;
  onAddProvider?: () => void;
  onWarmAddProvider?: () => void;
  onPingAll?: () => void;
  onToggleProvider?: (providerId: string) => void;
  onPingProvider?: (providerId: string) => void;
  onEditProvider?: (providerId: string) => void;
  onCopyBaseUrl?: (providerId: string, baseUrl: string) => void;
  onToggleFavorite?: (providerId: string) => void;
  onDuplicateProvider?: (providerId: string) => void;
  onDeleteProvider?: (providerId: string) => void;
  onToggleModel?: (providerId: string, modelId: string) => void;
  onPingModel?: (providerId: string, modelId: string) => void;
  onEditModel?: (providerId: string, modelId: string) => void;
  onDeleteModel?: (providerId: string, modelId: string) => void;
  onAddModel?: (providerId: string, modelId: string) => void | Promise<void>;
  /** Throw to show an error under the field. */
  onCreateRouter?: (providerId: string, name: string) => void | Promise<void>;
  /** Throw to show an error under the multi-provider router field. */
  onCreateMultiRouter?: (providerIds: string[], name: string) => void | Promise<void>;
  onToggleRouter?: (routerId: string, enabled: boolean) => void;
  onDeleteRouter?: (routerId: string) => void;
};

const EASE_OUT = [0.22, 1, 0.36, 1] as const;
const SPRING_PILL = { type: "spring", stiffness: 420, damping: 32, mass: 0.72 } as const;
const SPRING_CHIP = { type: "spring", stiffness: 380, damping: 28, mass: 0.75 } as const;

const T = {
  fa: {
    providers: "پرووایدر",
    models: "مدل",
    free: "رایگان",
    paid: "پولی",
    all: "همه",
    pingAll: "تست همه",
    pinging: "در حال تست…",
    add: "افزودن پرووایدر",
    search: "جستجوی پرووایدر و مدل",
    key: "کلید ذخیره شده",
    managed: "متصل و آماده",
    noKey: "بدون کلید",
    modelsBtn: "مدل‌ها",
    enabled: "فعال",
    addModel: "افزودن مدل",
    modelPh: "شناسه‌ی مدل (مثلاً llama-3.3-70b)",
    showMore: "نمایش بیشتر",
    empty: "مدلی پیدا نشد.",
    noMatches: "هیچ پرووایدر یا مدلی با این عبارت پیدا نشد.",
    clearSearch: "پاک کردن جستجو",
    ping: "تست اتصال",
    edit: "ویرایش",
    copyUrl: "کپی آدرس پایه",
    pin: "سنجاق به بالا",
    unpin: "برداشتن سنجاق",
    duplicate: "تکرار پرووایدر",
    del: "حذف",
    more: "گزینه‌ها",
    routerT: "روتر رایگان",
    routerD: (n: number) => `${n.toLocaleString("fa-IR")} مدل رایگان را ترکیب می‌کند و اگر یکی جواب نداد، سراغ بعدی می‌رود.`,
    routerPh: "اسم روتر",
    create: "ساخت روتر",
    rules: "۲ تا ۳۲ کاراکتر، یکتا و بدون هم‌نامی با مدل‌ها.",
    noFree: "این پرووایدر مدل رایگان فعالی ندارد.",
    failed: "ناموفق",
    errName: "اسم باید ۲ تا ۳۲ کاراکتر باشد.",
    errCreate: "ساخت روتر انجام نشد.",
    multiTitle: "روتر چندپرووایدری رایگان",
    multiSub: (routersCount: number, totalFree: number) =>
      routersCount > 0
        ? `${routersCount.toLocaleString("fa-IR")} روتر فعال · ${totalFree.toLocaleString("fa-IR")} مدل رایگان در دسترس`
        : `ترکیب مدل‌های رایگان چند پرووایدر در یک مدل واحد`,
    multiPick: "پرووایدرهای عضو را انتخاب کن",
    selectAll: "انتخاب همه",
    clearSel: "پاک کردن",
    selectedSummary: (models: number, providers: number) =>
      `${models.toLocaleString("fa-IR")} مدل رایگان از ${providers.toLocaleString("fa-IR")} پرووایدر`,
    noSelection: "حداقل یک پرووایدر دارای مدل رایگان انتخاب کن.",
    emptyRouter: "بدون مدل فعال",
  },
  en: {
    providers: "providers",
    models: "models",
    free: "Free",
    paid: "Paid",
    all: "All",
    pingAll: "Ping all",
    pinging: "Pinging…",
    add: "Add provider",
    search: "Search providers and models",
    key: "Key stored",
    managed: "Managed",
    noKey: "No key",
    modelsBtn: "Models",
    enabled: "enabled",
    addModel: "Add model",
    modelPh: "Model ID",
    showMore: "Show more",
    empty: "No models found.",
    noMatches: "No providers or models match this search.",
    clearSearch: "Clear search",
    ping: "Ping",
    edit: "Edit",
    copyUrl: "Copy base URL",
    pin: "Pin to top",
    unpin: "Unpin",
    duplicate: "Duplicate",
    del: "Delete",
    more: "Options",
    routerT: "Free router",
    routerD: (n: number) => `Combines the ${n.toLocaleString("en")} free models and moves to the next one if a model fails.`,
    routerPh: "Router name",
    create: "Create router",
    rules: "2–32 characters, unique, can't match a model name.",
    noFree: "This provider has no active free models.",
    failed: "Failed",
    errName: "The name must be 2 to 32 characters.",
    errCreate: "Could not create the router.",
    multiTitle: "Multi-provider free router",
    multiSub: (routersCount: number, totalFree: number) =>
      routersCount > 0
        ? `${routersCount.toLocaleString("en")} router${routersCount === 1 ? "" : "s"} · ${totalFree.toLocaleString("en")} free models available`
        : "Pool free models across multiple providers into a single model",
    multiPick: "Select providers to combine",
    selectAll: "Select all",
    clearSel: "Clear",
    selectedSummary: (models: number, providers: number) =>
      `${models.toLocaleString("en")} free model${models === 1 ? "" : "s"} across ${providers.toLocaleString("en")} provider${providers === 1 ? "" : "s"}`,
    noSelection: "Select at least one provider with free models.",
    emptyRouter: "No active models",
  },
};

const ctx = (n: number | undefined, fa: boolean) =>
  n ? new Intl.NumberFormat(fa ? "fa-IR" : "en", { notation: "compact" }).format(n) : "";

const tint = (c: string) => ({ ["--c" as string]: c || "var(--primary)" }) as React.CSSProperties;
const PAGE = 30;

function SmoothCollapse({
  open,
  children,
  className,
}: {
  open: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const reduced = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {open ? (
        <motion.div
          key="pm-collapse"
          initial={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
          animate={reduced ? { opacity: 1 } : { height: "auto", opacity: 1 }}
          exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
          transition={
            reduced
              ? { duration: 0.12 }
              : {
                  height: { duration: 0.34, ease: EASE_OUT },
                  opacity: { duration: 0.24, ease: EASE_OUT },
                }
          }
          style={{ overflow: "hidden" }}
          className={className}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function Switch({
  on,
  onClick,
  small,
  label,
}: {
  on: boolean;
  onClick: () => void;
  small?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={"pm-sw" + (small ? " sm" : "")}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    />
  );
}

function ModelRow({
  m,
  providerId,
  fa,
  t,
  isOpen,
  pinging,
  onToggleOpen,
  onHoverOpen,
  onToggleModel,
  onPingModel,
  onEditModel,
  onDeleteModel,
}: {
  m: PModel;
  providerId: string;
  fa: boolean;
  t: (typeof T)["en"];
  isOpen: boolean;
  pinging: boolean;
  onToggleOpen: () => void;
  onHoverOpen: (open: boolean) => void;
  onToggleModel?: (providerId: string, modelId: string) => void;
  onPingModel?: (providerId: string, modelId: string) => void;
  onEditModel?: (providerId: string, modelId: string) => void;
  onDeleteModel?: (providerId: string, modelId: string) => void;
}) {
  const reduced = useReducedMotion();
  const hoverTimerRef = React.useRef<number | null>(null);

  React.useEffect(
    () => () => {
      if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current);
    },
    [],
  );

  const handleMouseEnter = () => {
    if (typeof window !== "undefined" && window.matchMedia && !window.matchMedia("(hover: hover)").matches) return;
    if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = window.setTimeout(() => {
      onHoverOpen(true);
    }, 90);
  };

  const handleMouseLeave = () => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    onHoverOpen(false);
  };

  return (
    <div
      className="pm-row"
      data-open={isOpen}
      onClick={onToggleOpen}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <Switch small on={m.enabled} label={m.name} onClick={() => onToggleModel?.(providerId, m.id)} />
      <div className="pm-rn">
        <div className="pm-rname" dir="auto">
          {m.name}
        </div>
        <span className="pm-rid" title={m.modelId}>
          {m.modelId}
        </span>
      </div>
      <div className="pm-rr">
        {m.pricing === "free" ? <span className="pm-free">{t.free}</span> : null}
        <AnimatePresence mode="wait" initial={false}>
          {pinging ? (
            <motion.span
              key="pinging"
              initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.88 }}
              animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.88 }}
              transition={{ duration: 0.16 }}
              className="inline-flex items-center"
            >
              <Loader2 size={13} className="animate-spin" />
            </motion.span>
          ) : m.failed ? (
            <motion.span
              key="failed"
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: -3 }}
              animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: EASE_OUT }}
              className="pm-bad"
            >
              {t.failed}
            </motion.span>
          ) : m.latencyMs ? (
            <motion.span
              key={`lat-${m.latencyMs}`}
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: -3 }}
              animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: EASE_OUT }}
              className="pm-ok"
            >
              {m.latencyMs}ms
            </motion.span>
          ) : null}
        </AnimatePresence>
        {m.context ? <span>{ctx(m.context, fa)}</span> : null}
      </div>

      <SmoothCollapse open={isOpen} className="pm-act-wrap">
        <div className="pm-act" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="pm-ib"
            title={t.ping}
            aria-label={t.ping}
            disabled={pinging}
            onClick={() => onPingModel?.(providerId, m.id)}
          >
            {pinging ? <Loader2 size={15} className="animate-spin" /> : <Zap size={16} />}
          </button>
          <button
            type="button"
            className="pm-ib"
            title={t.edit}
            aria-label={t.edit}
            onClick={() => onEditModel?.(providerId, m.id)}
          >
            <Pencil size={16} />
          </button>
          <button
            type="button"
            className="pm-ib danger"
            title={t.del}
            aria-label={t.del}
            onClick={() => onDeleteModel?.(providerId, m.id)}
          >
            <Trash2 size={16} />
          </button>
        </div>
      </SmoothCollapse>
    </div>
  );
}

function Card({
  p,
  q,
  t,
  fa,
  props,
}: {
  p: PProvider;
  q: string;
  t: (typeof T)["en"];
  fa: boolean;
  props: ProviderManagerProps;
}) {
  const reduced = useReducedMotion();
  const [open, setOpen] = React.useState(false);
  const [f, setF] = React.useState<"all" | "free" | "paid">("all");
  const [pinnedRow, setPinnedRow] = React.useState<string | null>(null);
  const [hoveredRow, setHoveredRow] = React.useState<string | null>(null);
  const [shown, setShown] = React.useState(PAGE);
  const [adding, setAdding] = React.useState(false);
  const [addingBusy, setAddingBusy] = React.useState(false);
  const [mid, setMid] = React.useState("");
  const [rname, setRname] = React.useState("");
  const [err, setErr] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const free = p.models.filter((m) => m.pricing === "free" && m.enabled).length;
  const nFree = p.models.filter((m) => m.pricing === "free").length;
  const nEnabled = p.models.filter((m) => m.enabled).length;

  const list = React.useMemo(() => {
    const s = q.trim().toLowerCase();
    return p.models.filter(
      (m) =>
        (f === "all" || (f === "free" ? m.pricing === "free" : m.pricing !== "free")) &&
        (!s || m.name.toLowerCase().includes(s) || m.modelId.toLowerCase().includes(s)),
    );
  }, [p.models, f, q]);

  const routers = (props.routers ?? []).filter((r) => {
    const ids = r.providerIds && r.providerIds.length > 0 ? r.providerIds : [r.providerId];
    return ids.includes(p.id);
  });

  const hasBrandIcon = Boolean(resolveIconKey(p.icon, p.name, p.baseUrl));
  const pingingProvider = Boolean(props.working?.[p.id]);
  const N = (n: number) => n.toLocaleString(fa ? "fa-IR" : "en");

  const create = async () => {
    const n = rname.trim();
    if (n.length < 2 || n.length > 32) {
      setErr(t.errName);
      return;
    }
    setBusy(true);
    setErr("");
    try {
      await props.onCreateRouter?.(p.id, n);
      setRname("");
    } catch (e) {
      setErr(e instanceof Error && e.message ? e.message : t.errCreate);
    } finally {
      setBusy(false);
    }
  };

  const submitAddModel = async () => {
    const trimmed = mid.trim();
    if (!trimmed || addingBusy) return;
    setAddingBusy(true);
    try {
      await props.onAddModel?.(p.id, trimmed);
      setMid("");
    } finally {
      setAddingBusy(false);
    }
  };

  const pingDotClass = p.failed
    ? "bad"
    : p.latencyMs != null
      ? p.latencyMs < 800
        ? "ok"
        : p.latencyMs < 2500
          ? "warn"
          : "bad"
      : null;

  return (
    <motion.section
      layout={reduced ? false : "position"}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.985 }}
      transition={{ duration: 0.28, ease: EASE_OUT }}
      className={"pm-card" + (p.enabled ? "" : " off")}
    >
      <div className="pm-head">
        <button
          type="button"
          className="pm-tile"
          style={tint(p.color)}
          onClick={() => props.onEditProvider?.(p.id)}
          aria-label={`${t.edit}: ${p.name}`}
        >
          {hasBrandIcon ? (
            <ProviderIcon icon={p.icon} name={p.name} color={p.color} baseUrl={p.baseUrl} size={44} />
          ) : (
            (p.name[0] ?? "?").toUpperCase()
          )}
        </button>

        <div className="pm-id">
          <div className="pm-name-row">
            <h3 className="pm-name" dir="auto">
              {p.name}
            </h3>
            {p.favorite ? <Star size={14} className="pm-star" /> : null}
          </div>
          <span className="pm-host" title={p.baseUrl}>
            {p.baseUrl.replace(/^https?:\/\//, "")}
          </span>
        </div>

        <Switch on={p.enabled} label={p.name} onClick={() => props.onToggleProvider?.(p.id)} />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="pm-ib" aria-label={t.more}>
              {pingingProvider ? <Loader2 size={17} className="animate-spin" /> : <MoreHorizontal size={18} />}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>{p.name}</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => props.onPingProvider?.(p.id)} disabled={pingingProvider}>
              <Activity /> {t.ping}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => props.onEditProvider?.(p.id)}>
              <Pencil /> {t.edit}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => props.onCopyBaseUrl?.(p.id, p.baseUrl)}>
              <Copy /> {t.copyUrl}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => props.onToggleFavorite?.(p.id)}>
              <Star /> {p.favorite ? t.unpin : t.pin}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => props.onDuplicateProvider?.(p.id)}>
              <Plus /> {t.duplicate}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={() => props.onDeleteProvider?.(p.id)}>
              <Trash2 /> {t.del}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="pm-meta">
        <span>
          <KeyRound
            size={14}
            className={"pm-key-icon " + (p.managed || p.keyStored ? "ok" : "miss")}
          />
          {p.managed ? t.managed : p.keyStored ? t.key : t.noKey}
        </span>
        <span>
          {N(p.models.length)} {t.models}
        </span>
        <span>{p.format}</span>
        {pingDotClass ? (
          <span>
            <i className={"pm-ping-dot " + pingDotClass} />
            {p.failed ? t.failed : `${p.latencyMs}ms`}
          </span>
        ) : null}
      </div>

      <button type="button" className="pm-exp" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="pm-exp-left">
          <span>{t.modelsBtn}</span>
          <span className="pm-exp-sub">
            {N(nEnabled)}/{N(p.models.length)}
            {nFree > 0 ? ` · ${N(nFree)} ${t.free}` : ""}
          </span>
        </span>
        <ChevronDown size={17} className="pm-exp-chev" />
      </button>

      <SmoothCollapse open={open}>
        <div className="pm-panel">
          <div className="pm-bar">
            <div className="pm-seg" role="group">
              {(
                [
                  ["all", t.all, p.models.length],
                  ["free", t.free, nFree],
                  ["paid", t.paid, p.models.length - nFree],
                ] as const
              ).map(([k, l, n]) => {
                const active = f === k;
                return (
                  <button
                    type="button"
                    key={k}
                    aria-pressed={active}
                    onClick={() => {
                      setF(k);
                      setShown(PAGE);
                    }}
                  >
                    {active ? (
                      <motion.span
                        layoutId={`pm-seg-${p.id}`}
                        className="pm-seg-pill"
                        transition={reduced ? { duration: 0.1 } : SPRING_PILL}
                      />
                    ) : null}
                    <span className="pm-seg-lbl">
                      {l} {N(n)}
                    </span>
                  </button>
                );
              })}
            </div>
            <span className="pm-spacer" />
            <GlowButton size="sm" variant="secondary" icon={<Plus />} onClick={() => setAdding((v) => !v)}>
              {t.addModel}
            </GlowButton>
          </div>

          <SmoothCollapse open={adding}>
            <div className="pm-add">
              <input
                className="pm-in plain"
                dir="ltr"
                value={mid}
                placeholder={t.modelPh}
                onChange={(e) => setMid(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submitAddModel();
                }}
                autoFocus
              />
              <GlowButton size="sm" loading={addingBusy} disabled={!mid.trim()} onClick={() => void submitAddModel()}>
                {t.addModel}
              </GlowButton>
            </div>
          </SmoothCollapse>

          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={`${f}-${q.trim().toLowerCase()}`}
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 4 }}
              animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, y: -3 }}
              transition={{ duration: 0.18, ease: EASE_OUT }}
            >
              {list.slice(0, shown).map((m) => (
                <ModelRow
                  key={m.id}
                  m={m}
                  providerId={p.id}
                  fa={fa}
                  t={t}
                  isOpen={pinnedRow === m.id || hoveredRow === m.id}
                  pinging={Boolean(props.working?.[m.id])}
                  onToggleOpen={() => setPinnedRow((cur) => (cur === m.id ? null : m.id))}
                  onHoverOpen={(hv) => setHoveredRow(hv ? m.id : hoveredRow === m.id ? null : hoveredRow)}
                  onToggleModel={props.onToggleModel}
                  onPingModel={props.onPingModel}
                  onEditModel={props.onEditModel}
                  onDeleteModel={props.onDeleteModel}
                />
              ))}
              {!list.length ? <div className="pm-empty">{t.empty}</div> : null}
            </motion.div>
          </AnimatePresence>

          <SmoothCollapse open={list.length > shown}>
            <button type="button" className="pm-more" onClick={() => setShown((s) => s + PAGE)}>
              {t.showMore} ({N(list.length - shown)})
            </button>
          </SmoothCollapse>

          <div className="pm-rt">
            <h4>
              <Route size={17} />
              {t.routerT}
            </h4>
            {free > 0 ? (
              <>
                <p>{t.routerD(free)}</p>
                <div className="pm-rf">
                  <input
                    className="pm-in plain"
                    dir="auto"
                    value={rname}
                    maxLength={32}
                    placeholder={t.routerPh}
                    onChange={(e) => {
                      setRname(e.target.value);
                      if (err) setErr("");
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void create();
                    }}
                  />
                  <GlowButton loading={busy} onClick={() => void create()}>
                    {t.create}
                  </GlowButton>
                </div>
                <AnimatePresence mode="wait" initial={false}>
                  {err ? (
                    <motion.p
                      key="err"
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.18, ease: EASE_OUT }}
                      className="pm-err"
                      role="alert"
                    >
                      {err}
                    </motion.p>
                  ) : (
                    <motion.p
                      key="note"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.16 }}
                      className="pm-note"
                    >
                      {t.rules}
                    </motion.p>
                  )}
                </AnimatePresence>
              </>
            ) : (
              <p style={{ marginBottom: 0 }}>{t.noFree}</p>
            )}

            {routers.length > 0 ? (
              <div className="pm-chips">
                <AnimatePresence initial={false}>
                  {routers.map((r) => (
                    <motion.span
                      key={r.id}
                      layout={!reduced}
                      initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.88 }}
                      animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1 }}
                      exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.85 }}
                      transition={SPRING_CHIP}
                      className={"pm-chip" + (r.enabled === false ? " off" : "")}
                    >
                      <span>{r.name}</span>
                      <small>{N(r.members)}</small>
                      {props.onToggleRouter ? (
                        <Switch
                          small
                          on={r.enabled !== false}
                          label={r.name}
                          onClick={() => props.onToggleRouter?.(r.id, r.enabled === false)}
                        />
                      ) : null}
                      <button
                        type="button"
                        className="pm-chip-btn"
                        aria-label={t.del}
                        onClick={() => props.onDeleteRouter?.(r.id)}
                      >
                        <Trash2 size={13} />
                      </button>
                    </motion.span>
                  ))}
                </AnimatePresence>
              </div>
            ) : null}
          </div>
        </div>
      </SmoothCollapse>
    </motion.section>
  );
}

function MultiProviderRouterPanel({
  providers,
  routers,
  fa,
  t,
  onCreateMultiRouter,
  onToggleRouter,
  onDeleteRouter,
}: {
  providers: PProvider[];
  routers: PRouter[];
  fa: boolean;
  t: (typeof T)["en"];
  onCreateMultiRouter: (providerIds: string[], name: string) => void | Promise<void>;
  onToggleRouter?: (routerId: string, enabled: boolean) => void;
  onDeleteRouter?: (routerId: string) => void;
}) {
  const reduced = useReducedMotion();
  const [open, setOpen] = React.useState(false);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [name, setName] = React.useState("");
  const [err, setErr] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const freeByProvider = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const p of providers) {
      map.set(p.id, p.enabled ? p.models.filter((m) => m.pricing === "free" && m.enabled).length : 0);
    }
    return map;
  }, [providers]);

  const totalFree = React.useMemo(
    () => providers.reduce((acc, p) => acc + (freeByProvider.get(p.id) ?? 0), 0),
    [providers, freeByProvider],
  );

  React.useEffect(() => {
    const valid = new Set(providers.map((p) => p.id));
    setSelected((prev) => {
      const next = prev.filter((id) => valid.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [providers]);

  const selectedFreeTotal = selected.reduce((acc, id) => acc + (freeByProvider.get(id) ?? 0), 0);
  const N = (n: number) => n.toLocaleString(fa ? "fa-IR" : "en");

  const togglePid = (pid: string) => {
    setSelected((prev) => (prev.includes(pid) ? prev.filter((x) => x !== pid) : [...prev, pid]));
    if (err) setErr("");
  };

  const submit = async () => {
    const trimmed = name.trim();
    if (trimmed.length < 2 || trimmed.length > 32) {
      setErr(t.errName);
      return;
    }
    if (selected.length === 0 || selectedFreeTotal === 0) return;
    setBusy(true);
    setErr("");
    try {
      await onCreateMultiRouter(selected, trimmed);
      setName("");
      setSelected([]);
    } catch (e) {
      setErr(e instanceof Error && e.message ? e.message : t.errCreate);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="pm-card">
      <button type="button" className="pm-multi-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="pm-multi-title">
          <span className="pm-multi-ic">
            <Route size={17} />
          </span>
          <span className="min-w-0">
            <span className="pm-multi-label">{t.multiTitle}</span>
            <span className="pm-multi-sub">{t.multiSub(routers.length, totalFree)}</span>
          </span>
        </span>
        <ChevronDown
          size={17}
          className="pm-exp-chev"
          style={{ transform: open ? "rotate(180deg)" : undefined }}
        />
      </button>

      <SmoothCollapse open={open}>
        <div className="pm-multi-body">
          <div className="pm-multi-toolbar">
            <span className="text-[12px] text-[var(--muted-foreground)]">{t.multiPick}</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="pm-link-btn"
                disabled={providers.every((p) => (freeByProvider.get(p.id) ?? 0) === 0)}
                onClick={() =>
                  setSelected(providers.filter((p) => (freeByProvider.get(p.id) ?? 0) > 0).map((p) => p.id))
                }
              >
                {t.selectAll}
              </button>
              {selected.length > 0 ? (
                <button type="button" className="pm-link-btn" onClick={() => setSelected([])}>
                  {t.clearSel}
                </button>
              ) : null}
            </div>
          </div>

          <div className="pm-mpills">
            {providers.map((p) => {
              const cnt = freeByProvider.get(p.id) ?? 0;
              const isSel = selected.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  className="pm-mpill"
                  aria-pressed={isSel}
                  onClick={() => togglePid(p.id)}
                >
                  <span className="pm-mpill-check" aria-hidden="true">
                    {isSel ? <Check size={10} strokeWidth={3} /> : null}
                  </span>
                  <span className="max-w-[160px] truncate">{p.name}</span>
                  <span className="pm-mpill-cnt">{N(cnt)}</span>
                </button>
              );
            })}
          </div>

          <p className="pm-note" style={{ marginTop: 10 }}>
            {selected.length > 0 ? t.selectedSummary(selectedFreeTotal, selected.length) : t.noSelection}
          </p>

          <div className="pm-rf" style={{ marginTop: 10 }}>
            <input
              className="pm-in plain"
              dir="auto"
              value={name}
              maxLength={32}
              placeholder={t.routerPh}
              disabled={busy || selected.length === 0 || selectedFreeTotal === 0}
              onChange={(e) => {
                setName(e.target.value);
                if (err) setErr("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
            />
            <GlowButton
              loading={busy}
              disabled={selected.length === 0 || selectedFreeTotal === 0 || name.trim().length < 2}
              onClick={() => void submit()}
            >
              {t.create}
            </GlowButton>
          </div>

          <AnimatePresence mode="wait" initial={false}>
            {err ? (
              <motion.p
                key="merr"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.18, ease: EASE_OUT }}
                className="pm-err"
                role="alert"
              >
                {err}
              </motion.p>
            ) : null}
          </AnimatePresence>

          {routers.length > 0 ? (
            <div className="pm-rt-list">
              <AnimatePresence initial={false}>
                {routers.map((r) => (
                  <motion.div
                    key={r.id}
                    layout={!reduced}
                    initial={reduced ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }}
                    animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
                    exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
                    transition={SPRING_CHIP}
                    className="pm-rt-item"
                  >
                    <div className="pm-rt-item-meta">
                      <Route size={14} className="shrink-0 text-[var(--primary)]" />
                      <span className="truncate font-semibold">{r.name}</span>
                      <span className="pm-rt-tag primary">
                        {r.members > 0 ? `${N(r.members)} ${t.free}` : t.emptyRouter}
                      </span>
                      {(r.providerNames ?? []).map((pn) => (
                        <span key={pn} className="pm-rt-tag">
                          {pn}
                        </span>
                      ))}
                    </div>
                    <div className="pm-rt-item-act">
                      {onToggleRouter ? (
                        <Switch
                          small
                          on={r.enabled !== false}
                          label={r.name}
                          onClick={() => onToggleRouter(r.id, r.enabled === false)}
                        />
                      ) : null}
                      <button
                        type="button"
                        className="pm-ib danger"
                        style={{ width: 28, height: 28 }}
                        aria-label={t.del}
                        onClick={() => onDeleteRouter?.(r.id)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          ) : null}
        </div>
      </SmoothCollapse>
    </section>
  );
}

export function ProviderManager(props: ProviderManagerProps) {
  const fa =
    props.lang != null
      ? props.lang === "fa"
      : typeof document !== "undefined" && document.documentElement.lang.startsWith("fa");
  const t = fa ? T.fa : T.en;
  const [q, setQ] = React.useState("");
  const reduced = useReducedMotion();

  const nm = props.providers.reduce((a, p) => a + p.models.length, 0);
  const nf = props.providers.reduce((a, p) => a + p.models.filter((m) => m.pricing === "free").length, 0);
  const enabledProvidersCount = props.providers.filter((p) => p.enabled).length;

  const shown = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return props.providers;
    return props.providers.filter(
      (p) =>
        p.name.toLowerCase().includes(needle) ||
        p.baseUrl.toLowerCase().includes(needle) ||
        p.models.some((m) => m.name.toLowerCase().includes(needle) || m.modelId.toLowerCase().includes(needle)),
    );
  }, [props.providers, q]);

  const N = (n: number) => n.toLocaleString(fa ? "fa-IR" : "en");
  const routers = props.routers ?? [];
  const showMultiPanel = Boolean(props.onCreateMultiRouter) && (props.providers.length > 1 || routers.length > 0);

  return (
    <div className="pm">
      <div className="pm-top">
        <div className="pm-sum">
          <b>{N(props.providers.length)}</b> {t.providers}
          <i />
          <b>{N(nm)}</b> {t.models}
          <i />
          <b>{N(nf)}</b> {t.free}
        </div>
        <div className="pm-actions">
          <GlowButton
            variant="ghost"
            size="sm"
            loading={props.pingingAll}
            disabled={enabledProvidersCount === 0}
            icon={<Activity />}
            onClick={props.onPingAll}
          >
            {props.pingingAll ? t.pinging : t.pingAll}
          </GlowButton>
          <GlowButton
            size="sm"
            icon={<Plus />}
            onClick={props.onAddProvider}
            onPointerEnter={props.onWarmAddProvider}
            onFocus={props.onWarmAddProvider}
            aria-haspopup="dialog"
          >
            {t.add}
          </GlowButton>
        </div>
      </div>

      <div className="pm-search">
        <Search size={17} />
        <input
          className="pm-in"
          dir="auto"
          value={q}
          placeholder={t.search}
          onChange={(e) => setQ(e.target.value)}
          aria-label={t.search}
        />
      </div>

      {showMultiPanel && props.onCreateMultiRouter ? (
        <MultiProviderRouterPanel
          providers={props.providers}
          routers={routers}
          fa={fa}
          t={t}
          onCreateMultiRouter={props.onCreateMultiRouter}
          onToggleRouter={props.onToggleRouter}
          onDeleteRouter={props.onDeleteRouter}
        />
      ) : null}

      <AnimatePresence mode="popLayout" initial={false}>
        {shown.map((p) => (
          <Card key={p.id} p={p} q={q} t={t} fa={fa} props={props} />
        ))}
      </AnimatePresence>

      <AnimatePresence>
        {shown.length === 0 && q.trim() ? (
          <motion.div
            key="no-match"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: EASE_OUT }}
            className="pm-card"
            style={{ padding: "28px 18px", textAlign: "center" }}
          >
            <p className="text-[13px] text-[var(--muted-foreground)]">{t.noMatches}</p>
            <div style={{ marginTop: 12 }}>
              <GlowButton size="sm" variant="secondary" onClick={() => setQ("")}>
                {t.clearSearch}
              </GlowButton>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export default ProviderManager;
