---
name: awesome-design-systems
description: Curated catalog of 185 publicly documented design systems (Material, Carbon, Polaris, Fluent, GOV.UK, Atlassian, Salesforce Lightning, Chakra, Mantine, shadcn/ui, Radix, etc.) indexed by feature flags — Components, Voice & Tone, Designers Kit, Source code. Use when researching design-system precedents, benchmarking a component against shipped systems, finding Figma/Sketch kits to reference, sourcing editorial voice guidelines, looking up a system by name, or citing real-world prior art. Complements the primary skills extract-design-system and design-system-patterns by supplying the "who has already built this" catalog they reason over.
---

# Awesome Design Systems

## Purpose

This skill is a **searchable reference catalog**, not a builder. It indexes 185 public design systems sourced from [alexpate/awesome-design-systems](https://github.com/alexpate/awesome-design-systems) and adds structured filters on top. Use it to supply concrete precedents to the primary design-system skills — `extract-design-system` and `design-system-patterns` — which own the "how to build" half of the workflow. This skill owns the "who has already built this, what are they called, and where do I read their code / spec" half.

## What's in the catalog — headline stats

Captured 2026-04-19 from the upstream repo. Refresh instructions at the bottom.

- **185** total design systems
- **180** expose coded **Components**
- **132** publish their **source code** publicly
- **85** ship a **Designers Kit** (Figma / Sketch / XD / Photoshop)
- **77** document **Voice & Tone** / editorial language guidance
- **4** upstream feature flags on every entry: **Components** · **Voice & Tone** · **Designers Kit** · **Source code**

## The 4 feature flags — what they mean and when to filter by them

- **Components** → the system publishes coded examples (HTML, React, Web Components, or similar). Filter by this when the user wants working code to read or adapt, not just a spec. ~97% of entries qualify (180/185), so this flag rarely narrows meaningfully; treat it as the baseline.

- **Voice & Tone** → the system documents editorial voice, microcopy conventions, language guidance, or content principles. Filter by this when the user is building a content style guide or wants authoritative examples of product language (Mailchimp Content, Monzo Tone of Voice, Shopify Polaris are the canonical references). Only 42% of entries qualify (77/185), so this is a real filter.

- **Designers Kit** → the system ships a downloadable Figma / Sketch / XD / Photoshop file mirroring its components. Filter by this when the user wants a design-tool source file to mine for layer structure, auto-layout, or token organization (Material, Polaris, Atlassian, Porsche publish particularly complete kits). 46% of entries qualify (85/185).

- **Source code** → the system's implementation repo is public (GitHub, Bitbucket, GitLab). Publicly viewable ≠ permissively licensed — always check LICENSE before vendoring. 71% of entries qualify (132/185).

## When to use this skill

Load this skill for any of these user-intent patterns:

- **"Is X a design system? What's its URL?"** → `references/all-systems.md`
- **"Which design systems have strong voice & tone / content guidance?"** → `references/with-voice-and-tone.md`
- **"Find me a Figma kit I can reference for component Y"** → `references/with-designers-kit.md`
- **"Show me open-source React design systems I can read the code of"** → `references/open-source.md`
- **"Give me 3 fintech / gov / SaaS / travel design-system precedents"** → `references/notable-by-category.md`
- **"How does {Polaris, Carbon, Material} handle {empty state, data table, button hierarchy}?"** → start with `references/notable-by-category.md`, then fetch the system's site directly.
- **"Benchmark my component against real systems"** → pull 3–5 from `references/notable-by-category.md` matching the vertical.

## Reference routing table

Load exactly one file per question — they overlap and together exceed 680 lines.

| Question | File | Lines | Contains |
|---|---|---:|---|
| Name lookup, full index | `references/all-systems.md` | 199 | All 185 systems alphabetical with feature flags + source links |
| Voice & tone precedents | `references/with-voice-and-tone.md` | 81 | 77 systems with editorial voice guidance |
| Designer kit sourcing | `references/with-designers-kit.md` | 89 | 85 systems shipping Figma/Sketch/XD |
| OSS code reading | `references/open-source.md` | 138 | 132 systems with public source code + license warning |
| Vertical/industry browse | `references/notable-by-category.md` | 177 | Hand-curated groupings (big tech, gov, fintech, SaaS, React, travel, etc.) |

## Exemplar systems by category

Load-free orientation. Use these to answer "give me N examples" questions directly from the manifest; only fetch `notable-by-category.md` when the user asks for the full list of a category.

- **Big Tech / Platform:** Google Material, Shopify Polaris, IBM Carbon, GitHub Primer, Adobe Spectrum, Microsoft Fluent UI, GitLab Pajamas, AWS Cloudscape, Atlassian Design System, Alibaba Ant Design.
- **Government & Public Sector:** GOV.UK Design System, U.S. Web Design Standards (USWDS), French Government Design System (DSFR), Singapore Government Design System (SGDS), Aurora (Government of Canada), NASA Web Design System, NHS.UK Service Manual, Estonia Country Design Guidelines.
- **Enterprise & SaaS:** Atlassian, Salesforce Lightning, Workday Canvas, PatternFly (Red Hat), VMware Clarity, SAP Fiori, Pluralsight, Morningstar, Elastic EUI, Thumbprint (Thumbtack), Stacks (Stack Overflow), Kaizen (Culture Amp).
- **OSS React / Web Component Libraries:** Chakra UI, Mantine, shadcn/ui, Radix, Blueprint (Palantir), Uber Base Web, Grommet (HP), Evergreen (Segment), Reach UI, Shoelace, Semi Design, Reshaped, Untitled UI.
- **Travel, Retail & Lifestyle:** Backpack (Skyscanner), Kiwi.com Orbit, Just Eat PIE, Alaska Airlines Auro, Audi UI Kit, Porsche Design System, Decathlon Vitamin, BBC GEL, Financial Times Origami, BuzzFeed Solid.
- **Finance & Fintech:** Monzo Tone of Voice, Mailchimp Content Styleguide, Santander Flame, Flexport Latitude, MongoDB Design System, Documenso, Intuit Harmony, Priceline Design System.
- **Most comprehensive (all 4 flags):** Shopify Polaris, Google Material, IBM Carbon, Microsoft Fluent UI, Atlassian, GitLab Pajamas, HashiCorp Helios, Skyscanner Backpack, AWS Cloudscape, Firefox Photon, USWDS.
- **Voice & tone canon:** Mailchimp Content Styleguide, Monzo Tone of Voice, Shopify Polaris, Atlassian, Mailchimp Patterns, Duolingo (tone only), Starbucks Style Guide, Louder Than Ten Manual.

## Complement rule & licensing

- **Primary-skill deferral.** `extract-design-system` and `design-system-patterns` are the primary authorities for frontend / web design work. They own the *how*. This skill complements them by owning the *who/what/where* — real-world precedent and citation. When a recommendation from this skill conflicts with the primaries, follow the primaries.
- **Licensing.** "Source available" ≠ "license to use." Many of the 132 open-source entries are viewable but not permissively licensed. Always read `LICENSE` before copying code, tokens, or assets into a project.
- **Missing entries honesty.** If a user names a system not in the catalog (e.g., Airbnb DLS, Nike Connect, internal Uber Base v2), say so explicitly — do not guess a URL. Point them at `references/all-systems.md` or suggest searching the upstream repo for updates.

## Source & refresh

- Source of truth: https://github.com/alexpate/awesome-design-systems (Unlicense — effectively public domain)
- Refresh the upstream data:  `curl -s https://raw.githubusercontent.com/alexpate/awesome-design-systems/master/README.md -o awesome-design-systems-readme.md`
- Regenerate reference files: run `python3 tools/parse.py` then `python3 tools/build.py` from the repo root (parses the upstream README table, writes the 5 reference files under `skills/awesome-design-systems/references/`). Update the "captured" date above after regeneration.
