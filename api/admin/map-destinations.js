/**
 * /api/admin/map-destinations
 *
 * Manage the MapSearches table that feeds the World Map cron, plus surface the
 * live offer counts per destination so the operator can see what's actually
 * being returned (and which destinations poll nothing).
 *
 * Methods (all admin-gated):
 *   GET    → list all destinations, each joined with offerCount / airportCount /
 *            cheapestPP from the cached summary (map:offers:v1), plus lastRunAt.
 *   POST   → create a destination { countryCode, airports, region, datesMin?, datesMax? }
 *   PATCH  → update a destination { id, ...fields }
 *   DELETE → remove a destination { id }
 *
 * Security: requireAdmin (auth + admin allow-list); Airtable PAT stays server
 * side; inputs validated + length-capped; no '*' CORS; no-store.
 *
 * Env: AIRTABLE_KEY, AIRTABLE_BASE_ID (defaults to TG Widgets base),
 *      KV/Redis REST creds (same as the cron uses) for the summary read.
 */
import { requireAdmin, setAdminCors } from './_guard.js';

const AIRTABLE_API = 'https://api.airtable.com/v0';
const BASE_ID = process.env.AIRTABLE_BASE_ID || 'appAYzWZxvK6qlwXK';
const MAPSEARCHES_TABLE = 'tblrI1BihuDcpoV1A';

// MapSearches field IDs (locked in prior sessions).
const F = {
  countryCode: 'fldie7SBUJQ6GkxMR',
  airports:    'fld2rU8YDoiCUeRFy',
  region:      'fldUW6lZA8fLAuIEg',
  datesMin:    'fldmMohQbphR3MkBv',
  datesMax:    'fldRhDq6GDvXBoGTB',
  // Fields the cron also relies on — were previously NOT written on create,
  // which left dashboard-added countries invisible to the sweep (Enabled
  // unticked) and under-specified (no Name / AppId / MaxOffers / Type).
  name:        'fldLYWrF0S1H9MNoh', // primary text — the display name
  country:     'fldgjDRDYDWuCX4Kc', // second name field shown as the "Country" column
  lat:         'fldM6fwLEUTvs4IHL', // number — reference latitude (map plots from offer coords, not this)
  lng:         'flddZOPaWEkBVBAj9', // number — reference longitude
  enabled:     'fld03385gehh0UjGD', // checkbox — cron filters on {Enabled}=TRUE()
  appId:       'fld6G0QyB5eWVvH6n', // text — buildPayload reads f.AppId
  type:        'fldFP3tVEaGPDCyRg', // singleSelect — buildPayload reads f.Type ('Packages')
  maxOffers:   'fldjkrF91EeKXUnnB', // number — buildPayload reads f.MaxOffers
};

// Sensible defaults for a new destination so the cron can poll it immediately.
const DEFAULT_APP_ID = '250';
const DEFAULT_TYPE = 'Packages';
const DEFAULT_MAX_OFFERS = 250;
const DEFAULT_DATES_MIN = 1;
const DEFAULT_DATES_MAX = 700;

const VALID_REGIONS = ['Europe', 'Africa', 'Middle East', 'Asia', 'Americas', 'Oceania'];

// Resolve a country code to a display name for the Name field. Uses the
// platform Intl data where available (Node 18+ has full ICU), falling back to
// the raw code so a row always gets a sensible Name even for edge cases.
function countryName(cc) {
  try {
    const dn = new Intl.DisplayNames(['en'], { type: 'region' });
    const name = dn.of(cc);
    return name && name !== cc ? name : cc;
  } catch {
    return cc;
  }
}

function airtableHeaders() {
  const key = process.env.AIRTABLE_KEY;
  if (!key) throw new Error('AIRTABLE_KEY not configured');
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

// ── Validation helpers ──────────────────────────────────────────
function cleanCC(v) {
  const s = String(v || '').toUpperCase().trim();
  return /^[A-Z]{2}$/.test(s) ? s : null;            // ISO-3166 alpha-2 only
}
function cleanAirports(v) {
  // Accept "RAK,AGA" or ["RAK","AGA"] → normalised "RAK,AGA" (IATA = 3 letters).
  const arr = Array.isArray(v) ? v : String(v || '').split(',');
  const codes = arr
    .map(s => String(s).toUpperCase().trim())
    .filter(s => /^[A-Z]{3}$/.test(s));
  // de-dupe, cap at 30 to stop someone stuffing the cell
  return [...new Set(codes)].slice(0, 30).join(',');
}
function cleanRegion(v) {
  const s = String(v || '').trim();
  return VALID_REGIONS.includes(s) ? s : null;
}
function cleanDays(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 800 ? Math.round(n) : undefined; // undefined = invalid
}
function cleanMaxOffers(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  // Travelify caps per request; keep between 1 and 250.
  return Number.isFinite(n) && n >= 1 && n <= 250 ? Math.round(n) : undefined;
}
function cleanLat(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= -90 && n <= 90 ? n : undefined;
}
function cleanLng(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= -180 && n <= 180 ? n : undefined;
}

// ── Summary (offer counts) read ─────────────────────────────────
// Reads the live summary from the existing public endpoint /api/destination-map-offers
// (proven, already serving map:offers:v1 with per-country offerCount / airportCount /
// fromPricePP / region). Using this avoids re-deriving Redis credentials here and
// reuses a known-good path. Degrades gracefully: if it fails, counts come back null
// and the dashboard still lists destinations.
async function readSummaryCounts(req) {
  try {
    const base = process.env.SITE_URL
      ? process.env.SITE_URL.replace(/\/$/, '')
      : (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}`
        : `https://${req.headers['x-forwarded-host'] || req.headers.host || 'tg-widgets.vercel.app'}`);
    const r = await fetch(`${base}/api/destination-map-offers?_cb=${Date.now()}`, {
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (!r.ok) return { byCC: {}, airportsByCC: {}, lastRunAt: null };
    const summary = await r.json();
    const byCC = {};
    const countries = summary && Array.isArray(summary.countries) ? summary.countries : [];
    for (const c of countries) {
      const cc = String(c.countryCode || '').toUpperCase();
      if (cc) byCC[cc] = {
        offerCount: c.offerCount ?? null,
        airportCount: c.airportCount ?? null,
        cheapestPP: c.fromPricePP ?? null,
        currency: c.currency || null,
      };
    }
    // Group the per-airport summary by country so the dashboard can show a
    // breakdown of which destination airports returned offers, and how many.
    // The cron writes summary.airports[] as:
    //   { airport, airportName, countryCode, fromPricePP, currency, offerCount, ... }
    const airportsByCC = {};
    const airports = summary && Array.isArray(summary.airports) ? summary.airports : [];
    for (const a of airports) {
      const cc = String(a.countryCode || '').toUpperCase();
      if (!cc) continue;
      if (!airportsByCC[cc]) airportsByCC[cc] = [];
      airportsByCC[cc].push({
        iata: String(a.airport || '').toUpperCase(),
        airportName: a.airportName || null,
        offerCount: a.offerCount ?? 0,
        fromPricePP: a.fromPricePP ?? null,
        currency: a.currency || null,
      });
    }
    return { byCC, airportsByCC, lastRunAt: summary.lastRunAt || summary.refreshedAt || null };
  } catch {
    return { byCC: {}, airportsByCC: {}, lastRunAt: null };
  }
}

// ── Handlers ─────────────────────────────────────────────────────
async function listDestinations(req, res) {
  const headers = airtableHeaders();
  const url = `${AIRTABLE_API}/${BASE_ID}/${MAPSEARCHES_TABLE}`
    + `?pageSize=100&returnFieldsByFieldId=true`;
  const [rowsResp, counts] = await Promise.all([
    fetch(url, { headers }),
    readSummaryCounts(req),
  ]);
  if (!rowsResp.ok) {
    const body = await rowsResp.text().catch(() => '');
    return res.status(502).json({ error: `Airtable list failed (${rowsResp.status})`, detail: body.slice(0, 200) });
  }
  const data = await rowsResp.json();
  const destinations = (data.records || []).map(rec => {
    const cc = String(rec.fields?.[F.countryCode] || '').toUpperCase();
    const live = counts.byCC[cc] || {};
    const breakdown = (counts.airportsByCC && counts.airportsByCC[cc]) || [];
    const airportsStr = String(rec.fields?.[F.airports] || '');
    return {
      id: rec.id,
      countryCode: cc,
      name: rec.fields?.[F.name] || null,
      enabled: rec.fields?.[F.enabled] === true,
      maxOffers: rec.fields?.[F.maxOffers] ?? null,
      appId: rec.fields?.[F.appId] || null,
      lat: rec.fields?.[F.lat] ?? null,
      lng: rec.fields?.[F.lng] ?? null,
      airports: airportsStr ? airportsStr.split(',').map(s => s.trim()).filter(Boolean) : [],
      region: rec.fields?.[F.region] || null,
      datesMin: rec.fields?.[F.datesMin] ?? null,
      datesMax: rec.fields?.[F.datesMax] ?? null,
      // live offer stats (null if not yet polled / store unreachable)
      offerCount: live.offerCount ?? null,
      airportCountLive: live.airportCount ?? null,
      cheapestPP: live.cheapestPP ?? null,
      currency: live.currency ?? null,
      // per-airport breakdown for the dashboard expand-row (empty if none)
      airportBreakdown: breakdown,
    };
  }).sort((a, b) => (a.region || '').localeCompare(b.region || '') || a.countryCode.localeCompare(b.countryCode));

  return res.status(200).json({ ok: true, destinations, lastRunAt: counts.lastRunAt });
}

async function createDestination(req, res) {
  const b = req.body || {};
  const cc = cleanCC(b.countryCode);
  const region = cleanRegion(b.region);
  if (!cc) return res.status(400).json({ error: 'A valid 2-letter country code is required.' });
  if (!region) return res.status(400).json({ error: 'A valid region is required.' });
  const airports = cleanAirports(b.airports);
  let datesMin = cleanDays(b.datesMin);
  let datesMax = cleanDays(b.datesMax);
  if (datesMin === undefined || datesMax === undefined) return res.status(400).json({ error: 'Date windows must be numbers between 0 and 800.' });
  // Default the departure window if the operator left it blank, so the row is
  // always pollable. (Previously a blank window produced a row the cron could
  // not use sensibly.)
  if (datesMin == null) datesMin = DEFAULT_DATES_MIN;
  if (datesMax == null) datesMax = DEFAULT_DATES_MAX;

  // Optional overrides; otherwise fall back to the platform defaults.
  const appId = b.appId ? String(b.appId).trim().slice(0, 20) : DEFAULT_APP_ID;
  let maxOffers = cleanMaxOffers(b.maxOffers);
  if (maxOffers === undefined) return res.status(400).json({ error: 'Max offers must be a number between 1 and 250.' });
  if (maxOffers == null) maxOffers = DEFAULT_MAX_OFFERS;
  const name = b.name ? String(b.name).trim().slice(0, 60) : countryName(cc);
  const lat = cleanLat(b.lat);
  const lng = cleanLng(b.lng);
  if (lat === undefined) return res.status(400).json({ error: 'Latitude must be between -90 and 90.' });
  if (lng === undefined) return res.status(400).json({ error: 'Longitude must be between -180 and 180.' });

  // Write the COMPLETE field set the cron relies on. The critical addition is
  // Enabled=true — without it the cron's {Enabled}=TRUE() filter skips the row
  // entirely, which is why dashboard-added countries never returned offers.
  const fields = {
    [F.countryCode]: cc,
    [F.region]: region,
    [F.name]: name,
    [F.country]: name,
    [F.enabled]: true,
    [F.appId]: appId,
    [F.type]: DEFAULT_TYPE,
    [F.maxOffers]: maxOffers,
    [F.datesMin]: datesMin,
    [F.datesMax]: datesMax,
  };
  if (airports) fields[F.airports] = airports;
  if (lat != null) fields[F.lat] = lat;
  if (lng != null) fields[F.lng] = lng;

  const resp = await fetch(`${AIRTABLE_API}/${BASE_ID}/${MAPSEARCHES_TABLE}`, {
    method: 'POST',
    headers: airtableHeaders(),
    body: JSON.stringify({ records: [{ fields }], typecast: true }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    return res.status(502).json({ error: `Create failed (${resp.status})`, detail: body.slice(0, 200) });
  }
  const data = await resp.json();
  return res.status(201).json({ ok: true, id: data.records?.[0]?.id || null, name, enabled: true });
}

async function updateDestination(req, res) {
  const b = req.body || {};
  const id = String(b.id || '');
  if (!/^rec[A-Za-z0-9]{14}$/.test(id)) return res.status(400).json({ error: 'A valid record id is required.' });

  const fields = {};
  if (b.countryCode !== undefined) {
    const cc = cleanCC(b.countryCode);
    if (!cc) return res.status(400).json({ error: 'Invalid country code.' });
    fields[F.countryCode] = cc;
  }
  if (b.region !== undefined) {
    const region = cleanRegion(b.region);
    if (!region) return res.status(400).json({ error: 'Invalid region.' });
    fields[F.region] = region;
  }
  if (b.airports !== undefined) fields[F.airports] = cleanAirports(b.airports);
  if (b.datesMin !== undefined) {
    const d = cleanDays(b.datesMin);
    if (d === undefined) return res.status(400).json({ error: 'Invalid datesMin.' });
    fields[F.datesMin] = d;
  }
  if (b.datesMax !== undefined) {
    const d = cleanDays(b.datesMax);
    if (d === undefined) return res.status(400).json({ error: 'Invalid datesMax.' });
    fields[F.datesMax] = d;
  }
  if (b.maxOffers !== undefined) {
    const m = cleanMaxOffers(b.maxOffers);
    if (m === undefined) return res.status(400).json({ error: 'Max offers must be a number between 1 and 250.' });
    if (m != null) fields[F.maxOffers] = m;
  }
  if (b.name !== undefined) {
    const nm = String(b.name).trim().slice(0, 60);
    fields[F.name] = nm;
    fields[F.country] = nm;
  }
  if (b.appId !== undefined) fields[F.appId] = String(b.appId).trim().slice(0, 20);
  if (b.enabled !== undefined) fields[F.enabled] = b.enabled === true || b.enabled === 'true';
  if (b.lat !== undefined) {
    const v = cleanLat(b.lat);
    if (v === undefined) return res.status(400).json({ error: 'Latitude must be between -90 and 90.' });
    if (v != null) fields[F.lat] = v;
  }
  if (b.lng !== undefined) {
    const v = cleanLng(b.lng);
    if (v === undefined) return res.status(400).json({ error: 'Longitude must be between -180 and 180.' });
    if (v != null) fields[F.lng] = v;
  }
  if (!Object.keys(fields).length) return res.status(400).json({ error: 'No valid fields to update.' });

  const resp = await fetch(`${AIRTABLE_API}/${BASE_ID}/${MAPSEARCHES_TABLE}`, {
    method: 'PATCH',
    headers: airtableHeaders(),
    body: JSON.stringify({ records: [{ id, fields }], typecast: true }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    return res.status(502).json({ error: `Update failed (${resp.status})`, detail: body.slice(0, 200) });
  }
  return res.status(200).json({ ok: true });
}

async function deleteDestination(req, res) {
  const id = String((req.body && req.body.id) || req.query.id || '');
  if (!/^rec[A-Za-z0-9]{14}$/.test(id)) return res.status(400).json({ error: 'A valid record id is required.' });
  const resp = await fetch(`${AIRTABLE_API}/${BASE_ID}/${MAPSEARCHES_TABLE}?records[]=${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: airtableHeaders(),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    return res.status(502).json({ error: `Delete failed (${resp.status})`, detail: body.slice(0, 200) });
  }
  return res.status(200).json({ ok: true });
}

export default async function handler(req, res) {
  setAdminCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const gate = requireAdmin(req);
  if (gate.error) return res.status(gate.status).json({ error: gate.error });

  try {
    switch (req.method) {
      case 'GET':    return await listDestinations(req, res);
      case 'POST':   return await createDestination(req, res);
      case 'PATCH':  return await updateDestination(req, res);
      case 'DELETE': return await deleteDestination(req, res);
      default:
        res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (e) {
    console.error('[admin/map-destinations]', e.message);
    return res.status(500).json({ error: 'Server error' });
  }
}
