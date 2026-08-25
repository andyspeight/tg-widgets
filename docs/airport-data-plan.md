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

### Phase 4: Keep it true

Fix the freshness arithmetic. 25 records a week against a table of 230 and a 60
day TTL never converges. Either run daily, raise the batch, or set the TTL by
tier so Tier 1 is checked often and Tier 3 rarely. Turn on re-stamping for clean
two-source confirmations, and keep drift flagged for a human.

---

## 6. Open decisions for Andy

1. Which definition of "major" (A, B or C above).
2. Phase 0 before Phase 2, or add coverage first and remediate after. The
   recommendation is Phase 0 first.
3. Whether cohort B's existing prose is kept and enriched, or rewritten. It is
   longer than cohort A's but written in a different register, and none of it
   has a cited source.
4. Whether to log this as its own project row, separate from the widget build
   row `rec95Ed74DWhznnyb`.
