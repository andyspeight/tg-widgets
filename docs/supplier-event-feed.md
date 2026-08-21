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

Against the 28 Jul export: 11,045 rows in, 10,263 events out, 783 duplicates
folded away, 961 venues, nothing rejected, about 0.4 seconds.

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

**3. Duplicate inventory.** 624 events are sold by both suppliers and another
157 are listed twice by one supplier under different event ids. They merge on an
identity key of category, date and normalised team names, with the sides sorted
so a reversed listing still matches. Only club-type tokens come off a team name
(FC, AFC, CF and friends), never anything that separates two real clubs, so
Manchester United and Manchester City stay apart.

Time then splits a day's fixtures back apart, so an MLB doubleheader stays two
events. Placeholder sides never merge: four different volleyball quarter-finals
all read "To be decided vs To be decided" and folding them together would delete
three bookable events. 133 rows carry a placeholder.

**4. Split venue identity.** Wembley Stadium is `2024` to one supplier and a GUID
to the other. Venues are keyed on a compacted form of the name, so
"Jan Breydel Stadion" and "Jan Breydelstadion" land together, and the registry
carries both id spaces plus every spelling seen.

## Two things it deliberately does not do

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

## Known residue in the 28 Jul export

- 12 rows have no taxonomy bracket at all, mostly NFL season-ticket bundles and
  two EuroLeague multi-team packages. Their titles are kept whole and they come
  back `category: null`.
- 1 truncated row loses its category and 3 lose their competition.
- 3 NASCAR rounds are filed under a race name that does not identify a series
  ("Championship Race"), so they stay outside the competition taxonomy. They are
  still categorised as motorsport.

## Adding a supplier

Add its category and competition spellings to `supplier-taxonomy.js` and its
slug to `SUPPLIERS`. A category the file does not know is not treated as
taxonomy at all, so a new supplier shows up as a jump in
`report.taxonomyMissing` rather than quietly corrupting titles. Add a test to
`test/supplier-events-normalise-smoke.mjs` for whatever trap it brings.
