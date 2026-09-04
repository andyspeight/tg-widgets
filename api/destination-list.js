/**
 * Destination List API (Top 10 widget)
 *
 * Hydrates an ORDERED list of destination references into compact card data.
 * The widget config stores references only (level + recordId + slug), never a
 * snapshot of the content, so an editorial fix in the Destination Content base
 * reaches every embedded Top 10 without anyone re-saving a widget. This is the
 * same "facts stay live" contract the Spotlight family runs on (14 Jul 2026).
 *
 * Four modes:
 *   1. Public widget mode:  GET /api/destination-list?id=WIDGET_ID
 *      Reads the widget's saved items from the Widgets table, then hydrates
 *      them. This is what embedded widgets in the wild call.
 *
 *   2. Public preset mode:  GET /api/destination-list?list=beach-escapes
 *      Hydrates one of the curated default lists shipped in _data/top10-lists.json.
 *      Used by the demo page and by an editor that has not saved yet.
 *
 *   3. Catalogue mode:      GET /api/destination-list?catalogue=1
 *      Returns the curated list metadata (id, title, subtitle, level, count)
 *      with no Airtable read at all. Drives the editor's preset picker.
 *
 *   4. Editor preview:      POST { items: [{ level, recordId }] }
 *      AUTHENTICATED. Hydrates an in-progress list before it is saved.
 *
 * Security:
 *   - Destination Content PAT is server-only (AIRTABLE_DESTINATION_CONTENT_PAT)
 *   - Rate-limited per IP
 *   - recordIds are regex-validated at the point they are interpolated into the
 *     Airtable formula (see recordIdFormula), not merely at the entry point
 *   - Every returned string is stripped of HTML and length-capped; image URLs
 *     must match the http(s) allowlist; tags are filtered to the locked vocabulary
 *   - MAX_ITEMS caps the fan-out so one request can never become a bulk export
 *   - Generic error responses only, no stack traces leaked
 *
 * Response:
 *   { items: [{ rank, level, recordId, slug, name, region, tagline, image,
 *               attribution, tags[], flightTime, bestMonths }],
 *     title?, subtitle?, listId? }        // title/subtitle only in preset mode
 *
 * A reference that no longer resolves (record deleted, or its level changed) is
 * dropped from the response rather than faked, and the ranks close up.
 *
 * The pure parts (field maps, validation, card shaping) live in
 * api/_lib/top10-list.js and are covered by test/top10-list-smoke.mjs.
 */

import { setCors, applyRateLimit, RATE_LIMITS, requireAuth } from './_auth.js';
import {
  DESTINATION_BASE_ID,
  LEVEL_MAP,
  MAX_ITEMS,
  toCard,
  normaliseRefs,
  recordIdFormula,
  orderAndRank,
  findPreset,
  presetCatalogue,
} from './_lib/top10-list.js';

const AIRTABLE_API = 'https://api.airtable.com/v0';

// Same hard edge cache as destination-content: the browser absorbs repeat loads
// (max-age) so they never reach the rate-limited origin, and the CDN serves
// stale instantly for a week while it revalidates behind the scenes. Do NOT
// shorten max-age to make an edit appear sooner — that removes the browser
// cache and a developer reloading a page burns the 120/15min limit (the 11 Aug
// 2026 incident on destination-content).
const PUBLIC_CACHE = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=604800';
const PREVIEW_CACHE = 'private, no-store';
// The catalogue ships in the bundle and changes only on deploy.
const STATIC_CACHE = 'public, max-age=3600, s-maxage=86400';

const WIDGETS_TABLE_NAME = 'Widgets';

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

/** Fetch every requested record for one level in a single Airtable call. */
async function fetchLevel(level, recordIds, pat) {
  const map = LEVEL_MAP[level];
  const formula = recordIdFormula(recordIds);
  if (!map || !formula) return new Map();

  const fieldParams = Object.values(map.fields)
    .map(id => `fields%5B%5D=${encodeURIComponent(id)}`)
    .join('&');
  const url = `${AIRTABLE_API}/${DESTINATION_BASE_ID}/${map.tableId}`
    + `?filterByFormula=${encodeURIComponent(formula)}`
    + `&maxRecords=${MAX_ITEMS}&returnFieldsByFieldId=true&${fieldParams}`;

  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${pat}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!resp.ok) {
    const err = new Error(`Destination fetch ${resp.status}`);
    err.status = resp.status;
    throw err;
  }
  const data = await resp.json();
  const out = new Map();
  for (const rec of (data.records || [])) {
    const card = toCard(level, rec.id, rec.fields);
    if (card) out.set(rec.id, card);
  }
  return out;
}

/**
 * Hydrate an ordered reference list. Groups by level so we make at most three
 * Airtable calls however long the list is, then restores the requested order.
 */
async function hydrate(refs, pat) {
  const byLevel = { country: [], city: [], resort: [] };
  for (const r of refs) byLevel[r.level].push(r.recordId);

  const levels = Object.keys(byLevel).filter(l => byLevel[l].length);
  const results = await Promise.all(levels.map(l => fetchLevel(l, byLevel[l], pat)));

  const found = new Map();
  levels.forEach((l, i) => {
    for (const [id, card] of results[i]) found.set(`${l}:${id}`, card);
  });

  return orderAndRank(refs, found);
}

async function readWidgetConfig(widgetId, key) {
  const formula = encodeURIComponent(`{WidgetID} = '${widgetId}'`);
  const url = `${AIRTABLE_API}/${process.env.AIRTABLE_BASE_ID}/${WIDGETS_TABLE_NAME}`
    + `?filterByFormula=${formula}&maxRecords=1&fields%5B%5D=Config`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!resp.ok) {
    const err = new Error(`Widgets fetch ${resp.status}`);
    err.status = resp.status;
    throw err;
  }
  const data = await resp.json();
  if (!data.records || data.records.length === 0) return null;
  try { return JSON.parse(data.records[0].fields.Config || '{}'); }
  catch { return null; }
}

// ---- Main handler ----

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!applyRateLimit(res, `destlist:${getClientIp(req)}`, RATE_LIMITS.widgetRead)) return;

  // ---- Mode 3: catalogue. No Airtable read, no secrets needed. ----
  if (req.method === 'GET' && req.query.catalogue) {
    res.setHeader('Cache-Control', STATIC_CACHE);
    return res.status(200).json({ lists: presetCatalogue() });
  }

  const { AIRTABLE_KEY, AIRTABLE_BASE_ID, AIRTABLE_DESTINATION_CONTENT_PAT } = process.env;
  if (!AIRTABLE_KEY || !AIRTABLE_BASE_ID || !AIRTABLE_DESTINATION_CONTENT_PAT) {
    return res.status(500).json({ error: 'Server configuration error' });
  }

  let refs = [];
  let meta = {};
  let cache = PUBLIC_CACHE;

  if (req.method === 'POST') {
    // ---- Mode 4: editor preview of an unsaved list ----
    const auth = requireAuth(req);
    if (auth.error) return res.status(auth.status).json({ error: auth.error });
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    refs = normaliseRefs(body.items);
    cache = PREVIEW_CACHE;

  } else if (req.query.list) {
    // ---- Mode 2: a curated default list ----
    const preset = findPreset(req.query.list);
    if (!preset) return res.status(404).json({ error: 'List not found' });
    refs = normaliseRefs(preset.items);
    meta = { listId: preset.id, title: preset.title, subtitle: preset.subtitle };

  } else {
    // ---- Mode 1: public widget mode ----
    const widgetId = req.query.id;
    if (!widgetId || typeof widgetId !== 'string' || widgetId.length > 100 || !/^[\w-]+$/.test(widgetId)) {
      return res.status(400).json({ error: 'Invalid widget ID' });
    }
    let config;
    try {
      config = await readWidgetConfig(widgetId, AIRTABLE_KEY);
    } catch (err) {
      console.error('[destination-list] widget read error:', err?.message || err);
      return res.status(502).json({ error: 'Upstream unavailable' });
    }
    if (!config) return res.status(404).json({ error: 'Widget not found' });

    refs = normaliseRefs(config.items);
    // A widget saved with no items of its own falls back to the curated list it
    // was seeded from, so a half-finished save still renders something honest.
    if (!refs.length && config.listId) {
      const preset = findPreset(config.listId);
      if (preset) refs = normaliseRefs(preset.items);
    }
  }

  if (!refs.length) {
    res.setHeader('Cache-Control', cache);
    return res.status(200).json({ items: [], ...meta });
  }

  let items;
  try {
    items = await hydrate(refs, AIRTABLE_DESTINATION_CONTENT_PAT);
  } catch (err) {
    console.error('[destination-list] hydrate error:', err?.message || err);
    return res.status(502).json({ error: 'Upstream unavailable' });
  }

  res.setHeader('Cache-Control', cache);
  return res.status(200).json({ items, ...meta });
}
