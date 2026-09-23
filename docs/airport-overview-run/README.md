# The airport Overview run, Sep 2026

What this folder is: the working record of filling the Overview field on the
Airports table (base `appuZdlMJ7HKUt6qS`, table `tblI2iVAbIGCtsGa7`,
field `fldmRELkLWrUGL5Ss`). Written to the repo because it started life in a
session scratchpad, which does not survive.

**State as of 22 Sep 2026: 599 of the original 600 records carry an Overview.**
The one blank is MPC, a small airport in Bengkulu that Andy has said to ignore.
Do not reopen it and do not count it as a gap.

**The table now holds 1,028 records.** 418 were imported on 22 Sep under the
traffic rule Andy set (peak passengers >= 1m, or busiest in its country with at
least 100k), and 10 more were hand-sourced on 23 Sep for countries with no
Wikidata traffic figure (18 were added; Andy had the eight resting on one
publisher or indirect evidence pulled the same day). All 428 are thin by design: name, IATA, country, lat/lng,
Wikipedia URL, Source 1, Status "Todo". They carry no Overview, and they are
NOT part of the 599 figure above. See `world-coverage-plan.md` and
`thirty-countries.md`.

**Verified Date is blank on all 599, deliberately.** Andy chose finish-first,
verify-after on 21 Sep. The records meet one traced source plus the three-layer
gate; they do NOT meet the airport-spotlight skill's two-source rule. Closing
that is the next job.

## Files

- `verification-backlog.md` — START HERE for the sweep. Priority order, the
  records that most need a second source, the source self-contradictions that
  were logged rather than silently resolved, and the per-batch notes.
- `world-coverage-plan.md` — phase 2, the 418-record import: the rule, the
  sources, what was verified afterwards, and the 39 countries still missing.
- `thirty-countries.md` — the 23 Sep hand-sourcing of the 30 countries Wikidata
  could not judge: what was added, what was left out and why, source by source.
- `build-import.mjs` — regenerates that import from OurAirports and Wikidata.
  Re-run it when OurAirports updates. Verified 22 Sep to reproduce the run
  exactly: 929 qualifying, 892 over the threshold, 37 on the country floor,
  180 countries, the same 418 new records.
- `save.mjs` — the verification harness. Shape check, a name-and-number tracer
  that flags any proper noun or figure absent from the fetched source, and a
  compass check.
- `resolve.mjs` — resolves a Wikipedia article for a record that has no URL on
  it, and only accepts a match whose article text carries that record's own
  IATA code.
- `evidence/` — archived source text for batches 7 to 13. Batches 1 to 6 were
  not archived and need re-fetching.

## Three things that will bite you

**The tracer cannot see a wrong compass bearing.** It checks names and numbers.
A draft saying north east where the source says south west passes silently.
That is a real error that reached Airtable once (Enfidha). `save.mjs` now
carries a direction check; its regex has to handle `southwest`, `south west`
and the `-ern` forms or it both throws false alarms and misses real ones.

**A blank Wikipedia URL makes a record invisible, not flagged.** `batch.mjs`
filters on that field, so 30 records were skipped silently for eleven batches
while the script reported a smaller remaining count than the ledger. They were
found only because two counts disagreed and neither was trusted. Those 30 have
since been backfilled, but any future runner should reconcile against a live
Airtable count rather than a local ledger.

**Wikidata's latest passenger figure is not its highest.** Reading P3872 by
most-recent statement gives Surabaya 340 passengers and Kos 39,000: Wikidata
holds several statements per year and the newest often lands on a pandemic
figure. 334 of 2,960 airports read under a fifth of their own historic max that
way. Take the peak since 2015 instead. In the 22 Sep working set, `joined.json`
carries the bad figures and `peak.json` the good ones.

**An airport's name is not evidence of international service.** SDF Louisville
is an International airport with no scheduled international passenger flights.
ZUH Zhuhai has the facilities and flies only domestic. THR Tehran Mehrabad lost
its international traffic in 2007. Any filter must test scheduled service.
