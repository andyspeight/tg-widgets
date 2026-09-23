# The Overview verification sweep

Started 23 September 2026. This folder is the method, the tools and the
evidence trail for bringing every September-written airport Overview up to the
airport-spotlight standard: every fact-bearing claim confirmed by two
independent sources, or corrected, softened or cut.

## What is in scope, and what is not

**In scope: the 374 records at Status `In progress` that carry an Overview.**
Their Overviews were written 15 to 22 September from one source (the Wikipedia
article) plus a name-and-number tracer. Nothing else in these records is
narrative: they are identity skeletons from the 26 to 27 August fill.

**Not in scope: the 225 records at Status `Done`.** Those were audited to the
two-source standard on 25 and 26 August 2026, field by field, with logs in
`docs/airport-audits/`. The September run did not touch their Overviews.

**Not in scope: MPC** (ignored on Andy's instruction, 22 Sep) **and the 428
thin records** added 22 and 23 Sep, which carry no Overview.

### A correction to what we had been saying

`../README.md` and the Airtable project record both said Verified Date was blank
on all 599 Overview records. It is not, and never was. Measured 23 Sep:

| Status | Records | Verified Date | What the date attests |
|---|---:|---|---|
| Done | 225 | 25 to 27 Aug 2026 | full two-source audit of every field |
| In progress | 374 | 26 to 27 Aug 2026 | identity only (OurAirports plus Wikidata), set by the fill |

So the September Overviews sit on records whose date predates them. Nothing
unaudited reaches a client, because `api/airport-content.js` strips all
narrative from any record that is not Done or Live. But the date on those 374
says nothing about their Overviews until this sweep re-stamps it.

## The standard, per claim

A claim is anything with a number, a name, a date, a ranking, a direction or a
recent change. For each one:

1. **Source 1** is normally the Wikipedia article the Overview was written
   from (`wikipedia-archived` where the run archived it, otherwise
   `wikipedia-now`).
2. **Source 2 must come from a different organisation.** Wikipedia, Wikidata,
   Wikiwand and anything that copies Wikipedia count as one organisation
   (Wikimedia). Order of preference: the airport operator, a government or
   regulator (statistics office, civil aviation authority), the airline's own
   site for its own base or routes, reputable news and trade press (Reuters,
   Aviation Week, CAPA, national newspapers of record), then travel guides only
   to confirm something plainer sources already say.
3. **Time-sensitive claims** (passenger numbers, airlines, routes, terminals,
   works, closures) need at least one source dated within twelve months.
4. **When source 1 is out of date**, the corrected fact needs two sources of its
   own, neither of them the stale one.
5. **Nothing is written from memory.** A quote counts only if it is on a page
   saved by `grab.mjs`, and the gate proves that mechanically.
6. **If a claim cannot be confirmed** after a reasonable search (two or three
   attempts), it is cut, or softened to something two sources do support.
   Never split the difference between two sources and never guess.

Location claims have their own check. `geo.mjs` computes the straight-line
distance and bearing from the GeoNames city centre to the OurAirports position,
data that owes nothing to Wikipedia. A stated bearing passes when it is the
computed compass point or an adjacent one (within 45 degrees). A stated
distance passes when stated divided by straight-line falls between 0.8 and 1.6,
since an Overview may give the road distance. Outside that, the figure needs a
second written source or it goes.

## The tools

All in this folder. Evidence text lives in the session scratchpad
(`$SWEEP_EVIDENCE`, one folder per airport); only the quotes and URLs are
committed, in the ledgers.

| Script | Does |
|---|---|
| `start.mjs <IATA>` | Opens an airport: prints the record, saves source 1, runs the coordinates check, creates `ledger/<IATA>.json` with the old text copied from the snapshot |
| `wiki.mjs <IATA>` | Saves the Wikipedia text: the archived copy the Overview was drafted from, the article as it reads today, and today's infobox as `key = value` lines (where passenger figures, runways, hubs and opening dates usually live) |
| `geo.mjs <IATA>` or `--all` | The coordinates check above, plus runway lengths and elevation from OurAirports |
| `grab.mjs <IATA> <label> <url> [regex]` | Saves one source page as text, with its URL and fetch time, and prints the matching lines |
| `grabb.mjs <IATA> <label> <url> [regex]` | The same through a real Chromium browser, for the many official and news sites that answer a plain request with 403. Certificate checking stays on: the session's proxy CA was added to Chromium's trust store (`certutil`, 23 Sep), never bypassed |
| `check.mjs <IATA>` | The gate. Every quote on its saved page, two organisations per kept claim, every sentence of the new text carried by a checked claim, tracer, bearings, house style |

## Bulk second sources, fetched once for many airports

| Source | Airports | Evidence file | What it settles |
|---|---:|---|---|
| CAAC 2025 airport throughput table (published 26 Feb 2026) | 47 Chinese | `caac-2025.txt` | passengers 2025 and 2024, national rank, aircraft movements |
| Eurostat `avia_paoa`, passengers carried, 2022 to 2025 | 68 European and Turkish | `eurostat.txt` | annual passengers; note Eurostat's own definition can sit 1 to 3 per cent off an operator's figure |

First pass, 23 Sep: CAAC matched the passenger figure, rank or movements in
22 Chinese Overviews to within rounding and caught one outright error (KWE
Guiyang said 30.2 million; the official figure is 22,731,681, which Wikipedia's
own infobox also gives while its body text says 30.2). Eurostat matched 21
European figures within 3 per cent and showed 11 Overviews quoting 2015 to 2019
figures where 2025 ones now exist (BGO BRU CFR GOA NTE OSD PTP RTM SDR STR TRD).
The coordinates check confirmed 186 stated distances or bearings and flagged 54
for a look in context.

## The ledger

`ledger/<IATA>.json` is the verification log for one airport: the old text, the
new text, and every claim with its verdict (`confirmed`, `corrected`,
`softened`, `cut`), the phrase in the new text that carries it, and for each
source the saved file, the organisation and the exact quote. `ledger/TBS.json`
is the worked example.

## Writing to Airtable

Only after `check.mjs` says READY TO PUSH and a person has read the ledger.
One record per call, `typecast: true`, writing the Overview and Verified Date
and nothing else. The response is compared with the ledger's new text.

Status is NOT changed by the sweep. By the Status contract in
`api/_lib/airport-status.js`, a record whose narrative has been audited against
two sources is `Done`, and Done is servable. That is Andy's call, asked on
23 Sep.

## Progress

| Date | Airport | Result |
|---|---|---|
| 23 Sep 2026 | TBS Tbilisi | Verified and pushed. 16 claims kept (6 corrected), 8 cut. Caught: the Russian flight ban was lifted in May 2023; traffic and airline counts were a year and a half stale |
| 23 Sep 2026 | KWE Guiyang | Verified and pushed. 10 kept, 9 cut. Caught: passengers 30.2 million should be 22.7 million; "the runway is 3,200 metres" when there have been two since 2021 |
| 23 Sep 2026 | BRU Brussels | Verified and pushed. 10 kept, 8 cut. Caught: a 2019 passenger figure where 2025's (24.4 million) exists; TUI fly Belgium's "home base" softened to a base |
