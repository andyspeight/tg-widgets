# Hotel Offers — project handover

**Status:** built, deployed, and waiting on one answer from Travelify before it
can show a single price. Started 12 Sep 2026.

**What it is.** A client lists the hotels they actually sell, by Travelify
property (TTI) code. The widget shows live cached prices for those hotels and
nothing else. Prices are refreshed overnight under the client's own Travelify
application, so the price on the card is the price the visitor gets on the
click. It carries every Travel Offers layout and setting, because it is the same
engine.

---

## The one open question

**The nightly job cannot yet ask Travelify for one specific hotel.** Everything
else is built and tested. When this is answered the widget goes live with one
environment variable and no code change.

What we know, and how we know it:

- **A deep link cannot be harvested.** Travelify's own Deeplinking Instructions
  (Darren Swan, Aug 2022, Drive doc `1oVZujkm1UclPWe73rGD2IHZtPcbLBVr6ywH2E-3p4yo`)
  open by saying a results page "contain[s] a unique search session that is for a
  single user/customer only. After roughly 20 minutes, the search session will
  expire and not be bookable." A deep link is a per-visitor browser session on a
  20-minute fuse. There is nothing in it to store in a shared overnight cache.
- **That document defines no TTI parameter and no `refn`.** The only property
  anchor it documents is `loct=Property` with `loc={name}` and `ctry={code}` —
  a hotel NAME, not a code. Our own `refn=TTI:{code}` was reverse-engineered
  from a live link Travelify's generator produced (22 Jul 2026). It works on the
  click-through and is undocumented.
- **TTI codes do identify a property to Travelify.** Their platform keys
  accommodation image overrides on them (Platform Updates sheet, 10 Mar 2025),
  and our own hotel databases carry the codes beside the names.
- **What is missing** is how to hand a property to the offers FEED
  (`api.travelify.io/widgetsvc/traveloffers`, proxied by `/api/offers`), which
  is the only thing that returns JSON we can cache. It takes `destinations` as
  airport or country codes. No published source names a property parameter.

**How to settle it.** Ask Darren, or run the probe, or both:

```
GET /api/cron/refresh-tti-offers?probe=1&tti={a real code}&appId={a real app}
    &name={the hotel name}&ctry={its country}
Authorization: Bearer $CRON_SECRET
```

The probe fires one request per candidate spelling plus an unscoped control, and
reports how many offers came back and how many were actually that property. The
answer is the candidate where `matchedProperty === parsed` and `parsed > 0`,
while the control returned a broader set. It writes nothing.

Then set on Vercel, and the nightly sweep starts working:

| Variable | Meaning |
| --- | --- |
| `TTI_PROPERTY_PARAM` | The parameter name. Use the literal value `loct` for the documented name-based anchor. |
| `TTI_PROPERTY_PARAM_ARRAY` | `1` if it takes a list rather than one value. |
| `TTI_PROPERTY_PARAM_PREFIXED` | `1` if the value carries the `TTI:` prefix. |

No new credentials are needed. The sweep reads the Widgets table with the map
cron's `airtableList`, so it uses the `AIRTABLE_PAT` that already covers
`appAYzWZxvK6qlwXK`, and it authenticates to `/api/offers` with the existing
`CRON_SECRET`.

Until then the cron fires **no searches at all** and reports
`unconfigured: true`. That is deliberate. Guessing would burn Travelify capacity
to fetch inventory the verify gate then discards, which is the behaviour the
cache-only rule exists to prevent.

---

## The verify gate (do not remove)

Travelify ignores parameters it does not recognise rather than erroring. A wrong
`TTI_PROPERTY_PARAM` therefore returns 200 with a full page of unrelated
inventory. Without a check, a client's "our twelve hotels" widget would quietly
fill with somebody else's rooms — which is far worse than showing nothing.

So `offerIsProperty()` compares every parsed offer's `accommodationUniqueRef`
against the code that was requested, and drops anything that does not match,
whatever the parameter does. A wrong parameter can then only ever produce an
empty widget, never a wrong one. The sweep reports `suspectParam` when it asked
for plenty and stored none, which is that failure's signature.

---

## Architecture

**One engine, two widget types.** `public/widget-offers.js` serves both. Travel
Offers scopes by place; Hotel Offers scopes by property. Everything after the
fetch — six templates, the popup engine, seven dedupe strategies, the currency
layer — is identical, so a fork would mean fixing every future template bug
twice. `/widget-hotel-offers.js` is a `vercel.json` rewrite onto the same file,
which keeps the one-div-one-script embed contract and injects no script. The
engine auto-inits on both tags and exposes `window.TGHotelOffersWidget` as an
alias of the same class.

The seam is one function, `_cachedOffersQuery`. A config carrying `ttiCodes`
sends `tti` and `appId` and **does not send `destinations`** — a widget that
named twelve hotels must never fall back to showing a country.

**Cache keys.** `offers:tti:{appId}:{code}`. Keyed by App ID as well as code
because each client's properties are swept under their own Travelify
application: two agencies asking about one hotel get their own contracted rates,
and a shared key would make the teaser price and the booking price disagree.

**The property list.** Rows of `{ code, name, ctry }`. The editor accepts one
hotel per line, comma-separated, which is the column order of our own hotel
spreadsheets, so an agent pastes straight from one. Codes work with or without
the `TTI:` prefix. The name is optional but matters: it is what the documented
`loct=Property` anchor needs.

**Canonicalisation is the load-bearing invariant.** `canonTti` appears in four
places — `api/_lib/offers/tti.js`, `api/cached-offers.js`,
`public/widget-offers.js` and `public/editor-hotel-offers.html`. The cron writes
the key the widget reads, so a difference in any one of them is not a bug that
degrades, it is a total silent miss on every Hotel Offers widget in the estate.
`npm run test:hotel-offers` asserts all four carry the same pattern.

---

## Files

| File | What it does |
| --- | --- |
| `api/_lib/offers/tti.js` | The pure logic: code canonicalisation, the property list parser, the search shape, the payload builder, the verify gate. Dependency-free so it is testable. |
| `api/cron/refresh-tti-offers.js` | The nightly job and the probe. Reads Hotel Offers widgets from Airtable, resolves each owning account's App ID, sweeps, verifies, stores. |
| `api/cached-offers.js` | Gained a `tti=` + `appId=` mode that reads the per-property pool instead of the country pool. |
| `public/widget-offers.js` | v1.20.0. The TTI branch, the second tag, the alias global. |
| `public/editor-hotel-offers.html` | The editor. The destination chips became a property list; templates are layout-only presets. |
| `public/demo-hotel-offers.html`, `public/tour-hotel-offers.js` | Demo page and guided tour. |
| `test/hotel-offers-smoke.mjs` | 37 tests. `npm run test:hotel-offers`. |

The world map cron gained four `export` keywords and nothing else. Its parser is
imported rather than copied, so both jobs write one cache shape and
`cached-offers.js` rebuilds both pools with the single `toRawShape` it already
had.

## Registration

Done, including the parts that are usually manual:

- `ALLOWED_WIDGET_TYPES`, `PLAN_WIDGET_LIMITS` and `NEEDS_APP_ID` in
  `api/widget-config.js`. Hotel Offers receives the App ID because its cache key
  is built from it, and `agencyName` because it renders the same Dynamic Package
  cards. It is **not** given an API key: it is cache-only from birth.
- Dashboard registry entry in `public/index.html`, sharing the offers tile mock.
- Airtable `WidgetType` option `Hotel Offers` (`selGpC0zS9myl4OT4`), added via a
  typecast write rather than by hand, plus a Widget Catalogue Status record.
- `vercel.json`: three rewrites, one header block, and the nightly cron at
  02:30 UTC, well away from the map cron's ten-minute rotation.

**Plan access: Ignite and Bespoke only** (Andy, 12 Sep 2026). Spark and Boost
are locked. Unlike Travel Offers, which reads a cache we fill for everyone
anyway, every property on a Hotel Offers widget costs its own Travelify search
every night.

## Volume

Roughly (properties × accounts) requests per night. Capped at 100 properties per
widget and 1,500 requests per run, so a pasted spreadsheet cannot become an
unbounded bill. A run that hits the ceiling reports `truncated`.

## Next steps

1. Get the property parameter from Travelify, or run the probe against a real
   account, and set `TTI_PROPERTY_PARAM`.
2. Watch the first full sweep: `tti:offers:lastSweepStats` carries per-run
   tallies, and `suspectParam` flags a parameter being ignored.
3. Decide whether a hotel with no availability should stay hidden (current
   behaviour, and what Andy chose on 12 Sep 2026) or show an enquire state. The
   second is a different product and needs a card state designing across all
   templates.
