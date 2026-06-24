/**
 * Thin Airtable REST client for the Luna Chat base (app6Ot3eOb3DangkB), where
 * the Luna Brain Knowledge table lives.
 *
 * Why a separate client: the shared _lib/auth/airtable.js helper is hard-wired
 * to the Control base (appAYzWZxvK6qlwXK) used for SSO and entitlements. Luna
 * Brain reads and writes a DIFFERENT base, so it needs its own thin client.
 * This mirrors what api/api/luna-copilot.js already does against the same base.
 *
 * Server-side only. Uses AIRTABLE_PAT (scoped to both bases); AIRTABLE_KEY is
 * accepted as a fallback to match the copilot endpoint.
 */

const AIRTABLE_API = 'https://api.airtable.com/v0';
const LUNA_BASE_ID = process.env.LUNA_BASE_ID || 'app6Ot3eOb3DangkB';
const PAT = process.env.AIRTABLE_PAT || process.env.AIRTABLE_KEY;

export const KNOWLEDGE_TBL = 'tblstATJ3BSqtuTDU';
export const CLIENTS_TBL = 'tbl6CZ7aVzq1wHF2v';

// Stable field IDs on the Knowledge table.
export const KF = {
  question:       'fldEm65vQmagn5WfR',
  variants:       'fldHytgAlS9MvoHRb',
  answer:         'fldAVVG7qfl8mlMPe',
  client:         'fldj3YnhyNZhvRaj1',
  type:           'fldQQ4us6LUFCNznB',
  status:         'fldV7EF0zOrMQNnkX',
  source:         'fldfOrjAdGsOGJUb0',
  confidence:     'fldWpz8NFGiPtOhEG',
  keywords:       'fldgfrOwdHSyH6vdG',
  timesUsed:      'fld6T7FgQD7KkE3IC',
  lastUsedAt:     'fldA6cYYHcRz9q66w',
  createdAt:      'fldzpn7RAyPRFOXTk',
  notes:          'fldJV5ayvh34P3fXE',
  lastVerifiedAt: 'fldkNk8hEuZJXiK5p',
  conversations:  'fldokH6yAztrIxElG',
};

// Field id for ClientName on the Luna Clients table.
export const CF = { name: 'fldT257oW3qssqUcZ' };

// The set of values the gate may write. Kept here so both endpoints agree.
export const STATUS   = { ACTIVE: 'Active', DRAFT: 'Draft', ARCHIVED: 'Archived' };
export const CONFIDENCE = { VERIFIED: 'Verified', NEEDS_REVIEW: 'Needs Review' };

// Knowledge Gaps table — questions Luna could not answer, logged from live chats.
export const GAPS_TBL = 'tblLkRcdcMIgmHPFj';
export const GF = {
  question:        'fldVuEp4b2Ik4nZme',
  client:          'fldD6aP3yiY23c6d2',
  occurrences:     'fld15dDIWU8z5c664',
  lastSeenAt:      'fldAX39WnQCZGBfWT',
  status:          'fld8dVJjF6nL6oCBR',   // Open / In Progress / Resolved / WontFix
  topic:           'fldTZJUuMC9uIjaq5',
  suggestedAnswer: 'fldPVaZzBbY3mV0P3',
  linkedKnowledge: 'fldo9ZCeRgs93HJXc',
  notes:           'fldROUxJMd4J8WIpA',
};
export const GAP_STATUS = { OPEN: 'Open', IN_PROGRESS: 'In Progress', RESOLVED: 'Resolved', WONTFIX: 'WontFix' };

export function lunaConfigured() {
  return !!PAT;
}

async function lunaFetch(path, options = {}, attempt = 1) {
  const url = `${AIRTABLE_API}/${LUNA_BASE_ID}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${PAT}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  // Airtable rate limit (5 req/sec) — back off 1s, 2s, 4s.
  if (res.status === 429 && attempt <= 3) {
    await new Promise(r => setTimeout(r, 1000 * 2 ** (attempt - 1)));
    return lunaFetch(path, options, attempt + 1);
  }
  if (res.status >= 500 && res.status < 600 && attempt <= 2) {
    await new Promise(r => setTimeout(r, 500 * attempt));
    return lunaFetch(path, options, attempt + 1);
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
 * List Knowledge records by a filterByFormula. Caller supplies the formula
 * (built from constants here, never from raw user input). Fields come back
 * keyed by field ID so the KF map resolves them.
 */
export async function listKnowledge({ formula, maxRecords = 200, sortField, sortDir = 'asc' } = {}) {
  const params = new URLSearchParams({
    returnFieldsByFieldId: 'true',
    pageSize: '100',
  });
  if (formula) params.set('filterByFormula', formula);
  if (sortField) {
    params.append('sort[0][field]', sortField);
    params.append('sort[0][direction]', sortDir);
  }
  const out = [];
  let offset;
  do {
    if (offset) params.set('offset', offset);
    const data = await lunaFetch(`/${KNOWLEDGE_TBL}?${params}`);
    out.push(...data.records);
    offset = data.offset;
  } while (offset && out.length < maxRecords);
  return out.slice(0, maxRecords);
}

export async function getKnowledge(id) {
  return lunaFetch(`/${KNOWLEDGE_TBL}/${id}?returnFieldsByFieldId=true`);
}

/** Create one Knowledge record. `fields` keyed by field ID. */
export async function createKnowledge(fields) {
  const data = await lunaFetch(`/${KNOWLEDGE_TBL}`, {
    method: 'POST',
    body: JSON.stringify({ records: [{ fields }], typecast: true, returnFieldsByFieldId: true }),
  });
  return data.records[0];
}

/** Update one Knowledge record. `fields` keyed by field ID. typecast resolves select names. */
export async function updateKnowledge(id, fields) {
  return lunaFetch(`/${KNOWLEDGE_TBL}/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields, typecast: true, returnFieldsByFieldId: true }),
  });
}

// Conversations table — source of grounding evidence for escalation-derived facts.
export const CONV_TBL = 'tblyin27D2J9ejHvf';
const CONV_TRANSCRIPT = 'fld8fMjyXWmKcacoB';
// scannedKnowledge on the Clients table — the business's own website text.
const CLIENT_SCANNED = 'fld56L15X31pTrzfD';

/** Fetch transcript text for up to a few linked conversations (bounded). */
export async function getConversationTranscripts(ids, max = 3) {
  if (!ids || !ids.length) return '';
  const picked = ids.slice(0, max);
  const formula = `OR(${picked.map(id => `RECORD_ID()="${id}"`).join(',')})`;
  const params = new URLSearchParams({ returnFieldsByFieldId: 'true', maxRecords: String(max) });
  params.set('filterByFormula', formula);
  params.append('fields[]', CONV_TRANSCRIPT);
  const data = await lunaFetch(`/${CONV_TBL}?${params}`).catch(() => ({ records: [] }));
  return (data.records || [])
    .map(r => String(r.fields[CONV_TRANSCRIPT] || '').slice(0, 4000))
    .filter(Boolean)
    .join('\n---\n');
}

/** The business's scraped website text for a client (untrusted background). */
export async function getClientScanned(clientId) {
  if (!clientId) return '';
  const rec = await lunaFetch(`/${CLIENTS_TBL}/${clientId}?returnFieldsByFieldId=true`).catch(() => null);
  return rec ? String(rec.fields?.[CLIENT_SCANNED] || '') : '';
}

/** All Active + Verified knowledge (bounded), for the consistency corpus. */
export async function listVerified({ maxRecords = 400 } = {}) {
  const formula = `AND({Status}="${STATUS.ACTIVE}",{Confidence}="${CONFIDENCE.VERIFIED}")`;
  return listKnowledge({ formula, maxRecords });
}

// ---- Knowledge Gaps -------------------------------------------------------
export async function listGaps({ formula, maxRecords = 200, sortField, sortDir = 'desc' } = {}) {
  const params = new URLSearchParams({ returnFieldsByFieldId: 'true', pageSize: '100' });
  if (formula) params.set('filterByFormula', formula);
  if (sortField) { params.append('sort[0][field]', sortField); params.append('sort[0][direction]', sortDir); }
  const out = [];
  let offset;
  do {
    if (offset) params.set('offset', offset);
    const data = await lunaFetch(`/${GAPS_TBL}?${params}`);
    out.push(...data.records);
    offset = data.offset;
  } while (offset && out.length < maxRecords);
  return out.slice(0, maxRecords);
}

export async function getGap(id) {
  return lunaFetch(`/${GAPS_TBL}/${id}?returnFieldsByFieldId=true`);
}

export async function updateGap(id, fields) {
  return lunaFetch(`/${GAPS_TBL}/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields, typecast: true, returnFieldsByFieldId: true }),
  });
}

/** Build a recordId -> ClientName map for the linked clients we actually need. */
export async function clientNameMap() {
  const params = new URLSearchParams({ returnFieldsByFieldId: 'true', pageSize: '100' });
  params.append('fields[]', CF.name);
  const out = new Map();
  let offset;
  do {
    if (offset) params.set('offset', offset);
    const data = await lunaFetch(`/${CLIENTS_TBL}?${params}`);
    for (const r of data.records) out.set(r.id, r.fields[CF.name] || '');
    offset = data.offset;
  } while (offset);
  return out;
}
