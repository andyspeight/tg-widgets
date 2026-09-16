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

## How a client gets it (and the bug that stopped them, 16 Sep 2026)

TTI Offers is sold on no package. Every tier in `PLAN_WIDGET_LIMITS` reads 0,
so the ONLY way in is a direct grant: an enabled Client Entitlements row in
Control sourced **Add-On** or **Manual Override**. MT Holidays
(`recO0O3LMBvScaPb0`) holds exactly that against the catalogue item
`rec6S3tManU6YoTKj` ("TTI Offers", active).

Andy, setting it up for them: *"it is saying it's not part of their plan, but I
have checked in control, and it is marked as available to them."* Control was
right and the code was wrong. The entitlement gate in `api/widget-config.js`
ran inside `if (!isStaff && clientId)`, so for a staff member the whole block
was skipped, and with it the working out of the grant. `grantedDirectly` stayed
false, the plan map said 0, and the save was refused. The client could have
saved the widget that the person setting it up for them could not.

The rule now: **a staff bypass is one-directional.** It can skip a block, never
a grant. Control is read for everyone; only the refusal is staff-exempt. The
same question is asked by the Duplicate button, which previously read the plan
map alone and would have refused a copy of a widget the client had been granted.

One place answers it, exported from `api/widget-config.js`:

- `hasDirectGrant({ clientEntitlements, catalogueItemId, clientId })` — pure.
- `readControlAccess(clientId, widgetType)` — the live read, never throws.

Guarded by `npm run test:direct-grant`. When TTI Offers goes on sale, set the
tiers in `PLAN_WIDGET_LIMITS` and add it to the package in Control; the grant
keeps working either way.

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
departure point, and the property anchor.

One correction to that mirroring, measured on 14 Sep 2026: a deep link carries
`org` as a list, but the API does NOT. Its flight criteria take `Legs`, a leg
carries a single origin, so **a package is one search per departure airport**.
Three airports is three searches and three prices, not one wider question. That
is a straight multiplier on the nightly bill, which is why both callers cap it
(`MAX_ORIGINS` = 3 in the test button, `CRON_MAX_ORIGINS` = 3 in the sweep) and
why `dpOrigins()` exists to hand out the capped, deduped list.

The anchor's shape was CORRECTED on 14 Sep 2026 by two real deep links Andy
supplied, one DP and one accommodation-only. Both pin a property like this:

    st=Accommodation &loc=Dubai,+United+Arab+Emirates &loct=City
      &lat=25.049 &lng=55.118 &rad=28 &dur=7 &refn=TTI:12345 &adt=2

The location is the CITY at city scale, and the property is pinned by
`refn=TTI:{code}` alone. There is no `loct=Property` and no 1km pin: `refn` is a
refinement laid over an ordinary area search, not a location type. An earlier
draft of this document described the opposite, from a link read on 22 Jul 2026,
and `buildTtiPayload` was built to it. If you find `loct=Property` written
anywhere, it is stale.

**The Test button now says WHY, not just that it failed.** `area-only` was an
honest answer and a useless one: it left the agent assuming they had mistyped
the code. When the ordinary search cannot find a property, `/api/tti-test` runs
two extra diagnostics on that ONE property, and the editor puts both in plain
English:

- `pinProbe` re-asks for the same hotel several ways — first with NO pin at all
  as the control, then each remaining spelling in `PROBE_CANDIDATES`. If every
  version returns exactly the same offers, `refn` did nothing and the answer is
  `pinIgnored`: the feed searched the whole country and the hotel simply was not
  in the cheapest slice that came back. If one spelling finds the property, it
  is named as the `winner`, which is the answer to the open question above —
  set `TTI_PROPERTY_PARAM` to it and the sweep uses it that night with no code
  change. Bounded: one property per click, at most five extra requests, a 9s
  timeout each and a 38s wall it will not cross.
- `deeplink` follows the actual deep link for that hotel server-side and reports
  the status, the redirect chain, the content type and whether the body is
  machine readable. Andy's position (14 Sep 2026) is that the deep link is the
  only correct way to run this search; this measures it rather than arguing it.
  Diagnostic only — nothing in the product reads offers through a deep link.

**Canonicalisation is the load-bearing invariant.** `canonTti` appears in four
places — `api/_lib/offers/tti.js`, `api/cached-offers.js`,
`public/widget-offers.js` and `public/editor-tti-offers.html`. The cron writes
the key the widget reads, so a difference in any one of them is not a bug that
degrades, it is a total silent miss on every TTI Offers widget in the estate.
`npm run test:tti-offers` asserts all four carry the same pattern.

It strips ANY `LETTERS:` namespace, not just `TTI:`. A live GB search on
14 Sep 2026 returned `ID:30924133` alongside `TTI:` references, and the earlier
`TTI:`-only strip rejected those outright: a hotel whose reference came back
under a different namespace could never match the verify gate, and the Test
button reported it as "not this property". The key segment is still validated by
the `^[A-Z0-9][A-Z0-9._-]{0,31}$` pattern, which is what actually keeps the
Redis namespace safe.

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
| `api/tti-test.js` | The editor's Test button. Checks a list of codes live, and when one cannot be found runs the pin probe and the deep link probe to say why. |
| `test/tti-offers.test.mjs` | 65 tests. `npm run test:tti-offers`. |

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

## How this should actually be built (14 Sep 2026, from the API docs)

Andy supplied the Travelify API documentation and it settles the design. Two
things were wrong before it arrived, and one of them was a plain bug.

**The bug: the search session was being split.** A session is returned as
`{searchId}/{searchKey}` — an integer, a slash, then a guid — and the whole
thing goes into the path. The probe took the integer and threw the guid away,
so `GET /search/40767552` answered "Unrecognised API method". The correct call
was always `GET /search/40767552/{guid}`. The docs list this exact mistake as a
common pitfall. Nothing was blocked, nothing was undocumented, and the endpoint
had been answering correctly the whole time.

**The design: the nightly job does not need a deeplink at all.** `POST /search`
opens a search session directly, server to server. The deeplink is how a
VISITOR reaches a booking funnel, and it stays exactly where it is for the click
through on an offer card. The sweep just calls the API.

### The flow the sweep should use

    POST /search                        -> returns searchSession "{id}/{key}"
    GET  /search/{id}/{key}?reloadAll=true&version=4
                                        -> poll until completed >= total

Rules that matter, all from the docs:

- Poll at least 1 second apart, 30 polls maximum. Hitting it harder returns
  nothing faster.
- Each poll returns only NEW results since the last one. Pass `reloadAll=true`
  on the first poll to get everything collected so far.
- Always check `success` in the body. A 200 with `success: false` is a failure
  and the reason is in `errors[]`.
- Accommodation results come back in `accommodationResults`.
- `417` means a supplier-side business error (sold out, unavailable), not a bug
  in our request.

### Authentication (settled, Andy 14 Sep 2026)

**Token auth with the existing PUBLIC key.** No private key, and none needs to
be added to the environment:

    Authorization: Token {ApplicationID}:{PublicAPIKey}
    Referer: https://localhost/

The Referer is not decoration. Token auth 401s without one, and
`https://localhost/` is the value to send. The same public credentials the
widgets already use are the ones the sweep uses, resolved per client exactly as
`/api/offers` and `api/_lib/travelify.js` already resolve them.

### What the editor collects: a code and a country

Two fields per hotel, as Andy specified from the start.

This was briefly built to demand coordinates, which was a mistake worth writing
down. The evidence for it was a `406` from a DEEPLINK carrying `ctry` and no
coordinates. That is a different surface from this API, and the requirement was
never tested here. `Ref` pins the property — so the property IS the location,
and the country only says which part of the world to look in. The worked example
carries coordinates because it came from somebody searching a town in a UI, not
because the field is mandatory.

So `buildAccommodationCriteria` sends what it has. A code and a country is a
complete ask. Coordinates are omitted entirely when absent (omitted, not zeroed
— 0,0 is a real place in the Atlantic) and narrow the search when a row has
them. If the service does turn out to need them it will say so, and the error
reaches the agent verbatim rather than being pre-empted by a guess.

The editor also takes a pasted deeplink as an OPTIONAL extra: a working link
carries the code, the country and the exact coordinates, so pasting one fills a
row and narrows it to the town. Nobody has to.

### It works, end to end (14 Sep 2026)

Andy ran a real test and got a real cached offer rendering in the widget:
**Hilton Bournemouth, £861, 7 nights from 14 October, with its photos.**

The field that scopes a search to one property is `Ref` on
`AccommodationSearchCriteria`, carrying `TTI:{code}` — the same value the
deeplink spells `refn`. And a code plus a country is enough: coordinates are
optional and only narrow it.

### The search client

`api/_lib/offers/travelify-search.js` carries the transport, with 16 tests
(`npm run test:travelify-search`). It exists as its own module because the rules
it encodes are the ones that fail silently rather than loudly:

- **A session is one path segment.** `{searchId}/{searchKey}` goes into the URL
  whole. Splitting it is what cost 14 Sep 2026.
- **Results accumulate.** Each poll returns only what is NEW since the last one,
  so taking the final poll as the answer would cache a fraction of the search
  and look like a thin hotel rather than a bug.
- **`success: false` on a 200 is a failure.** Reading the status code alone is
  the easiest way to mis-read this API.
- **A partial result is still a result.** Running out of polls keeps what
  arrived, because a sweep that discarded it would cache nothing on a busy
  night. `complete` says whether it finished.
- A mid-flight poll failure is survivable and retried; an expired session is not
  and stops at once. A 417 is flagged as supplier-side so a sweep does not keep
  retrying a sold-out property.

### What is built

All of it, and the nightly sweep is on the same path as the Test button.

- The search client, the criteria builder, the result normaliser, the
  per-property cache write, the editor, the widget read path. Proven: Andy
  watched a real Hilton Bournemouth offer cache and render.
- `api/cron/refresh-tti-offers.js` now runs that same search. It carries the
  API key as well as the App ID, because Token auth needs both.
- Dynamic packaging. The hotel half is IDENTICAL to a plain accommodation
  search — a test compares the two objects — and only the flight half is new.

  The first attempt sent a flat `Origins` / `DepartDate` / `ReturnDate` lifted
  from the deeplink, and Travelify corrected it by name, which is the same loop
  that settled `CustomerIP`:

      FlightSearchCriteria - Legs: You must specify at least one flight leg
      FlightSearchCriteria - Passengers: You must specify at least one passenger

  So the flight is a JOURNEY. Two legs bracket the stay (out on the check-in,
  back on the check-out) and the passengers mirror the room's `Guests`. What
  that answer confirmed on the way past: the request reaches Travelify, the
  auth and the whole accommodation half are accepted, and
  `SearchType: 'DynamicPackaging'` is understood.

  **Every field name here has been quoted back at us by Travelify.** That is
  the bar, and it was set by getting it wrong. The alias round sent each value
  under every plausible spelling at once — safe, because the service reports
  what is missing and ignores what it does not recognise. The reply named two:

      Legs[0] - DestinationCode: Unrecognised 3-letter airport/city code: GB
      Legs[1] - OriginCode: must be a string, min length 3, max length 11

  It said nothing about the date, because one of the three date aliases was
  right and the field never errored. **Silence is not confirmation.** Trimming
  the date to `DepartureDate` on house-style reasoning deleted the alias that
  was doing the work, and the next round said so by name:

      Legs[0] - DepartDate: Date must be set and not be in the past

  So a leg is `{ OriginCode, DestinationCode, DepartDate }`, and the rule is:
  **only delete a spelling the service has named, never one it merely did not
  complain about.** A test reads the leg builder and fails if it grows a field
  outside that set. `Passengers` mirrors the room's `Guests`
  (`[{Type:'Adult'}]`) and has drawn no complaint since it was added.

  **A package never departs in the past.** `leadDays` clamps to `[0, 330]` and
  0 means today at 00:00 UTC, which is behind us for all but the first instant
  of the day. A hotel search takes that happily — same-day booking is a real
  thing to sell — but Travelify refuses the whole package for it, with the
  *same message* a misnamed field produces. So a package floors the lead at
  `MIN_DP_LEAD_DAYS` (1) for the whole search, room included, since moving the
  flight to tomorrow while the room checks in today would price a package that
  does not hang together.

### A package needs an airport to fly INTO, and a TTI row has no airport

The same rejection carried the other half of the answer: **a country is not a
place a plane lands.** `GB` was refused outright. But a TTI row is a property
code and a country — an agent never types an airport — so the arrival airport
has to be resolved. `api/_lib/offers/arrival-airport.js` does it, and **spends
no search**:

1. a code the agent pinned in the row's **Fly into** box, or a pasted DP
   deeplink's own `dst` (Andy's read `dst=AE1`, which is exactly this field);
2. coordinates already on the row, from a pasted deeplink;
3. coordinates in **this property's own cache** — free, and already there for
   any hotel that has been tested once, which is the common case;
4. the country's busiest hub, for a property we have never seen.

Nothing left means **no package**, not a search into nowhere.

**The list is `api/_data/airports-arrivals.json`** — every large or medium
airport worldwide with scheduled service and an IATA code, *with coordinates*,
from OurAirports. Built on 14 Sep 2026 for this job, because neither existing
list could do it: `airports-departures.json` has 3,242 airports and no
coordinates, `airports.json` has coordinates and only 106 majors. So a hotel in
Bournemouth resolved to **Bristol, 95km away**, while Bournemouth Airport sat in
neither usable list (Andy: *"why is it choosing Bristol when there is an airport
in Bournemouth?"*). That was a gap in the data, not a judgement about the
airport. Rebuild with `scripts/build-arrival-airports.mjs` — the sandbox reaches
`raw.githubusercontent.com` but not the `github.io` mirror, and the script
refuses to write a list that has shrunk or lost a curated major.

**The curated majors are still loaded, for the one thing OurAirports lacks.**
It has no passenger numbers, so "large airport" is a runway-and-service
classification, and its ordering is alphabetical inside that. Two real bugs
came from trusting it alone:

- Dubai resolved to **DWC** (Al Maktoum, 18km, near-empty) over **DXB** (34km).
- Great Britain with no coordinates resolved to **ABZ**, because Aberdeen sorts
  first alphabetically among GB large airports.

So `airports.json` supplies *which airports are real hubs* and *a country's
main airport*, and a hub within `HUB_BONUS_KM` (50km) of the genuinely nearest
airport wins. Bournemouth keeps BOH at 7km because Bristol is far outside that
window; Dubai takes DXB because it is only 16km further than DWC.

**A nearby bigger airport is offered, never substituted.** A small airport has
thin routes, and a package from Aberdeen to Bournemouth may simply not exist
while Aberdeen to Gatwick does. That is a real supplier answer rather than a
bug, so the panel names the alternative and the agent switches with one box.
Choosing it for them would quote a package from an airport nobody asked about.

**Same country beats raw distance.** A hotel on the Côte d'Azur is nearer an
Italian airport than a French one often enough to matter, and landing in the
wrong country is wrong in a way a price cannot show. Only a country with no
airport of its own in the list falls through to nearest-anywhere.

**(0,0) is a real place, and everything upstream turns a missing coordinate
into it.** The editor sends `lat: null` for a row with no coordinates — `NaN`
does not survive JSON — and `Number(null)` is **0**: finite, in range, and in
the Gulf of Guinea. A Bournemouth hotel therefore resolved to Newquay, 5,629km
away, which is exactly the distance from null island to Cornwall (Andy,
14 Sep 2026). `cleanCoord` has rejected zero since the day it was written; one
call site in `api/tti-test.js` was using raw `Number()`. The resolver now
refuses (0,0) as well, whoever calls it.

**A widget is selling a package unless its type is exactly `'Accommodation'`.**
One rule, in `isPackageConfig` in the editor and mirrored in the widget and the
test route, matching `searchFromConfig` on the server. Testing for the literal
`'DynamicPackages'` treats a config saved as `'Packages'` as hotel-only while
the type select still displays Dynamic packaging.

**The hotel rows are a fixed 3-column grid.** A package widget adds a fourth
control (Fly into), so the row takes `.has-dst` and a fourth column. Without it
the new input was laid into the 28px delete-button cell and read as no box at
all.

**The choice is shown, and overridable.** The Test panel names the airport, how
far it is from the hotel, why it was picked, and the bigger alternative if
there is one. The **Fly into** box on each row is the override, saved with the
config and carried into the nightly sweep. It only appears on a package widget.

**Both functions that read the list declare it in `vercel.json`
(`includeFiles`).** A file read through `new URL(..., import.meta.url)` only
ships if Vercel's tracer finds it, and it loads fine in every local test —
which is what makes that class of bug expensive. A test pins it.

- **A package is stored AS a package, in the fields the product already uses.**
  `type: 'Packages'`, `packageType: 'DynamicPackages'`, and the departure
  airport in `origin`. Nothing bespoke. That one decision is what makes the
  rest work with no new code:

  - `cached-offers.js` keys `hasFlight` off `origin` and builds a real
    `flight.origin.iataCode` block from it;
  - `typePredicate('DynamicPackages')` matches it;
  - the existing package card draws the **Flight + Hotel** badge and the
    departure code;
  - the widget's existing `hotel` dedupe (already the default) folds one hotel
    priced from three airports into one card, cheapest kept, with the "+2 more"
    count the card already renders.

  The first attempt instead invented `includesFlights` and `departureAirport`
  on an `'Accommodation'` offer and hand-wrote a fold to go with it. Nothing
  downstream could recognise that as a package, so it rendered as a hotel with
  an unexplained price — and the hand-written fold was dead code, because it
  was written against the STORED shape while the widget sees the WIRE shape.
  Deleted. Use the platform's fields.

- **Three places must agree on the type, or a full cache reads as empty.** What
  the sweep stores, what the widget asks for, and what the editor's preview
  strip counts. They have drifted twice. A test now pins all three together.

### What a package card needs, and where each piece comes from

The card template already draws all of this. Everything below was a MISSING
FIELD, not a missing feature — the first real package rendered with the bare
word "Travellers", no departure airport and no board basis (Andy, 14 Sep 2026).

| What the card shows | Field on the cached offer | Where it comes from |
|---|---|---|
| "2 adults" | `adults` / `children` / `infants` | the Guests we actually searched for |
| "GLA → TFS" | `origin` **and** `airport` | the departure airport and the resolved arrival |
| "Departs … Returns …" | `outboundDate` / `returnDate` | the two flight legs |
| "7 nights · All Inclusive" | `nights` / `boardBasis` | `units[0]` on the result |

**The flight line needs BOTH ends.** It is `fromCode → toCode` and is skipped
entirely unless both are known, so storing only `origin` meant the card never
said where it flew from at all.

**A missing board basis is reported.** `unmapped` now names it, because a card
with no board reads as a hotel that has none. The first real package came back
without one while its `units[0]` did carry nights and a check-in date, so the
field is either absent on that shape or named differently; the normaliser looks
in six places and says so when it still cannot find it.

### An island hotel must not fly to the capital

A country hub is a fair answer for a mainland property and a bad one for an
island: a hotel in Santa Cruz de Tenerife resolves to **MAD** on the country
alone, 1,700km from the bed. So a DP row we cannot place gets ONE cheap
accommodation search first, purely to read its coordinates — the same search the
hotel-only widget runs, and it fills the cache on the way past so this never
happens twice for the same property. Capped at `MAX_LOCATE` and deadline
checked, because it spends a real search. With coordinates, Tenerife resolves to
TFS with TFN offered alongside.

### The country on the row is a hint; the supplier's answer is a fact

A hotel in Tenerife entered with `ctry=GB` searched British airports, so the
nearest was **Newquay at 2,620km** — correctly computed and entirely wrong,
which is what made it look like a distance bug rather than a country one (Andy,
14 Sep 2026). Both callers now take the country from the PROPERTY once they have
it: the test route from the located search result, the sweep from the cached
offer. The agent is told their row disagrees, because the typed country is what
every other search for that property uses until it is corrected.

**An airport the agent typed is the answer, full stop.** The locate step used to
be queued on missing coordinates alone, so a row carrying an explicit Fly into
was located anyway and the computed airport replaced the typed one. Typing TFS
changed nothing at all, which is the worst way for an override to fail.

### The flight shape, MEASURED (16 Sep 2026)

A flight is **`routes[]`** — one per leg, tagged `Outbound` and `Inbound` — and
each route is **`segments[]`**, one per hop. Everything a card shows lives on
the first segment of the outbound route, not on the flight itself, which is why
carrier and stops came back unmapped on every test until a real result arrived.

| Field | Real path |
|---|---|
| carrier / code | `routes[0].segments[0].marketingCarrier.{name,code}` |
| flight number | `…segments[0].flightNo` |
| cabin class | `…segments[0].cabinClass` |
| departs / arrives | `…segments[0].depart` / `.arrive` — **with a time** |
| returns | the `Inbound` route's first segment `depart` |
| duration | `routes[0].duration` |
| price | `pricing.price` |

**Stops are counted, not read.** A change of plane is another segment; a
technical stop keeps the flight number and appears as `touchdowns`. Both are a
stop to somebody choosing a holiday, and neither is reported as one. `direct` is
set only when stops are actually known — "we could not tell" must never become
"it is direct".

**The flight's own times beat the criteria dates.** We ask for
`2027-04-09T00:00:00Z`; the aeroplane leaves at 14:35. A departure board renders
a time column, and 00:00 on every row reads as broken.

### A package settles more slowly than a hotel

The same file came back **`complete: false` at 8 polls with ONE flight
collected**. So "cheapest of 1 flight" was our poll cap, not a thin route — and
the cached price may not have been the cheapest on offer. The hotel half settles
quickly; the flight half is still arriving.

`DP_MAX_POLLS` is 12 in the editor (the route deadline is still the real guard)
and `CRON_DP_MAX_POLLS` is 18 in the nightly job, which has the time the editor
does not. Polling longer is not a guarantee, so **an unsettled price is
labelled**: the panel says a cheaper flight may exist and invites a re-test.

**Still unconfirmed:** whether `pricing.price` on the flight is the total for
the party or per person. The accommodation price is clearly the room total — the
unit sleeps two and the price is one number — and the flight is the same field
name in the same search for the same two passengers, so total is the reading
taken. If it turns out to be per person, every package is under-priced by the
flight. One quote against a live booking settles it.

### The result shape, MEASURED (16 Sep 2026)

A real accommodation result, downloaded from the Test panel. Everything below is
read from it rather than inferred, and the normaliser now reports nothing
unmapped against it.

**The board basis belongs to the RATE, not the result.** Eight units, each with
up to three rates (BedAndBreakfast / HalfBoard / AllInclusive) at different
prices, and `pricing.price` is the cheapest of all twenty. So there is no "board
basis of the result": it belongs to whichever rate produced the headline number.
`rateForHeadline()` matches on price rather than assuming `units[0].rates[0]`,
which is self-verifying — a changed shape reports a gap instead of confidently
showing All Inclusive on a card priced for bed and breakfast.

| What the card shows | Real path | What was guessed |
|---|---|---|
| board basis | `units[].rates[].board` | `units[0].boardBasis` (never existed) |
| check-in | `units[].checkin` | `units[0].checkinDate` (never existed) |
| refundability | `pricing.refundability` | `units[0].refundability` |
| review count | `review.reviews` | `review.count` |
| room name | `units[].name` | not mapped at all |

Two display facts from the same file: `chain` comes back as the literal string
**"No chain"** when there isn't one, which printed as a line on the card; and
the city comes back **shouting** (`"TENERIFE"`), which reads like an error
message next to a country code. Both handled.

**The flight half is still unmeasured.** `flightResultCount: 1` came back with
`flightResult: null`, because `alsoFirst` was renamed when the poller started
keeping the flights rather than counting them and the raw capture was not moved
with it. Fixed, and the panel now reports `Fields on the flight:` the same way
it reported the hotel's — which is precisely how the hotel half came to be
mapped exactly rather than guessed.

### Every hotel that needs placing gets placed

Andy, 16 Sep 2026: four hotels in Tenerife, one date, and two came back *"no
flights available"* — *"which isnt possible as all the hotels are in the same
place"*. He was right: they were not the same search.

`MAX_LOCATE` was **2**. Hotels three and four were never located, so they fell
back to the country's hub — **Madrid** — and Travelify will not pair a Madrid
flight with a Canaries hotel, so no flights came back. Two of four identical
hotels looked unavailable.

Worse than slow: an unplaced hotel prices no package, so nothing is cached, so
it is never placed on the next run either. **Permanently broken, not
temporarily.**

Three changes:

- `MAX_LOCATE` is now `MAX_CODES` — never lower than the number of hotels a run
  may test — and the locates run in parallel, because five one at a time would
  eat the route budget before a single package was priced.
- The position is remembered in its own key, `tti:geo:{appId}:{code}`, for a
  year. The offers key only holds coordinates when a package priced, which is
  no use to the hotel that never priced one. Both the test route and the sweep
  read it before spending a search.
- **A package we could not place is refused, not flown to the capital.** A
  country hub is a guess, and a wrong one returns "no flights available", which
  is indistinguishable from a real supplier answer. Saying we could not place it
  is worse news and better information, and it names the fix: put an airport in
  Fly into.

### A test searches as the WIDGET'S OWNER

Andy, 16 Sep 2026: *"When acting as it needs to use the owner of the App — in
this case MT Holidays."* Not a preference — the only answer that works.

Every other part of the product already resolves the owner from the widget's own
`ClientRecordId`: `widget-config.js` injects `config.appId` from it, the nightly
sweep runs under it, and the cache key is `offers:tti:{appId}:{code}`. A Test
button that searched under the SESSION's account instead would write to a key
the live widget never reads — the agent sees a price, the site shows nothing,
and the panel reports that the cache write did not land. It would also price the
offer at the wrong client's contracted rates, which is a commercial error rather
than a cosmetic one.

`api/_lib/offers/widget-owner.js` resolves it, and both `/api/tti-test` and
`/api/tti-appid` use it — they must agree, or the preview reads a different pool
from the one the test just wrote.

**Permission is checked, not assumed.** Resolving by widget id means the widget
id decides whose credentials get spent, so the caller must be entitled to that
widget or anyone could burn another client's Travelify capacity and read their
rates. `canModifyWidget` is reused rather than reimplemented: two ownership
rules is one ownership rule and a bug waiting to be found.

**A lookup that could not be made never falls back to the session.** "We could
not ask" and "there is no such widget" must not collapse into one value, because
the fallback for the second is the session's own account — precisely the
wrong-client search this removes. Same for an owner whose account has no
Travelify application: refused, not substituted.

**An unsaved widget uses your own account, and says so.** A widget with no id
can only belong to whoever is making it. The panel names the account on every
test (*"Searched as MT Holidays on Travelify App ID 475"*), because a staff
member acting for a client cannot otherwise tell.

### One hotel is a block, not one long line

The editor panel is about 300px wide. Four controls across it left the code
field around 20px and pushed the delete button off the edge (Andy, 16 Sep 2026:
*"with three fields you can't see them all"*). A hotel row is now:

    [ property code .................... ] [x]
    [ GB ] [ travel date ] [ fly into ]
    (location hint, only when there is one)

The three short fields **wrap**: on a wide panel they stay on one line, on a
narrow one the arrival airport drops below. Each carries a `min-width`, because
wrapping without one just moves the problem. Neither optional field has a
visible label, so the help text above the list names both.

### The editor had its own null island

Every saved row reported its location as **0.000, 0.000**. `syncTtiConfig` wrote
`lat: Number(r.lat)` for every row — `NaN`, which JSON stores as `null` — and
the next load read `Number(null)`, which is **0**: finite, in range, and a real
place in the Gulf of Guinea. Same bug as the server had, in the other half of
the app. `coordOf` in the editor now mirrors `cleanCoord`, a test asserts the
two agree, and coordinates are only written when they are real rather than a
null being put in every row.

### Offers that travel on a specific date

Andy, 16 Sep 2026: *"some of the offers will be travelling on specific dates."*
A rolling "30 days out" cannot express a half-term departure, so there are now
three levels and the most specific wins:

1. **A hotel's own date** (`checkin` on the row, with optional `nights`) — the
   "some of the offers" case, one hotel pinned while the rest keep rolling.
2. **The widget's date** (`checkinDate`) — a campaign that all travels together.
3. **The rolling window** (`DatesMin`), for anything without either.

**A date that has passed refuses the search.** The supplier's answer to a past
date is nothing at all, which reads as no availability rather than as a stale
row somebody needs to fix. The editor flags it before a search is spent, and the
test route names the date rather than reporting a missing country.

**A fixed date is never nudged.** The package lead-time floor exists because a
rolling lead of 0 means today, which a flight cannot depart on. A date somebody
typed is a commitment, and shifting it by a day to make a search pass would
price a different holiday.

**A pinned widget stops sending a rolling date filter.** `DatesMin`/`DatesMax`
narrow the cache by days-from-today; the only offers in a pinned widget's cache
ARE that date, so a window is at best redundant and at worst excludes the very
offer the agent chose.

**Two widgets can name one hotel on different dates.** They share a cache key,
so the sweep merges searches on type AND departure — otherwise whichever widget
loaded first would decide the date for both and the second one's offers would
never exist.

**And the rolling window finally reaches the search.**
`buildAccommodationCriteria` has always read `leadDays`, and nothing ever set
it: `searchFromConfig` emitted `DatesMin` and the builder never looked at it. So
every search this product has run went out at the default 30 days, whatever the
editor said. `DatesMin` is the earliest date the widget wants, which is exactly
what a lead time is.

### A PACKAGE IS ALREADY PRICED, PER PERSON

Andy, 16 Sep 2026: *"If you are doing a DP search the price you get back is the
total holiday price per person — you don't need to be adding anything
together."*

So on a dynamic package, `accommodationResult.pricing.price` **is the holiday**:
flight and hotel, per person. `flightResults` describes the flight; it is not a
component to be summed.

- `pricePP` is Travelify's own number, untouched. It is the only authoritative
  figure and the one an agent quotes.
- `price` is that multiplied by the paying travellers, and nothing else. An
  infant holds neither a seat nor a bed, so it carries no per-person price.
- Not knowing the party size makes the total wrong **by a factor**, so it is
  reported as `travellers` in `unmapped` rather than quietly defaulting to one.
- A hotel-only search is untouched: its price is whatever the supplier returned
  for the room.

**This field has now been wrong twice, in opposite directions.** First the hotel
price alone was cached as the package price. Then it was hotel plus cheapest
flight, which double-counted — adding a flight to a number that already
contained one. Both readings were inferred from evidence rather than asked
about. A commercial question with a right answer somebody already knows should
be asked, not deduced; the evidence was consistent with both wrong answers.

The gate stays: **no flight means no package.** If `flightResults` is empty the
offer is refused rather than cached, because a hotel-only price behind a Flight
+ Hotel badge is the original fault this widget exists to avoid.

### The editor must show the cache as it is NOW

`/api/cached-offers` answers `s-maxage=120, stale-while-revalidate=300`. That is
right for visitors and wrong for the one person who has just replaced the data:
after a Test the panel read fresh results while the card beside it drew a CDN
copy from before them, so the text said Tenerife and the card said Newquay
(Andy, 14 Sep 2026). The editor sets `previewNonce` on the preview config and
`_` on its own read-back; the widget forwards it as a query param. **Only the
editor ever sets it**, so a live widget leaves the edge cache alone.

### Why a cached price does not move

Andy, 14 Sep 2026: *"no matter what you put in the price never changes."* True,
and unavoidable. Offers are cache-only, so:

- **Travellers, nights, the date window, origins, currency** decide what we
  SEARCH for. They cannot re-price what is already cached — only a re-test can.
- **Board basis, star rating, budget, duration** filter the pool that is already
  there, and take effect immediately.

The editor fingerprints the first group at test time and shows a notice when it
drifts, because without one the agent changes a setting, watches the card sit on
the old number, and reasonably concludes the setting does nothing.

### Known gaps on the package card

- **No carrier, stops or flight times.** We cache the accommodation result and
  only COUNT `flightResults`; nothing from the flight itself is stored. The card
  supports all three, so this is a storage decision rather than a template one.
- **The location line prints a country CODE** ("Santa Cruz, ES"). That is
  pre-existing behaviour across five templates of the main Offers widget, so
  changing it touches every client's cards, not just TTI. Andy's call.
- **The ATOL badge is unconditional on package cards** (by design, 10 Aug 2026:
  every flight-inclusive package is ATOL protected). Worth confirming the
  selling agent holds an ATOL before a TTI package widget goes live — Travelify's
  own docs say UK sellers must.

### The cron will not run without a customer address

`TTI_CUSTOMER_IP` on the deployment. Every Travelify search requires one and a
cron has no visitor to take it from.

**It is never invented.** The field feeds geo and fraud checks, so a wrong value
runs the whole sweep in the wrong market and caches prices for the wrong place —
which looks exactly like working. Unset, the sweep writes nothing and says why,
so the cache keeps whatever is in it. That is the safe direction, and it is why
the widget was not at risk the night it went live.

Worth asking Travelify what address they want for server-to-server searches,
since it decides which market the prices come back in.

### Who can have it

**Not sold on any plan.** Every tier is 0 in `PLAN_WIDGET_LIMITS` and in the
dashboard registry. The only way in is a DIRECT GRANT: an enabled Client
Entitlements row sourced `Add-On` or `Manual Override`.

That mechanism already existed and was only wired for contracting. Widgets now
honour it in both places that decide — `resolveEntitlements` for the dashboard
and the save gate in `api/widget-config.js` — so the two agree about who can
create what. A `Package Default` row is deliberately NOT an override: it only
mirrors the plan, and a stale one would keep granting a widget after the package
stopped including it.

MT Holidays (`recO0O3LMBvScaPb0`) holds the only grant. Catalogue item
`widget-tti-offers` (`rec6S3tManU6YoTKj`), active, in no package.

When it goes on sale: set the tiers and add it to the package in Control. The
grant keeps working either way.

### Things that failed quietly, and are now guarded

Every one of these looked like a different bug from the outside, and all of them
cost a round trip. They are the reason the tests are shaped the way they are.

- **`_defaults()` is a whitelist.** It rebuilds the widget config from named
  keys and silently drops the rest. `ttiCodes` was not on the list, so the
  widget did not know which hotels it had. That produced BOTH "it is showing
  lots of random offers" (no codes, so the query fell through to the destination
  branch) and "No offers available right now" (no codes, once that fallback was
  closed). A test now asserts every key the TTI path reads is one `_defaults`
  keeps.
- **The cached `type` must match what the widget asks for.** The sweep runs an
  Accommodation search; labelling the result from the widget's configured type
  cached a hotel-only offer as `Packages`, and the read filters on that field
  exactly.
- **A cached offer needs an `id`.** The read dedupes on `id|origin|type`, so
  offers without one all key identically and a twelve-hotel widget collapses to
  a single card.
- **Coordinates are stored as `resortLat`/`resortLng` too**, because that is
  what the read rebuilds `accommodation.destination` from, and the widget's own
  deeplink builder needs it to pin the property on a click.
- **The editor previews against the CLIENT's App ID**, not the demo 250 the
  plain Offers editor hardcodes. This cache is keyed by App ID; that one is
  keyed by country, which is why the copy was harmless there and silent here.
- **Editor pages carry `Cache-Control: no-cache`.** A stale editor reports bugs
  that were already fixed.

## Next steps

1. **Set `TTI_CUSTOMER_IP`** on the Vercel deployment when the nightly refresh
   should start running. Until then it skips, safely.
2. **Watch what thin routes do.** A hotel now flies into its own local airport
   where one exists, which is right, but a package from a distant city to a
   small field may return nothing. The panel names the bigger alternative and
   the Fly into box switches to it. If that turns out to be common, the rule to
   revisit is `HUB_BONUS_KM` in `api/_lib/offers/arrival-airport.js`.
3. **Decide what "from" means.** Every search is one stay, currently 30 days out
   and 7 nights, matching the `frd=30&dur=7` the deeplinks use. A true from-price
   across a spread of dates multiplies the nightly search count by however many
   dates are probed, so it is a budget decision rather than a code one.
4. **A hotel with no availability stays hidden** (Andy, 12 Sep 2026). An enquire
   state is a different product and needs a card state across every template.
5. **The old `Hotel Offers` WidgetType option** is still in Airtable, unused.
   The API cannot remove a select option, so it needs deleting by hand.
