/**
 * /api/airport-content.js
 * ----------------------------------------------------------------
 * Server-side airport content endpoint for the Airport Spotlight widget.
 *
 * Public endpoint. Read-only. Hardened against the threat model:
 *   - No client-side keys (PAT held in server env only)
 *   - Rate limited per IP (60/min)
 *   - CORS: Access-Control-Allow-Origin echoes the request origin
 *   - Method-checked (GET only)
 *   - widgetId / recordId validated (record-id shape)
 *   - iata clamped to 3 uppercase letters
 *   - All Airtable values sanitised before going into the response
 *   - Generic 500s to client; detailed errors logged server-side
 *
 * Modes:
 *   ?widgetId=tgw_... | recXXX → look up saved widget config, fetch airport. The
 *                                live widget sends its PUBLIC WidgetID (data-tg-id);
 *                                a rec id also works (editor / direct).
 *   ?iata=DLM                  → direct fetch by IATA (editor preview, public)
 *   ?recordId=recXXXXX         → direct fetch by Airport record id (editor preview)
 *
 * Response shape: see Airport interface emitted by buildAirportPayload below.
 *
 * Module system: ESM. Originally drafted as CommonJS; Vercel's ESM-default
 * Node runtime silently dropped the function from the manifest, returning
 * 404 NOT_FOUND for every call. Same fix as airport-search.js.
 */

// --- Environment ---------------------------------------------------
import {
  isServableAirportStatus, airportDepth, toIdentityCard, AIRPORT_DEPTH,
} from './_lib/airport-status.js';

const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const DESTINATION_BASE_ID = process.env.DESTINATION_CONTENT_BASE_ID || 'appuZdlMJ7HKUt6qS';
const WIDGETS_BASE_ID = process.env.AIRTABLE_BASE_ID || 'appAYzWZxvK6qlwXK';

const AIRPORTS_TABLE_ID  = 'tblI2iVAbIGCtsGa7';
const CITIES_TABLE_ID    = 'tblTkKujdVZgWPAQe';
const RESORTS_TABLE_ID   = 'tblwV9gnbVEyZ99gI';
const COUNTRIES_TABLE_ID = 'tblsxbqbyhTDoWhbo';
const WIDGETS_TABLE_ID   = 'tblVAThVqAjqtria2';
// "Config" on the Widgets table. Read by field ID because airtableGet forces
// returnFieldsByFieldId=true, so widget.fields['Config'] (by name) is undefined.
const WIDGET_CONFIG_FIELD = 'fldSLN8AteAGB7qE1';

const AIRTABLE_API = 'https://api.airtable.com/v0';

// --- Rate limiter (in-memory, per-instance) ------------------------
const RATE_LIMIT = { window: 60_000, max: 60 };
const _rateBuckets = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const fresh = (_rateBuckets.get(ip) || []).filter(t => now - t < RATE_LIMIT.window);
  fresh.push(now);
  _rateBuckets.set(ip, fresh);
  if (_rateBuckets.size > 5000) {
    const cutoff = now - RATE_LIMIT.window;
    for (const [k, v] of _rateBuckets) {
      if (!v.length || v[v.length - 1] < cutoff) _rateBuckets.delete(k);
    }
  }
  return fresh.length > RATE_LIMIT.max;
}

// --- Validation helpers --------------------------------------------
function isRecordId(s) { return typeof s === 'string' && /^rec[A-Za-z0-9]{14}$/.test(s); }
function isIata(s)     { return typeof s === 'string' && /^[A-Z]{3}$/.test(s.trim().toUpperCase()); }

// --- Airtable HTTP helper ------------------------------------------
async function airtableGet(baseId, path, params) {
  if (!AIRTABLE_KEY) throw new Error('AIRTABLE_KEY env missing');
  // Always request field-ID-keyed payloads. Default Airtable REST response
  // keys rec.fields by field NAME, but the rest of this file looks up values
  // by field ID via the AF/CF/RF catalogues. Without this flag every fld()
  // lookup returns undefined, and the response comes back with every field
  // empty even though the record exists.
  const allParams = Object.assign({ returnFieldsByFieldId: 'true' }, params || {});
  const qs = '?' + new URLSearchParams(allParams).toString();
  const url = AIRTABLE_API + '/' + baseId + '/' + path + qs;
  // Bound the Airtable call so a slow upstream returns a clean error instead of
  // hanging the function to its ceiling and emitting an empty gateway body (the
  // "Failed to fetch" class, 23 Jul 2026 audit).
  const res = await fetch(url, {
    headers: { 'Authorization': 'Bearer ' + AIRTABLE_KEY },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error('Airtable ' + res.status + ' ' + path + ' :: ' + body.slice(0, 200));
  }
  return res.json();
}

async function airtableGetRecord(baseId, tableId, recordId) {
  if (!isRecordId(recordId)) throw new Error('Bad recordId: ' + recordId);
  return airtableGet(baseId, tableId + '/' + recordId);
}

// --- Sanitisation helpers ------------------------------------------
function stripHtml(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/<[^>]*>/g, '').trim();
}

function txt(v) {
  if (v == null) return '';
  return stripHtml(String(v));
}

function safeUrl(v) {
  if (typeof v !== 'string') return '';
  const t = v.trim();
  if (!t) return '';
  if (/^https?:\/\//i.test(t)) return t;
  return '';
}

function sanitiseForFormula(s) {
  return String(s == null ? '' : s).replace(/'/g, "\\'");
}

// --- Field-id catalogue --------------------------------------------
// Airports table — all 42 fields the widget reads or might reference
const AF = {
  // Identity
  name:          'fldlT6eApAdQHGYED',
  status:        'fldjvujj14Q9QNLLq',
  iata:          'fldcS9uu4NWMVaIVP',
  cityServed:    'fldgrJ2uFjzPcAxUx',
  countryText:   'fldjARk52dZi7TGGc',
  countryLink:   'fldgKdhZAfFypwzG7',
  cityLink:      'fldr0AX8YRtgyKZy6',
  lat:           'fldXZKuycZOgJScSj',
  lng:           'fldRG7pc5iPJPzhEI',
  role:          'fldUSTC6kdgXNgKfI',
  type:          'fldZNl5eveKEDN2Xu',

  // Editorial — added May 2026
  tagline:         'fldxsl1xMOzqVZ73f',
  overviewHeading: 'fldhRMZGWOuFzJj8F',
  heroImageUrl:    'fld4wWA0oIapvQjUX',

  // Editorial — pre-existing
  overview:      'fldmRELkLWrUGL5Ss',
  terminals:     'fldoJm0H4vTRLuJlL',

  // Facts tiles — added May 2026
  terminalsCount:   'fldfSxpXvB0yekaZ6',
  terminalsNote:    'fldjo3UdWlxCOs2wR',
  keyAirlines:      'fldNgOhaOVda2mXBk',
  keyAirlinesNote:  'fld3E939AixkR39hb',
  flightTimeFromUK: 'fldnqWFQ5fykmZ5Ci',
  flightTimeNote:   'fldsvod5EoGW065jr',
  checkInSummary:   'flduxMfqCmFrnvifO',
  checkInDetail:    'fld4EcCowfm6XaSzc',

  // Facts tiles — pre-existing
  distance:         'fldk6vN66c33umyEP',
  arrival:          'fldIPVLmhkvQR39Dz',
  hasLounges:       'fldglZFSMJTSIZTJ7',
  hasFastTrack:     'fld2SHkFoj7cErSiL',

  // Origin-mode tabs — pre-existing
  byCar:            'fldRVYMNcYeBJJ4vC',
  byTrain:          'fld9lb4Zzp40PsVmq',
  byCoach:          'fldv9urpL8JP6PmCw',
  taxiRide:         'flduHqBj7hcAvIVjs',
  dropOff:          'fldKSgegnHPllWRIJ',
  parking:          'fldoKcDvovYdGvxqy',

  // Destination-mode tabs — added May 2026
  transferInfo: 'fldWYLoYJUtI5kXcM',
  carHireInfo:  'fldiBHm8Z6AVcKWDD',
  taxiInfo:     'fldOTMuwQ2e9VGxpb',
  coachInfo:    'fld69Zr1DDw7nNIIx',

  // Facility cards
  lounges:          'fldkq66823wiLYMoK',
  eatShop:          'fldhYDGrBJC6DL9og',
  family:           'fldVzj8DMHrKbeSzO',
  assist:           'fld2FqwMdLj3UYVbv',
  hotels:           'fld2deWhxd3PA1KHw',

  // Tips & sources
  quirks:           'flda3DUGpxz2m54Lx',
  tips:             'fldrf2gm0skVmW7bX',
  officialUrl:      'fldkrScmky7HhnD0r',
  wikiUrl:          'fldRqtt44nsacJCwq',
  source1:          'fldEVfcn75Tm0u0Es',
  source2:          'flds3csPG5slNZgKX',
  verifiedDate:     'fldRCo83Wz1AFZXwP',
};

const CF = { // Cities and Regions
  name: 'fld2VkY61c1JKUWKB',
  slug: 'fldL6MlFZgZMW25Vp',
  lat1: 'fldLDQj6e1K4lq3tT',   // newer field
  lng1: 'fld2pa6AKkU6dIq7O',
  lat2: 'fldjk3yUCbVQRuxx8',   // older fallback
  lng2: 'fldNSlAA0Qb1akknz',
};

const RF = { // Resorts and Areas
  name:     'fldnvOipaWpG3W1rx',
  slug:     'fldwVxLg8V4CBi90B',
  lat1:     'flda4Fa7bBj6Nf850',
  lng1:     'fldpXXwrWplV7DiKN',
  lat2:     'fld4INRwIKWCG21RV',
  lng2:     'fldd8CwfdzCDhW68w',
  cityLink: 'fldrUx3VrEMJPheIP',
};

// --- Field extraction helpers --------------------------------------
function fld(rec, id) { return rec && rec.fields ? rec.fields[id] : undefined; }

function fldNum(rec, id) {
  const v = fld(rec, id);
  if (v == null || v === '') return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

function fldSelect(rec, id) {
  const v = fld(rec, id);
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && v.name) return String(v.name);
  return '';
}

function recCoords(rec, latIds, lngIds) {
  for (let i = 0; i < latIds.length; i++) {
    const a = fldNum(rec, latIds[i]);
    const b = fldNum(rec, lngIds[i]);
    if (a != null && b != null) return { lat: a, lng: b };
  }
  return { lat: null, lng: null };
}

// --- URL builders for linked records -------------------------------
function resortUrl(slug) { return slug ? '/destinations/resorts/' + encodeURIComponent(slug) : ''; }
function cityUrl(slug)   { return slug ? '/destinations/cities/'  + encodeURIComponent(slug) : ''; }

// --- Build the public-facing airport object ------------------------
async function buildAirportPayload(airportRec) {
  // Role normalisation — clamp to one of three values
  const rawRole = fldSelect(airportRec, AF.role).toLowerCase();
  let role = 'origin';
  if (rawRole === 'both') role = 'both';
  else if (rawRole.includes('destination')) role = 'destination';

  // Pull linked cities and (for destination airports) each city's resorts
  const cityLinkIds = (fld(airportRec, AF.cityLink) || []).filter(isRecordId);
  let cities = [];
  let resorts = [];
  let cityLat = null, cityLng = null;

  if (cityLinkIds.length) {
    const cityRecs = await Promise.all(
      cityLinkIds.map(id =>
        airtableGetRecord(DESTINATION_BASE_ID, CITIES_TABLE_ID, id)
          .catch(err => {
            console.error('[airport-content] city fetch failed', id, err.message);
            return null;
          })
      )
    );

    for (const c of cityRecs.filter(Boolean)) {
      const coords = recCoords(c, [CF.lat1, CF.lat2], [CF.lng1, CF.lng2]);
      const name = txt(fld(c, CF.name));
      const slug = txt(fld(c, CF.slug));
      if (!name) continue;
      cities.push({
        name, slug,
        url: cityUrl(slug),
        lat: coords.lat,
        lng: coords.lng,
      });
      // For origin airports we use the first linked city as "city centre" pin
      if (cityLat == null && coords.lat != null) {
        cityLat = coords.lat;
        cityLng = coords.lng;
      }

      // For destination airports, also collect the resorts under each city
      if (role === 'destination' || role === 'both') {
        try {
          const resortQuery = await airtableGet(
            DESTINATION_BASE_ID,
            RESORTS_TABLE_ID,
            {
              filterByFormula: "FIND('" + sanitiseForFormula(c.id) + "', ARRAYJOIN({City/Region}))",
              pageSize: '20',
            }
          );
          for (const r of (resortQuery.records || [])) {
            const rcoords = recCoords(r, [RF.lat1, RF.lat2], [RF.lng1, RF.lng2]);
            const rname = txt(fld(r, RF.name));
            const rslug = txt(fld(r, RF.slug));
            if (!rname) continue;
            resorts.push({
              name: rname,
              slug: rslug,
              url: resortUrl(rslug),
              lat: rcoords.lat,
              lng: rcoords.lng,
              // transferMinutes lives on the airport-resort pair, not the
              // resort itself. v1 omits — widget hides gracefully if absent.
              transferMinutes: null,
            });
          }
        } catch (err) {
          console.error('[airport-content] resort fetch failed for city', c.id, err.message);
        }
      }
    }
  }

  const lat = fldNum(airportRec, AF.lat);
  const lng = fldNum(airportRec, AF.lng);

  return {
    // Verification state. A record that is not yet servable (identity-only
    // skeleton, or narrative written but not audited against two sources) is
    // still returned, because refusing it would break embeds that are already
    // live on client sites. The flag lets the widget render a compact card
    // instead of a full spotlight with empty sections. See
    // api/_lib/airport-status.js and docs/airport-data-plan.md.
    provisional: !isServableAirportStatus(fldSelect(airportRec, AF.status)),

    // Identity
    name:       txt(fld(airportRec, AF.name)),
    iata:       txt(fld(airportRec, AF.iata)).toUpperCase(),
    role,
    type:       txt(fldSelect(airportRec, AF.type)),
    cityServed: txt(fld(airportRec, AF.cityServed)),
    country:    txt(fld(airportRec, AF.countryText)),

    // Editorial
    tagline:         txt(fld(airportRec, AF.tagline)),
    overview:        txt(fld(airportRec, AF.overview)),
    overviewHeading: txt(fld(airportRec, AF.overviewHeading)),
    heroImageUrl:    safeUrl(fld(airportRec, AF.heroImageUrl)),

    // Coordinates
    lat, lng,
    cityLat, cityLng,

    // Facts tiles
    distanceToCity:   txt(fld(airportRec, AF.distance)),
    driveTimeSummary: '',
    terminalsCount:   fldNum(airportRec, AF.terminalsCount),
    terminalsNote:    txt(fld(airportRec, AF.terminalsNote)),
    terminalsAndAirlines: txt(fld(airportRec, AF.terminals)),
    keyAirlines:      txt(fld(airportRec, AF.keyAirlines)),
    keyAirlinesNote:  txt(fld(airportRec, AF.keyAirlinesNote)),
    flightTimeFromUK: txt(fld(airportRec, AF.flightTimeFromUK)),
    flightTimeNote:   txt(fld(airportRec, AF.flightTimeNote)),
    checkInSummary:   txt(fld(airportRec, AF.checkInSummary)),
    checkInDetail:    txt(fld(airportRec, AF.checkInDetail)),
    recommendedArrival: txt(fld(airportRec, AF.arrival)),
    hasLounges:   !!fld(airportRec, AF.hasLounges),
    hasFastTrack: !!fld(airportRec, AF.hasFastTrack),

    // Origin-mode tabs
    gettingThereByTrain: txt(fld(airportRec, AF.byTrain)),
    gettingThereByCar:   txt(fld(airportRec, AF.byCar)),
    gettingThereByCoach: txt(fld(airportRec, AF.byCoach)),
    taxiAndRideshare:    txt(fld(airportRec, AF.taxiRide)),
    parking:             txt(fld(airportRec, AF.parking)),
    dropOffInfo:         txt(fld(airportRec, AF.dropOff)),

    // Destination-mode tabs
    transferInfo: txt(fld(airportRec, AF.transferInfo)),
    carHireInfo:  txt(fld(airportRec, AF.carHireInfo)),
    taxiInfo:     txt(fld(airportRec, AF.taxiInfo)),
    coachInfo:    txt(fld(airportRec, AF.coachInfo)),

    // Facility cards
    loungesInfo: txt(fld(airportRec, AF.lounges)),
    eatShopInfo: txt(fld(airportRec, AF.eatShop)),
    familyInfo:  txt(fld(airportRec, AF.family)),
    assistInfo:  txt(fld(airportRec, AF.assist)),
    hotelsInfo:  txt(fld(airportRec, AF.hotels)),

    // Tips & sources
    tips:            txt(fld(airportRec, AF.quirks)),
    usefulTips:      txt(fld(airportRec, AF.tips)),
    officialWebsite: safeUrl(fld(airportRec, AF.officialUrl)),

    // Linked content
    resorts,
    cities,
  };
}

// --- Look up airport by IATA ----------------------------------------
async function findAirportByIata(iata) {
  const code = iata.trim().toUpperCase();
  const data = await airtableGet(DESTINATION_BASE_ID, AIRPORTS_TABLE_ID, {
    filterByFormula: "{IATA Code}='" + sanitiseForFormula(code) + "'",
    pageSize: '1',
  });
  return (data.records && data.records[0]) || null;
}

// Resolve the Widgets record from EITHER the public WidgetID (tgw_...) that the
// live widget sends via data-tg-id, OR an Airtable record id (editor / direct).
// The public WidgetID is looked up via {WidgetID} like /api/widget-config does;
// a rec id still resolves by getRecord. Previously this only accepted a rec id,
// so every live embed (which sends the public WidgetID) was rejected 400 and
// showed "Could not load airport details".
async function getWidgetRecord(widgetIdOrRecId) {
  if (isRecordId(widgetIdOrRecId)) {
    return airtableGetRecord(WIDGETS_BASE_ID, WIDGETS_TABLE_ID, widgetIdOrRecId);
  }
  const data = await airtableGet(WIDGETS_BASE_ID, WIDGETS_TABLE_ID, {
    filterByFormula: "{WidgetID}='" + sanitiseForFormula(widgetIdOrRecId) + "'",
    maxRecords: '1',
  });
  return (data.records && data.records[0]) || null;
}

// --- Look up airport via saved widget config ------------------------
async function findAirportFromWidget(widgetId) {
  const widget = await getWidgetRecord(widgetId);
  if (!widget || !widget.fields) return null;
  // Read Config by FIELD ID — airtableGet returns id-keyed fields, so reading
  // widget.fields['Config'] by name silently returned undefined (a second reason
  // this path never worked).
  const configRaw = widget.fields[WIDGET_CONFIG_FIELD];
  if (!configRaw) return null;
  let cfg;
  try { cfg = JSON.parse(configRaw); }
  catch (e) { return null; }
  if (!cfg || typeof cfg !== 'object') return null;

  const ref = cfg.airport || {};
  if (ref.recordId && isRecordId(ref.recordId)) {
    return airtableGetRecord(DESTINATION_BASE_ID, AIRPORTS_TABLE_ID, ref.recordId);
  }
  if (ref.iata && isIata(ref.iata)) {
    return findAirportByIata(ref.iata);
  }
  return null;
}

// --- Main handler ----------------------------------------------------
export default async function handler(req, res) {
  // Method check
  if (req.method !== 'GET' && req.method !== 'OPTIONS') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // CORS — echo origin
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin === '*' ? '*' : origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();

  // Rate limit
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
             req.headers['x-real-ip'] || 'unknown';
  if (rateLimited(ip)) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }

  // CDN cache. Editorial airport content changes rarely and the live widget
  // path (widgetId) used to make a visitor wait on an Airtable lookup, so it is
  // now cached hard at the edge: fresh 1h, then served stale for a week while it
  // revalidates. The direct iata/recordId modes are the editor preview and demo
  // page, kept short so an author's edit shows promptly.
  const PUBLIC_CACHE = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=604800';
  const PREVIEW_CACHE = 'public, s-maxage=300, stale-while-revalidate=1800';
  res.setHeader('Cache-Control', PREVIEW_CACHE);

  try {
    const widgetId = typeof req.query.widgetId === 'string' ? req.query.widgetId : '';
    const iata     = typeof req.query.iata     === 'string' ? req.query.iata     : '';
    const recordId = typeof req.query.recordId === 'string' ? req.query.recordId : '';

    let airportRec = null;

    if (widgetId) {
      // Accept the public WidgetID (tgw_...) the live widget sends, or a rec id.
      // Bounded charset keeps it safe for the sanitised filterByFormula lookup.
      if (!/^[\w-]{1,100}$/.test(widgetId)) return res.status(400).json({ error: 'Bad widgetId' });
      res.setHeader('Cache-Control', PUBLIC_CACHE); // live widget path → long edge cache
      airportRec = await findAirportFromWidget(widgetId);
    } else if (recordId) {
      if (!isRecordId(recordId)) return res.status(400).json({ error: 'Bad recordId' });
      airportRec = await airtableGetRecord(DESTINATION_BASE_ID, AIRPORTS_TABLE_ID, recordId);
    } else if (iata) {
      if (!isIata(iata)) return res.status(400).json({ error: 'Bad iata' });
      airportRec = await findAirportByIata(iata);
    } else {
      return res.status(400).json({ error: 'Provide widgetId, iata, or recordId' });
    }

    if (!airportRec) {
      return res.status(404).json({ found: false, error: 'Airport not found' });
    }

    // Depth is enforced here, at the only door out, rather than trusted to the
    // caller. An unaudited record is served as an identity card whatever it
    // holds, so narrative that has been written but not checked against two
    // sources cannot reach a client site by any route.
    const full = await buildAirportPayload(airportRec);
    const depth = airportDepth(fldSelect(airportRec, AF.status));
    const airport = depth === AIRPORT_DEPTH.FULL ? full : toIdentityCard(full);
    return res.status(200).json({ found: true, depth, airport });

  } catch (err) {
    console.error('[api/airport-content] Error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
