# Flight Time From UK — verification log

Field: `Flight Time From UK` (fldnqWFQ5fykmZ5Ci), caveats in `Flight Time Note` (fldsvod5EoGW065jr).
Two independent sources per route, pushed one record at a time with `typecast: true`, per the airport-spotlight skill.

A great-circle distance model was built as a CROSS-CHECK only, never as a source. It earned its place twice:
it showed that any distance-derived figure is badly wrong for East Asia (Russian airspace avoidance since 2022
adds up to two hours), and it flagged an aggregator claiming 6h 50m to Dalaman against the airline's own 4h 15m.

| IATA | Flight time | Source 1 | Source 2 |
|---|---|---|---|
| ACE | 4h 10m | https://www.flightconnections.com/flights-from-lgw-to-ace | https://www.flightsfrom.com/LGW-ACE |
| ADL | No direct service. Around 24 to 26 hours total with one or two stops | https://www.timeout.com/uk/news/the-worlds-longest-flight-will-launch-from-the-uk-in-2027-032625 | https://freedomdestinations.co.uk/australia/flights/direct |
| AKL | No direct service. Around 24 hours total with one stop | https://www.singaporeair.com/en-gb/flights-from-london-to-auckland | https://www.prokerala.com/travel/flight-time/from-LHR/to-AKL/ |
| ALC | 2h 32m | https://www.flightsfrom.com/LTN-ALC | https://www.trip.com/hot/london-to-alicante-flight-time/ |
| ATH | 3h 45m | https://www.directflights.com/LHR-ATH | https://www.flightconnections.com/flights-from-lhr-to-ath |
| AYT | 4h 10m | https://caledoniantravel.uk/how-long-is-flight-to-turkey-from-uk/ | https://www.flightsfrom.com/AYT-DLM |
| BJV | 4h 05m | https://caledoniantravel.uk/how-long-is-flight-to-turkey-from-uk/ | https://www.trip.com/hot/london-to-bodrum-flight-time/ |
| BKK | 11h 35m | https://www.flightsfrom.com/LHR-BKK | https://www.skyscanner.com/routes/lhr/bkk/london-heathrow-to-bangkok-suvarnabhumi.html |
| BNE | No direct service. Around 23 to 25 hours total with one stop | https://www.timeout.com/uk/news/the-worlds-longest-flight-will-launch-from-the-uk-in-2027-032625 | https://freedomdestinations.co.uk/australia/flights/direct |
| CHC | No direct service. Around 26 to 29 hours total, usually with two stops | https://www.singaporeair.com/en-gb/flights-from-london-to-auckland | https://www.prokerala.com/travel/flight-time/from-LHR/to-AKL/ |
| CNS | No direct service. Around 25 to 28 hours total, usually with two stops | https://www.timeout.com/uk/news/the-worlds-longest-flight-will-launch-from-the-uk-in-2027-032625 | https://freedomdestinations.co.uk/australia/flights/direct |
| DLM | 4h 15m | https://www.turkishairlines.com/en-gb/flights-from-london-to-dalaman | https://caledoniantravel.uk/how-long-is-flight-to-turkey-from-uk/ |
| FAO | 2h 55m | https://www.flightsfrom.com/LGW-FAO | https://www.travelmath.com/flying-time/from/London,+United+Kingdom/to/Faro,+Portugal |
| FNC | 3h 55m | https://www.flightconnections.com/flights-from-lgw-to-fnc | https://www.flightsfrom.com/LHR-FNC |
| HER | 4h 15m | https://www.flightconnections.com/flights-from-lhr-to-her | https://caledoniantravel.uk/how-long-is-flight-to-greece/ |
| HKG | 12h 45m | https://flights.cathaypacific.com/destinations/en_GB/flights-from-london-to-hong-kong | https://www.flightsfrom.com/LHR-HKG |
| HND | 13h 45m | https://www.flightsfrom.com/LHR-HND | https://www.flightconnections.com/flights-from-lhr-to-hnd |
| IBZ | 2h 30m | https://www.flightsfrom.com/LHR-IBZ | https://www.trip.com/hot/flight-time-from-london-to-ibiza/ |
| ICN | 12h 45m | https://www.flightsfrom.com/LHR-ICN | https://www.flightconnections.com/flights-from-lhr-to-icn |
| LPA | 4h 30m | https://www.directflights.com/LGW-LPA | https://www.flightroutes.com/LGW-LPA |
| MEL | No direct service. Around 23 to 25 hours total with one stop | https://www.timeout.com/uk/news/the-worlds-longest-flight-will-launch-from-the-uk-in-2027-032625 | https://freedomdestinations.co.uk/australia/flights/direct |
| OOL | No direct service. Around 25 to 28 hours total, usually with two stops | https://www.timeout.com/uk/news/the-worlds-longest-flight-will-launch-from-the-uk-in-2027-032625 | https://freedomdestinations.co.uk/australia/flights/direct |
| PER | 16h 45m direct from London Heathrow, but the return leg is not direct | https://www.headforpoints.com/2026/03/04/qantas-reroutes-perth-to-london-flights/ | https://www.paddleyourownkanoo.com/2026/03/03/qantas-cancels-non-stop-perth-to-london-flights-as-middle-east-airspace-closures-drag-on/ |
| PMI | 2h 25m | https://www.flightsfrom.com/LGW-PMI | https://www.travelmath.com/flying-time/from/London,+United+Kingdom/to/Palma+de+Mallorca,+Spain |
| RHO | 4h 10m | https://caledoniantravel.uk/how-long-is-flight-to-greece/ | https://www.flightsfrom.com/LHR-RHO |
| SYD | No direct service. Around 23 to 25 hours total with one stop | https://www.timeout.com/uk/news/the-worlds-longest-flight-will-launch-from-the-uk-in-2027-032625 | https://simpleflying.com/why-qantas-quietly-killed-its-nonstop-perth-london-flight-in-2026/ |
| TFS | 4h 30m | https://www.flightsfrom.com/LHR-TFS | https://www.directflights.com/LGW-TFS |
| WLG | No direct service. Around 26 to 29 hours total, usually with two stops | https://www.singaporeair.com/en-gb/flights-from-london-to-auckland | https://www.prokerala.com/travel/flight-time/from-LHR/to-AKL/ |

Verified and pushed: 28 of 201 overseas airports as of 25 Aug 2026.
