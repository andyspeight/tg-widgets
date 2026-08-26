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

## Filled: 201 of 201 overseas airports

| IATA | Flight time from the UK |
|---|---|
| ACE | 4h 10m |
| ADL | No direct service. Around 24 to 26 hours total with one or two stops |
| AGA | 3h 50m |
| AGP | 2h 55m |
| AKL | No direct service. Around 24 hours total with one stop |
| ALC | 2h 30m |
| AMM | 5h 35m |
| AMS | 1h 15m |
| ANU | 8h 30m |
| AOK | No meaningful direct UK service. Around 5 to 7 hours total via Athens |
| ARN | 2h 25m |
| ATH | 3h 45m |
| ATL | 9h 30m |
| AUA | No UK nonstop. Around 13 to 15 hours with one stop |
| AUH | 7h 00m |
| AYT | 4h 10m |
| BAH | 6h 50m |
| BCN | 2h 10m |
| BER | 1h 55m |
| BGI | 8h 50m |
| BGY | 2h 00m |
| BIO | 2h 00m |
| BIQ | 1h 55m |
| BJV | 4h 05m |
| BKK | 11h 35m |
| BLR | 9h 50m |
| BNA | 9h 05m |
| BNE | No direct service. Around 23 to 25 hours total with one stop |
| BOD | 1h 50m |
| BOM | 9h 00m |
| BOS | 7h 00m |
| BSL | 1h 45m |
| BUD | 2h 30m |
| CAI | 5h 00m |
| CDG | 1h 20m |
| CFU | 3h 10m |
| CGK | No direct service. Around 17 to 20 hours total with one stop |
| CHC | No direct service. Around 26 to 29 hours total, usually with two stops |
| CHQ | 4h 00m |
| CIA | 2h 30m |
| CLT | 9h 05m |
| CMB | 10h 45m |
| CNS | No direct service. Around 25 to 28 hours total, usually with two stops |
| CNX | No direct UK service. Around 15 to 18 hours via Bangkok or a Gulf hub |
| COK | No scheduled UK nonstop. Around 13 to 15 hours via a Gulf hub |
| CPH | 2h 00m |
| CPT | 12h 00m |
| CTA | 3h 10m |
| CUN | 11h 00m |
| CUR | No UK nonstop. Around 14 to 15 hours via Amsterdam |
| DAD | No direct UK service. Around 15 to 18 hours via Hanoi, Ho Chi Minh City or a Gulf hub |
| DBV | 2h 45m |
| DEL | 8h 45m |
| DFW | 10h 00m |
| DLM | 4h 15m |
| DMK | No direct UK service. Use Suvarnabhumi at 11h 35m instead |
| DOH | 6h 55m |
| DPS | No direct service. Around 18 to 19 hours total with one stop |
| DUB | 1h 25m |
| DUS | 1h 25m |
| DWC | No scheduled direct UK service. Use Dubai International instead, around 6h 50m direct |
| DXB | 6h 50m |
| EFL | 3h 30m |
| EIN | 1h 20m |
| EWR | 8h 00m westbound, around 7h eastbound |
| FAO | 2h 55m |
| FCO | 2h 40m |
| FLL | 9h 30m |
| FNC | 3h 55m |
| FRA | 1h 40m |
| FUE | 4h 10m |
| GCM | Around 12h total, routed via Nassau |
| GMZ | No international service. Via Tenerife at 4h 30m, then ferry or Binter |
| GOI | No reliable scheduled UK nonstop. Around 13 to 15 hours via a Gulf hub |
| GVA | 1h 45m |
| HAM | 1h 45m |
| HAN | Around 12h direct from London Heathrow |
| HAV | No current UK nonstop. Around 11 to 14 hours with one stop |
| HEL | 2h 55m |
| HER | 4h 15m |
| HKG | 12h 45m |
| HKT | No direct UK service. Around 15 to 17 hours via Bangkok or a Gulf hub |
| HND | 13h 45m |
| HRG | 5h 25m |
| IAD | 7h 30m |
| IBZ | 2h 30m |
| ICN | 12h 45m |
| INN | 2h 05m |
| IST | 4h 00m |
| JED | 6h 10m |
| JFK | 8h 00m westbound, around 7h eastbound |
| JKH | No meaningful direct UK service. Around 5 to 7 hours total via Athens |
| JMK | 3h 55m |
| JNB | 11h 30m |
| JRO | No direct UK service. Around 13 to 16 hours with one stop |
| JSI | 3h 35m |
| JTR | 4h 00m |
| KEF | 3h 10m |
| KGS | 4h 15m |
| KIN | 9h 45m |
| KIX | No UK nonstop. Around 13 to 15 hours with one stop |
| KLX | No meaningful direct UK service. Around 5 to 7 hours total via Athens |
| KUL | 13h 30m |
| KVA | No meaningful direct UK service. Around 5 to 7 hours total via Athens |
| LAS | 10h 45m |
| LAX | 11h 20m |
| LCA | 4h 35m |
| LEI | 3h 05m |
| LGA | No direct service. Use JFK at around 8h, or Newark |
| LGK | No UK nonstop. Around 16 to 19 hours via Kuala Lumpur |
| LIN | 2h 05m |
| LIS | 2h 50m |
| LPA | 4h 30m |
| LYS | 1h 50m |
| MAA | 10h 55m |
| MAD | 2h 25m |
| MAH | 2h 25m |
| MBJ | 9h 45m |
| MCO | 9h 30m |
| MCT | 7h 20m |
| MEL | No direct service. Around 23 to 25 hours total with one stop |
| MIA | 9h 30m |
| MJT | No meaningful direct UK service. Around 5 to 7 hours total via Athens |
| MLA | 3h 15m |
| MLE | 10h 20m |
| MRS | 2h 20m |
| MRU | 11h 55m |
| MUC | 1h 55m |
| MXP | 2h 05m |
| NAP | 2h 40m |
| NAS | 9h 50m |
| NBO | 9h 15m |
| NCE | 2h 15m |
| NOC | 1h 40m |
| NRT | 13h 50m |
| OLB | 2h 30m |
| OOL | No direct service. Around 25 to 28 hours total, usually with two stops |
| OPO | 2h 25m |
| ORD | 8h 40m |
| ORK | 1h 35m |
| ORY | 1h 20m |
| OSL | 2h 10m |
| PAS | No meaningful direct UK service. Around 5 to 7 hours total via Athens |
| PEK | Around 10h 30m, but only on Air China |
| PER | 16h 45m direct from London Heathrow, but the return leg is not direct |
| PFO | 4h 35m |
| PHL | 8h 00m |
| PMI | 2h 25m |
| POP | Seasonal charter direct at around 9h, otherwise one stop |
| PRG | 2h 10m |
| PSA | 2h 15m |
| PUJ | 8h 35m |
| PUY | 2h 20m |
| PVG | Around 12h |
| PXO | No dependable UK nonstop. Via Madeira at 3h 55m, then a short hop or ferry |
| RAK | 3h 35m |
| REP | No UK nonstop. Around 16 to 20 hours via Bangkok or Singapore |
| RHO | 4h 10m |
| RKT | No direct service. Around 8 to 11 hours with one stop |
| RKV | No international service. Fly to Keflavik at 3h 10m instead |
| RMU | 2h 40m |
| RUH | 6h 20m |
| SAW | 3h 55m |
| SEA | 9h 55m |
| SEZ | Usually one stop. Around 14 hours via Doha or Dubai |
| SFB | 9h 30m |
| SFO | 11h 05m |
| SGN | Around 12h 30m direct from London Heathrow |
| SHJ | Around 7h direct from London Gatwick |
| SIN | 13h 15m |
| SKG | 3h 20m |
| SMI | Limited direct UK service. Around 5 to 7 hours total via Athens |
| SNN | 1h 40m |
| SPC | Around 4h 20m, but direct service is only about once a week |
| SPU | 2h 35m |
| SSH | 5h 25m |
| SVQ | 2h 45m |
| SYD | No direct service. Around 23 to 25 hours total with one stop |
| SZG | 2h 10m |
| TFN | 4h 30m |
| TFS | 4h 30m |
| TIA | 3h 00m |
| TLS | 1h 55m |
| TLV | 5h 05m |
| TPA | 9h 30m |
| USM | No direct UK service. Around 16 to 19 hours via Bangkok |
| UVF | 8h 30m |
| VCE | 2h 10m |
| VDE | No international service. Via Tenerife at 4h 30m, then Binter Canarias |
| VIE | 2h 15m |
| VLC | 2h 25m |
| VOL | No meaningful direct UK service. Around 5 to 7 hours total via Athens |
| WAW | 2h 30m |
| WLG | No direct service. Around 26 to 29 hours total, usually with two stops |
| YUL | 8h 35m |
| YVR | 9h 50m |
| YYC | 9h 10m |
| YYZ | 8h 00m |
| ZAG | 2h 25m |
| ZRH | 1h 45m |
| ZTH | 3h 35m |

**Complete. All 201 overseas airports carry a verified flight time from the UK.**
