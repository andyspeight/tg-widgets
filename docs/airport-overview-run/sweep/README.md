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

**Attributed statements** are the one exception to the two-source rule. A
sentence that names who says something ("The FCDO advises against all travel to
Yemen") is checked against that body's own page, because nobody is better placed
to confirm what the FCDO advises than the FCDO. The gate allows one source only
when the claim is marked `primary`, the text names the body (`attribution`), and
the source is that body. The facts behind the advice still need two sources.

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
| `show.mjs <IATA>` | Prints a ledger for the human reviewer, flagging low-tier sources and undated time-sensitive claims |
| `links.mjs <url> [regex]` | Lists the links on a page through the browser, to find a publisher's own page (a results release, a lounge list) without a search engine. Finding only: nothing it prints is evidence |
| `refs.mjs <IATA> [regex]` | Lists the external sources the Wikipedia article cites, grouped by publisher, so the original publisher can be opened without a search engine |
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
| 23 Sep 2026 | DEN Denver | Verified and pushed. 12 kept, 8 cut. Settled the logged 25 versus 23 miles contradiction (Colorado Newsline: about 25). Six single-source superlatives cut |
| 23 Sep 2026 | STR Stuttgart | Verified and pushed. 6 kept, 7 cut. Caught: a 2018 figure (11.8 million) where 2025's is 9.6 million, and "sixth busiest in Germany", no longer true |
| 23 Sep 2026 | LXA Lhasa | Verified and pushed. 8 kept, 8 cut. Settled both logged contradictions: elevation 3,570 m (not 3,500 or 3,600), distance in the low sixties of km (not 97) |
| 23 Sep 2026 | HFE Hefei | Verified and pushed. 9 kept, 5 cut. Settled the logged "12,645 million" (CAAC: 12,644,989). The district is cut: Wikipedia and the 2013 Xinhua report disagree |
| 23 Sep 2026 | DRW Darwin | Verified and pushed. 7 kept, 6 cut. Passenger rank and figure confirmed against BITRE. The logged terminal contradiction stays open: no official source settled it, so the claim is cut |
| 23 Sep 2026 | KRT Khartoum | Verified and pushed. 6 kept, 8 cut. Caught: "closed to 25 March 2025" was wrong; domestic flights resumed 22 Oct 2025, the first international flight since the war landed 28 Apr 2026, drones hit the airport again 4 May 2026 |
| 23 Sep 2026 | TAS Tashkent (helper) | Verified and pushed. Caught: 12 km from the centre is about 6; the new airport now has a groundbreaking (Oct 2025) and a signed contract (Jun 2026); the drop-off camera rule is unconfirmed within 12 months |
| 23 Sep 2026 | PLS Providenciales (helper) | Verified and pushed. Caught: renamed officially 21 May 2024, not 2023; the terminal is over capacity and a new arrivals hall is in design |
| 23 Sep 2026 | INC Yinchuan (helper) | Verified and pushed. Caught: the terminal layout was eight years stale (international moved to T2 in Feb 2018; T3 domestic since Dec 2016); disputed taxi fares cut |
| 23 Sep 2026 | MEM Memphis (helper) | Verified and pushed. Renaming of 11 Aug 2026 confirmed three ways; MEM code unchanged; FedEx daily flight count cut because good sources disagree (400, 250, 165) |
| 23 Sep 2026 | KWI Kuwait (helper) | Verified and pushed. Caught: airspace shut 28 Feb to 26 Apr 2026 in the Iran war, Terminal 1 closed since an air strike on 3 June, a third runway of 4,580 m. Re-checked independently against the FCDO page |
| 23 Sep 2026 | HRB Harbin (helper) | Verified and pushed. Caught: "terminals a mile apart" is out of date since July 2024; international moved into a rebuilt T1 joined to T2 |
| 23 Sep 2026 | SYZ Shiraz (helper) | Verified and pushed. Caught: nothing on the 2026 war; Iran shut its airspace after the 28 Feb strikes, Shiraz reopened by late April, EASA says do not overfly, FCDO says do not travel. Now mostly a travel warning |
| 23 Sep 2026 | CCS Caracas (helper) | Verified and pushed. Caught: city direction wrong (the airport is north of Caracas, not east of it); earthquakes on 24 Jun 2026 shut the terminal; reopened 1 Sep at about a quarter of capacity |
| 23 Sep 2026 | SAH Sanaa | Verified and pushed. Caught: the text stopped at May 2022; Israeli strikes Dec 2024 and May 2025 (Yemenia's last plane destroyed), the government bombed the runway 13 Jul 2026. FCDO: against all travel |
| 23 Sep 2026 | GIG Rio de Janeiro Galeão (helper) | Verified and pushed. Caught: "jointly managed with Aena since March 2026" was wrong (that was the auction; handover expected late 2026); Terminal 1 closed to passengers since 2016; the BRT is not 24 hours |
| 23 Sep 2026 | MNL Manila (helper) | Verified and pushed. Caught: "47 per cent up" in 2024 was wrong (11 per cent); 2025 record of 52 million; terminal moves of March 2026; 7 km distance fails the coordinates. The 1983 assassination line is cut for want of a fetchable second source (flagged for Andy) |
| 23 Sep 2026 | AQJ Aqaba | Verified and pushed. 3 kept, 9 cut. The July 2026 missile claim (aircraft hit at the airport) had one saveable source; the Jerusalem Post confirms a missile fired at the Aqaba area on 19 July and its interception, nothing more. The text now carries the FCDO's current account: Iranian strikes in Jordan since July, renewed attacks and interceptions around Aqaba in early September |
| 23 Sep 2026 | SZX Shenzhen (helper) | Verified and pushed. 12 kept, 11 cut. Third runway (29 November 2025) confirmed three ways. The ferry to Hong Kong airport is cut: sources conflict on whether it still runs, and passengers do clear Chinese immigration, at Fuyong |
| 23 Sep 2026 | ALA Almaty (helper) | Verified and pushed. 12 kept, 11 cut. Caught: 7.2 million (2022) is now 11.4 million (2024); TAV owns 85 per cent, not all of it; Air Astana has two hubs; bus 92 runs by day and bus 3 at night. Booth and e-gate counts cut in review, because the two sources disagree on what they cover |
| 23 Sep 2026 | IKA Tehran Imam Khomeini | Verified and pushed. 9 kept, 10 cut. Caught: "shut down days after the first landing" (Reuters: the military blocked the runway on the first day, May 2004); nothing on the 2026 war; international flights resumed on 18 April 2026; new US sanctions from 23 September 2026 and Turkish Airlines' suspension to at least March 2027 |
| 23 Sep 2026 | THR Tehran Mehrabad | Verified and pushed. 8 kept, 9 cut. Caught: "Imam Khomeini opened in 2007" (it first operated in 2004); a 2017 traffic figure; nothing on the 2026 war; reopened mid-April 2026 |
| 23 Sep 2026 | MHD Mashhad | Verified and pushed. 7 kept, 5 cut. Now mostly a travel warning. The civil and military air base line was cut: Wikipedia takes it almost word for word from GlobalSecurity, so the two are one source |
| 23 Sep 2026 | SYZ Shiraz (revised) | Added the same sanctions sentence as IKA and MHD, from reports dated 21 and 22 September. The ledger carries a `revised` note |
| 23 Sep 2026 | EVN Yerevan Zvartnots | Verified and pushed. 7 kept, 8 cut. Caught against the operator's live pages: no Europcar desk now (Carwiz, Enterprise, GoMotion, Hertz, SIXT), no HSBC cash machines, and the lounge is the airport's own Business Lounge, not Converse Bank's. 15 km from the centre is about 12 by road |
| 23 Sep 2026 | GYD Baku | Verified and pushed. 9 kept, 10 cut. Caught: "running at up to 3 million" (7.5 million in 2024); the former name Bina International is disputed by the operator; lounge counts disagree (five, four or seven), so "several" |

Integrity pull, evening of 23 Sep: all 23 pushed records match their ledgers word for word, carry Verified Date 2026-09-23 and kept their Status. The other 576 Overview records are unchanged since the morning snapshot.
