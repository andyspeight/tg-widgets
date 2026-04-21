/**
 * Destination Content API (Hardened)
 * GET /api/destination-content?id=WIDGET_ID  → public, returns sanitised destination JSON
 *
 * How it works:
 *   1. Client sends its widget's public WidgetID (not the Airtable record ID — defence against enumeration)
 *   2. Server reads the widget config from the Widgets table, extracting { destination.level, destination.recordId }
 *   3. Server fetches the matching destination record from the Destination Content base
 *   4. Server parses Highlights JSON and Events JSON, validating shape
 *   5. Server returns sanitised, minimal JSON
 *
 * Security:
 *   - Destination Content PAT is server-only (AIRTABLE_DESTINATION_CONTENT_PAT), scoped read-only to one base
 *   - Rate-limited per IP (in-memory, matches existing routes)
 *   - All strings escaped before being returned; URLs validated against a protocol allowlist
 *   - Malformed JSON returns empty arrays, never throws to the client
 *   - Generic error responses only — no stack traces leaked
 *
 * Response schema:
 *   {
 *     level: 'country' | 'city' | 'resort',
 *     name: string,
 *     tagline: string,
 *     heroIntro: string,
 *     images: string[],                // URLs, validated
 *     attributions: string[],          // free text, matching images array by index
 *     climate: {
 *       temps: number[],               // 12 integers
 *       rainfall: number[],            // 12 integers
 *       season: ('best'|'shoulder'|'off')[]  // 12 tokens
 *     },
 *     facts: {
 *       flightTime: string,
 *       timeZone: string,
 *       currency: string,
 *       language: string,
 *       voltage: string
 *     },
 *     highlights: Array<{ icon: string, title: string, description: string }>,
 *     bestForTags: string[],
 *     events: Array<{ month: string, name: string, description: string }>
 *   }
 */

import { setCors, applyRateLimit, RATE_LIMITS } from './_auth.js';

const AIRTABLE_API = 'https://api.airtable.com/v0';

// The Widgets base (where we store widget configs) — reuses existing AIRTABLE_KEY
const WIDGETS_TABLE_NAME = 'Widgets';

// The Destination Content base (read-only, separate PAT)
const DESTINATION_BASE_ID = 'appuZdlMJ7HKUt6qS';

// Per-level lookup of table IDs and the Spotlight field IDs, keyed by
// 'country' | 'city' | 'resort'. Field names are identical across the three
// tables but the field IDs differ, which is why we need this map.
const LEVEL_MAP = {
  country: {
    tableId: 'tblsxbqbyhTDoWhbo',
    fields: {
      name:           'flddJJrpwcXOwWIow',
      heroIntro:      'fldv3l23pOs8Yj3px',
      images:         'fldTqpNZX5n1219mh',
      attributions:   'fldVxxvianhuEj11t',
      tagline:        'fldjpYZsvAdMt1KlW',
      climateTemps:   'flda8AY7qIO5BQJyI',
      climateRain:    'fldJNzwIVJEHrHZZr',
      climateSeason: 'fldqx5p1U0siNtvYy',
      flightTime:     'fldGPxNRuf9xao0He',
      timeZone:       'fldOqkxbOYfxL1Qxt',
      currency:       'fldoe2LemU2kZS3EP',
      language:       'fldypaRO1PZgwom22',
      voltage:        'fld5gv8Q7I0VrYib5',
      highlightsJson: 'fldOFmB8E9rDvgQEZ',
      bestForTags:    'fldC5ZvX1hitoxWY6',
      eventsJson:     'fldylxHJYE7PtQ86s',
    },
  },
  city: {
    tableId: 'tblTkKujdVZgWPAQe',
    fields: {
      name:           'fld2VkY61c1JKUWKB',
      heroIntro:      'fldijlzHjf9BvhPJI',
      images:         'fldt3898YIanGbfzc',
      attributions:   'fldzdo1vtYbAvpt0v',
      tagline:        'fldIu4zaqZZ7XUHZn',
      climateTemps:   'fldxjOSYkYRPOZQgx',
      climateRain:    'fldl296lX37f8stws',
      climateSeason: 'fldHwvHjSwkpEgFa2',
      flightTime:     'fldjhp4H3MHcjLQbG',
      timeZone:       'fldftMgM4Z3XQYNcf',
      currency:       'fldyVpNjyezPfVeRM',
      language:       'fldFUbivACHoLzGkO',
      voltage:        'fldebFrJI6MHeRJsZ',
      highlightsJson: 'fld1moM61DARrsBwr',
      bestForTags:    'fldZQTVNuqRXHileW',
      eventsJson:     'fldxze1iXQRrJ0UZW',
    },
  },
  resort: {
    tableId: 'tblwV9gnbVEyZ99gI',
    fields: {
      name:           'fldnvOipaWpG3W1rx',
      heroIntro:      'fld9NFRPv1MVRL4G9',
      images:         'fldBMns5p5ChZCriU',
      attributions:   'fldMn6hYB1o5OwJpN',
      tagline:        'fldwMqygnNpKvf9KO',
      climateTemps:   'fld7m7s8LXamDaKzP',
      climateRain:    'fldCuW6FzzetUe0tV',
      climateSeason: 'fld5RyPuxYdFFIFhb',
      flightTime:     'fldMlw191r1T3lFXe',
      timeZone:       'fldyV0RY9yxqDEJvR',
      currency:       'fldGNJTsJWk7VnUWf',
      language:       'fldX1CJSFmL8NKu3w',
      voltage:        'fldnjJpthgX61yp47',
      highlightsJson: 'fldUyjDhtoA43hdHv',
      bestForTags:    'fldTmH3gT1wT48PLn',
      eventsJson:     'fldWRl0d0z1MY6DMq',
    },
  },
};

// ── Whitelists ──────────────────────────────────────────────────
// Locked-down vocabularies from the brief. Anything outside these returns empty.
// This protects us from a rogue Airtable edit propagating odd icon names into
// the widget and triggering either 404s for missing assets or XSS if we
// ever rendered them unescaped.
const ICON_VOCAB = new Set([
  'mountain','sunset','wine','water','palm','city','temple','beach','food',
  'star','camera','heart','building','map','compass','sun','snowflake',
]);

const TAG_VOCAB = new Set([
  'Couples','Honeymoons','Families','Food and Wine','Photography','Beach',
  'Adventure','Luxury','Budget','City Break','Culture','Nightlife','Wellness',
  'Wildlife','Winter Sun','Summer Sun','Skiing','Multi Generation','Solo Travel',
  'Romance',
]);

// Only permit absolute http(s) URLs. No javascript:, data:, vbscript:, relative paths.
const URL_RE = /^https?:\/\/[^\s<>"']+$/i;

// ── Helpers ─────────────────────────────────────────────────────

function txt(value, maxLen = 500) {
  if (typeof value !== 'string') return '';
  // Strip any tags so the widget can safely drop text into its DOM via textContent.
  // (The widget itself must also textContent — never innerHTML — untrusted strings.
  // This is defence in depth.)
  return value.replace(/<[^>]*>/g, '').trim().slice(0, maxLen);
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

function parseMultilineUrls(str, maxCount = 10) {
  if (typeof str !== 'string') return [];
  return str
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(s => s && URL_RE.test(s))
    .slice(0, maxCount);
}

function parseMultilineText(str, maxCount = 10, maxLen = 300) {
  if (typeof str !== 'string') return [];
  return str
    .split(/\r?\n/)
    .map(s => txt(s, maxLen))
    .filter(Boolean)
    .slice(0, maxCount);
}

function parseHighlights(str) {
  if (typeof str !== 'string' || !str.trim()) return [];
  let arr;
  try { arr = JSON.parse(str); } catch { return []; }
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, 6).map(h => {
    if (!h || typeof h !== 'object') return null;
    const icon = typeof h.icon === 'string' ? h.icon.trim().toLowerCase() : '';
    const safeIcon = ICON_VOCAB.has(icon) ? icon : 'star';
    return {
      icon: safeIcon,
      title: txt(h.title, 60),
      description: txt(h.description, 280),
    };
  }).filter(h => h && h.title);
}

function parseEvents(str) {
  if (typeof str !== 'string' || !str.trim()) return [];
  let arr;
  try { arr = JSON.parse(str); } catch { return []; }
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, 6).map(e => {
    if (!e || typeof e !== 'object') return null;
    return {
      month: txt(e.month, 20),
      name: txt(e.name, 80),
      description: txt(e.description, 280),
    };
  }).filter(e => e && e.name);
}

function parseBestForTags(value) {
  // Airtable multipleSelects returns an array of strings (option names) with
  // our configured response format. Defensive: also handle object arrays.
  if (!Array.isArray(value)) return [];
  return value
    .map(v => typeof v === 'string' ? v : (v && typeof v.name === 'string' ? v.name : null))
    .filter(v => v && TAG_VOCAB.has(v))
    .slice(0, 20);
}

// Client IP for rate-limit key. Trusts the first hop in x-forwarded-for — OK
// behind Vercel's edge which strips client-supplied values.
function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

// ── In-memory per-instance cache ────────────────────────────────
// 5-minute TTL, keyed by `${level}:${recordId}`. Destinations change
// infrequently; this cuts Airtable calls on warm invocations. Separate
// from the HTTP CDN cache, which the response header also sets.
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
    // Simple eviction — drop the oldest entry.
    const firstKey = memCache.keys().next().value;
    if (firstKey) memCache.delete(firstKey);
  }
  memCache.set(key, { at: Date.now(), data });
}

// ── Main handler ────────────────────────────────────────────────

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Rate limit by IP (public endpoint — no user identity)
  if (!applyRateLimit(res, `destcontent:${getClientIp(req)}`, RATE_LIMITS.widgetRead)) return;

  const { AIRTABLE_KEY, AIRTABLE_BASE_ID, AIRTABLE_DESTINATION_CONTENT_PAT } = process.env;
  if (!AIRTABLE_KEY || !AIRTABLE_BASE_ID || !AIRTABLE_DESTINATION_CONTENT_PAT) {
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const widgetId = req.query.id;
  if (!widgetId || typeof widgetId !== 'string' || widgetId.length > 100 || !/^[\w-]+$/.test(widgetId)) {
    return res.status(400).json({ error: 'Invalid widget ID' });
  }

  try {
    // ── Step 1: look up widget config to find the destination it points to ──
    // Use the existing AIRTABLE_KEY for the Widgets base, filter by WidgetID
    // (sanitisation via the regex test above — widgetId is alphanumeric + _ + -).
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

    const dest = config.destination || {};
    const level = dest.level;
    const recordId = dest.recordId;

    if (!level || !LEVEL_MAP[level] || !recordId || typeof recordId !== 'string' || !/^rec[A-Za-z0-9]{14}$/.test(recordId)) {
      return res.status(400).json({ error: 'Widget has no destination configured' });
    }

    // ── Step 2: check in-memory cache ──
    const cacheKey = `${level}:${recordId}`;
    const cached = memGet(cacheKey);
    if (cached) {
      res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
      res.setHeader('X-Cache', 'HIT');
      return res.status(200).json(cached);
    }

    // ── Step 3: fetch destination record ──
    // We use the LIST endpoint with filterByFormula=RECORD_ID()='...' rather
    // than the single-record GET endpoint, because only the list endpoint
    // supports fields[] filtering and returnFieldsByFieldId=true. Hitting the
    // single-record endpoint with those params returns 422 Unprocessable.
    const map = LEVEL_MAP[level];
    const fieldIds = Object.values(map.fields);
    const qs = new URLSearchParams();
    qs.append('filterByFormula', `RECORD_ID()='${recordId}'`);
    qs.append('maxRecords', '1');
    fieldIds.forEach(id => qs.append('fields[]', id));
    qs.append('returnFieldsByFieldId', 'true');

    const destUrl = `${AIRTABLE_API}/${DESTINATION_BASE_ID}/${map.tableId}?${qs.toString()}`;
    const destResp = await fetch(destUrl, {
      headers: { 'Authorization': `Bearer ${AIRTABLE_DESTINATION_CONTENT_PAT}` },
    });

    if (!destResp.ok) {
      // Surface the specific upstream status to aid diagnosis of PAT/scope/base
      // access issues. The error message is generic to avoid leaking detail
      // but the status code hint lets us see 401 (PAT invalid) / 403 (scope or
      // base access wrong) / 422 (query malformed) / 429 (rate-limited).
      // Safe: no key material exposed.
      console.error('[destination-content] Airtable destination fetch failed', {
        status: destResp.status,
        level,
        tableId: map.tableId,
      });
      return res.status(502).json({
        error: 'Upstream unavailable',
        hint: `destination-fetch-${destResp.status}`,
      });
    }

    const raw = await destResp.json();
    // List-endpoint shape: { records: [ { id, fields } ] } — zero records
    // means the destination record ID didn't match anything in that table.
    if (!raw.records || raw.records.length === 0) {
      return res.status(404).json({ error: 'Destination not found' });
    }
    const f = raw.records[0].fields || {};

    // ── Step 4: shape and sanitise ──
    const images = parseMultilineUrls(f[map.fields.images]);
    const attributions = parseMultilineText(f[map.fields.attributions]);

    const payload = {
      level,
      name: txt(f[map.fields.name], 120),
      tagline: txt(f[map.fields.tagline], 200),
      heroIntro: txt(f[map.fields.heroIntro], 600),
      images,
      attributions,
      climate: {
        temps:    parseCsvInts(f[map.fields.climateTemps])    || [],
        rainfall: parseCsvInts(f[map.fields.climateRain])     || [],
        season:   parseCsvSeason(f[map.fields.climateSeason]) || [],
      },
      facts: {
        flightTime: txt(f[map.fields.flightTime], 60),
        timeZone:   txt(f[map.fields.timeZone],   40),
        currency:   txt(f[map.fields.currency],   80),
        language:   txt(f[map.fields.language],   80),
        voltage:    txt(f[map.fields.voltage],    60),
      },
      highlights: parseHighlights(f[map.fields.highlightsJson]),
      bestForTags: parseBestForTags(f[map.fields.bestForTags]),
      events: parseEvents(f[map.fields.eventsJson]),
    };

    memSet(cacheKey, payload);

    res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
    res.setHeader('X-Cache', 'MISS');
    return res.status(200).json(payload);

  } catch (err) {
    // Log server-side for debugging but never leak to client
    console.error('[destination-content] error:', err?.message || err);
    return res.status(502).json({ error: 'Upstream unavailable' });
  }
}
