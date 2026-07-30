# tg-widgets — repo-wide conventions for Claude Code

Read this first in every session. It is the distilled version of the
Travelgenix working conventions (the claude.ai user skills are invisible to
Claude Code, so everything a session needs lives here or in `docs/`).

## What this repo is

The Travelgenix widget platform, deployed on Vercel at
`https://tg-widgets.vercel.app` (alias `https://widgets.travelify.io`).
Owner: Andy Speight, CEO, Travelgenix.

- `public/` — 40+ embeddable widgets (`widget-*.js`), their editors
  (`editor-*.html`), demo pages (`demo-*.html`), the client dashboard
  (`index.html`), the shared editor shell (`editor-shell.js/.css`,
  `editor-shell-template.html`) and the shared rule + trigger engine
  (`tgse-rules.js`: `evaluate` for visitor rules, `armTrigger` for event
  triggers — Smart Section uses it; Popup delegates to it when present).
- `api/` — Vercel serverless functions (widget config CRUD, auth, leads,
  email, the optional TG Slicer AI-emit endpoint).
- `tg-slicer/` — the TG Slicer Chrome extension (see its handover below).
- `test/` — the TG Slicer Playwright harness and fixtures.
- `tests/` — plain-Node widget test suites (`.cjs`, because this repo is
  `type: module`).
- `docs/` — project handovers and setup guides.

## Project handovers (living docs — read the one you are working on)

- **TG Slicer**: `docs/tg-slicer-handover.md` (moved verbatim from the old
  CLAUDE.md; Airtable record `recnbueCv8al70eCb`).
- **Smart Section**: `docs/smart-section-handover.md` (Airtable record
  `recCKQZ4ucnuef2Ii`).
- **Email Signature**: `docs/email-signature-handover.md` (Airtable record
  `recYKgvuON4dFQWfa`).

Living project state lives in Airtable: base `appj9tksreHOwkhYg`, table
`tblpyhPNhiQg3XkkT` (Projects). Read the record at the start of a session that
resumes a project and update it at the end (Current Focus, Next Steps, Last
Session Summary, Decisions Locked, Files Touched, Blockers).

## Working style (important)

- Andy has memory challenges and relies on the assistant as an external
  brain. Restate context, anchor with dates, keep the Airtable record current.
- Never rebuild from scratch, always upgrade existing code. If unsure, ask.
- Diagnose before patching. Evidence before hypothesis. Hard-stop after two
  failed fixes and rethink.
- Brand voice for any copy: warm, plain, UK English, no em dashes, no Oxford
  comma, no AI cliche.
- Commit directly to the repo from Claude Code (Andy's old flow was the
  GitHub web UI; direct commits remove that friction). Vercel deploys `main`
  automatically.

## Widget suite conventions

**Offers are cache-only.** A visitor's browser must NEVER trigger a Travelify
search. Every offer widget reads `GET /api/cached-offers` and nothing else; the
cache is filled on our own schedule by `api/cron/refresh-map-offers.js`, which
is the only thing that may call `/api/offers`. The one live search left in the
product is the one Travelify runs when a visitor CLICKS an offer. Do not add a
"just fall back to live if the cache is empty" path — that is the exact
behaviour removed on 30 Jul 2026, when it was costing ~4,000 searches a week
and starving the cache it was supposed to be a safety net for. An empty cache
answer means the calm empty state, not a live search. Guarded by
`npm run test:offers-cache-only`.

**Embed contract.** Every widget is a container div plus one script:
`<div data-tg-widget="<tag>" data-tg-id="tgw_...">` +
`<script src="<origin>/widget-<tag>.js" defer>`. Optional
`data-tg-config` (inline JSON) skips the remote fetch. Config is fetched from
`GET /api/widget-config?id=...` — public, CDN-cached, response shape
`{ config, name, ...config }`.

**Widget files** (`public/widget-*.js`): JSDoc header with version and usage,
IIFE + `'use strict'`, a `VERSION` constant (authoritative over the header),
`resolveApiBase()` honouring `window.__TG_WIDGET_API__` then the script's own
origin (the script runs on customer sites — never rely on a relative `/api`
path), auto-init on `[data-tg-widget="<tag>"]` with a double-init guard,
globals `window.TG<Name>Widget` + `window.__TG_<NAME>_VERSION__`. Widgets use
Shadow DOM with `:host{all:initial}` — the ONE deliberate exception is Smart
Section, which wraps light-DOM user content. Storage keys are prefixed
(popup `tgp_`, rule engine `tgsr_`), JSON-encoded, try/catch-safe.

**Render must not grab the host page.** A widget's render/`update()` path must
be side-effect-free for the page: never call `.focus()`, `.select()` or
`scrollIntoView()` (nor autofocus) as part of drawing itself. Those belong ONLY
to a real user action — a click, a genuine step change, a submit. Why: an editor
preview calls the widget's `update()` on EVERY keystroke, so a focus/scroll on
render steals the cursor out of the field the agent is typing into (forcing a
re-click per letter) and yanks a visitor's page to the widget on load. When you
DO need to move focus/scroll on a real navigation, gate it on the state actually
changing (e.g. the new step index differing from the last), and skip it on the
first mount and on passive re-renders. (The Enquiry / Enquiry Pro bug, 23 Jul
2026 — a step heading was focused on every `_renderStep`.)

**Editor pages** (`public/editor-*.html`) follow the shell contract
(`editor-shell.js` v1.2, spec in `/editor-shell-spec.md`, skeleton in
`editor-shell-template.html`):

- Boot ONLY through `tgse.onReady(...)` — never call `tgse.isLoggedIn()`
  synchronously at load (async cookie SSO check; sync calls cause a
  blank-page race).
- The shell owns tabs (`.tgse-tabs button[data-tab]` + `aria-selected`,
  panels `.tgse-panel[data-tab]` + `is-active`), accordions
  (`.tgse-section`/`-head`/`-body`/`is-open`), viewport buttons, save
  (`#btn-save`, `#save-label`, `#name-input`), embed modal (`#btn-embed`),
  toasts and keyboard shortcuts. Do not re-wire any of it.
- Never set manual auth headers. The shell's `doSave` handles auth, and a
  global fetch interceptor adds `credentials:'include'` to same-origin
  `/api/*` calls. Use `tgse.authHeaders()` if a custom call ever needs it.
- Script order: `/editor-shell.js` first, then the widget script (omit it for
  static or iframe previews), then tour files, then the per-editor script.
- `tgse.init({ widgetType, widgetTag, scriptFile, getConfig, setConfig, ... })`
  — `widgetType` must match the Airtable WidgetType option exactly.

**Plan tiers.** Exactly four, Title Case: `Spark`, `Boost`, `Ignite`,
`Bespoke`. In limit maps: `-1` unlimited, `0` locked, positive = max count.

**Adding a new widget type — update FIVE places** (also documented at the top
of `api/widget-config.js`):
1. `ALLOWED_WIDGET_TYPES` in `api/widget-config.js`
2. `PLAN_WIDGET_LIMITS` in `api/widget-config.js` (keep in sync with the
   registry's `access` field)
3. The WidgetType singleSelect options in Airtable (manual — the API rejects
   unknown options)
4. The `WIDGETS` array in `public/index.html` (registry entry + a
   `loadMiniPreview` branch: live widgets instantiate the engine and get a
   script tag at the bottom of index.html; static previews write a 700×340
   fake-webpage mockup into `innerHTML` and get NO dashboard script tag)
5. A record in the Airtable CATALOGUE table

Plus `vercel.json`: a `/demo-<tag>` and `/editor-<tag>` rewrite and one header
block per public script file (copy the `/widget-hours.js` block).

## Security rules

- Widgets must be CSP-clean: no inline event handlers, no injected `<script>`,
  no eval, no Function constructor. Injected UI uses inline styles.
- Validate and sanitise anything read off the page or the network before
  rendering (esc() text, whitelist colours/URLs, clamp numbers). Never put
  config strings through `innerHTML`.
- Server side: `sanitiseForFormula` before Airtable formulas,
  `sanitiseConfig` before persistence, ownership checks fail closed.
- Widget availability gating is enforced at save time on the API, never
  trusted to the client.

## Testing

- Widget suites: `tests/*.cjs` (plain Node; jsdom is a devDependency for DOM
  integration tests). Smart Section: `npm run test:smartsection` (27 unit +
  12 integration + 10 AI-validator + 12 trigger).
- TG Slicer: `node test/run-smoke.mjs tg-slicer <fixture-prefix>` (Playwright;
  see the slicer handover for setup).
- When you add a capability, add a test that exercises it and re-run the
  whole suite. Regressions show up immediately.
