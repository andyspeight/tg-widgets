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

## Filled: 117 of 201 overseas airports

| IATA | Flight time from the UK |
|---|---|
| ACE | 4h 10m |
| ADL | No direct service. Around 24 to 26 hours total with one or two stops |
| AGP | 2h 55m |
| AKL | No direct service. Around 24 hours total with one stop |
| ALC | 2h 30m |
| AMS | 1h 15m |
| ANU | 8h 30m |
| AOK | No meaningful direct UK service. Around 5 to 7 hours total via Athens |
| ATH | 3h 45m |
| AUH | 7h 00m |
| AYT | 4h 10m |
| BAH | 6h 50m |
| BCN | 2h 10m |
| BER | 1h 55m |
| BGI | 8h 50m |
| BGY | 2h 00m |
| BJV | 4h 05m |
| BKK | 11h 35m |
| BNE | No direct service. Around 23 to 25 hours total with one stop |
| BOD | 1h 50m |
| BOS | 7h 00m |
| BUD | 2h 30m |
| CAI | 5h 00m |
| CDG | 1h 20m |
| CFU | 3h 10m |
| CHC | No direct service. Around 26 to 29 hours total, usually with two stops |
| CHQ | 4h 00m |
| CIA | 2h 30m |
| CNS | No direct service. Around 25 to 28 hours total, usually with two stops |
| CTA | 3h 10m |
| CUN | 11h 00m |
| DLM | 4h 15m |
| DOH | 6h 55m |
| DUB | 1h 25m |
| DUS | 1h 25m |
| DWC | No scheduled direct UK service. Use Dubai International instead, around 6h 50m direct |
| DXB | 6h 50m |
| EFL | 3h 30m |
| EWR | 8h 00m westbound, around 7h eastbound |
| FAO | 2h 55m |
| FCO | 2h 40m |
| FNC | 3h 55m |
| FRA | 1h 40m |
| HAM | 1h 45m |
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
| JKH | No meaningful direct UK service. Around 5 to 7 hours total via Athens |
| JMK | 3h 55m |
| JSI | 3h 35m |
| JTR | 4h 00m |
| KGS | 4h 15m |
| KIN | 9h 45m |
| KLX | No meaningful direct UK service. Around 5 to 7 hours total via Athens |
| KVA | No meaningful direct UK service. Around 5 to 7 hours total via Athens |
| LAS | 10h 45m |
| LAX | 11h 20m |
| LCA | 4h 35m |
| LEI | 3h 05m |
| LGA | No direct service. Use JFK at around 8h, or Newark |
| LIN | 2h 05m |
| LIS | 2h 50m |
| LPA | 4h 30m |
| LYS | 1h 50m |
| MAD | 2h 25m |
| MAH | 2h 25m |
| MBJ | 9h 45m |
| MCO | 9h 30m |
| MCT | 7h 20m |
| MEL | No direct service. Around 23 to 25 hours total with one stop |
| MIA | 9h 30m |
| MJT | No meaningful direct UK service. Around 5 to 7 hours total via Athens |
| MRS | 2h 20m |
| MUC | 1h 55m |
| MXP | 2h 05m |
| NAP | 2h 40m |
| NCE | 2h 15m |
| NOC | 1h 40m |
| OLB | 2h 30m |
| OOL | No direct service. Around 25 to 28 hours total, usually with two stops |
| ORK | 1h 35m |
| ORY | 1h 20m |
| OSL | 2h 10m |
| PAS | No meaningful direct UK service. Around 5 to 7 hours total via Athens |
| PER | 16h 45m direct from London Heathrow, but the return leg is not direct |
| PFO | 4h 35m |
| PMI | 2h 25m |
| PRG | 2h 10m |
| PSA | 2h 15m |
| PUJ | 8h 35m |
| RHO | 4h 10m |
| RKT | No direct service. Around 8 to 11 hours with one stop |
| RUH | 6h 20m |
| SAW | 3h 55m |
| SFO | 11h 05m |
| SHJ | Around 7h direct from London Gatwick |
| SKG | 3h 20m |
| SMI | Limited direct UK service. Around 5 to 7 hours total via Athens |
| SNN | 1h 40m |
| SSH | 5h 25m |
| SVQ | 2h 45m |
| SYD | No direct service. Around 23 to 25 hours total with one stop |
| TFS | 4h 30m |
| TPA | 9h 30m |
| UVF | 8h 30m |
| VCE | 2h 10m |
| VLC | 2h 25m |
| VOL | No meaningful direct UK service. Around 5 to 7 hours total via Athens |
| WLG | No direct service. Around 26 to 29 hours total, usually with two stops |
| ZTH | 3h 35m |

Remaining 84: AGA AMM ARN ATL AUA BIO BIQ BLR BNA BOM BSL CGK CLT CMB CNX COK CPH CPT CUR DAD DBV DEL DFW DMK DPS EIN FLL FUE GCM GMZ GOI GVA HAN HAV HEL HKT INN JNB JRO KEF KIX KUL LGK MAA MLA MLE MRU NAS NBO NRT OPO ORD PEK PHL POP PUY PVG PXO RAK REP RKV RMU SEA SEZ SFB SGN SIN SPC SPU SZG TFN TIA TLS TLV USM VDE VIE WAW YUL YVR YYC YYZ ZAG ZRH
