# OpenHarneks

A provider-agnostic AI chat workspace. Bring any API — OpenAI, Anthropic, Gemini,
OpenRouter, Groq, Mistral, DeepSeek, xAI, Together, a local Ollama, or your own gateway —
add a key, and start chatting. You can also let visitors use models the site owner
provides, through accounts and an admin panel, with optional quotas and usage stats.

> **Your chats stay in your browser.** Conversations, prompts, attachments and replies are
> stored only in IndexedDB on this device. Personal (BYOK) keys are encrypted with AES-GCM
> and never leave it. When you use the site's own models, only the request goes through the
> site server, and only usage *metadata* (model, token counts, status, time) is recorded.

Accounts, site-provided models and the admin panel are optional and require a Supabase
project plus a few server environment variables. Without them the app still works as a
purely local BYOK client. Setup: **[docs/SETUP.fa.md](docs/SETUP.fa.md)**.

---

## Feature tour

**Providers**
- 10 built-in presets plus custom OpenAI-shaped and fully custom JSON APIs.
- Automatic format detection: probes `/models` in order (OpenAI → Anthropic → Gemini),
  tries versioned/root variants, shows every probe live, and reports why it failed.
- Drag-and-drop or paste a base URL, preflight it, then import models with pricing,
  context windows, and inferred capabilities.
- Per-provider auth header/prefix, extra headers, timeout, paths, icon and colour.
- Manual "ping" per provider/model plus optional background health checks.
- Browser CORS-blocked? Route a provider through a self-hosted Cloudflare Worker.

**Chat**
- Streaming responses (SSE and NDJSON), reasoning/thinking deltas, stop and retry.
- Branching conversation tree: regenerate or edit any message, then move between
  sibling branches without losing the others.
- Markdown + GFM + KaTeX, sanitised HTML, syntax highlighting with Shiki, copy buttons.
- Token/context estimate, per-chat system prompt and parameter overrides.
- Attachments: images, PDFs (text extraction), text/code files, and video (native where
  supported, otherwise in-browser frame extraction).
- Voice dictation via the Web Speech API.
- Code-aware preview panel: extract fenced project files, preview HTML/CSS/JS in a
  sandboxed iframe, browse versions, and download everything as a ZIP.
- Chat search, command palette, pinned chats, markdown/JSON export.

**Workspace**
- Dark-first design with a light theme, a WebGL liquid-gradient background, Persian/English
  UI, and automatic RTL.
- Mobile-first layout with a sheet-based sidebar and preview panel.
- Keyboard-first navigation and accessible Radix primitives.
- Settings import/export; optional passphrase vault; erase-all-data control.

**Accounts and site models (optional)**
- Email + password accounts backed by Supabase Auth, with blocked/active status and
  server-enforced daily/monthly token quotas.
- Site-provided models appear in the chat model picker next to your own; keys are held
  server-side, encrypted at rest, and rotated automatically when one fails.
- Admin panel at `/admin` (standalone page, password-gated, never linked from the public
  site): providers, multiple keys with health/cooldown, real connection and per-model tests,
  model enable/rename, users, usage charts and sign-up settings.
- Catalog changes broadcast to every online user within seconds.

---

## Stack

| Layer | Choice |
| --- | --- |
| Build | Vite 6, TypeScript 5.7 (strict), React 18.3 |
| Styling | Tailwind CSS v4, hand-written shadcn-style Radix primitives |
| State | Zustand (in-memory UI state) |
| Persistence | Dexie / IndexedDB |
| Motion / icons | framer-motion, lucide-react, `@lobehub/icons` |
| Markdown | react-markdown, remark-gfm, remark-math, rehype-katex, rehype-sanitize |
| Code | Shiki, JSZip, file-saver |
| Media | pdfjs-dist, Web Speech API |
| Crypto | Web Crypto (AES-GCM 256, PBKDF2-SHA-256) |
| Tests | Vitest (157 unit tests) |

React is pinned to 18.3 because the app targets stable Radix/React 18 behaviour.
`@lobehub/icons` declares React 19 peers, so `.npmrc` sets `legacy-peer-deps=true`;
the runtime works with React 18.

---

## Quick start

Requirements: **Node 20+** and npm 10+.

```bash
npm install
npm run dev          # http://localhost:5173
```

Production build and local preview:

```bash
npm run build        # tsc -b && vite build → dist/
npm run preview      # serves dist/
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | Type-check the app, then build to `dist/` |
| `npm run preview` | Preview the production build |
| `npm run typecheck` | `tsc -b --noEmit` |
| `npm test` | Run the Vitest suite once |
| `npm run test:watch` | Watch mode |

### First run

1. Open **Providers → Add provider**.
2. Pick a preset (or paste any base URL and press **Detect**).
3. Add the API key. It is encrypted before it is written to IndexedDB.
4. Choose/import the models you want, then **Save**.
5. Press `Ctrl/⌘ K` to search, `Ctrl/⌘ M` to pick a model, `Ctrl/⌘ /` to focus the composer.

The app starts empty by design: no fake providers, keys, models, or conversations.

---

## Providers and formats

Supported wire formats:

- **OpenAI-compatible** — `POST {base}/chat/completions`, `GET {base}/models`.
- **Anthropic Messages** — `POST {base}/messages`, `x-api-key`, `anthropic-version`.
  The browser-access header is added automatically for direct calls.
- **Google Gemini** — `POST {base}/models/{model}:streamGenerateContent?alt=sse`.
- **Custom template** — your endpoint, headers, JSON body template, and JSON paths.

Base URLs are normalised before use: missing protocol, trailing slashes, duplicated
version segments, pasted `/chat/completions`, query strings, and hashes are handled.
`localhost`, `127.0.0.1`, and private ranges default to `http://`; everything else to
`https://`.

### Custom templates

Templates receive JSON-encoded values for:

`{{model}}`, `{{messages}}`, `{{temperature}}`, `{{top_p}}`, `{{max_tokens}}`, `{{stream}}`

Example:

```json
{
  "model": {{model}},
  "messages": {{messages}},
  "temperature": {{temperature}},
  "max_tokens": {{max_tokens}},
  "stream": {{stream}}
}
```

Then set the response paths (for example `reply`, `choices[0].delta.content`) and the
stream mode (`sse`, `ndjson`, or non-streaming `json`).

---

## Local data and security

- **Where data lives:** one IndexedDB database named `apiset-pro` (providers, models,
  chats, messages, attachments, pings, project versions, secrets, settings).
- **Key storage:** API keys are encrypted with AES-GCM. Two vault modes:
  - **Device key** — a non-extractable AES key stored in IndexedDB; convenient, still
    protects against casual inspection of stored rows.
  - **Passphrase** — a PBKDF2-SHA-256 key (250,000 iterations, per-vault salt) that is
    never persisted. The vault is locked on every reload until you enter it.
- **In memory:** plaintext keys exist only while unlocked and are sent only to the
  provider you configured (or to your proxy if enabled). Site models are different: the
  browser sends only the model id and messages to `/api/chat`, and the server adds a key
  it holds.
- **No analytics, no remote logging.** Without accounts, every network call is a provider
  call you initiate. With accounts enabled, the app also talks to your Supabase project
  (auth, catalog, usage metadata) and to this site's own `/api/*` routes.
- **Sanitisation:** assistant/user markdown is rendered through `rehype-sanitize`; raw
  HTML is not trusted.
- **Threat model:** this is a browser app. A malicious extension or a same-origin XSS
  can still act with your session while the vault is unlocked. Use the passphrase vault,
  keep the app self-hosted, and lock it when you walk away.

### Settings export

**Settings → Data → Export** writes a versioned JSON file. Keys are excluded unless you
explicitly tick *Include API keys (not recommended)*. **Erase all local data** deletes
the entire IndexedDB database and reloads.

---

## Accounts, site models and admin panel

Everything here is optional: the app runs as a local BYOK client with no configuration.
Full step-by-step setup (Persian): **[docs/SETUP.fa.md](docs/SETUP.fa.md)**.

What the server adds, under `functions/api` (Cloudflare Pages Functions):

| Route | Purpose |
| --- | --- |
| `POST /api/auth/signup`, `/api/auth/login`, `/api/auth/logout` | Rate-limited wrappers around Supabase Auth, with a server-side "sign-up open" switch |
| `GET /api/config` | Whether accounts are configured and whether sign-up is open |
| `GET /api/session` | Current profile + server-resolved role |
| `GET /api/models` | Enabled catalog models only (no base URLs, no key material) |
| `POST /api/chat` | Authenticated, quota-checked, validated streaming proxy for site models |
| `/api/admin/*` | Providers, keys, tests, models, users, usage, settings (admin only) |

Security properties:

- **Keys never reach the browser.** Provider keys are stored as AES-256-GCM ciphertext and
  decrypted only inside the server request that needs them. Admin responses expose key
  counts and health, never key material.
- **Role comes from the server.** `ADMIN_EMAILS` and `profiles.role` are evaluated on every
  admin request; a client-side flag is never trusted.
- **`/admin` has its own password gate.** The page is separate from the public app, never
  linked from it, and `POST /api/admin/login` returns an 8-hour HMAC-signed token (kept in
  `sessionStorage`). Login attempts are rate-limited per IP; the password is only read from
  `ADMIN_PASSWORD` on the server.
- **RLS blocks cross-user access.** A user can read only their own profile and usage rows.
  Admin tables have no policies for the browser roles at all.
- **Admin base URLs are validated:** HTTPS only, no credentials, no private/loopback
  hosts, redirects followed manually and re-checked at every hop.
- **Rate limits** on sign-up, login and chat; email confirmation (or Turnstile) is the
  recommended defence against bulk sign-up.
- **Usage metadata only.** Stored: user, model, provider, input/output tokens, status,
  latency, timestamp. Never stored: message text or attachments. Server logs contain the
  key index and a reason, never the key.

Set at minimum `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`ADMIN_PASSWORD`, `MASTER_ENCRYPTION_KEY`, plus the public `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` at build time. `ADMIN_EMAILS` is optional and only enables the
Supabase-account admin door. See `.env.example` for the annotated list.

Until those values exist, `npm run dev` serves `/admin` in **local preview mode**: after
the password prompt, the panel is fully clickable with sample providers, users, usage and
settings that live in `localStorage`, and a banner says so. No real key is involved. The
preview is dev-only (compiled out of `vite build`) and disables itself once the two
`VITE_SUPABASE_*` values are set — after that `/admin` uses the real database.
"Exit preview" clears the saved sample data.

---

## Deploy to Cloudflare Pages

The static app works with no environment variables, but the server routes need them:

- Accounts, site models and the admin panel need the Supabase values plus
  `ADMIN_EMAILS` and `MASTER_ENCRYPTION_KEY` — see
  [docs/SETUP.fa.md](docs/SETUP.fa.md) and `.env.example`.
- `/api/coarena/*` needs `COARENA_KEYS` (server-only, never `VITE_*`).
- `/api/proxy` is **disabled with HTTP 503 on any non-localhost deployment unless
  `PROXY_TOKEN` is set**. This is deliberate: an unauthenticated open proxy is an
  abuse vector. Set `PROXY_TOKEN` before exposing the proxy in production.

Copy `.env.example` to `.env` for local development, and add the same names under
**Cloudflare Pages → Settings → Environment variables** for production. `.env*` is
git-ignored; only `.env.example` (names, no values) is committed.

1. Push this directory to a Git repository.
2. In Cloudflare **Pages → Create project**, connect the repository.
3. Framework preset: **None** (or Vite). Build command: `npm run build`.
   Build output directory: `dist`.
4. Optional but recommended: set `NODE_VERSION=20` in build environment variables.
5. Deploy.

`public/_redirects` already contains the SPA fallback:

```text
/*    /index.html   200
```

So deep links such as `/providers` always load the app instead of a 404.

You can also deploy from the CLI:

```bash
npm run build
npx wrangler pages deploy dist --project-name apiset-pro
```

---

## Optional CORS proxy worker

Many providers do not send `Access-Control-Allow-Origin` for browser requests. The
included `worker/proxy.ts` is a minimal streaming-safe proxy with an allowlist.

```bash
npx wrangler login
npx wrangler deploy --config worker/wrangler.toml
```

Then set the worker's variables in **Cloudflare → Workers → Settings → Variables**:

| Variable | Example | Purpose |
| --- | --- | --- |
| `ALLOWED_HOSTS` | `api.openai.com,api.anthropic.com,*.openrouter.ai` | Comma-separated suffix/glob allowlist. If unset, any public host is allowed but private/loopback targets are blocked. Set this in production. |
| `ALLOWED_ORIGIN` | `https://apiset-pro.pages.dev` | Comma-separated CORS allowlist. There is no wildcard fallback when the variable is set. |
| `PROXY_TOKEN` | long random string | Shared secret, sent **only** as the `x-proxy-token` header. Query-string tokens are ignored. Without it, non-localhost requests get 503. |

In the app open **Settings → Network → Proxy URL** and paste the worker URL, for
example:

```text
https://apiset-pro.<your-subdomain>.workers.dev
```

The app appends `?url=<encoded target>`. The proxy token must be configured in the
worker environment, not the URL.

Worker behaviour:

- Forwards method, body, auth headers, and streams the upstream response unchanged.
- Drops cookies, origin, referer, forwarding headers, and hop-by-hop headers.
- Answers `OPTIONS` for CORS preflight.
- Allows `http://` targets only when the host is explicitly allowlisted.
- Rejects credentials embedded in the target URL.
- Follows redirects **manually** (max 3). Every redirect target is re-checked
  against `ALLOWED_HOSTS`, the private/loopback blocklist and the scheme rule, so a
  public host cannot bounce the worker into internal network space (SSRF). Auth
  headers are dropped when a redirect crosses to another host.

**Trust warning:** the worker sees the `Authorization` header while forwarding. Host it
yourself, restrict `ALLOWED_HOSTS`, and keep the token private. If a provider supports
CORS directly (Ollama with `OLLAMA_ORIGINS=*`, some gateways), prefer a direct call.

### Rate limiting

`functions/api/security.ts` applies a small sliding-window limiter per caller. On
Cloudflare only `cf-connecting-ip` is trusted; `x-real-ip` and similar client headers
are spoofable and are ignored. When the header is absent all callers share one fixed
bucket.

The limiter lives in isolate memory, so it is per-colo and resets when an isolate is
recycled. That is enough as a cheap abuse guard in front of provider quotas. For a hard
global limit, either:

- add a **Cloudflare WAF Rate Limiting rule** for `/api/proxy` and `/api/coarena/*`, or
- back `rateLimit()` with a Durable Object or a KV counter keyed by `clientIp()`.

### Coarena keys

`COARENA_KEYS` is a comma/semicolon/newline separated list read only on the server.
The browser never sees a key: it calls `/api/coarena/chat`, `/api/coarena/models` and
`/api/coarena/status`, and the handler rotates keys on `401/402/403/429`, quota text,
`5xx` and timeouts, replaying the same request silently. Logs contain only the key
index and a reason, never the key value. `/api/coarena/status` returns counts only.

---

## Adding a provider

At runtime: **Providers → Add provider → Custom**, then fill in name, base URL, format,
auth header, and paths. Use **Detect** to discover the format and models.

To add a built-in preset, edit `src/data/presets.ts`:

```ts
{
  id: "my-gateway",
  name: "My Gateway",
  baseUrl: "https://gateway.example.com/v1",
  apiFormat: "openai",
  auth: { header: "Authorization", prefix: "Bearer " },
  icon: "openai",        // brand key or data URL
  color: "#5a45f2",
  extraHeaders: {},
  models: ["my-model"],
  notes: "Internal gateway.",
}
```

Presets appear in the provider wizard immediately. To support a provider whose API
shape is not OpenAI/Anthropic/Gemini, choose **Custom** instead of changing client code.

---

## Extending the model registry

`src/data/models.json` is the curated tier/capability registry. Entries are matched
case-insensitively as substrings of the model id; when several match, the longest
`match` wins.

```json
{
  "match": "gpt-5",
  "tier": "paid",
  "context": 400000,
  "capabilities": ["text", "vision", "tools", "reasoning"],
  "pricing": { "prompt": 1.25, "completion": 10 }
}
```

- `pricing` is USD per **1 million** tokens.
- `capabilities` accepts `text`, `vision`, `video`, `audio`, `tools`, `reasoning`.
- `tier` is `free`, `paid`, or `unknown`.

Tier resolution order (first match wins):

1. User override on the model.
2. Provider metadata pricing (zero pricing → free).
3. Curated registry entry.
4. Hard evidence (`:free` suffix, local provider).
5. `unknown` — the app never guesses "free".

Add an entry, then reload; no schema migration is needed. Imported provider models keep
their own metadata, so the registry mainly fills gaps and supplies curated pricing.

---

## Project layout

```text
apiset-pro/
├─ public/                 favicon, sprite, _redirects (SPA fallback), _headers (CSP)
├─ functions/api/          Cloudflare Pages Functions (auth, session, models, chat,
│                          admin, coarena, proxy) + shared `_lib`
├─ supabase/migrations/    SQL schema, RLS policies, aggregates, triggers
├─ docs/                   SETUP.fa.md (accounts, site models, admin panel)
├─ src/
│  ├─ app/                 App shell, chat view, error boundary
│  ├─ components/          shared UI + shadcn-style Radix primitives
│  ├─ data/                provider presets, curated models.json
│  ├─ db/                  Dexie schema, vault lifecycle
│  ├─ features/            chat, providers, models, layout, settings, auth, admin
│  ├─ lib/                 HTTP/SSE, detection, normalisation, crypto, server chat
│  │                       client, Supabase client, token estimate, media, export
│  ├─ stores/              Zustand stores (including auth and catalog)
│  ├─ App.tsx, main.tsx, index.css
├─ tests/                  Vitest unit tests
├─ worker/                 Cloudflare Worker CORS proxy + wrangler.toml
├─ vite.config.ts
└─ README.md
```

State model: Dexie is the source of truth for chats; Zustand holds UI/session state.
Streaming deltas live in memory and are persisted once when a response completes. The
server catalog is cached briefly in `localStorage` and refreshed on realtime broadcast,
on tab focus, and by a 60-second poll.

---

## Testing

```bash
npm test
```

Coverage focuses on logic that is easy to regress:

- SSE decoding across chunk boundaries, CRLF, multi-line data, comments, flush.
- OpenAI, Anthropic, Gemini, and custom delta parsers.
- Base URL normalisation and URL joining.
- HTTP status/error classification, proxy URL building, key redaction.
- Detection probe order, headers, proxy routing, and failure diagnoses.
- Conversation branching (`buildThread`, siblings, deepest leaf).
- Token estimates, formatting, titles, RTL detection, date buckets.
- Request body construction for all four formats, model list parsing, text extraction.
- AES-GCM key encryption/decryption (including tamper and wrong-master rejection).
- Provider key rotation, cooldown, and health summaries.
- Admin role resolution (token, `ADMIN_EMAILS`, blocked users).
- Provider base-URL validation and SSRF-safe redirect handling.
- Quota calculation and usage recording (metadata only).
- Server chat request validation and clamping.

Type-check and production build are separate gates:

```bash
npm run typecheck && npm run build
```

---

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl/⌘ K` | Search chats |
| `Ctrl/⌘ ⇧ O` | New chat |
| `Ctrl/⌘ /` | Focus the composer |
| `Ctrl/⌘ M` | Model picker |
| `Ctrl/⌘ B` | Toggle sidebar |
| `Ctrl/⌘ ⇧ P` | Toggle preview panel |
| `Enter` | Send |
| `Shift + Enter` | New line |
| `Esc` | Close the active dialog |

---

## Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| `Failed to fetch` / CORS | Enable a proxy for that provider (Settings → Network) or use a CORS-friendly endpoint. |
| `401 / 403` | Wrong key, wrong auth header, missing organisation/project header, or key lacks model access. |
| `404` on chat | Wrong base URL path. Check `/v1`, `/v1beta`, or a provider-specific path override. |
| Empty response | Model returned no text (reasoning-only, safety stop, or tool call the app does not execute). Retry or switch models. |
| Models detected but chat fails | The models endpoint and chat endpoint can differ; set the chat path override. |
| Attachments rejected | The selected model has no vision/video capability. Pick a capable model or remove the file. |
| Scanned PDF returns nothing | Text extraction only; OCR is not included. |
| Voice button disabled | The browser lacks the Web Speech API (notably Firefox) or microphone permission was denied. |
| Vault locked after reload | Passphrase mode is intentional. Enter the passphrase or remove it in Settings → Security. |
| `QuotaExceededError` | IndexedDB storage is full. Delete chats/attachments or export and reset. |

---

## Known limitations

- **No chat sync.** Conversations are per browser profile even when you sign in; clearing
  site data deletes them. Use settings/chat export for backups. Accounts sync only
  identity, quotas and catalog, not chats.
- **Dev admin preview is not a login.** On `npm run dev` without Supabase values,
  `/admin` renders the panel with sample data so the UI can be reviewed. It is compiled
  out of production builds, and it turns itself off as soon as `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_ANON_KEY` are set.
- **CORS is a browser constraint.** The app cannot bypass it without your own proxy.
- **Token counts are estimates.** No provider tokenizer is bundled; counts are for
  context-budget guidance, not billing.
- **Tools/function calling are not executed.** Models with tool capability are labelled,
  but the app does not run tool calls.
- **Code preview is client-side only.** HTML/CSS/JS works in a sandboxed iframe; there
  is no Node runtime, bundler, or `npm install`.
- **Media support depends on the provider/model.** Video is sent natively only where the
  format supports it; otherwise frames are extracted as images. PDFs are text-only.
- **Voice depends on the browser.** Chrome/Edge/Safari coverage varies; Firefox lacks the
  API.
- **Large attachments live in IndexedDB.** Very large videos/images can hit quota limits.
- **Bundle size.** Markdown, Shiki, KaTeX, and PDF.js are the heavy parts; code
  highlighting, PDF parsing, the admin panel and the account dialog are loaded lazily.
  The entry chunk is still roughly 1.3 MB uncompressed.
- **Curated metadata ages.** Pricing/context windows in `models.json` are snapshots;
  override them per model when they drift.
- **Reasoning support is best-effort.** Providers expose thinking under different keys;
  common shapes are handled, exotic ones may only show as normal text.
- **No OAuth flows.** Providers requiring interactive OAuth (rather than an API key) are
  out of scope.

---

## License

No license file is included. Treat this as a private project until you add one.
