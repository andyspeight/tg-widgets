# Airport data expansion plan

**Date:** 25 August 2026
**Owner:** Andy Speight
**Base:** Destination Content `appuZdlMJ7HKUt6qS`, Airports table `tblI2iVAbIGCtsGa7`
**Governing skills:** `airport-spotlight`, `airtable-operations`, `travelgenix-humanizer`, `project-handover`
**Related project row:** `rec95Ed74DWhznnyb` (Destination, Airport and Attraction widgets)

The brief: we have launched, the airport data feeds the Airport Spotlight widget,
the wider spotlight family and Luna Chat, and we now need all of the major
airports in the table. This document records what the table actually contains
today, the risks that carry into production, and the plan to close the gap.

---

## 1. What the table holds today (audited 25 Aug 2026)

230 records. Every one has Status `Done`. Every one has a Verified Date of
12 or 13 May 2026.

Those two facts do not survive contact with the data. The table splits cleanly
into two cohorts, and the split is exact, with no record in between.

### Cohort A, 102 records: complete

Carry the identity fields (Lat, Lng, City Served, Type, Tagline, Official
Website, Wikipedia URL, Source 1, Source 2) as well as the narrative.

| Country | Count |
|---|---|
| United Kingdom | 24 |
| Spain | 20 |
| Greece | 20 |
| USA | 14 |
| UAE, Turkey, Portugal | 5 each |
| Cyprus, Egypt, Morocco, Saudi Arabia | 2 each |
| Qatar | 1 |

### Cohort B, 128 records: narrative only

Every long text field is filled, and the prose is longer on average than
cohort A (792 characters of Overview against 640). But these records have **no
coordinates, no City Served, no Type, no Tagline, no Official Website, no
Wikipedia URL and no Source 1 or Source 2 at all**. They are stamped Verified
without a single cited source.

Cohort B is everything outside the list above: France, Italy, Germany, the
Netherlands, Scandinavia, central Europe, the Caribbean, all of Asia,
Australia, New Zealand, Canada, South Africa, and six US airports including
LAX, ORD, SFO, DFW, LAS and SEA.

### Cohort C, 24 records: the newest fields

Only the 24 UK airports carry Hero Image, Overview Heading, Terminals Count,
Terminals Note, Key Airlines, Key Airlines Note, Check-in Summary and Check-in
Detail. The other 206 records have none of them.

### Fields nothing has ever populated

Flight Time From UK, Flight Time Note, Transfer Info, Car Hire Info, Taxi Info,
Coach Info, Country link, City link. The last two are the link data the "Fly
into" cross-link has been waiting on since 22 June 2026.

### Duplicates

Five IATA codes appear twice: `ARN`, `BUD`, `HEL`, `PRG`, `WAW`. The BUD pair
carries two different spellings of the same airport, "Budapest Ferenc Liszt"
and "Budapest Liszt Ferenc".

### Brand voice

139 of the 230 records contain an em dash. 2,187 occurrences in total. The
phrase "gateway to" appears 179 times. Both are called out in the
`airport-spotlight` skill as the exact tells that triggered the May 2026 audit.

---

## 2. Risks that reach production today

1. **A half-built record is pickable and embeddable right now.**
   `api/airport-search.js` filters on Airport Name, IATA Code and City Served
   only. It does not filter on Status. `api/airport-content.js` does not gate
   on Status either. An agent can search "Amsterdam", pick Schiphol, embed it,
   and publish a spotlight with no map, no tagline and a collapsed eyebrow line,
   backed by prose with no recorded sources.
2. **Cohort B is invisible to search by city.** With City Served blank, those
   128 airports are only findable by exact name or IATA code in the picker.
3. **Verified Date means nothing at the moment.** All 230 are stamped 12 or
   13 May 2026, including 128 records with no source to verify against.
4. **The freshness loop cannot keep up.** `api/cron/reference-freshness.js`
   runs weekly (Mondays 04:00), report-only, 25 records per run, with a 60 day
   TTL. The whole table is now roughly 105 days past its stamp. Every record is
   permanently due, and nothing is ever re-stamped.

---

## 3. What we already have to build on

Do not build a new pipeline. The reference layer already does most of this.

| Endpoint | What it does |
|---|---|
| `GET /api/reference/coverage` | Fill rates and freshness across airports and countries |
| `GET /api/reference/breadth` | Finds airports our own destination prose names but has no record for |
| `POST /api/reference/breadth-fill` | Cross-verifies an IATA against OurAirports and Wikidata, and on agreement creates a Draft skeleton carrying both source URLs and today's date. Dry run by default |
| `POST /api/reference/refresh` and the weekly cron | Re-checks lapsed records against their cited sources, classifies verified / drifted / unverifiable |

`api/reference/_breadth_fill.js` already encodes the principle this plan turns
into a process: two structured sources can verify an airport's **identity**,
they cannot supply its **narrative**, so an auto-created record is a skeleton
for enrichment and never goes live on its own.

Running the breadth detector locally against the current data: **129 airports
are named in Travelgenix destination prose and have no record**. Those are
airports our own content already promises.

---

## 4. The model: identity and narrative are different jobs

Identity is cheap, deterministic and machine-verifiable. Name, IATA, city,
country, coordinates, official site, Wikipedia. Two independent structured
sources settle it, and the existing cross-verifier already does that.

Narrative is expensive and needs the full `airport-spotlight` methodology: every
fact-bearing claim confirmed against two independent sources, at least one dated
within twelve months, one record pushed at a time.

Conflating the two is what produced cohort B: real prose sitting on no verified
identity, marked Done.

So Status becomes the contract, using options the table already has:

- `In progress`: identity verified, narrative not written. **Not servable.**
- `Draft`: narrative written, not yet audited. Not servable.
- `Done`: narrative audited to skill standard against two sources. Servable.

---

## 5. The plan

### Phase 0: Make the table honest, before adding anything (1 session)

Adding 150 airports on top of a table that cannot tell a finished record from an
unfinished one multiplies the problem. Fix the floor first.

1. Gate `api/airport-search.js` and `api/airport-content.js` on Status so only
   servable records reach the picker and the widget. Add the test alongside.
2. Merge the five duplicate pairs, keeping the richer record of each.
3. Reclassify the 128 source-less records from `Done` to `In progress`. This is
   the honest state, and with the gate in place it also takes them out of client
   reach until they are finished.
4. Strip the 2,187 em dashes across all 230 records. Deterministic, scriptable,
   touches punctuation only and no facts.
5. Backfill identity for the 128 by running the existing cross-verifier over
   records that exist but lack coordinates, rather than only over records that
   are missing. Small extension to `_breadth_fill.js`.

After Phase 0 the table is smaller in servable terms, roughly 102 records, and
every one of those is defensible. That is the honest launch position.

### Phase 1: Agree what "major" means

This is the decision that sizes everything after it. Three candidate
definitions:

| Option | Definition | New records | Recommendation |
|---|---|---|---|
| A. Route-led | Every airport with a scheduled UK route, plus the 129 our own prose already names | around 150 | **Recommended.** Matches what agents actually sell and what our content already promises |
| B. Volume-led | Every airport worldwide above roughly 5 million passengers a year | around 300 | Comprehensive for Luna Chat, includes a long tail no UK agent will ever book |
| C. Full | Everything above 2 million passengers, plus all UK leisure charter fields | 600 plus | Only worth it if Luna Chat needs global reach independent of what we sell |

Notable absences under any option: no Belgium, no Bulgaria, no Romania, no South
America, no Central America outside Cancun, no Cape Verde, no Zanzibar, no
Montenegro, and Denver, Houston and Phoenix missing from the USA.

### Phase 2: Bulk identity pass (days, not months)

Extend the breadth detector so it can be seeded from an agreed target list, not
only from mentions in our own prose. Then run `breadth-fill` in batches against
that list. Every record created is `In progress`, invisible to clients, and
carries both source URLs and the date.

This gets the whole target list into the table, correct and verified as to
identity, quickly. The picker and Luna both gain airport coverage immediately at
the identity level.

### Phase 3: Narrative enrichment, tiered

Full `airport-spotlight` rigour on 150 airports is a very large amount of work
and the skill is explicit that there is no acceptable shortcut. So tier the
depth rather than cut the standard:

- **Tier 1, full spotlight.** UK origins and the top holiday destinations.
  Overview, quirks, all transport modes, lounges, hotels, tips. Full two-source
  verification, one record at a time.
- **Tier 2, short form.** Overview, terminals, transfer, tips. Same
  verification standard, fewer claims to verify.
- **Tier 3, identity only.** Map, name, city, country, official site. The widget
  renders a compact card rather than empty sections.

Add a Depth field to the table so the widget picks a layout instead of drawing
blank sections, and so an agent can see what they are embedding.

### Phase 4: Keep it true (done 25 Aug 2026)

The freshness arithmetic never converged: 25 records a week against a table of
230 and a 60 day TTL left every record permanently overdue and nothing was ever
re-stamped. `/api/cron/reference-freshness` now runs daily with a batch of 40,
which clears the table inside the TTL even at 593 records.

The original note, for the record. 25 records a week against a table of 230 and
a 60 day TTL never converges. Either run daily, raise the batch, or set the TTL by
tier so Tier 1 is checked often and Tier 3 rarely. Turn on re-stamping for clean
two-source confirmations, and keep drift flagged for a human.

---

## 6. Progress log

### 25 August 2026: scope agreed and Phase 0 completed

Andy chose Option C, the full build to roughly 600, with the two-source rule
applying to every piece of information.

**Target list agreed and committed.** 593 airports: the 475 best-connected
large airports with scheduled service (`api/_data/airport-targets.json`, built
by `scripts/build-airport-targets.mjs`), unioned at run time with the airports
already in the table and the 129 our own destination prose names. The committed
file holds IATA codes and a rank only, so no single-sourced value can leak into
a record.

**Phase 0 is done.**

| Action | Result |
|---|---|
| Status gate on the picker | `api/airport-search.js` now offers Done and Live only |
| Provisional flag on content | `api/airport-content.js` marks unfinished records rather than refusing them |
| Duplicates merged | ARN, BUD, HEL, PRG, WAW resolved, 230 records down to 225 |
| Source-less records reclassified | 123 moved from Done to In progress |
| Em dashes stripped | 200 replaced across the 59 live records, zero remain in any servable record |

The table is now internally consistent: 102 Done, every one carrying Source 1
and Source 2, and 123 In progress, none of which cites a source. No duplicate
IATA codes remain. Status finally means something.

**One deliberate change from the plan as written.** Section 5 said to gate the
content endpoint as well as the picker. Checking the live widget configs first
showed why that would have been wrong: a hard gate would 404 any embed already
running on a client site. The content endpoint therefore returns the record and
marks it `provisional: true`, so the widget can render a compact card instead of
a spotlight full of empty sections. Only one airport is currently pinned in a
live config (DXB, fully sourced), so nothing in production was affected either
way.

**Verification tightened.** The reference layer previously answered "are these
the same airport" and then wrote name, city and country from OurAirports alone.
A record whose coordinates matched could carry a single-sourced name wearing a
verified badge. `corroborateFields` in `api/reference/_breadth_fill.js` now
checks each field on its own terms: name on label overlap, coordinates on
distance, country on matching ISO 3166-1 alpha-2 codes, city on matching place
names. The Wikidata query was extended to fetch the ISO code (P297) and the
administrative place (P131) so country and city have a second pair of eyes at
all. An uncorroborated field is left blank and reported, never filled.

**The machinery to reach 600.** `runIdentityBackfill` repairs records we have,
`runBreadthFill` creates records we are missing, both writing only corroborated
identity and never narrative. `POST /api/reference/identity-backfill` runs the
first on demand (dry run by default). `/api/cron/reference-identity` works both
daily in bounded batches. Both write by default. Backfill only ever fills blanks, and every record
creation is corroborated by both sources and lands as In progress, which the
Status gate keeps out of the picker and off every client site until a human has
written and verified its narrative. `REFERENCE_BREADTH_CREATE=false` stops
creation if it is ever needed.

65 assertions across `test/airport-status-gate-smoke.mjs` and
`test/airport-identity-verify-smoke.mjs`.

### Pre-flight for the fill run

593 airports in the agreed union, 225 already in the table, **368 to create**.
All 368 are present in OurAirports with scheduled service, so source 1 covers
the whole run and nothing should come back "not in OurAirports". Whether each
one is created depends on Wikidata corroborating it, which happens on the
deploy.

| Continent | New records |
|---|---|
| Asia | 122 |
| North America | 95 |
| Europe | 70 |
| Africa | 39 |
| South America | 30 |
| Oceania | 12 |

Heaviest countries: USA 56, China 47, Brazil 16, Italy 11, Russia 11, Germany 9,
Mexico 8. South America and Central America go from nothing to covered, and the
gaps flagged in section 3 (no Belgium, no Bulgaria, no Romania, no Cape Verde)
all close.

**Why the run cannot happen from a Claude Code session.** The egress policy in
the session sandbox blocks `query.wikidata.org` and OurAirports' own host. The
OurAirports data is reachable through its GitHub origin, but the obvious
alternatives for a second source are not independent: OpenFlights records are
100% sourced from OurAirports by its own provenance column, and mwgg/Airports
returns coordinates byte-identical to OurAirports'. Using either would be
single-sourcing with two file names. The Vercel deployment reaches both real
sources, so the fill runs there.

### Findings that need a human

The dataset pass surfaced three that two sources should settle before anyone
acts on them:

- **REP is retired.** Our record is named "Siem Reap-Angkor International" but
  carries IATA `REP`, the old Siem Reap airport. OurAirports no longer lists
  `REP` at all; Siem Reap-Angkor is `SAI`.
- **PNH shows as closed.** OurAirports marks Phnom Penh as no longer having
  scheduled service, with traffic at the new Techo International (`KTI`). Our
  destination prose still points readers at `PNH`.
- **Prose contains codes that are not the airport meant.** `KLM` in a
  parenthesis resolves to Kalaleh in Iran. `PUL` resolves to a seaplane base in
  Washington state. Both are false positives the gap detector should ignore, and
  both are now filtered by requiring scheduled service.

---

## 7. Open decisions for Andy

1. Confirm the REP and PNH findings above, which change what we sell. Neither
   is safe to correct on one source, so both are left flagged rather than
   guessed.
3. Whether cohort B's existing prose is kept and enriched, or rewritten. It is
   longer than cohort A's but written in a different register, and none of it
   has a cited source.
4. Whether to log this as its own project row, separate from the widget build
   row `rec95Ed74DWhznnyb`.

---

### 26 August 2026: the manual audit finished, Phase 2 restarted

**All 225 existing records are Status Done**, two-sourced, and carry an August
2026 Verified Date. Verified against the live table, not counted: a query for
records that are not Done, or have no Verified Date, or carry a date before 1
August 2026, returns zero rows. Nothing remains on the May 2026 stamp that
started this work. Audit logs are in `docs/airport-audits/`.

That closes the objection recorded on 25 August, which was that creating 368
identity-only records while the live ones had never been audited would widen a
problem rather than fix it. The live ones are now audited, so the breadth pass
is the right next step and `/api/cron/reference-identity` is scheduled again,
every two hours. **Turn it off when coverage is reached**: each run scans four
tables in full to work out what is missing, which is waste once nothing is.

**The worklist is `docs/airport-audits/new-airports.md`.** 293 codes from the
committed target list are still missing, pre-flighted one by one against
OurAirports using the repo's own parser: all 293 present, all with scheduled
service, all with a municipality and coordinates. The plan's headline 368 is
this 293 plus the airports our own prose names, which the breadth detector
recomputes on each run because the prose changes.

**Two write-reporting defects fixed before the run, not after.** Both fill
passes did this:

```js
await createSkeleton(record).catch(() => {}); didCreate = true; created++;
```

A failed Airtable write was swallowed and then counted as a success. Pointed at
293 records with a bad token or a 422, the run would have reported "created
293" having created none, and the needsHuman list would have been empty because
nothing disagreed. That is the same class of untruth as a record stamped
Verified that was never checked, which is the thing this whole project exists to
remove. Both passes now count the result rather than the attempt, report a
`failed` count and a `writeFailures` list, and leave a record that failed to
write on the worklist so the next run retries it.
`test/airport-fill-write-truth-smoke.mjs` covers it with 23 assertions, checked
against the old code to confirm it fails there.

**Why the run cannot be driven from a Claude Code session.** The container's
egress policy allows `raw.githubusercontent.com` but denies
`query.wikidata.org`, `davidmegginson.github.io` and `tg-widgets.vercel.app`.
Source 1 is reachable, source 2 is not, and neither is our own deploy. A session
can therefore prepare and verify the run but cannot execute it, and must not
create records from source 1 alone. The cron on Vercel has no such restriction,
which is what the "validated on a deploy, not here" note in `_breadth_fill.js`
has always meant.

**What a created record is, and is not.** Identity only: IATA, name, city,
country, coordinates, both source URLs, the date, Status `In progress`. No
narrative. `identityFields` cannot write an overview, terminal, parking, lounge,
train, coach, taxi or arrival field, and the test asserts it. So a skeleton
carries no prose at all, which is the only guarantee worth making about AI
tells: there is nothing generated in the record to detect. The narrative is
Phase 3, written and two-sourced by hand.

### 27 August 2026: the fill finished

**600 records, 600 distinct IATA codes, no duplicates.** The table went from 225
to 602 overnight on two-hourly runs, then to 600 after two bad records were
deleted. It covers 474 of the 475 airports on the committed target list plus
the airports our own prose names.

| | |
|---|---:|
| Records before | 225 |
| Created by the fill | 377 |
| Deleted as not real airports | 2 |
| Total now | 600 |
| Targets covered | 474 of 475 |
| Records needing a human | 17 |

**What needs a human, and why.** HBE, Borg El Arab at Alexandria, was never
created: the two sources would not corroborate it. Sixteen more records carry
coordinates, both source URLs and the date but no name, because OurAirports and
Wikidata disagree about what the airport is called. LIR is "Daniel Oduber
Quirós" to one and something else to the other; IGU is "Cataratas" to one and
"Foz do Iguaçu" to the other; PVR is "Puerto Vallarta" to one and "Licenciado
Gustavo Díaz Ordaz" to the other. The rule leaves those blank rather than
picking a side, which is correct, and it works out at roughly one record in
thirty-seven.

**The cron is off again.** It has nothing left to do except reprocess those 16
every two hours while scanning four tables to find them. The note at the top of
`api/cron/reference-identity.js` says what would justify turning it back on.

**Three bugs the run itself found**, each caught by checking output rather than
trusting it:

1. The breadth detector read "(KLM)" in two Caribbean records as an IATA code
   and created Kalaleh Airport in Iran. The stop list now covers airlines,
   currencies and travel abbreviations, and a prose-derived code has to prove
   it is an airport a customer could fly to.
2. `normalizeName` turned every character outside a-z into a space before the
   token length filter, so "Málaga" tokenised to "laga" and never matched
   "malaga", and "Fa'a'a" collapsed to nothing at all. Diacritics now fold and
   apostrophes are removed.
3. The backfill took the first 25 due records in the same order every run, so
   permanently-stuck records at the head of the queue starved everything
   behind them. Two records created nameless by bug 2 were still nameless two
   runs after the fix, because the fix could never reach them.

**Kalaleh (KLM) and Hector Silva Airstrip (BCV) were deleted** on 27 Aug at
Andy's instruction, having been created from prose false positives before the
detector was fixed. Both were checked before deletion: Status In progress, no
narrative, nothing to lose. The stop list and the bookable-airport test mean
neither can come back.

### 27 August 2026: two serving depths

The fill left 375 records that were correct, two-source verified and completely
invisible: the picker offered Done and Live only, so an airport whose position
we knew precisely could not be shown on a map. Records are now served at one of
two depths.

| Depth | Which records | What is served |
|---|---|---|
| full | Done, Live | everything, including the audited narrative |
| identity | anything with a name, coordinates and BOTH source URLs | name, IATA, city, country, coordinates, linked cities and resorts |

**The narrative is stripped server side**, in `api/airport-content.js`, not
skipped by the widget. A Draft record is prose that has been written and NOT
checked, and if the widget were trusted to skip it the prose would still be in
the response, one careless consumer away from a client site.

**No widget change was needed.** Every section renderer in
`public/widget-airport.js` already returns nothing when its field is absent, so
an identity record renders as hero, map and nothing else. The claim that these
records would produce "a spotlight full of empty sections" was wrong, and
checking before building saved the work.

**The allowlist is an allowlist because the blocklist failed within the hour.**
The first version listed the narrative keys to remove, written from memory, and
seven were wrong: the payload calls them `gettingThereByTrain`,
`taxiAndRideshare`, `parking`, `dropOffInfo` and `flightTimeFromUK`, so all the
transport prose plus flight times would have been served. A blocklist fails
open. The smoke test now reads the real key list out of `airport-content.js`
rather than checking a hand-written list against itself, which is what let it
through: the extraction had to be fixed too, since it missed shorthand
properties and several keys on one line.

`officialWebsite` is withheld at identity depth. It is the one omission that
costs something, being the obvious onward link, but it is typed by a human and
never checked, and sending a customer to the wrong airport's website is worse
than sending them nowhere.

### 28 August 2026: the climate fill stopped at its floor

64 of the 118 city records converted. 54 did not, and further runs were not
going to change that: the rate went 7.5 per run, then 4.25, 3.25, 2.25, then 1
of 8, then 0 of 8. The window rotates, so everything outstanding had been tried
repeatedly and failed the same way each time.

**Why the 54 fail, read from the run logs rather than assumed.** This corrects
what was being said about it for two days. Three causes, and only the third is
"mountains and deserts":

| Cause | Examples | Nature |
|---|---|---|
| Temperature, the 3 degree band | New York, Queenstown, Varadero, Phnom Penh, Thassos, Norwegian ski resorts | gaps of 3.0 to 3.9 degrees, just over the line |
| Rainfall, the 12mm floor | Sal, Volcanoes National Park, Petra, the Holy Cities | 5mm against 21mm: trivial in absolute terms, large as a ratio |
| Rainfall, real divergence | Fiordland 375 against 176, Galapagos 122 against 64 | MERRA-2's coarser grid smooths orographic rain |

The largest bucket is temperature, and New York is in it. That is not exotic
terrain, it is a band set at 3 degrees when two reanalyses routinely differ by
more.

**Andy set the rainfall FRACTION at 0.6 knowing the trade.** He has never been
asked about the temperature band or the rainfall floor, and they are now the
bigger share of the blockage. Those are decisions for him, not knobs to turn
quietly, so the cron is off and the position is reported rather than loosened.

The prose in every unconverted record is untouched, and archived at
`docs/climate-archive/cities-climate-prose.json` regardless.
