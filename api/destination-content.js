/**
 * Destination Content API (Hardened)
 *
 * Three lookup modes:
 *   1. Public widget mode:   GET /api/destination-content?id=WIDGET_ID
 *      Reads the widget's saved destination from Widgets table, then fetches
 *      the destination record. Used by embedded widgets in the wild.
 *
 *   2. Public slug mode:     GET /api/destination-content?id=WIDGET_ID&slug=greece
 *      Resolves a slug against the widget's lookup order (resort -> city -> country
 *      by default). Returns first match. Used by auto-detect on agent pages.
 *
 *   3. Editor preview mode:  GET /api/destination-content?level=X&recordId=Y
 *      AUTHENTICATED -- used by the Spotlight editor preview before save.
 *
 * Country-fact inheritance:
 *   When fetching a resort or city, the five country-derived facts (Currency,
 *   Language, Voltage, Time Zone, Flight Time From UK) walk up the hierarchy
 *   if blank. Resort blank -> falls back to its parent city. City blank -> falls
 *   back to its parent country. This protects against sparse resort data while
 *   keeping resort-specific content (climate, highlights, events, tags, tagline)
 *   strictly per-record.
 *
 * Security:
 *   - Destination Content PAT is server-only (AIRTABLE_DESTINATION_CONTENT_PAT)
 *   - Rate-limited per IP (in-memory)
 *   - All strings escaped before being returned; URLs validated against allowlist
 *   - Malformed JSON returns empty arrays, never throws to the client
 *   - Generic error responses only -- no stack traces leaked
 *   - Slug input strictly normalised before formula interpolation
 *
 * Response schema (when found):
 *   {
 *     found: true,                      // present in slug mode only
 *     level, name, tagline, heroIntro, region,
 *     images: string[], attributions: string[],
 *     climate: { temps, rainfall, season },
 *     facts: { flightTime, timeZone, currency, language, voltage },
 *     highlights: [{icon,title,description}],
 *     bestForTags: string[],
 *     events: [{month,name,description}],
 *     planning: { priceBand, bookingLead, tripDuration[], visaStatus, visaAdvisory, healthNotes },
 *     pairedWith: [{ name, slug, url }],                // "Pairs well with" sibling destinations
 *     factsInherited: { fact: 'city' | 'country' },     // present-only-if inherited
 *     planningInherited: { field: 'city' | 'country' }  // present-only-if inherited
 *   }
 *
 *   On slug-mode no-match:
 *     200 { found: false }
 *     (Widget treats this as "silently hide".)
 */

import { setCors, applyRateLimit, RATE_LIMITS, requireAuth } from './_auth.js';

const AIRTABLE_API = 'https://api.airtable.com/v0';

// Caching. Destination content is editorial and changes rarely, but the live
// path used to be a 4-6 call Airtable waterfall on every cache miss, so a
// low-traffic client site (not hit within the old 1h window) made a visitor
// wait 1-3s. The public answer is now cached hard at the edge: fresh for an
// hour, then served stale INSTANTLY for a week while it revalidates in the
// background, so a visitor effectively never waits for Airtable. An author's
// edit still appears within the hour (sooner once revalidation runs). The
// editor preview is auth-gated and must always be live, so it is never cached.
const PUBLIC_CACHE = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=604800';
const PREVIEW_CACHE = 'private, no-store';

// The Widgets base (where we store widget configs) -- reuses existing AIRTABLE_KEY
const WIDGETS_TABLE_NAME = 'Widgets';

// The Destination Content base (read-only, separate PAT)
const DESTINATION_BASE_ID = 'appuZdlMJ7HKUt6qS';

// Per-level lookup of table IDs and the Spotlight field IDs.
// `slug` is the URL Slug field used for slug-mode lookups.
// `parentLink` is the linked-record field pointing up to the parent level.
const LEVEL_MAP = {
  country: {
    tableId: 'tblsxbqbyhTDoWhbo',
    parentLink: null,
    fields: {
      name:           'flddJJrpwcXOwWIow',
      slug:           'fldDwZVR1C63K4HGT',
      heroIntro:      'fldv3l23pOs8Yj3px',
      images:         'fldTqpNZX5n1219mh',
      attributions:   'fldVxxvianhuEj11t',
      tagline:        'fldjpYZsvAdMt1KlW',
      region:         'fldADwbC9R6R6jr35',
      climateTemps:   'flda8AY7qIO5BQJyI',
      climateRain:    'fldJNzwIVJEHrHZZr',
      climateSeason:  'fldqx5p1U0siNtvYy',
      flightTime:     'fldGPxNRuf9xao0He',
      timeZone:       'fldOqkxbOYfxL1Qxt',
      currency:       'fldoe2LemU2kZS3EP',
      language:       'fldypaRO1PZgwom22',
      voltage:        'fld5gv8Q7I0VrYib5',
      highlightsJson: 'fldOFmB8E9rDvgQEZ',
      bestForTags:    'fldC5ZvX1hitoxWY6',
      eventsJson:     'fldylxHJYE7PtQ86s',
      // Planning / "Good to know" panel. The country is the source of truth for
      // these; resort and city Spotlights inherit them when blank (see below).
      priceBand:      'fldJOZeflKobE2o9g',
      bookingLead:    'fld3JLyT3MsMGWVT4',
      tripDuration:   'flduOcMEuPq3cnVG5',
      visaStatus:     'fldmKvRkDDRjj7PT2',
      visaAdvisory:   'fldecKeSnkZ6ABZfd',
      healthNotes:    'fldOGSgbbH3BIoU6A',
      bestPaired:     'fldgP3ncmDU6LNOS4', // Best Paired With (Countries)
    },
  },
  city: {
    tableId: 'tblTkKujdVZgWPAQe',
    parentLink: 'fldmJaOJZcMFtJNZD', // Country (multipleRecordLinks)
    fields: {
      name:           'fld2VkY61c1JKUWKB',
      slug:           'fldL6MlFZgZMW25Vp',
      heroIntro:      'fldijlzHjf9BvhPJI',
      images:         'fldt3898YIanGbfzc',
      attributions:   'fldzdo1vtYbAvpt0v',
      tagline:        'fldIu4zaqZZ7XUHZn',
      region:         'fld1pD6llYo3Q8WlJ',
      climateTemps:   'fldxjOSYkYRPOZQgx',
      climateRain:    'fldl296lX37f8stws',
      climateSeason:  'fldHwvHjSwkpEgFa2',
      flightTime:     'fldjhp4H3MHcjLQbG',
      timeZone:       'fldftMgM4Z3XQYNcf',
      currency:       'fldyVpNjyezPfVeRM',
      language:       'fldFUbivACHoLzGkO',
      voltage:        'fldebFrJI6MHeRJsZ',
      highlightsJson: 'fld1moM61DARrsBwr',
      bestForTags:    'fldZQTVNuqRXHileW',
      eventsJson:     'fldxze1iXQRrJ0UZW',
      // City can carry its own Trip Duration; price band / booking / visa / health
      // are not held at city level and inherit from the parent country.
      tripDuration:   'fldPSVfkYVAIhtNDp',
      bestPaired:     'fldNVIjyXYu8R7Fbk', // Best Paired With (Cities)
    },
  },
  resort: {
    tableId: 'tblwV9gnbVEyZ99gI',
    parentLink: 'fldrUx3VrEMJPheIP', // City/Region (multipleRecordLinks)
    fields: {
      name:           'fldnvOipaWpG3W1rx',
      slug:           'fldwVxLg8V4CBi90B',
      heroIntro:      'fld9NFRPv1MVRL4G9',
      images:         'fldBMns5p5ChZCriU',
      attributions:   'fldMn6hYB1o5OwJpN',
      tagline:        'fldwMqygnNpKvf9KO',
      region:         'fldF9hitGwa75MYBa',
      climateTemps:   'fld7m7s8LXamDaKzP',
      climateRain:    'fldCuW6FzzetUe0tV',
      climateSeason:  'fld5RyPuxYdFFIFhb',
      flightTime:     'fldMlw191r1T3lFXe',
      timeZone:       'fldyV0RY9yxqDEJvR',
      currency:       'fldGNJTsJWk7VnUWf',
      language:       'fldX1CJSFmL8NKu3w',
      voltage:        'fldnjJpthgX61yp47',
      highlightsJson: 'fldUyjDhtoA43hdHv',
      bestForTags:    'fldTmH3gT1wT48PLn',
      eventsJson:     'fldWRl0d0z1MY6DMq',
      bestPaired:     'fldQflINufhsgS6so', // Best Paired With (Resorts)
    },
  },
};

// The five country-derived facts that walk up the hierarchy when blank.
// Resort blank -> city. City blank -> country. Per the design decision,
// climate / highlights / events / tags / tagline / heroIntro / images do NOT
// inherit -- sparse data at resort level shows as missing data so the
// completeness pills can flag it.
const INHERITABLE_FACTS = ['flightTime', 'timeZone', 'currency', 'language', 'voltage'];

// Planning values that also walk up the hierarchy when blank. Visa, health, price
// band and booking lead are country-level realities, so a resort or city Spotlight
// inherits them from its country. Trip duration can be set per city, and inherits
// only when the city/resort leaves it blank.
const INHERITABLE_PLANNING = ['priceBand', 'bookingLead', 'tripDuration', 'visaStatus', 'visaAdvisory', 'healthNotes'];

// The full set walked by inheritCountryFacts (quick facts plus planning).
const INHERITABLE_KEYS = INHERITABLE_FACTS.concat(INHERITABLE_PLANNING);

const ICON_VOCAB = new Set([
  'mountain','sunset','wine','water','palm','city','temple','beach','food',
  'star','camera','heart','building','map','compass','sun','snowflake',
]);

const TAG_VOCAB = new Set([
  // Original 20
  'Couples','Honeymoons','Families','Food and Wine','Photography','Beach',
  'Adventure','Luxury','Budget','City Break','Culture','Nightlife','Wellness',
  'Wildlife','Winter Sun','Summer Sun','Skiing','Multi Generation','Solo Travel',
  'Romance',
  // P1 expansion (12) -- travel-trade specific, activity, audience, values
  'All-Inclusive','Cruise','Short Break','Long-Haul','School Holidays',
  'Diving','Hiking','Golf','Spa Retreat','Wedding Destination',
  'Eco / Sustainable','LGBTQ+ Friendly',
]);

const URL_RE = /^https?:\/\/[^\s<>"']+$/i;

// Lookup-order tokens we accept. Anything else is rejected.
const VALID_LEVELS = new Set(['country', 'city', 'resort']);
const DEFAULT_LOOKUP_ORDER = ['resort', 'city', 'country'];

// ---- Helpers ----

function txt(value, maxLen = 500) {
  if (typeof value !== 'string') return '';
  return value.replace(/<[^>]*>/g, '').trim().slice(0, maxLen);
}

// Treat null/undefined, blank/whitespace strings and empty arrays as "blank" so
// inheritance fills them from a parent level. Non-empty values pass through.
function isBlankVal(v) {
  if (v == null) return true;
  if (typeof v === 'string') return !v.trim();
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

// Normalise a singleSelect value to its option name. Airtable's REST API returns
// select values as plain name strings; we also tolerate the {id,name} object
// shape as belt-and-braces (same posture as parseBestForTags).
function selName(v) {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && typeof v.name === 'string') return v.name;
  return '';
}

// Normalise a multipleSelects value to a clean array of option-name strings.
function selList(value, max = 6) {
  if (!Array.isArray(value)) return [];
  return value.map(selName).map(s => txt(s, 30)).filter(Boolean).slice(0, max);
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
  return str.split(/\r?\n/).map(s => s.trim()).filter(s => s && URL_RE.test(s)).slice(0, maxCount);
}

function parseMultilineText(str, maxCount = 10, maxLen = 300) {
  if (typeof str !== 'string') return [];
  return str.split(/\r?\n/).map(s => txt(s, maxLen)).filter(Boolean).slice(0, maxCount);
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
  if (!Array.isArray(value)) return [];
  return value
    .map(v => typeof v === 'string' ? v : (v && typeof v.name === 'string' ? v.name : null))
    .filter(v => v && TAG_VOCAB.has(v))
    .slice(0, 20);
}

// Slug normaliser. Maps every reasonable URL slug variant to a canonical form
// so 'Costa Del Sol', 'costa-del-sol', 'costa_del_sol', 'COSTA-DEL-SOL' all
// match each other.
function normaliseSlug(s) {
  if (typeof s !== 'string') return '';
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

// ---- In-memory per-instance cache ----
const memCache = new Map();
const MEM_TTL_MS = 5 * 60 * 1000;
const MEM_MAX = 1000;

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

// ---- Airtable fetch helpers ----

async function airtableFetch(url, pat) {
  // Timeout so a slow Airtable returns a clean error rather than hanging the
  // function to its ceiling and emitting an empty gateway body (23 Jul 2026 audit).
  const resp = await fetch(url, {
    headers: { 'Authorization': `Bearer ${pat}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!resp.ok) {
    const err = new Error(`Airtable upstream ${resp.status}`);
    err.status = resp.status;
    throw err;
  }
  return resp.json();
}

// Fetch a single record by record ID, returning the full fields map by field ID.
async function fetchRecordById(level, recordId, pat) {
  const map = LEVEL_MAP[level];
  const fieldIds = Object.values(map.fields);
  if (map.parentLink) fieldIds.push(map.parentLink);

  const qs = new URLSearchParams();
  qs.append('filterByFormula', `RECORD_ID()='${recordId}'`);
  qs.append('maxRecords', '1');
  fieldIds.forEach(id => qs.append('fields[]', id));
  qs.append('returnFieldsByFieldId', 'true');

  const url = `${AIRTABLE_API}/${DESTINATION_BASE_ID}/${map.tableId}?${qs.toString()}`;
  const data = await airtableFetch(url, pat);
  if (!data.records || data.records.length === 0) return null;
  return data.records[0].fields || null;
}

// Fetch by slug. Returns { recordId, fields } or null.
// Slug input is already normaliseSlug-cleaned (only [a-z0-9-] survives), so it's
// safe to interpolate into the formula.
async function fetchRecordBySlug(level, slugCanonical, pat) {
  const map = LEVEL_MAP[level];
  const fieldIds = Object.values(map.fields);
  if (map.parentLink) fieldIds.push(map.parentLink);

  // Match against the stored URL Slug, lowercased and with the most common
  // separators (space, underscore, slash) replaced with hyphens. After that
  // we still do a JS-side final equality check using normaliseSlug for safety.
  const slugFieldRef = `{URL Slug}`;
  const formula =
    `OR(` +
      `LOWER(${slugFieldRef})='${slugCanonical}',` +
      `LOWER(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(${slugFieldRef},' ','-'),'_','-'),'/','-'))='${slugCanonical}'` +
    `)`;

  const qs = new URLSearchParams();
  qs.append('filterByFormula', formula);
  qs.append('maxRecords', '5');
  fieldIds.forEach(id => qs.append('fields[]', id));
  qs.append('returnFieldsByFieldId', 'true');

  const url = `${AIRTABLE_API}/${DESTINATION_BASE_ID}/${map.tableId}?${qs.toString()}`;
  const data = await airtableFetch(url, pat);
  if (!data.records || data.records.length === 0) return null;

  const slugFieldId = map.fields.slug;
  for (const r of data.records) {
    const stored = r.fields ? r.fields[slugFieldId] : '';
    if (normaliseSlug(stored) === slugCanonical) {
      return { recordId: r.id, fields: r.fields || {} };
    }
  }
  return null;
}

// Walks up the parent chain to fill the five country-inherited facts.
// `fields` is the raw Airtable fields-by-id map. Returns an object describing
// which inherited values were populated and from which level.
async function inheritCountryFacts(level, fields, pat) {
  const map = LEVEL_MAP[level];
  if (!map.parentLink) return { values: {}, sources: {} };

  const blanks = INHERITABLE_KEYS.filter(key => isBlankVal(fields[map.fields[key]]));
  if (blanks.length === 0) return { values: {}, sources: {} };

  const parentLinks = fields[map.parentLink];
  if (!Array.isArray(parentLinks) || parentLinks.length === 0) {
    return { values: {}, sources: {} };
  }
  const parentId = parentLinks[0];
  if (typeof parentId !== 'string' || !/^rec[A-Za-z0-9]{14}$/.test(parentId)) {
    return { values: {}, sources: {} };
  }

  const parentLevel = level === 'resort' ? 'city' : 'country';
  let parentFields;
  try {
    parentFields = await fetchRecordById(parentLevel, parentId, pat);
  } catch {
    return { values: {}, sources: {} };
  }
  if (!parentFields) return { values: {}, sources: {} };

  const values = {};
  const sources = {};
  const stillBlank = [];
  const parentMap = LEVEL_MAP[parentLevel];

  for (const key of blanks) {
    const pVal = parentFields[parentMap.fields[key]];
    if (!isBlankVal(pVal)) {
      values[key] = pVal;
      sources[key] = parentLevel;
    } else {
      stillBlank.push(key);
    }
  }

  // If we are at resort level and still have blanks, walk one more step up
  // through the city -> country chain.
  if (level === 'resort' && stillBlank.length > 0 && parentMap.parentLink) {
    const grandLinks = parentFields[parentMap.parentLink];
    if (Array.isArray(grandLinks) && grandLinks.length > 0) {
      const grandId = grandLinks[0];
      if (typeof grandId === 'string' && /^rec[A-Za-z0-9]{14}$/.test(grandId)) {
        let grandFields;
        try {
          grandFields = await fetchRecordById('country', grandId, pat);
        } catch {
          grandFields = null;
        }
        if (grandFields) {
          for (const key of stillBlank) {
            const gVal = grandFields[LEVEL_MAP.country.fields[key]];
            if (!isBlankVal(gVal)) {
              values[key] = gVal;
              sources[key] = 'country';
            }
          }
        }
      }
    }
  }

  return { values, sources };
}

// Plural URL segment per level, matching the destination-page convention used by
// the airport widget (/destinations/cities/<slug>, /destinations/resorts/<slug>).
const LEVEL_PLURAL = { country: 'countries', city: 'cities', resort: 'resorts' };

// Resolve the "Best paired with" links into a small list of sibling destinations
// for the "Pairs well with" section. Best Paired With always links to the same
// level (country->countries, city->cities, resort->resorts), so one batched
// fetch against the same table returns every pair's name and slug.
async function resolvePaired(level, fields, pat) {
  const map = LEVEL_MAP[level];
  const raw = fields[map.fields.bestPaired];
  const ids = (Array.isArray(raw) ? raw : [])
    .filter(id => typeof id === 'string' && /^rec[A-Za-z0-9]{14}$/.test(id))
    .slice(0, 6);
  if (ids.length === 0) return [];

  const nameId = map.fields.name;
  const slugId = map.fields.slug;
  const plural = LEVEL_PLURAL[level] || '';

  const qs = new URLSearchParams();
  qs.append('filterByFormula', `OR(${ids.map(id => `RECORD_ID()='${id}'`).join(',')})`);
  qs.append('maxRecords', String(ids.length));
  qs.append('fields[]', nameId);
  qs.append('fields[]', slugId);
  qs.append('returnFieldsByFieldId', 'true');
  const url = `${AIRTABLE_API}/${DESTINATION_BASE_ID}/${map.tableId}?${qs.toString()}`;

  let data;
  try { data = await airtableFetch(url, pat); }
  catch (err) { console.error('[destination-content] paired resolve error:', err?.message || err); return []; }

  const byId = {};
  for (const r of (data.records || [])) byId[r.id] = r.fields || {};

  // Preserve the order the links were stored in.
  return ids.map(id => {
    const f = byId[id];
    if (!f) return null;
    const name = txt(f[nameId], 80);
    if (!name) return null;
    const slug = txt(f[slugId], 100);
    const href = (slug && plural) ? `/destinations/${plural}/${encodeURIComponent(slug)}` : '';
    return { name, slug, url: href };
  }).filter(Boolean);
}

// Build the public response payload from raw Airtable fields.
// `recordId` is echoed back so clients can key per-destination content
// overrides by `level:recordId` — the same key in fixed and auto-detect mode.
function shapePayload(level, fields, inherited, paired, recordId) {
  const map = LEVEL_MAP[level];
  const f = fields || {};

  const factVal = (key) => {
    const own = f[map.fields[key]];
    if (own && (typeof own !== 'string' || own.trim())) return own;
    return inherited.values[key] || '';
  };

  const factsInherited = {};
  for (const key of INHERITABLE_FACTS) {
    if (inherited.sources[key]) factsInherited[key] = inherited.sources[key];
  }

  // Planning panel: own value when present, else the value inherited from a parent.
  const planVal = (key) => {
    const own = f[map.fields[key]];
    return isBlankVal(own) ? inherited.values[key] : own;
  };
  const planningInherited = {};
  for (const key of INHERITABLE_PLANNING) {
    if (inherited.sources[key]) planningInherited[key] = inherited.sources[key];
  }

  return {
    level,
    recordId: typeof recordId === 'string' ? recordId : '',
    name: txt(f[map.fields.name], 120),
    tagline: txt(f[map.fields.tagline], 200),
    heroIntro: txt(f[map.fields.heroIntro], 600),
    region: txt(f[map.fields.region], 120),
    images: parseMultilineUrls(f[map.fields.images]),
    attributions: parseMultilineText(f[map.fields.attributions]),
    climate: {
      temps:    parseCsvInts(f[map.fields.climateTemps])    || [],
      rainfall: parseCsvInts(f[map.fields.climateRain])     || [],
      season:   parseCsvSeason(f[map.fields.climateSeason]) || [],
    },
    facts: {
      flightTime: txt(factVal('flightTime'), 60),
      timeZone:   txt(factVal('timeZone'),   40),
      currency:   txt(factVal('currency'),   80),
      language:   txt(factVal('language'),   80),
      voltage:    txt(factVal('voltage'),    60),
    },
    highlights: parseHighlights(f[map.fields.highlightsJson]),
    bestForTags: parseBestForTags(f[map.fields.bestForTags]),
    events: parseEvents(f[map.fields.eventsJson]),
    planning: {
      priceBand:    txt(selName(planVal('priceBand')), 16),
      bookingLead:  txt(selName(planVal('bookingLead')), 60),
      tripDuration: selList(planVal('tripDuration'), 6),
      visaStatus:   txt(selName(planVal('visaStatus')), 60),
      visaAdvisory: txt(planVal('visaAdvisory'), 1500),
      healthNotes:  txt(planVal('healthNotes'), 1500),
    },
    planningInherited,
    factsInherited,
    pairedWith: Array.isArray(paired) ? paired : [],
  };
}

// Resolve a slug across the levels in `lookupOrder` (most specific first).
async function resolveSlug(slugCanonical, lookupOrder, pat) {
  for (const level of lookupOrder) {
    if (!LEVEL_MAP[level]) continue;
    const hit = await fetchRecordBySlug(level, slugCanonical, pat);
    if (hit) return { level, recordId: hit.recordId, fields: hit.fields };
  }
  return null;
}

// Read the widget config from the Widgets table to extract destination + autoDetect.
async function readWidgetConfig(widgetId, key) {
  const formula = encodeURIComponent(`{WidgetID} = '${widgetId}'`);
  const url = `${AIRTABLE_API}/${process.env.AIRTABLE_BASE_ID}/${WIDGETS_TABLE_NAME}`
    + `?filterByFormula=${formula}&maxRecords=1&fields%5B%5D=Config`;
  const resp = await fetch(url, {
    headers: { 'Authorization': `Bearer ${key}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!resp.ok) {
    const err = new Error(`Widgets fetch ${resp.status}`);
    err.status = resp.status;
    throw err;
  }
  const data = await resp.json();
  if (!data.records || data.records.length === 0) return null;
  let config;
  try { config = JSON.parse(data.records[0].fields.Config || '{}'); }
  catch { return null; }
  return config;
}

// ---- Main handler ----

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!applyRateLimit(res, `destcontent:${getClientIp(req)}`, RATE_LIMITS.widgetRead)) return;

  const { AIRTABLE_KEY, AIRTABLE_BASE_ID, AIRTABLE_DESTINATION_CONTENT_PAT } = process.env;
  if (!AIRTABLE_KEY || !AIRTABLE_BASE_ID || !AIRTABLE_DESTINATION_CONTENT_PAT) {
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const directLevel = typeof req.query.level === 'string' ? req.query.level : '';
  const directRecord = typeof req.query.recordId === 'string' ? req.query.recordId : '';
  const isDirect = Boolean(directLevel || directRecord);

  // Slug-mode params (used with id=)
  const slugRaw = typeof req.query.slug === 'string' ? req.query.slug : '';
  const slug = normaliseSlug(slugRaw);
  const orderRaw = typeof req.query.order === 'string' ? req.query.order : '';

  let level, recordId;

  // ---- Branch 1: Editor preview (auth-gated direct level/recordId) ----
  if (isDirect) {
    const auth = requireAuth(req);
    if (auth.error) return res.status(auth.status).json({ error: auth.error });
    if (!LEVEL_MAP[directLevel] || !/^rec[A-Za-z0-9]{14}$/.test(directRecord)) {
      return res.status(400).json({ error: 'Invalid level or recordId' });
    }
    level = directLevel;
    recordId = directRecord;

  } else {
    // ---- Branch 2 + 3: Public widget mode ----
    const widgetId = req.query.id;
    if (!widgetId || typeof widgetId !== 'string' || widgetId.length > 100 || !/^[\w-]+$/.test(widgetId)) {
      return res.status(400).json({ error: 'Invalid widget ID' });
    }

    let widgetConfig;
    try {
      widgetConfig = await readWidgetConfig(widgetId, AIRTABLE_KEY);
    } catch (err) {
      console.error('[destination-content] widget read error:', err?.message || err);
      return res.status(502).json({ error: 'Upstream unavailable' });
    }
    if (!widgetConfig) return res.status(404).json({ error: 'Widget not found' });

    // Slug mode: find a destination by slug, scoped by the widget's lookup order
    if (slug) {
      let lookupOrder;
      if (orderRaw) {
        lookupOrder = orderRaw.split(',')
          .map(s => s.trim().toLowerCase())
          .filter(s => VALID_LEVELS.has(s));
      } else if (widgetConfig.autoDetect && Array.isArray(widgetConfig.autoDetect.lookupOrder)) {
        lookupOrder = widgetConfig.autoDetect.lookupOrder
          .filter(s => typeof s === 'string' && VALID_LEVELS.has(s));
      }
      if (!lookupOrder || lookupOrder.length === 0) {
        lookupOrder = DEFAULT_LOOKUP_ORDER.slice();
      }
      // De-dup while preserving order
      lookupOrder = lookupOrder.filter((v, i, a) => a.indexOf(v) === i);

      const slugCacheKey = `slug:${slug}:${lookupOrder.join(',')}`;
      const slugCached = memGet(slugCacheKey);
      if (slugCached) {
        res.setHeader('Cache-Control', PUBLIC_CACHE);
        res.setHeader('X-Cache', 'HIT');
        return res.status(200).json(slugCached);
      }

      let resolved;
      try {
        resolved = await resolveSlug(slug, lookupOrder, AIRTABLE_DESTINATION_CONTENT_PAT);
      } catch (err) {
        console.error('[destination-content] slug resolve error:', err?.message || err);
        return res.status(502).json({ error: 'Upstream unavailable' });
      }

      if (!resolved) {
        // Found nothing. Slug-mode contract: 200 with found:false so the widget
        // can silently hide rather than show an error state.
        const empty = { found: false };
        memSet(slugCacheKey, empty);
        res.setHeader('Cache-Control', PUBLIC_CACHE);
        res.setHeader('X-Cache', 'MISS');
        return res.status(200).json(empty);
      }

      let inherited = { values: {}, sources: {} };
      try {
        inherited = await inheritCountryFacts(resolved.level, resolved.fields, AIRTABLE_DESTINATION_CONTENT_PAT);
      } catch (err) {
        console.error('[destination-content] inheritance error:', err?.message || err);
      }
      let paired = [];
      try {
        paired = await resolvePaired(resolved.level, resolved.fields, AIRTABLE_DESTINATION_CONTENT_PAT);
      } catch (err) {
        console.error('[destination-content] paired error:', err?.message || err);
      }
      const payload = { found: true, ...shapePayload(resolved.level, resolved.fields, inherited, paired, resolved.recordId) };
      memSet(slugCacheKey, payload);
      res.setHeader('Cache-Control', PUBLIC_CACHE);
      res.setHeader('X-Cache', 'MISS');
      return res.status(200).json(payload);
    }

    // No slug -- fall through to the widget's saved fixed destination
    const dest = widgetConfig.destination || {};
    level = dest.level;
    recordId = dest.recordId;
    if (!level || !LEVEL_MAP[level] || !recordId || typeof recordId !== 'string' || !/^rec[A-Za-z0-9]{14}$/.test(recordId)) {
      return res.status(400).json({ error: 'Widget has no destination configured' });
    }
  }

  // ---- Resolve and shape ----
  try {
    const cacheKey = `${level}:${recordId}`;
    const cached = memGet(cacheKey);
    if (cached) {
      res.setHeader('Cache-Control', isDirect ? PREVIEW_CACHE : PUBLIC_CACHE);
      res.setHeader('X-Cache', 'HIT');
      return res.status(200).json(cached);
    }

    let fields;
    try {
      fields = await fetchRecordById(level, recordId, AIRTABLE_DESTINATION_CONTENT_PAT);
    } catch (err) {
      console.error('[destination-content] record fetch failed', { status: err?.status, level, recordId });
      return res.status(502).json({
        error: 'Upstream unavailable',
        hint: `destination-fetch-${err?.status || 'unknown'}`,
      });
    }
    if (!fields) return res.status(404).json({ error: 'Destination not found' });

    let inherited = { values: {}, sources: {} };
    try {
      inherited = await inheritCountryFacts(level, fields, AIRTABLE_DESTINATION_CONTENT_PAT);
    } catch (err) {
      console.error('[destination-content] inheritance error:', err?.message || err);
    }

    let paired = [];
    try {
      paired = await resolvePaired(level, fields, AIRTABLE_DESTINATION_CONTENT_PAT);
    } catch (err) {
      console.error('[destination-content] paired error:', err?.message || err);
    }

    const payload = shapePayload(level, fields, inherited, paired, recordId);
    memSet(cacheKey, payload);

    res.setHeader('Cache-Control', isDirect ? PREVIEW_CACHE : PUBLIC_CACHE);
    res.setHeader('X-Cache', 'MISS');
    return res.status(200).json(payload);

  } catch (err) {
    console.error('[destination-content] error:', err?.message || err);
    return res.status(502).json({ error: 'Upstream unavailable' });
  }
}
