/**
 * Departure markets and their airports — ONE list, shared by the cron that
 * fills the offer cache and the endpoint that reads it.
 *
 * WHY THIS FILE EXISTS (incident, 2 Aug 2026). An offer used to be tagged with
 * the market it was FETCHED under — the customer nationality we sent Travelify
 * to steer pricing. The cron sweeps GB then IE, both markets return largely the
 * same offers, and the merge key (id|origin|type) does not include the market.
 * So the Irish copy, written second, overwrote the British one and the entire
 * package cache ended up tagged IE. Measured that day: all 2,661 cached package
 * holidays departed UK airports, and all 2,661 were tagged Irish.
 *
 * A widget configured `origins: ['GB']` therefore matched nothing. Six live
 * widgets across three clients showed their empty state. It went unnoticed
 * while the widgets could still fall back to live Travelify; going cache-only
 * on 30 Jul turned a silent cache miss into a visible blank.
 *
 * The lesson in one line: WHERE AN OFFER DEPARTS FROM IS A PROPERTY OF THE
 * OFFER, NOT OF THE REQUEST THAT FETCHED IT. So the market is now derived from
 * the departure airport, which cannot be clobbered by a later sweep, and both
 * sides of the cache read that mapping from here.
 */

/** Every airport with scheduled leisure service in each departure market. */
export const MARKET_AIRPORTS = {
  GB: [
    'LHR', 'LGW', 'LTN', 'STN', 'LCY', 'SEN',            // London area
    'MAN', 'BHX', 'EDI', 'GLA', 'BRS', 'NCL', 'LPL',     // major regionals
    'LBA', 'EMA', 'ABZ', 'SOU', 'CWL', 'BOH', 'EXT',     // regionals
    'NWI', 'INV', 'NQY', 'MME', 'PIK', 'HUY', 'DND',     // smaller regionals
    'BFS', 'BHD', 'LDY',                                 // Northern Ireland
  ],
  IE: ['DUB', 'ORK', 'SNN', 'NOC', 'KIR'],
};

const AIRPORT_TO_MARKET = (() => {
  const map = new Map();
  for (const market of Object.keys(MARKET_AIRPORTS)) {
    for (const iata of MARKET_AIRPORTS[market]) map.set(iata, market);
  }
  return map;
})();

/**
 * Which market an airport belongs to, or null when we do not know it.
 *
 * Null is a real answer and callers must respect it: offers depart airports
 * outside these two markets (Bucharest and Milan both turn up in the sweep),
 * and guessing 'GB' for those would show a Romanian departure to a widget that
 * asked for British ones.
 */
export function marketOfAirport(iata) {
  if (!iata) return null;
  return AIRPORT_TO_MARKET.get(String(iata).trim().toUpperCase()) || null;
}

/** True when `iata` departs the given 2-letter market. */
export function airportInMarket(iata, market) {
  const m = marketOfAirport(iata);
  return !!m && m === String(market || '').trim().toUpperCase();
}
