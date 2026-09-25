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
  email).
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
- **TTI Offers** (the TTI property-scoped offers widget, and the one open
  question blocking it): `docs/tti-offers-handover.md`. Read it before any
  work on TTI codes, the per-property offer cache, or the nightly sweep.
- **Event Tickets widget family** (the supplier event feed and the six ticket
  widgets built on it): `docs/supplier-event-feed.md` (Airtable record
  `recdVmyNz4nCXltMc`).
- **Booking confirmation emails** (the Travelgenix webhook, the queue, the
  worker and the block-built email we are taking over from Travelify):
  `docs/booking-confirmation-emails.md`. Read it before touching
  `api/v1/booking-webhook.js`, `api/v1/booking-confirmations.js` (the direct
  request the Travelify core posts to, 25 Sep 2026; its contract is published
  at `/booking-confirmations-api`), `api/cron/booking-confirmations.js` or the
  block vocabulary in `public/_booking-email-template.js`.

- **Passport details (FOID) in My Booking** (customers add or change the passport
  details of the people on a flight, sent to Travelify's `updatepaxfoid`):
  `docs/mybooking-passports.md`. Read it before touching `api/update-passport.js`,
  `public/_passport-rules.js` (the rules, copied verbatim into the widget and
  held by `test:passport-rules-drift`) or the passport block in
  `widget-mybooking.js`. A passport number is never logged, never stored in the
  browser and never handed to the host page.

- **ATOL certificates in My Booking** (the CAA's own certificate, filled in for
  a booking and attached to the page and the confirmation email):
  `docs/atol-certificates.md`. Read it before touching
  `api/_lib/atol-certificate.js`, the templates in `api/_data/atol/`, the ATOL
  Certificates register or the editor's ATOL section. The certificate is the
  CAA's file with only the SAMPLE watermark removed: never redraw it. Airtable
  record `recEqxD9kk0uG4UYK`.

- **Acting as a client (staff) and Control's "View as client"**:
  `docs/act-as-scoping-spec.md`. Read it before touching `api/_lib/auth/actas.js`,
  `/api/auth/act-as/start`, `/api/auth/switch-client`, `staff-switcher.js` or the
  launchpad's `?viewAs=` preview. A preview uses the per-tab scoped grant and
  never the old whole-login switch. Airtable record `receBpWj20KhsBPQ6`.

- **Travelify widget platform integration** (the two read APIs and the SSO deep
  link that merge our widgets into Travelify's own Widget Directory and My
  Widgets): `docs/travelify-widget-integration.md`. Read it before touching
  anything under `api/v1/`, the generated widget registry, the public category
  map or `public/previews/`. Airtable record `recm4J71rCjUs9MU2`.

- **The Duda element audit (tg-sites)**: `docs/duda-element-audit.md`. Read it
  the moment a session mentions Duda, "the next list", or elements. It carries
  what has been checked, what was built, what Andy has asked to skip, and the
  conventions the audit turned up that are not written anywhere else. Its
  companion is `docs/duda-gap-analysis.md`, the PLATFORM-level comparison (23 Aug
  2026): the element axis is closed, so a new "how do we compare to Duda"
  question belongs there rather than in a fresh element sweep.

- **tg-sites (the CMS)**: `docs/tg-sites-handover.md`. START HERE for any
  tg-sites session. It carries the current state, the open queue in priority
  order, the numbers you can quote, and a list of things that will bite you
  that is not derivable from the code. Its companions are
  `docs/tg-sites-speed-and-visibility.md` (the analysis behind the performance
  work), `docs/duda-gap-analysis.md` and `docs/elementor-gap-analysis.md` (the
  platform comparisons) and `docs/react-bits-review.md` (15 Sep 2026: the effects
  vocabulary the layouts are missing, what we already have under other names, and
  the five-slice build order) and `docs/tg-sites-form-actions.md` (15 Sep 2026: the
  webhook and Brevo contract for where an enquiry also goes, for whoever wires the
  other end), and `docs/duda-visibility-review.md` (15 Sep 2026: Duda's AI
  Visibility add-on against our Search and AI visibility screen, and the five
  slices that close the gap), and `docs/tg-sites-copilot-review.md` (16 Sep 2026:
  Duda Copilot against the AI tg-sites already has, the eleven hard rules checked
  against the code, and the six-slice plan for an assistant panel; read it before
  any copilot or assistant work, and note that Andy picks the panel direction
  before any panel UI is built).

- **The motion engine (tg-sites)**: `docs/motion-engine.md`. What is actually
  BUILT and switchable in the editor: nine movement recipes with three strengths,
  six reveal styles, the background and hover effects, and which recipes collide
  with which. Its companion is `references/motion-recipes.md` in the
  travelgenix-taste skill, which is the DESIGN catalogue (purpose, tier,
  rationale, including recipes not yet built). Read the skill to decide whether
  something should move, this doc to find what is on the menu.

- **Luna Chat — A DIFFERENT REPO.** The widget, the agent dashboard and the API
  behind them live in `andyspeight/luna-chat-endpoint`, deployed separately at
  `chat.travelify.io`. Nothing about it is in this repo except the provisioning
  call: Client Control creates the Luna Chat client when the entitlement is
  switched on, through `api/_lib/luna-chat-provision.js`. Attach that repo and
  read its `HANDOVER.md` before any Luna Chat work. Its Airtable base is
  `app6Ot3eOb3DangkB`, separate from the widget suite's. The four Luna Chat
  records in the Projects table are from June and July 2026 and describe things
  as unbuilt that have been live for months, so trust `HANDOVER.md` over them.

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
- No emoji in any design, on any surface, but DO use relevant icons (Andy,
  24 Sep 2026: emoji "are not acceptable in our designs" and "there should
  still be relevant icons, just not emojis"). On a page or in a PDF use the
  house SVG icons. In an email, where Gmail strips SVG, use the PNGs in
  `public/email-icons/`, built from the same SVG paths by
  `npm run build:email-icons` and referenced on `https://widgets.travelify.io`.
  A plain check mark or arrow is typography, not emoji. Guarded for the booking
  outputs by `npm run test:booking-no-emoji`; other widgets still carry some
  and have not been swept.
- Commit directly to the repo from Claude Code (Andy's old flow was the
  GitHub web UI; direct commits remove that friction). Vercel deploys `main`
  automatically.

## Widget suite conventions

**Offers are cache-only.** A visitor's browser must NEVER trigger a Travelify
search. Every offer widget reads `GET /api/cached-offers` and nothing else; the
cache is filled on our own schedule by `api/cron/refresh-map-offers.js` and
`api/cron/refresh-tti-offers.js` (the TTI Offers per-property sweep), which
are the only things that may call `/api/offers`. The one live search left in the
product is the one Travelify runs when a visitor CLICKS an offer. Do not add a
"just fall back to live if the cache is empty" path — that is the exact
behaviour removed on 30 Jul 2026, when it was costing ~4,000 searches a week
and starving the cache it was supposed to be a safety net for. An empty cache
answer means the calm empty state, not a live search. Guarded by
`npm run test:offers-cache-only`.

**Live weather comes from MET Norway, and it is credited** (24 Sep 2026). The
Weather widget's "Right now" strip reads `/api/weather-current`, which proxies
MET Norway's Locationforecast (the data behind yr.no): free INCLUDING commercial
use, no key, under NLOD 2.0 / CC BY 4.0. Do not move it to Open-Meteo's free
tier: that is licensed for non-commercial use only, and weather on paying
clients' sites is commercial. MET's terms are kept in code and must stay kept:
an identifying User-Agent on every request (a generic one is refused with 403;
`MET_NO_USER_AGENT` overrides the default), never asking again before its
Expires time (the edge cache honours it), and the "Data by MET Norway" credit on
the strip. The coordinates are the destination record's own Latitude/Longitude,
returned by `/api/destination-content` as `geo`; a country's point is its main
city. Two older callers still use Open-Meteo's free services and have not been
reviewed for this: Prayer Times' place search and the climate-reference cron.
Guarded by `npm run test:weather-live`.

**Every server-side Travelify call sends a Referer** (17 Sep 2026, Better
Lifestyle app 474). A client can lock their Travelify application to their own
domains, and that check reads the REFERER. A server sends none unless it sets
one, so a locked application refuses us with "Missing or invalid application
credentials" — the same words a wrong key gets, which is why a perfectly good
key was investigated for fifteen hours. Travelify's own instruction is to send
`https://localhost/`, which their gate treats as the server-side caller. Build
the headers with `travelifyAuthHeaders()` from `api/_lib/travelify.js` and never
hand-roll `Token ${appId}:${apiKey}` again: there were nine copies of those four
lines and the Referer had landed in none of them, so offers (which had it since
14 Sep) worked while orders, PDFs, amendments, cancellations and balance
payments all died. The one deliberate exception is `api/offers.js`, a browser
proxy that forwards the VISITOR's real Referer and refuses to fabricate one.
Guarded by `npm run test:travelify-referer`.

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

**A leg's duration is the supplier's number, not our subtraction** (21 Sep
2026, ET122149). Travelify states `duration` in minutes on the route AND on
each segment. Print the route's. Do not subtract `depart` from `arrive`: those
are airport-local times dressed as UTC, so on a flight that crosses a zone the
two clocks are in different places and the difference is meaningless. Luton
12:55 to Rhodes 19:10 looks like 6h15m and is 255 minutes, exactly the two
hours Rhodes is ahead. Do not sum the segments either, except as a fallback:
on a leg with a stop that is flying time only and it hides the layover. The
"+1" that marks an arrival landing a day later has the same rule and is the
same family as the check-out bug below: compare the two CALENDAR dates with
`bookingMoment()` and UTC fields, never `new Date(x).getDate()`, which read
this booking's same-day outbound as "+1" for anyone as far east as Sydney.
Guarded by `npm run test:booking-dates-tz`, which re-runs ET122149's legs in
four timezones.

**A booking date is a calendar date, not an instant** (15 Sep 2026, Exclusively
Travel ET121109). Travelify writes a check-in as `2026-09-26T00:00:00`: a date
wearing a time, with no zone on it. `new Date()` parses that in the READER's
timezone, so the same code is right on a UTC server and a day out in a British
browser. The My Booking page said a six-night stay from 26 Sept checked out on
1 Oct while the PDF said 2 Oct. Read such a value with `bookingMoment()` from
`public/_order-stays.js` (it returns a Date whose UTC fields are the numbers in
the string) and print it with `timeZone: 'UTC'`; count days forward with
`stayCheckout()`, never with `new Date(x).getTime() + n * 86400000` or a local
parse followed by UTC arithmetic. Times behave the same way: Travelify dresses
airport-local times as UTC, so a 14:00 flight printed 13:00 in British Summer
Time. Guarded by `npm run test:booking-dates-tz`, which re-runs the widget, the
PDF and the email in four timezones. Fixtures must use the shape the supplier
really sends: tidy `2026-09-26` strings in the old fixtures are what hid this.

**A discount voucher is money off, not decoration** (21 Sep 2026, Exclusively
Travel ET122149). Travelify sends `vouchers[]` with an `isGift` flag. Gift
cards were always credited; discount codes were held back in case the discount
was already inside the item prices, and ET122149 settled that it is not: a
booking carrying SUNSHINE30 (-£30, `isGift: false`) reads as a zero balance in
Travelify and read as £30 still to pay on the customer's page, because our
total is the item prices summed. Both kinds are credit now. The same sums drive
the Pay balance button, so this was not only a wrong number on a page, it was
about to take £30 Travelify does not think it is owed.
`TG_DEDUCT_NON_GIFT_VOUCHERS=0` is the kill switch.

**And a voucher the payment plan has already taken off must not come off
twice** (22 Sep 2026, ET122406). Travelify sometimes sends `depositOption` NET
of the voucher: that booking's plan is a £405.20 deposit plus one £1,550.80
instalment, £1,956.00 against a £2,026.00 holiday, the £70 discount already
gone. Voucher credit settles the plan's entries, so crediting it again put
"Amount payable now" at £1,480.80 on a card that said two lines above that the
remaining £1,550.80 was due, and the Pay balance button would have taken the
lower figure and left the customer £70 short. Measure what the plan is short by
(`total - scheduleTotal`) and credit it only with the remainder. A plan that
still carries the full holiday cost is credited exactly as before. Guarded by
`npm run test:order-money`.

**What the customer booked is not the same as what the menu offered** (21 Sep
2026, ET122149). A Travelify flight's `dataObject.extraGroups` is the WHOLE
menu: 109 seats on that booking's outbound, every bag weight, the sports
equipment list. The chosen rows are marked with `qtySelected` and nothing else
tells them apart, so four seats and two hold bags were plain to the agent in
Travelify and invisible to the customer for as long as the widget has existed.
Read them with `trimFlightSeating()` from `api/_lib/travelify-items.js`, which
all three order endpoints call: there are three copies of `trimFlights` and a
fourth copy of this would have been the Referer story again. It drops the
placeholder rows Travelify also sends ("I do not want to pre-book my seat",
marked `SEATID: NONE`) and carries NO prices, because a seat's `pricing.price`
is a per-unit supplier figure that does not reconcile with the item total the
customer sees (four seats at 18.49 / 18.49 / 18.99 / 18.99 arrive in the
breakdown as one "Seat Selection Total" of 122.87).

It also returns the `cabins`, the cabin plan behind the on-page seat map: the
seat group states `cols` (column letter to block, so the aisle is wherever the
block changes) and `startRow`/`endRow`. **The map may never show which other
seats are free**, and nothing may be added that implies it: the extras list is
only what was still on sale at the moment of booking, a row absent from it may
be full rather than seatless (row 18 on ET122149), and by the time a customer
opens their booking that snapshot is weeks stale. Every seat but the
customer's own is drawn the same and the note under the map says so. The map is
the page only: the PDF and the email carry the seats as text (Andy, 21 Sep
2026: "no good for the printed version but the online version could show it as
a pop up").

**Nothing here may leave a dead stub** (Andy, 21 Sep 2026: "there will also be
many airlines that don't provide a seat map or seat booking"). Every piece is
gated on the data actually arriving: no chosen seats, no "Seats you chose"; no
bags, no baggage line; no cabin, or a cabin none of the seats can be placed on,
no map button and no dialog. `trimFlightSeating` drops a cabin nobody is
sitting in rather than shipping an aircraft nothing can be drawn on. And a
seat's `PaxID` is often absent, so the seat shows without a name: the cell
carries its seat number instead of initials, the chip is "Seat 2C" with no
trailing separator, and the party list still reads. All guarded by
`npm run test:mybooking-seats`.

**A monogram is not a word** (25 Sep 2026). A client's page may be read through
the browser's translator, and it rewrites whatever looks like a word: on a
Swedish page Manchester City's MC badge read "Motorcycle" (MC is Swedish for
motorcykel). Generated initials, and the proper names beside them, carry
`translate="no"`. Guarded by `npm run test:clubpicker-featured`.

**Hidden must mean hidden** (25 Sep 2026, fourth time). A class that sets
`display` (`inline-flex`, `flex`, `grid`) beats the browser's own `[hidden]`
rule, so `el.hidden = true` silently does nothing and a pressed button stays on
screen. It bit the TG Slicer panel, Testimonials, the destinations dashboard and
then My Booking's "Request a change" and "Pay balance". Give any stylesheet that
toggles `hidden` one line near the top: `[hidden] { display: none !important; }`.
Guarded for My Booking by `npm run test:mybooking-hidden-legs`; other widgets
have not been swept.

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
- **The editor loads the widget, not the shell.** The shell has a `setConfig`
  hook but never calls it: every editor needs its own `loadFromUrl()` that
  fetches `GET /api/widget-config?id=`, merges the config over its defaults and
  puts `d.name` into `#name-input`. Miss it and the editor boots on its
  defaults, shows a blank name, and the next Save writes those defaults over
  the client's real config and the name as "Untitled" — silent config loss, and
  exactly what Special Offers and Form did until 17 Sep 2026. Order matters:
  the load must land BEFORE the first paint, or the defaults win the race and
  get saved. Guarded by `npm run test:editor-loads-widget`, which opens every
  editor in a real browser (the Event family loads through
  `editor-events-kit.js`, so grepping the HTML gives false alarms).
- **One `tgse.init` per editor.** The shell keeps the LAST one it is given. A
  second init pasted in from another editor silently takes over `getConfig`,
  `onTabChange` and the rest: `editor-popup.html` carried one from
  `editor-newsletter.html` and could not be saved at all between 4 and 17 Sep
  2026. Watch for duplicate top-level `function` names too — declarations hoist,
  so a pasted copy overrides the editor's own.
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
`Bespoke`. In limit maps: `-1` unlimited, `0` locked. A widget available on a
plan is UNLIMITED there (Andy, 8 Sep 2026): never put a positive count in a
plan map. `npm run test:plan-limits-drift` enforces this and keeps the API map
and the dashboard registry in step.

**Every widget is unlimited on Ignite and Bespoke** (Andy, 17 Sep 2026: "make
all widgets (not apps or contracting) available for all Ignite and Bespoke, and
when we add new widgets that be the default way to introduce them"). A new
widget ships `Ignite: -1, Bespoke: -1`; Spark and Boost are still a per-widget
commercial call. Guarded by `test:plan-limits-drift`. This is only half the
gate: entitlement is ALSO read from Control's Package Catalogue, so a new
widget needs an included-by-default row against the Ignite and Bespoke packages
or the save API 403s even though both plan maps say yes. The day this rule was
written, TTI Offers had no package rows at all and Bespoke was missing all
seven Event Tickets widgets.

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
5. A record in the Airtable CATALOGUE table (category `Widget`), AND an
   included-by-default row in PACKAGE CATALOGUE against the Ignite and Bespoke
   packages — the catalogue row alone does not entitle anyone

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
- **The runtime is Node 24** (24 Sep 2026; Vercel stopped building Node 20 on
  1 Oct 2026). The booking PDF and quote PDF functions answer
  `GET ?selfcheck=1` on PREVIEW deployments only (Vercel's own `VERCEL_ENV`
  decides; production answers 405): they start Chromium, draw a made-up PDF
  and report each step. Use it on the branch preview before any runtime or
  Chromium upgrade reaches `main`. One thing that will bite: on Node 24,
  `AWS_EXECUTION_ENV` is EMPTY, and `@sparticuz/chromium` 138 recognises the
  runtime only through the `VERCEL` system variable. Keep the project's
  "Automatically expose System Environment Variables" setting on, or Chromium
  starts without its libraries and every PDF fails. Node 24 also logs a
  `DEP0169 url.parse()` deprecation line once per cold start: that comes from
  the platform, not our code, and is harmless. `npm run test:runtime-selfcheck`.

## tg-sites: client-site design with Impeccable (18 Aug 2026)

This section governs the CMS at `tg-sites/` only, not the widget suite. It was
added when Impeccable (github.com/pbakaus/impeccable) was adopted to raise the
design quality of the CLIENT sites the CMS emits. The Travelgenix design and
taste skills still own the Travelgenix-branded surfaces (the editor, dashboard
and admin UI); Impeccable owns the client-site output. The full boundary lives in
`PRODUCT.md` at the repo root: read it before any tg-sites UI work.

**Two design systems, one boundary.** Operate surfaces (the tool: editor,
dashboard, settings, members, domains, account bar) are Travelgenix-branded and
governed by travelgenix-design and travelgenix-taste. Persuade surfaces (the
published client site: `tg-sites/components/render`, `tg-sites/lib/content`,
`tg-sites/app/site`) are client-branded and governed by Impeccable and the
client's own DESIGN.md. Where they meet, travelgenix-design wins, and Impeccable's
brand-level rules (a distinct display face, a brand palette) never touch the
tool's own UI. The design detector is scoped to match, in `.impeccable/config.json`.

**The unit of design is the tenant.** Impeccable keeps one DESIGN.md per project;
our design world is per client site. So each client lives in
`designs/<tenant-slug>/DESIGN.md`, the committed home of that client's palette,
type, spacing, motion and anti-references.

**Before ANY client-site design work:**
1. Identify the tenant whose site you are building or restyling, and its slug.
2. Read `designs/<slug>/DESIGN.md`. Run
   `node .claude/skills/impeccable/scripts/context.mjs --target designs/<slug>/`
   once at the start of the session to load it, PRODUCT.md and the surface brief.
3. If that file does NOT exist, do not invent a world. Run the init conversation
   with Andy to agree the client's world first, then write the DESIGN.md, then
   design. A luxury house and a family-budget operator must not be the same site
   reskinned, and that only holds if each has its own committed world.

**Refinement preserves, redesign replaces, never split the difference.** Refining
a client site keeps its committed identity, copy and everything outside the scope
you were asked to change. A redesign treats the old look as evidence and
anti-reference, chooses a new world, and REPLACES the DESIGN.md. Do not polish the
discarded look, and do not blend the old and the new into a compromise neither
chose.

**The craft floor for every client site**, whatever its world (from Impeccable's
craft-floor, not optional and not the client's to waive):
- Theme the browser surfaces from the client palette: text selection, the caret,
  custom scrollbars, focus rings, link underline offset. This is the cheapest tell
  that a page was built rather than assembled, and the one most often skipped.
- One authored motion moment per page, not the same entrance bolted onto every
  section. Exponential ease-out from an already-visible default, and it honours
  prefers-reduced-motion.
- No kicker or eyebrow label above a heading. This is a ban, not a default: the
  heading carries its own weight.
- No hero-metric template (big number, small label, supporting stats, accent).
- No section numbers (01 / 02 / 03) unless the sequence itself carries information
  the reader needs.
- Contrast at least 4.5:1 for body and placeholder text; tint secondary text from
  the palette hue, never flat gray.
- Real states on everything: hover, focus, disabled, loading, error, empty. Plus
  real content, working controls and keyboard focus.

**Scope and running the detector.** Impeccable is installed at the repo root
`.claude/` and its post-edit hook is scoped in `.impeccable/config.json` to the
client-site output (`components/render`, `lib/content`, `app/site`, theme and
seo), away from the widget suite and the Travelgenix tool chrome. Run a manual
scan with `npx impeccable detect <path>`; a finding on a scoped-out Operate or
widget file is governed by travelgenix-design and is discarded, not acted on.

**Storing DESIGN.md on the tenant row is a proposed next step, not built.** See
the note in the Impeccable install PR description.
