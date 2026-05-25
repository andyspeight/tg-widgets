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
};

const VALID_REGIONS = ['Europe', 'Africa', 'Middle East', 'Asia', 'Americas', 'Oceania'];

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
    if (!r.ok) return { byCC: {}, lastRunAt: null };
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
    return { byCC, lastRunAt: summary.lastRunAt || summary.refreshedAt || null };
  } catch {
    return { byCC: {}, lastRunAt: null };
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
    const airportsStr = String(rec.fields?.[F.airports] || '');
    return {
      id: rec.id,
      countryCode: cc,
      airports: airportsStr ? airportsStr.split(',').map(s => s.trim()).filter(Boolean) : [],
      region: rec.fields?.[F.region] || null,
      datesMin: rec.fields?.[F.datesMin] ?? null,
      datesMax: rec.fields?.[F.datesMax] ?? null,
      // live offer stats (null if not yet polled / store unreachable)
      offerCount: live.offerCount ?? null,
      airportCountLive: live.airportCount ?? null,
      cheapestPP: live.cheapestPP ?? null,
      currency: live.currency ?? null,
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
  const datesMin = cleanDays(b.datesMin);
  const datesMax = cleanDays(b.datesMax);
  if (datesMin === undefined || datesMax === undefined) return res.status(400).json({ error: 'Date windows must be numbers between 0 and 800.' });

  const fields = { [F.countryCode]: cc, [F.region]: region };
  if (airports) fields[F.airports] = airports;
  if (datesMin != null) fields[F.datesMin] = datesMin;
  if (datesMax != null) fields[F.datesMax] = datesMax;

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
  return res.status(201).json({ ok: true, id: data.records?.[0]?.id || null });
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
