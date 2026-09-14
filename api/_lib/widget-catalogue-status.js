/**
 * Per-widget release status ("live" / "coming-soon"), shared by every caller.
 *
 * Backing store: the "Widget Catalogue Status" table in the Widgets base, one
 * row per registry widget id. A widget with no row is live.
 *
 * Two consumers, deliberately reading the same thing:
 *   - /api/widget-catalogue  — the dashboard overlay, and the staff POST that
 *                              flips a status. Needs uncached reads.
 *   - /api/v1/...            — the Travelify directory, which must not offer a
 *                              client a widget they cannot actually create.
 * Keeping one definition means the two can never disagree about which widgets
 * are still coming soon.
 */
import { getJson, setJsonEx, configured as redisConfigured } from '../_redis.js';

export const AIRTABLE_API = 'https://api.airtable.com/v0';
export const BASE_ID = process.env.AIRTABLE_BASE_ID || 'appAYzWZxvK6qlwXK';
export const CATALOGUE_TABLE = 'tblJHOJlt63QmuxEq'; // Widget Catalogue Status

// Field IDs (we read with returnFieldsByFieldId=true, so ids not names).
export const CATALOGUE_FIELDS = {
  widgetId:   'fldAF01jPEeJSpGFr',
  widgetName: 'fldpgCvfHwifQw71g',
  status:     'flddYY41TmQRi2ZFr',
  updatedBy:  'fldtKguATp94LqYNL',
  updatedAt:  'fldiRO4yh7eCzViIf',
};

export const VALID_STATUSES = ['live', 'coming-soon'];

const CACHE_KEY = 'widget-catalogue:statuses:v1';
const CACHE_TTL_SECONDS = 300;

export function catalogueHeaders() {
  return {
    Authorization: `Bearer ${process.env.AIRTABLE_KEY}`,
    'Content-Type': 'application/json',
  };
}

/**
 * Every status row, straight from Airtable.
 * @returns {Promise<{statuses: Record<string,string>, recordsById: Record<string,string>}>}
 */
export async function fetchAllStatuses() {
  const statuses = {};
  const recordsById = {};
  let offset;
  do {
    let url = `${AIRTABLE_API}/${BASE_ID}/${CATALOGUE_TABLE}`
      + `?returnFieldsByFieldId=true&pageSize=100`;
    if (offset) url += `&offset=${encodeURIComponent(offset)}`;
    const resp = await fetch(url, { headers: catalogueHeaders() });
    if (!resp.ok) {
      throw new Error(`Airtable read failed (${resp.status})`);
    }
    const data = await resp.json();
    for (const rec of data.records || []) {
      const wid = rec.fields?.[CATALOGUE_FIELDS.widgetId];
      if (!wid) continue;
      const st = rec.fields?.[CATALOGUE_FIELDS.status];
      statuses[wid] = VALID_STATUSES.includes(st) ? st : 'live';
      recordsById[wid] = rec.id;
    }
    offset = data.offset;
  } while (offset);
  return { statuses, recordsById };
}

/**
 * Statuses with a short Redis cache in front.
 *
 * For the Travelify endpoints, which run on their page load and carry a 300ms
 * budget: a release status changes when a human flips it, so five minutes of
 * staleness costs nothing and saves a full table scan per call.
 *
 * Fails OPEN: on any error it returns {} so the caller falls back to the
 * registry's own status rather than serving an empty directory.
 */
export async function getStatusesCached() {
  if (redisConfigured()) {
    try {
      const hit = await getJson(CACHE_KEY);
      if (hit && typeof hit === 'object' && hit.statuses) return hit.statuses;
    } catch { /* fall through to a live read */ }
  }

  let statuses = {};
  try {
    ({ statuses } = await fetchAllStatuses());
  } catch (err) {
    console.error('[widget-catalogue-status] read failed:', err && err.message);
    return {};
  }

  if (redisConfigured()) {
    try { await setJsonEx(CACHE_KEY, { statuses }, CACHE_TTL_SECONDS); } catch { /* best effort */ }
  }
  return statuses;
}
