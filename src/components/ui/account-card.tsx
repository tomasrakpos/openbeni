/**
 * AccountCard: a small liquid-glass card for the bottom of the left menu.
 * Shows avatar, name, email and a three-dot icon. Click it and the options open upward.
 * The glass tint follows the site theme (--primary: violet or orange).
 * Built on GlassCard (needs its optional `padding` prop, see the integration prompt).
 * Needs framer-motion, lucide-react, "@/components/ui/glass-card", "@/lib/utils".
 *
 *   <AccountCard
 *     user={{ name, email, avatarUrl }}
 *     items={[{ id: "settings", label: "Account settings", icon: <Settings />, onClick }, ..., { id: "out", label: "Log out", danger: true, onClick }]}
 *     onSignIn={goToLogin}   // shown when user is null (guest)
 *   />
 */
"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronDown, MoreHorizontal } from "lucide-react";
import {
  SmokyButton,
  resolveSiteSmokeColors,
  type SmokeColors,
} from "@/components/ui/smoky-button";
import { attachOutsideDismiss } from "@/lib/outsideDismiss";
import { cn } from "@/lib/utils";

export type AccountUser = { name: string; email?: string; avatarUrl?: string | null };
export type AccountMenuItem = {
  id: string;
  label: string;
  icon?: ReactNode;
  onClick?: () => void;
  /** Optional external link rendered as an anchor. */
  href?: string;
  /** Optional expandable submenu rendered inline inside the account popover. */
  submenu?: ReactNode;
  danger?: boolean;
  separatorBefore?: boolean;
};
export type AccountCardProps = {
  user: AccountUser | null;
  items: AccountMenuItem[];
  /** Guest mode: the card becomes a sign-in button. */
  onSignIn?: () => void;
  className?: string;
};

const TEXT = {
  fa: { guest: "مهمان", signIn: "ورود با گوگل", menu: "منوی حساب" },
  en: { guest: "Guest", signIn: "Sign in with Google", menu: "Account menu" },
};

// Same card as the corner menu, so the popover matches it.
const FRAME: CSSProperties = {
  border: "1px solid var(--border-strong)",
  background: "linear-gradient(180deg,color-mix(in oklab,var(--foreground) 6%,transparent),color-mix(in oklab,var(--foreground) 1.5%,transparent)),var(--surface-1)",
  boxShadow: "inset 0 1px 0 var(--glass-inner-top,rgba(255,255,255,.14)),0 24px 48px color-mix(in oklab,hsl(var(--shadow-color,0 0% 0%)) 55%,transparent)",
};

const CSS = `
.acc-wrap{position:relative}
.acc-smoky-btn{width:100%;border-radius:18px;padding:10px}
.acc-av{position:relative;display:grid;place-items:center;flex:none;width:36px;height:36px;border-radius:50%;overflow:hidden;font-size:14px;font-weight:700;color:#fff;background:linear-gradient(135deg,var(--primary),color-mix(in oklab,var(--primary) 50%,#fff));box-shadow:0 0 0 2px color-mix(in oklab,var(--primary) 45%,transparent),0 4px 14px color-mix(in oklab,var(--primary) 45%,transparent)}
.acc-av img{width:100%;height:100%;object-fit:cover;display:block}
.acc-meta{min-width:0;flex:1;display:flex;flex-direction:column;gap:1px}
.acc-name{font-size:13.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--foreground)}
.dark .acc-name{text-shadow:0 1px 6px rgba(0,0,0,.45)}
.acc-sub{font-size:11.5px;color:var(--muted-foreground);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;direction:ltr;text-align:start}
.dark .acc-smoky-btn .acc-sub{color:rgba(233,237,249,.78);text-shadow:0 1px 5px rgba(0,0,0,.4)}
.acc-dots{flex:none;display:grid;place-items:center;width:30px;height:30px;border-radius:9px;color:var(--muted-foreground);transition:background .15s,color .15s,rotate .3s cubic-bezier(.3,1.5,.5,1)}
.dark .acc-smoky-btn .acc-dots{color:rgba(233,237,249,.82)}
.acc-smoky-btn:hover .acc-dots,.acc-smoky-btn[aria-expanded=true] .acc-dots{background:color-mix(in oklab,var(--foreground) 12%,transparent);color:var(--foreground)}
.acc-smoky-btn[aria-expanded=true] .acc-dots{rotate:90deg}
.acc-pop{position:absolute;inset-inline:0;bottom:calc(100% + 10px);z-index:20;padding:6px;border-radius:18px;transform-origin:bottom center;contain:layout style;will-change:transform,opacity}
.acc-head{display:flex;align-items:center;gap:10px;padding:6px 8px 8px}
.acc-item{display:flex;align-items:center;gap:10px;width:100%;height:40px;padding:0 10px;border:0;border-radius:10px;background:none;color:var(--foreground);font:inherit;font-size:13.5px;text-align:start;text-decoration:none;cursor:pointer;transition:background .15s}
.acc-item:hover,.acc-item:focus-visible{background:color-mix(in oklab,var(--foreground) 7%,transparent);outline:none}
.acc-item svg{width:17px;height:17px;flex:none;color:var(--muted-foreground)}
.acc-item-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.acc-chev{margin-inline-start:auto;width:15px!important;height:15px!important;transition:transform .2s ease}
.acc-item[aria-expanded=true] .acc-chev{transform:rotate(180deg)}
.acc-subpanel{padding:6px 8px 8px;margin:2px 4px 4px;border-radius:12px;background:color-mix(in oklab,var(--foreground) 4%,transparent);border:1px solid var(--border)}
.acc-item.danger{color:hsl(0 80% 68%)}.acc-item.danger svg{color:inherit}
.acc-sep{height:1px;margin:6px 8px;background:var(--border)}
`;

function ensureAccStyles() {
  if (typeof document === "undefined") return;
  const existing = document.getElementById("acc-card-styles");
  if (existing) {
    existing.textContent = CSS;
    return;
  }
  const tag = document.createElement("style");
  tag.id = "acc-card-styles";
  tag.textContent = CSS;
  document.head.appendChild(tag);
}

function readSiteSmokeColors(): SmokeColors {
  if (typeof document === "undefined") {
    return resolveSiteSmokeColors(true, "violet");
  }
  const root = document.documentElement;
  return resolveSiteSmokeColors(
    root.classList.contains("dark"),
    root.getAttribute("data-accent"),
  );
}

function useSiteSmokeColors(): SmokeColors {
  const [colors, setColors] = useState<SmokeColors>(readSiteSmokeColors);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const sync = () => {
      const next = readSiteSmokeColors();
      setColors((prev) =>
        prev.primary === next.primary &&
        prev.secondary === next.secondary &&
        prev.shadow === next.shadow
          ? prev
          : next,
      );
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-accent"],
    });
    return () => observer.disconnect();
  }, []);

  return colors;
}

export function AccountCard({ user, items, onSignIn, className }: AccountCardProps) {
  ensureAccStyles();
  const smokeColors = useSiteSmokeColors();
  const fa = typeof document !== "undefined" && document.documentElement.lang.startsWith("fa");
  const t = fa ? TEXT.fa : TEXT.en;
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [openSubId, setOpenSubId] = useState<string | null>(null);
  const [imgOk, setImgOk] = useState(true);
  const ref = useRef(null as HTMLDivElement | null);

  useEffect(() => {
    if (!open) {
      setOpenSubId(null);
      return;
    }
    const detachOutside = attachOutsideDismiss({
      isInside: (target, path) =>
        Boolean(ref.current?.contains(target) || (path && ref.current && path.includes(ref.current))),
      onDismiss: () => setOpen(false),
    });
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", esc);
    return () => {
      detachOutside();
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const guest = !user;
  const name = user?.name || user?.email || t.guest;
  const initial = (name.trim()[0] || "?").toUpperCase();
  const click = () => (guest ? onSignIn?.() : setOpen((v) => !v));

  return (
    <div ref={ref} className={cn("acc-wrap", className)}>
      <AnimatePresence>
        {open && !guest && (
          <motion.div
            className="acc-pop"
            role="menu"
            aria-label={t.menu}
            style={FRAME}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 420, damping: 30 }}
          >
            <div className="acc-head">
              <span className="acc-av">
                {user?.avatarUrl && imgOk ? <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" onError={() => setImgOk(false)} /> : initial}
              </span>
              <span className="acc-meta">
                <span className="acc-name">{name}</span>
                {user?.email ? <span className="acc-sub">{user.email}</span> : null}
              </span>
            </div>
            <div className="acc-sep" />

            {items.map((it) => {
              const subOpen = openSubId === it.id;
              return (
                <div key={it.id} style={{ display: "contents" }}>
                  {it.separatorBefore && <div className="acc-sep" />}
                  {it.submenu ? (
                    <>
                      <button
                        type="button"
                        role="menuitem"
                        aria-expanded={subOpen}
                        className={"acc-item" + (it.danger ? " danger" : "")}
                        onClick={() => setOpenSubId((cur) => (cur === it.id ? null : it.id))}
                      >
                        {it.icon}
                        <span className="acc-item-label">{it.label}</span>
                        <ChevronDown className="acc-chev" aria-hidden="true" />
                      </button>
                      <AnimatePresence initial={false}>
                        {subOpen ? (
                          <motion.div
                            key={`${it.id}-sub`}
                            initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0, y: -4 }}
                            animate={reduce ? { opacity: 1 } : { height: "auto", opacity: 1, y: 0 }}
                            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0, y: -4 }}
                            transition={
                              reduce
                                ? { duration: 0.1 }
                                : { duration: 0.24, ease: [0.16, 1, 0.3, 1] }
                            }
                            style={{ overflow: "hidden" }}
                          >
                            <div className="acc-subpanel">{it.submenu}</div>
                          </motion.div>
                        ) : null}
                      </AnimatePresence>
                    </>
                  ) : it.href ? (
                    <a
                      href={it.href}
                      target="_blank"
                      rel="noreferrer"
                      role="menuitem"
                      className={"acc-item" + (it.danger ? " danger" : "")}
                      onClick={() => {
                        setOpen(false);
                        it.onClick?.();
                      }}
                    >
                      {it.icon}
                      <span className="acc-item-label">{it.label}</span>
                    </a>
                  ) : (
                    <button
                      type="button"
                      role="menuitem"
                      className={"acc-item" + (it.danger ? " danger" : "")}
                      onClick={() => {
                        setOpen(false);
                        it.onClick?.();
                      }}
                    >
                      {it.icon}
                      <span className="acc-item-label">{it.label}</span>
                    </button>
                  )}
                </div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>

      <SmokyButton
        colors={smokeColors}
        speed={0.95}
        className="acc-smoky-btn"
        onClick={click}
        aria-haspopup={guest ? undefined : "menu"}
        aria-expanded={guest ? undefined : open}
        customContent={
          <>
            <span className="acc-av">
              {user?.avatarUrl && imgOk ? (
                <img
                  src={user.avatarUrl}
                  alt=""
                  referrerPolicy="no-referrer"
                  onError={() => setImgOk(false)}
                />
              ) : (
                initial
              )}
            </span>
            <span className="acc-meta">
              <span className="acc-name">{guest ? t.guest : name}</span>
              <span className="acc-sub">{guest ? t.signIn : user?.email}</span>
            </span>
            {!guest && (
              <span className="acc-dots" aria-hidden="true">
                <MoreHorizontal size={18} />
              </span>
            )}
          </>
        }
      />
    </div>
  );
}

export default AccountCard;
