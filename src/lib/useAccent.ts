// Shared logic useAccent; change this helper here and update callers if its contract changes.
import * as React from "react";

export type Accent = "ember" | "violet";

/** Current accent, as set on <html data-accent> by /public/accent.js. */
export function readAccent(): Accent {
  try {
    return document.documentElement.dataset.accent === "ember" ? "ember" : "violet";
  } catch {
    return "violet";
  }
}

/** Updates <html data-accent> and persists the choice for this visit and next. */
export function setAccent(accent: Accent): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-accent", accent);
  try {
    window.sessionStorage.setItem("oh-accent", accent);
    window.localStorage.setItem("oh-accent-last", accent);
  } catch {
    /* ignore storage limits in private mode */
  }
}

/**
 * React-side view of the accent theme, for consumers that need JS values
 * (shader uniforms, canvas palettes). Storage stays in /public/accent.js;
 * this hook only reads and follows <html data-accent>.
 */
export function useAccent(): Accent {
  const [accent, setAccent] = React.useState<Accent>(readAccent);
  React.useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setAccent(readAccent()));
    observer.observe(root, { attributes: true, attributeFilter: ["data-accent"] });
    return () => observer.disconnect();
  }, []);
  return accent;
}
