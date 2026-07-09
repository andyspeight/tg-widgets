# TG Studio — project handover for Claude Code

Name: **TG Studio** (locked 2026-07-09). Started 2026-07-09. This is the single
source of truth for the standalone "capture a website and make it yours"
product. Read it fully before doing anything.

Decisions locked with Andy 2026-07-09: name is TG Studio; access is Ignite and
Bespoke only (Travelgenix staff bypass for demos); the AI refine loop is the
first feature after capture, and it is now in.

## What TG Studio is

A standalone Travelgenix product, hosted in the tg-widgets repo but NOT listed
on the widget dashboard. A user pastes a link, TG Studio loads the page in a
real browser, captures the section faithfully, and hands back an editable copy
they can refine and drop into their own site. It is our answer to Anima
(animaapp.com), narrowed hard to travel businesses.

It is the hosted home for a capture engine we already own. The TG Slicer Chrome
extension and the Screenshot to Code tool are the same family: three ways in
(a live URL, a picked element, an image), one place to finish.

- **Owner:** Andy Speight, CEO, Travelgenix.
- **Repo:** `andyspeight/tg-widgets` (https://tg-widgets.vercel.app).
- **Live routes:** `/studio` (the app). API under `/api/studio/*`.
- **Not on the dashboard:** it is a product in its own right, reached by its
  own URL, the same way `/screenshot-to-code` and `/brain` are.

## Why we are building it (the Anima read, 2026-07-09)

Anima started as a Figma to code plugin and is now a "build sites and apps with
AI" platform: a Figma plugin, an AI Playground (chat to build and edit, publish
in one click), a Clone Website feature (paste a URL, or a Chrome extension for
private pages), an API and SDK that power Bolt.new and Replit, an MCP server,
and Frontier (a design-system aware VSCode extension). Free tier is capped, Pro
from about 24 USD a month, Enterprise from about 500 USD a month.

The point that matters: Anima's hardest, most expensive component is the
capture-and-rebuild engine, and their Chrome extension "Web to Code" does
exactly what TG Slicer does. We already built and proved that engine (Slicer
v0.3.0, 23 fixtures, zero page errors). So we are not chasing Anima from behind.
We own the expensive 70 percent. The gap is a hosted front door, an AI edit
loop we have half-built, and travel-specific wiring only we can do.

We are NOT building a general design-to-code platform. That market (Anima, v0,
Lovable, Bolt, Builder, Figma Dev Mode) is crowded and well funded, and it is
not our market. The wedge is travel: a captured section that is already wired to
book, using our existing 40+ travel widgets and real availability data. Anima
gives a pretty static section. We can give a travel firm a pretty section that
sells.

## Locked decisions

- Standalone product in the tg-widgets repo, off the widget dashboard.
- High-fidelity faithful capture is the base layer. It is deterministic (the
  local emitter cannot time out, truncate or drift). AI is an OPTIONAL layer on
  top ("make it mine"), never the default. This mirrors the Slicer decision.
- Legitimate use only: sites the user owns, a client or prospect site with
  permission, or a well-known reference site as a live throwaway demo. Never a
  permanent published clone of a third party site. The UI says so and the emit
  prompt already assumes an owned rebuild.
- Reuse, never rebuild. Every capability below already exists somewhere in the
  repo. TG Studio wires them together, it does not re-implement them.

## Reuse map (we already own the hard parts)

| Need | Already in the repo |
|---|---|
| Capture a live section faithfully | `tg-slicer/capture.js` (`TGSCapture.capture`) |
| Turn a capture into editable inputs (deterministic) | `tg-slicer/emit-local.js` (`TGSEmit.buildSheet`) |
| Turn a capture into a Duda widget with AI | `api/slice-emit.js` (Stage 2, shared-secret gated) |
| Turn an image into a first-draft section | `api/screenshot-to-code.js` |
| Run a browser headless on Vercel | `api/booking-pdf.js` (`@sparticuz/chromium` + `puppeteer-core`) |
| Capture a URL end to end, headless | `test/run-smoke.mjs` (does URL to slice to emit today) |
| SSRF-safe URL handling | `api/_lib/webfetch.js` (`safeUrl`) |
| Auth, CORS, rate limit | `api/_auth.js` (`requireAuth`, `setCors`, `applyRateLimit`) |
| Standalone product page pattern | `public/screenshot-to-code.html` |
| Design tokens, light/dark | the `:root` token block reused across editors |

## What exists now (this scaffold, 2026-07-09)

- `public/studio.html` — the standalone front door. Paste a URL (optional CSS
  selector to narrow), Capture, faithful preview in a sandboxed iframe, a Code
  view, Copy code and Download HTML (both client-side). Refine with AI and Send
  to Duda are present but disabled, marked as next. Reuses the Screenshot to
  Code design system. `noindex`.
- `api/studio/capture.js` — POST `/api/studio/capture` `{ url, selector? }`.
  Auth required. Launches headless Chrome (same path as booking-pdf), navigates
  the URL, injects `capture.js` + `emit-local.js` and runs them in-page exactly
  as the smoke harness does, returns `{ slice:{html,css,meta}, buildSheet }`.
  SSRF-guarded by `safeUrl` plus request interception on every http(s) request.
  Tight per-user rate limit.
- `api/studio/_gate.js` — shared access gate. Ignite/Bespoke only, staff
  (Travelgenix domains) bypass. Plan resolved from the JWT or the Clients table,
  same as widget-config. Enforced server-side on every Studio endpoint.
- `api/studio/refine.js` — POST `/api/studio/refine` `{ html, css, instruction }`.
  The "make it mine" loop. Auth + gate + rate limit, sends the current section
  and one plain-language instruction to Claude, returns scrubbed `{ html, css }`
  to re-preview. Keeps images (owned rebuild). Distinct from slice-emit, which
  is the Duda export target.
- `public/studio.html` — capture, faithful preview, code view, copy, download,
  and the refine loop ("Make it yours": type a change, apply, re-preview, repeat).
- `vercel.json` — `/studio` rewrite, capture function config (memory 1024,
  maxDuration 60, `includeFiles` bundling chromium and the two engine files),
  refine function config (maxDuration 60), and `studio` in the security-header
  group.

This is a genuine v0: sign in (Ignite/Bespoke or staff), paste a public link,
get a faithful editable capture with a live preview, then refine it in plain
language as many times as you like. The export targets (Duda, save as widget)
and the travel wiring are the next builds.

## Architecture

Two ways in, one pipeline, several ways out.

- **In (a):** paste a URL. `/api/studio/capture` renders it headless and lifts
  the section. Public pages only. Good for the "wow, that is my site" moment.
- **In (b):** the TG Slicer extension. Picks a precise element, or a page behind
  a login (headless cannot log in). Posts the same slice shape into Studio. This
  is Anima's private-page differentiator, and we already have the extension.
- **Pipeline:** capture -> slice `{html, css, meta}` -> deterministic
  `buildSheet` (editable inputs, faithful defaults). Optional AI pass restyles,
  makes it responsive, restructures, or "makes it mine".
- **Out:** faithful HTML embed (today), a Duda Custom Widget build sheet (via
  slice-emit), a native tg-widget, or publish to a hosted Studio page later.

## Roadmap (ordered)

P1 done — the scaffold. URL capture to faithful preview, standalone page,
endpoint, routing.

P2 done — the AI refine loop (the Anima "Playground" moment). `api/studio/refine.js`
is a first-class authenticated endpoint (session cookie, no shared secret in the
browser). It sends the current section plus one instruction to Claude and returns
scrubbed html/css. The page wires a "Make it yours" box that applies changes and
re-previews, and the loop runs on the latest section each time. Still to polish:
a visible change history / undo, and a spinner in the preview during a refine.

P3 next — export targets. Send to Duda (feed the current section into
slice-emit for a build sheet, plus the Partner API path from the Slicer
handover), and "save as a tg-widget" so a capture becomes a first-class widget
in the suite.

P4 — travel wiring (the moat). Offer to drop our booking, availability, offers
and enquiry widgets into a captured section, so the output is not just pretty,
it sells. This is the piece Anima cannot copy.

P5 — productise. Optional: a Studio API and MCP server (the Anima "powers other
tools" play) if we want to be infrastructure for other builders. Later, and a
different business.

## Open decisions

1. **Name.** DECIDED 2026-07-09 — TG Studio.
2. **Who gets it.** DECIDED 2026-07-09 — Ignite and Bespoke only, staff bypass.
   Enforced in `_gate.js`. Still to decide: a monthly capture / refine cap per
   plan (today the only limit is the short-window rate limit), if we want one.
3. **Capture emphasis.** Lead with paste-a-URL (headless), the extension, or
   both equally. Both already exist. This is a marketing and onboarding call.
4. **Publish and hosting.** Do captures stay as embed snippets and Duda widgets,
   or do we host published Studio pages (which means storage, a page CRUD API
   and a public render route)? Bigger scope, decide before P3.

## Security notes

- The captured HTML and CSS is UNTRUSTED third-party data. It is previewed in a
  `sandbox` iframe with no scripts, and scrubbed before any AI or Duda step
  (slice-emit already scrubs). Never innerHTML raw capture into the app chrome.
- SSRF: `safeUrl` refuses non-http(s) and private, loopback, link-local and
  cloud-metadata hosts, and the endpoint re-checks every http(s) request the
  page makes so redirects and sub-resources cannot reach an internal host.
  Residual: a public domain that RESOLVES to a private IP (DNS rebinding) still
  passes the string check. Follow-up: block on the resolved IP, or run capture
  in an isolated egress-restricted context.
- Auth fails closed. Rate limit is always on in memory, with an optional Upstash
  daily ceiling like Screenshot to Code if we want one.

## How to run and test

- The capture engine is already proven headless: `node test/run-smoke.mjs
  tg-slicer i` runs URL-to-slice-to-emit in Chromium and is the reference for
  the endpoint. When you add a capture capability, add a fixture and re-run.
- The endpoint needs `@sparticuz/chromium` + `puppeteer-core` (already deps) and
  the two engine files bundled (the `includeFiles` glob in vercel.json). Verify
  the glob resolves on the first Vercel deploy of `main`; feature branches do
  not deploy.
- Front door: `/studio`. Sign in first (any Travelgenix session). Paste a public
  URL, press Capture, confirm the preview matches the source.

## Working style (important)

- Andy has memory challenges and relies on the assistant as an external brain.
  Restate context, anchor with dates, keep this doc and the Airtable record
  current.
- Never rebuild from scratch, always upgrade existing code. If unsure, ask.
- Diagnose before patching. Hard-stop after two failed fixes and rethink.
- Brand voice for any copy: warm, plain, UK English, no em dashes, no Oxford
  comma, no AI cliche.
- Living project state belongs in Airtable (base `appj9tksreHOwkhYg`, table
  `tblpyhPNhiQg3XkkT`, Projects). Create a TG Studio record once the name is
  locked, and update it each session.
