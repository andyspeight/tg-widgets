/**
 * Destination Completeness API (Hardened)
 *
 * Two modes:
 *   1. Single check:    GET /api/destination-completeness?level=X&recordId=Y
 *      Returns full per-section breakdown for one destination. Used after the
 *      agent picks a destination in the editor picker.
 *
 *   2. Batch check:     POST /api/destination-completeness
 *      Body: { items: [{level,recordId}, ...] }  (max 20)
 *      Returns a tier badge ('complete'|'partial'|'empty') for each. Used to
 *      decorate search results in the picker dropdown.
 *
 * Sections checked:
 *   - hero        (hero image + tagline OR heroIntro)
 *   - climate     (12 temps + 12 season tokens)
 *   - facts       (at least 1 of the 5 country-derived facts; counts inherited)
 *   - highlights  (at least 1 valid highlight in JSON)
 *   - tags        (at least 1 tag)
 *   - events      (at least 1 valid event in JSON)
 *
 * Tier rules:
 *   - complete  = all 6 sections populated
 *   - partial   = 1-5 sections populated
 *   - empty     = 0 sections populated
 *
 * Why authenticated:
 *   This endpoint exposes the destination catalogue's data state. Same
 *   protection model as destination-search (which is auth-gated) -- we don't
 *   want anonymous users mining the database.
 *
 * Security:
 *   - Auth required (Bearer session token from /api/widget-auth)
 *   - Rate-limited per user
 *   - Input sanitised before record-ID interpolation
 *   - PAT is server-only
 *
 * Response (single):
 *   {
 *     level, recordId, name,
 *     tier: 'complete' | 'partial' | 'empty',
 *     sections: {
 *       hero: boolean, climate: boolean, facts: boolean,
 *       highlights: boolean, tags: boolean, events: boolean
 *     },
 *     factsInherited: { fact: 'city'|'country' }   // present-only-if inherited
 *   }
 *
 * Response (batch):
 *   {
 *     results: [{ level, recordId, tier }, ...]   // input order preserved
 *   }
 */

import { setCors, applyRateLimit, RATE_LIMITS, requireAuth } from './_auth.js';

const AIRTABLE_API = 'https://api.airtable.com/v0';
const DESTINATION_BASE_ID = 'appuZdlMJ7HKUt6qS';

// Field IDs we need to assess completeness. Kept minimal -- we don't need
// every Spotlight field, just enough to tell whether each section would
// render. Mirrors the LEVEL_MAP shape in destination-content.js but only
// the fields we read here.
const COMPLETENESS_MAP = {
  country: {
    tableId: 'tblsxbqbyhTDoWhbo',
    parentLink: null,
    name:           'flddJJrpwcXOwWIow',
    tagline:        'fldjpYZsvAdMt1KlW',
    heroIntro:      'fldv3l23pOs8Yj3px',
    images:         'fldTqpNZX5n1219mh',
    climateTemps:   'flda8AY7qIO5BQJyI',
    climateSeason:  'fldqx5p1U0siNtvYy',
    flightTime:     'fldGPxNRuf9xao0He',
    timeZone:       'fldOqkxbOYfxL1Qxt',
    currency:       'fldoe2LemU2kZS3EP',
    language:       'fldypaRO1PZgwom22',
    voltage:        'fld5gv8Q7I0VrYib5',
    highlightsJson: 'fldOFmB8E9rDvgQEZ',
    bestForTags:    'fldC5ZvX1hitoxWY6',
    eventsJson:     'fldylxHJYE7PtQ86s',
  },
  city: {
    tableId: 'tblTkKujdVZgWPAQe',
    parentLink: 'fldmJaOJZcMFtJNZD',
    name:           'fld2VkY61c1JKUWKB',
    tagline:        'fldIu4zaqZZ7XUHZn',
    heroIntro:      'fldijlzHjf9BvhPJI',
    images:         'fldt3898YIanGbfzc',
    climateTemps:   'fldxjOSYkYRPOZQgx',
    climateSeason:  'fldHwvHjSwkpEgFa2',
    flightTime:     'fldjhp4H3MHcjLQbG',
    timeZone:       'fldftMgM4Z3XQYNcf',
    currency:       'fldyVpNjyezPfVeRM',
    language:       'fldFUbivACHoLzGkO',
    voltage:        'fldebFrJI6MHeRJsZ',
    highlightsJson: 'fld1moM61DARrsBwr',
    bestForTags:    'fldZQTVNuqRXHileW',
    eventsJson:     'fldxze1iXQRrJ0UZW',
  },
  resort: {
    tableId: 'tblwV9gnbVEyZ99gI',
    parentLink: 'fldrUx3VrEMJPheIP',
    name:           'fldnvOipaWpG3W1rx',
    tagline:        'fldwMqygnNpKvf9KO',
    heroIntro:      'fld9NFRPv1MVRL4G9',
    images:         'fldBMns5p5ChZCriU',
    climateTemps:   'fld7m7s8LXamDaKzP',
    climateSeason:  'fld5RyPuxYdFFIFhb',
    flightTime:     'fldMlw191r1T3lFXe',
    timeZone:       'fldyV0RY9yxqDEJvR',
    currency:       'fldGNJTsJWk7VnUWf',
    language:       'fldX1CJSFmL8NKu3w',
    voltage:        'fldnjJpthgX61yp47',
    highlightsJson: 'fldUyjDhtoA43hdHv',
    bestForTags:    'fldTmH3gT1wT48PLn',
    eventsJson:     'fldWRl0d0z1MY6DMq',
  },
};

const INHERITABLE_FACTS = ['flightTime', 'timeZone', 'currency', 'language', 'voltage'];
const VALID_LEVELS = new Set(['country', 'city', 'resort']);

const URL_RE = /^https?:\/\/[^\s<>"']+$/i;

const RECORD_ID_RE = /^rec[A-Za-z0-9]{14}$/;

const BATCH_MAX = 20;

// ---- Helpers ----

function nonBlankString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function hasAnyImage(v) {
  if (typeof v !== 'string') return false;
  return v.split(/\r?\n/).some(line => URL_RE.test(line.trim()));
}

function isValidClimateCsv(temps, season) {
  if (typeof temps !== 'string' || typeof season !== 'string') return false;
  const t = temps.split(',').map(s => s.trim());
  const s = season.split(',').map(s => s.trim().toLowerCase());
  if (t.length !== 12 || s.length !== 12) return false;
  if (t.some(p => !Number.isFinite(Number(p)))) return false;
  const valid = new Set(['best','shoulder','off']);
  if (s.some(p => !valid.has(p))) return false;
  return true;
}

function hasAnyJsonItem(s, requiredKeys) {
  if (typeof s !== 'string' || !s.trim()) return false;
  let arr;
  try { arr = JSON.parse(s); } catch { return false; }
  if (!Array.isArray(arr) || arr.length === 0) return false;
  return arr.some(item => item && typeof item === 'object' &&
    requiredKeys.every(k => nonBlankString(item[k])));
}

function hasAnyTag(v) {
  return Array.isArray(v) && v.length > 0;
}

// ---- Airtable fetch ----

async function airtableFetch(url, pat) {
  const resp = await fetch(url, {
    headers: { 'Authorization': `Bearer ${pat}` },
  });
  if (!resp.ok) {
    const err = new Error(`Airtable upstream ${resp.status}`);
    err.status = resp.status;
    throw err;
  }
  return resp.json();
}

// Fetch a record's completeness fields by ID. Optionally walks up to fill the
// five inheritable facts so the assessment matches what the widget would render.
async function fetchForCompleteness(level, recordId, pat, opts = {}) {
  const map = COMPLETENESS_MAP[level];
  const fieldIds = [
    map.name, map.tagline, map.heroIntro, map.images,
    map.climateTemps, map.climateSeason,
    map.flightTime, map.timeZone, map.currency, map.language, map.voltage,
    map.highlightsJson, map.bestForTags, map.eventsJson,
  ];
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

// Walk parent chain to find inherited fact values. Mirrors destination-content.js
// but only returns the source-level map (not values, which we don't need here --
// we just need to know if the section will render).
async function inheritedFactSources(level, fields, pat) {
  const map = COMPLETENESS_MAP[level];
  if (!map.parentLink) return {};

  const blanks = INHERITABLE_FACTS.filter(key => !nonBlankString(fields[map[key]]));
  if (blanks.length === 0) return {};

  const parentLinks = fields[map.parentLink];
  if (!Array.isArray(parentLinks) || parentLinks.length === 0) return {};
  const parentId = parentLinks[0];
  if (typeof parentId !== 'string' || !RECORD_ID_RE.test(parentId)) return {};

  const parentLevel = level === 'resort' ? 'city' : 'country';
  let parentFields;
  try { parentFields = await fetchForCompleteness(parentLevel, parentId, pat); }
  catch { return {}; }
  if (!parentFields) return {};

  const sources = {};
  const stillBlank = [];
  const parentMap = COMPLETENESS_MAP[parentLevel];

  for (const key of blanks) {
    if (nonBlankString(parentFields[parentMap[key]])) {
      sources[key] = parentLevel;
    } else {
      stillBlank.push(key);
    }
  }

  if (level === 'resort' && stillBlank.length > 0 && parentMap.parentLink) {
    const grandLinks = parentFields[parentMap.parentLink];
    if (Array.isArray(grandLinks) && grandLinks.length > 0) {
      const grandId = grandLinks[0];
      if (typeof grandId === 'string' && RECORD_ID_RE.test(grandId)) {
        let grandFields;
        try { grandFields = await fetchForCompleteness('country', grandId, pat); }
        catch { grandFields = null; }
        if (grandFields) {
          for (const key of stillBlank) {
            if (nonBlankString(grandFields[COMPLETENESS_MAP.country[key]])) {
              sources[key] = 'country';
            }
          }
        }
      }
    }
  }
  return sources;
}

// Assess section presence and roll up to a tier.
function assessSections(level, fields, inheritedSources) {
  const map = COMPLETENESS_MAP[level];

  const heroIntro = fields[map.heroIntro];
  const tagline = fields[map.tagline];
  const heroOk = hasAnyImage(fields[map.images]) && (nonBlankString(tagline) || nonBlankString(heroIntro));

  const climateOk = isValidClimateCsv(fields[map.climateTemps], fields[map.climateSeason]);

  const factsOwn = INHERITABLE_FACTS.some(k => nonBlankString(fields[map[k]]));
  const factsInherited = Object.keys(inheritedSources || {}).length > 0;
  const factsOk = factsOwn || factsInherited;

  const highlightsOk = hasAnyJsonItem(fields[map.highlightsJson], ['title']);
  const tagsOk = hasAnyTag(fields[map.bestForTags]);
  const eventsOk = hasAnyJsonItem(fields[map.eventsJson], ['name']);

  const sections = {
    hero: heroOk,
    climate: climateOk,
    facts: factsOk,
    highlights: highlightsOk,
    tags: tagsOk,
    events: eventsOk,
  };

  const flags = Object.values(sections);
  const trueCount = flags.filter(Boolean).length;
  const tier = trueCount === 6 ? 'complete' : trueCount === 0 ? 'empty' : 'partial';

  return { sections, tier };
}

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

// ---- Main handler ----

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Auth required for both GET and POST
  const auth = requireAuth(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });
  const user = auth.user;

  if (!applyRateLimit(res, `destcompleteness:${user.email || getClientIp(req)}`, RATE_LIMITS.widgetRead)) return;

  const { AIRTABLE_DESTINATION_CONTENT_PAT } = process.env;
  if (!AIRTABLE_DESTINATION_CONTENT_PAT) {
    return res.status(500).json({ error: 'Server configuration error' });
  }

  // ---- GET: single ----
  if (req.method === 'GET') {
    const level = typeof req.query.level === 'string' ? req.query.level : '';
    const recordId = typeof req.query.recordId === 'string' ? req.query.recordId : '';
    if (!VALID_LEVELS.has(level) || !RECORD_ID_RE.test(recordId)) {
      return res.status(400).json({ error: 'Invalid level or recordId' });
    }

    let fields;
    try {
      fields = await fetchForCompleteness(level, recordId, AIRTABLE_DESTINATION_CONTENT_PAT);
    } catch (err) {
      console.error('[destination-completeness] fetch error:', err?.message || err);
      return res.status(502).json({ error: 'Upstream unavailable' });
    }
    if (!fields) return res.status(404).json({ error: 'Destination not found' });

    let inheritedSources = {};
    try {
      inheritedSources = await inheritedFactSources(level, fields, AIRTABLE_DESTINATION_CONTENT_PAT);
    } catch (err) {
      console.error('[destination-completeness] inheritance error:', err?.message || err);
    }

    const { sections, tier } = assessSections(level, fields, inheritedSources);
    const map = COMPLETENESS_MAP[level];
    const name = typeof fields[map.name] === 'string' ? fields[map.name] : '';

    res.setHeader('Cache-Control', 'private, max-age=120');
    return res.status(200).json({
      level,
      recordId,
      name: name.slice(0, 120),
      tier,
      sections,
      factsInherited: inheritedSources,
    });
  }

  // ---- POST: batch ----
  if (req.method === 'POST') {
    let body;
    try { body = req.body && typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}'); }
    catch { return res.status(400).json({ error: 'Invalid JSON body' }); }

    const items = Array.isArray(body.items) ? body.items : null;
    if (!items || items.length === 0) return res.status(400).json({ error: 'items required' });
    if (items.length > BATCH_MAX) {
      return res.status(400).json({ error: `Batch limited to ${BATCH_MAX} items` });
    }

    // Validate every item before fetching anything
    for (const it of items) {
      if (!it || typeof it !== 'object') return res.status(400).json({ error: 'Invalid item' });
      if (!VALID_LEVELS.has(it.level)) return res.status(400).json({ error: 'Invalid item level' });
      if (typeof it.recordId !== 'string' || !RECORD_ID_RE.test(it.recordId)) {
        return res.status(400).json({ error: 'Invalid item recordId' });
      }
    }

    // Process in parallel. Each item: fetch + (optional) inherit + assess.
    // We deliberately do NOT walk inheritance for batch mode -- we only need
    // the facts section true/false, and the resort/city's own facts presence
    // is already a strong signal. This keeps batch latency bounded.
    const results = await Promise.all(items.map(async (it) => {
      try {
        const fields = await fetchForCompleteness(it.level, it.recordId, AIRTABLE_DESTINATION_CONTENT_PAT);
        if (!fields) return { level: it.level, recordId: it.recordId, tier: 'empty' };
        // Cheap inheritance approximation: in batch mode, treat facts as
        // populated if ANY of the five own-record fields are present, OR if
        // there's a parentLink (we know inheritance would resolve in single mode).
        // This keeps the batch fast and is good enough for a coarse badge.
        const map = COMPLETENESS_MAP[it.level];
        const ownAny = INHERITABLE_FACTS.some(k => nonBlankString(fields[map[k]]));
        const fakeInherited = (!ownAny && map.parentLink) ? { _hint: 'parent' } : {};
        const { tier } = assessSections(it.level, fields, fakeInherited);
        return { level: it.level, recordId: it.recordId, tier };
      } catch (err) {
        console.error('[destination-completeness] batch item failed:', err?.message || err);
        return { level: it.level, recordId: it.recordId, tier: 'unknown' };
      }
    }));

    return res.status(200).json({ results });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
