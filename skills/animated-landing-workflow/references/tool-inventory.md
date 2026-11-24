# Tool Inventory

Deep reference for each tool in the animated-landing workflow. Organized by role in the pipeline. Always verify URLs on first use — AI/design tooling churns quickly.

> Source: workflow by [Viktor Oddy (@viktoroddy)](https://x.com/viktoroddy/status/2045492112054165813), captured 2026-04-20.

---

## 1. Claude Design — the orchestrator

- **URL:** https://claude.ai/design
- **Vendor:** Anthropic (Anthropic Labs)
- **Launched:** 2026-04-17
- **Model:** Claude Opus 4.7
- **Access:** Claude Pro, Max, Team, Enterprise. Off by default for Enterprise — admin toggle in Organization settings.

### What it produces

- Interactive prototypes
- Wireframes
- Mockups, pitch decks, one-pagers, marketing collateral
- Code-powered prototypes

### Export formats

- Canva
- PDF
- PPTX
- Standalone HTML
- Internal URL (shared within your organization)

### Inputs

- Text prompts
- Image uploads
- Document uploads: DOCX, PPTX, XLSX
- **Reads your codebase** (when connected) and existing design files

### Key capabilities for this workflow

- **Adjustment knobs** — inline controls for spacing, color, and layout without re-prompting
- **Inline comments** — direct annotation / edit on the canvas
- **Organization-scoped sharing** — distribute internal URLs
- **Handoff bundle to Claude Code** — the critical export for this workflow; see `handoff-to-code.md`

### Role in this pipeline

Always the center. Every other tool feeds it inputs (assets, references, animation styles) or ships from it (handoff bundle to code).

---

## 2. motionsites.ai — animated background library

- **URL:** https://motionsites.ai
- **Role:** Ready-made animated background templates

### Typical flow

1. Browse motionsites.ai for a background that fits the brief.
2. Export / copy the background asset or reference.
3. Hand it to an LLM (Claude works well) with a prompt like:
   > "Here is an animated background from motionsites.ai. Generate a self-hosted React + CSS equivalent I can drop into my landing hero section. Assume Tailwind 4 and Framer Motion are available."
4. Iterate on the output in code, or feed the result back into Claude Design as a prototype element.

### When to use

- Hero sections with motion behind content
- Full-bleed section dividers
- Any part of the page that benefits from a background animation rather than a static image

### Caveats

- Exported assets may be heavy — optimize file size before shipping.
- Some backgrounds depend on WebGL or Canvas — verify browser support + mobile performance.
- Use `prefers-reduced-motion` fallbacks (this is an accessibility requirement, not optional).

---

## 3. higgsfield.io — AI animation preview

- **URL:** https://higgsfield.io
- **Alternative:** Kling 3 (similar capability, different vendor)
- **Similar tools:** Wavespeed-class AI video/animation generators

### Purpose

Quickly generates animation previews — short clips showing how a given animation style would feel on your page — so you can evaluate direction before committing to a code implementation.

### Typical flow

1. Describe or upload the element you want to animate.
2. Generate several animation variants.
3. Review which one matches the brief.
4. Pass the selection (as reference video or description) to Claude Code + `awwwards-animations` to implement in GSAP / Framer Motion.

### When to use

- Early-stage exploration of animation style
- Comparing 3–5 motion directions cheaply
- Client/stakeholder sign-off before you write code

### Caveats

- AI-generated previews are directional only — they are NOT the final code.
- Previews may look smoother than what is achievable in-browser at 60 FPS.
- Always re-validate in the real browser with real interaction.

---

## 4. Dribbble — component-level inspiration

- **URL:** https://dribbble.com
- **Role:** Component-scale design references

### What to mine

- Button treatments (variants, hover states, focus rings)
- Stats cards / data widgets
- Micro-interactions (loading states, transitions, reveal effects)
- Typography pairings at the component level
- Section headers, testimonials, pricing cards

### How it differs from `awesome-design-systems`

- `awesome-design-systems` (sister skill): **full design systems**, 185 shipped products with documented systems, tokens, voice guidelines.
- Dribbble: **single-shot visual references** from individual designers. More creative, less rigorous. Great for component ideas, bad for systematic patterns.

Use both: Dribbble for the spark, `awesome-design-systems` for validated precedent, `design-system-patterns` for the actual token/variant architecture.

### Caveats

- Shots often show impossible-on-the-web effects. Validate feasibility.
- Attribution if you borrow heavily.
- Most shots are static images — you may need `higgsfield.io` or a real prototype to see motion intent.

---

## 5. shots.so — animation showcase / video editor

- **URL:** https://shots.so
- **Role:** Browser-based video editor with high-end visual templates (described in the tutorial as "high-tech liquid-crystal" aesthetic)

### Purpose

Wraps your finished animations in polished presentation frames for:

- Portfolio pieces
- Social posts (X, LinkedIn, Instagram)
- Pitch decks and client deliverables
- Case study videos

### Typical flow

1. Record the finished landing animation (screen capture / Lottie export / rendered video).
2. Open shots.so, pick a template (glass / liquid / high-tech backgrounds are the signature).
3. Composite your animation inside.
4. Export the showcase video.

### When to use

- Stage 6 (Showcase & ship) of the pipeline, not before.
- Any deliverable where a raw screen recording would look amateurish.

### Caveats

- Templates can overpower the underlying work if overused — aim for subtle framing, not flashy wrappers.
- Not a substitute for good screen capture hygiene (resolution, framerate, cursor hiding).

---

## 6. land-book — full landing page gallery

- **URL:** https://land-book.com
- **Role:** Curated gallery of shipped landing pages

### What to mine

- Section order and pacing
- Overall composition and whitespace rhythm
- Typography scale at the page level
- Hero-to-content transitions
- Footer and CTA patterns

### How it differs from Dribbble

- Dribbble: component-scale, highly stylized, often not production-ready.
- land-book: page-scale, production shots, real shipped work.

Use land-book to bootstrap the skeleton in Stage 1, then fill the skeleton with components mined from Dribbble + `awesome-design-systems`.

### Caveats

- Curated toward certain aesthetics (minimal, tech, SaaS). Mainstream industries over-represented; niche verticals under-represented.
- Screenshots only — you won't see motion. Pair with `higgsfield.io` previews or live site visits.

---

## Tool-choice cheat sheet

| Need | Tool |
|---|---|
| Start a landing from scratch, need a skeleton | land-book |
| Need a moving background | motionsites.ai |
| Need to explore animation style quickly | higgsfield.io (or Kling 3) |
| Need a button / stat card / micro-interaction reference | Dribbble |
| Need a systematic precedent (real design system) | `awesome-design-systems` (sister skill) |
| Need to prototype the whole page visually | Claude Design |
| Need to hand off to Claude Code | Claude Design → handoff bundle |
| Need to write the actual animation code | `awwwards-animations` (external skill) |
| Need to showcase the finished result | shots.so |
