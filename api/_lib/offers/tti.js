/**
 * TTI Offers — the pure logic, kept free of Airtable and Redis.
 *
 * Everything here is a plain function over plain data: how a pasted Travelify
 * property code becomes the key the cache is stored under, what search one
 * widget's config implies, how the upstream ask is shaped, and the gate that
 * decides whether a returned offer really belongs to the property we asked
 * for. api/cron/refresh-tti-offers.js supplies the I/O around it.
 *
 * Split out so the logic can be tested without installing the cron's
 * dependency tree, and so the rules live in one readable place rather than
 * halfway down a job that also talks to three services.
 */

// (refn / loct=Property) and the feed's own response field (uniqueRef).
// The feed parameter that scopes a search to one property. Empty until
// Travelify names it — see THE OPEN QUESTION in refresh-tti-offers.js. Set on
// Vercel to go live; no code change is needed once the answer is known.
export const PROPERTY_PARAM = String(process.env.TTI_PROPERTY_PARAM || '').trim();
// Some spellings take an array of codes rather than one.
export const PROPERTY_PARAM_IS_ARRAY = String(process.env.TTI_PROPERTY_PARAM_ARRAY || '') === '1';
// Whether the value carries the 'TTI:' prefix the deeplink uses, or the bare code.
export const PROPERTY_PARAM_PREFIXED = String(process.env.TTI_PROPERTY_PARAM_PREFIXED || '') === '1';

export const PROBE_CANDIDATES = [
  // The spelling the real deep links use, prefixed exactly as they write it.
  { param: 'refn', array: false, prefixed: true },
  { param: 'refn', array: false, prefixed: false },
  // The name the feed itself uses when it hands the code BACK to us.
  { param: 'uniqueRef', array: false, prefixed: false },
  { param: 'uniqueRefs', array: true, prefixed: false },
  { param: 'accommodationUniqueRef', array: false, prefixed: false },
  { param: 'propertyRefs', array: true, prefixed: false },
  { param: 'propertyRef', array: false, prefixed: false },
  { param: 'hotelCodes', array: true, prefixed: false },
  { param: 'establishmentCode', array: false, prefixed: false },
  // No pin at all: the area search on its own. This is the control AND the
  // fallback. If it returns the surrounding area while a pinned candidate
  // returns only our property, that candidate is honoured. If nothing narrows,
  // this is still what the sweep runs on, because the verify gate makes an
  // area search correct — just less complete.
  { shape: 'none' },
];



// The standard band, because the area we search is now a whole COUNTRY (Andy,
// 14 Sep 2026: the agent enters a code and a country, nothing else). If the feed
// honours the refn pin this is just a ceiling and costs nothing, because only
// that property comes back. If it ignores the pin, a country's worth of offers
// sorted cheapest-first is what the verify gate has to find the property in, so
// a thin band would lose hotels that are simply not among the cheapest 60.
// Not raised further: a 1,000-offer accommodation ask does not return inside the
// per-request timeout (proven in the map cron's sweep logs, Aug 2026).
export const MAX_OFFERS_PER_PROPERTY = 250;
// Cap per widget so one pasted spreadsheet cannot turn into a thousand searches
// a night. Kept in step with the editor's own cap and the read side's.
export const MAX_CODES_PER_WIDGET = 100;
// Whole-run ceiling. A runaway roster degrades to "some properties refreshed"
// rather than to an unbounded Travelify bill.
export const MAX_REQUESTS_PER_RUN = 1500;
export const REQUEST_CONCURRENCY = 6;
export const PER_REQUEST_TIMEOUT_MS = 10000;

// Departure advance window, in days from today. Wide by default for the same
// reason the map cron's is: a narrow window is why long-haul came back empty.
// The area radius, in km. The real deep links use 28 around a city centre.
// Wide enough that a property is genuinely inside it, tight enough that a
// cheapest-first slice of 60 still has room for it.
export const DEFAULT_RADIUS_KM = 28;
const DEFAULT_DATES_MIN = 1;
const DEFAULT_DATES_MAX = 700;

/** Canonicalise a Travelify property reference to the bare code we key on.
 *  Must stay identical to canonTti in api/cached-offers.js — the cron writes
 *  the key the widget reads, so a difference here is a silent total miss. */
export function canonTti(token) {
  const up = String(token || '').trim().toUpperCase().replace(/^[A-Z]+:/, '');
  return /^[A-Z0-9][A-Z0-9._-]{0,31}$/.test(up) ? up : '';
}

/** Trim a pasted hotel name to something safe to send upstream. Names come off
 *  an agent's own spreadsheet, so they are trusted-ish but still bounded. */
export function cleanName(v) {
  let s = String(v == null ? '' : v), out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    out += (c < 32 || ch === '<' || ch === '>' || ch === '"') ? ' ' : ch;
  }
  return out.trim().slice(0, 120);
}
/** A coordinate, or null. Bounded so a mis-pasted column cannot travel
 *  upstream as a location. */
export function cleanCoord(v, limit) {
  const n = Number(String(v == null ? '' : v).trim());
  return (Number.isFinite(n) && n !== 0 && Math.abs(n) <= limit) ? n : null;
}
export function cleanCtry(v) {
  const up = String(v == null ? '' : v).trim().toUpperCase();
  return /^[A-Z]{2}$/.test(up) ? up : '';
}

/** Pull the property list off a saved widget config.
 *
 *  Three shapes are accepted, because the agent's source is usually a
 *  spreadsheet they already keep (our own hotel databases carry TTICode, Name
 *  and CountryCode side by side):
 *    - ['TTI:10946397', ...]                      bare codes
 *    - [{ code, name, ctry }, ...]                what the editor saves
 *    - 'TTI:10946397, Vida Beach Resort, AE\n…'   one pasted row per line
 *
 *  The name and country are optional, and only the documented loct=Property
 *  shape needs them. Unusable rows are dropped here rather than sent upstream. */
export function codesFromConfig(config) {
  const raw = config && config.ttiCodes;
  let rows;
  if (Array.isArray(raw)) {
    rows = raw;
  } else {
    // One property per line; commas separate code, name and country within it.
    rows = String(raw || '').split(/[\r\n;]+/);
  }
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    let code, name, ctry, lat, lng;
    if (row && typeof row === 'object') {
      code = canonTti(row.code || row.tti || row.uniqueRef);
      name = cleanName(row.name);
      ctry = cleanCtry(row.ctry || row.countryCode);
      lat = cleanCoord(row.lat ?? row.latitude, 90);
      lng = cleanCoord(row.lng ?? row.longitude, 180);
    } else {
      const parts = String(row || '').split(',');
      code = canonTti(parts[0]);
      name = cleanName(parts[1]);
      ctry = cleanCtry(parts[2]);
      lat = cleanCoord(parts[3], 90);
      lng = cleanCoord(parts[4], 180);
    }
    if (!code || seen.has(code)) continue;
    seen.add(code);
    out.push({ code, name, ctry, lat, lng });
    if (out.length >= MAX_CODES_PER_WIDGET) break;
  }
  return out;
}

/** The search shape one widget implies, clamped to sane bounds. A TTI Offers
 *  widget carries the SAME config keys as Travel Offers (it is the same engine),
 *  so this reads the fields that already exist rather than inventing new ones. */
export function searchFromConfig(config) {
  const c = config || {};
  const n = (v, dflt, lo, hi) => {
    const x = Number(v);
    return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : dflt;
  };
  // Two product types only: the hotel on its own, or a dynamic package built
  // around it (Andy, 12 Sep 2026).
  //
  // A flight has no hotel, so a TTI code cannot scope one. An OPERATOR package
  // holiday is a pre-bundled product the operator assembles and prices as a
  // whole — the hotel inside it is not inventory we can anchor on, so asking
  // for one by property code is asking the wrong question. What is left is
  // Accommodation and DynamicPackages, which are both assembled around a
  // specific property.
  //
  // `type` is the PAYLOAD type and doubles as the sweepTypeId that
  // normaliseOffers stamps onto the stored offer, so it must stay the family
  // name 'Packages': api/cached-offers.js sorts a dynamic package from an
  // operator one with packageKindOf at READ time, exactly as it does for the
  // country pool. `packageType` is what narrows the upstream ask to DP.
  const t = String(c.type || 'Accommodation');
  const type = (t === 'Accommodation') ? 'Accommodation' : 'Packages';
  // A dynamic package needs a departure point, exactly as a DP deep link
  // carries org. Sent as an array so several origins stay ONE request rather
  // than multiplying the nightly budget. Meaningless for a hotel on its own,
  // so omitted there.
  const origins = (type === 'Packages' && Array.isArray(c.origins))
    ? c.origins
      .map((o) => String(o || '').trim().toUpperCase())
      .filter((o) => /^[A-Z]{2,3}$/.test(o))
      .slice(0, 12)
    : [];
  return {
    type,
    packageType: type === 'Packages' ? 'DynamicPackages' : null,
    origins,
    currency: /^[A-Z]{3}$/.test(String(c.currency || '')) ? c.currency : 'GBP',
    nationality: /^[A-Z]{2}$/.test(String(c.nationality || '')) ? c.nationality : 'GB',
    radiusKm: n(c.ttiRadiusKm, DEFAULT_RADIUS_KM, 1, 200),
    DatesMin: n(c.DatesMin, DEFAULT_DATES_MIN, 0, 700),
    DatesMax: n(c.DatesMax, DEFAULT_DATES_MAX, 1, 700),
  };
}

/** Build the upstream payload for one property.
 *  `override` lets the probe swap in a candidate spelling without touching the
 *  configured one. Returns null when no property parameter is known at all —
 *  the caller must then fire nothing, never a broad unscoped search. */
/** Build the upstream payload for one property.
 *
 *  SHAPE TAKEN FROM TWO REAL DEEP LINKS (Andy, 14 Sep 2026). Both a
 *  DynamicPackaging and an Accommodation link pin a property like this:
 *
 *    st=Accommodation &loc=Dubai,+United+Arab+Emirates &loct=City
 *      &lat=25.049 &lng=55.118 &rad=28 &fr=... &dur=7 &refn=TTI:12345 &adt=2
 *
 *  The lesson, and it corrects what this file assumed before: the location is
 *  the CITY, at city scale (loct=City, a 28km radius), and the property is
 *  pinned by refn=TTI:{code} ALONE. There is no loct=Property and no 1km pin.
 *  refn is a refinement laid over an ordinary area search, not a location type.
 *
 *  Which is what makes the sweep safe to run before anyone has confirmed the
 *  FEED honours refn. If it does, one tight request returns that property. If
 *  it is ignored, the same request returns the surrounding area and the verify
 *  gate keeps only our property out of it. Same request count either way, and
 *  the wrong-parameter case degrades to fewer offers rather than wrong ones.
 *
 *  `override` lets the probe swap the PIN for a candidate spelling while the
 *  scope stays fixed, so the two variables do not move at once. */
export function buildTtiPayload(appId, prop, search, override = null) {
  const code = typeof prop === 'string' ? prop : (prop && prop.code);
  // The location NAME is a city or resort, not the hotel — that is what
  // loct=City means. `name` is accepted as an alias for configs saved earlier.
  const loc = (prop && (prop.loc || prop.name)) || '';
  const ctry = (prop && prop.ctry) || '';
  const lat = (prop && prop.lat != null) ? prop.lat : null;
  const lng = (prop && prop.lng != null) ? prop.lng : null;
  if (!code) return null;

  // Some area to search in. Without one this would be a worldwide search that
  // the verify gate then threw almost all of away, which is exactly the kind of
  // wasted Travelify capacity the cache-only rule exists to prevent. Skip
  // instead, and the editor tells the agent which row is short of detail.
  const hasCoords = lat != null && lng != null;
  if (!loc && !ctry && !hasCoords) return null;
  const scope = {
    ...(loc ? { loc, loct: 'City' } : {}),
    ...(hasCoords ? { lat, lng, rad: search.radiusKm || DEFAULT_RADIUS_KM } : {}),
    // The feed's own name for a destination scope, alongside the deep link's.
    ...(ctry ? { destinations: [ctry] } : {}),
  };

  // The pin. Default is the spelling the real deep links use.
  const spec = override || (PROPERTY_PARAM
    ? { param: PROPERTY_PARAM, array: PROPERTY_PARAM_IS_ARRAY, prefixed: PROPERTY_PARAM_PREFIXED }
    : { param: 'refn', array: false, prefixed: true });
  let pin;
  if (spec.shape === 'none') {
    // Deliberately unpinned: the probe's control, and the honest fallback if
    // no pin is ever honoured. The verify gate does the narrowing instead.
    pin = {};
  } else if (!spec.param) {
    return null;
  } else {
    const value = spec.prefixed ? 'TTI:' + code : code;
    pin = { [spec.param]: spec.array ? [value] : value };
  }

  return {
    appId: String(appId),
    type: search.type,
    ...(search.packageType ? { packageType: search.packageType } : {}),
    deduping: 'None',
    currency: search.currency,
    language: 'en',
    nationality: search.nationality,
    maxOffers: MAX_OFFERS_PER_PROPERTY,
    rollingDates: true,
    DatesMin: search.DatesMin,
    DatesMax: search.DatesMax,
    sort: 'price:asc',
    pricingByType: 'Person',
    customerUserAgent: 'Travelgenix-TtiOffersCron/1.0',
    // A dynamic package needs a departure point, as org does on the DP link.
    ...(search.origins && search.origins.length ? { origins: search.origins } : {}),
    ...scope,
    ...pin,
  };
}

/** THE VERIFY GATE. Does this normalised offer actually belong to the property
 *  we asked for? Travelify ignores parameters it does not recognise, so a wrong
 *  TTI_PROPERTY_PARAM returns a full page of unrelated inventory with a 200.
 *  Without this check that inventory would be stored under the client's hotel
 *  and their widget would fill with somebody else's rooms. */
export function offerIsProperty(offer, code) {
  return canonTti(offer && offer.accommodationUniqueRef) === code;
}


/* ============================================================
   The real search criteria (Andy supplied a worked example, 14 Sep 2026)
   ============================================================ */

// Defaults taken from the deeplinks the agents already use: a stay starting a
// month out, a week long, two adults. `frd=30&dur=7&adt=2` in deeplink spelling.
export const DEFAULT_LEAD_DAYS = 30;
export const DEFAULT_NIGHTS = 7;
export const DEFAULT_RADIUS_MILES = 11;

/** Midnight UTC, N days from `now`, in the format the API expects. */
function isoDay(now, plusDays) {
  const d = new Date(now.getTime());
  d.setUTCDate(d.getUTCDate() + plusDays);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

const num = (v, dflt, lo, hi) => {
  const x = Number(v);
  return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : dflt;
};

/** The body for `POST /search`, scoped to ONE property.
 *
 *  `Ref` is what does the scoping — `TTI:{code}`, the same value the deeplink
 *  carries as `refn`. That single field is the whole point: the old path asked
 *  `widgetsvc/traveloffers` for a country's worth of offers and sieved them,
 *  which could never find one named hotel among the 250 cheapest in Great
 *  Britain.
 *
 *  COORDINATES ARE OPTIONAL, and this matters.
 *
 *  An earlier version of this function demanded them. That was wrong, and wrong
 *  in an expensive way: it rested on a 406 from a DEEPLINK carrying `ctry` and
 *  no coordinates — a different surface from this API entirely — and was never
 *  tested here. If `Ref` pins the property then the property IS the location,
 *  and a country is enough to say which one. The worked example carried
 *  coordinates because it came from somebody searching a town in a UI, not
 *  because the field is mandatory.
 *
 *  So: send what we have. A code and a country is a valid ask. Coordinates
 *  narrow it when a row has them, which is strictly better but never required.
 *  If the service does need them it will say so, and the error reaches the
 *  agent verbatim instead of being pre-empted by a guess.
 *
 *  Returns null only when there is genuinely nothing to search: no code, or no
 *  idea where in the world to look.
 *
 *  `now` is injectable so the dates are testable. */
export function buildAccommodationCriteria(prop, search = {}, now = new Date()) {
  const code = canonTti(prop && (prop.code || prop.tti));
  if (!code) return null;

  const lat = Number(prop.lat);
  const lng = Number(prop.lng);
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng)
    && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
  const ctry = cleanCtry(prop.ctry || prop.locationCountry);
  // One or the other. Without either there is no area at all, and an unscoped
  // worldwide search is not a broader question, it is a meaningless one.
  if (!hasCoords && !ctry) return null;

  const leadDays = num(search.leadDays, DEFAULT_LEAD_DAYS, 0, 330);
  const nights = num(search.nights, DEFAULT_NIGHTS, 1, 28);
  const adults = num(search.adults, 2, 1, 9);
  const children = Array.isArray(search.childAges) ? search.childAges.slice(0, 8) : [];

  const guests = [];
  for (let i = 0; i < adults; i++) guests.push({ Type: 'Adult' });
  for (const age of children) {
    const a = num(age, null, 0, 17);
    if (a === null) continue;
    guests.push(a < 2 ? { Type: 'Infant', Age: a } : { Type: 'Child', Age: a });
  }

  return {
    Environment: 'Website',
    SearchType: 'Accommodation',
    Language: search.language || 'en',
    Locale: search.locale || 'en',
    Currency: /^[A-Z]{3}$/.test(String(search.currency || '')) ? search.currency : 'GBP',
    DistanceUnit: 'Miles',
    Nationality: /^[A-Z]{2}$/.test(String(search.nationality || '')) ? search.nationality : 'GB',
    CustomerUserAgent: search.customerUserAgent || 'Travelgenix-TtiOffersCron/1.0',
    CustomerCountry: /^[A-Z]{2}$/.test(String(search.customerCountry || '')) ? search.customerCountry : 'GB',
    TripType: 'Unspecified',
    AccommodationSearchCriteria: {
      // Only sent when the row actually has them. An omitted field is not the
      // same as a zero, and 0,0 is a real place in the Atlantic.
      ...(hasCoords ? {
        Latitude: lat,
        Longitude: lng,
        Radius: num(prop.radius ?? search.radius, DEFAULT_RADIUS_MILES, 1, 100),
        LocationType: prop.locationType || 'City',
        ...(prop.locationName ? { LocationName: String(prop.locationName).slice(0, 200) } : {}),
      } : {}),
      ...(ctry ? { LocationCountry: ctry } : {}),
      // THE PIN. Always prefixed, always canonical, so a code typed as
      // ID:58612582, TTI:58612582 or 58612582 all ask the same question.
      Ref: 'TTI:' + code,
      CheckinDate: isoDay(now, leadDays),
      CheckoutDate: isoDay(now, leadDays + nights),
      BoardBasis: 'Any',
      PropertyType: 'Any',
      MinStarRating: 1.0,
      RefundableOnly: false,
      Rooms: [{ TypePreference: 'Any', Guests: guests }],
    },
  };
}

/** Does this offer belong to the property we asked for?
 *  Kept separate from offerIsProperty because the booking API names the field
 *  differently from the offers feed, and a gate that silently matched nothing
 *  would empty every widget rather than fail loudly. */
export function resultIsProperty(result, code) {
  const want = canonTti(code);
  if (!want) return false;
  const candidates = [
    result && result.uniqueRef,
    result && result.accommodationUniqueRef,
    result && result.ref,
    result && result.Ref,
    result && result.propertyRef,
    result && result.accommodation && result.accommodation.uniqueRef,
  ];
  return candidates.some((c) => c && canonTti(c) === want);
}

/** Pull a property row out of a Travelify deeplink.
 *
 *  The agents already have working deeplinks — that is how this whole thing
 *  started — and a working link carries every field the search criteria need:
 *  the code as `refn`, the area as `loc`/`lat`/`lng`/`rad`, the country as
 *  `ctry`. So let them paste one rather than typing coordinates, and the row
 *  cannot describe a search Travelify would reject, because it came from one
 *  that works.
 *
 *  Returns null for anything that is not a deeplink carrying a property. */
export function parseDeeplink(url) {
  let u;
  try { u = new URL(String(url || '').trim()); } catch { return null; }
  if (!/(^|\.)tvllnk\.com$/i.test(u.hostname)) return null;
  const q = u.searchParams;

  const code = canonTti(q.get('refn'));
  if (!code) return null;

  const lat = Number(q.get('lat'));
  const lng = Number(q.get('lng'));
  const rad = Number(q.get('rad'));
  const appId = (/\/deeplink\/(\d{1,10})/.exec(u.pathname) || [])[1] || '';

  return {
    code,
    appId,
    locationName: cleanName(q.get('loc') || ''),
    locationType: q.get('loct') === 'City' ? 'City' : (q.get('loct') || 'City'),
    ctry: cleanCtry(q.get('ctry') || ''),
    ...(Number.isFinite(lat) && lat >= -90 && lat <= 90 ? { lat } : {}),
    ...(Number.isFinite(lng) && lng >= -180 && lng <= 180 ? { lng } : {}),
    // Deeplinks carry the radius in km; the search criteria want miles.
    ...(Number.isFinite(rad) && rad > 0 ? { radius: Math.max(1, Math.round(rad * 0.621371)) } : {}),
    // st=DynamicPackaging on a DP link, Accommodation otherwise.
    type: /^dynamic/i.test(String(q.get('st') || '')) ? 'DynamicPackages' : 'Accommodation',
  };
}

/** Is this row complete enough to search with? The editor uses this to show a
 *  row as ready or short of detail, and the sweep uses it to skip rather than
 *  fire a search that cannot be scoped. */
export function rowIsSearchable(row) {
  return !!buildAccommodationCriteria(row, {}, new Date());
}

/* ============================================================
   Booking-API results -> the cached offer shape
   ============================================================ */

/** Read a value from whichever spelling a result happens to use.
 *  The booking API and the offers feed name the same things differently, and
 *  the exact result shape has not been seen yet — so rather than guess once and
 *  be silently wrong, try the plausible spellings and REPORT what was not
 *  found. `normaliseAccommodationResult` returns that report alongside the
 *  offer so a wrong guess shows up as a named gap instead of a blank card. */
function pick(obj, paths) {
  for (const path of paths) {
    let v = obj;
    for (const part of path.split('.')) {
      if (v == null) break;
      v = v[part];
    }
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

const asNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** One accommodation result -> the shape api/cached-offers.js already serves.
 *
 *  Deliberately NOT clever. Every field it could not find is listed in
 *  `unmapped`, because a cache quietly full of nulls looks identical to a
 *  supplier with thin content and would send the next person debugging the
 *  wrong thing entirely. */
export function normaliseAccommodationResult(r, ctx = {}) {
  if (!r || typeof r !== 'object') return null;
  const unmapped = [];
  const get = (name, paths) => {
    const v = pick(r, paths);
    if (v === undefined) unmapped.push(name);
    return v;
  };

  const price = asNum(pick(r, [
    'pricing.total', 'pricing.price', 'price.total', 'price.amount',
    'totalPrice', 'price', 'Price', 'leadInPrice',
  ]));
  const pricePP = asNum(pick(r, [
    'pricing.perPerson', 'pricing.pricePerPerson', 'price.perPerson',
    'pricePerPerson', 'perPerson',
  ]));
  // No price is not an offer. Never cache one: the card would render a hotel
  // with a blank price and a live booking link behind it.
  if (price == null && pricePP == null) return null;

  const hotel = get('hotel', ['name', 'Name', 'accommodation.name', 'property.name', 'hotelName']);
  const ref = pick(r, ['uniqueRef', 'accommodationUniqueRef', 'ref', 'Ref',
                       'propertyRef', 'accommodation.uniqueRef']);

  const offer = {
    type: ctx.type === 'DynamicPackages' ? 'Packages' : 'Accommodation',
    price: price != null ? price : pricePP,
    pricePP: pricePP != null ? pricePP : null,
    currency: pick(r, ['pricing.currency', 'price.currency', 'currency']) || ctx.currency || 'GBP',
    hotel: hotel != null ? String(hotel).slice(0, 160) : null,
    resort: (() => {
      const v = pick(r, ['resort.name', 'destination.name', 'location.name', 'city', 'resort']);
      return v ? String(v).slice(0, 120) : (ctx.locationName || null);
    })(),
    countryCode: cleanCtry(pick(r, ['countryCode', 'country.code', 'location.countryCode']) || ctx.ctry || ''),
    lat: asNum(pick(r, ['latitude', 'lat', 'location.latitude'])) ?? (ctx.lat ?? null),
    lng: asNum(pick(r, ['longitude', 'lng', 'location.longitude'])) ?? (ctx.lng ?? null),
    rating: asNum(pick(r, ['rating', 'starRating', 'stars', 'Rating'])),
    reviewRating: asNum(pick(r, ['reviewRating', 'review.rating', 'guestRating'])),
    reviewCount: asNum(pick(r, ['reviewCount', 'review.count', 'reviews'])),
    boardBasis: pick(r, ['boardBasis', 'BoardBasis', 'board']) || null,
    nights: asNum(pick(r, ['nights', 'Nights', 'duration'])) ?? (ctx.nights ?? null),
    checkinDate: pick(r, ['checkinDate', 'CheckinDate', 'checkIn', 'startDate']) || ctx.checkinDate || null,
    propertyType: pick(r, ['propertyType', 'PropertyType']) || null,
    image: pick(r, ['image.url', 'images.0.url', 'images.0', 'imageUrl', 'thumbnail']) || null,
    url: pick(r, ['deeplinkUrl', 'url', 'bookingUrl', 'link']) || null,
    accommodationUniqueRef: ref ? String(ref).slice(0, 64) : null,
    refundability: pick(r, ['refundability', 'Refundability']) || null,
    adults: asNum(pick(r, ['adults', 'Adults'])) ?? (ctx.adults ?? null),
    fetchedAt: new Date().toISOString(),
  };

  // Only report gaps that actually matter to a rendered card.
  for (const [name, v] of [['price', offer.price], ['hotel', offer.hotel],
                           ['image', offer.image], ['url', offer.url]]) {
    if (v == null && !unmapped.includes(name)) unmapped.push(name);
  }
  return { offer, unmapped };
}
