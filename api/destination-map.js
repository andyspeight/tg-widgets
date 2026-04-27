/**
 * Destination Map API (Hardened)
 * GET /api/destination-map?id=WIDGET_ID  → public, returns sanitised array of destinations with lat/lng
 *
 * Used by the World Map widget. Returns only the lightweight fields needed to
 * render pins on the map (name, lat, lng, region, tagline, bestForTags). Heavy
 * fields (climate data, highlights, events, hero intro) are NOT returned —
 * those come from /api/destination-content when a pin is clicked.
 *
 * How it works:
 *   1. Client sends its widget's public WidgetID
 *   2. Server reads the widget config from the Widgets table, extracting
 *      { destinations: [{level, recordId}, ...] }
 *   3. Server fetches matching destination records from each table in batch
 *   4. Server returns sanitised, minimal JSON with coords for map rendering
 *
 * Two modes:
 *   - Public:  ?id=WIDGET_ID                 — used by embedded widgets
 *   - Direct:  ?ids=[{level,recordId},...]   — used by editor preview, auth-gated
 *
 * Security:
 *   - Destination Content PAT is server-only (AIRTABLE_DESTINATION_CONTENT_PAT)
 *   - Rate-limited per IP (public) or per user (direct)
 *   - All strings escaped before being returned
 *   - Lat/lng validated as numbers within sensible bounds
 *   - Best For tags whitelist-validated
 *   - Direct mode auth-gated (no anonymous catalogue enumeration)
 *   - 5-minute in-memory cache, keyed by widget ID
 *
 * Response schema:
 *   {
 *     destinations: [
 *       {
 *         level: 'country' | 'city' | 'resort',
 *         recordId: string,
 *         name: string,
 *         tagline: string,
 *         heroIntro: string,        // for the side panel
 *         flightTime: string,       // e.g. "8h 30m"
 *         heroImage: string,        // first image URL, validated
 *         region: string,
 *         lat: number,              // -90 to 90
 *         lng: number,              // -180 to 180
 *         bestForTags: string[],    // whitelist
 *         climateSummary: string,   // 'sun' | 'tropical' | 'warm' | 'cold'
 *         bestMonths: number[]      // 1-12, derived from climate season
 *       }
 *     ]
 *   }
 */

import { setCors, applyRateLimit, RATE_LIMITS, requireAuth } from './_auth.js';

const AIRTABLE_API = 'https://api.airtable.com/v0';
const WIDGETS_TABLE_NAME = 'Widgets';
const DESTINATION_BASE_ID = 'appuZdlMJ7HKUt6qS';

// Per-level lookup of table IDs and the field IDs the World Map widget needs.
// We deliberately also pull `heroIntro`, the first image URL, and `flightTime`
// in this single batch — all small enough to ship with the pin payload, and
// they eliminate the need for a follow-up /api/destination-content call when
// a pin is clicked. Heavy fields (highlights, events, full climate data,
// attributions) are still excluded.
const LEVEL_MAP = {
  country: {
    tableId: 'tblsxbqbyhTDoWhbo',
    fields: {
      name:          'flddJJrpwcXOwWIow',
      tagline:       'fldjpYZsvAdMt1KlW',
      heroIntro:     'fldv3l23pOs8Yj3px',
      region:        'fldeVnkZXLiy8qCcl',
      lat:           'fldlxsWrbmU6ELUPW',
      lng:           'fldz3whFdzKsZ66hg',
      bestForTags:   'fldC5ZvX1hitoxWY6',
      climateTemps:  'flda8AY7qIO5BQJyI',
      climateSeason: 'fldqx5p1U0siNtvYy',
      flightTime:    'fldGPxNRuf9xao0He',
      images:        'fldTqpNZX5n1219mh',
    },
  },
  city: {
    tableId: 'tblTkKujdVZgWPAQe',
    fields: {
      name:          'fld2VkY61c1JKUWKB',
      tagline:       'fldIu4zaqZZ7XUHZn',
      heroIntro:     'fldijlzHjf9BvhPJI',
      region:        'fld1pD6llYo3Q8WlJ',
      lat:           'fldjk3yUCbVQRuxx8',
      lng:           'fldNSlAA0Qb1akknz',
      bestForTags:   'fldZQTVNuqRXHileW',
      climateTemps:  'fldxjOSYkYRPOZQgx',
      climateSeason: 'fldHwvHjSwkpEgFa2',
      flightTime:    'fldjhp4H3MHcjLQbG',
      images:        'fldt3898YIanGbfzc',
    },
  },
  resort: {
    tableId: 'tblwV9gnbVEyZ99gI',
    fields: {
      name:          'fldnvOipaWpG3W1rx',
      tagline:       'fldwMqygnNpKvf9KO',
      heroIntro:     'fld9NFRPv1MVRL4G9',
      region:        'fldF9hitGwa75MYBa',
      lat:           'fld4INRwIKWCG21RV',
      lng:           'fldd8CwfdzCDhW68w',
      bestForTags:   'fldTmH3gT1wT48PLn',
      climateTemps:  'fld7m7s8LXamDaKzP',
      climateSeason: 'fld5RyPuxYdFFIFhb',
      flightTime:    'fldMlw191r1T3lFXe',
      images:        'fldBMns5p5ChZCriU',
    },
  },
};

// Permit only http(s) URLs in image fields
const URL_RE = /^https?:\/\/[^\s<>"']+$/i;

// Whitelist of region values — anything outside falls back to 'other'.
// Mirrors the singleSelect options on the Region field across all three tables.
const REGION_VOCAB = new Set([
  'Europe', 'Mediterranean', 'Caribbean', 'Africa', 'Asia', 'Middle East',
  'Indian Ocean', 'Americas', 'North America', 'South America', 'Oceania',
  'Pacific', 'Far East', 'Southeast Asia',
]);

// Best For tag whitelist — same as destination-content.js
const TAG_VOCAB = new Set([
  'Couples', 'Honeymoons', 'Families', 'Food and Wine', 'Photography', 'Beach',
  'Adventure', 'Luxury', 'Budget', 'City Break', 'Culture', 'Nightlife', 'Wellness',
  'Wildlife', 'Winter Sun', 'Summer Sun', 'Skiing', 'Multi Generation', 'Solo Travel',
  'Romance',
]);

// Max destinations per widget — protects against config bloat and very heavy
// API payloads. 60 is generous: enough for a global "all our destinations"
// map, far below any realistic editorial use case.
const MAX_DESTINATIONS = 60;

// ── Helpers ─────────────────────────────────────────────────────

function txt(value, maxLen = 500) {
  if (typeof value !== 'string') return '';
  return value.replace(/<[^>]*>/g, '').trim().slice(0, maxLen);
}

// Lat/lng bounds-check. Reject NaN, Infinity, and out-of-range values.
function num(value, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value < min || value > max) return null;
  return value;
}

function parseRegion(value) {
  // Airtable singleSelect returns either a string (with returnFieldsByFieldId)
  // or an object with .name. Defensive: handle both.
  let raw = '';
  if (typeof value === 'string') raw = value;
  else if (value && typeof value === 'object' && typeof value.name === 'string') raw = value.name;
  raw = raw.trim();
  return REGION_VOCAB.has(raw) ? raw : '';
}

function firstImageUrl(value) {
  // Image fields are multiline strings of URLs (one per line). Take the first
  // valid http(s) URL we find. Anything else returns empty.
  if (typeof value !== 'string') return '';
  const lines = value.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (URL_RE.test(trimmed)) return trimmed.slice(0, 800);
  }
  return '';
}

function parseBestForTags(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(v => typeof v === 'string' ? v : (v && typeof v.name === 'string' ? v.name : null))
    .filter(v => v && TAG_VOCAB.has(v))
    .slice(0, 20);
}

function parseCsvInts(str, expectedLen = 12) {
  if (typeof str !== 'string') return null;
  const parts = str.split(',').map(s => s.trim());
  if (parts.length !== expectedLen) return null;
  const nums = parts.map(p => {
    const n = Number(p);
    return Number.isFinite(n) ? Math.round(n) : null;
  });
  if (nums.some(n => n === null)) return null;
  return nums;
}

function parseCsvSeason(str, expectedLen = 12) {
  if (typeof str !== 'string') return null;
  const parts = str.split(',').map(s => s.trim().toLowerCase());
  if (parts.length !== expectedLen) return null;
  const valid = new Set(['best', 'shoulder', 'off']);
  if (parts.some(p => !valid.has(p))) return null;
  return parts;
}

// Derive a one-word climate summary from the 12-month average temps.
// Used to colour-code pins and let the widget render a climate icon
// without pulling the full climate dataset for every pin.
//   tropical → mean temp ≥ 24 AND min ≥ 18
//   warm     → mean temp ≥ 18
//   cold     → mean temp <  10
//   sun      → otherwise (Mediterranean-style)
function summariseClimate(temps) {
  if (!Array.isArray(temps) || temps.length !== 12) return 'warm';
  const mean = temps.reduce((a, b) => a + b, 0) / 12;
  const min = Math.min(...temps);
  if (mean >= 24 && min >= 18) return 'tropical';
  if (mean < 10) return 'cold';
  if (mean >= 18) return 'warm';
  return 'sun';
}

// Derive best months (1-12) from the season array, picking 'best' months.
// Falls back to all months if season data is missing.
function deriveBestMonths(season) {
  if (!Array.isArray(season) || season.length !== 12) return [];
  const months = [];
  for (let i = 0; i < 12; i++) {
    if (season[i] === 'best') months.push(i + 1);
  }
  return months;
}

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

// ── In-memory cache ──────────────────────────────────────────────
// 5-min TTL, keyed by widget ID for public mode, or a hash of the destination
// list for direct mode. Destinations change infrequently; this cuts Airtable
// calls considerably on warm invocations.
const memCache = new Map();
const MEM_TTL_MS = 5 * 60 * 1000;
const MEM_MAX = 200;

function memGet(key) {
  const hit = memCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > MEM_TTL_MS) { memCache.delete(key); return null; }
  return hit.data;
}

function memSet(key, data) {
  if (memCache.size > MEM_MAX) {
    const firstKey = memCache.keys().next().value;
    if (firstKey) memCache.delete(firstKey);
  }
  memCache.set(key, { at: Date.now(), data });
}

// Validate a destination ref { level, recordId }
function isValidDestRef(ref) {
  return ref && typeof ref === 'object'
    && typeof ref.level === 'string' && LEVEL_MAP[ref.level]
    && typeof ref.recordId === 'string' && /^rec[A-Za-z0-9]{14}$/.test(ref.recordId);
}

// ── Core fetch: one Airtable list call per level, batching all record IDs ──
// We use filterByFormula with OR(RECORD_ID()='rec1', RECORD_ID()='rec2', ...).
// Airtable URL length limit is ~16k chars; with 17-char IDs and the wrapper
// formula that comfortably fits 60 records per level. We cap at MAX_DESTINATIONS
// total across all levels.
async function fetchDestinationsForLevel(level, recordIds, pat) {
  if (recordIds.length === 0) return [];

  const map = LEVEL_MAP[level];
  const fieldIds = Object.values(map.fields);

  // Build OR(RECORD_ID()='rec1',RECORD_ID()='rec2',...)
  const formula = `OR(${recordIds.map(id => `RECORD_ID()='${id}'`).join(',')})`;
  const qs = new URLSearchParams();
  qs.append('filterByFormula', formula);
  qs.append('maxRecords', String(recordIds.length));
  fieldIds.forEach(id => qs.append('fields[]', id));
  qs.append('returnFieldsByFieldId', 'true');

  const url = `${AIRTABLE_API}/${DESTINATION_BASE_ID}/${map.tableId}?${qs.toString()}`;
  const resp = await fetch(url, {
    headers: { 'Authorization': `Bearer ${pat}` },
  });

  if (!resp.ok) {
    console.error('[destination-map] Airtable fetch failed', {
      status: resp.status,
      level,
      tableId: map.tableId,
      requestedIds: recordIds.length,
    });
    return [];  // degrade silently per-level rather than failing the whole request
  }

  const raw = await resp.json();
  return (raw.records || []).map(r => {
    const f = r.fields || {};
    const lat = num(f[map.fields.lat], -90, 90);
    const lng = num(f[map.fields.lng], -180, 180);
    // Skip records without valid coords — they can't be pinned on the map
    if (lat === null || lng === null) return null;

    const temps = parseCsvInts(f[map.fields.climateTemps]);
    const season = parseCsvSeason(f[map.fields.climateSeason]);

    return {
      level,
      recordId: r.id,
      name: txt(f[map.fields.name], 120),
      tagline: txt(f[map.fields.tagline], 200),
      heroIntro: txt(f[map.fields.heroIntro], 600),
      flightTime: txt(f[map.fields.flightTime], 60),
      heroImage: firstImageUrl(f[map.fields.images]),
      region: parseRegion(f[map.fields.region]),
      lat,
      lng,
      bestForTags: parseBestForTags(f[map.fields.bestForTags]),
      climateSummary: summariseClimate(temps),
      bestMonths: deriveBestMonths(season),
    };
  }).filter(Boolean);
}

// ── Main handler ─────────────────────────────────────────────────

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Two lookup modes
  const directIds = typeof req.query.ids === 'string' ? req.query.ids : '';
  const isDirect = Boolean(directIds);

  // Rate-limit per IP (public) or per user (direct)
  if (isDirect) {
    const auth = requireAuth(req);
    if (auth.error) return res.status(auth.status).json({ error: auth.error });
    if (!applyRateLimit(res, `destmap:user:${auth.user.email}`, RATE_LIMITS.widgetRead)) return;
  } else {
    if (!applyRateLimit(res, `destmap:ip:${getClientIp(req)}`, RATE_LIMITS.widgetRead)) return;
  }

  const { AIRTABLE_KEY, AIRTABLE_BASE_ID, AIRTABLE_DESTINATION_CONTENT_PAT } = process.env;
  if (!AIRTABLE_DESTINATION_CONTENT_PAT) {
    return res.status(500).json({ error: 'Server configuration error' });
  }

  let destRefs = [];

  if (isDirect) {
    // Editor preview: ids passed directly as JSON string
    let parsed;
    try { parsed = JSON.parse(directIds); }
    catch { return res.status(400).json({ error: 'Invalid ids parameter' }); }

    if (!Array.isArray(parsed)) {
      return res.status(400).json({ error: 'ids must be an array' });
    }

    destRefs = parsed.filter(isValidDestRef).slice(0, MAX_DESTINATIONS);
  } else {
    // Public path: lookup by widget ID
    if (!AIRTABLE_KEY || !AIRTABLE_BASE_ID) {
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const widgetId = req.query.id;
    if (!widgetId || typeof widgetId !== 'string' || widgetId.length > 100 || !/^[\w-]+$/.test(widgetId)) {
      return res.status(400).json({ error: 'Invalid widget ID' });
    }

    // Cache check (public path only — direct mode is editor and shouldn't cache)
    const cached = memGet(widgetId);
    if (cached) {
      res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
      res.setHeader('X-Cache', 'HIT');
      return res.status(200).json(cached);
    }

    try {
      const widgetsFormula = encodeURIComponent(`{WidgetID} = '${widgetId}'`);
      const widgetsUrl = `${AIRTABLE_API}/${AIRTABLE_BASE_ID}/${WIDGETS_TABLE_NAME}`
        + `?filterByFormula=${widgetsFormula}&maxRecords=1&fields%5B%5D=Config`;

      const widgetsResp = await fetch(widgetsUrl, {
        headers: { 'Authorization': `Bearer ${AIRTABLE_KEY}` },
      });
      if (!widgetsResp.ok) throw new Error('upstream-widgets');

      const widgetsData = await widgetsResp.json();
      if (!widgetsData.records || widgetsData.records.length === 0) {
        return res.status(404).json({ error: 'Widget not found' });
      }

      let config;
      try { config = JSON.parse(widgetsData.records[0].fields.Config || '{}'); }
      catch { return res.status(500).json({ error: 'Widget data corrupted' }); }

      const list = Array.isArray(config.destinations) ? config.destinations : [];
      destRefs = list.filter(isValidDestRef).slice(0, MAX_DESTINATIONS);
    } catch (err) {
      console.error('[destination-map] config lookup error:', err?.message || err);
      return res.status(502).json({ error: 'Upstream unavailable' });
    }
  }

  if (destRefs.length === 0) {
    return res.status(200).json({ destinations: [] });
  }

  try {
    // Group record IDs by level so we can do one Airtable call per level
    const byLevel = { country: [], city: [], resort: [] };
    destRefs.forEach(ref => byLevel[ref.level].push(ref.recordId));

    const results = await Promise.all([
      fetchDestinationsForLevel('country', byLevel.country, AIRTABLE_DESTINATION_CONTENT_PAT),
      fetchDestinationsForLevel('city',    byLevel.city,    AIRTABLE_DESTINATION_CONTENT_PAT),
      fetchDestinationsForLevel('resort',  byLevel.resort,  AIRTABLE_DESTINATION_CONTENT_PAT),
    ]);

    // Preserve the original order from destRefs so the editor's drag-and-drop
    // sorting is respected on the public widget too. Build a lookup, then map
    // destRefs through it.
    const lookup = new Map();
    results.flat().forEach(d => lookup.set(`${d.level}:${d.recordId}`, d));

    const destinations = destRefs
      .map(ref => lookup.get(`${ref.level}:${ref.recordId}`))
      .filter(Boolean);

    const payload = { destinations };

    // Only cache the public path (widget ID is the natural cache key)
    if (!isDirect) {
      memSet(req.query.id, payload);
      res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
      res.setHeader('X-Cache', 'MISS');
    } else {
      res.setHeader('Cache-Control', 'private, max-age=60');
    }

    return res.status(200).json(payload);

  } catch (err) {
    console.error('[destination-map] error:', err?.message || err);
    return res.status(502).json({ error: 'Upstream unavailable' });
  }
}
