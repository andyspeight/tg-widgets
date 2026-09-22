# Phase 2: world coverage of international airports

Andy, 21 Sep 2026: "Once we have these 600 done we are going to list all other
airports in the world that have international flights, and get those live even
if we just have their name and location so we can slowly work through them and
add additional information as and when we find it."

## The shape of it
- Scope = every airport in the world with scheduled INTERNATIONAL flights,
  minus the 600 already in the table.
- Minimum viable record: Name, IATA, City Served, Country, Lat, Lng. Enough to
  make the airport findable and mappable on the dashboard.
- Everything else (Overview, Terminals, Quirks, transport fields) gets added
  over time as it is found. Records go live thin rather than waiting.
- Status field is the lever: these come in as Draft, not Published.

## Things to settle before starting
1. **How many are we talking about?** Need a count before committing. Rough
   order: ~1,200-1,500 airports worldwide carry scheduled international
   service, so perhaps 600-900 new records. Confirm against a real list.
2. **Where does the list come from?** Must be a real dataset, not my memory.
   Candidates: OurAirports open data (has scheduled_service flag, lat/lng,
   IATA, ICAO, municipality, country), Wikidata SPARQL, OpenFlights.
   OurAirports is the strongest: public domain, lat/lng included, and the
   scheduled_service flag does most of the filtering.
3. **"International" needs a definition.** OurAirports has scheduled_service
   but does NOT distinguish domestic from international. Options: cross-
   reference Wikidata P238/airport type, or use the airport's own type field
   plus a name heuristic, or accept scheduled_service as the filter and let
   the domestic ones in. ANDY'S CALL - ask before building.
4. **Deduplication against the existing 600** on IATA code, not name.
5. **Does the widget cope with thin records?** An airport with a name and a
   pin but no Overview must not render a broken card. Check
   api/airport-search.js and the Airport Spotlight widget before loading.

## Hard constraint carried over
Andy's locked rule still applies: no made-up data. Lat/lng, IATA and names
come from the dataset, not from me. If the dataset does not have it, the field
stays blank.
