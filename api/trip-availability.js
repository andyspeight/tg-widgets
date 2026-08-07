// =============================================================================
//  /api/trip-availability.js
// =============================================================================
//
//  Public GET — how many places are left on a group trip.
//    GET /api/trip-availability?widgetId=tgw_...
//
//  Counts only. Never returns a single field of traveller data. Capacity comes
//  from the widget's saved config (server-side, never the browser); the taken
//  count comes from the group-trips Supabase via the service role. CDN-cached
//  60s and rate-limited, so the origin is hit about once a minute per trip.
//
//  Fails CALM: if the database isn't wired yet or a query errors, it returns
//  200 { available:false } so the widget simply hides the count rather than
//  showing a wrong number or a scary error. (No live search ever happens here —
//  this only ever reads our own counts.)
//
// =============================================================================

import { sanitiseForFormula } from './_auth.js';
import { evaluatePublicRateLimit } from './_lib/rate-limit-public.js';
import { getTripAvailability, tripsDbConfigured } from './_lib/trips/supabase.js';
import { logWidgetEvent } from './_lib/telemetry.js';

const WIDGETS_BASE_ID = process.env.AIRTABLE_BASE_ID;
const WIDGETS_PAT = process.env.AIRTABLE_KEY;
const WIDGETS_TABLE_ID = 'tblVAThVqAjqtria2';

function setCors(res, origin) {
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
}

// Resolve the public WidgetID (tgw_…) to the trip's configured capacity. Read
// straight from the saved Config JSON — capacity is what determines sold-out,
// so it must never come from the caller. Not cached: capacity changes when the
// agent edits the trip, and the CDN 60s cache already spares the origin.
async function resolveCapacity(widgetId) {
  if (!WIDGETS_BASE_ID || !WIDGETS_PAT) return null;
  try {
    const safeId = sanitiseForFormula(widgetId);
    const formula = encodeURIComponent(`{WidgetID} = '${safeId}'`);
    const url = `https://api.airtable.com/v0/${WIDGETS_BASE_ID}/${WIDGETS_TABLE_ID}?filterByFormula=${formula}&maxRecords=1`;
    const resp = await fetch(url, { headers: { 'Authorization': `Bearer ${WIDGETS_PAT}` } });
    if (!resp.ok) return null;
    const data = await resp.json();
    const rec = data.records && data.records[0];
    if (!rec) return { found: false, capacity: 0 };
    let capacity = 0;
    try {
      const cfg = JSON.parse(rec.fields['Config'] || '{}');
      capacity = Math.max(0, parseInt(cfg?.trip?.capacity, 10) || 0);
    } catch { /* unparseable config -> capacity 0 -> widget hides the count */ }
    return { found: true, capacity };
  } catch (err) {
    console.error('[trip-availability] capacity lookup failed:', err.message);
    return null;
  }
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  setCors(res, origin);

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ ok: false, error: 'Method not allowed' }); return; }

  const widgetId = String((req.query && req.query.widgetId) || '').slice(0, 50);
  if (!/^tgw_[A-Za-z0-9_]+$/.test(widgetId)) {
    res.status(400).json({ ok: false, error: 'Invalid widget ID' });
    return;
  }

  const rl = await evaluatePublicRateLimit(req, res, { event: 'trip-availability', widgetId });
  if (!rl.allowed) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(429).json({ ok: false, error: `Too many requests. Retry in ${rl.retryAfter}s.` });
    return;
  }

  // Calm degrade path — database not wired yet. The widget hides the count.
  if (!tripsDbConfigured()) {
    res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=60');
    res.status(200).json({ ok: true, available: false });
    return;
  }

  const info = await resolveCapacity(widgetId);
  if (!info) { res.status(404).json({ ok: false, error: 'Trip not found' }); return; }
  if (!info.found) { res.status(404).json({ ok: false, error: 'Trip not found' }); return; }

  try {
    const a = await getTripAvailability(widgetId, info.capacity);
    res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=60');
    // Counts only — no traveller data, ever.
    res.status(200).json({
      ok: true,
      available: a.capacity > 0,
      capacity: a.capacity,
      remaining: a.remaining,
      soldOut: a.soldOut,
    });
    logWidgetEvent(req, { event: 'trip-availability', widgetId, widgetType: 'Group Trips', status: 200 }).catch(() => {});
  } catch (err) {
    console.error('[trip-availability] query failed:', err.message);
    // Fail calm: hide the count rather than show a wrong/zero number.
    res.setHeader('Cache-Control', 'public, max-age=10');
    res.status(200).json({ ok: true, available: false });
  }
}
