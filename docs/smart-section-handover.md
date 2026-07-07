# Smart Section — project handover

This is the living handover for the Smart Section widget. Read it together with
the repo-wide conventions in `CLAUDE.md`. The Airtable project record is base
`appj9tksreHOwkhYg`, table `tblpyhPNhiQg3XkkT`, record `recCKQZ4ucnuef2Ii` —
keep it updated at each milestone.

## What Smart Section is

A wrapper widget that shows different content to different visitors without a
developer. The client wraps any section of their site (a banner, an offer, a
whole section, even other TG widgets) in a Smart Section and sets the rules:
new or returning visitors, time of day, day of week, device, campaign source
(UTM or referrer), or exit intent. Optional dismiss button, per-visitor
frequency cap, and a debug badge while testing.

Positioning: premium only. Ignite and Bespoke unlimited, Spark and Boost locked
(no teaser tier on Boost). The upsell story is "show different content to
different visitors without a developer".

## Architecture (two scripts, engine at shell level)

1. **`public/tgse-rules.js`** — the rule engine. Deliberately a separate,
   shell-level script so it can be REUSED across the suite (Popup trigger
   migration is the planned Phase 2 proof, then Countdown display rules).
   Loaded once per page (`window.tgseRules` guard). Rules are pure data
   evaluated by a hardcoded dispatch table of named functions — no eval, no
   Function constructor, no way to inject executable code through a rule
   config. `evaluate(group, ctx?)` returns `{ show, defer, results }`;
   the optional `ctx` override ({ now, device, returning, entrySource }) is
   what makes the engine testable in plain Node and simulatable in editors.
   `armDeferred(group, cb)` arms deferred triggers (exit intent) and fires
   `cb` once.

2. **`public/widget-smartsection.js`** — the widget. Wrapper mode only in v1:
   the content to control lives INSIDE the embed div, in the light DOM. It is
   the ONE widget in the suite that intentionally does NOT use Shadow DOM,
   because it wraps user content (Duda elements, other TG widgets) that must
   render in the light DOM. The UI it injects (dismiss button, debug badge)
   uses inline styles with high specificity instead. If `tgse-rules.js` is not
   already on the page the widget injects it from its own origin.

Embed shape (the shell's Get embed code gives the standard two lines; the
content goes inside the div):

```html
<div data-tg-widget="smartsection" data-tg-id="tgw_...">
  ... the content to show or hide ...
</div>
<script src="https://tg-widgets.vercel.app/widget-smartsection.js" defer></script>
```

## Behaviour contract (locked)

- **Fail-open on infrastructure failure.** If the engine fails to load, the
  config fetch errors, evaluation throws, or evaluation never completes (a 4s
  watchdog), the widget shows the content. Better to show content than to
  permanently hide a section over a network blip. Dismissal and the frequency
  cap are definitive hides, not failures — they do not fail open.
- **Flash prevention.** The container is hidden synchronously at init
  (`display:none`, previous inline value restored on reveal) and revealed only
  after the decision.
- **Deferred state.** Exit intent is the only deferrable rule type. When all
  non-deferrable rules pass and only exit intent is pending, `evaluate()`
  returns `defer: true` and the widget waits hidden, revealing when the
  trigger fires (desktop: mouse leaves through the top; mobile: fast scroll up
  near the top).
- **Preview mode** (`window.__TG_PREVIEW__` or `config.debug`): content is
  always shown, a badge reports what a real visitor would get, and nothing is
  persisted.
- **Storage:** localStorage/sessionStorage under the `tgsr_` prefix via the
  engine's safe helpers. Anonymous only, no PII: `tgsr_visitor_seen` (first
  visit marker), `tgsr_entry_src` (session UTM/referrer capture),
  `tgsr_ss_<widgetId>_dismiss` (`{expires}`), `tgsr_ss_<widgetId>_shows`
  (count).

## Config schema

```js
{
  match: 'all' | 'any',          // combinator, single group, no nesting (v1)
  rules: [
    { type: 'visitorType', value: 'new' | 'returning' },
    { type: 'timeOfDay',   from: 'HH:MM', to: 'HH:MM' },   // overnight ok
    { type: 'dayOfWeek',   days: [0-6] },                  // 0 = Sunday
    { type: 'device',      devices: ['mobile','tablet','desktop'] },
    { type: 'utm',         param: 'source'|'medium'|'campaign'|'referrer',
                           match: 'is'|'contains', value: 'text' },
    { type: 'exitIntent' }
  ],
  dismissible: false,
  dismissDays: 30,               // 0-365, suppression after dismiss
  maxShows: 0,                   // 0 = unlimited, else per-visitor cap
  reveal: 'fade' | 'none',
  debug: false
}
```

Malformed rules, unknown types and unknown enum values count as a pass
(fail-open), clamped numerics fall back to defaults. The 6 rule types and the
single AND/OR group are the locked v1 scope — no variant/controller modes.

## Files

- `public/tgse-rules.js` — rule engine (shell level, reusable)
- `public/widget-smartsection.js` — the widget
- `public/editor-smartsection.html` — editor (shell contract; live in-page
  preview using the real engine + widget with `__TG_PREVIEW__` set). Includes
  a "Preview as this visitor" simulator: the sidebar sets
  `window.__TG_PREVIEW_CTX__` (visitor, device, day + time, utm_source) and the
  widget passes it to the engine so the badge shows what that visitor would get.
  Simulator state is held outside the saved config, so it never marks dirty.
- `public/tour-smartsection.js` — guided setup tour (house contract:
  `tgse.tour` / `tgse.tourLauncher` / `window.initSmartSectionTour`), 9 steps
  across templates, the rule builder, the simulator, dismissal/frequency,
  preview, save and embed. Loaded after `editor-tour.js`; no vercel header
  block needed (tour files are served by the generic static rule).
- Templates: the editor's Templates button opens a picker of 7 starter recipes
  (exit-intent offer, office hours, mobile-only, welcome back, first-time
  greeting, weekend special, campaign traffic). Applying one resets to a clean
  config, fills in the recipe's rules and settings, and preserves the saved
  widget id. Follows the house modal pattern (`#tplModal`, `.tpl-card`).
- `public/demo-smartsection.html` — demo page (five wrapped bands: dismissible,
  office hours, mobile only, returning visitors, real exit intent)
- `api/widget-ai.js` — `'SMART SECTION'` added to the shared AI endpoint:
  `ALLOWED_WIDGET_TYPES`, a `buildSmartSectionPrompt` (rules only, no copy), and
  `sanitiseSmartSectionConfig` wired into both dispatches. Reuses the existing
  Anthropic call and per-plan daily caps (Ignite 40, Bespoke 100). The editor's
  AI button turns a plain-English audience description into rules.
- `api/_lib/smartsection-rules.js` — the trust boundary: `sanitiseSmartSectionConfig`
  whitelists rule types and fields and clamps numbers, so nothing the model
  returns reaches a client unchecked. Dependency-free and unit-tested.
- `api/widget-config.js` — `'Smart Section'` in `ALLOWED_WIDGET_TYPES`,
  `PLAN_WIDGET_LIMITS` (`{ Spark: 0, Boost: 0, Ignite: -1, Bespoke: -1 }`) and
  slug aliases
- `vercel.json` — 2 rewrites (`/demo-smartsection`, `/editor-smartsection`) and
  2 header blocks (`/tgse-rules.js`, `/widget-smartsection.js`)
- `public/index.html` — WIDGETS registry entry (category Marketing, colour
  `#4338CA`) plus a static 700×340 fake-webpage mini-preview branch in
  `loadMiniPreview` (static preview, so no engine script tag at the bottom of
  the dashboard)
- `tests/test-rules.cjs` — 27 unit tests (plain Node + node:vm)
- `tests/test-integration.cjs` — 12 jsdom integration tests (jsdom is a
  devDependency; `runScripts: 'outside-only'`), the last two covering the
  preview-context simulation
- `tests/test-ai-rules.cjs` — 10 tests for `sanitiseSmartSectionConfig` (the AI
  trust boundary): clean pass-through, dropped unknown types, malformed fields,
  clamps, injection and prototype-pollution guards

Run tests: `npm run test:smartsection`

## Deploy checklist (things code cannot do)

1. **Airtable WidgetType option.** Add `Smart Section` to the WidgetType
   singleSelect in the Widgets base `appAYzWZxvK6qlwXK` table
   `tblVAThVqAjqtria2` — manual, in the Airtable UI. The API rejects unknown
   singleSelect options, so saves fail without it.
2. **Airtable CATALOGUE record.** Add a Smart Section record to the CATALOGUE
   table so the admin catalogue page and the entitlement gate know about it.
3. Smoke: open `/editor-smartsection`, build a rule, save, reload with the
   `?id=`, check the embed code; open `/demo-smartsection` and try the exit
   intent band and the dismiss + reset flow.

## Phase 2 (in priority order, Andy to confirm)

1. Migrate Popup's triggers onto `tgseRules` — proves the platform story.
2. AI rule builder in the editor (the AI button currently shows a
   coming-later toast).
3. Templates for common recipes (exit-intent offer, office-hours bar,
   mobile-only app promo).
4. Editor simulation controls (preview as mobile/returning/etc. via the
   engine's ctx override — the plumbing already exists).
5. Variant mode (show A to some visitors, B to others) — deliberately out of
   v1 scope.

## Locked decisions (do not relitigate)

- Name: Smart Section (over Audience Section / Conditional Container /
  Trigger Section). 24 Jun 2026.
- MVP scope: wrapper mode only; 6 rule types; single AND/OR group, no
  nesting. 24 Jun 2026.
- Tiers: Ignite/Bespoke unlimited, Spark and Boost locked, no teaser tier.
  24 Jun 2026.
- Rule engine lives at shell level, not inside the widget; reusable across
  the suite; loaded once per page. 24 Jun 2026.
- No Shadow DOM for this one widget; injected UI is inline-styled. 24 Jun 2026.
- No eval, no Function constructor; rules are pure data through a hardcoded
  dispatch table. 24 Jun 2026.
- Fail-open on infrastructure failure. 24 Jun 2026.
- Frequency caps in localStorage, anonymous counts only, no server-side
  state. 24 Jun 2026.
- Exit intent is the only deferrable rule; defer keeps the section hidden
  until the trigger fires. 24 Jun 2026.
