# Claude Design → Claude Code Handoff

The moment where a visual prototype becomes real code. This reference covers the mechanics of the handoff bundle, the prompt pattern that kicks off implementation, and how to delegate animation work to the `awwwards-animations` skill.

> Source: [Anthropic's Claude Design announcement (2026-04-17)](https://www.anthropic.com/news/claude-design-anthropic-labs) + workflow by [Viktor Oddy (@viktoroddy)](https://x.com/viktoroddy/status/2045492112054165813).

---

## What Anthropic says (verbatim facts)

From the Claude Design launch post:

> "When ready, Claude packages everything into a handoff bundle that you can pass to Claude Code with a single instruction."

- Claude Design runs at **[claude.ai/design](https://claude.ai/design)**
- Powered by **Claude Opus 4.7**
- Reads your codebase and design files (when connected)
- Exports: Canva, PDF, PPTX, standalone HTML, internal org URL
- Available on Pro, Max, Team, Enterprise (Enterprise: off by default, admin toggles)

---

## What's in a handoff bundle

The exact contents are product-defined by Anthropic and may evolve. Expect at minimum:

- Component tree / structure (as code scaffolding or a structured spec)
- Styles / token references
- Asset references (images, icons, background assets)
- Prompts and annotations captured during the Claude Design session
- A pointer that Claude Code can resolve when it receives the instruction

If Anthropic's product UI surfaces additional fields (e.g., interaction specs, animation timelines), incorporate them.

---

## The handoff prompt pattern

The prompt you give Claude Code after receiving the bundle. Customize per project.

### Template

```
I have a Claude Design handoff bundle for the landing page at {URL or local reference}.
Please implement it in this repo under {path, e.g., app/(marketing)/landing/}.

Stack constraints:
- Framework: {Next.js 16 App Router / Vite / Astro / etc.}
- Styling: {CSS Modules / Tailwind / Vanilla Extract / etc.}
- Animation: use the `awwwards-animations` skill (GSAP with useGSAP / Framer Motion / Lenis).
  Pick the library per element — do not mix libraries on a single animation.
- Tokens: tokens are defined at {path}. Use CSS custom properties; never hard-code values.
- Animation tokens: durations and easings are tokens too. Define them as CSS custom
  properties at `:root` (`--duration-*`, `--ease-*`) and reference them everywhere —
  in CSS `transition` / `animation`, and in JS libraries via a small helper that reads
  `getComputedStyle(document.documentElement).getPropertyValue('--duration-hero')`.
  NEVER write literal `300ms` / `cubic-bezier(...)` inside a component. Tuning motion
  feel across the page must require editing one `:root` block, not hunting through
  components.
- Accessibility: all motion must respect `prefers-reduced-motion`. Keyboard focus order must match visual order.

Deliver:
1. The component tree with real semantics (not div soup).
2. Styles using existing tokens.
3. Animations implemented per the bundle's motion intent. If the bundle specifies a motion style I can't reproduce with our animation libraries, flag it and propose the nearest feasible alternative.
4. A short README update describing where the landing lives and how to preview it.

Do NOT:
- Add new dependencies without asking.
- Hard-code colors, spacing, or durations.
- Ship animation without `prefers-reduced-motion` fallback.
- Skip type checks or lint.
```

### Customizations

- **Monorepo:** replace `this repo` with the specific package path.
- **Legacy codebase:** add a constraint for which files are off-limits.
- **Design-token mismatch:** add a step asking Claude Code to propose token additions, not silently invent them.

---

## Where `awwwards-animations` plugs in

`awwwards-animations` is an external skill (installed globally if the user has it) with code patterns for:

- GSAP (with `useGSAP` hook)
- Framer Motion / Motion
- Anime.js
- Lenis (smooth scroll)
- ScrollTrigger, parallax, pin sections, magnetic effects, reveal animations

At Stage 5, Claude Code should be told to **defer to that skill for animation code**. The handoff prompt above already does this:

```
Animation: use the `awwwards-animations` skill (GSAP with useGSAP / Framer Motion / Lenis).
```

If the user doesn't have `awwwards-animations` installed, either:
1. Recommend installing it (it's globally installable from its upstream), or
2. Fall back to the animation library the project already uses, with explicit library-choice guidance in the prompt.

---

## After the handoff — verification checklist

Before declaring the implementation done, verify:

- [ ] Dev server runs; landing renders without console errors.
- [ ] Visual diff against the Claude Design prototype (side-by-side). Flag any deviations.
- [ ] 60fps on the animation-heavy sections (record with browser devtools Performance tab).
- [ ] `prefers-reduced-motion: reduce` kills or substantially reduces motion — test by toggling OS setting.
- [ ] Keyboard navigation: tab through the page. Focus order matches visual order.
- [ ] Screen reader sanity check: landmarks, alt text, ARIA where needed.
- [ ] Lighthouse / web-vitals: LCP, CLS, INP at green.
- [ ] Build + type-check + lint all pass.

---

## Common handoff failures & fixes

| Failure | Fix |
|---|---|
| Claude Code hard-codes a color from the prototype | Re-issue the prompt with explicit "tokens at {path} are the source of truth; propose additions rather than hard-code" |
| Animation durations / easings hard-coded inside components (e.g., `transition: 300ms cubic-bezier(...)`) | Require `var(--duration-*)` / `var(--ease-*)` usage everywhere. If a needed value doesn't exist, add it to `:root` with a semantic name (`--duration-hero`, not `--duration-800`). Rationale: tuning motion feel across a page should take one edit in `:root`, not a multi-file search-and-replace. |
| JS animation libraries (GSAP, Framer Motion) written with literal numbers | Read tokens from `getComputedStyle(document.documentElement).getPropertyValue('--duration-hero')` via a small helper. Convert ms→s at the helper boundary, not in every callsite. |
| Animation feels heavier than the prototype | Check FPS; likely dropped to Canvas when CSS/SVG would have sufficed. Revisit library choice. |
| Motion runs even when `prefers-reduced-motion` is on | Ask for a reduced-motion guard at the component root (e.g., `useReducedMotion()` from Framer Motion, or a CSS `@media` wrap for CSS-animated elements) |
| Bundle specifies motion Claude Code "can't reproduce" | Accept the nearest feasible alternative with a one-line explanation, or push back to Claude Design for a simpler motion spec. |
| Tokens diverge between prototype and repo | Run `extract-design-system` (sister skill) against the prototype's standalone-HTML export to reconcile. |
