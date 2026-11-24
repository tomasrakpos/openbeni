# Workflow Pipeline — 6 stages, brief to ship

A step-by-step pipeline for producing an animated landing page with Claude Design as the orchestrator.

> Source: [Viktor Oddy (@viktoroddy)](https://x.com/viktoroddy/status/2045492112054165813).

---

## Stage 1 — Inspiration & framing

**Goal:** converge on a clear aesthetic direction with evidence.

### Inputs
- The user's brief (or your own): audience, product, tone, reference brands they admire.
- Access to: land-book, Dribbble, motionsites.ai, `awesome-design-systems` sister skill.

### Steps
1. **Layout skeleton** — browse [land-book](https://land-book.com) for 3–5 full-page references in the target vertical. Note: section order, hero treatment, typography scale, whitespace rhythm.
2. **Component references** — browse [Dribbble](https://dribbble.com) for individual components that punch: buttons, stat cards, testimonial blocks, CTA patterns. Capture 5–10 shots.
3. **Animated backgrounds** — browse [motionsites.ai](https://motionsites.ai) for hero-background candidates. Bookmark 2–3.
4. **Systematic precedent** — run a lookup in the `awesome-design-systems` skill: "give me 3 design systems in {vertical} with strong motion or voice" — ground your work in shipped systems, not just mood boards.

### Output
A folder (physical or digital) with 3–5 layout refs, 5–10 component shots, 2–3 background candidates, 2–3 design-system precedents.

### Checks before advancing
- [ ] Do the references share a coherent direction, or are they scattered? If scattered, tighten.
- [ ] Did you pick references you could actually build, or impossible-physics shots? Downgrade the impossible ones.

---

## Stage 2 — Asset generation

**Goal:** turn the animated-background pick into self-hosted code; validate animation style choices.

### Steps
1. **Background → code.** Export / capture the motionsites.ai background you chose. Prompt an LLM (Claude Code works well):
   > "Here is an animated background asset from motionsites.ai. Generate a self-hosted {React+CSS | React+Canvas | WebGL shader} equivalent I can drop into a hero section. Target: 60fps on laptop, graceful fallback to static on `prefers-reduced-motion`. {Include any code-stack constraints here.}"
2. **Animation preview.** For 2–3 animation directions you're considering, generate previews in [higgsfield.io](https://higgsfield.io) (or Kling 3). Compare side by side.
3. **Pick & narrow.** Choose one background direction + one animation family. Discard the rest.

### Output
- 1 self-hosted background implementation (draft code)
- 1 animation direction validated via AI preview
- Rejected alternatives clearly documented so you don't re-explore them

### Checks
- [ ] Background renders at 60fps in your target browser?
- [ ] `prefers-reduced-motion` fallback drafted?
- [ ] Animation preview matches the user's brief, not just your taste?

---

## Stage 3 — Token & architecture decisions

**Goal:** decide the design system underneath before you build the visual prototype, so the prototype is grounded.

### Steps
1. **Extract or define tokens.** If the landing inherits a brand, use `extract-design-system` (sister skill) to pull colors, type, spacing from the existing site. If greenfield, define from scratch using `design-system-patterns` guidance (primitive → semantic → component hierarchy).
2. **Theming decisions.** Light / dark / brand variants? Single theme? Follow `design-system-patterns` CSS-custom-property patterns.
3. **Variant system.** Pick your button/card/section variant strategy — `design-system-patterns` has CVA patterns ready to copy.
4. **Animation tokens as CSS custom properties — non-negotiable.** Animation duration and easing are design values, not magic numbers. Define them once at the `:root` level and reference them everywhere. Adjusting motion feel across a page should take **one edit**, not a hunt through components.

   ```css
   /* :root — animation primitives */
   :root {
     /* Durations — semantic ramp */
     --duration-instant: 100ms;
     --duration-fast:    200ms;
     --duration-base:    300ms;
     --duration-slow:    500ms;
     --duration-hero:    800ms;

     /* Easings — named curves */
     --ease-linear:     linear;
     --ease-out:        cubic-bezier(0.16, 1, 0.3, 1);     /* out-quint  */
     --ease-in-out:     cubic-bezier(0.87, 0, 0.13, 1);    /* in-out-quart */
     --ease-spring:     cubic-bezier(0.34, 1.56, 0.64, 1); /* mild overshoot */
     --ease-anticipate: cubic-bezier(0.68, -0.55, 0.27, 1.55);
   }

   /* Component — references tokens, no magic numbers */
   .hero-heading {
     transition: transform var(--duration-hero) var(--ease-out),
                 opacity   var(--duration-base) var(--ease-out);
   }
   ```

   Same rule applies inside JS animation libraries — wrap tokens in a small helper:

   ```ts
   const getMotionToken = (name: string) =>
     getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();

   // GSAP
   gsap.to(el, {
     y: 0,
     duration: parseFloat(getMotionToken('duration-hero')) / 1000, // ms → s
     ease: getMotionToken('ease-out'),
   });

   // Framer Motion / Motion — transition prop
   <motion.div
     transition={{
       duration: parseFloat(getMotionToken('duration-hero')) / 1000,
       ease: [0.16, 1, 0.3, 1], // or resolve the CSS cubic-bezier into an array
     }}
   />
   ```

### Output
- Starter tokens file (CSS custom properties or JSON)
- Theming approach documented (one sentence)
- Variant-system approach documented (one sentence)
- **Animation token set defined at `:root`** — duration ramp + easing curves — with semantic names, not numeric labels (`--duration-hero`, not `--duration-800`).

### Checks
- [ ] Are your hero animation tokens (durations, easings) declared as CSS custom properties at `:root`?
- [ ] Does any component transition/animation reference `var(--duration-*)` / `var(--ease-*)` rather than a hard-coded `300ms` / `cubic-bezier(...)`?
- [ ] Does your color system survive a dark-mode test?
- [ ] Sanity test: can you make the whole page feel "snappier" or "slower" by editing *only* the `:root` block? If no, you've leaked hard-coded values somewhere.

---

## Stage 4 — Visual prototype in Claude Design

**Goal:** assemble a high-fidelity prototype from the references, assets, and tokens you've accumulated.

### Steps
1. Go to [claude.ai/design](https://claude.ai/design).
2. Upload / reference:
   - Layout refs from land-book (images)
   - Component refs from Dribbble (images)
   - Background asset or description from motionsites.ai
   - Tokens from Stage 3 (as a DOCX/JSON/screenshot if Claude Design can't read your repo directly; connect your codebase if it can)
   - Brief text / positioning
3. Prompt Claude Design to assemble the landing. Iterate using **inline comments** and the **adjustment knobs** (spacing, color, layout).
4. Iterate 5–10 passes. Don't fall in love with the first render.
5. Share the internal URL with stakeholders for approval.

### Output
- High-fidelity prototype in Claude Design
- Signed-off stakeholder approval (or iteration notes)
- Exportable handoff bundle (see Stage 5)

### Checks
- [ ] Prototype reflects the tokens from Stage 3, not Claude Design's defaults?
- [ ] Motion is represented (Claude Design's animation fidelity varies — if weak, supplement with higgsfield.io preview links in the stakeholder review)?

---

## Stage 5 — Handoff to Claude Code

**Goal:** convert the approved prototype into real, shipped code.

See `handoff-to-code.md` for the handoff-bundle mechanics.

### Steps (summary)
1. In Claude Design, trigger the "package handoff bundle" export.
2. Open Claude Code in the target repo.
3. Issue the handoff instruction — a single prompt that points Claude Code at the bundle + tells it which animation library/skills to use.
4. Claude Code scaffolds the page. For animations specifically, defer to the `awwwards-animations` skill (if installed) — it has GSAP / Motion / Lenis / Anime.js patterns ready.
5. Iterate in code. Run the dev server. Test at 60fps.

### Output
- Shipped code: components, styles, animation logic
- Passing build, passing lint, passing type-check
- Live preview

### Checks
- [ ] Does it actually run at 60fps in the target browser?
- [ ] Does `prefers-reduced-motion` kill motion (not just reduce it)?
- [ ] Are tokens from Stage 3 in use everywhere, or did hard-coded values creep in?
- [ ] Is the accessibility tree clean (focus order, alt text, ARIA where needed)?

---

## Stage 6 — Showcase & ship

**Goal:** produce portfolio/pitch assets, then ship.

### Steps
1. Record a clean screen capture of the finished landing (1080p or 1440p, 60fps, cursor hidden).
2. Open [shots.so](https://shots.so), pick a showcase template (the "liquid-crystal / high-tech" styles are the signature).
3. Composite the recording inside the template. Export an MP4 and a looping WebM.
4. Use the MP4 for:
   - Portfolio page
   - X / LinkedIn posts
   - Pitch decks
5. Ship the code to production.

### Output
- Production deployment
- Showcase video (MP4 + WebM)
- Social-post drafts with the video embedded

### Checks
- [ ] Does the showcase video run at 60fps and stay under ~10MB for web embedding?
- [ ] Is attribution credit given on the social post? (Viktor Oddy for the workflow, if you're teaching it.)

---

## Anti-patterns — things to avoid

- **Skipping Stage 1.** Going straight to Claude Design without references produces generic output.
- **Skipping Stage 3.** A gorgeous prototype with ad-hoc tokens will break the moment you try to brand-extend it.
- **Using AI animation previews as final code.** They're directional only; always rebuild in a real animation library.
- **Ignoring `prefers-reduced-motion`.** This is an accessibility failure, not a stylistic choice.
- **Not attributing the workflow.** It's Viktor Oddy's. Credit where due.
