# TG Slicer — project handover

Single source of truth for TG Slicer. Read it fully before touching the
extension. Written for a fresh Claude Code session with no prior context.

**Reframed August 2026.** The output target moved from Duda to Travelgenix Sites,
our own CMS. The Duda emit path (the build-sheet emitter, the in-extension review
tab and the `api/slice-emit.js` endpoint) has been retired. See "What changed" at
the foot of this file.

## What TG Slicer is

A Chrome extension (Manifest V3) that captures any section off any live website
and hands it to **Travelgenix Sites**, our own CMS, where it becomes an editable,
on-brand section. It is an internal Travelgenix accelerator, not a public product
and not a slicer.dev competitor.

Slicer captures faithfully; the CMS turns the capture into content. The slicer's
whole job is now capture-and-hand-off. The "make it editable and on-brand" half
lives in the CMS import, which is the right home for it: native blocks, the
site's own theme tokens, and no drift on the client's words.

Owner: Andy Speight, CEO, Travelgenix. Repo: `andyspeight/tg-widgets` (the
extension is `tg-slicer/`; the CMS is `tg-sites/`, deployed as its own Vercel
project, editor at `tg-sites-shell.vercel.app`). Airtable project record: base
`appj9tksreHOwkhYg`, table `tblpyhPNhiQg3XkkT`, record `recnbueCv8al70eCb`.

## The loop: capture → Send to Sites → Import → blocks

1. **capture.js** (content-script world). `globalThis.TGSCapture.capture(rootElement)`
   returns `{ html, css, meta }`. It walks the selected subtree, snapshots
   meaningful computed styles (diffed against UA defaults read from a sandbox
   iframe), pulls @keyframes, absolutises asset URLs, and scopes everything to
   generated `.tgs-N` classes. `capture()` is **async** (it fetches external SVG
   sprites). It deliberately does NOT capture hover/focus states or @media rules;
   the CMS rebuilds responsive behaviour to the site's tokens.

2. **content.js** — the overlay, element locking (↑ parent, ↓ child, C to
   capture), and after a capture the action bar: **Send to Travelgenix Sites**
   (primary), plus **Copy HTML+CSS** and **Copy slice JSON** as fallbacks. Send
   writes the raw `{ html, css, title, ts }` to `chrome.storage.local` under
   `tgsOutbox`. No network, no secret.

3. **bridge.js** — a permanent content script that runs ONLY on the Sites editor
   domains (the `content_scripts.matches` allowlist in `manifest.json`; today
   `tg-sites-shell.vercel.app` and its aliases, plus localhost). It reads the
   outbox and hands each section to the open editor with `window.postMessage`.
   The editor's Import tab lists them, adds on one click, and posts back which
   were used so they clear from the outbox and are never offered twice.

4. **The CMS import** (`tg-sites/lib/import/`, `tg-sites/lib/ai/import-rebuild.ts`,
   `tg-sites/components/editor/ImportPanel.tsx`) turns a capture into content
   three ways, in order: the deterministic recogniser rebuilds it as **native
   blocks**; an AI fallback lays out unusual markup as blocks using the exact
   captured words and inventing nothing; anything else lands as a frozen but
   editable **imported section**, so an import is never rejected. This half is
   owned and tested on the CMS side (`tg-sites/tests/import*.test.ts`).

`background.js` (MV3 service worker) only injects `capture.js` + `content.js` on
demand now. `popup.html/js` is just the Start button. `overlay.css` styles the
overlay.

## What the capture engine handles (proven by fixtures)

- Framework reset borders (Tailwind-style `border:0 solid`). Phantom borders are
  suppressed so they do not reappear as visible boxes. Genuine borders are kept.
- External SVG sprite icons (`<use href="sprite.svg#id">`). Fetched same-origin
  at capture time and inlined so the icon travels with the section.
- CSS gradients (linear and radial), background images, box-shadows, glass and
  translucent borders, inline SVG, rounded avatars and object-fit, transforms
  (scale), absolute positioning (badges), nested grids, multiple button styles,
  form inputs (placeholder kept), big display type, dense footers.
- Link decoration (`text-decoration: none` preserved; genuinely underlined links
  stay underlined).
- Ancestor backgrounds: if a sliced section is transparent and its colour comes
  from a parent or the page, capture walks up and adopts the nearest real
  background so the section keeps its colour.
- Inter-element whitespace around inline tokens (e.g. `<b>£240</b> night` keeps
  the space).
- CSS-animated backgrounds (animated gradients, marquees, spins) carry through,
  because @keyframes and the animation property are captured.
- A readable 2D `<canvas>` gets a real still frame via `toDataURL`, guarded
  against the tainted-canvas error, used as the background image.

## Honest, permanent limits (explain these, do not try to "fix" them)

- Anything painted by JavaScript (a WebGL shader, a JS counter) cannot be lifted
  as CSS. A WebGL hero (e.g. a Stripe-style gradient) captures blank. The old
  Duda emitter used to stand in a pure-CSS gradient for it; that stand-in lived
  in the retired `emit-local.js` and is gone. If we want it back it belongs in
  the CMS import, seeded from the canvas's `--gradient-color-*` variables.
- Cross-origin SVG sprites on a different domain may not inline (same-origin do).
  Possible future improvement: route the sprite fetch via the background worker.
- Repeated items (cards) are captured as they stand. Grouping them into one
  editable list is the CMS import's job, not the slicer's.
- Hover and responsive states are not captured. The CMS rebuilds them.

## Definition of done (the loop, not a Duda build)

The capture engine is validated against 23 local fixtures. The living gate now is
the handoff working on real sites:

1. Extension loaded in Chrome (Load unpacked `tg-slicer/`).
2. Slice a real site, hit **Send to Travelgenix Sites**, and confirm it turns up
   in the editor's Import tab and adds as an editable section.
3. Capture fidelity holds on messy real pages (deep wrappers, late fonts, lazy
   images). Fix only real faults, do not polish speculatively.
4. The bridge's domain allowlist is current. When the editor gets its real domain
   (e.g. `sites.travelgenix.com`), add it to `content_scripts.matches` in
   `manifest.json` and reload the extension.

## How to run, test and build

**Capture-fidelity harness.** `test/run-smoke.mjs` launches headless Chromium
(Playwright), serves the fixtures from an in-process server (same-origin so
sprite fetch works), and for each fixture screenshots the original, runs the REAL
`capture.js`, reconstructs the captured slice on its own and screenshots it, then
writes automated signals to `test/smoke/report-<set>.json`. It no longer runs an
emit step; that moved into the CMS import.

```
npm install --prefix test          # Playwright, isolated from the Vercel deploy
test/node_modules/.bin/playwright install chromium
node test/run-smoke.mjs tg-slicer f     # sets: f (5 core), g (10), h (5), i (3 moving-bg)
```
Launch flags `--no-sandbox --disable-dev-shm-usage` are set for running as root.
`TGS_CHROMIUM=/path/to/chrome` points the harness at a pre-installed browser when
the Playwright CDN is blocked (unset on a normal machine). Do NOT background a
server with `&` from a tool call; the harness runs its own in-process.

**Build the extension.** Plain unpacked MV3, no build step. Load `tg-slicer/` via
`chrome://extensions` (Developer mode, Load unpacked or Reload). Bump
`manifest.json` version on each ship. The `tg-slicer/` folder has no
`node_modules` or `package*.json`, so there is nothing to exclude when zipping.

## Conventions and working style (important)

- Andy has memory challenges and relies on the assistant as an external brain.
  Restate context, anchor with dates, keep the project record current.
- Before substantive work, consult the relevant skills and open the reply with
  "Skills consulted: ...". Relevant here: tg-widget-suite, travelgenix-security,
  travelgenix-debug, project-handover, airtable-operations.
- Never rebuild from scratch, always upgrade existing code. If unsure, ask.
- Diagnose before patching. Evidence before hypothesis. Hard-stop after two
  failed fixes and rethink (the travelgenix-debug rule, and why the harness
  exists).
- Security: capture output is CSP-clean (no inline scripts or handlers), validate
  anything read off the page before rendering it, guard `toDataURL` against the
  tainted-canvas error. The capture ships no JavaScript into the CMS; the render
  tree there is no-JS by design too.
- Brand voice for any copy: warm, plain, UK English, no em dashes, no Oxford
  comma, no AI cliche.
- Keep the Airtable record `recnbueCv8al70eCb` updated at each milestone.

## Locked decisions (do not relitigate)

- Output is an editable section in Travelgenix Sites, reached by handing the raw
  capture to the CMS import. High-fidelity capture of the source (real colours,
  type, spacing, layout, shadows, images), not a restyle.
- The slicer captures; it does not emit or rebuild. Turning a capture into blocks
  is the CMS's job (deterministic recogniser, AI fallback, imported-section
  catch-all).
- No AI and no network in the slicer's default path. The capture is deterministic.
- Legitimate use: sites the user, client or prospect owns, or a well-known
  reference site used as a live throwaway demo. Do not build a permanent
  published clone of a third-party site.

## File manifest (current layout in the repo)

- `tg-slicer/` — the extension: `manifest.json`, `background.js`, `content.js`,
  `bridge.js`, `capture.js`, `overlay.css`, `popup.html/js`, plus `README.md`,
  `QUICK-START.md` and `SITES-HANDOFF.md`.
- `test/run-smoke.mjs` + `test/fixtures/` — the capture-fidelity harness and its
  23 fixtures (f1-5, g1-10, h1-5, i1-3) plus sprite.svg and images.
- `tg-sites/` — the CMS (its own Vercel project). The import that receives a
  capture lives in `tg-sites/lib/import/`, `tg-sites/lib/ai/import-rebuild.ts` and
  `tg-sites/components/editor/ImportPanel.tsx`.

## What changed (August 2026, Duda retirement)

- Removed: `tg-slicer/emit-local.js` (build-sheet emitter), `tg-slicer/review.*`
  (the in-extension review tab), `api/slice-emit.js` and its `vercel.json`
  function entry, the "Make Duda widget" button and the popup's endpoint/secret
  fields. Orphaned Vercel env vars to delete: `TGS_SHARED_SECRET`, `TGS_MODEL`,
  `TGS_MAX_TOKENS`, `TGS_ALLOWED_ORIGIN`. Keep `ANTHROPIC_API_KEY` (shared by
  many other endpoints).
- Consequence: the WebGL-canvas gradient stand-in went with `emit-local.js` (see
  limits above).
- Still to reframe separately: `api/screenshot-to-code.js` is a sibling
  accelerator whose planned "Stage 2" pointed at the retired `slice-emit`
  pipeline. It does not import it, so nothing is broken, but its roadmap should be
  re-pointed at the CMS import when someone picks it up.
