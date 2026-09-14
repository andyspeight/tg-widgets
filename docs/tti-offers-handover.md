# TTI Offers — project handover

**Status:** built and complete. Started 12 Sep 2026, request shape settled
against real deep links 14 Sep 2026.

**What it is.** A client lists the hotels they actually sell, by Travelify
property (TTI) code. The widget shows live cached prices for those hotels and
nothing else. Prices are refreshed overnight under the client's own Travelify
application, so the price on the card is the price the visitor gets on the
click. It carries every Travel Offers layout and setting, because it is the same
engine.

---

## How a property is asked for

**Settled by two real deep links Andy supplied on 14 Sep 2026**, one
DynamicPackaging and one Accommodation. Both pin a property identically:

```
st=Accommodation &curr=GBP
  &loc=Dubai,+United+Arab+Emirates &loct=City
  &lat=25.0490889376 &lng=55.1180329667 &rad=28
  &fr=2026-09-26 &dur=7 &refn=TTI:12345 &adt=2&chd=0&inf=0
```

The DP one is the same plus `org=LGW`, `dst=AE1` and `dir=false`.

**The lesson, and it corrected what was built first.** The location is the
CITY at city scale, `loct=City` with a 28km radius, and the property is pinned
by `refn=TTI:{code}` alone. There is no `loct=Property` and no tight pin. `refn`
is a refinement laid over an ordinary area search, not a location type. An
earlier version of this build had a 1km `loct=Property` anchor, which was wrong.

**Why that means the sweep runs today.** A deep link and the offers feed are
different surfaces, and nothing yet proves the feed honours `refn`. It no longer
matters enough to block on:

- If the feed honours it, one request returns that property.
- If it ignores it, the SAME request returns the surrounding area, and the
  verify gate keeps only our property out of it.

Identical request count either way. The wrong-parameter case degrades to fewer
offers, never to wrong ones. So `refn` is simply the default pin and the cron
fires on its normal schedule.

**To find out which is happening**, when you want to:

```
GET /api/cron/refresh-tti-offers?probe=1&tti={code}&appId={app}
    &loc={city}&ctry={cc}&lat=&lng=
Authorization: Bearer $CRON_SECRET
```

It fires one request per pin spelling plus one deliberately unpinned, holding
the area scope constant so only one variable moves. A pin is honoured when its
offers are all that property while the unpinned run's are not. `fallbackUsable`
in the report says whether the unpinned area search finds the property at all,
which is the number that matters if no pin narrows. It writes nothing.

`TTI_PROPERTY_PARAM` overrides the default spelling if the probe finds a better
one, with `TTI_PROPERTY_PARAM_ARRAY=1` and `TTI_PROPERTY_PARAM_PREFIXED=1` for
its shape. No code change either way.

No new credentials are needed. The sweep reads the Widgets table with the map
cron's `airtableList`, so it uses the `AIRTABLE_PAT` that already covers
`appAYzWZxvK6qlwXK`, and it authenticates to `/api/offers` with the existing
`CRON_SECRET`.

---

## Two product types, and only two

**The hotel on its own, or a dynamic package built around it** (Andy, 12 Sep
2026). Nothing else is offered in the editor, swept by the cron, or accepted by
the widget.

- **Flights** are out because a flight has no hotel to pin. A TTI code cannot
  scope one.
- **Operator package holidays** are out because an operator assembles and prices
  the bundle as a whole. The hotel inside it is not inventory we can anchor on,
  so asking for one by property code is asking the wrong question.

Three places enforce it, deliberately, because a config can arrive from a legacy
save or a hand edit rather than from the picker:

- `searchFromConfig` narrows the upstream ask with `packageType:
  'DynamicPackages'`, never `Any`, which is what would let operator packages in.
- The engine coerces any non-Accommodation type to `DynamicPackages` before it
  asks the cache, so a stale config gets an honest answer rather than an
  unexplained empty widget.
- The editor and demo pickers offer the two values and no others.

**One subtlety worth not breaking.** The swept `type` stays the FAMILY name
`Packages`, because `normaliseOffers` stamps it onto the stored offer and
`cached-offers.js` separates a dynamic package from an operator one with
`packageKindOf` at read time, exactly as it does for the country pool. Stamping
`DynamicPackages` on the stored offer would make every cached package invisible.
`packageType` on the payload is what does the narrowing. There is a test for
this.

**One property, one key, up to two requests.** A hotel-only widget and a
dynamic-package widget want genuinely different products from the same property,
and neither ask is a superset of the other, so the cron sweeps each type the
account actually asked for and pools both into the one key. Demand-driven, so
the common case is still one request per property. The per-run ceiling counts
requests rather than properties, so an account running both kinds cannot quietly
double the budget. A partial failure still stores what came back, so a hotel
widget does not go blank because the package request timed out.

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
Offers scopes by place; TTI Offers scopes by property. Everything after the
fetch — six templates, the popup engine, seven dedupe strategies, the currency
layer — is identical, so a fork would mean fixing every future template bug
twice. `/widget-tti-offers.js` is a `vercel.json` rewrite onto the same file,
which keeps the one-div-one-script embed contract and injects no script. The
engine auto-inits on both tags and exposes `window.TGTtiOffersWidget` as an
alias of the same class.

The seam is one function, `_cachedOffersQuery`. A config carrying `ttiCodes`
sends `tti` and `appId` and **does not send `destinations`** — a widget that
named twelve hotels must never fall back to showing a country.

**This is its own cache, not the main one.** The TTI Offers pool lives under
`offers:tti:` and touches nothing in the country pool (`offers:packages:{CC}`,
`offers:extra:{CC}`, `map:offers:v1`) that Travel Offers and the world map read.
Filling one never fills or disturbs the other. The world map cron gained four
`export` keywords and no behaviour change.

**Cache keys.** `offers:tti:{appId}:{code}`. Keyed by App ID as well as code
because each client's properties are swept under their own Travelify
application: two agencies asking about one hotel get their own contracted rates,
and a shared key would make the teaser price and the booking price disagree.

**The property list is two fields** (Andy, 14 Sep 2026): the Travelify property
code, and the two-letter country. Nothing else is asked for. The code picks the
hotel; the country is the area the sweep searches before the `refn` pin narrows
it. Each hotel is one row of two inputs in the editor, and **a row without both
is held back from the save**, because a worldwide search the verify gate then
discarded is exactly the wasted Travelify capacity the cache-only rule exists to
prevent.

`buildTtiPayload` still accepts `loc`, `lat` and `lng` and will use them when
present, so a config saved before this change keeps its tighter area. Nothing
writes them now. Because the area is a whole country rather than a city,
`MAX_OFFERS_PER_PROPERTY` is the standard 250 band: a ceiling that costs nothing
if the pin is honoured, and the pool the verify gate has to find the property in
if it is not.

**The Test button froze on its first real use, 14 Sep 2026, and the cause is
worth remembering.** `esc()` was called six times in an editor that never
defined it and does not inherit one (the shell's `escapeHtml` is private to its
closure). So the render threw, the catch block threw again while trying to
report the throw, and the output sat on its own progress message with no error
anywhere. Every test passed throughout, because they read source text and can
only confirm a call is PRESENT, never that its target exists. There is now a
test that scans the editor's inline script for called names that are never
defined, and a second test that removes `esc` to prove the first one still bites.

Two related fixes went in alongside it. `api/tti-test.js` had no `functions`
entry in `vercel.json`, so it got Vercel's default duration, which was shorter
than its own 12s timeout: the platform would kill the function mid-flight and
return an empty-bodied gateway response rather than per-code results. It now
declares 60s and its own budget sits inside that. And the browser keeps its own
45s deadline, so the button always comes back whatever the server does.

**The Test button** (`POST /api/tti-test`) runs the codes against Travelify for
real, so an agent learns now whether a code returns anything instead of from an
empty widget the next morning. It reports, per code: `found` with the hotel name
and a from-price, `area-only` when the search worked but nothing was that
property, `empty`, or `failed`.

This is the one place in the product where an agent action spends live Travelify
searches, so it is fenced: authenticated, at most 10 codes a click, low
concurrency, a short timeout, and its own tight rate limit which the
trusted-preview relax deliberately does NOT apply to (it is called from the
editor, so relaxing there would switch the limit off). The App ID is resolved
server-side from the caller's own account and never read off the request body,
so nobody can test against another client's application and see their rates.

It also answers the open `refn` question as a side effect: if every code comes
back `area-only` with a healthy area count, the feed is ignoring the pin, and
the response says so in `pinLooksIgnored`.

**The sweep asks the way a DP deep link asks.** The nightly payload mirrors a
dynamic-package deep link parameter for parameter: the package type, the
departure points (`origins`, several in one request so they cannot multiply the
budget), and the property anchor. The first candidate the probe tries is the
WHOLE anchor a live Travelify link carries, verified against one their own
generator produced on 22 Jul 2026: `loc` the hotel name, `loct=Property`,
`ctry`, `lat`/`lng` with `rad=1`, and `refn=TTI:{code}` together. That
combination is the likeliest to work precisely because it is the one proven to
resolve, rather than any single part of it.

**Canonicalisation is the load-bearing invariant.** `canonTti` appears in four
places — `api/_lib/offers/tti.js`, `api/cached-offers.js`,
`public/widget-offers.js` and `public/editor-tti-offers.html`. The cron writes
the key the widget reads, so a difference in any one of them is not a bug that
degrades, it is a total silent miss on every TTI Offers widget in the estate.
`npm run test:tti-offers` asserts all four carry the same pattern.

---

## Files

| File | What it does |
| --- | --- |
| `api/_lib/offers/tti.js` | The pure logic: code canonicalisation, the property list parser, the search shape, the payload builder, the verify gate. Dependency-free so it is testable. |
| `api/cron/refresh-tti-offers.js` | The nightly job and the probe. Reads TTI Offers widgets from Airtable, resolves each owning account's App ID, sweeps, verifies, stores. |
| `api/cached-offers.js` | Gained a `tti=` + `appId=` mode that reads the per-property pool instead of the country pool. |
| `public/widget-offers.js` | v1.20.0. The TTI branch, the second tag, the alias global. |
| `public/editor-tti-offers.html` | The editor. The destination chips became a property list; templates are layout-only presets. |
| `public/demo-tti-offers.html`, `public/tour-tti-offers.js` | Demo page and guided tour. |
| `test/tti-offers.test.mjs` | 37 tests. `npm run test:tti-offers`. |

The world map cron gained four `export` keywords and nothing else. Its parser is
imported rather than copied, so both jobs write one cache shape and
`cached-offers.js` rebuilds both pools with the single `toRawShape` it already
had.

## Registration

Done, including the parts that are usually manual:

- `ALLOWED_WIDGET_TYPES`, `PLAN_WIDGET_LIMITS` and `NEEDS_APP_ID` in
  `api/widget-config.js`. TTI Offers receives the App ID because its cache key
  is built from it, and `agencyName` because it renders the same Dynamic Package
  cards. It is **not** given an API key: it is cache-only from birth.
- Dashboard registry entry in `public/index.html`, sharing the offers tile mock.
- Airtable `WidgetType` option `TTI Offers` (`selGpC0zS9myl4OT4`), added via a
  typecast write rather than by hand, plus a Widget Catalogue Status record.
- `vercel.json`: three rewrites, one header block, and the nightly cron at
  02:30 UTC, well away from the map cron's ten-minute rotation.

**Plan access: Ignite and Bespoke only** (Andy, 12 Sep 2026). Spark and Boost
are locked. Unlike Travel Offers, which reads a cache we fill for everyone
anyway, every property on a TTI Offers widget costs its own Travelify search
every night.

## Volume

Roughly (properties × accounts × the product types they asked for) requests per
night, which for most accounts is one request per property. Capped at 100
properties per widget and 1,500 requests per run, so a pasted spreadsheet cannot
become an unbounded bill. A run that hits the ceiling reports `truncated`, and
the run stats separate `properties` (cache keys touched) from `requests` (what
actually costs us Travelify capacity).

## Next steps

1. Get the property parameter from Travelify, or run the probe against a real
   account, and set `TTI_PROPERTY_PARAM`.
2. Watch the first full sweep: `tti:offers:lastSweepStats` carries per-run
   tallies, and `suspectParam` flags a parameter being ignored.
3. Decide whether a hotel with no availability should stay hidden (current
   behaviour, and what Andy chose on 12 Sep 2026) or show an enquire state. The
   second is a different product and needs a card state designing across all
   templates.
