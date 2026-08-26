# Flight Time From UK — verification log

Field: `Flight Time From UK` (fldnqWFQ5fykmZ5Ci); caveats in `Flight Time Note` (fldsvod5EoGW065jr).
Two independent sources per route, pushed one record at a time with `typecast: true`, per the airport-spotlight skill.
UK-origin records are deliberately left empty.

## Cross-check, not a source

A great-circle distance model was built to flag outliers. It is never used as a source. It earned its place three times:
distance-derived times are badly wrong for East Asia (Russian airspace avoidance since 2022 adds up to two hours);
one aggregator claimed 6h 50m to Dalaman against the airline's own 4h 15m; another claimed 4h 50m to Catania against 3h 11m.

## Corrections found while verifying

- **Ras Al Khaimah**: record claimed easyJet and charter fly direct from the UK. There is no UK nonstop at all, and Air Arabia is the only carrier flying nonstop to RKT from anywhere in Europe.
- **Sharjah**: Air Arabia began the UK's only Sharjah nonstop, double daily from Gatwick, on 12 July 2026. Postdates the May records entirely.
- **LaGuardia**: takes no transatlantic flights. No US customs facility plus a perimeter rule. Booking sites showing LGA to London sell connections, not nonstops.
- **Sharm el Sheikh**: a source claimed it needs a connection from the UK. Five airlines fly Gatwick to Sharm direct, around 20 a week. That guidance dates from the 2015 to 2019 suspension.
- **Perth**: London to Perth is still nonstop, but Perth to London has routed via Singapore since 4 March 2026, pushing the return past 20 hours.

## Filled: 73 of 201 overseas airports

| IATA | Flight time from the UK |
|---|---|
| ACE | 4h 10m |
| ADL | No direct service. Around 24 to 26 hours total with one or two stops |
| AKL | No direct service. Around 24 hours total with one stop |
| ALC | 2h 30m |
| ATH | 3h 45m |
| AUH | 7h 00m |
| AYT | 4h 10m |
| BAH | 6h 50m |
| BCN | 2h 10m |
| BGY | 2h 00m |
| BJV | 4h 05m |
| BKK | 11h 35m |
| BNE | No direct service. Around 23 to 25 hours total with one stop |
| BOS | 7h 00m |
| CAI | 5h 00m |
| CHC | No direct service. Around 26 to 29 hours total, usually with two stops |
| CIA | 2h 30m |
| CNS | No direct service. Around 25 to 28 hours total, usually with two stops |
| CTA | 3h 10m |
| DLM | 4h 15m |
| DOH | 6h 55m |
| DWC | No scheduled direct UK service. Use Dubai International instead, around 6h 50m direct |
| DXB | 6h 50m |
| EWR | 8h 00m westbound, around 7h eastbound |
| FAO | 2h 55m |
| FCO | 2h 40m |
| FNC | 3h 55m |
| HER | 4h 15m |
| HKG | 12h 45m |
| HND | 13h 45m |
| HRG | 5h 25m |
| IAD | 7h 30m |
| IBZ | 2h 30m |
| ICN | 12h 45m |
| IST | 4h 00m |
| JED | 6h 10m |
| JFK | 8h 00m westbound, around 7h eastbound |
| LAS | 10h 45m |
| LAX | 11h 20m |
| LCA | 4h 35m |
| LEI | 3h 05m |
| LGA | No direct service. Use JFK at around 8h, or Newark |
| LIN | 2h 05m |
| LIS | 2h 50m |
| LPA | 4h 30m |
| MAD | 2h 25m |
| MAH | 2h 25m |
| MCO | 9h 30m |
| MCT | 7h 20m |
| MEL | No direct service. Around 23 to 25 hours total with one stop |
| MIA | 9h 30m |
| MXP | 2h 05m |
| NAP | 2h 40m |
| OLB | 2h 30m |
| OOL | No direct service. Around 25 to 28 hours total, usually with two stops |
| PER | 16h 45m direct from London Heathrow, but the return leg is not direct |
| PFO | 4h 35m |
| PMI | 2h 25m |
| PSA | 2h 15m |
| RHO | 4h 10m |
| RKT | No direct service. Around 8 to 11 hours with one stop |
| RUH | 6h 20m |
| SAW | 3h 55m |
| SFO | 11h 05m |
| SHJ | Around 7h direct from London Gatwick |
| SSH | 5h 25m |
| SVQ | 2h 45m |
| SYD | No direct service. Around 23 to 25 hours total with one stop |
| TFS | 4h 30m |
| TPA | 9h 30m |
| VCE | 2h 10m |
| VLC | 2h 25m |
| WLG | No direct service. Around 26 to 29 hours total, usually with two stops |

Remaining: 128 — AGA AGP AMM AMS ANU AOK ARN ATL AUA BER BGI BIO BIQ BLR BNA BOD BOM BSL BUD CDG CFU CGK CHQ CLT CMB CNX COK CPH CPT CUN CUR DAD DBV DEL DFW DMK DPS DUB DUS EFL EIN FLL FRA FUE GCM GMZ GOI GVA HAM HAN HAV HEL HKT INN JKH JMK JNB JRO JSI JTR KEF KGS KIN KIX KLX KUL KVA LGK LYS MAA MBJ MJT MLA MLE MRS MRU MUC NAS NBO NCE NOC NRT OPO ORD ORK ORY OSL PAS PEK PHL POP PRG PUJ PUY PVG PXO RAK REP RKV RMU SEA SEZ SFB SGN SIN SKG SMI SNN SPC SPU SZG TFN TIA TLS TLV USM UVF VDE VIE VOL WAW YUL YVR YYC YYZ ZAG ZRH ZTH
