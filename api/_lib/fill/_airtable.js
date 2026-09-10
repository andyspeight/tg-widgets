/**
 * The only place the filler touches Airtable.
 *
 * Two operations, deliberately narrow: read one record whole, and write ONE
 * field on it. There is no "update record" here and there should never be. A
 * runner that can patch several fields at once is a runner that can undo work
 * it was never asked to touch, and the whole safety argument for this thing
 * rests on the blast radius of a mistake being a single field.
 */

const API = 'https://api.airtable.com/v0';
const BASE = process.env.REFERENCE_BASE_ID || 'appuZdlMJ7HKUt6qS';

function pat() {
  const key = process.env.AIRTABLE_DESTINATION_CONTENT_PAT || process.env.AIRTABLE_PAT || '';
  if (!key) throw new Error('the Destination Content PAT is not configured');
  return key;
}

/** One record, every field, keyed by field id. */
export async function readRecord(tableId, recordId) {
  const r = await fetch(`${API}/${BASE}/${tableId}/${recordId}?returnFieldsByFieldId=true`, {
    headers: { Authorization: 'Bearer ' + pat() },
    signal: AbortSignal.timeout(20000),
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('Airtable read ' + r.status);
  const json = await r.json();
  return { id: json.id, createdTime: json.createdTime, fields: json.fields || {} };
}

/**
 * Write exactly one field. PATCH, so every other field on the record is left
 * untouched by definition rather than by our care.
 */
export async function writeField({ tableId, recordId, fieldId, value }) {
  const r = await fetch(`${API}/${BASE}/${tableId}/${recordId}`, {
    method: 'PATCH',
    headers: {
      Authorization: 'Bearer ' + pat(),
      'content-type': 'application/json',
    },
    signal: AbortSignal.timeout(20000),
    body: JSON.stringify({ fields: { [fieldId]: value }, typecast: false }),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    throw new Error('Airtable write ' + r.status + ': ' + detail.slice(0, 160));
  }
  return true;
}

/**
 * Turn a raw Airtable record into the shape the runner and writer expect:
 * values keyed by human label, plus the parent link and group.
 */
export function shapeRecord({ raw, spec }) {
  if (!raw) return null;
  const values = {};
  for (const f of spec.fields) {
    const v = raw.fields[f.id];
    if (v == null) continue;
    const s = (v && typeof v === 'object' && !Array.isArray(v)) ? (v.name != null ? v.name : '') : v;
    if (Array.isArray(s)) continue;           // links and multi-selects are not prose context
    if (String(s).trim() === '') continue;
    values[f.label] = String(s);
  }
  const nameRaw = raw.fields[spec.nameField];
  const parent = Array.isArray(raw.fields[spec.parentLinkField]) ? raw.fields[spec.parentLinkField][0] : null;
  const groupRaw = spec.groupByField ? raw.fields[spec.groupByField] : null;
  const group = groupRaw && typeof groupRaw === 'object' ? groupRaw.name : groupRaw;
  return {
    id: raw.id,
    type: spec.key,
    name: (nameRaw == null ? '' : String(nameRaw)).trim() || '(unnamed)',
    parentId: parent || null,
    group: group ? String(group) : null,
    values,
    fields: raw.fields,
  };
}

export const BASE_ID = BASE;
