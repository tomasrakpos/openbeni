// Reusable UI component apple-spotlight; morphs the top navbar pill in-place
// into an AppleSpotlight search bar (shifting right with 4 left-aligned gooey
// shortcut orbs, matching navbar height, light/dark themes, live results, and
// exact reverse morph animation on Back / Escape / outside click).
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ChevronRight, Search, X } from "lucide-react";
import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";

export interface SpotlightShortcut {
  id: string;
  label: string;
  icon: React.ReactNode;
  onSelect: () => void;
}

export interface SpotlightSearchResult {
  id: string;
  icon: React.ReactNode;
  label: string;
  description: string;
  meta?: string;
  onSelect: () => void;
}

type MorphPhase = "idle" | "opening" | "open" | "closing" | "returning";

const NAV_HEIGHT = 42;

const SVGFilter = ({ id }: { id: string }) => {
  return (
    <svg width="0" height="0" className="pointer-events-none absolute" aria-hidden="true">
      <filter
        id={id}
        filterUnits="objectBoundingBox"
        x="-260%"
        y="-100%"
        width="620%"
        height="300%"
      >
        <feGaussianBlur stdDeviation="6" in="SourceGraphic" />
        <feColorMatrix
          values="
            1 0 0 0 0
            0 1 0 0 0
            0 0 1 0 0
            0 0 0 16 -7
          "
          result="blob"
        />
        <feBlend in="SourceGraphic" in2="blob" />
      </filter>
    </svg>
  );
};

interface ShortcutButtonProps {
  label: string;
  icon: React.ReactNode;
  size: number;
  dark: boolean;
  onSelect: () => void;
}

const ShortcutButton = ({ label, icon, size, dark, onSelect }: ShortcutButtonProps) => {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={label}
      title={label}
      style={{ width: size, height: size }}
      className={cn(
        "flex cursor-pointer items-center justify-center rounded-full transition-[opacity,transform,box-shadow,background-color] duration-200",
        "[&_svg]:size-[16px] sm:[&_svg]:size-[17px] [&_svg]:stroke-[1.7]",
        "opacity-75 hover:scale-[1.04] hover:opacity-100 active:scale-[0.96] focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2",
        dark
          ? "text-neutral-200 hover:text-white focus-visible:outline-white/40"
          : "text-neutral-700 hover:text-black focus-visible:outline-black/40",
      )}
    >
      {icon}
    </button>
  );
};

interface SpotlightPlaceholderProps {
  text: string;
  className?: string;
}

const SpotlightPlaceholder = ({ text, className }: SpotlightPlaceholderProps) => {
  return (
    <motion.div
      layout
      className={cn(
        "pointer-events-none absolute inset-y-0 left-0 right-0 z-10 flex items-center overflow-hidden",
        className,
      )}
    >
      <AnimatePresence mode="popLayout">
        <motion.p
          key={`spotlight-placeholder-${text}`}
          initial={{ opacity: 0, y: 8, filter: "blur(4px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: -8, filter: "blur(4px)" }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="truncate text-[13px] leading-none"
        >
          {text}
        </motion.p>
      </AnimatePresence>
    </motion.div>
  );
};

interface SpotlightInputProps {
  placeholder: string;
  hidePlaceholder: boolean;
  value: string;
  onChange: (value: string) => void;
  onBack: () => void;
  onClear: () => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  backLabel: string;
  clearLabel: string;
  showBackText: boolean;
  dark: boolean;
  autoFocusActive: boolean;
  placeholderClassName?: string;
}

const SpotlightInput = ({
  placeholder,
  hidePlaceholder,
  value,
  onChange,
  onBack,
  onClear,
  onKeyDown,
  backLabel,
  clearLabel,
  showBackText,
  dark,
  autoFocusActive,
  placeholderClassName,
}: SpotlightInputProps) => {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!autoFocusActive) return;
    const timer = window.setTimeout(() => {
      inputRef.current?.focus({ preventScroll: true });
    }, 150);
    return () => window.clearTimeout(timer);
  }, [autoFocusActive]);

  return (
    <div
      style={{ height: NAV_HEIGHT }}
      className="flex w-full shrink-0 items-center justify-start gap-2 px-2.5 sm:px-3"
    >
      <div
        className={cn(
          "shrink-0 transition-colors",
          dark ? "text-neutral-300" : "text-neutral-700",
        )}
      >
        <Search className="size-4" strokeWidth={1.8} />
      </div>

      <div className="relative min-w-0 flex-1 text-[13px]">
        {!hidePlaceholder && (
          <SpotlightPlaceholder text={placeholder} className={placeholderClassName} />
        )}

        <input
          ref={inputRef}
          type="text"
          dir="auto"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label={placeholder}
          autoComplete="off"
          spellCheck={false}
          className={cn(
            "w-full bg-transparent text-[13px] leading-none outline-none ring-0",
            dark ? "text-neutral-100 caret-neutral-100" : "text-neutral-950 caret-neutral-950",
          )}
        />
      </div>

      {value ? (
        <button
          type="button"
          onClick={onClear}
          aria-label={clearLabel}
          title={clearLabel}
          className={cn(
            "grid size-6 shrink-0 place-items-center rounded-full transition-colors focus-visible:outline-2",
            dark
              ? "text-neutral-400 hover:bg-white/10 hover:text-white focus-visible:outline-white/40"
              : "text-neutral-500 hover:bg-black/8 hover:text-black focus-visible:outline-black/40",
          )}
        >
          <X className="size-3.5" strokeWidth={2} />
        </button>
      ) : null}

      <button
        type="button"
        onClick={onBack}
        aria-label={backLabel}
        title={backLabel}
        className={cn(
          "inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-full text-[11.5px] font-medium transition-colors focus-visible:outline-2",
          showBackText ? "px-2.5" : "w-7 px-0",
          dark
            ? "bg-white/[0.08] text-neutral-200 hover:bg-white/[0.15] hover:text-white focus-visible:outline-white/40"
            : "bg-black/[0.06] text-neutral-700 hover:bg-black/[0.12] hover:text-black focus-visible:outline-black/40",
        )}
      >
        <ArrowLeft className="size-3.5 shrink-0" strokeWidth={2} />
        {showBackText ? <span className="leading-none">{backLabel}</span> : null}
      </button>
    </div>
  );
};

interface SearchResultCardProps extends SpotlightSearchResult {
  isLast: boolean;
  active: boolean;
  dark: boolean;
}

const SearchResultCard = ({
  icon,
  label,
  description,
  meta,
  onSelect,
  isLast,
  active,
  dark,
}: SearchResultCardProps) => {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="group/card w-full overflow-hidden text-left"
    >
      <div
        className={cn(
          "flex w-full items-center justify-start gap-2.5 rounded-xl px-2.5 py-2 transition-[background-color,box-shadow] duration-150",
          dark
            ? active
              ? "bg-white/[0.10] text-neutral-100 shadow-sm"
              : "text-neutral-100 hover:bg-white/[0.08]"
            : active
              ? "bg-white text-black shadow-sm"
              : "text-black hover:bg-white hover:shadow-sm",
          isLast && "rounded-b-[16px]",
        )}
      >
        <div
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4 [&_svg]:stroke-[1.6]",
            dark ? "bg-white/[0.07] text-neutral-200" : "bg-black/[0.05] text-neutral-800",
          )}
        >
          {icon}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-w-0 items-center gap-2">
            <p
              className={cn(
                "truncate text-[13px] font-medium",
                dark ? "text-neutral-100" : "text-neutral-950",
              )}
              dir="auto"
            >
              {label}
            </p>
            {meta ? (
              <span
                className={cn(
                  "ml-auto shrink-0 text-[10px]",
                  dark ? "text-neutral-400" : "text-neutral-500",
                )}
              >
                {meta}
              </span>
            ) : null}
          </div>
          {description ? (
            <p
              className={cn(
                "truncate text-[11.5px]",
                dark ? "text-white/55" : "text-black/55",
              )}
              dir="auto"
            >
              {description}
            </p>
          ) : null}
        </div>
        <div
          className={cn(
            "flex shrink-0 items-center justify-end transition-opacity duration-150",
            active ? "opacity-100" : "opacity-0 group-hover/card:opacity-100",
          )}
        >
          <ChevronRight className={cn("size-4", dark ? "text-neutral-400" : "text-neutral-600")} />
        </div>
      </div>
    </button>
  );
};

interface SearchResultsContainerProps {
  searchResults: SpotlightSearchResult[];
  loading?: boolean;
  loadingLabel: string;
  emptyLabel: string;
  activeIndex: number;
  dark: boolean;
  onHover: (index: number | null) => void;
}

const SearchResultsContainer = ({
  searchResults,
  loading,
  loadingLabel,
  emptyLabel,
  activeIndex,
  dark,
  onHover,
}: SearchResultsContainerProps) => {
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
      className="w-full overflow-hidden"
    >
      <div
        onMouseLeave={() => onHover(null)}
        className={cn(
          "flex max-h-[min(56vh,340px)] w-full flex-col overflow-y-auto border-t px-1.5 py-1.5",
          dark ? "border-white/[0.09] bg-[#1b1c21]/95" : "border-black/[0.08] bg-neutral-100/95",
        )}
      >
        {loading ? (
          <div
            className={cn(
              "py-5 text-center text-xs",
              dark ? "text-neutral-400" : "text-neutral-500",
            )}
          >
            {loadingLabel}
          </div>
        ) : searchResults.length === 0 ? (
          <div
            className={cn(
              "py-5 text-center text-xs",
              dark ? "text-neutral-400" : "text-neutral-500",
            )}
          >
            {emptyLabel}
          </div>
        ) : (
          searchResults.map((result, index) => (
            <motion.div
              key={result.id}
              onMouseEnter={() => onHover(index)}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                delay: Math.min(index * 0.03, 0.18),
                duration: 0.16,
                ease: "easeOut",
              }}
            >
              <SearchResultCard
                {...result}
                active={activeIndex === index}
                isLast={index === searchResults.length - 1}
                dark={dark}
              />
            </motion.div>
          ))
        )}
      </div>
    </motion.div>
  );
};

export interface AppleSpotlightProps {
  /** The normal top navbar rendered inside the morphing pill (stays mounted
      across all phases so WebGL & glass never flicker or remount). */
  navbar: React.ReactNode;
  shortcuts: SpotlightShortcut[];
  searchResults: SpotlightSearchResult[];
  searchValue: string;
  onSearchValueChange: (value: string) => void;
  isOpen: boolean;
  handleClose: () => void;
  /** Called immediately on open (true) and late in the reverse morph (false)
      so the surrounding TopBar corner menus fade out first and fade back in last. */
  onChromeFadeChange?: (hidden: boolean) => void;
  /** Color scheme of the search bar and shortcuts; defaults to "light". */
  tone?: "light" | "dark";
  /** True when the desktop wide navbar (with labels) is active. */
  wide?: boolean;
  loading?: boolean;
  placeholder?: string;
  backLabel?: string;
  clearLabel?: string;
  loadingLabel?: string;
  emptyLabel?: string;
}

export const AppleSpotlight = ({
  navbar,
  shortcuts,
  searchResults,
  searchValue,
  onSearchValueChange,
  isOpen,
  handleClose,
  onChromeFadeChange,
  tone = "light",
  wide = false,
  loading = false,
  placeholder = "Search",
  backLabel = "Back",
  clearLabel = "Clear",
  loadingLabel = "Loading…",
  emptyLabel = "No results found",
}: AppleSpotlightProps) => {
  const dark = tone === "dark";
  const rawId = useId();
  const filterId = `oh-spotlight-blob-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;

  const rootRef = useRef<HTMLDivElement>(null);
  const navbarMeasureRef = useRef<HTMLDivElement>(null);
  const timersRef = useRef<number[]>([]);
  const prevOpenRef = useRef(isOpen);
  const hadQueryRef = useRef(false);

  const [phase, setPhase] = useState<MorphPhase>(isOpen ? "open" : "idle");
  const [navWidth, setNavWidth] = useState<number>(() => (wide ? 356 : 158));
  const [viewportWidth, setViewportWidth] = useState<number>(() =>
    typeof window === "undefined" ? 1280 : window.innerWidth,
  );
  const [hoveredSearchResult, setHoveredSearchResult] = useState<number | null>(null);
  const [hoveredShortcut, setHoveredShortcut] = useState<number | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    hadQueryRef.current = searchValue.trim().length > 0;
  }, [searchValue]);

  const clearTimers = useCallback(() => {
    for (const id of timersRef.current) window.clearTimeout(id);
    timersRef.current = [];
  }, []);

  const schedule = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms);
    timersRef.current.push(id);
  }, []);

  // Track viewport width for responsive pill & orb sizing.
  useEffect(() => {
    const sync = () => setViewportWidth(window.innerWidth);
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);

  // Measure the real LiquidNavbar width whenever it is in its natural idle state.
  useLayoutEffect(() => {
    const el = navbarMeasureRef.current;
    if (!el) return;
    const measure = () => {
      const w = Math.round(el.getBoundingClientRect().width);
      if (w > 40) setNavWidth(w);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [wide]);

  // Choreograph the forward (idle -> opening -> open) and reverse
  // (open -> closing -> returning -> idle) animations.
  useEffect(() => {
    const wasOpen = prevOpenRef.current;
    prevOpenRef.current = isOpen;
    if (isOpen === wasOpen) return;

    clearTimers();

    if (isOpen) {
      const el = navbarMeasureRef.current;
      if (el) {
        const w = Math.round(el.getBoundingClientRect().width);
        if (w > 40) setNavWidth(w);
      }

      // 1. Softly fade out top-left & top-right corner menus (and credit gauge) first.
      onChromeFadeChange?.(true);
      setPhase("opening");

      // 2. Slide the navbar pill right, morph into the AppleSpotlight search bar,
      //    and spring the 4 left shortcut orbs out.
      schedule(() => {
        setPhase("open");
      }, 75);
    } else {
      setHoveredShortcut(null);
      setHoveredSearchResult(null);

      if (hadQueryRef.current) {
        // User closed directly from typing/results (pill already centered, orbs hidden):
        // smoothly morph width & surface back into the LiquidNavbar, then restore menus.
        setPhase("returning");
        schedule(() => {
          onChromeFadeChange?.(false);
        }, 190);
        schedule(() => {
          setPhase("idle");
        }, 430);
      } else {
        // Exact reverse choreography:
        // 1. Pull the 4 left shortcut orbs smoothly back into the left edge of the pill.
        setPhase("closing");

        // 2. Glide the pill smoothly back left to center & morph back into LiquidNavbar.
        schedule(() => {
          setPhase("returning");
        }, 105);

        // 3. Softly fade the left/right corner menus & credit gauge back in.
        schedule(() => {
          onChromeFadeChange?.(false);
        }, 270);

        // 4. Release transform/width locks once settled at (0px, navWidth) so native
        //    LiquidGlassPanel refraction resumes with zero jump or remount.
        schedule(() => {
          setPhase("idle");
        }, 490);
      }
    }
  }, [isOpen, clearTimers, schedule, onChromeFadeChange]);

  useEffect(() => clearTimers, [clearTimers]);

  useEffect(() => {
    setActiveIndex(0);
    setHoveredSearchResult(null);
  }, [searchValue, searchResults.length]);

  // Escape & outside-click close (triggers exact reverse animation).
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target || !rootRef.current) return;
      if (!rootRef.current.contains(target)) {
        handleClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [isOpen, handleClose]);

  const hasQuery = searchValue.trim().length > 0 && phase === "open";
  const showShortcuts = phase === "open" && !hasQuery && shortcuts.length > 0;
  const isMorphing = phase !== "idle";
  const isSpotlightSurface = phase === "open" || phase === "closing";

  // Responsive geometry:
  // - Height always matches the navbar (42px).
  // - On desktop (wide navbar), search bar shrinks slightly smaller than the navbar.
  // - On mobile, search bar stays right around the mobile navbar's compact size so
  //   [4 left orbs] + [search bar] sit cleanly centered without overflowing.
  const metrics = useMemo(() => {
    const count = Math.max(1, shortcuts.length);
    const isNarrowPhone = viewportWidth < 380;
    const isMobile = viewportWidth < 640;

    const orbSize = isNarrowPhone ? 34 : isMobile ? 36 : NAV_HEIGHT;
    const orbGap = isNarrowPhone ? 5 : isMobile ? 6 : 8;
    const clusterGap = isNarrowPhone ? 6 : isMobile ? 8 : 10;
    const leftClusterWidth = count * orbSize + (count - 1) * orbGap + clusterGap;

    const safeMargin = isMobile ? 20 : 32;
    const maxForRow = Math.max(150, viewportWidth - safeMargin - leftClusterWidth);

    let searchPillWidth: number;
    if (wide) {
      // Desktop: slightly smaller than the desktop navbar (~83% of navWidth)
      searchPillWidth = Math.round(Math.min(306, Math.max(248, navWidth * 0.83)));
      searchPillWidth = Math.min(searchPillWidth, maxForRow);
    } else if (!isMobile) {
      // Tablet / compact-desktop: sleek compact search pill matching navbar height
      searchPillWidth = Math.round(Math.min(244, Math.max(navWidth, maxForRow)));
    } else {
      // Mobile: keep right around the mobile navbar size (~160–196px)
      searchPillWidth = Math.round(Math.min(196, Math.max(Math.min(navWidth, maxForRow), maxForRow)));
    }

    const typingPillWidth = Math.round(
      Math.min(isMobile ? 360 : 440, Math.max(searchPillWidth, viewportWidth - safeMargin)),
    );

    const shiftX = leftClusterWidth / 2;

    return {
      orbSize,
      orbGap,
      clusterGap,
      leftClusterWidth,
      searchPillWidth,
      typingPillWidth,
      shiftX,
    };
  }, [viewportWidth, navWidth, wide, shortcuts.length]);

  // Target horizontal shift and width for each morph phase.
  const targetX =
    phase === "open"
      ? hasQuery
        ? 0
        : metrics.shiftX
      : phase === "closing"
        ? metrics.shiftX
        : 0;

  const targetWidth =
    phase === "open"
      ? hasQuery
        ? metrics.typingPillWidth
        : metrics.searchPillWidth
      : phase === "closing"
        ? metrics.searchPillWidth
        : navWidth;

  const showBackText = targetWidth >= 230;
  // Apply the SVG gooey #blob filter only while shortcuts are out or retracting,
  // never in idle mode (preserves LiquidGlassPanel refraction) and never while
  // results are expanded (keeps dropdown borders & scrollbars crisp).
  const useBlobFilter = (phase === "open" || phase === "closing") && !hasQuery;

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      handleClose();
      return;
    }
    if (!hasQuery || searchResults.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((prev) => (prev + 1) % searchResults.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) => (prev - 1 + searchResults.length) % searchResults.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = searchResults[hoveredSearchResult ?? activeIndex];
      target?.onSelect();
    }
  };

  // Distance from anchor right (50% = center) to the right edge of the 4-orb cluster,
  // placing the cluster directly to the left of the shifted search pill.
  const orbClusterRightOffset =
    metrics.searchPillWidth / 2 + metrics.clusterGap - metrics.shiftX;

  return (
    <div
      ref={rootRef}
      dir="ltr"
      onMouseLeave={() => setHoveredShortcut(null)}
      style={isMorphing ? { width: navWidth, height: NAV_HEIGHT } : undefined}
      className="relative flex h-[42px] items-start justify-center"
    >
      {isMorphing && <SVGFilter id={filterId} />}

      {/* Gooey filter stage — completely neutral in idle mode so LiquidNavbar has
          zero transform/filter ancestors and keeps full backdrop refraction. */}
      <div
        style={useBlobFilter ? { filter: `url(#${filterId})` } : undefined}
        className="relative flex h-[42px] w-full items-start justify-center"
      >
        {/* 4 left-aligned circular shortcut buttons emerging from the left edge of the shifted pill */}
        {isMorphing && (
          <div
            style={{
              height: NAV_HEIGHT,
              right: `calc(50% + ${orbClusterRightOffset}px)`,
              gap: metrics.orbGap,
            }}
            className="pointer-events-none absolute top-0 z-10 flex items-center"
          >
            <AnimatePresence>
              {showShortcuts &&
                shortcuts.map((shortcut, index) => {
                  const distanceFromPill =
                    (shortcuts.length - 1 - index) * (metrics.orbSize + metrics.orbGap) +
                    metrics.clusterGap +
                    metrics.orbSize * 0.45;
                  return (
                    <motion.div
                      key={shortcut.id}
                      onMouseEnter={() => setHoveredShortcut(index)}
                      initial={{
                        x: distanceFromPill,
                        scale: 0.52,
                        opacity: 0,
                      }}
                      animate={{
                        x: 0,
                        scale: 1,
                        opacity: 1,
                        transition: {
                          type: "spring",
                          stiffness: 420,
                          damping: 30,
                          delay: 0.13 + (shortcuts.length - 1 - index) * 0.035,
                        },
                      }}
                      exit={{
                        x: distanceFromPill,
                        scale: 0.52,
                        opacity: 0,
                        transition: {
                          duration: 0.18,
                          ease: [0.4, 0, 1, 1],
                          delay: index * 0.02,
                        },
                      }}
                      style={{
                        width: metrics.orbSize,
                        height: metrics.orbSize,
                      }}
                      className={cn(
                        "pointer-events-auto shrink-0 rounded-full border backdrop-blur-xl",
                        dark
                          ? "border-white/[0.11] bg-[#1b1c21]/95 shadow-[0_8px_22px_-6px_rgba(0,0,0,0.65)]"
                          : "border-black/[0.09] bg-neutral-100/95 shadow-[0_8px_20px_-8px_rgba(0,0,0,0.22)]",
                      )}
                    >
                      <ShortcutButton
                        label={shortcut.label}
                        icon={shortcut.icon}
                        size={metrics.orbSize}
                        dark={dark}
                        onSelect={shortcut.onSelect}
                      />
                    </motion.div>
                  );
                })}
            </AnimatePresence>
          </div>
        )}

        {/* Single always-mounted morphing pill container:
            - In "idle": zero transform, zero width lock, zero clipping -> 100% native LiquidNavbar.
            - On Search: this exact pill glides right, adjusts width, and crossfades into AppleSpotlight.
            - On Back: this exact pill glides back left to center and crossfades back into LiquidNavbar. */}
        <div
          style={
            isMorphing
              ? {
                  width: targetWidth,
                  minHeight: NAV_HEIGHT,
                  borderRadius: 21,
                  transform: `translate3d(${targetX}px, 0, 0)`,
                  transition:
                    "transform 380ms cubic-bezier(0.22, 1.12, 0.36, 1), width 380ms cubic-bezier(0.22, 1.08, 0.36, 1)",
                }
              : undefined
          }
          className="relative z-20 shrink-0"
        >
          {/* Layer 1: Original LiquidNavbar — stays mounted across all phases, fading cleanly out/in */}
          <div
            style={
              isMorphing
                ? {
                    opacity: isSpotlightSurface ? 0 : 1,
                    transition: isSpotlightSurface
                      ? "opacity 190ms ease-out"
                      : "opacity 230ms ease-out 55ms",
                  }
                : undefined
            }
            className={cn(
              "flex h-[42px] items-center justify-center",
              isSpotlightSurface && "pointer-events-none",
            )}
            aria-hidden={isSpotlightSurface || undefined}
          >
            <div ref={navbarMeasureRef} className="shrink-0">
              {navbar}
            </div>
          </div>

          {/* Layer 2: AppleSpotlight search bar & expanding results card on the exact same pill */}
          {isMorphing && (
            <div
              style={{
                borderRadius: 21,
                minHeight: NAV_HEIGHT,
                opacity: isSpotlightSurface ? 1 : 0,
                transition: isSpotlightSurface
                  ? "opacity 220ms ease-out 40ms"
                  : "opacity 175ms ease-out",
              }}
              className={cn(
                "absolute inset-x-0 top-0 flex flex-col overflow-hidden border backdrop-blur-xl",
                !isSpotlightSurface && "pointer-events-none",
                dark
                  ? "border-white/[0.11] bg-[#1b1c21]/95 text-neutral-100 shadow-[0_14px_36px_-10px_rgba(0,0,0,0.68)]"
                  : "border-black/[0.09] bg-neutral-100/95 text-neutral-950 shadow-[0_12px_30px_-10px_rgba(0,0,0,0.20)]",
              )}
              role="search"
              aria-label={placeholder}
            >
              <SpotlightInput
                placeholder={
                  hoveredShortcut !== null && shortcuts[hoveredShortcut]
                    ? shortcuts[hoveredShortcut].label
                    : hoveredSearchResult !== null && searchResults[hoveredSearchResult]
                      ? searchResults[hoveredSearchResult].label
                      : placeholder
                }
                placeholderClassName={
                  hoveredSearchResult !== null
                    ? dark
                      ? "bg-[#1b1c21] text-neutral-100"
                      : "bg-neutral-100 text-neutral-950"
                    : dark
                      ? "text-neutral-400"
                      : "text-neutral-500"
                }
                hidePlaceholder={!(hoveredSearchResult !== null || !searchValue)}
                value={searchValue}
                onChange={onSearchValueChange}
                onBack={handleClose}
                onClear={() => onSearchValueChange("")}
                onKeyDown={handleInputKeyDown}
                backLabel={backLabel}
                clearLabel={clearLabel}
                showBackText={showBackText}
                dark={dark}
                autoFocusActive={phase === "open"}
              />

              <AnimatePresence initial={false}>
                {hasQuery && (
                  <SearchResultsContainer
                    searchResults={searchResults}
                    loading={loading}
                    loadingLabel={loadingLabel}
                    emptyLabel={emptyLabel}
                    activeIndex={hoveredSearchResult ?? activeIndex}
                    dark={dark}
                    onHover={setHoveredSearchResult}
                  />
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AppleSpotlight;
