# The 30 countries with no traffic data (hand-sourced, 23 Sep 2026)

Andy, 23 Sep 2026: "do the 30 countries."

These were the 30 countries with scheduled air service that the 22 Sep import could
not judge, because Wikidata holds no passenger figure for any of their airports. Each
one was sourced by hand and put through the same rule as everything else:

> peak annual passengers since 2015 of at least 1m, OR busiest airport in its
> country with at least 100k.

**Result: 18 airports added, 12 countries left out.** The table went from 1,018 to
1,036 records and now covers 213 of the 234 countries with scheduled service.

The 18 records have the same thin shape as the 418: Name, IATA, Country, Lat, Lng,
Wikipedia URL and Source 1 from OurAirports, Status Todo. No Overview, City Served,
Airport Type, Airport Role or Verified Date. Every record was also checked against
its Wikipedia article: the IATA code appears in the article and the coordinates agree
to within about a kilometre.

## Measure used

Passengers through the AIRPORT (arrivals plus departures, domestic and
international). Not "passengers carried" by a country's airlines, which is a
different series and was the most common trap here (see below).

## Added (18)

Strength: **double** means two independent publishers each put it over the
threshold. **Flagged** means the call rests on one publisher or on indirect
evidence; each is named so it can be pulled with one instruction.

| Country | Airport | Deciding evidence | Strength |
|---|---|---|---|
| Mongolia | UBN Chinggis Khaan | Montsame (state news agency, 22 Jul 2025): 1.7m in 2023, 2m in 2024. Airport's own site: 160,089 in January 2024 alone | Double |
| Laos | VTE Wattay | WFP Logistics Cluster: 1.76m international + 578,000 domestic in 2019. Laotian Times (21 May 2019): 1.8m annual movements | Double |
| Libya | MJI Mitiga | Libyan Airports Authority: 1,171,987 (see note). WFP Logistics Cluster: 715,300 in 2020 | Double |
| Brunei | BWN Brunei International | Brunei Statistical Yearbook 2019, table 22.7 (Civil Aviation Department): 921,165 in, 924,546 out in 2019. Xinhua (11 Mar 2025, transport minister): 1,464,245 in 2024 | Double |
| Malawi | LLW Kamuzu | Airport Developments Ltd (the operator): about 310,000 in 2023, Chileka 145,000. WFP Logistics Cluster: 124,596 in 2022, Chileka 99,084 | Double |
| Sierra Leone | FNA Freetown (Lungi) | Runway Girl Network (3 Mar 2023): 246,000 in 2019. Calabash Newspaper (10 Jan 2025, SLCAA director general): 243,445 in 2023 | Double |
| Liberia | ROB Roberts | Liberia Civil Aviation Authority: "more than 228,000 ... annually". WFP Logistics Cluster: "more than 450,000 ... annually" | Double |
| Cook Islands | RAR Rarotonga | WFP Logistics Cluster: 348,017 in 2017. Cook Islands News (30 Jan 2024): arrivals alone "more than 170,000 in 2019" | Double |
| Tonga | TBU Fua'amotu | JICA study (Jul 2025): 213,296 international passengers in 2019. Tonga Statistics Department: 136,059 arrivals and 139,527 departures in 2019 (all ports) | Double |
| Gambia | BJL Banjul | Gambia Bureau of Statistics, Transport Statistics Summary Report 2023: 477,512 in 2019, 418,807 in 2023 | Official, one publisher |
| Somalia | MGQ Aden Adde | National Bureau of Statistics, Facts and Figures 2021, table 1.19: 278,012 international passengers (Feb to Dec 2021), Garowe 16,689 | Flagged: one publisher |
| Anguilla | AXA Clayton J. Lloyd | Anguilla Statistics Department monthly reports, summed: 57,718 in 2019, 114,433 in 2024, 118,186 in 2025 | Flagged: one publisher |
| Greenland | GOH Nuuk | Statistics Greenland (bank.stat.gl): 259,449 in 2025 (see the Greenland call below) | Flagged: one publisher, judgement call |
| Afghanistan | KBL Kabul | Ministry of Finance (16 May 2020): "handles an average of 2 million passengers per annum". Ministry of Transport via DID Press (3 Aug 2026): 1,570,896 through all the country's airports | Flagged: one airport-level source |
| Solomon Islands | HIR Honiara | National Statistics Office: 56,438 international arrivals in 2018 (mainly Honiara; departures and domestic not counted). World Bank SIRAP2 (2025): about 249,000 passengers at Honiara and Munda, from the airport company's data | Flagged: indirect |
| South Sudan | JUB Juba | WFP Logistics Cluster: "an average of 1300 passengers per day arriving and departing" (about 475,000 a year) | Flagged: one source, undated |
| Bhutan | PBH Paro | No airport-level figure since 2015 could be reached (the statistics bureau and tourism council sites refuse connections; Kuensel links are dead). 181,659 in 2012 (Kuensel); Bhutan's airlines carried 189,878 in 2023 and Paro is their only international base | Flagged: indirect |
| Sao Tome & Principe | TMS Sao Tome | INAC data in a UAB thesis: 109,721 in 2017 (92,014 international + 17,707 domestic). A union leader quoted 67,000 for 2023 without saying what it counts | Flagged: one source, 10% over the floor |

**Libya note.** Every airport page on the Libyan Airports Authority site prints
identical traffic blocks under both 2022 and 2021, so one year is a copy error on
their site. The figure is an annual total for 2021 or 2022 either way.

## Not added (12 countries)

| Country | Why |
|---|---|
| Tuvalu | WFP Logistics Cluster: 10,897 passengers in 2019 |
| Niue | WFP Logistics Cluster: Air New Zealand twice a week, weekly off-peak |
| Micronesia | WFP Logistics Cluster: arrivals of 20 to 40 a day at Pohnpei and Kosrae, 10 to 20 at Chuuk and Yap |
| Kiribati | WFP Logistics Cluster: 14,455 international passengers in 2022; no domestic total published |
| Lesotho | WFP Logistics Cluster's 2017 monthly table sums to 58,541; one Airlink route to Johannesburg |
| Eswatini | WFP Logistics Cluster: "around 60,000 per annum". Eswatini Air began in March 2023 and no later figure is published, so this one could be worth rechecking |
| Falkland Islands | Falkland Islands Government: two MoD flights a week plus LATAM on Saturdays. 100k a year would need more than 320 passengers on every flight |
| Monaco | A heliport, not an airport, and about 80,000 passengers a year (IMSEE, via Hello Monaco 2019) |
| Marshall Islands | No official figure found |
| Nauru | No official figure found |
| Eritrea | No verifiable figure since 2015 (Wikipedia's 136,526 is from 2004). Asmara is plainly the country's airport; Andy's call whether to add it without one |
| North Korea | No verifiable figure |

## Within the 18 countries, also left out

- **LPQ Luang Prabang.** WFP says "around 1 million"; HVS's airport chart says
  224,543 in 2018. A fourfold disagreement cannot show it clears 1m.
- **BEN Benina.** 116,967 (Libyan Airports Authority): not Libya's busiest, far
  under 1m.
- **BLZ Chileka.** Second to Kamuzu on both sources.
- **JAV Ilulissat.** 108,153 in 2023, but not Greenland's busiest.
- **SFJ Kangerlussuaq.** See below.

## The Greenland call

Statistics Greenland (international plus domestic, by airport) gives Kangerlussuaq
a peak of 261,582 in 2023 and Nuuk 259,449 in 2025. Read literally, the peak rule
picks Kangerlussuaq by 0.8%. But Kangerlussuaq handed its international flights to
Nuuk in November 2024 and fell to about 31,000 passengers in 2025, while Nuuk's
international traffic for January to July 2026 is 12.5% ahead of the same months of
2025 (59,722 against 53,094). Nuuk was added as Greenland's airport. Kangerlussuaq
was not.

## Traps worth knowing (they will bite the next person)

1. **"Passengers carried" is not airport traffic.** The World Bank series
   IS.AIR.PSGR (re-published by CEIC and Statista) counts passengers flown by a
   country's own airlines. It gave Brunei 1.42m, and Wikipedia's Paro infobox figure
   (189,878) is sourced to it. Afghanistan's yearbook reports only this measure.
2. **Search summaries misreport their sources.** One attributed Wattay's 2019
   figures to a Wikipedia page that has no figures at all; another called Kabul's
   "2 million a year" a capacity when the page states traffic. Read the page.
3. **Check recent years, not just 2019.** Anguilla was 57,718 in 2019 and would
   have been left out; it was 118,186 in 2025 after American Airlines started Miami
   flights in December 2021.
4. **Official statistics contain copy errors.** Libya's 2021 and 2022 blocks are
   identical; Somalia's 2018 domestic table repeats the international totals.
5. **Access.** The WFP Logistics Cluster pages need browser-style Accept headers or
   they return an empty bot challenge. web.archive.org is unreachable from the
   session. Bhutan's statistics bureau and tourism council refuse connections.
