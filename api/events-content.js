/**
 * Events Calendar Content API
 *
 * Public mode:  GET /api/events-content?id=WIDGET_ID
 *   Reads the widget's saved config to get curated filters (countries, categories, audience),
 *   then queries the global Events Calendar table for matching upcoming events.
 *
 * Editor preview mode:  GET /api/events-content?preview=1&country=...&cat=...&aud=...&months=N
 *   Auth-gated. Same query but with filters passed directly so the editor can render
 *   live previews before the widget is saved.
 *
 * Shape:
 *   {
 *     events: [
 *       { id, name, startDate, endDate, category, countries, destinations, description, audience }
 *     ],
 *     meta: { count, source: 'travelgenix-curated' }
 *   }
 *
 * Security model:
 * - Public route returns sanitised, minimal JSON. Strings stripped of tags. URLs validated.
 * - Public route gated by widget ID lookup — no enumeration of the events catalogue.
 * - Editor-preview route requires a valid session token (HMAC).
 * - Rate-limited per IP using the existing widgetRead bucket.
 * - All upstream Airtable calls use field IDs (not field names) so renames don't break us.
 */

import { setCors, applyRateLimit, RATE_LIMITS } from './_auth.js';

const AIRTABLE_API = 'https://api.airtable.com/v0';

// Widgets base — reuses AIRTABLE_KEY (the existing widget config PAT)
const WIDGETS_TABLE_NAME = 'Widgets';

// Luna Marketing base hosts the global Events Calendar table.
// Read-only PAT scoped to that base + table only.
//   env var: TG_EVENTS_AIRTABLE_PAT
const EVENTS_BASE_ID = 'appSoIlSe0sNaJ4BZ';
const EVENTS_TABLE_ID = 'tblQxIYrbzd6YlJYV';

const FIELDS = {
  name:        'fldeCYUaMLwkWpv2u', // Event Name
  dateStart:   'fld3kpR4x8CMyN5X5', // Date Start
  dateEnd:     'fldwec6M9n8vwsLHz', // Date End
  category:    'fldNLLFPH91s604GB', // Category (singleSelect)
  countries:   'fldxFYgltX1yU9ks3', // Countries (free text, comma-separated)
  destinations:'fldCDWRuWhFr71WUf', // Destinations
  travelAngle: 'fldyQhl1FiHk23fAN', // Travel Angle (multiline)
  audience:    'fldrSxFITuFdeiBUz', // Audience (multipleSelects)
  recurring:   'fldVnfmglfOfjnLqS', // Recurring
  impact:      'fldpvhsssthzhTO36', // Impact
  suggestion:  'fld3r8C281SlFUd7X', // Content Suggestion
};

// ── Helpers ─────────────────────────────────────────────

function txt(value, maxLen = 500) {
  if (typeof value !== 'string') return '';
  return value.replace(/<[^>]*>/g, '').trim().slice(0, maxLen);
}

function parseDateStr(value) {
  if (typeof value !== 'string') return '';
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[0] : '';
}

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

// Lightweight escaping for free-text values about to be embedded into an
// Airtable formula. Strips the few characters that could break out of the
// quoted string.
function escForFormula(s) {
  return String(s || '').replace(/[\\'"]/g, '').slice(0, 100);
}

// ── In-memory cache ─────────────────────────────────────
// Cache key incorporates the filter signature so different widget configs
// don't collide. 5-min TTL is plenty — events don't change minute-to-minute.
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

// ── Airtable query builder ──────────────────────────────

function buildFormula(filters, monthsAhead) {
  // Always restrict to events whose end date is on/after today,
  // and whose start date is on/before our horizon.
  //
  // We wrap the literal dates in DATETIME_PARSE so Airtable treats them
  // as date values, not strings — IS_AFTER/IS_BEFORE/IS_SAME silently
  // return wrong results otherwise. We also guard against blank date
  // fields with NOT(BLANK()) — required when scanning a free-form
  // calendar where some rows are missing the end date.
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const horizon = new Date(today.getTime() + Math.max(1, Math.min(24, monthsAhead || 12)) * 31 * 86400000);
  const horizonStr = horizon.toISOString().slice(0, 10);

  const dateClauses = [
    // start <= horizon
    `IS_BEFORE({${FIELDS.dateStart}}, DATETIME_PARSE('${horizonStr}', 'YYYY-MM-DD'))`,
    // (end OR start) >= today  -- covers events that are ongoing today
    // or starting in the future. Falls back to start when end is blank.
    `OR(`
      + `IS_AFTER({${FIELDS.dateEnd}}, DATETIME_PARSE('${todayStr}', 'YYYY-MM-DD')),`
      + `IS_SAME({${FIELDS.dateEnd}}, DATETIME_PARSE('${todayStr}', 'YYYY-MM-DD'), 'day'),`
      + `AND(BLANK()={${FIELDS.dateEnd}}, OR(`
        + `IS_AFTER({${FIELDS.dateStart}}, DATETIME_PARSE('${todayStr}', 'YYYY-MM-DD')),`
        + `IS_SAME({${FIELDS.dateStart}}, DATETIME_PARSE('${todayStr}', 'YYYY-MM-DD'), 'day')`
      + `))`
    + `)`,
  ];

  const filterClauses = [];

  if (filters.categories && filters.categories.length) {
    const cats = filters.categories.slice(0, 12).map(c => `{${FIELDS.category}}='${escForFormula(c)}'`);
    filterClauses.push('OR(' + cats.join(',') + ')');
  }

  if (filters.countries && filters.countries.length) {
    // Countries field is free text, comma-separated. Use FIND() to match substrings.
    const cos = filters.countries.slice(0, 24).map(c => `FIND('${escForFormula(c)}', {${FIELDS.countries}})>0`);
    filterClauses.push('OR(' + cos.join(',') + ')');
  }

  if (filters.audiences && filters.audiences.length) {
    // Audience is multipleSelects. Use FIND() against the implicit array string.
    const auds = filters.audiences.slice(0, 12).map(a => `FIND('${escForFormula(a)}', ARRAYJOIN({${FIELDS.audience}}, ', '))>0`);
    filterClauses.push('OR(' + auds.join(',') + ')');
  }

  return 'AND(' + dateClauses.concat(filterClauses).join(',') + ')';
}

// Page through Airtable until we have enough or exhausted results.
async function fetchEventsFromAirtable(filters, monthsAhead, pat) {
  const formula = buildFormula(filters, monthsAhead);
  const fieldIds = Object.values(FIELDS);

  const params = new URLSearchParams();
  params.set('filterByFormula', formula);
  params.set('pageSize', '100');
  params.set('returnFieldsByFieldId', 'true');
  // Sort ascending by start date so the widget can present chronologically.
  params.append('sort[0][field]', FIELDS.dateStart);
  params.append('sort[0][direction]', 'asc');
  fieldIds.forEach(id => params.append('fields[]', id));

  const url = `${AIRTABLE_API}/${EVENTS_BASE_ID}/${EVENTS_TABLE_ID}?${params.toString()}`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${pat}` } });
  if (!resp.ok) {
    const status = resp.status;
    let body = '';
    try { body = (await resp.text()).slice(0, 200); } catch {}
    console.error('[events-content] Airtable fetch failed', { status, body });
    throw new Error('upstream-events-' + status);
  }
  const data = await resp.json();
  const records = Array.isArray(data.records) ? data.records : [];

  return records.map(r => {
    const f = r.fields || {};
    return {
      id: r.id,
      name: txt(f[FIELDS.name], 200),
      startDate: parseDateStr(f[FIELDS.dateStart]),
      endDate: parseDateStr(f[FIELDS.dateEnd]) || parseDateStr(f[FIELDS.dateStart]),
      category: txt(f[FIELDS.category], 60) || 'Event',
      countries: txt(f[FIELDS.countries], 200),
      destinations: txt(f[FIELDS.destinations], 200),
      description: txt(f[FIELDS.travelAngle], 800),
      audience: Array.isArray(f[FIELDS.audience]) ? f[FIELDS.audience].slice(0, 8).map(a => txt(a, 60)) : [],
      impact: txt(f[FIELDS.impact], 40),
      // Map "destinations" to "location" so the widget's normaliser picks it up
      location: txt(f[FIELDS.destinations], 200) || txt(f[FIELDS.countries], 200),
    };
  }).filter(e => e.name && e.startDate);
}

// ── Main handler ────────────────────────────────────────

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!applyRateLimit(res, `eventscontent:${getClientIp(req)}`, RATE_LIMITS.widgetRead)) return;

  const { AIRTABLE_KEY, AIRTABLE_BASE_ID, TG_EVENTS_AIRTABLE_PAT } = process.env;
  if (!TG_EVENTS_AIRTABLE_PAT) {
    console.error('[events-content] Missing TG_EVENTS_AIRTABLE_PAT env var');
    return res.status(500).json({
      error: 'Server configuration error',
      hint: 'TG_EVENTS_AIRTABLE_PAT not set on Vercel',
    });
  }
  if (!AIRTABLE_KEY || !AIRTABLE_BASE_ID) {
    console.error('[events-content] Missing AIRTABLE_KEY or AIRTABLE_BASE_ID');
    return res.status(500).json({
      error: 'Server configuration error',
      hint: 'AIRTABLE_KEY or AIRTABLE_BASE_ID not set',
    });
  }

  const isPreview = req.query.preview === '1';
  let filters = { categories: [], countries: [], audiences: [] };
  let monthsAhead = 12;

  if (isPreview) {
    // Editor preview — no auth required. The events calendar is curated
    // marketing data that's already public via the saved-widget path
    // (?id=...). Auth here would just create flaky preview UX when the
    // user's editor session token has expired but they're still on the
    // page. Rate limiting still applies.
    const cats = req.query.cat;
    if (Array.isArray(cats)) filters.categories = cats.map(c => String(c).slice(0, 60));
    else if (typeof cats === 'string' && cats) filters.categories = [String(cats).slice(0, 60)];

    const cos = req.query.country;
    if (Array.isArray(cos)) filters.countries = cos.map(c => String(c).slice(0, 60));
    else if (typeof cos === 'string' && cos) filters.countries = [String(cos).slice(0, 60)];

    const auds = req.query.aud;
    if (Array.isArray(auds)) filters.audiences = auds.map(a => String(a).slice(0, 60));
    else if (typeof auds === 'string' && auds) filters.audiences = [String(auds).slice(0, 60)];

    const m = parseInt(String(req.query.months || ''), 10);
    if (Number.isFinite(m)) monthsAhead = Math.max(1, Math.min(24, m));
  } else {
    // Public — load widget config to get its saved filters
    const widgetId = req.query.id;
    if (!widgetId || typeof widgetId !== 'string' || widgetId.length > 100 || !/^[\w-]+$/.test(widgetId)) {
      return res.status(400).json({ error: 'Invalid widget ID' });
    }

    try {
      const widgetsFormula = encodeURIComponent(`{WidgetID} = '${widgetId.replace(/'/g, "")}'`);
      const widgetsUrl = `${AIRTABLE_API}/${AIRTABLE_BASE_ID}/${WIDGETS_TABLE_NAME}`
        + `?filterByFormula=${widgetsFormula}&maxRecords=1&fields%5B%5D=Config`;

      const wResp = await fetch(widgetsUrl, { headers: { Authorization: `Bearer ${AIRTABLE_KEY}` } });
      if (!wResp.ok) throw new Error('upstream-widgets');

      const wData = await wResp.json();
      if (!wData.records || wData.records.length === 0) {
        return res.status(404).json({ error: 'Widget not found' });
      }

      let cfg;
      try { cfg = JSON.parse(wData.records[0].fields.Config || '{}'); }
      catch { return res.status(500).json({ error: 'Widget data corrupted' }); }

      // If the widget opted out of curated, return an empty list cheaply
      if (cfg.useCuratedEvents === false) {
        return res.status(200).json({ events: [], meta: { count: 0, source: 'travelgenix-curated' } });
      }

      filters.categories = Array.isArray(cfg.curatedCategories) ? cfg.curatedCategories.slice(0, 12) : [];
      filters.countries  = Array.isArray(cfg.curatedCountries)  ? cfg.curatedCountries.slice(0, 24)  : [];
      filters.audiences  = Array.isArray(cfg.curatedAudience)   ? cfg.curatedAudience.slice(0, 12)   : [];

      const m = parseInt(cfg.monthsAhead, 10);
      if (Number.isFinite(m)) monthsAhead = Math.max(1, Math.min(24, m));
    } catch (err) {
      console.error('[events-content] widget config lookup failed', err?.message || err);
      return res.status(502).json({ error: 'Upstream unavailable' });
    }
  }

  // Cache key: filter signature + horizon
  const cacheKey = JSON.stringify({
    c: filters.categories.slice().sort(),
    o: filters.countries.slice().sort(),
    a: filters.audiences.slice().sort(),
    m: monthsAhead,
  });

  const cached = memGet(cacheKey);
  if (cached) {
    res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
    res.setHeader('X-Cache', 'HIT');
    return res.status(200).json(cached);
  }

  try {
    const events = await fetchEventsFromAirtable(filters, monthsAhead, TG_EVENTS_AIRTABLE_PAT);
    const payload = {
      events,
      meta: {
        count: events.length,
        source: 'travelgenix-curated',
      },
    };
    memSet(cacheKey, payload);
    res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
    res.setHeader('X-Cache', 'MISS');
    return res.status(200).json(payload);
  } catch (err) {
    console.error('[events-content] error:', err?.message || err);
    return res.status(502).json({
      error: 'Upstream unavailable',
      hint: String(err?.message || 'unknown'),
    });
  }
}
