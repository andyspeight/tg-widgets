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
  // The one shape Travelify actually DOCUMENTS for pinning a property, lifted
  // from the Deeplinking Instructions: loct=Property with a location name and
  // country. It needs the hotel's name, which is why the editor accepts one
  // beside each code. Tried first because it is the only candidate with a
  // published source behind it.
  // The WHOLE anchor a real Travelify deep link carries, verified against a
  // live link their own generator produced (22 Jul 2026): the property name,
  // loct=Property, its coordinates with a 1km radius, AND refn=TTI:{code}
  // together. This is what "use the DP deep link" means in feed terms, and it
  // is the likeliest candidate precisely because it is the combination proven
  // to resolve rather than any single part of it.
  { shape: 'deeplink' },
  // The same anchor reduced to what the documentation alone defines.
  { shape: 'loct' },
  // Our own undocumented-but-proven deeplink spelling.
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
  // Andy's hunch, and cheap to test: our own validation is what rejects
  // non-IATA destination tokens today, not Travelify's.
  { param: 'destinations', array: true, prefixed: true },
];


// One property does not need a 250-offer band — it has as many rates as it has,
// and a smaller ask comes back inside the per-request timeout more reliably.
export const MAX_OFFERS_PER_PROPERTY = 60;
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
const DEFAULT_DATES_MIN = 1;
const DEFAULT_DATES_MAX = 700;

/** Canonicalise a Travelify property reference to the bare code we key on.
 *  Must stay identical to canonTti in api/cached-offers.js — the cron writes
 *  the key the widget reads, so a difference here is a silent total miss. */
export function canonTti(token) {
  const up = String(token || '').trim().toUpperCase().replace(/^TTI:/, '');
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
    DatesMin: n(c.DatesMin, DEFAULT_DATES_MIN, 0, 700),
    DatesMax: n(c.DatesMax, DEFAULT_DATES_MAX, 1, 700),
  };
}

/** Build the upstream payload for one property.
 *  `override` lets the probe swap in a candidate spelling without touching the
 *  configured one. Returns null when no property parameter is known at all —
 *  the caller must then fire nothing, never a broad unscoped search. */
export function buildTtiPayload(appId, prop, search, override = null) {
  const code = typeof prop === 'string' ? prop : (prop && prop.code);
  const name = (prop && prop.name) || '';
  const ctry = (prop && prop.ctry) || '';
  const lat = (prop && prop.lat != null) ? prop.lat : null;
  const lng = (prop && prop.lng != null) ? prop.lng : null;
  const spec = override || (PROPERTY_PARAM === 'loct'
    ? { shape: 'loct' }
    : (PROPERTY_PARAM
      ? { param: PROPERTY_PARAM, array: PROPERTY_PARAM_IS_ARRAY, prefixed: PROPERTY_PARAM_PREFIXED }
      : null));
  if (!code || !spec) return null;
  // The documented shape names the property by NAME, so without one there is
  // nothing to send. Returning null makes the caller skip rather than fire a
  // search that would come back as the whole city.
  // Both name-based anchors need a name. Without one there is nothing to
  // anchor on, and a nameless ask would come back as the whole country, so
  // skip rather than guess.
  if ((spec.shape === 'loct' || spec.shape === 'deeplink') && !name) return null;
  if (!spec.shape && !spec.param) return null;
  const value = spec.prefixed ? 'TTI:' + code : code;
  let anchor;
  if (spec.shape === 'deeplink') {
    // Every part of the anchor a live Travelify deep link carries, together.
    anchor = {
      loc: name,
      loct: 'Property',
      ...(ctry ? { ctry } : {}),
      ...(lat != null && lng != null ? { lat, lng, rad: 1 } : {}),
      refn: 'TTI:' + code,
    };
  } else if (spec.shape === 'loct') {
    anchor = { loc: name, loct: 'Property', ...(ctry ? { ctry } : {}) };
  } else {
    anchor = { [spec.param]: spec.array ? [value] : value };
  }
  const payload = {
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
    ...(search.origins && search.origins.length ? { origins: search.origins } : {}),
    ...anchor,
  };
  return payload;
}

/** THE VERIFY GATE. Does this normalised offer actually belong to the property
 *  we asked for? Travelify ignores parameters it does not recognise, so a wrong
 *  TTI_PROPERTY_PARAM returns a full page of unrelated inventory with a 200.
 *  Without this check that inventory would be stored under the client's hotel
 *  and their widget would fill with somebody else's rooms. */
export function offerIsProperty(offer, code) {
  return canonTti(offer && offer.accommodationUniqueRef) === code;
}

