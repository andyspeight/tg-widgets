# TG Slicer — project handover for Claude Code

This file is the single source of truth for finishing TG Slicer. Read it fully
before doing anything. It is written for a fresh Claude Code session that has no
prior context.

## What TG Slicer is

A Chrome extension (Manifest V3) that captures any section off any live website
and turns it into a faithful, editable **Duda Custom Widget**. It is an internal
Travelgenix accelerator, not a public product and not a slicer.dev competitor.

Primary purpose: a **TravelTech Show demo** (24 to 25 June 2026, ExCeL London,
stand N60). The demo beat is: "what site do you love?" then slice one strong
section off it and turn it into an editable Duda section live, on the spot, with
no developer. The message is "we can match your vision and you own it."

Owner: Andy Speight, CEO, Travelgenix. Repo: `andyspeight/tg-widgets`
(https://tg-widgets.vercel.app). Airtable project record: base
`appj9tksreHOwkhYg`, table `tblpyhPNhiQg3XkkT`, record `recnbueCv8al70eCb`.

## Current status: v0.3.0, engine essentially DONE

The capture and rebuild engine is complete and heavily tested. Across 23 local
fixtures run through the real engine in headless Chromium, every one reproduces
faithfully with zero page errors. The remaining work is validation on real sites
plus Duda integration plus demo rehearsal. It is NOT more engine code.

Do not rebuild anything from scratch. Always iterate on the existing files.

## The architecture (three stages, no AI in the default path)

The faithful copy already exists at capture time, so there is no AI rewrite step
in the default path. That was a deliberate pivot away from an earlier AI-emit
approach that was slow and flaky (it failed three ways: MV3 CORS, JSON
truncation, Vercel timeout). The local emitter cannot time out, truncate or drift.

1. **capture.js** (runs in the content-script world). Exposes
   `globalThis.TGSCapture.capture(rootElement)` which returns `{ html, css, meta }`.
   It walks the selected subtree, snapshots meaningful computed styles (diffed
   against UA defaults read from a sandbox iframe), pulls @keyframes, absolutises
   asset URLs, and scopes everything to generated `.tgs-N` classes. `capture()`
   is **async** (it fetches external SVG sprites). It deliberately does NOT
   capture hover/focus states or @media rules (those are rebuilt in Duda).

2. **emit-local.js** (the default path). Exposes
   `globalThis.TGSEmit.buildSheet(slice)`. Parses the captured HTML, exposes each
   text node as a Text/Large Text input and each `<img>` as an Image input (the
   original content is the default), tokenising at text-node level with
   `{{textN}}` / `{{imageN}}` so inline structure stays intact. Emits the Duda
   build-sheet object the review UI renders. No network, no model.

3. **review.html / review.css / review.js** (inside the extension). Reads the
   build sheet from `chrome.storage.local`, shows an approximate preview, the
   input tables, the code, "Copy full build sheet", "Open full preview" (a
   full-width client-side render in a new tab) and "Download HTML".

Build-sheet shape returned by `buildSheet`:
`{ widgetName, classPrefix, description, contentInputs[], designInputs[], html,
cssDesktop, cssMobile, notes[], acceptanceTest[] }`. `cssDesktop` is the slice
CSS plus any animated-background CSS appended by the emitter.

Other files: `background.js` (MV3 service worker, routes any network call so the
secret never enters the page), `content.js` (overlay, element locking, the
"Capture" and "Make Duda widget" buttons; its `doCapture` awaits the async
capture), `popup.html/js`, `overlay.css`, `manifest.json`.

There is also an **optional, non-default** AI emit endpoint `api/slice-emit.js`
in the tg-widgets repo (maxDuration 300 in `vercel.json`, MAX_TOKENS 32000). It
is live at `https://widgets.travelify.io/api/slice-emit` (alias
`https://tg-widgets.vercel.app/api/slice-emit`). It is deployed and harmless and
is the basis for a future optional "AI smarten up" button. The default local
path needs no endpoint and no redeploy. The full endpoint, shared-secret and env
var reference is in `tg-slicer/AI-EMIT-ENDPOINT.md`.

## What the engine handles (all proven by fixtures)

- Framework reset borders (Tailwind-style `border:0 solid`). Phantom borders are
  suppressed so they do not reappear as visible boxes. Genuine borders are kept.
- External SVG sprite icons (`<use href="sprite.svg#id">`). Fetched same-origin
  at capture time and inlined so the icon travels with the widget.
- CSS gradients (linear and radial), background images, box-shadows, glass and
  translucent borders, inline SVG, rounded avatars and object-fit, transforms
  (scale), absolute positioning (badges), nested grids, multiple button styles,
  form inputs (placeholder kept), big display type, dense footers.
- Link decoration (`text-decoration: none` is preserved, links do not revert to
  underline; genuinely underlined links stay underlined).
- Ancestor backgrounds: if a sliced section is transparent and its colour comes
  from a parent or the page, capture walks up and adopts the nearest real
  background so the widget keeps its colour.
- Inter-element whitespace around inline tokens (e.g. `<b>£240</b> night` keeps
  the space).
- **Moving backgrounds (v0.3.0):**
  - CSS-animated backgrounds (animated gradients, marquees, spins) already carry
    through because @keyframes and the animation property are captured.
  - A readable 2D `<canvas>` gets a real still frame via `toDataURL` (guarded
    against the tainted-canvas error), used as the background image.
  - A WebGL `<canvas>` (e.g. Stripe's gradient) reads back blank, so the emitter
    stands in an editable pure-CSS animated gradient seeded from the canvas's own
    `--gradient-color-*` variables, exposed as editable Color design inputs. No
    JavaScript is injected (CSP-safe per the security rules).

## Honest, permanent limits (do not try to "fix" these, explain them instead)

- Anything painted by JavaScript (a WebGL shader, a JS counter) cannot be lifted
  as CSS. The animated-gradient stand-in is the answer for canvas heroes.
- Cross-origin SVG sprites on a different domain may not inline (same-origin do).
  Possible future improvement: route the sprite fetch via the background worker.
- Repeated items (cards) are exposed individually, not yet grouped into one
  `{{#each}}` list.
- Hover and responsive states are not captured. They are rebuilt in Duda.

## THE one open gate, and the definition of done

The engine is validated against fixtures. The only thing fixtures cannot
replicate is the mess of real live sites (deep wrappers, late web fonts, lazy
images, odd third-party markup). So the gate is a real-site validation pass that
only Andy can do (it needs real Chrome on real sites).

**Definition of done for the show:**
1. v0.3.0 loaded in Chrome.
2. Real-site validation passed: slice the Hays "Book with confidence" band plus
   two or three real travel sites plus one site with a moving/canvas hero, open
   the full preview, confirm fidelity. Fix only real faults found, do not polish
   speculatively.
3. One widget built into Duda Widget Builder end-to-end and confirmed editable
   (run the build sheet's `acceptanceTest`).
4. The demo flow rehearsed end to end.

Everything else is post-show. Resist the urge to keep tuning the engine.

## Remaining roadmap (ordered)

Required for the show:
1. Real-site validation pass (Andy, ~20 min). The gate.
2. Decide the Duda path: manual paste of the build sheet into Duda Widget Builder
   (fastest, good enough for the demo) versus Duda Partner API automation
   (programmatic widget creation, more work, post-show is fine).
3. Build one widget into Duda end-to-end and run the acceptance test.
4. Rehearse the demo.

Optional, post-show, in rough priority:
- Group repeated items into one editable list.
- Map the new `Color` and `Toggle` design inputs to real Duda widget controls.
- A richer minigl-style mesh gradient as a toggle (would add small first-party JS
  to the widget; the pure-CSS gradient is the safe default).
- Record-and-loop video background for exact canvas motion (hosted asset).
- Hover and interaction capture.
- Cross-origin sprite fetch via the background worker.

## How to run, test, build and deploy

**Test harness (the thing that stopped the going-in-circles).** `run-smoke.mjs`
launches headless Chromium (Playwright), serves the fixtures from an in-process
server (same-origin so sprite fetch works), and for each fixture screenshots the
original, runs the REAL `capture.js` plus `emit-local.js`, rebuilds the widget
and screenshots it, then writes automated signals to `smoke/report-<set>.json`.

Setup and run:
```
npm install playwright
npx playwright install chromium
node run-smoke.mjs <extension-folder> <fixture-prefix>   # e.g. node run-smoke.mjs tg-slicer f
```
Fixture sets: `f` (5 core), `g` (10 leading-site styles), `h` (5 big sections),
`i` (3 moving-background). It auto-discovers `f*/g*/h*/i*.html` in `fixtures/`.
Launch flags `--no-sandbox --disable-dev-shm-usage` are required when running as
root. Do NOT background a server with `&` from inside a tool call, it hangs the
call. The harness runs its own server in-process for this reason.

When you add a new capability, add a fixture that exercises it and re-run the
whole suite. Regressions show up immediately. This is how the engine got solid.

**Build the extension.** It is plain unpacked MV3, no build step. Zip the
extension folder only, excluding `node_modules` and `package*.json` (a leaked
`node_modules` has bitten the package twice):
```
cd <extension-folder> && rm -rf node_modules package*.json
zip -q -r ../tg-slicer-extension.zip . -x "*.DS_Store"
```
Load via `chrome://extensions` (Developer mode, Load unpacked or Reload). Bump
`manifest.json` version on each ship.

**Deploy (only relevant to the optional endpoint, not the default path).** Andy's
convention has been the GitHub web UI (no local CLI). In Claude Code you can and
should commit directly to `andyspeight/tg-widgets` instead, which removes the
upload friction. The extension source should be committed into the repo (it has
been living outside it). Env vars live in Vercel Settings (TGS_SHARED_SECRET,
ANTHROPIC_API_KEY set; optional TGS_MODEL, TGS_MAX_TOKENS default 32000,
TGS_ALLOWED_ORIGIN, UPSTASH_*). The default local emit path needs none of this.

## Conventions and working style (important)

- Andy has memory challenges and relies on the assistant as an external brain.
  Restate context, anchor with dates, keep the project record current.
- Before substantive work, consult the relevant SKILL.md files and open the reply
  with "Skills consulted: X, Y, Z". Relevant here: tg-widget-suite,
  travelgenix-security, travelgenix-debug, travelgenix-design, travelgenix-taste,
  project-handover, airtable-operations.
- Never rebuild from scratch, always upgrade existing code. If unsure, ask.
- Prefer complete replacement files over patches. Deliver each file individually,
  never a zip for files that go into GitHub via the web uploader (it cannot
  create nested folders). In Claude Code, commit directly instead.
- Diagnose before patching. Evidence before hypothesis. Hard-stop after two
  failed fixes and rethink (this is the travelgenix-debug rule, and it is why the
  harness exists).
- Security: widgets must be CSP-clean (no inline scripts or handlers), validate
  anything read off the page before rendering it, guard `toDataURL` against the
  tainted-canvas error. The animated background is pure CSS by design.
- Brand voice for any copy: warm, plain, UK English, no em dashes, no Oxford
  comma, no AI cliche.
- Keep the Airtable record `recnbueCv8al70eCb` updated at each milestone
  (Current Focus, Next Steps, Files Touched, Decisions, Open Questions).

## Locked decisions (do not relitigate)

- Output is an editable Duda Custom Widget. High-fidelity reproduction of the
  source (real colours, type, spacing, layout, shadows, images), not a restyle.
- Legitimate use: sites the user, client or prospect owns, or a well-known
  reference site used as a live throwaway demo. Do not build a permanent
  published clone of a third-party site.
- Default path is the deterministic local emitter, not AI. The AI endpoint is an
  optional extra, not the default.
- The animated-gradient stand-in for WebGL canvases is pure CSS and editable, no
  foreign JS shipped into client widgets.

## File manifest (what is in this bundle and where it goes)

- `tg-slicer/` — the v0.3.0 extension source, 13 files. Commit into the repo
  (suggested path `tg-slicer/` at the repo root, or wherever the team prefers).
- `test/run-smoke.mjs` — the Playwright harness.
- `test/fixtures/` — f1-5, g1-10, h1-5, i1-3 plus sprite.svg and the generated
  images. Same-origin assets so the harness can fetch sprites.
- `CLAUDE.md` — this file. Put it at the repo root so Claude Code auto-loads it.
- `proof/` — the before/after contact sheets for reference (not needed to build).

First thing to do in Claude Code: read this file, then run the harness once
(`node test/run-smoke.mjs tg-slicer i`) to confirm the environment works and the
moving-background cases pass, then help Andy through the real-site validation.
