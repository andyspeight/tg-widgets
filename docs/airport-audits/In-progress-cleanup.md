# The 123 In-progress records: defect sweep

Started 25 August 2026. These records carry narrative but no cited sources, so
they sit at `In progress`, gated out of the picker and off every client site.
Before any of them can be verified and made servable, they needed the known
defects clearing.

## What the sweep found

| Defect | Instances | What it is |
|---|---|---|
| **Corrupted currency symbol** | 160 fields | Every GBP conversion renders as `¤` instead of `£`. "Around AUD $22 one-way (around ¤11)". This is mojibake from whatever wrote the records, and it would have displayed as literal garbage in the widget |
| **Em dashes** | 943 fields | Against the brand rule, and the single biggest AI tell |
| **Withdrawn ETIAS date** | 73 fields, 37 records | The same "expected Q4 2026" claim corrected in the live records |
| **ESTA at $21** | 6 fields, 6 records | DFW, LAX, ORD, LAS, SEA, SFO. Same error as the live US records, phrased as "US$21" so it did not match the first sweep's pattern |

The currency corruption is the notable one. 160 separate price conversions
across 34 countries, every one of them unreadable. Nobody had looked at these
records closely enough to notice, which is what happens when a table's status
field says everything is finished.

## A near-miss worth recording

While building the fix I ran a check for stray dates in the prose and appeared
to find one in **every** record: an ISO date sitting mid-paragraph. It was not
real. My check joined every string field of a record together before searching,
and the Verified Date field sat between two prose fields in that join, so the
date I was seeing was the field boundary, not corrupted text.

The fix I had written would have stripped that pattern from every field
including the Verified Date, blanking it on all 123 records: destroying the
audit trail this whole exercise exists to build.

It was caught by reading the generated payload before pushing rather than
trusting the summary counts. The rule that follows: **check a defect inside
individual fields, never across a concatenation of them**, and read a sample of
any generated payload before it goes anywhere near the table.

## What this does and does not achieve

It removes known-wrong and unreadable content. It does **not** make any record
servable. That still needs per-record two-source verification of every
fact-bearing claim, exactly as done for the 102 live records. These 123 stay at
`In progress` until that happens.

## Progress

15 of 120 records with defects pushed. The remaining 105 are batched and queued.
