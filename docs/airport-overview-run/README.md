# The airport Overview run, Sep 2026

What this folder is: the working record of filling the Overview field on the
Airports table (base `appuZdlMJ7HKUt6qS`, table `tblI2iVAbIGCtsGa7`,
field `fldmRELkLWrUGL5Ss`). Written to the repo because it started life in a
session scratchpad, which does not survive.

**State as of 22 Sep 2026: 599 of 600 records carry an Overview.** The one
blank is MPC, a small airport in Bengkulu that Andy has said to ignore. Do not
reopen it and do not count it as a gap.

**Verified Date is blank on all 599, deliberately.** Andy chose finish-first,
verify-after on 21 Sep. The records meet one traced source plus the three-layer
gate; they do NOT meet the airport-spotlight skill's two-source rule. Closing
that is the next job.

## Files

- `verification-backlog.md` — START HERE for the sweep. Priority order, the
  records that most need a second source, the source self-contradictions that
  were logged rather than silently resolved, and the per-batch notes.
- `world-coverage-plan.md` — phase 2, extending to every airport worldwide.
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

**An airport's name is not evidence of international service.** SDF Louisville
is an International airport with no scheduled international passenger flights.
ZUH Zhuhai has the facilities and flies only domestic. THR Tehran Mehrabad lost
its international traffic in 2007. Any filter must test scheduled service.
