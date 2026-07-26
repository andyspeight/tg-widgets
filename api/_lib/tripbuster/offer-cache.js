/**
 * Tripbuster's read of the Travelgenix live offer cache.
 *
 * This is the third ingestion route: an agent who is also a Travelgenix client
 * can pull deals straight out of the offer cache the refresh-map-offers cron
 * fills from Travelify, instead of typing them or uploading a sheet.
 *
 * WHY THIS READS REDIS DIRECTLY rather than calling GET /api/cached-offers:
 * that endpoint is public and rate-limited per IP. A server-to-server call from
 * a Vercel function presents the function's egress IP, so every agent importing
 * at once would share one bucket and throttle each other, and the traffic would
 * be charged against the budget that exists to protect customer widgets. Going
 * to the same Redis keys avoids the collision and the extra hop, and leaves the
 * live widget path completely untouched.
 *
 * The CONTRACT here is the stored offer shape written by normaliseOffer in
 * api/cron/refresh-map-offers.js, not the rebuilt Travelify shape that
 * cached-offers.js serves. Reading the normalised shape directly is both
 * simpler and less brittle: these are the exact fields the cron writes.
 *
 * Read-only. Nothing here ever writes to the cache.
 */

import { getJson, keys, configured } from '../../_redis.js';

/**
 * The Redis calls this module makes, in one place so a test can substitute an
 * in-memory stand-in. Production callers never pass this — they get the real
 * helpers. It exists because the offer cache lives in Upstash, so without it
 * none of the filtering, staleness or mapping logic below could be tested
 * without a live Redis.
 */
const REAL_REDIS = { getJson, keys, configured };

// Key layout owned by the cron. Packages live in one key per country, and
// accommodation-only/flight-only offers in a second, so both are read.
const COUNTRY_PREFIX = 'offers:packages:';
const EXTRA_PREFIX = 'offers:extra:';

/**
 * Serve-time stale guard, matching the cron's own purge rules (MAX_AGE_HOURS =
 * 70). The cron purges on its own cadence, so the read side enforces the rules
 * independently — an agent must never import a deal whose travel date has
 * passed or whose price is three days old, even if the cron has stalled.
 */
const STALE_AGE_MS = 70 * 60 * 60 * 1000;

/** How many country keys to read at once. Same bounded-concurrency idiom as the cron. */
const READ_CONCURRENCY = 8;

export function offerCacheConfigured(redis = REAL_REDIS) {
  return redis.configured();
}

function isServable(o, nowMs) {
  const travel = Date.parse(o.outboundDate || o.checkinDate || '');
  if (Number.isFinite(travel) && travel < nowMs) return false;
  if (o.fetchedAt) {
    const fetched = Date.parse(o.fetchedAt);
    if (Number.isFinite(fetched) && (nowMs - fetched) > STALE_AGE_MS) return false;
  }
  return true;
}

/** Loose board matching, so "All Inclusive" and "all-inclusive" are one thing. */
const normBoard = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');

/**
 * Board names as Travelify writes them, mapped onto the Tripbuster enum in
 * db/tripbuster/001_init.sql. An unrecognised board becomes null rather than a
 * guess: the deal still imports, just without a board, and the agent can set it.
 */
const BOARD_TO_ENUM = {
  allinclusive: 'All inclusive', ai: 'All inclusive',
  ultraallinclusive: 'Ultra all inclusive', premiumallinclusive: 'Ultra all inclusive',
  fullboard: 'Full board', fb: 'Full board',
  halfboard: 'Half board', hb: 'Half board', dinnerbedbreakfast: 'Half board',
  bedandbreakfast: 'Bed & breakfast', bedbreakfast: 'Bed & breakfast', bb: 'Bed & breakfast',
  breakfast: 'Bed & breakfast', breakfastincluded: 'Bed & breakfast',
  selfcatering: 'Self catering', sc: 'Self catering', roomonly: 'Room only', ro: 'Room only',
};

export function boardToEnum(board) {
  return BOARD_TO_ENUM[normBoard(board)] || null;
}

/**
 * Country names for the codes the cache stores, because a traveller searches
 * "Spain" not "ES". Covers the package destinations the cron actually sweeps;
 * anything unlisted falls back to the code so the deal still imports with
 * something in the field.
 */
const COUNTRY_NAMES = {
  ES: 'Spain', PT: 'Portugal', GR: 'Greece', TR: 'Turkey', IT: 'Italy', FR: 'France',
  CY: 'Cyprus', MT: 'Malta', HR: 'Croatia', BG: 'Bulgaria', EG: 'Egypt', MA: 'Morocco',
  TN: 'Tunisia', AE: 'United Arab Emirates', US: 'United States', MX: 'Mexico',
  DO: 'Dominican Republic', CU: 'Cuba', JM: 'Jamaica', BB: 'Barbados', AG: 'Antigua',
  TH: 'Thailand', ID: 'Indonesia', MV: 'Maldives', LK: 'Sri Lanka', VN: 'Vietnam',
  GB: 'United Kingdom', IE: 'Ireland', NL: 'Netherlands', DE: 'Germany', AT: 'Austria',
  CH: 'Switzerland', CZ: 'Czech Republic', HU: 'Hungary', PL: 'Poland', IS: 'Iceland',
  ME: 'Montenegro', AL: 'Albania', MU: 'Mauritius', SC: 'Seychelles', ZA: 'South Africa',
  CV: 'Cape Verde', CA: 'Canada', BS: 'Bahamas', LC: 'Saint Lucia', GD: 'Grenada',
};

export function countryName(code) {
  const cc = String(code || '').toUpperCase();
  return COUNTRY_NAMES[cc] || (cc || null);
}

/** Travelify product types mapped onto the Tripbuster holiday_type enum. */
function holidayTypeFor(o) {
  if (o.type === 'Flights') return 'Flight only';
  if (o.type === 'Accommodation') return 'Hotel only';
  if (o.packageType === 'DynamicPackages') return 'Flight + hotel';
  return 'Package holiday';
}

/**
 * List the country codes the cache currently holds. Used to populate the
 * destination picker with real options, so an agent cannot filter on a country
 * that would return nothing.
 */
export async function cachedCountries(redis = REAL_REDIS) {
  if (!redis.configured()) return [];
  const found = await redis.keys(`${COUNTRY_PREFIX}*`);
  return (found || [])
    .map((k) => String(k).slice(COUNTRY_PREFIX.length).toUpperCase())
    .filter((cc) => /^[A-Z]{2}$/.test(cc))
    .sort();
}

/**
 * Query the cache for offers an agent might want to advertise.
 *
 * Filters are deliberately the handful an agent thinks in — where, board,
 * budget, length of stay, how far ahead. Everything is applied here rather than
 * trusted from a client.
 *
 * @param {object} f
 * @param {string[]} f.countries   2-letter codes; empty means every cached country
 * @param {string[]} f.boards      Tripbuster board enum values
 * @param {number|null} f.budgetMax  max per-person price
 * @param {number|null} f.nightsMin
 * @param {number|null} f.nightsMax
 * @param {number|null} f.withinDays  only offers departing within this many days
 * @param {number} f.limit         how many offers to return (caller clamps)
 * @returns {Promise<{offers: object[], totalMatched: number, refreshedAt: string|null,
 *                    countriesRead: number}>}
 */
export async function queryOfferCache(f = {}, redis = REAL_REDIS) {
  if (!redis.configured()) return { offers: [], totalMatched: 0, refreshedAt: null, countriesRead: 0 };

  const wanted = (Array.isArray(f.countries) ? f.countries : [])
    .map((c) => String(c || '').toUpperCase())
    .filter((c) => /^[A-Z]{2}$/.test(c));
  const ccList = wanted.length ? wanted : await cachedCountries(redis);

  const boardSet = new Set((Array.isArray(f.boards) ? f.boards : []).map(normBoard).filter(Boolean));
  const budgetMax = Number.isFinite(Number(f.budgetMax)) && Number(f.budgetMax) > 0 ? Number(f.budgetMax) : null;
  const nightsMin = Number.isFinite(Number(f.nightsMin)) && Number(f.nightsMin) > 0 ? Number(f.nightsMin) : null;
  const nightsMax = Number.isFinite(Number(f.nightsMax)) && Number(f.nightsMax) > 0 ? Number(f.nightsMax) : null;
  const withinDays = Number.isFinite(Number(f.withinDays)) && Number(f.withinDays) > 0 ? Number(f.withinDays) : null;
  // The ceiling is high because the importer and the resync need to see EVERY
  // matching offer to find the ones an agent picked by reference — capping this
  // at a browse-sized page would make an offer outside the cheapest N look as
  // though it had left the feed. Callers that render a list pass their own limit.
  const limit = Math.max(1, Math.min(10000, Number(f.limit) || 60));

  const now = Date.now();
  const windowMax = withinDays != null ? now + withinDays * 86400000 : null;

  const matched = [];
  let refreshedAt = null;

  let cursor = 0;
  const workers = Array.from({ length: Math.min(READ_CONCURRENCY, ccList.length || 1) }, async () => {
    while (cursor < ccList.length) {
      const cc = ccList[cursor++];
      const [packages, extra] = await Promise.all([
        redis.getJson(`${COUNTRY_PREFIX}${cc}`),
        redis.getJson(`${EXTRA_PREFIX}${cc}`),
      ]);
      const pools = [packages, extra].filter((s) => s && Array.isArray(s.offers));
      for (const s of pools) {
        if (s.refreshedAt && (!refreshedAt || s.refreshedAt > refreshedAt)) refreshedAt = s.refreshedAt;
      }
      for (const pool of pools) {
        for (const o of pool.offers) {
          if (!o || !isServable(o, now)) continue;
          // A deal needs somewhere to send the traveller and a price to show.
          const pricePP = Number.isFinite(o.pricePP) ? o.pricePP : o.price;
          if (!Number.isFinite(pricePP)) continue;
          if (budgetMax != null && pricePP > budgetMax) continue;
          if (boardSet.size && !boardSet.has(normBoard(o.boardBasis))) continue;
          if (nightsMin != null && !(Number.isFinite(o.nights) && o.nights >= nightsMin)) continue;
          if (nightsMax != null && !(Number.isFinite(o.nights) && o.nights <= nightsMax)) continue;
          if (windowMax != null) {
            const travel = Date.parse(o.outboundDate || o.checkinDate || '');
            if (!Number.isFinite(travel) || travel > windowMax) continue;
          }
          matched.push(o);
        }
      }
    }
  });
  await Promise.all(workers);

  // Same composite key the cron merges on, so one offer cannot appear twice
  // because it sits in both the packages and extra pools.
  const seen = new Set();
  const unique = [];
  for (const o of matched) {
    const k = `${o.id}|${o.origin || ''}|${o.type || 'Packages'}`;
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(o);
  }

  const priceOf = (o) => (Number.isFinite(o.pricePP) ? o.pricePP : (Number.isFinite(o.price) ? o.price : Infinity));
  unique.sort((a, b) => priceOf(a) - priceOf(b));

  return {
    offers: unique.slice(0, limit),
    totalMatched: unique.length,
    refreshedAt,
    countriesRead: ccList.length,
  };
}

/**
 * The stable identity of a cached offer, used as the deal's external_ref so a
 * later resync finds the same row instead of adding a second one.
 *
 * Namespaced 'cache:' so it can never collide with a spreadsheet reference,
 * and includes origin and type because the cron treats those as part of the
 * offer's identity — the same hotel from Manchester and from Gatwick are two
 * different things to sell.
 */
export function offerRef(o) {
  return `cache:${o.id}|${o.origin || ''}|${o.type || 'Packages'}`.slice(0, 200);
}

/** Fields a resync refreshes. See offerToDeal for why the list is this short. */
export const RESYNC_FIELDS = [
  'price_from', 'was_price', 'currency', 'price_basis',
  'travel_from', 'travel_until', 'nights', 'board_basis',
];

/**
 * Build a Tripbuster deal from a cached offer.
 *
 * Only the commercial facts come across. PROTECTION is deliberately left to the
 * agent's own account defaults (applied at write time in my-deals.js), because
 * the traveller books with the AGENT, not with Travelify, and the deal must
 * carry the agent's protection rather than the operator's.
 *
 * The offer's own deeplink IS used as the booking link when it is a usable
 * http(s) URL, because it lands the traveller on that exact offer in the
 * agent's booking engine rather than on their homepage. When it is missing,
 * applyAgentDefaults falls back to the agent's default website.
 *
 * @param {object} o       stored offer
 * @param {object} opts
 * @param {boolean} opts.resyncOnly  return only the volatile fields
 */
export function offerToDeal(o, { resyncOnly = false } = {}) {
  const pricePP = Number.isFinite(o.pricePP) ? o.pricePP : o.price;
  const currency = ['GBP', 'EUR', 'USD'].includes(o.currency) ? o.currency : 'GBP';

  // Only show a was-price when it genuinely beats the price we are advertising.
  // The stored priceBeforeChange can be a component-level figure, and "was £150"
  // beside a £1,240 holiday would be nonsense (same rule cached-offers.js applies).
  const was = (o.priceChanged && Number.isFinite(o.priceBeforeChange)
    && Number.isFinite(pricePP) && o.priceBeforeChange > pricePP)
    ? o.priceBeforeChange : null;

  const volatile = {
    price_from: Number.isFinite(pricePP) ? Number(pricePP.toFixed(2)) : null,
    was_price: was != null ? Number(was.toFixed(2)) : null,
    currency,
    price_basis: 'pp',
    travel_from: (o.outboundDate || o.checkinDate || '').slice(0, 10) || null,
    travel_until: (o.returnDate || '').slice(0, 10) || null,
    nights: Number.isFinite(o.nights) ? o.nights : null,
    board_basis: boardToEnum(o.boardBasis),
  };
  if (resyncOnly) return volatile;

  const resort = o.resort || o.airportName || null;
  const hotel = o.hotel || null;
  const country = countryName(o.countryCode);

  // A title the agent can leave as-is: "Sol Pelicanos, Benidorm, 7 nights all
  // inclusive". Assembled from whatever the offer actually has, so a hotel-only
  // offer with no nights still reads as a place rather than starting mid-phrase.
  const boardName = boardToEnum(o.boardBasis);
  const place = [hotel, resort].filter(Boolean);
  const stay = [];
  if (Number.isFinite(o.nights)) stay.push(`${o.nights} night${o.nights === 1 ? '' : 's'}`);
  if (boardName && boardName !== 'Room only') stay.push(boardName.toLowerCase());
  const lead = place.length ? place.join(', ') : (country || 'Holiday offer');
  const title = stay.length ? `${lead}, ${stay.join(' ')}` : lead;

  return {
    ...volatile,
    title: title.slice(0, 200),
    holiday_type: holidayTypeFor(o),
    country,
    resort,
    accommodation_name: hotel,
    star_rating: Number.isFinite(o.rating) && o.rating >= 1 && o.rating <= 5 ? Math.round(o.rating) : null,
    // Travelify review ratings are already out of 10, the same scale as guest_score.
    guest_score: Number.isFinite(o.reviewRating) && o.reviewRating >= 0 && o.reviewRating <= 10
      ? Number(o.reviewRating.toFixed(1)) : null,
    room_type: o.propertyType || null,
    departure_airports: o.origin ? [o.originName || o.origin] : null,
    airline: o.carrier || null,
    adults: Number.isFinite(o.adults) ? o.adults : null,
    children: Number.isFinite(o.children) ? o.children : null,
    availability_type: 'fixed',
    hero_image_url: typeof o.image === 'string' && /^https?:\/\//i.test(o.image) ? o.image : null,
    // Deliberately NOT in RESYNC_FIELDS: if the agent edits where the deal
    // points, a later price refresh must not quietly undo that.
    clickout_url: typeof o.url === 'string' && /^https?:\/\//i.test(o.url) ? o.url : null,
  };
}
