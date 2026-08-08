/**
 * /api/attraction-content.js
 * ----------------------------------------------------------------
 * Server-side content endpoint for the Attraction Spotlight widget.
 *
 * Reads the "Theme Parks and Attractions" table in the Destination Content base
 * (appuZdlMJ7HKUt6qS). Covers theme parks, resort complexes, water/aquariums and
 * cultural attractions. Read-only, public, hardened to the same posture as
 * destination-content.js and airport-content.js.
 *
 * Modes:
 *   ?id=WIDGET_ID        public widget mode. Reads the widget's saved
 *                        { attraction: { recordId } } from the Widgets table,
 *                        then fetches the attraction record.
 *   ?recordId=recXXXXX   direct fetch by Airtable record id. Used by the editor
 *                        preview and the demo page. Public, read-only, rate-limited.
 *
 * Response (when found): { found: true, attraction: { ...see shapePayload } }
 *   Not found: 404 { found: false }
 *
 * Security:
 *   - PATs are server-only. Reads the content base with AIRTABLE_DESTINATION_CONTENT_PAT
 *     (least privilege, same as destination-content). Reads the Widgets base with AIRTABLE_KEY.
 *   - Rate-limited per IP.
 *   - recordId / widgetId validated to the Airtable record-id shape.
 *   - Every value sanitised (HTML stripped, length capped, URLs allowlisted) before return.
 *   - Generic errors to the client; details logged server-side.
 *   - ESM module (Vercel's default Node runtime), matching airport-content.js.
 */

import { setCors, applyRateLimit, RATE_LIMITS } from './_auth.js';

const AIRTABLE_API = 'https://api.airtable.com/v0';
const CONTENT_BASE_ID = 'appuZdlMJ7HKUt6qS';
const ATTRACTIONS_TABLE_ID = 'tblhVDUdpwaLabDmQ';
const WIDGETS_TABLE_NAME = 'Widgets';

// Field-id catalogue for the Theme Parks and Attractions table.
const AF = {
  name:           'fldboK0kstNohXgqJ',
  status:         'fldSMqzRfIwIcodgS',
  tagline:        'fldYpnpQzBV01Ogoa',
  type:           'fld1UMHOpugpUm865',
  operator:       'flduUYklGYPVCvvfV',
  country:        'fldlx9YGIZQ797rem',
  location:       'fldyoIhTvHu2NI3gn',
  lat:            'fldxmLHlNM0GYndlb',
  lng:            'fldywVEVFPKDZgXWn',
  overview:       'fldipL05iT6Kxryfb',
  bestFor:        'fld2RxBaZGkt9yfa8',
  daysNeeded:     'flds4rCmkrt4FXl5j',
  bestTime:       'fldejcSph2rPnJ2ej',
  season:         'fldRuLLokqPdNmxbt',
  tickets:        'fldwwrUwBGkooii5u',
  priceBand:      'fldcffvJT5D2DhJwT',
  starAttractions:'fldojtl6BCSVGJka0',
  familyGuide:    'fldVMTZELNw8wwbkq',
  thrillGuide:    'fldo2JQvEqn8mCQJP',
  heightRestrict: 'fldU4NklSGLsnYSwT',
  nearestAirport: 'fldOM08zdOuuOpjBX',
  gettingThere:   'flddRZy9LxxqDyLFK',
  onSiteHotels:   'fld70c4zqzC6pYEEB',
  hasOnSiteHotels:'fld9SSaWcif4a9Id6',
  fastTrack:      'fldcmxidk5kxxlxRp',
  foodDrink:      'fldI9TGApt1G5re4T',
  accessibility:  'fldZuI9uYNODxYxYa',
  dogFriendly:    'fldB36rcwri2ITwFV',
  tourOperators:  'fldl1WwjVPaEExo5i',
  quirks:         'fldRexuVXFyEpaL98',
  combineWith:    'fldILi6fGKRzinp6C',
  officialUrl:    'fldaYcpCsTaJO5tqe',
  wikiUrl:        'fldmBLM8hKwge6s4x',
  verifiedDate:   'fld3srQgBZZYtx1LJ',
  nearbyHotels:   'fldwHd6iPpoZpc1rz',
  nearestTown:    'fldyh0d8etOmfwGIE',
};

// ---- Validation + sanitisation helpers ----
const RECORD_ID_RE = /^rec[A-Za-z0-9]{14}$/;
function isRecordId(s) { return typeof s === 'string' && RECORD_ID_RE.test(s); }

function txt(v, maxLen = 600) {
  if (v == null) return '';
  return String(v).replace(/<[^>]*>/g, '').trim().slice(0, maxLen);
}
function safeUrl(v) {
  if (typeof v !== 'string') return '';
  const t = v.trim();
  return /^https?:\/\//i.test(t) ? t.slice(0, 500) : '';
}
function selName(v) {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && typeof v.name === 'string') return v.name;
  return '';
}
function selList(v, max = 12) {
  if (!Array.isArray(v)) return [];
  return v.map(selName).map(s => txt(s, 40)).filter(Boolean).slice(0, max);
}
function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

// ---- In-memory per-instance cache ----
const memCache = new Map();
const MEM_TTL_MS = 5 * 60 * 1000;
const MEM_MAX = 500;
function memGet(key) {
  const hit = memCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > MEM_TTL_MS) { memCache.delete(key); return null; }
  return hit.data;
}
function memSet(key, data) {
  if (memCache.size > MEM_MAX) {
    const first = memCache.keys().next().value;
    if (first) memCache.delete(first);
  }
  memCache.set(key, { at: Date.now(), data });
}

// ---- Airtable fetch ----
async function airtableFetch(url, pat) {
  // Timeout so a slow Airtable returns a clean error rather than hanging the
  // function to its ceiling and emitting an empty gateway body (23 Jul 2026 audit).
  const resp = await fetch(url, { headers: { 'Authorization': `Bearer ${pat}` }, signal: AbortSignal.timeout(8000) });
  if (!resp.ok) {
    const err = new Error(`Airtable upstream ${resp.status}`);
    err.status = resp.status;
    throw err;
  }
  return resp.json();
}

async function fetchAttractionById(recordId, pat) {
  const fieldIds = Object.values(AF);
  const qs = new URLSearchParams();
  qs.append('filterByFormula', `RECORD_ID()='${recordId}'`);
  qs.append('maxRecords', '1');
  fieldIds.forEach(id => qs.append('fields[]', id));
  qs.append('returnFieldsByFieldId', 'true');
  const url = `${AIRTABLE_API}/${CONTENT_BASE_ID}/${ATTRACTIONS_TABLE_ID}?${qs.toString()}`;
  const data = await airtableFetch(url, pat);
  if (!data.records || data.records.length === 0) return null;
  return data.records[0].fields || null;
}

// Read the widget config (Widgets table, AIRTABLE_KEY) to extract { attraction:{recordId} }.
async function readWidgetConfig(widgetId, key) {
  const formula = encodeURIComponent(`{WidgetID} = '${widgetId}'`);
  const url = `${AIRTABLE_API}/${process.env.AIRTABLE_BASE_ID}/${WIDGETS_TABLE_NAME}`
    + `?filterByFormula=${formula}&maxRecords=1&fields%5B%5D=Config`;
  const resp = await fetch(url, { headers: { 'Authorization': `Bearer ${key}` }, signal: AbortSignal.timeout(8000) });
  if (!resp.ok) { const e = new Error(`Widgets fetch ${resp.status}`); e.status = resp.status; throw e; }
  const data = await resp.json();
  if (!data.records || data.records.length === 0) return null;
  try { return JSON.parse(data.records[0].fields.Config || '{}'); }
  catch { return null; }
}

// ---- Shape the public payload ----
function shapePayload(f) {
  f = f || {};
  return {
    name:            txt(f[AF.name], 120),
    tagline:         txt(f[AF.tagline], 200),
    type:            txt(selName(f[AF.type]), 60),
    operator:        txt(selName(f[AF.operator]), 80),
    country:         txt(f[AF.country], 80),
    location:        txt(f[AF.location], 120),
    lat:             num(f[AF.lat]),
    lng:             num(f[AF.lng]),

    overview:        txt(f[AF.overview], 1500),
    bestTime:        txt(f[AF.bestTime], 1200),
    season:          txt(f[AF.season], 200),
    daysNeeded:      txt(f[AF.daysNeeded], 80),
    priceBand:       txt(selName(f[AF.priceBand]), 40),
    bestFor:         selList(f[AF.bestFor], 12),

    starAttractions: txt(f[AF.starAttractions], 2000),
    familyGuide:     txt(f[AF.familyGuide], 1200),
    thrillGuide:     txt(f[AF.thrillGuide], 1200),
    heightRestrict:  txt(f[AF.heightRestrict], 800),
    accessibility:   txt(f[AF.accessibility], 1200),
    fastTrack:       txt(f[AF.fastTrack], 1200),

    tickets:         txt(f[AF.tickets], 1200),

    nearestAirport:  txt(f[AF.nearestAirport], 1500),
    gettingThere:    txt(f[AF.gettingThere], 1500),
    nearestTown:     txt(f[AF.nearestTown], 600),

    onSiteHotels:    txt(f[AF.onSiteHotels], 1500),
    hasOnSiteHotels: !!f[AF.hasOnSiteHotels],
    nearbyHotels:    txt(f[AF.nearbyHotels], 1500),

    foodDrink:       txt(f[AF.foodDrink], 1200),
    dogFriendly:     !!f[AF.dogFriendly],
    quirks:          txt(f[AF.quirks], 1500),
    combineWith:     txt(f[AF.combineWith], 1000),
    tourOperators:   txt(f[AF.tourOperators], 800),

    officialWebsite: safeUrl(f[AF.officialUrl]),
    verifiedDate:    txt(f[AF.verifiedDate], 30),
  };
}

// ---- Main handler ----
export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!applyRateLimit(res, `attraction:${getClientIp(req)}`, RATE_LIMITS.widgetRead)) return;

  const { AIRTABLE_KEY, AIRTABLE_BASE_ID, AIRTABLE_DESTINATION_CONTENT_PAT } = process.env;
  if (!AIRTABLE_KEY || !AIRTABLE_BASE_ID || !AIRTABLE_DESTINATION_CONTENT_PAT) {
    return res.status(500).json({ error: 'Server configuration error' });
  }

  // Resolve the record id from either a widget id or a direct recordId.
  let recordId = '';
  const widgetId = typeof req.query.id === 'string' ? req.query.id : '';
  const directRecord = typeof req.query.recordId === 'string' ? req.query.recordId : '';

  if (directRecord) {
    if (!isRecordId(directRecord)) return res.status(400).json({ error: 'Invalid recordId' });
    recordId = directRecord;
  } else if (widgetId) {
    if (!/^[\w-]{1,100}$/.test(widgetId)) return res.status(400).json({ error: 'Invalid widget ID' });
    let cfg;
    try { cfg = await readWidgetConfig(widgetId, AIRTABLE_KEY); }
    catch (err) { console.error('[attraction-content] widget read error:', err?.message || err); return res.status(502).json({ error: 'Upstream unavailable' }); }
    if (!cfg) return res.status(404).json({ error: 'Widget not found' });
    const ref = cfg.attraction || {};
    if (!isRecordId(ref.recordId)) return res.status(400).json({ error: 'Widget has no attraction configured' });
    recordId = ref.recordId;
  } else {
    return res.status(400).json({ error: 'Provide id or recordId' });
  }

  // Editorial content, so the public widget path (id=) is cached hard at the
  // edge (fresh 1h, then served stale for a week while revalidating) and the
  // direct recordId path (editor preview / demo) is kept short so an author's
  // edit shows promptly.
  const PUBLIC_CACHE = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=604800';
  const PREVIEW_CACHE = 'public, max-age=300, stale-while-revalidate=3600';
  const cacheHeader = directRecord ? PREVIEW_CACHE : PUBLIC_CACHE;

  // Fetch + shape (cached).
  const cacheKey = `attr:${recordId}`;
  const cached = memGet(cacheKey);
  if (cached) {
    res.setHeader('Cache-Control', cacheHeader);
    res.setHeader('X-Cache', 'HIT');
    return res.status(200).json(cached);
  }

  let fields;
  try { fields = await fetchAttractionById(recordId, AIRTABLE_DESTINATION_CONTENT_PAT); }
  catch (err) {
    console.error('[attraction-content] fetch failed', { status: err?.status, recordId });
    return res.status(502).json({ error: 'Upstream unavailable', hint: `attraction-fetch-${err?.status || 'unknown'}` });
  }
  if (!fields) return res.status(404).json({ found: false, error: 'Attraction not found' });

  const payload = { found: true, attraction: shapePayload(fields) };
  memSet(cacheKey, payload);
  res.setHeader('Cache-Control', cacheHeader);
  res.setHeader('X-Cache', 'MISS');
  return res.status(200).json(payload);
}
