/**
 * Top 10 Destinations — the parts specific to a RANKED, hand-picked list.
 *
 * The shared destination-card layer (field maps, tag vocabulary, card shaping,
 * best months) lives in ./destination-cards.js and is used by the Inspirator
 * deck too. What is here is what only a ranked list needs: reference
 * validation, order restoration, and the curated default lists.
 *
 * api/destination-list.js does the Airtable I/O and HTTP.
 * Tested by test/top10-list-smoke.mjs.
 */

import { readFileSync } from 'node:fs';
import { LEVEL_MAP, RECORD_ID_RE } from './destination-cards.js';

// Re-exported so existing importers (and the smoke test) keep one door in.
export {
  DESTINATION_BASE_ID,
  LEVEL_MAP,
  TAG_VOCAB,
  RECORD_ID_RE,
  URL_RE,
  txt,
  firstUrl,
  firstLine,
  parseBestForTags,
  bestMonthsPhrase,
  toCard,
  recordIdFormula,
} from './destination-cards.js';

// A Top 10 is ten. The cap is 12 so an agent can hold a couple of spares while
// reordering, and so one request can never become a bulk export of the
// destination database.
export const MAX_ITEMS = 12;

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
