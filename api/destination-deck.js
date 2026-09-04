/**
 * Destination Deck API (Inspirator widget)
 *
 * Serves a POOL of destination cards for the swipe deck. The widget shuffles
 * the pool itself and deals `deckSize` cards from it, which is what lets this
 * response be cached hard at the edge while every visitor still gets a
 * different order. A server-side shuffle would have to be uncacheable, and an
 * uncacheable endpoint on a public widget is an Airtable call per visitor.
 *
 * Two modes:
 *   1. Public widget mode:  GET /api/destination-deck?id=WIDGET_ID
 *      Reads the widget's saved levels and tag filter, then builds the pool.
 *
 *   2. Public direct mode:  GET /api/destination-deck?levels=resort,city&tags=Beach,Luxury
 *      Same pool, addressed directly. Used by the demo page and by an editor
 *      that has not saved yet. Every parameter is validated against a closed
 *      set, so this cannot be turned into an arbitrary query.
 *
 * Only LIVE records that carry a hero photo are ever dealt. A swipe card is a
 * photograph with a name on it, so a record with no image cannot be a card at
 * all — see deckFormula() in _lib/destination-cards.js.
 *
 * Security:
 *   - Destination Content PAT is server-only (AIRTABLE_DESTINATION_CONTENT_PAT)
 *   - Rate-limited per IP
 *   - Levels are matched against LEVEL_MAP and tags against the locked 32-tag
 *     vocabulary, so only known literals can reach the Airtable formula. Field
 *     names in the formula come from LEVEL_MAP, never from the request.
 *   - Every returned string is stripped of HTML and length-capped; image URLs
 *     must match the http(s) allowlist
 *   - Generic error responses only, no stack traces leaked
 *
 * Response:
 *   { cards: [{ level, recordId, slug, name, region, tagline, image,
 *               attribution, tags[], flightTime, bestMonths }],
 *     pool: <number> }
 */

import { setCors, applyRateLimit, RATE_LIMITS } from './_auth.js';
import {
  DESTINATION_BASE_ID,
  LEVEL_MAP,
  toCard,
  deckFormula,
  normaliseLevels,
  normaliseTags,
} from './_lib/destination-cards.js';

const AIRTABLE_API = 'https://api.airtable.com/v0';

// Same hard edge cache as destination-content and destination-list. The browser
// absorbs repeat loads so they never reach the rate-limited origin, and the CDN
// serves stale instantly for a week while it revalidates behind the scenes.
const PUBLIC_CACHE = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=604800';

const WIDGETS_TABLE_NAME = 'Widgets';

// Airtable returns at most 100 records per page. One page per level is plenty:
// the widget deals 8 to 20 cards from the shuffled pool, so a hundred
// candidates already gives more variety than any visitor will exhaust.
const POOL_PER_LEVEL = 100;
// Across all three levels. Keeps the payload bounded whatever the config asks
// for, and stops one request becoming a bulk export of the destination base.
const POOL_TOTAL = 150;

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

async function fetchPool(level, tags, pat, limit) {
  const map = LEVEL_MAP[level];
  const formula = deckFormula(level, tags);
  if (!map || !formula) return [];

  const fieldParams = Object.values(map.fields)
    .map(id => `fields%5B%5D=${encodeURIComponent(id)}`)
    .join('&');
  const url = `${AIRTABLE_API}/${DESTINATION_BASE_ID}/${map.tableId}`
    + `?filterByFormula=${encodeURIComponent(formula)}`
    + `&maxRecords=${limit}&pageSize=100&returnFieldsByFieldId=true&${fieldParams}`;

  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${pat}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!resp.ok) {
    const err = new Error(`Deck fetch ${resp.status}`);
    err.status = resp.status;
    throw err;
  }
  const data = await resp.json();
  const out = [];
  for (const rec of (data.records || [])) {
    // A deck card carries every tag the record has: the Inspirator infers a
    // taste profile from what the visitor keeps, so truncating to four would
    // quietly bias the result towards whatever Airtable happened to list first.
    const card = toCard(level, rec.id, rec.fields, 8);
    // The formula already excludes empty Image URLs, but a record whose only
    // image line fails the http(s) allowlist would still arrive here. Drop it
    // rather than deal a card with no picture.
    if (card && card.image && card.name) out.push(card);
  }
  return out;
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

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!applyRateLimit(res, `destdeck:${getClientIp(req)}`, RATE_LIMITS.widgetRead)) return;

  const { AIRTABLE_KEY, AIRTABLE_BASE_ID, AIRTABLE_DESTINATION_CONTENT_PAT } = process.env;
  if (!AIRTABLE_KEY || !AIRTABLE_BASE_ID || !AIRTABLE_DESTINATION_CONTENT_PAT) {
    return res.status(500).json({ error: 'Server configuration error' });
  }

  let levels;
  let tags;

  if (req.query.id) {
    const widgetId = req.query.id;
    if (typeof widgetId !== 'string' || widgetId.length > 100 || !/^[\w-]+$/.test(widgetId)) {
      return res.status(400).json({ error: 'Invalid widget ID' });
    }
    let config;
    try {
      config = await readWidgetConfig(widgetId, AIRTABLE_KEY);
    } catch (err) {
      console.error('[destination-deck] widget read error:', err?.message || err);
      return res.status(502).json({ error: 'Upstream unavailable' });
    }
    if (!config) return res.status(404).json({ error: 'Widget not found' });
    levels = normaliseLevels(config.levels);
    tags = normaliseTags(config.tags);
  } else {
    levels = normaliseLevels(req.query.levels);
    tags = normaliseTags(req.query.tags);
  }

  // Share the total budget across the requested levels so a three-level deck
  // does not fetch three hundred records.
  const perLevel = Math.max(20, Math.min(POOL_PER_LEVEL, Math.floor(POOL_TOTAL / levels.length)));

  let cards;
  try {
    const pools = await Promise.all(levels.map(l => fetchPool(l, tags, AIRTABLE_DESTINATION_CONTENT_PAT, perLevel)));
    cards = pools.flat().slice(0, POOL_TOTAL);
  } catch (err) {
    console.error('[destination-deck] pool error:', err?.message || err);
    return res.status(502).json({ error: 'Upstream unavailable' });
  }

  res.setHeader('Cache-Control', PUBLIC_CACHE);
  return res.status(200).json({ cards, pool: cards.length });
}
