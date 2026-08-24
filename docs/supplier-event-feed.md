# Supplier event feed — normalisation

Written 21 Aug 2026, from a full read of the "Supplier Event Listings" Google
Sheet (owner darren.swan@agendas.group, last modified 28 Jul 2026).

## What the feed is

A flat export of bookable ticket inventory from two suppliers. Seven columns,
one row per event, no blank cells:

```
Supplier | Event ID For Searchbox | Event ID For Filters | Event Name |
Start Date/Time | Venue Name | Venue ID
```

The 28 Jul 2026 export held 11,045 rows covering 28 Jul 2026 to 23 Jul 2027:

- SportsEvents365, 9,747 rows (88%), numeric ids, prefix `179:`
- XS2Event, 1,299 rows (12%), GUID ids ending `_spp` and `_vnx`, prefix `144:`

Football is 58% of it, then concerts, MLB, NHL, tennis and NFL. Volume is
front-loaded: 55% of the year falls in the first four months and June 2027
carries 87 events.

## What the pass does

`api/_lib/events/supplier-normalise.js` turns those rows into one record per
real-world event, keeping every supplier's booking ids so a widget can still
deep-link into whichever supplier it prefers.

```js
import { normaliseSupplierEvents } from './api/_lib/events/supplier-normalise.js';
const { events, venues, report } = normaliseSupplierEvents(rows, {
  notBefore: '2026-09-01',   // optional, the pass never reads the clock itself
});
```

Run it over a CSV:

```
node scripts/normalise-supplier-events.mjs feed.csv --out events.json --venues venues.json
npm run test:supplier-events
```

Against the 28 Jul export: 11,045 rows in, 10,087 events out, 959 duplicates
folded away, 958 venues, nothing rejected, about 0.5 seconds.

## The four things it exists for

**1. Truncated names.** The source caps event names at about 100 characters,
which cuts the trailing `(Category, Competition)` bracket in half on 101 rows.
Truncation is detected by parenthesis balance, never by length, because the cap
lands at 99 or 100 depending on multi-byte characters and a name cut at exactly
100 can still be balanced. One row reads

```
Session 9 - Grounds Admission Only (Tennis, US Open (tennis - Grand Slam)
```

which ends in a bracket but is truncated, and a backwards scan reads its
category as "tennis - Grand Slam". Cut fragments are repaired by prefix-matching
against the vocabulary of intact rows in the same batch. That recovers 74 of
them. An ambiguous prefix is left unresolved rather than guessed.

**2. Two taxonomies.** SportsEvents365 says `Football (Soccer) / English Premier
League`, XS2Event says `Football / Premier League`. Both resolve to
`english-premier-league` through `api/_lib/events/supplier-taxonomy.js`, which
holds every spelling seen in the export: 17 categories and 86 competitions.

Two traps live in that file. "Serie A" is Italy to XS2Event while
SportsEvents365 also carries "Brazilian Serie A", and "Bundesliga" is Germany
while "Bundesliga AT" is Austria. Aliases are resolved inside a category and
both pairs are mapped explicitly so they can never collide.

**3. Duplicate inventory.** 800 events are sold by both suppliers and the rest
are listed twice by one supplier under different event ids, 959 rows folded
away in total. They merge on an
identity key of category, date and normalised team names, with the sides sorted
so a reversed listing still matches. Only club-type tokens come off a team name
(FC, AFC, CF and friends) plus connector words like "de", never anything that
separates two real clubs, so Manchester United and Manchester City stay apart.

Club aliases go one step further where the competition proves them. A league
does not contain both "Ipswich" and "Ipswich Town", so inside one competition
two keys differing only by a mergeable suffix are folded: six pairs, including
Coventry, Atalanta and Real Betis. "united" is excluded from that rule because
the Scottish Premiership carries Dundee FC and Dundee United, which are two
clubs. Another 17 pairs sit in the same shape but cannot be decided by
machine, so they are reported in `teamAliasCandidates` rather than merged.

Time then splits a day's fixtures back apart, so an MLB doubleheader stays two
events. Placeholder sides never merge: four different volleyball quarter-finals
all read "To be decided vs To be decided" and folding them together would delete
three bookable events. 133 rows carry a placeholder.

**4. Split venue identity.** Wembley Stadium is `2024` to one supplier and a GUID
to the other. Venues are keyed on a compacted form of the name, so
"Jan Breydel Stadion" and "Jan Breydelstadion" land together, and the registry
carries both id spaces plus every spelling seen.

## Surfacing it: the Events Explorer

Six pages on `tg-widgets`, all reading `/api/events-feed`, all deep-linkable.
Prototypes, so no editor, no registry entry and no Airtable WidgetType.

| Route | What it is |
|---|---|
| `/events` | Hub: counts, the surfaces, and the diagnostics below |
| `/events-league` | Competitions, then a club grid, then that club's fixtures |
| `/events-venue` | Venue directory and what is on at one ground |
| `/events-artist` | Artist directory and tour dates grouped by month |
| `/events-browse` | The whole feed with date, category, competition and text filters |
| `/events-search` | One box over everything, results grouped by kind |

### The side menu

Every page carries a competition menu down the left: one row per competition,
the country after the name ("Premier League - England"), a count, and a chevron.
Grouped by sport with football first, busiest competition first inside each
sport. The current competition is highlighted, and the league page moves that
highlight without rebuilding the menu, so a search you have half-typed survives
changing league.

At 1024px and up it is a sticky column beside the content. Below that it is an
off-canvas drawer behind a "Browse competitions" button, because 89 rows down
the side of a phone would bury the page they are meant to be navigating.
Escape closes it and focus returns to the button that opened it.

The country comes from `supplier-taxonomy.js`, which now carries one per
competition where there is a sensible answer — 48 of 89. It is the country a
customer would look under rather than a strict list: MLS and the NHL both have
Canadian clubs and are still filed under USA. International competitions have
none and show their label alone.

### Search

`?view=search&q=` runs one term against the four registries AND the events, and
returns them grouped rather than interleaved:

```
wembley  -> 2 venues, 17 events (the football AND the concerts)
arsenal  -> 1 club, 41 events (home and away)
madrid   -> 2 clubs, 3 venues, 136 events
olivia   -> 1 artist, 88 dates
```

Entities are matched on their canonical name and every alias, so "Arsenal FC"
finds the club the feed also writes as "Arsenal", and events are matched on the
rehydrated names for the same reason. A near-exact name outranks a substring
buried in a longer one, so "Arsenal" leads with Arsenal.

The sidebar box shows suggestions as you type (debounced, arrow keys, Enter);
Enter with nothing highlighted goes to `/events-search` for the full grouped
list. Grouping is the point: the useful answer to "Madrid" is "which Madrid did
you mean", not 136 rows.

`/events-league?competition=english-premier-league` lists the 20 clubs as
badges, a badge opens that club's fixtures, and every fixture has a Book button.
Badges are generated monograms on a hue hashed from the club key, not crests:
real crests are licensed artwork the feed does not carry.

Shared assets are `public/events-explorer.css` and `public/events-explorer.js`.
Nothing off the network reaches `innerHTML`, there are no inline handlers, and
every list has a loading, empty and error state.

### The API

`api/events-feed.js` serves slices of a snapshot built by
`scripts/build-events-snapshot.mjs` and committed at
`api/_data/events-snapshot.json` (3.8MB, loaded once per cold start, about 70ms).
The feed is a periodic spreadsheet export rather than a live API, so a snapshot
is the honest shape for it.

```
/api/events-feed                                    index
/api/events-feed?view=competition&slug=english-premier-league
/api/events-feed?view=team&key=arsenal
/api/events-feed?view=venue&key=wembleystadium
/api/events-feed?view=performer&key=olivia-rodrigo
/api/events-feed?view=browse&from=&to=&category=&competition=&q=
/api/events-feed?view=search&q=wembley
/api/events-feed?view=venues|performers|teams&q=
/api/events-feed?view=diagnostics
```

Add `&appId=` for a client's own Travelify application, `&currency=` and
`&adults=` to change the booking link. Read-only, every parameter validated,
page size capped at 100, and rate limited on its own 300-per-15-minutes bucket
rather than the shared widgetRead one: a browsing UI with a typeahead is
chattier than a widget boot, and responses are CDN-cached for an hour so in
production most requests never reach the function.

The snapshot drops anything the registries already hold and the API rehydrates
it from the entity key on the way out. That is what gives every page one
spelling per club: the feed writes "Arsenal" on one row and "Arsenal FC" on the
next, and only the canonical name is ever shown.

Rebuild after a new export (last done 21 Aug 2026, when the sheet gained its
Latitude/Longitude columns and ~400 fresh rows):

```
node scripts/build-events-snapshot.mjs feed.csv
node scripts/build-venue-geo-from-feed.mjs feed.csv --ref api/_data/venue-geo.json
npm run test:supplier-events
```

The second step rebuilds the booking anchors from the sheet's coordinate
columns, using the current table as the cross-check reference.

## Booking deeplinks

Built in one place, `api/_lib/events/event-deeplink.js`, to the live Travelify
ticket link Andy supplied on 21 Aug 2026. The feed's two id columns are the two
halves of the pin and the link wants them apart:

```
"Event ID For Searchbox"  144:168e50...  ->  supp=144  +  refe=168e50...
"Event ID For Filters"    168e50...      ->  refe
```

`loc` is the raw feed event name plus ": DD-Mon-YYYY", brackets included
("Italian Grand Prix (Formula 1): 04-Sep-2026"), which is why each source keeps
its own `rawName` through a pass that strips the taxonomy off the title.

Regenerating Andy's example from the feed reproduces it parameter for
parameter, **including `lat`, `lng` and `rad`, which are mandatory**. That was
learned the hard way on 21 Aug 2026: the first shipped links omitted them on
the assumption that `refe` pins the event, and every Book button returned
"Unable to match location". A probe settled it in four requests: the identical
link 400s bare and 302s to the results page with the anchor added, and even
Andy's own working example dies with its anchor removed. The wording of `loc`
is irrelevant to the matcher.

The coordinates live in `api/_data/venue-geo.json`, built by
`scripts/build-venue-geo-from-feed.mjs` from the sheet's own **Latitude and
Longitude columns**, which Andy had added on 21 Aug 2026. Supplier coordinates
are authoritative for the supplier's own inventory, with two defects the
builder repairs: some venues are truncated to whole degrees (Ceres Park at
literally 10,10), which a real coordinate never is, so integer-integer pairs
are rejected; and some rows drop the minus sign off a western longitude
(Chicago at +87.6 is in China), repaired when the flipped point rejoins its
venue's median or the previous verified table. Each venue takes the median of
its rows; a row more than 50km from its venue's median becomes a per-EVENT
anchor instead, which is exactly right for the venue keys that merge more than
one real ground. `api/_data/venue-geo-overrides.json` has the final say for
the handful of venues whose feed coordinates are fine-grained but factually
wrong (the feed puts St James' Park in Exeter on rows that are all Newcastle
United). An event with no anchor at either level gets NO url and
`status: 'no-anchor'` — a missing button is honest and a dead one is not.
`rad` is 20, kept verbatim from the working example.

Before the sheet carried coordinates this table was built by geocoding (21 Aug
2026, one afternoon, three failed drafts and 174 hand checks); that build and
its lessons live in git history and in scripts/geocode-venues-via-vercel.mjs.

`BOOKING_KINDS` in that file declares all three combinations, and as of
24 Aug 2026 ALL THREE are built from verified live examples. Every surface
reads that list rather than hard-coding a Book button, so a future kind with
`ready: false` would show greyed with an "Awaiting spec" pill instead of
pretending not to exist, and filling in its `build` lights it up everywhere
at once with no change to any widget.

### Ticket + hotel (ticket + accommodation, live 24 Aug 2026)

`st=TicketAccommodation`: the flight package minus the flight leg — same
pin, same mandatory anchor, `frd=0&dur=1` verbatim, and nothing the feed
does not already know, so it comes back `ready` with a finished url and no
chooser. Probe-verified live before the button shipped, on app 384 and the
demo app 250 alike (same probe script as the flight package).

### The flight package (ticket + accommodation + flight, live 24 Aug 2026)

Built to the live example Andy supplied, `st=TicketAccommodationFlight` with
the same pin and the same mandatory anchor plus five parameters: `org` (the
visitor's departure airport), `dst` (the destination airport), and
`frd=0&dur=1&dir=false` copied verbatim. Probe-verified the same day: our
built link 302s into the Travelify results funnel on app 384 and on the demo
app 250 alike (`scripts/probe-flight-deeplink.js` is the record).

`dst` is computed in the feed as the airport nearest the EVENT's own anchor
(within 150km, from the suite's bundled list), so a merged venue key flies
each fixture to its own city. No airport near enough means the package is
simply not offered (`status: 'no-airport'`).

`org` is the one thing neither the feed nor the config can know, so the
builder returns a `urlTemplate` with `__ORG__` where the code goes and
`status: 'needs-origin'`. Each surface renders that option as a button that
opens a small chooser dialog ANCHORED TO THE BUTTON (Andy, 24 Aug 2026: a
modal on the button, not a separate page — an interstitial /fly page shipped
first and was replaced the same day). The visitor types an airport name or
code and picks FROM THE DROPDOWN ONLY — free text never books, so `org`
always matches the suite's own list (`view=airports` on the feed, the menu's
source). That list is `api/_data/airports-departures.json`: every large or
medium scheduled-service airport worldwide with an IATA code (3,242 from the
OurAirports public-domain dataset, added 24 Aug 2026 after Cologne failed to
match the old 106-major list), municipality folded into the label so a city
search finds its airports, large airports first so hubs rank on top.
Departures only: the package's `dst` and the venue fact sheets stay on the
curated majors in `airports.json`, because an arrival needs a hub with
hotels and inbound flights. Refresh with
`scripts/fetch-departure-airports-via-vercel.js` (instructions in its
header); `tests/test-departure-airports.cjs` guards the coverage. The
chooser validates the template before opening anything (https,
dl.tvllnk.com, /deeplink/), remembers the last airport (`tgev_org` in
localStorage, per site) and opens the finished link in a new tab. It lives
inside each widget's shadow root (the `fly*` functions, stamped identically
into all six widgets) and once in events-explorer.js for the dashboard
pages. A caller that already knows the airport can pass `&org=LGW` to the
feed and get finished `ready` links instead.

Widgets offer the kinds in `cfg.bookingKinds` (default ticket only — the
agent turns the package on per widget in the editor, where it is now live
instead of greyed).


## The widget family

Six embeddable widgets read the same feed. Each is a container div plus one
script, per the standard embed contract, and each has an editor on the shared
shell and a demo on the 250 account.

| Tag | Widget | What it answers |
|---|---|---|
| `tickets` | Event Tickets | "What is coming up?" A list, cards or a compact strip, from a competition, club, venue, artist, category or search term. |
| `nextevent` | Next Event | "When is the next one?" One event, with a countdown that ticks per minute and refetches once kick-off passes. |
| `clubpicker` | Club Picker | "Pick your team." A badge grid of clubs, grounds or artists that opens their fixtures. |
| `ticketsearch` | Ticket Search | "I know what I want." One box over everything: Wembley returns the ground, the football and the concerts; Arsenal returns home and away. |
| `ticketmonth` | Ticket Month | "I am free that weekend." A month grid with events on their dates and a day panel underneath. |
| `eventmenu` | Event Menu | Navigation for a whole ticket section: a sidebar on a desktop, a drawer on a phone. |

Five of them build Travelify deeplinks, so `api/widget-config.js` injects the
client's AppID into their saved config server-side (`NEEDS_APP_ID`). Event Menu
does not: it links into the client's own pages and has no business holding an
AppID.

### What the editors share

`public/editor-events-kit.js` carries the parts all six editors need and the
shell has no opinion about: one memoised call to the feed index, the source
picker that searches the live feed, the booking-option list built from what the
API declares, control binders, and a modal that remembers `.is-open`. It cut
each editor from roughly 880 lines to 250. It is not a second shell and
duplicates nothing `editor-shell.js` already does.

### Event Menu links into the client's site

The menu takes one pattern, `/tickets/{type}/{slug}` by default, with `{type}`,
`{slug}` and `{name}` as tokens, and marks the row matching the address the
visitor is on. The pattern is validated before it reaches an href: site
relative, hash or absolute http(s) only, so a `javascript:` pattern turns the
row into a plain button rather than a link. Where a client has no pages yet
every row fires `tg:eventmenu:select` on the container carrying type, key, name
and href, and `preventDefault()` stops the navigation, so the same menu can
drive an in-page view.

### Breakpoints are container queries, not media queries

Every layout breakpoint in these widgets is `@container`, with
`container-type: inline-size` on the widget root. A widget does not live in the
viewport, it lives in whatever column the client gives it, and `@media` cannot
see that the column is 240px wide on a 1500px screen. That is not theoretical:
the Club Picker was writing "Manchester United" one letter per line on the
dashboard card, because four columns were being forced into a container the
widget believed was full width.

### Two things the surfaces surfaced

- The feed's directory views (`view=teams|venues|performers`) take a `category`
  filter. Without it the only "top clubs" list available was the global one,
  which is all baseball and ice hockey because those sides play 162 and 82
  games a season, so a football-only menu asking for popular clubs got nothing
  back.
- `view=search` narrows by category server-side, before the page limit. Doing it
  in the client after the limit meant "wembley" scoped to football returned
  nothing, because Wembley's next eight events are all concerts.

## One thing it deliberately does not do

**It does not convert times.** The two feeds do not share a timezone convention
and the gaps are not noise, they land on the hour. XS2Event runs 60 minutes
ahead of SportsEvents365 on every Premier League, Championship and Six Nations
fixture, 120 ahead on Ligue 1 and the Belgian Pro League, and 60 behind across
the Segunda División. Neither feed can be assumed to be venue-local.

So the pass keeps both times on the record, takes the displayed one from
`supplierPriority`, and counts the disagreements in `report.timeOffsets`.
Resolving it properly needs a venue-to-timezone table, which this feed does not
carry. **That is an open decision, and until it is made, kick-off times shown
from this feed will be an hour out for a meaningful share of European football.**

**It does not apply venue aliases.** A confirmed merge whose two sources name
different venues is evidence those names are one ground, and the pass reports
them in `report.venueAliasCandidates` with a support count. The strong ones are
real:

```
x17  Estadi de Son Moix        == Visit Mallorca Stadium (Estadi de Son Moix)
x16  Estadi Cornellà-El Prat   == RCDE Stadium
x11  San Siro                  == Stadio San Siro (Giuseppe Meazza)
x 8  Ghelamco Arena            == Planet Group arena
```

They are not applied automatically because the same signal also catches genuine
supplier errors, such as one Angels fixture listed at Dodger Stadium. Review the
list, then add the confirmed pairs to a venue alias table.

## Contract

- Pure. No network, no clock, no secrets. Rows in, rows out, so the same pass
  works from an API route, a cron or a script.
- Never invents. An unresolved field is `null` and is counted in the report.
- Never silently drops. Rejected rows carry a reason, and every disagreement
  between merged sources is kept on the record in `conflicts`.
- Times are naive local strings exactly as supplied. No `Date`, no trailing `Z`.
- Output is plain text with no markup. Widgets still render it with
  `textContent` or an escaper, as the widget rules require.
- Every string is tag-stripped, control-character-stripped and length-capped
  before any regex touches it. Data-derived lookups use `Map`, so a feed value
  of `__proto__` cannot reach `Object.prototype`.

## Known residue in the source exports

- 12 rows have no taxonomy bracket at all, mostly NFL season-ticket bundles and
  two EuroLeague multi-team packages. Their titles are kept whole and they come
  back `category: null`.
- 1 truncated row loses its category and 3 lose their competition.
- 3 NASCAR rounds are filed under a race name that does not identify a series
  ("Championship Race"), so they stay outside the competition taxonomy. They are
  still categorised as motorsport.

## Venue fact sheets

`api/_data/venue-facts.json` carries a researched fact sheet for every venue,
surfaced on the Events Explorer venue page ("Plan your visit") and by the
Venue Guide widget. Three sources, nothing invented:

- the feed itself: the city its concerts say it is in, the country, what is
  on and who plays there
- Wikidata, matched by COORDINATES rather than a trusted name search (a
  candidate only counts if its own coordinate sits within 2km of our supplier
  anchor): capacity, opening year, official site, Wikipedia, and a photo kept
  WITH its Wikimedia Commons author and licence
- maths on repo data: IANA timezone from the anchor (tz-lookup at build time)
  and the nearest major airports from the Flight Time widget's bundled list,
  straight-line distance, within 150km only

881 of 982 venues matched on Wikidata. Rebuild with
`scripts/research-venues-via-vercel.mjs` (it runs as a temporary Vercel
function because the build sandbox cannot reach Wikimedia; page every offset
TWICE - Wikimedia throttles bursts and the second pass recovers different
venues) then `scripts/build-venue-facts.mjs` over the page files. The
assembler drops any match whose Wikipedia page is a railway or metro station
named after the ground. A fact the sources do not carry is omitted from the
sheet, never guessed.

### Double verification (Andy's rule, 22 Aug 2026: no made-up data)

The sheet is then PRUNED to facts two independently maintained sources
agree on. `scripts/verify-venue-facts-crawl.js` (a temporary Vercel
endpoint while it runs; instructions in its header) fetches every matched
venue's live Wikipedia article and returns verdicts: does the infobox
corroborate the Wikidata capacity within 1%, the opening year, the official
site's domain, the feed's city; and does the article title or bolded lead
share a real name token with the venue. `scripts/verify-venue-facts.mjs`
then rewrites `venue-facts.json` keeping only the corroborated facts;
country must instead agree with the country the anchor's timezone implies.
Unconfirmed means REMOVED, not flagged.

The first run (all 667 article-bearing venues, no fetch failures) kept
capacity on 364 sheets and dropped 231, kept opened on 576, website on 299,
city on 199, country on 694, photo and Wikipedia link on 661. Two traps the
run taught us, both encoded in the pruner:

- sponsor renames and translations fail the title check while being the
  same building (Oracle Arena is now Oakland Arena, Stadion Slaski is
  Silesian Stadium). 25 were reviewed by hand and whitelisted, each pinned
  to its exact article title so a rebuild lapses the review.
- the SAME-SITE PREDECESSOR: coordinates cannot tell a venue from the
  demolished venue it replaced, and the old article corroborates the old
  item perfectly. Wembley matched "Wembley Stadium (1923)" - capacity
  82,000, opened 1923, all "confirmed", all about the wrong building. Five
  keys (wembleystadium, sanmamesstadium, stadelouisii,
  hidegkutinandorstadion, sergiolanfranchi) plus theo2 (Millennium Dome)
  were purged of all Wikidata facts.

### Rematched predecessors (24 Aug 2026)

The purged venues were rematched by hand-reviewed article title with
`scripts/rematch-venues-via-vercel.js` (rerun instructions in its header),
under the same standard: the reviewed title must resolve, the item's own
coordinate must sit within 2km of our supplier anchor, and every fact must
be corroborated by the live article before it returns to the sheet. Five
came back: Wembley (90,000, opened 2007), San Mamés on its duplicate key,
Stade Louis II (opened and website only - Wikidata's capacity is not in
the article), Hidegkuti Nándor Stadion and The O2 Arena. One stayed out:
sergiolanfranchi, whose current stadium is 2.33km from the supplier
anchor, outside the gate, so it keeps a bare sheet rather than a bent
rule.

The reviewed results live in `api/_data/venue-facts-overrides.json`, which
`scripts/build-venue-facts.mjs` applies AFTER assembly - an override
replaces the venue's whole Wikidata-sourced group, so a rebuild cannot
resurrect the predecessor match. The pruner pins the same titles in its
reviewed-renames map. A future predecessor discovery follows the same
loop: purge first, rematch by reviewed title, verify, then override.

## Venue keys that merge different real venues

The compact venue key exists to land "Jan Breydel Stadion" and "Jan
Breydelstadion" together, and mostly it does. Geocoding every venue on 21 Aug
2026 exposed three keys where the SAME compacted name belongs to different
buildings, sometimes on different continents:

- `redbullarena` - Leipzig, Salzburg AND Harrison NJ (New York Red Bulls), 40
  events across three countries under one key
- `3arena` - Dublin's arena and Stockholm's (Tele2 Arena was renamed 3Arena in
  2024), so Djurgarden home games sit under a Dublin venue
- `gradskistadion` - Slaven Belupo's Koprivnica ground and Sutjeska Niksic's in
  Montenegro ("gradski stadion" just means city stadium)

Since the sheet gained per-row coordinates these keys are handled by
per-EVENT anchors: each event books against its own row's location, so a
Salzburg fixture and a Harrison NJ fixture at "Red Bull Arena" both link
correctly (afasstadion joined the list — it is AZ Alkmaar's ground AND KV
Mechelen's). The venue keys are still merged for browsing, so a Red Bull
Arena venue page interleaves three cities' fixtures; the real fix for THAT
remains a disambiguator in `venueKeyFor`, but bookings no longer wait on it.

## Adding a supplier

Add its category and competition spellings to `supplier-taxonomy.js` and its
slug to `SUPPLIERS`. A category the file does not know is not treated as
taxonomy at all, so a new supplier shows up as a jump in
`report.taxonomyMissing` rather than quietly corrupting titles. Add a test to
`test/supplier-events-normalise-smoke.mjs` for whatever trap it brings.
