# USA: re-verification of the 14 live records

Audited 25 August 2026. Prior Verified Date on every one: 11 May 2026.

## The headline: the error the skill was written to stop was never fixed

The `airport-spotlight` skill was created on 11 May 2026, and its very first
listed systemic error is:

> **ESTA fee = $40 USD (NOT $21). Increased 30 September 2025. Source: cbp.gov.**

**All 14 live US records still said $21.** Including JFK, which the skill
records as "FULLY AUDITED with 2-source verification". The correction was
written down, published as a rule, and never applied to the data.

The real figure today is **$40.27** ($4.00 processing plus a $36.27
authorisation fee), not even the flat $40 the skill records. Every record now
carries $40.27 with the date of the rise, so an agent quoting it can see why it
changed.

This is roughly double what our records told agents to tell customers. On a
family of four that is about $77 of unexpected cost at the point of applying.

Sources: fragomen.com (DHS implementation notice), visahq.com, usestavisa.com,
nbaa.org, visasnews.com.

## Also corrected

| Airport | What the record said | Verified position |
|---|---|---|
| JFK | "Terminal One opens its first 13 gates in June 2026" (stated twice) | The New Terminal One's first phase has slipped from June 2026 to at least November 2026. Gate count is reported as both 13 and 14, so no number is stated |
| JFK | "Newly opened T6 (Phase 1, 2026)" | T6's first phase opened in the first half of 2026 with five gates, the check-in hall and a centralised TSA checkpoint. Full terminal completes 2028 |
| JFK | AirTrain "$8.75 to subway or LIRR" | Correct, and now also notes the $43.50 cap over a rolling 30 days |
| JFK | "MetroCard sales ended December 2025, OMNY is the system now" | Correct. Added that the subway is a flat $3.00 and that after 12 rides in a Monday to Sunday week the rest are free |

## Confirmed correct, no change

- **Global Entry $120 for 5 years**, checked against CBP's own pages. Right in
  JFK and EWR.
- **AirTrain JFK $8.75** and **NYC subway $3.00 via OMNY**, both right.
- **MetroCard sales ended December 2025**, right.
- **EES does not apply to the USA**, right in all 14.
- LGA's note that the AirTrain project was cancelled in 2021, right.

So the May audit's transport findings did land. It was the ESTA fee, the single
most expensive fact for a customer, that did not.

## Still outstanding

Six US records (DFW, LAS, LAX, ORD, SEA, SFO) are Status `In progress` and were
not part of this pass. They carry the same $21 figure. The Status gate keeps
them out of the picker and off client sites, so no agent can reach them, and
they will be corrected when their own audit reaches them.

**No live record in the table now understates the ESTA fee.**
