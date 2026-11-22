import * as React from "react";

/** Reactive matchMedia hook that stays in sync with viewport resizes. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = React.useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(query).matches;
  });

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(query);
    setMatches(mq.matches);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/** True when the viewport is wide enough for the docked desktop right panel (`xl`, 1280px+). */
export function useIsDesktopPanel(): boolean {
  return useMediaQuery("(min-width: 1280px)");
}
