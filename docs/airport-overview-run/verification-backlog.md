# Airport Overview verification backlog

Andy's decision, 15 Sep 2026: finish all 363 Overviews first, verify afterwards
as a single sweep. `Verified Date` (fldRCo83Wz1AFZXwP) is deliberately LEFT
BLANK on every record until that sweep runs.

## What standard these records currently meet
- Every claim traced to ONE fetched source document per airport (Wikipedia
  full-article text, not the intro).
- Automated tracer flags any proper noun or number in the draft that does not
  appear in that source. Every flag was resolved by hand before saving.
- Three-layer gate: SHAPE (deterministic), GROUNDING (model), ADVERSARIAL.
- Directions and distances re-read by hand against source (this caught the
  Enfidha error that the tracer could not see).

## What standard they do NOT yet meet
The `airport-spotlight` skill requires TWO independent sources per fact-bearing
claim, a per-airport verification log, and one-record-at-a-time pushes with
typecast. None of that has been done for the Overview field.

## What the sweep must check, in priority order
1. **Passenger figures + year** - present in almost every Overview. Skill note:
   "around 2025 numbers" often means 2024 actuals.
2. **Recent-change claims** - the operationally serious ones:
   - LAD Luanda: closed to commercial flights 1 Mar 2026, replaced by
     Dr Antonio Agostinho Neto Intl 40 km south. RECORD NAME ALSO WRONG.
   - TAS Tashkent: new airport late 2030, current one closes.
   - PLS Providenciales: renamed Howard Hamilton Intl in 2023.
   - GIG Rio Galeao: management changed 30 Mar 2026 (RioGaleao + AENA).
   - MNL Manila: privatised 14 Sep 2024 to NNIC consortium.
   - INC Yinchuan: Terminal 2 closed for renovation.
   - HRB Harbin: intl and domestic terminals ~1 mile apart.
   - AQJ Aqaba: reported missile strike Jul 2026, accounts differ.
   - SAH Sanaa: war damage, commercial flights resumed May 2022.
   - SZX Shenzhen: third runway opened 29 Nov 2025.
   - ALA Almaty: Terminal 2 opened 1 Jun 2024, intl only.
3. **Terminal assignments** - ZNZ, DAR, XIY, STL, DCA, ACC, CGO, HRB, INC.
4. **Anything with a fee or fare** - INC taxi fares (Y20 shuttle, ~Y80 taxi),
   EIS 20 dollar departure tax, FEZ 150 dirham fixed fare, TSN Y3 metro.

## Evidence archive
`evidence/batch-NN.json` holds the exact source text each batch was written
from, so the sweep can diff a claim against what was actually read rather than
re-fetching. Batches 1-6 (records 1-179) were written before archiving started,
so their evidence must be re-fetched.

## Source problems noticed while drafting (check these first in the sweep)
- **HFE Hefei**: source reads "12,645 million passenger movements" for 2025.
  Only sensible reading is 12.645 million. Written as "about 12.6 million".
- **KRT Khartoum**: source places the planned New Khartoum International at
  Omdourman "40 km SOUTH of the centre of Khartoum". Omdurman sits across the
  Nile from Khartoum, so the direction looks wrong. Direction deliberately
  OMITTED from the Overview; distance kept. Verify before anyone adds it back.
- **LXA Lhasa**: source gives elevation as both 3,600 m and 3,500 m in
  different paragraphs. Written as "over 3,500 metres", true under either.
  Also gives distance to Lhasa as both 97 km and 62 km; only 62 km used.
- **DTW Detroit**: source says both "129 in-service gates" and "a total of
  151 gates". Neither total used; only the McNamara Terminal's 122 quoted.
- **PEN Penang**: source says "third busiest in Malaysia by aircraft
  movements" in one paragraph and "second busiest... after KLIA" in another.
  Ranking omitted entirely; passenger numbers used instead.
- **SID Cape Verde**: source says "four gates" and "six departure gates" in
  the same section. Gate count omitted.

## Batch 9 (LUX..FUK) — source problems noticed while drafting

- **DEN Denver** — source gives the distance twice and disagrees with itself:
  "25 miles driving distance northeast of Downtown Denver" and "23 miles from
  Downtown Denver"; also "19 miles farther than Stapleton" and "15 miles
  farther". Used 25 miles by road, omitted the Stapleton delta entirely.
  Needs a second source to settle.
- **LAU Manda/Lamu** — source says "a single runway" in one place and "the
  airport has two runways" in another, then lists a paved 6,330 ft strip and
  an unpaved 3,054 ft one. Wrote "a paved runway of 6,330 feet and a shorter
  unpaved strip", which is true under the detailed reading. Verify.
- **FIH N'djili** — the fetched source NEVER names the country, only "the
  busiest airport in the country" and "serving Kinshasa". Draft was rewritten
  to stay inside the source. The Airtable record should carry DR Congo in a
  country field; the Overview deliberately does not assert it.
- **SDF Louisville** and **ZUH Zhuhai** both carry "International" in their
  names while having no scheduled international passenger flights (SDF) or
  only domestic routes (ZUH). Both are stated in the Overviews. These two also
  matter for the phase 2 world-coverage list: name alone will not tell you
  whether an airport is actually international.

## Batch 10 (LOS..RGN) — notes for the sweep

- **SYZ Shiraz** — source says a new international terminal "was due to be built
  by 2024" and does not say whether it opened. The Overview flags the terminal
  as in transition rather than stating a state. Needs a current check.
- **KWI Kuwait** — Terminal 2's opening date has moved four times in the source
  (Aug 2022, 2024, Q4 2026). Drone strike on the construction site is stated
  without a date. Both need a second source.
- **TAB Tobago** — expansion items listed as PENDING/COMPLETED with no dates
  attached. Status may have moved since.
- **PIE / RMQ / HAK** — three drafts named things the source never named
  (Tampa International, Ching Chuan Kang Air Base, Hainan Airlines). All three
  rewritten to stay inside the source before saving. Worth re-checking whether
  the fuller names are correct, then restoring them if so.
- **REU Reus** is marketed as "Barcelona-Reus" but is 103 km from Barcelona.
  **VNO Vilnius** carries a FIXED-TERM renaming (Čiurlionis, 1 Jan 2025 to
  31 Dec 2029) that will revert. **HRE Harare** has four names in circulation
  and a changed ICAO code. All three are name-matching hazards for phase 2.

## Batch 11 (EBL..TBS) — notes for the sweep

- **TBS Tbilisi** — the source's account of the Russian flight ban stops at
  "end of 2021". The Overview states the ban with that date attached and tells
  the reader to check the current position. Genuinely needs a current source.
- **VIJ Virgin Gorda** — the fetched source describes ONLY historical airline
  service, every operator in the past tense, and names no current schedule.
  The Overview says so rather than implying service exists. High priority to
  establish whether anything scheduled flies there now.
- **MEM Memphis** — renamed Frederick W. Smith International on 11 Aug 2026,
  about six weeks ago. Worth a second source given how recent it is.
- **URC Ürümqi** — draft said "Capital Airlines", source says "Capital
  Aviation". Corrected to the source. Confirm which is right.
- **CJU Jeju** — replacement airport: $4.18bn plan cancelled 2021, new $5.1bn
  plan "provisionally approved in 2023 with no completion date". Check status.
- **SDK Sandakan** — the POW forced-labour history is stated plainly from
  source. Given the subject, this one deserves a careful second source rather
  than a routine check.
- **NRN Weeze** marketed as "Düsseldorf-Weeze" while being 48 km from Duisburg,
  a third name-matching hazard alongside REU and the VNO fixed-term rename.

## Batch 12-13 (the final 33) — notes for the sweep

- **THE 30 WITH NO SOURCE URL.** 30 records reached this point unwritten only
  because their Wikipedia field in Airtable was EMPTY, not because no article
  exists. They include TPE, HNL, AUS, PIT, NAN, GDL, DAC, SOF, UIO, CCS, PUS,
  BGO, GOT, TPE and others. Articles were resolved by search and each match was
  verified by requiring the record's own IATA code to appear in the article
  text before it was accepted. The Wikipedia field on those 30 records is still
  blank in Airtable and should be backfilled — see the resolved URLs in
  evidence/batch-13.json.
- **DRW and PPS** first resolved to the MILITARY article (RAAF Base Darwin,
  Antonio Bautista Air Base) because those share the IATA code. Both were
  re-resolved to the civil airport article before drafting.
- **DRW Darwin** source contradicts itself: "an international terminal, a
  domestic terminal and a cargo terminal" in one place, "Domestic and
  international services operate from a single terminal" in another. The
  Overview uses the single-terminal statement. Verify.
- **CCS Caracas** is an honest-warning record like SAH and BKO: permits
  withdrawn from six airlines in Nov 2025, carriers avoiding overnight crew
  stays. The Overview tells the agent to verify any schedule before booking.
- **TSR Timișoara** — terminal Schengen designations predate Romania's
  accession, so the A/B split stated in the source may be out of date. The
  Overview says so rather than asserting it.
- **MPC** — one record could not be resolved at all: no name, and no article
  carries IATA MPC. Needs Andy to say what this record is meant to be.

## MPC — RESOLVED, no action needed (Andy, 22 Sep 2026)

Record recoE4ODnNT9UVVff, IATA MPC, no name in the record. Andy has confirmed
it is a small airport in Bengkulu, Indonesia, and said to ignore it. It is
deliberately left without an Overview. Do NOT re-investigate this record in a
later session, and do not treat the blank Overview as an outstanding gap.
