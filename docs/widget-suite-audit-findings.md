# Widget Suite — Stage 1 Audit Findings

Owner: Andy Speight. Author: Claude Code. Run: 23 July 2026.

This is the ranked findings list from the Stage 1 proactive audit in
`widget-suite-hardening-plan.md`. The whole suite was swept in five parallel
read-only passes (widget data APIs, forms and enquiry APIs, auth and AI APIs,
every widget, every editor), each checking against the five failure patterns.
Every finding here was verified by reading the code, not guessed.

Nothing on the live site changes off the back of this document until you have
picked what to fix and in what order.

## The good news first

The classes that would be most dangerous came back clean:

- No widget shows a visitor a raw error like "Unexpected end of JSON input" or
  leaks a network body. Every `res.json()` is already wrapped.
- No widget puts a config string through `innerHTML` unescaped, so there is no
  cross-site scripting hole in the suite.
- Server side, every Airtable formula input is sanitised, ownership checks fail
  closed, and secrets are compared safely. The one cross-client visibility bug
  we already fixed (Worldchoice) has not reappeared elsewhere.
- The enquiry submit pipeline correctly isolates each routing destination, so
  one failing destination cannot take down the others or the submission.

So this is not a suite riddled with holes. It is one big repeatable weakness
plus a short list of discrete bugs.

## The headline: one systemic weakness (Pattern 3)

**Outside calls with no time limit.** Around twenty calls to Airtable, the AI
model and Redis across the suite have no timeout. On a normal day this is
invisible. When the outside service is slow, the request has no bound, so our
function runs until the platform kills it and returns an empty gateway error.
That empty response is exactly what surfaced to clients as "Failed to fetch" and
"Unexpected end of JSON input" this week.

This is a single, repeatable fix (add a timeout and let the existing clean-error
path take over, the way `api/offers.js` already does). Fixing it once, applied
across the list below, closes the whole class and is the highest-value work in
this audit.

Sites in this class: `widget-config.js` (the endpoint EVERY widget calls),
`destination-map.js`, `destination-content.js`, `airport-content.js`,
`attraction-content.js`, `events-content.js`, `offer-draft.js`,
`attraction-search.js` / `airport-search.js` / `destination-search.js`,
`_redis.js` write helpers, `faq-translate.js`, `enquiry-translate.js`,
`enquiry/submit.js` (final PATCH), and widget-side in `widget-attraction.js`,
`widget-spotlight.js`, `widget-airport.js`, `widget-testimonials.js`.

## Ranked findings

Severity key: **SEV1** breaks a widget live on a client's site · **SEV2** breaks
the editor or an admin action, or is a real security or data gap · **SEV3**
minor or hardening.

| # | Area | Sev | What breaks for a client | Fix | Effort |
|---|------|-----|--------------------------|-----|--------|
| 1 | `api/widget-config.js` (config load for every widget) | SEV1 | The one endpoint every widget calls has no timeout; when Airtable is slow the function is killed and the widget shows "Failed to fetch" or a blank box | Add `AbortSignal.timeout` to the GET (and POST/DELETE) Airtable calls | S |
| 2 | `widget-testimonials.js` | SEV1 | On any config-fetch blip the visitor sees a red "Testimonials widget failed to load" card sitting on the homepage | Replace the red error box with a quiet hide or a calm empty state | S |
| 3 | World Map / Spotlight / Airport / Attraction / Events content APIs | SEV1 | These content endpoints (`destination-map.js`, `destination-content.js`, `airport-content.js`, `attraction-content.js`, `events-content.js`) have no timeout, so under an Airtable slowdown the widget hangs then fails | Add `AbortSignal.timeout` to each Airtable fetch (same class as #1) | S |
| 4 | `widget-attraction.js`, `widget-spotlight.js`, `widget-airport.js` | SEV1/2 | If the content API hangs, the loading skeleton shimmers forever with no error state | Add an abort timeout on the load fetch, routing a stall into the existing error state | S |
| 5 | 6 widgets: faq, currency, flighttime, spinwheel, worldclock, statscounter | SEV2 | On a load failure the visitor sees a grey dashed "Unable to load X widget" box where the widget should be | Swap the "Unable to load" box for a silent hide or calm empty state | M |
| 6 | `api/enquiry/airtable-pat.js` | SEV2 | The "connect your own Airtable as an enquiry destination" feature is dead: a wrong import path crashes the endpoint, so every save/verify/remove of an Airtable token 500s | Fix the import to `./_lib/routing/pat-crypt.js` | S |
| 7 | `public/editor-mybooking.html` | SEV2 | First save of a My Booking widget fires twice, creating a duplicate record the client cannot match to their embed code | Remove the double-wired save (use the shell's save only) | M |
| 8 | `api/quote-pdf.js` (email action) | SEV2 | The quote-PDF email is public and takes the recipient from caller-supplied data, so someone with a client's public widget id could email an attacker-authored PDF branded as that client to any address | Tie the recipient to a server-resolved value or require auth | M |
| 9 | `api/_lib/routing/log.js` (popup leads) | SEV2 | Popup leads are written without an owner stamp, so any popup lead not also sent to an external destination becomes an orphan the agent never sees in their inbox | Stamp the owner email in `writeSubmission`, as the enquiry path does | S |
| 10 | `api/_redis.js` write helpers | SEV2 | Redis writes have no timeout, so a hung Upstash write can freeze an agent's save (saved offers etc.) until the function is killed | Add a timeout to `setJson` / `setString` / `setNxEx` | S |
| 11 | `api/offer-draft.js`, `faq-translate.js`, `enquiry-translate.js` | SEV2 | "Draft with AI" and the two translate buttons have no timeout, so a slow model leaves the agent on a spinner then a raw platform error | Add a timeout + one retry around the AI call (as `widget-ai.js` does) | S |
| 12 | `api/enquiry/submit.js` (final PATCH) | SEV3 | The routing-summary write is awaited before the visitor's confirmation and has no timeout, so a hung Airtable can stall the confirmation even though the enquiry was saved and routed | Add a timeout to the PATCH | S |
| 13 | `faq-translate.js` / `enquiry-translate.js` (plan gate) | SEV3 | The paid AI translate endpoints have no plan-tier check, so a client on a tier not entitled to AI can drive paid translation by calling the API directly | Add the same plan-tier gate `widget-ai.js` uses | M |
| 14 | `api/widget-ai.js` (daily cap) | SEV3 | The daily AI cap is a read-then-write, so two near-simultaneous requests can both slip through and a client can just cross their paid limit | Make the increment atomic, or accept the minor overspend | M |
| 15 | `public/editor-countdown.html` | SEV3 | The editor sends type "Countdown" but the catalogue name is "Countdown Timer"; saves work today only via a server alias, and pruning that alias would 400 every save | Change the editor's `widgetType` to the canonical "Countdown Timer" | S |
| 16 | Several editors (weather, textfx, mybooking, countdown, logos, spotlight, faq, testimonials) | SEV3 | A hand-rolled manual auth header can send a stale expired token and 401 a save even when the client's cookie session is valid | Delete the manual Bearer fallbacks, rely on the shell's auth | M |
| 17 | `widget-reviews.js`, `widget-weather.js` | SEV3 | On a config failure the widget leaves a blank gap or a grey "Unable to load" box on the earliest failure | Give both a quiet branded empty state and a fetch timeout | S |
| 18 | `api/destination-map-deals.js` | SEV3 | On an internal error this public endpoint returns the raw error text in its response, leaking implementation detail | Return a fixed generic message, log the real one server-side | S |

Not counted: two internal scaffolds (`editor-test.html`, `editor-shell-template.html`)
carry placeholder widget types but are not live client editors.

## Recommended order

1. **The systemic timeout fix (#1, #3, #4, #10, #11, #12)** — one repeatable
   change across the list, closes the class that caused this week's failures.
2. **The two loud client-facing failures (#2, #5)** — a red error card and a
   grey "unable to load" box on client homepages, quick to make quiet.
3. **The dead feature and the duplicate-save bug (#6, #7)** — small, concrete,
   each a real client-facing break.
4. **The two access/data gaps (#8, #9)** — the quote-PDF email vector and the
   orphaned popup leads.
5. **The SEV3 hardening (#13–#18)** — worthwhile, not urgent.

## Progress log

- 23 Jul 2026: Stage 1 audit run across the whole suite. 18 findings after
  dedupe, verified. Dominant class is missing timeouts on outside calls.
- 23 Jul 2026: Shipped the systemic timeout batch (PR #104) — findings #1, #3,
  #4, #10, #11, #12. Every outside call (Airtable, the AI model, Redis writes,
  the submit PATCH, and the three content widgets) is now time-bounded, with a
  source-scan test guarding against regression.
- 23 Jul 2026: Shipped the loud-failure batch (PR #105) — findings #2, #5, #17.
  Testimonials no longer paints a red "failed to load" card, the grey "Unable to
  load X widget" box is gone from six widgets, and reviews/testimonials config
  fetches are now bounded. All fail quiet on a client page.
- 23 Jul 2026: Shipped the small-bugs batch (PR #106) — findings #6, #7. The dead
  "connect your own Airtable" endpoint (wrong import path) is fixed with a
  module-load test, and the My Booking duplicate-save is gone (the shell now owns
  saving).
- 23 Jul 2026: Shipped the orphan-lead fix (PR #107) — finding #9. Popup leads
  are now stamped with the Owner Email, so they appear in the agent's inbox
  instead of vanishing.
- 23 Jul 2026: Shipped two safe SEV3 items (PR #108) — findings #15, #18. The
  countdown editor uses the canonical widget type (no alias dependency) and the
  map-deals endpoint no longer leaks a raw error message.
- 23 Jul 2026: Wrote `quote-pdf-email-hardening-plan.md` for finding #8 (the
  quote email needs a change to how quotes are stored — awaiting Andy's approval).
  Remaining SEV3 held for careful follow-up because each could break a legitimate
  paying client if rushed: #13 (plan-tier gate on the translate endpoints), #14
  (AI daily-cap race — no atomic primitive in Airtable), #16 (manual auth
  fallbacks across several editors).
- 24 Jul 2026: Closed the last of the audit (findings #16 + #14). #16: removed
  the hand-rolled Bearer fallback from nine editors (weather, textfx, mybooking,
  countdown, logos, spotlight, faq, testimonials — plus enquiry, found in the
  sweep). They now delegate auth to the shell (tgse.authHeaders() + the cookie
  interceptor), so a stale local-storage token can no longer 401 a save while the
  cookie session is valid. Guarded by test/editor-auth-no-bearer-smoke.mjs, which
  fails if any editor reconstructs a Bearer in code. #14: the AI daily-cap
  read-then-write race is documented as an accepted minor overspend (Airtable has
  no atomic counter; the cap stops runaway accounts, not exact billing; a one/two
  overspend at £0.025/call is immaterial, and the Anthropic console alert is the
  real ceiling). With this, all 18 audit findings are resolved.
- 24 Jul 2026: Shipped the AI plan gate (finding #13). The paid translate
  endpoints (faq-translate, enquiry-translate) now gate on plan entitlement, not
  just the per-client rate limit — a Spark or suspended account calling the API
  directly is refused (403). Extracted the caps + Active-gated plan resolution to
  a shared `api/_lib/ai-plan.js` (aiEntitlement + resolveClientPlan), and pointed
  widget-ai at the same PLAN_DAILY_LIMITS map so all three AI endpoints share one
  source of truth. Fail-closed on an Airtable lookup error. Guarded by
  test/ai-plan-gate-smoke.mjs. #14 (daily-cap race) and #16 (manual auth
  fallbacks) still to do.
- 24 Jul 2026: Shipped the quote-email fix (finding #8, PR pending). Diagnosis
  corrected the plan's assumption: the live widget ALREADY sends id+key on a
  normal viewer page (and the demo seeds one), so the safe server-fetch path is
  the default, not a rewrite. Fix: the email action is now send-by-reference
  only — `emailAllowed(v)` requires id+key, and the handler re-fetches the quote
  server-side and emails ITS recipient, never a browser-supplied doc. Download is
  unchanged (it returns the PDF only to the caller). No grace window needed
  because real sends already carry id+key. Guarded by
  test/quote-pdf-email-guard-smoke.mjs.
