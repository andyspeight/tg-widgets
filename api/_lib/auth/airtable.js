/**
 * Airtable REST client for the auth system.
 *
 * Why we don't use the npm `airtable` SDK:
 * - We want field-ID-only reads/writes (the SDK defaults to names)
 * - We want explicit retry/backoff on 429 and 5xx
 * - One fewer dependency in the auth path
 *
 * Server-side only. Imports AIRTABLE_PAT from env.
 *
 * Required env vars:
 *   AIRTABLE_PAT — Personal Access Token scoped to base appAYzWZxvK6qlwXK
 *                  with data.records:read + data.records:write + schema.bases:read
 */

import { BASE_ID } from './schema.js';

const AIRTABLE_API = 'https://api.airtable.com/v0';
const PAT = process.env.AIRTABLE_PAT;

if (!PAT && process.env.NODE_ENV !== 'test') {
  console.warn('[auth/airtable] AIRTABLE_PAT not set — auth calls will fail');
}

/**
 * Low-level fetch with retry on 429 and transient 5xx.
 */
async function airtableFetch(path, options = {}, attempt = 1) {
  const url = `${AIRTABLE_API}/${BASE_ID}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${PAT}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  if (res.status === 429 && attempt <= 3) {
    // Airtable rate limit: 5 req/sec. Back off 1s, 2s, 4s.
    const backoff = 1000 * 2 ** (attempt - 1);
    await new Promise(r => setTimeout(r, backoff));
    return airtableFetch(path, options, attempt + 1);
  }

  if (res.status >= 500 && res.status < 600 && attempt <= 2) {
    await new Promise(r => setTimeout(r, 500 * attempt));
    return airtableFetch(path, options, attempt + 1);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`Airtable ${res.status}: ${body.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }

  return res.json();
}

/**
 * Find a single record by a field-ID + value match.
 * Uses filterByFormula with the field ID (not name) to avoid injection
 * via field names that could be reordered.
 *
 * @param {string} tableId
 * @param {string} fieldId — field to match against
 * @param {string} value — value to look for (will be string-escaped)
 * @returns {Promise<object|null>} the matching record or null
 */
export async function findOneByField(tableId, fieldId, value) {
  // Escape quotes for the formula. Airtable uses single quotes for strings.
  const escaped = String(value).replace(/'/g, "\\'");
  const formula = `{${fieldId}}='${escaped}'`;
  const params = new URLSearchParams({
    filterByFormula: formula,
    maxRecords: '1',
    returnFieldsByFieldId: 'true'
  });
  const data = await airtableFetch(`/${tableId}?${params}`);
  return data.records[0] || null;
}

/**
 * List records by a filterByFormula. Caller MUST pre-escape values themselves.
 * Use findOneByField when you can — this is for compound queries.
 */
export async function listRecords(tableId, { formula, maxRecords = 100, sort } = {}) {
  const params = new URLSearchParams({
    returnFieldsByFieldId: 'true',
    maxRecords: String(maxRecords)
  });
  if (formula) params.set('filterByFormula', formula);
  if (sort) {
    sort.forEach((s, i) => {
      params.append(`sort[${i}][field]`, s.field);
      params.append(`sort[${i}][direction]`, s.direction || 'desc');
    });
  }
  const data = await airtableFetch(`/${tableId}?${params}`);
  return data.records;
}

/**
 * Get one record by record ID.
 */
export async function getRecord(tableId, recordId) {
  return airtableFetch(`/${tableId}/${recordId}?returnFieldsByFieldId=true`);
}

/**
 * Create a single record. `fields` is keyed by field ID.
 */
export async function createRecord(tableId, fields, { typecast = true } = {}) {
  const data = await airtableFetch(`/${tableId}`, {
    method: 'POST',
    body: JSON.stringify({
      records: [{ fields }],
      typecast,
      returnFieldsByFieldId: true
    })
  });
  return data.records[0];
}

/**
 * Update one record. `fields` is keyed by field ID.
 */
export async function updateRecord(tableId, recordId, fields, { typecast = true } = {}) {
  const data = await airtableFetch(`/${tableId}/${recordId}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields, typecast, returnFieldsByFieldId: true })
  });
  return data;
}

/**
 * Bulk update — up to 10 records per call (Airtable limit).
 * `updates` is array of { id, fields }.
 */
export async function bulkUpdateRecords(tableId, updates, { typecast = true } = {}) {
  if (updates.length > 10) throw new Error('bulkUpdateRecords: max 10 per call');
  const data = await airtableFetch(`/${tableId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      records: updates.map(u => ({ id: u.id, fields: u.fields })),
      typecast,
      returnFieldsByFieldId: true
    })
  });
  return data.records;
}

/**
 * Read all records from a table, paginating through every page.
 * Use sparingly — only for the migration script and admin operations.
 */
export async function listAllRecords(tableId, { formula } = {}) {
  const out = [];
  let offset;
  do {
    const params = new URLSearchParams({
      returnFieldsByFieldId: 'true',
      pageSize: '100'
    });
    if (formula) params.set('filterByFormula', formula);
    if (offset) params.set('offset', offset);
    const data = await airtableFetch(`/${tableId}?${params}`);
    out.push(...data.records);
    offset = data.offset;
  } while (offset);
  return out;
}
