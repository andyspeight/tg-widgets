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
/** A calendar day as YYYY-MM-DD, or ''. Accepts what a date input produces and
 *  what a person types, and rejects anything it cannot read rather than
 *  guessing — a misread date searches the wrong week and looks like thin
 *  availability. */
export function cleanDate(v) {
  const raw = String(v == null ? '' : v).trim();
  if (!raw) return '';
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (!iso) return '';
  const [, y, m, d] = iso;
  const dt = new Date(Date.UTC(+y, +m - 1, +d));
  if (!Number.isFinite(dt.getTime())) return '';
  // Round-trip it: 2026-02-31 parses to 3 March, and silently moving somebody's
  // departure is worse than refusing it.
  if (dt.getUTCFullYear() !== +y || dt.getUTCMonth() !== +m - 1 || dt.getUTCDate() !== +d) return '';
  return `${y}-${m}-${d}`;
}

/** Midnight UTC on a YYYY-MM-DD, in the format the API expects. */
export function isoOfDate(day, plusDays = 0) {
  const clean = cleanDate(day);
  if (!clean) return '';
  const dt = new Date(clean + 'T00:00:00Z');
  dt.setUTCDate(dt.getUTCDate() + plusDays);
  return dt.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** The fixed departure for one property, if it has one.
 *
 *  A ROW beats the widget: "some of the offers will be travelling on specific
 *  dates" (Andy, 16 Sep 2026), so one hotel can be pinned to a date while the
 *  rest of the widget keeps rolling. '' means no fixed date and the rolling
 *  window applies. */
export function fixedCheckin(prop, search = {}) {
  return cleanDate(prop && prop.checkin) || cleanDate(search.checkinDate) || '';
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
  // An arrival airport an agent pinned, or one a pasted deeplink carried. A
  // package's flight legs need a real airport code, and this is the only place
  // a human can say which one.
  const dstOf = (v) => (/^[A-Za-z0-9]{3,11}$/.test(String(v || '').trim())
    ? String(v).trim().toUpperCase() : '');
  for (const row of rows) {
    let code, name, ctry, lat, lng, dst, checkin, nights;
    if (row && typeof row === 'object') {
      code = canonTti(row.code || row.tti || row.uniqueRef);
      name = cleanName(row.name);
      ctry = cleanCtry(row.ctry || row.countryCode);
      lat = cleanCoord(row.lat ?? row.latitude, 90);
      lng = cleanCoord(row.lng ?? row.longitude, 180);
      dst = dstOf(row.dst);
      // A departure this hotel actually travels on, and how long for. Blank
      // means it follows the widget's rolling window.
      checkin = cleanDate(row.checkin || row.checkinDate);
      nights = cleanCoord(row.nights, 28);
    } else {
      const parts = String(row || '').split(',');
      code = canonTti(parts[0]);
      name = cleanName(parts[1]);
      ctry = cleanCtry(parts[2]);
      lat = cleanCoord(parts[3], 90);
      lng = cleanCoord(parts[4], 180);
      dst = dstOf(parts[5]);
      checkin = cleanDate(parts[6]);
      nights = cleanCoord(parts[7], 28);
    }
    if (!code || seen.has(code)) continue;
    seen.add(code);
    out.push({ code, name, ctry, lat, lng,
      ...(dst ? { dst } : {}),
      ...(checkin ? { checkin } : {}),
      ...(nights ? { nights: Math.round(nights) } : {}) });
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
  // carries org. Kept as a list because the agent may offer several, but be
  // clear what that costs: Travelify prices ONE departure airport per search
  // (its flight criteria take Legs, and a leg has a single origin), so three
  // airports is three searches per property per night, not one. `dpOrigins`
  // is where that budget is capped. Meaningless for a hotel on its own, so
  // omitted there.
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
    // A fixed departure for the WHOLE widget — an October half-term campaign
    // rather than "something about a month out". A row can still override it.
    checkinDate: cleanDate(c.checkinDate),
    nights: n(c.nights, DEFAULT_NIGHTS, 1, 28),
    // THE ROLLING WINDOW FINALLY REACHES THE SEARCH.
    //
    // buildAccommodationCriteria reads `leadDays`, and nothing has ever set it:
    // searchFromConfig emitted DatesMin and the builder never looked at it, so
    // every search this product has run went out at the default 30 days
    // whatever the editor said. DatesMin is the earliest date the widget wants,
    // which is exactly what a lead time is.
    leadDays: n(c.DatesMin, DEFAULT_DATES_MIN, 0, 330),
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

/** A plausible IPv4 or IPv6 address, or ''.
 *
 *  Travelify REQUIRES CustomerIP and rejects a search without one — measured
 *  14 Sep 2026, the API's own words: "You must specify the customer IP address
 *  (IPv4 or IPv6 supported)". It is used for geo and fraud checks, so a wrong
 *  one is worse than none: it would put the search in the wrong market. Hence
 *  a real value from the caller, never a fabricated one. */
export function cleanIp(v) {
  const t = String(v || '').trim();
  if (!t || t === 'unknown') return '';
  // IPv4, each octet 0-255.
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(t)) {
    return t.split('.').every((o) => Number(o) <= 255) ? t : '';
  }
  // The ::ffff: mapped form first — it contains dots, so the hex-only test
  // below would reject it, and this is the form a proxied request often
  // arrives in.
  const mapped = /^::ffff:((\d{1,3}\.){3}\d{1,3})$/i.exec(t);
  if (mapped) return cleanIp(mapped[1]);
  // Plain IPv6.
  if (t.includes(':') && /^[0-9A-Fa-f:]{2,45}$/.test(t)) return t;
  return '';
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

  // Travelify refuses a search with no CustomerIP, so a criteria object
  // without one is not worth sending. Returning null here means the caller
  // reports "we have no IP for you" rather than burning a request to be told.
  if (!cleanIp(search.customerIp)) return null;

  const leadDays = num(search.leadDays, DEFAULT_LEAD_DAYS, 0, 330);
  // A hotel's own night count beats the widget's: a fixed departure usually
  // comes with a fixed duration, and the two travel together.
  const nights = num(prop.nights ?? search.nights, DEFAULT_NIGHTS, 1, 28);

  // A REAL DEPARTURE DATE, when the offer has one.
  //
  // "Some of the offers will be travelling on specific dates" (Andy, 16 Sep
  // 2026). A rolling "30 days out" cannot express a half-term departure, and a
  // date that has since passed must not be searched: the supplier answers with
  // nothing and it reads as no availability rather than as a stale row. So a
  // fixed date in the past refuses the whole search and the caller says why.
  const fixed = fixedCheckin(prop, search);
  if (fixed && isoOfDate(fixed) <= isoDay(now, 0)) return null;
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
    // Required. The search is refused outright without it.
    CustomerIP: cleanIp(search.customerIp),
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
      CheckinDate: fixed ? isoOfDate(fixed) : isoDay(now, leadDays),
      CheckoutDate: fixed ? isoOfDate(fixed, nights) : isoDay(now, leadDays + nights),
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
    // The arrival airport, straight from the link. A DP deep link carries
    // `dst` (Andy's read `dst=AE1`), which is exactly the code a flight leg's
    // DestinationCode wants — so a pasted link needs nothing resolved.
    ...(/^[A-Za-z0-9]{3,11}$/.test(String(q.get('dst') || '').trim())
      ? { dst: String(q.get('dst')).trim().toUpperCase() } : {}),
    // st=DynamicPackaging on a DP link, Accommodation otherwise.
    type: /^dynamic/i.test(String(q.get('st') || '')) ? 'DynamicPackages' : 'Accommodation',
  };
}

/** Is this ROW complete enough to search with?
 *
 *  Deliberately does not go through buildAccommodationCriteria: that also needs
 *  a CustomerIP, which is a property of the REQUEST, not of the hotel the agent
 *  typed in. Routing readiness through it made every row report as unsearchable
 *  the moment CustomerIP became required, which is the wrong answer to the
 *  question the editor is asking. */
export function rowIsSearchable(row) {
  const code = canonTti(row && (row.code || row.tti));
  if (!code) return false;
  const lat = Number(row && row.lat);
  const lng = Number(row && row.lng);
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng)
    && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
  return hasCoords || !!cleanCtry(row.ctry || row.locationCountry);
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
 *  The real field names, confirmed from a live result (Andy, 14 Sep 2026):
 *
 *    rid resultType isAvailable availabilityError pricing priority uniqueID
 *    uniqueRef propertyType name chain rating location descriptions amenities
 *    features media isRoomAlloc isGroupedUnits units optionalExtras
 *
 *  So `media` is the gallery, `uniqueRef` is the pin we matched on, `name` is
 *  the hotel, `location` carries the place and the stay details sit on `units`.
 *  The first version of this function guessed at image/images/thumbnail and
 *  found none of them, which is why every card came back without a photo.
 *
 *  Anything still unrecognised goes in `unmapped` rather than becoming a silent
 *  null: a cache quietly full of nulls looks exactly like a supplier with thin
 *  content, and sends the next person debugging the wrong thing. */
/** The rate the headline price actually belongs to.
 *
 *  A real result (Andy, 16 Sep 2026) has EIGHT units, each with up to three
 *  rates — BedAndBreakfast, HalfBoard, AllInclusive — at different prices, and
 *  `pricing.price` is the cheapest of all twenty. So "the board basis" is not a
 *  field on the result at all: it belongs to whichever rate produced the
 *  headline number, and naming any other one would put All Inclusive on a card
 *  priced for bed and breakfast.
 *
 *  Matched on price rather than assumed to be units[0].rates[0]. That is
 *  self-verifying: if the shape ever changes, this finds nothing and the offer
 *  reports a gap, instead of confidently showing the wrong board. */
export function rateForHeadline(r) {
  const head = asNum(pick(r, ['pricing.total', 'pricing.price', 'pricing.amount']));
  const units = Array.isArray(r && r.units) ? r.units : [];
  let fallback = null;
  for (const u of units) {
    for (const rate of (Array.isArray(u && u.rates) ? u.rates : [])) {
      const p = asNum(pick(rate, ['pricing.total', 'pricing.price', 'pricing.amount']));
      if (!fallback) fallback = { unit: u, rate };
      if (head != null && p != null && p === head) return { unit: u, rate };
    }
  }
  return fallback;
}

export function normaliseAccommodationResult(r, ctx = {}) {
  if (!r || typeof r !== 'object') return null;
  // A result the supplier has marked unavailable is not an offer. Caching one
  // puts a price and a booking link on a card that cannot be booked, and the
  // visitor finds out at the payment page. That is the worst failure this
  // widget has, so it is refused here rather than filtered later.
  if (r.isAvailable === false) return null;

  const unmapped = [];

  const price = asNum(pick(r, [
    'pricing.total', 'pricing.price', 'pricing.totalPrice', 'pricing.amount',
    'pricing.grossPrice', 'pricing.leadInPrice',
  ]));
  const pricePP = asNum(pick(r, [
    'pricing.perPerson', 'pricing.pricePerPerson', 'pricing.pricePP', 'pricing.perPersonPrice',
  ]));
  // No price is not an offer. Never cache one: the card would render a hotel
  // with a blank price and a live booking link behind it.
  if (price == null && pricePP == null) return null;

  // THE GALLERY. Every hotel has photos and they live in `media`. Kept as a
  // small list rather than one frame: on this widget every card is a hotel the
  // client picked by hand, so it earns more than a single thumbnail.
  const media = Array.isArray(r.media) ? r.media : [];
  const images = [];
  for (const m of media) {
    const u = typeof m === 'string' ? m : (m && (m.url || m.href || m.src));
    if (typeof u === 'string' && /^https?:\/\//.test(u) && images.indexOf(u) === -1) images.push(u);
    if (images.length >= 6) break;
  }
  if (!images.length) unmapped.push('media');

  const loc = r.location || {};
  // The unit and rate behind the headline price — see rateForHeadline.
  const head = rateForHeadline(r) || {};
  const headUnit = head.unit || {};
  const headRate = head.rate || {};
  const lat = asNum(pick(loc, ['latitude', 'lat']));
  const lng = asNum(pick(loc, ['longitude', 'lng', 'lon']));
  // A PACKAGE PRICE IS THE FLIGHT PLUS THE HOTEL.
  //
  // ctx.flight is supplied only on a dynamic package search. Without it the
  // number below is the accommodation alone, which is exactly what was being
  // cached under a Flight + Hotel badge.
  const fl = ctx.flight || null;
  const total = (price != null ? price : pricePP) + (fl ? fl.price : 0);

  const offer = {
    // A package is stored AS A PACKAGE, in the platform's own fields.
    //
    // Not a bespoke shape. `type: 'Packages'` + `packageType` + `origin` is
    // what every other offer in this product uses, and the whole read path is
    // already built on it: api/cached-offers.js turns `origin` into a real
    // flight block, typePredicate('DynamicPackages') matches it, the card
    // draws the Flight + Hotel badge and the departure code, and the widget's
    // existing `hotel` dedupe collapses one hotel priced from three airports
    // into one card with "+2 more". None of that needed writing.
    //
    // The earlier attempt stored every TTI offer as 'Accommodation' and hung
    // includesFlights/departureAirport off it. That parted company with the
    // read side — a package that nothing downstream could recognise AS a
    // package, so it rendered as a hotel with an unexplained price.
    type: ctx.origin ? 'Packages' : 'Accommodation',
    // What KIND of package, which is what packageKindOf reads to tell a
    // dynamic package from an operator one. Without it the read side falls
    // back to comparing supplier ids we do not have, and calls this a package
    // holiday.
    ...(ctx.origin ? { packageType: 'DynamicPackages' } : {}),
    // The departure airport, under the name the rest of the product uses.
    // cached-offers.js keys `hasFlight` off exactly this, and builds
    // flight.origin.iataCode from it.
    ...(ctx.origin ? { origin: ctx.origin } : {}),
    ...(ctx.originName ? { originName: ctx.originName } : {}),
    // WHERE IT LANDS, and the dates it flies. The card's flight line is
    // `fromCode -> toCode` and it is skipped ENTIRELY unless both ends are
    // known, which is why a package showed no departure airport at all even
    // though the origin was stored. The arrival airport was resolved before
    // the search; storing it costs nothing and completes the line.
    ...(ctx.destination ? { airport: ctx.destination } : {}),
    ...(ctx.destinationName ? { airportName: ctx.destinationName } : {}),
    // The FLIGHT's own times win over the midnight dates in the criteria: the
    // aeroplane leaves at 14:35, not at 00:00, and the board renders a time.
    ...((fl && fl.outboundDate) || ctx.outboundDate
      ? { outboundDate: (fl && fl.outboundDate) || ctx.outboundDate } : {}),
    ...((fl && fl.returnDate) || ctx.returnDate
      ? { returnDate: (fl && fl.returnDate) || ctx.returnDate } : {}),
    ...(fl && fl.arrivalDate ? { arrivalDate: fl.arrivalDate } : {}),
    // The flight itself, under the names api/cached-offers.js already rebuilds
    // raw.flight from. The card draws carrier and stops and had nothing to draw.
    ...(fl && fl.carrier ? { carrier: fl.carrier } : {}),
    ...(fl && fl.carrierCode ? { carrierCode: fl.carrierCode } : {}),
    ...(fl && typeof fl.direct === 'boolean' ? { direct: fl.direct } : {}),
    ...(fl && Number.isFinite(fl.stops) ? { stops: fl.stops } : {}),
    ...(fl && Number.isFinite(fl.duration) ? { duration: fl.duration } : {}),
    ...(fl && fl.flightNumber ? { flightNumber: fl.flightNumber } : {}),
    ...(fl && fl.cabinClass ? { cabinClass: fl.cabinClass } : {}),
    ...(fl && Number.isFinite(fl.sid) ? { flightSid: fl.sid } : {}),
    price: total,
    // The two halves, kept so a price can be explained rather than asserted.
    ...(fl ? { hotelPrice: price != null ? price : pricePP, flightPrice: fl.price } : {}),
    // Per person is the ACCOMMODATION's own figure and does not describe a
    // package, so it is dropped once a flight is in the total rather than
    // quietly under-reporting it.
    pricePP: (!fl && pricePP != null) ? pricePP : null,
    currency: pick(r, ['pricing.currency', 'pricing.currencyCode']) || ctx.currency || 'GBP',
    hotel: r.name ? String(r.name).slice(0, 160) : null,
    resort: (() => {
      const v = pick(loc, ['name', 'resort', 'city', 'area', 'town', 'region']);
      if (!v) return ctx.locationName || null;
      // Suppliers shout: the real result gives city as "TENERIFE". A card
      // reading "TENERIFE, ES" looks like an error message. Title-cased only
      // when it is ALL capitals, so "La Laguna" and "CIudad" are left alone.
      const name = String(v).slice(0, 120);
      return /[A-Z]/.test(name) && name === name.toUpperCase()
        ? name.toLowerCase().replace(/(^|[\s'\-])([a-z])/g, (m, a, b) => a + b.toUpperCase())
        : name;
    })(),
    countryCode: cleanCtry(pick(loc, ['countryCode', 'country', 'countryISO']) || ctx.ctry || ''),
    lat: lat != null ? lat : (ctx.lat != null ? ctx.lat : null),
    lng: lng != null ? lng : (ctx.lng != null ? ctx.lng : null),
    // The SAME coordinates again under the names api/cached-offers.js rebuilds
    // accommodation.destination from. It reads resortLat/resortLng, and the
    // widget's own deeplink builder needs that destination to pin the property
    // on a click. Without these the click-through could not be built and every
    // card fell back to '#'.
    resortLat: lat != null ? lat : (ctx.lat != null ? ctx.lat : null),
    resortLng: lng != null ? lng : (ctx.lng != null ? ctx.lng : null),
    rating: asNum(r.rating),
    // The review score, which the card already renders beside the star rating.
    // `review` turned up in the real result's field list (Andy, 14 Sep 2026)
    // and was going unused. Optional, so a supplier without one costs nothing
    // and it is not reported as a gap.
    reviewRating: asNum(pick(r, ['review.rating', 'review.score', 'review.value', 'reviewRating'])),
    reviewCount: asNum(pick(r, ['review.reviews', 'review.count', 'review.numReviews', 'review.reviewCount', 'reviewCount'])),
    // WHO THE PRICE IS FOR. api/cached-offers.js passes these straight through
    // and the card builds "2 adults" from them; without them it printed the
    // bare word "Travellers" and a price for nobody in particular (Andy,
    // 14 Sep 2026). Taken from the criteria we actually sent, not guessed.
    adults: Number.isFinite(ctx.adults) ? ctx.adults : null,
    children: Number.isFinite(ctx.children) ? ctx.children : null,
    infants: Number.isFinite(ctx.infants) ? ctx.infants : null,
    // From the RATE the price belongs to. Confirmed against a real result:
    // units[].rates[].board, and the headline price is the cheapest of twenty
    // such rates. It was being looked for on the unit, where it has never been.
    boardBasis: pick(headRate, ['board', 'boardBasis', 'mealPlan']) || null,
    // Which room that price buys. Free, and the difference between "£934" and
    // "£934, Apartment with balcony".
    roomName: pick(headUnit, ['name', 'roomType']) || null,
    nights: asNum(pick(headUnit, ['nights'])) ?? asNum(pick(r, ['units.0.nights', 'nights', 'pricing.nights'])),
    // `checkin`, not `checkinDate`. The guessed name never existed, so this
    // silently fell back to whatever the caller passed — right by luck, and
    // wrong the moment the supplier returned different dates from the ones we
    // asked for.
    checkinDate: pick(headUnit, ['checkin', 'checkinDate'])
      || pick(r, ['units.0.checkin', 'units.0.checkinDate', 'checkinDate']) || ctx.checkinDate || null,
    propertyType: r.propertyType || null,
    // "No chain" is the supplier's way of saying there isn't one. Printed
    // verbatim it becomes a line on the card reading "No chain" under the
    // hotel name.
    chain: (r.chain && !/^no chain$/i.test(String(r.chain).trim())) ? r.chain : null,
    image: images[0] || null,
    // Only when there is more than one, so a single-photo hotel costs no extra
    // bytes in a cache key that has a size ceiling.
    images: images.length > 1 ? images : undefined,
    // The click-through. Per result the API gives `rid`; the bookable URL
    // belongs to the SESSION that produced it, so the caller supplies it rather
    // than the parser inventing one.
    rid: r.rid != null ? String(r.rid) : null,
    // A stable identity. api/cached-offers.js dedupes on `id|origin|type`, so
    // offers with no id all key identically and every one after the first is
    // thrown away — which would have collapsed a twelve-hotel widget to a
    // single card. rid is per result within a search; the property and the
    // stay make it unique across searches.
    id: 'tti:' + (r.uniqueRef ? String(r.uniqueRef).replace(/^[A-Za-z]+:/, '') : 'x')
      + ':' + (r.rid != null ? r.rid : 'x')
      + ':' + (pick(r, ['units.0.checkinDate', 'checkinDate']) || ctx.checkinDate || 'x'),
    url: ctx.deeplinkUrl || null,
    // Bookable / Affiliate / EnquiryOnly. An Affiliate result hands the visitor
    // to somebody else rather than booking here, so the card has to know.
    resultType: r.resultType || null,
    accommodationUniqueRef: r.uniqueRef ? String(r.uniqueRef).slice(0, 64) : null,
    // On the PRICING block, where it was not being looked for. The card has a
    // refundability line and has never had anything to put in it.
    refundability: pick(headRate, ['pricing.refundability', 'refundability'])
      || pick(r, ['pricing.refundability', 'units.0.refundability', 'refundability']) || null,
    fetchedAt: new Date().toISOString(),
  };

  // Only the gaps that actually show on a rendered card.
  //
  // `url` is deliberately NOT one of them. The widget builds its own
  // click-through from the property reference and coordinates (offersDeeplink),
  // so a cached offer without a url is normal rather than broken, and reporting
  // it sent Andy looking for a missing field that was never needed.
  for (const [name, v] of [['hotel', offer.hotel], ['nights', offer.nights],
    // A card without a board basis looks like a hotel that has none, which is
    // not a thing. Reported so it can be chased rather than absorbed.
    ['boardBasis', offer.boardBasis]]) {
    if (v == null && unmapped.indexOf(name) === -1) unmapped.push(name);
  }
  return { offer, unmapped };
}

/* ============================================================
   Dynamic packaging: a flight and this hotel, priced together
   ============================================================ */

/** One FLIGHT result from a dynamic package search, reduced to the fields the
 *  card already draws and the one field the price depends on.
 *
 *  WHY THIS EXISTS. A dynamic package prices the two halves separately and
 *  returns them in separate arrays: `accommodationResults` carries the HOTEL
 *  price and `flightResults` carries the flight. We were caching the
 *  accommodation price as the package price, so the same hotel came back at
 *  £857 from Gatwick, £857 from Manchester, and £857 on a search that returned
 *  no flights at all (Andy, 14 Sep 2026: "I have just changed the departure
 *  airport ... and it still says the same price"). Three identical answers is
 *  what a hotel-only price looks like.
 *
 *  The field names are picks rather than certainties, because no worked flight
 *  result has been seen. Anything unmapped is REPORTED, and a flight with no
 *  readable price is not usable — see `cheapestFlight`. */
export function normaliseFlightResult(f) {
  if (!f || typeof f !== 'object') return null;
  const price = asNum(pick(f, ['pricing.total', 'pricing.price', 'pricing.amount']));
  if (price == null) return null;

  // MEASURED from a real flight result (Andy, 16 Sep 2026). A flight is
  // routes[] — one per leg, tagged Outbound and Inbound — and each route is
  // segments[], one per hop. Everything a card shows lives on the first segment
  // of the outbound route, not on the flight itself, which is why carrier and
  // stops came back unmapped on every test until now.
  const routes = Array.isArray(f.routes) ? f.routes : [];
  const outbound = routes.find((r) => r && r.direction === 'Outbound') || routes[0] || null;
  const inbound = routes.find((r) => r && r.direction === 'Inbound')
    || (routes.length > 1 ? routes[1] : null);
  const firstSeg = (route) => {
    const segs = route && Array.isArray(route.segments) ? route.segments : [];
    return segs[0] || null;
  };
  const seg = firstSeg(outbound);
  const back = firstSeg(inbound);

  // STOPS ARE COUNTED, not read. A change of plane is another segment; a
  // technical stop keeps the flight number and shows as a touchdown. Both are
  // a stop to somebody choosing a holiday, and neither is a field.
  const legSegs = outbound && Array.isArray(outbound.segments) ? outbound.segments : [];
  const stops = legSegs.length
    ? (legSegs.length - 1) + legSegs.reduce((n, x) => n + (asNum(x && x.touchdowns) || 0), 0)
    : null;

  const carrier = seg ? (seg.marketingCarrier || seg.operatingCarrier || null) : null;
  return {
    price,
    currency: pick(f, ['pricing.currency', 'pricing.currencyCode']) || null,
    refundability: pick(f, ['pricing.refundability']) || null,
    carrier: (carrier && carrier.name) || null,
    carrierCode: (carrier && carrier.code) || null,
    stops,
    // Stops are known or they are not. "We could not tell" and "it is direct"
    // are different claims, and a card must never make the second on the first.
    ...(stops == null ? {} : { direct: stops === 0 }),
    duration: asNum(outbound && outbound.duration) ?? asNum(seg && seg.duration),
    flightNumber: (seg && (seg.flightNo || seg.flightNumber)) || null,
    cabinClass: (seg && seg.cabinClass) || null,
    // REAL TIMES, not the midnight dates we asked for. The criteria say
    // "2027-04-09"; the aeroplane leaves at 14:35, and a departure board that
    // renders 00:00 on every row reads as broken.
    outboundDate: (seg && seg.depart) || null,
    arrivalDate: (seg && seg.arrive) || null,
    returnDate: (back && back.depart) || null,
    origin: (seg && seg.origin && seg.origin.iataCode) || null,
    destination: (seg && seg.destination && seg.destination.iataCode) || null,
    legCount: routes.length || null,
  };
}

/** The cheapest usable flight from a package search, and what could not be read
 *  from it. A package's "from" price is its cheapest flight plus this hotel. */
export function cheapestFlight(results) {
  const list = Array.isArray(results) ? results : [];
  let best = null;
  for (const one of list) {
    const f = normaliseFlightResult(one);
    if (f && (!best || f.price < best.price)) best = f;
  }
  if (!best) return { flight: null, unmapped: list.length ? ['flight.pricing'] : [] };
  const gaps = [];
  for (const [name, v] of [['flight.carrier', best.carrier], ['flight.stops', best.stops],
    ['flight.departureTime', best.outboundDate]]) {
    if (v == null) gaps.push(name);
  }
  return { flight: best, unmapped: gaps };
}

/** The earliest a package may depart. One day, because a flight has to leave
 *  in the future and the accommodation half must agree with it. */
export const MIN_DP_LEAD_DAYS = 1;

/** The body for a DYNAMIC PACKAGE search around one property.
 *
 *  The hotel half is IDENTICAL to the accommodation search — same Ref, same
 *  area, same dates. Only the flight half is new, and its shape came from
 *  Travelify rather than from a guess: the first attempt sent a flat
 *  origin/date pair and the service answered, by name (14 Sep 2026),
 *
 *    "FlightSearchCriteria - Legs: You must specify at least one flight leg;
 *     FlightSearchCriteria - Passengers: You must specify at least one passenger"
 *
 *  So the flight is a JOURNEY — an ordered list of legs — and the party
 *  travels as Passengers rather than riding along on the room. Two legs for a
 *  return trip, bracketing the stay.
 *
 *  STILL INFERRED, and marked as such: the field names INSIDE a leg
 *  (Origin / Destination / DepartureDate) and the Passenger shape. Travelify
 *  named the two containers, not their contents. If one is wrong the service
 *  will say so by name again, the same way this round was settled.
 *
 *  A DP with no departure point is not a package, so it returns null rather
 *  than quietly searching for a hotel and calling it one. That mislabelling is
 *  exactly what Andy hit when the option was first offered. */
export function buildDynamicPackageCriteria(prop, search = {}, now = new Date()) {
  // A FLIGHT CANNOT LEAVE IN THE PAST, and a hotel can be booked for tonight.
  //
  // leadDays clamps to [0, 330], and 0 means today at 00:00 UTC — which is
  // behind us for all but the first instant of the day. The accommodation
  // search takes that happily; Travelify refuses the whole package for it
  // ("DepartDate: Date must be set and not be in the past"), so a widget with
  // a zero lead would fail every night with an error that reads like the one
  // caused by a misnamed field, and nothing would say which it was.
  //
  // Floored for the WHOLE search rather than just the flight: moving the
  // departure to tomorrow while the room still checks in today would price a
  // package that does not hang together.
  // A FIXED DATE IS NOT NUDGED. The floor exists because a rolling lead of 0
  // means today, which a flight cannot depart on; a date somebody typed is a
  // commitment, and moving it by a day to make the search pass would price a
  // holiday they did not ask for. buildAccommodationCriteria already refuses
  // one that has passed, which is the honest answer instead.
  const lead = num(search.leadDays, DEFAULT_LEAD_DAYS, 0, 330);
  const base = fixedCheckin(prop, search)
    ? buildAccommodationCriteria(prop, search, now)
    : buildAccommodationCriteria(prop, { ...search, leadDays: Math.max(MIN_DP_LEAD_DAYS, lead) }, now);
  if (!base) return null;

  // The departure airport. Without one there is no flight and therefore no
  // package — the caller must report that rather than fall back to a hotel.
  //
  // ONE origin per search. A Leg carries a single origin, so several departure
  // airports are several searches rather than one wider one, and the caller
  // decides how many it is willing to spend. Sending only the first while the
  // agent picked three would quote a price from an airport they did not ask
  // about, which is the quiet kind of wrong this widget keeps having to avoid.
  const origins = (Array.isArray(search.origins) ? search.origins : [])
    .map((o) => String(o || '').trim().toUpperCase())
    .filter((o) => /^[A-Z]{3}$/.test(o));
  const origin = String(search.origin || origins[0] || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(origin)) return null;

  // WHERE IT LANDS. A leg needs a real airport at both ends, and the caller
  // resolves it — see api/_lib/offers/arrival-airport.js. Sending the hotel's
  // COUNTRY was the previous attempt, and Travelify rejected it by name:
  //
  //   Legs[0] - DestinationCode: Unrecognised 3-letter airport/city code: GB
  //
  // A country is not a place a plane lands. No arrival airport means no
  // package, so this refuses rather than inventing somewhere to fly to.
  const dest = String(search.destination || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{3,11}$/.test(dest)) return null;

  const acc = base.AccommodationSearchCriteria;
  // EVERY FIELD NAME HERE HAS BEEN QUOTED BACK AT US BY TRAVELIFY.
  //
  // That is the bar, and it was set by getting it wrong. The alias round sent
  // each value under every plausible spelling at once; the reply named
  // Legs[0].DestinationCode and Legs[1].OriginCode. Those two were then
  // confirmed — but the reply said nothing about the date, because one of the
  // three date aliases happened to be right and the field never errored.
  // Silence is not confirmation. Trimming the date to `DepartureDate` on
  // house-style reasoning threw away the alias that was working, and the next
  // round said so:
  //
  //   Legs[0] - DepartDate: Date must be set and not be in the past
  //
  // "Must be set" because the field we sent was called something else. So the
  // date is `DepartDate`, and the rule is now explicit: only delete a spelling
  // the service has named, never one it merely did not complain about.
  //
  // `Legs` and `Passengers` were named the same way, one round earlier:
  // "Legs: You must specify at least one flight leg; Passengers: You must
  // specify at least one passenger". So the flight half is a JOURNEY, and the
  // party travels as Passengers rather than riding along on the room.
  const leg = (from, to, date) => ({ OriginCode: from, DestinationCode: to, DepartDate: date });
  // Out on the check-in and back on the check-out, so the flight brackets the
  // stay rather than pricing a trip nobody asked for.
  const legs = [leg(origin, dest, acc.CheckinDate), leg(dest, origin, acc.CheckoutDate)];

  // Mirrors the Guests shape on the room, which is the naming this API uses
  // for the same idea elsewhere.
  const passengers = (acc.Rooms[0].Guests || []).map((g) => ({ Type: g.Type, ...(g.Age != null ? { Age: g.Age } : {}) }));

  return {
    ...base,
    SearchType: 'DynamicPackaging',
    FlightSearchCriteria: {
      Legs: legs,
      Passengers: passengers,
      CabinClass: /^(Economy|PremiumEconomy|Business|First)$/.test(String(search.cabinClass || ''))
        ? search.cabinClass : 'Any',
      // `dir=false` on the deeplink: do not insist on direct.
      DirectOnly: search.directOnly === true,
    },
  };
}

/** Every departure airport a DP widget asked for, cleaned. The caller runs one
 *  search per entry, because a Leg carries a single origin. Capped, because a
 *  nightly sweep pays for each one on every property. */
export function dpOrigins(search = {}, cap = 3) {
  return (Array.isArray(search.origins) ? search.origins : [])
    .map((o) => String(o || '').trim().toUpperCase())
    .filter((o) => /^[A-Z]{3}$/.test(o))
    .filter((o, i, a) => a.indexOf(o) === i)
    .slice(0, cap);
}
