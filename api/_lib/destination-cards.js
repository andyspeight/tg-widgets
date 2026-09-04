/**
 * Destination cards — the shared shaping layer for every widget that renders
 * destinations as cards rather than as a full guide.
 *
 * Used by the Top 10 list (api/_lib/top10-list.js) and the Inspirator deck
 * (api/destination-deck.js). Field maps live here once because a field id
 * copied into two files is a field id that will drift.
 *
 * No network, no environment beyond the base id. Tested by
 * test/top10-list-smoke.mjs and test/inspirator-deck-smoke.mjs.
 */

export const DESTINATION_BASE_ID = process.env.DESTINATION_CONTENT_BASE_ID || 'appuZdlMJ7HKUt6qS';

export const RECORD_ID_RE = /^rec[A-Za-z0-9]{14}$/;
export const URL_RE = /^https?:\/\/[^\s<>"']+$/i;

/**
 * Per-level table plus the subset of fields a CARD needs. Deliberately much
 * narrower than destination-content's map: a card is a photo, a name and a
 * one-line hook, not a full destination guide.
 *
 * `filterFields` are the FIELD NAMES used in filterByFormula (Airtable formulas
 * address fields by name, not id). They happen to be identical across all three
 * tables, but they are declared per level so a rename in one cannot silently
 * break the other two.
 */
export const LEVEL_MAP = Object.freeze({
  country: {
    tableId: 'tblsxbqbyhTDoWhbo',
    filterFields: { status: 'Status', images: 'Image URLs', tags: 'Best For Tags' },
    liveStatus: 'Live',
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
    filterFields: { status: 'Status', images: 'Image URLs', tags: 'Best For Tags' },
    liveStatus: 'Live',
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
    filterFields: { status: 'Status', images: 'Image URLs', tags: 'Best For Tags' },
    liveStatus: 'Live',
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

export const VALID_LEVELS = Object.freeze(Object.keys(LEVEL_MAP));

/**
 * The locked 32-tag vocabulary, mirrored from destination-content.js.
 * Filtering against it is defence in depth in two directions: a rogue Airtable
 * edit cannot propagate a junk tag into a widget on a client's site, and a tag
 * arriving in a query string cannot reach a formula unless it is one of these
 * exact 32 strings.
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

/**
 * Shape one Airtable record (fields keyed by field ID) into a card.
 * `tagLimit` is higher for a swipe deck than a list row: the Inspirator infers
 * a taste profile from the tags, so it wants everything the record carries.
 */
export function toCard(level, recordId, fields, tagLimit = 4) {
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
    tags: parseBestForTags(g('bestForTags'), tagLimit),
    flightTime: txt(g('flightTime'), 40),
    bestMonths: bestMonthsPhrase(g('climateSeason')),
  };
}

/**
 * Build the Airtable filterByFormula for a set of record IDs at one level.
 * Every id is re-checked here even when the caller has already validated them:
 * this string is interpolated into a formula, so it validates at the point of
 * use rather than trusting an earlier caller.
 */
export function recordIdFormula(recordIds) {
  const safe = (Array.isArray(recordIds) ? recordIds : []).filter(id => RECORD_ID_RE.test(id));
  if (!safe.length) return '';
  const clauses = safe.map(id => `RECORD_ID()='${id}'`);
  return clauses.length === 1 ? clauses[0] : `OR(${clauses.join(',')})`;
}

/**
 * Build the filterByFormula for a DECK: live records that carry a hero photo,
 * optionally narrowed to destinations matching any of the given tags.
 *
 * The photo condition is not cosmetic. A swipe card is a photograph with a name
 * on it, so a record with no image cannot be dealt at all — 394 of 495 live
 * resorts have no photo, and without this clause four cards in five would be a
 * grey box.
 *
 * Injection: tags are matched against TAG_VOCAB and anything else is dropped, so
 * only one of 32 known literals can ever reach the formula. Field names come
 * from LEVEL_MAP, never from the request.
 */
export const DEFAULT_DECK_LEVELS = Object.freeze(['resort']);

/**
 * Accept a levels value from a query string or a saved config and keep only
 * known levels. An empty or unrecognisable value falls back to resorts rather
 * than to "everything", so a typo cannot triple the size of a deck fetch.
 */
export function normaliseLevels(raw) {
  let list = raw;
  if (typeof raw === 'string') list = raw.split(',');
  if (!Array.isArray(list)) return DEFAULT_DECK_LEVELS.slice();
  const out = [];
  for (const v of list) {
    const level = typeof v === 'string' ? v.trim().toLowerCase() : '';
    if (VALID_LEVELS.includes(level) && !out.includes(level)) out.push(level);
  }
  return out.length ? out : DEFAULT_DECK_LEVELS.slice();
}

/**
 * Accept a tags value and keep only members of the locked vocabulary. This is
 * the whole injection defence for deckFormula: an unknown string never reaches
 * the formula, so there is nothing to escape. Capped at 8 so one request cannot
 * build an arbitrarily long OR chain.
 */
export function normaliseTags(raw) {
  let list = raw;
  if (typeof raw === 'string') list = raw.split(',');
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const v of list) {
    const tag = typeof v === 'string' ? v.trim() : '';
    if (TAG_VOCAB.has(tag) && !out.includes(tag)) out.push(tag);
    if (out.length >= 8) break;
  }
  return out;
}

export function deckFormula(level, tags) {
  const map = LEVEL_MAP[level];
  if (!map) return '';
  const ff = map.filterFields;
  const clauses = [
    `{${ff.status}}='${map.liveStatus}'`,
    `{${ff.images}}!=''`,
  ];
  const safeTags = (Array.isArray(tags) ? tags : []).filter(t => TAG_VOCAB.has(t));
  if (safeTags.length) {
    const tagClauses = safeTags.map(t => `FIND('${t}',ARRAYJOIN({${ff.tags}},','))>0`);
    clauses.push(tagClauses.length === 1 ? tagClauses[0] : `OR(${tagClauses.join(',')})`);
  }
  return `AND(${clauses.join(',')})`;
}
