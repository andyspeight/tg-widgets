# Phase 2: world coverage of airports (BUILT, 22 Sep 2026)

Andy, 21 Sep 2026: "Once we have these 600 done we are going to list all other
airports in the world that have international flights, and get those live even
if we just have their name and location so we can slowly work through them and
add additional information as and when we find it."

Andy, 22 Sep 2026, correcting the first attempt: "I thought we were going to
look at the traffic numbers before importing - we don't want loads of little
backwater airports with no significant passenger traffic." Then, deciding it:
"1m threshold, country floor minimum 100k, build the import."

## What was actually built

418 new airport records, created 22 Sep 2026. Table went from 600 to 1,018.

### The rule

```js
const RULE = r => {
  if (r.pax === null) return false;          // no verified figure, no record
  if (r.pax >= 1_000_000) return true;       // busy enough on its own
  const best = bestByCountry.get(r.country);  // otherwise: busiest in its country
  return !!(best && best.iata === r.iata && r.pax >= 100_000);
};
```

The country floor exists because a flat 1m cut is not neutral. It drops
Ouagadougou (619k) and Cotonou (471k) while keeping every regional airport in
a rich country, which systematically thins out Africa and the small island
nations. The 100k minimum stops the floor letting in Wake Island (1,744) or
Saint Helena (1,222).

929 airports pass. 511 were already in the table. 418 were new.
892 passed on the 1m threshold, 37 were kept by the country floor.

### Where the data came from

- **Names, IATA, country, lat/lng, Wikipedia URL**: OurAirports
  (`https://davidmegginson.github.io/ourairports-data/airports.csv`), public
  domain. 86,116 rows, 4,335 with `scheduled_service = yes`, of which 4,133
  carry a 3-letter IATA code across 234 countries.
- **Passenger numbers**: Wikidata SPARQL, property P3872 (passengers per
  year), `https://query.wikidata.org/sparql`.

Every created record carries the OurAirports CSV URL in Source 1. Nothing in
these 418 records was written by a model.

### The peak-since-2015 method (and the trap it avoids)

Taking each airport's *latest* P3872 statement gives garbage. Wikidata holds
several statements per year (Surabaya has four different 2020 values) and
"most recent" often lands on a pandemic figure. Read that way, Surabaya comes
out at 340 passengers and Kos at 39,000.

**334 of 2,960 airports (11%) read under a fifth of their own historic max.**

The fix is to take each airport's maximum since 2015. That is what `peak.json`
holds, and it is what the rule was run against. Note for anyone re-running
this: `joined.json` in the working set carries the OLD latest-year figures and
must not be used for the threshold.

### Fields deliberately left blank

- **City Served** - OurAirports' `municipality` is where the airport *stands*,
  not what it *serves*. Filling it from that column would reintroduce the exact
  bug the 15 Sep decision fixed.
- **Airport Type** - cannot be derived from the free data (the SDF/ZUH lesson).
- **Airport Role** - same.
- **Verified Date** - never written at creation. This is the rule that broke
  the project in May.
- **Overview** - these are thin records by design.

**Status is "Todo"** on all 418, so none of them reach the picker. Only Done
and Live are servable.

## Verified after the import (22 Sep 2026)

Live read of the whole table, 1,018 records:

- 1,018 records returned, `totalRecordCount` 1,018 (600 + 418, as expected)
- 0 blank IATA codes
- 1,018 distinct IATA codes, **no duplicates**
- All 929 rule-passers present; 0 missing
- 195 of the 234 countries with scheduled service now have at least one airport

## The coverage gap worth knowing about

39 countries with scheduled service still have no airport in the table. Only
9 of those are genuinely small. **The other 30 are missing because Wikidata
holds no passenger figure for them at all**, not because their airports are
minor:

Afghanistan, Anguilla, Bhutan, Brunei, Cook Islands, Eritrea, Eswatini,
Falkland Islands, Gambia, Greenland, Kiribati, Laos, Lesotho, Liberia, Libya,
Malawi, Marshall Islands, Micronesia, Monaco, Mongolia, Nauru, Niue, North
Korea, Sao Tome & Principe, Sierra Leone, Solomon Islands, Somalia, South
Sudan, Tonga, Tuvalu.

Several of those are countries whose capital-city international airport a
travel agent would sell without hesitation. They are absent purely because the
free traffic data is thin, which is a different problem from "too small to
bother with".

Do NOT infer which airport each one needs from the OurAirports ordering. With
no passenger figures the list falls back to alphabetical, so it surfaces
Chileka for Malawi, Spriggs Payne for Liberia, Kufra for Libya and Arvaikheer
for Mongolia - none of which is that country's principal airport. Each of the
30 has to be sourced and verified by hand. That is a separate, evidence-first
job, not a bulk import.

The genuinely small nine, for the record: Guinea-Bissau (83,616), Norfolk
Island (67,959), Wallis & Futuna (45,093), St Pierre & Miquelon (38,808),
Montserrat (23,093), Christmas Island (22,772), Cocos Islands (17,872), Wake
Island (1,744), St Helena (1,222).

## Hard constraint, still in force

Andy's locked rule: **no made-up data, double verification on everything.**
Lat/lng, IATA and names came from the dataset, not from a model. Where the
dataset did not have it, the field stayed blank.
