/**
 * Top 10 Destinations — the pure parts.
 *
 * Field maps, the tag vocabulary, reference validation and the record-to-card
 * shaping, with no network and no environment. api/destination-list.js does the
 * Airtable I/O and HTTP; everything here is testable on its own.
 *
 * Tested by test/top10-list-smoke.mjs.
 */

import { readFileSync } from 'node:fs';

export const DESTINATION_BASE_ID = process.env.DESTINATION_CONTENT_BASE_ID || 'appuZdlMJ7HKUt6qS';

// A Top 10 is ten. The cap is 12 so an agent can hold a couple of spares while
// reordering, and so one request can never become a bulk export of the
// destination database.
export const MAX_ITEMS = 12;

export const RECORD_ID_RE = /^rec[A-Za-z0-9]{14}$/;
export const URL_RE = /^https?:\/\/[^\s<>"']+$/i;

/**
 * Per-level table plus the subset of fields a LIST card needs. Deliberately
 * much narrower than destination-content's map: a card is a photo, a name and
 * a one-line hook, not a full destination guide.
 */
export const LEVEL_MAP = Object.freeze({
  country: {
    tableId: 'tblsxbqbyhTDoWhbo',
    fields: {
      name: 'flddJJrpwcXOwWIow',
      slug: 'fldDwZVR1C63K4HGT',
      tagline: 'fldjpYZsvAdMt1KlW',
      region: 'fldADwbC9R6R6jr35',
      images: 'fldTqpNZX5n1219mh',
      attributions: 'fldVxxvianhuEj11t',
      bestForTags: 'fldC5ZvX1hitoxWY6',
      flightTime: 'fldGPxNRuf9xao0He',
      climateSeason: 'fldqx5p1U0siNtvYy',
    },
  },
  city: {
    tableId: 'tblTkKujdVZgWPAQe',
    fields: {
      name: 'fld2VkY61c1JKUWKB',
      slug: 'fldL6MlFZgZMW25Vp',
      tagline: 'fldIu4zaqZZ7XUHZn',
      region: 'fld1pD6llYo3Q8WlJ',
      images: 'fldt3898YIanGbfzc',
      attributions: 'fldzdo1vtYbAvpt0v',
      bestForTags: 'fldZQTVNuqRXHileW',
      flightTime: 'fldjhp4H3MHcjLQbG',
      climateSeason: 'fldHwvHjSwkpEgFa2',
    },
  },
  resort: {
    tableId: 'tblwV9gnbVEyZ99gI',
    fields: {
      name: 'fldnvOipaWpG3W1rx',
      slug: 'fldwVxLg8V4CBi90B',
      tagline: 'fldwMqygnNpKvf9KO',
      region: 'fldF9hitGwa75MYBa',
      images: 'fldBMns5p5ChZCriU',
      attributions: 'fldMn6hYB1o5OwJpN',
      bestForTags: 'fldTmH3gT1wT48PLn',
      flightTime: 'fldMlw191r1T3lFXe',
      climateSeason: 'fld5RyPuxYdFFIFhb',
    },
  },
});

/**
 * The locked 32-tag vocabulary, mirrored from destination-content.js.
 * Filtering here is defence in depth: a rogue Airtable edit must not be able
 * to propagate a junk tag into a widget rendered on a client's site.
 */
export const TAG_VOCAB = new Set([
  'Couples', 'Honeymoons', 'Families', 'Food and Wine', 'Photography', 'Beach',
  'Adventure', 'Luxury', 'Budget', 'City Break', 'Culture', 'Nightlife', 'Wellness',
  'Wildlife', 'Winter Sun', 'Summer Sun', 'Skiing', 'Multi Generation', 'Solo Travel',
  'Romance',
  'All-Inclusive', 'Cruise', 'Short Break', 'Long-Haul', 'School Holidays',
  'Diving', 'Hiking', 'Golf', 'Spa Retreat', 'Wedding Destination',
  'Eco / Sustainable', 'LGBTQ+ Friendly',
]);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function txt(value, maxLen = 300) {
  if (typeof value !== 'string') return '';
  return value.replace(/<[^>]*>/g, '').trim().slice(0, maxLen);
}

export function firstUrl(str) {
  if (typeof str !== 'string') return '';
  const first = str.split(/\r?\n/).map(s => s.trim()).find(s => s && URL_RE.test(s));
  return first || '';
}

// Attribution lines are newline-matched to the image lines, so the credit for
// the hero photo is the first line.
export function firstLine(str) {
  if (typeof str !== 'string') return '';
  const first = str.split(/\r?\n/).map(s => s.trim()).find(Boolean);
  return txt(first || '', 120);
}

export function parseBestForTags(value, max = 4) {
  if (!Array.isArray(value)) return [];
  return value
    .map(v => (typeof v === 'string' ? v : (v && typeof v.name === 'string' ? v.name : null)))
    .filter(v => v && TAG_VOCAB.has(v))
    .slice(0, max);
}

/**
 * Turn the 12-token Climate Season field into a short "best months" phrase.
 * "off,off,off,shoulder,best,best,best,best,best,shoulder,off,off" -> "May to Sep".
 * Wraps across the year end so a winter-sun resort reads "Nov to Mar", and falls
 * back to a comma list when the best months are genuinely scattered rather than
 * inventing a range that does not exist.
 */
export function bestMonthsPhrase(seasonStr) {
  if (typeof seasonStr !== 'string') return '';
  const tokens = seasonStr.split(',').map(s => s.trim().toLowerCase());
  if (tokens.length !== 12) return '';
  const best = tokens.map((t, i) => (t === 'best' ? i : -1)).filter(i => i >= 0);
  if (!best.length) return '';
  if (best.length === 12) return 'Year round';

  let bestStart = best[0];
  let bestLen = 1;
  let curStart = best[0];
  let curLen = 1;
  for (let k = 1; k < best.length; k++) {
    if (best[k] === best[k - 1] + 1) {
      curLen++;
    } else {
      curStart = best[k];
      curLen = 1;
    }
    if (curLen > bestLen) { bestLen = curLen; bestStart = curStart; }
  }

  // A run ending in December joins a run starting in January.
  if (best.includes(0) && best.includes(11)) {
    let tail = 0;
    for (let m = 11; m >= 0 && best.includes(m); m--) tail++;
    let head = 0;
    for (let m = 0; m < 12 && best.includes(m); m++) head++;
    if (tail + head > bestLen && tail + head < 12) {
      bestLen = tail + head;
      bestStart = 12 - tail;
    }
  }

  if (bestLen === 1 && best.length > 2) {
    return best.slice(0, 4).map(i => MONTHS[i]).join(', ');
  }
  const start = MONTHS[bestStart % 12];
  const end = MONTHS[(bestStart + bestLen - 1) % 12];
  return start === end ? start : `${start} to ${end}`;
}

/** Shape one Airtable record (fields keyed by field ID) into a list card. */
export function toCard(level, recordId, fields) {
  const map = LEVEL_MAP[level];
  if (!map) return null;
  const f = fields || {};
  const g = key => f[map.fields[key]];
  return {
    level,
    recordId,
    slug: txt(g('slug'), 100),
    name: txt(g('name'), 120),
    region: txt(g('region'), 80),
    tagline: txt(g('tagline'), 160),
    image: firstUrl(g('images')),
    attribution: firstLine(g('attributions')),
    tags: parseBestForTags(g('bestForTags')),
    flightTime: txt(g('flightTime'), 40),
    bestMonths: bestMonthsPhrase(g('climateSeason')),
  };
}

/**
 * Reduce a raw items array (from a saved config or a POST body) to validated
 * references. Anything malformed is dropped rather than guessed at, duplicates
 * are collapsed, and the whole thing is capped at MAX_ITEMS.
 */
export function normaliseRefs(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const level = typeof item.level === 'string' ? item.level.toLowerCase() : '';
    const recordId = typeof item.recordId === 'string' ? item.recordId : '';
    if (!LEVEL_MAP[level] || !RECORD_ID_RE.test(recordId)) continue;
    const key = `${level}:${recordId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ level, recordId });
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

/**
 * Build the Airtable filterByFormula for a set of record IDs at one level.
 * Every id is re-checked here even though normaliseRefs has already validated
 * them: this string is interpolated into a formula, so it validates at the
 * point of use rather than trusting an earlier caller.
 */
export function recordIdFormula(recordIds) {
  const safe = (Array.isArray(recordIds) ? recordIds : []).filter(id => RECORD_ID_RE.test(id));
  if (!safe.length) return '';
  const clauses = safe.map(id => `RECORD_ID()='${id}'`);
  return clauses.length === 1 ? clauses[0] : `OR(${clauses.join(',')})`;
}

/**
 * Restore the caller's order and assign ranks. Airtable returns records in its
 * own order, and on a ranked list that matters. A reference that did not come
 * back is dropped and the ranks close up, so a deleted record shortens the list
 * rather than leaving a gap at number four.
 */
export function orderAndRank(refs, foundByKey) {
  return (Array.isArray(refs) ? refs : [])
    .map(r => foundByKey.get(`${r.level}:${r.recordId}`))
    .filter(Boolean)
    .map((card, i) => ({ rank: i + 1, ...card }));
}

/**
 * The curated default lists that ship with the widget. Read via
 * `new URL(..., import.meta.url)` rather than a JSON import so Vercel's file
 * tracer follows it and we do not depend on import-attribute support in Node 20
 * (the same pattern as api/reference/_breadth.js).
 *
 * A missing or malformed file must never take the endpoint down: widget mode
 * reads references from the widget's own config and does not need the presets
 * at all, so we degrade to "no presets offered" and keep serving.
 */
export const PRESET_LISTS = (() => {
  try {
    const url = new URL('../_data/top10-lists.json', import.meta.url);
    const raw = JSON.parse(readFileSync(url, 'utf8'));
    return Array.isArray(raw) ? raw : [];
  } catch (err) {
    console.error('[top10-list] preset load failed:', err && err.message);
    return [];
  }
})();

export function findPreset(id) {
  if (typeof id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(id)) return null;
  return PRESET_LISTS.find(l => l.id === id) || null;
}

export function presetCatalogue() {
  return PRESET_LISTS.map(l => ({
    id: l.id,
    title: l.title,
    subtitle: l.subtitle,
    level: l.level,
    count: Array.isArray(l.items) ? l.items.length : 0,
  }));
}
