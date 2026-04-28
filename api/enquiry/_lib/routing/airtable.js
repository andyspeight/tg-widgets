// =============================================================================
//  /api/enquiry/_lib/routing/airtable.js
// =============================================================================
//
//  Pushes each submission as a new record into the agent's OWN Airtable base.
//
//  AUTHENTICATION
//  --------------
//  The agent supplies a personal access token (PAT) via the editor. It's
//  AES-256-GCM encrypted before storage (see pat-crypt.js) and decrypted
//  here at submission time. The decrypted PAT is held in a single function
//  scope, used once, and never logged or stored.
//
//  FIELD MAPPING
//  -------------
//  The agent can supply a JSON object mapping our submission field names
//  to their Airtable field IDs:
//
//    {
//      "first_name": "fldABC123...",
//      "email": "fldDEF456...",
//      "destinations": "fldGHI789..."
//    }
//
//  If no map is provided (or a particular field isn't in it), we fall back
//  to writing by the human-readable label ("First Name", "Email", etc.) and
//  rely on Airtable's tolerance for matching column names. This works for
//  agents who set up their table with sensible column names but breaks
//  silently if their schema diverges. The field map is the safe option.
//
//  TYPECAST
//  --------
//  We always send `typecast: true` so Airtable does best-effort coercion
//  (our string "All inclusive" lands cleanly into their singleSelect, our
//  ISO date string lands cleanly into their date field, etc.). This is
//  safer than guessing field types per agent.
//
//  ERROR HANDLING
//  --------------
//  On every failure path we update two fields on the FORM record (not the
//  submission):
//    - airtablePATLastError → human-readable error so the editor can surface it
//    - airtablePATVerifiedAt → ISO timestamp of last successful verify
//  Cleared/updated on success. This means the agent sees "your PAT was
//  rejected" the next time they open the form editor.
//
// =============================================================================

import { decryptPat } from './pat-crypt.js';

const AIRTABLE_API = 'https://api.airtable.com/v0';
const FETCH_TIMEOUT_MS = 10_000;

// Form field IDs we read
const F = {
  airtableBaseId:        'fldMJzweCfekIBAoF',
  airtableTableId:       'flddiEIebjjtGJMWY',
  airtablePAT:           'fldA6v05RBuCovsh6',
  airtablePATVerifiedAt: 'fldU9OeeLqwRVfPYN',
  airtablePATLastError:  'fldEvB2ncXRAVZQIG',
  airtableFieldMap:      'fldMF5oFaWCyqsNhL',
};

// Our internal Widget Suite base — used to write back PAT health metadata.
// This is the SAME base that holds the form record itself, accessed via
// our own PAT (not the agent's).
const WIDGET_SUITE_BASE_ID    = process.env.AIRTABLE_BASE_ID;
const WIDGET_SUITE_PAT        = process.env.AIRTABLE_KEY;
const ENQUIRY_FORMS_TABLE_ID  = 'tblpw4TCmQfJHZIlF';

// Board basis code → human label
const BOARD_BASIS_LABEL = {
  RO: 'Room only', BB: 'B&B', HB: 'Half board', FB: 'Full board', AI: 'All inclusive',
};

// ---------- Field mapping helpers --------------------------------------------

// Default human-readable labels for each submission field. Used as fallback
// when the agent didn't supply a field map — Airtable's column-name match
// will pick up "First Name", "Email", etc. automatically.
const DEFAULT_LABELS = {
  reference:          'Reference',
  submittedAt:        'Submitted At',
  first_name:         'First Name',
  last_name:          'Last Name',
  email:              'Email',
  phone:              'Phone',
  destinations:       'Destinations',
  departure_airport:  'Departure Airport',
  depart_date:        'Depart Date',
  return_date:        'Return Date',
  flexible_dates:     'Flexible Dates',
  duration:           'Duration',
  adults:             'Adults',
  children:           'Children',
  infants:            'Infants',
  child_ages:         'Child Ages',
  budget_pp:          'Budget Per Person',
  stars:              'Star Rating',
  board:              'Board Basis',
  interests:          'Interests',
  notes:              'Notes',
  contact_consent:    'Contact Consent',
  marketing_consent:  'Marketing Consent',
  source_url:         'Source URL',
};

// Parse the agent's field map JSON. Returns {} on any parse error so we
// silently fall through to label-based mapping rather than failing the write.
function parseFieldMap(raw) {
  if (!raw || typeof raw !== 'string') return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

// Translate the visitor's submission payload into a flat record body
// keyed by either the agent's Airtable field IDs (preferred, via map)
// or human-readable labels (fallback). Anything missing in the payload
// is omitted — Airtable will fill blanks as empty.
function buildRecordFields({ form, payload, reference, fieldMap }) {
  const f = payload.fields || {};
  const dates = f.travel_dates || {};
  const travellers = f.travellers || {};
  const duration = f.duration || {};

  // Build the canonical {ourKey: value} map first
  const values = {};

  values.reference   = reference;
  values.submittedAt = new Date().toISOString();

  if (f.first_name) values.first_name = f.first_name;
  if (f.last_name)  values.last_name  = f.last_name;
  if (f.email)      values.email      = f.email;
  if (f.phone)      values.phone      = f.phone;

  // Destinations: array of {id, name, parentCountry?, ...} → "Dubai (UAE) + Maldives"
  if (Array.isArray(f.destinations) && f.destinations.length > 0) {
    values.destinations = f.destinations.map(d => {
      if (!d || !d.name) return '';
      const extras = [];
      if (d.parentCity && d.parentCity !== d.name) extras.push(d.parentCity);
      if (d.parentCountry) extras.push(d.parentCountry);
      return extras.length > 0 ? `${d.name} (${extras.join(', ')})` : d.name;
    }).filter(Boolean).join(' + ');
  }

  // Departure airport: array (multi-select) or string → comma-joined
  if (Array.isArray(f.departure_airport) && f.departure_airport.length > 0) {
    values.departure_airport = f.departure_airport.join(', ');
  } else if (typeof f.departure_airport === 'string' && f.departure_airport) {
    values.departure_airport = f.departure_airport;
  }

  // Travel dates: depart, return, flexible
  if (dates.depart) values.depart_date = dates.depart;
  if (dates.return) values.return_date = dates.return;
  if (dates.flexible !== undefined) values.flexible_dates = !!dates.flexible;

  // Duration: nights number or custom string
  if (duration.custom)        values.duration = duration.custom;
  else if (duration.nights)   values.duration = `${duration.nights} nights`;

  if (typeof travellers.adults === 'number')   values.adults   = travellers.adults;
  if (typeof travellers.children === 'number') values.children = travellers.children;
  if (typeof travellers.infants === 'number')  values.infants  = travellers.infants;
  if (Array.isArray(travellers.childAges) && travellers.childAges.length > 0) {
    values.child_ages = travellers.childAges.join(', ');
  }

  if (typeof f.budget_pp === 'number') values.budget_pp = f.budget_pp;
  if (typeof f.stars === 'number')     values.stars     = f.stars;
  if (f.board)                         values.board     = BOARD_BASIS_LABEL[f.board] || f.board;
  if (Array.isArray(f.interests) && f.interests.length > 0) {
    values.interests = f.interests.join(', ');
  }
  if (f.notes) values.notes = f.notes;

  if (f.contact_consent !== undefined)   values.contact_consent   = !!f.contact_consent;
  if (f.marketing_consent !== undefined) values.marketing_consent = !!f.marketing_consent;

  if (payload.sourceUrl) values.source_url = payload.sourceUrl;

  // Now translate keys: prefer the agent's field map, fall back to labels
  const out = {};
  for (const [ourKey, val] of Object.entries(values)) {
    const mappedFieldId = fieldMap[ourKey];
    const targetKey = mappedFieldId || DEFAULT_LABELS[ourKey] || ourKey;
    out[targetKey] = val;
  }
  return out;
}

// ---------- Validation ------------------------------------------------------

function isValidBaseId(id) {
  return typeof id === 'string' && /^app[A-Za-z0-9]{14}$/.test(id);
}
function isValidTableId(id) {
  return typeof id === 'string' && /^tbl[A-Za-z0-9]{14}$/.test(id);
}

// ---------- PAT health metadata write-back ----------------------------------

// Update the form record's airtablePATVerifiedAt or airtablePATLastError
// fields after each delivery attempt. Best-effort — if this fails we don't
// fail the whole routing call, just log it.
async function writePatHealth(form, success, errorMessage) {
  if (!WIDGET_SUITE_BASE_ID || !WIDGET_SUITE_PAT) return;
  if (!form || !form.id) return;

  const fields = {};
  if (success) {
    fields[F.airtablePATVerifiedAt] = new Date().toISOString();
    fields[F.airtablePATLastError]  = ''; // clear any previous error
  } else {
    fields[F.airtablePATLastError] = String(errorMessage || '').slice(0, 500);
  }

  try {
    const url = `${AIRTABLE_API}/${WIDGET_SUITE_BASE_ID}/${ENQUIRY_FORMS_TABLE_ID}/${form.id}`;
    await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${WIDGET_SUITE_PAT}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields }),
    });
  } catch (err) {
    console.warn('[routing/airtable] PAT health write-back failed:', err.message);
  }
}

// ---------- Friendly error mapper -------------------------------------------

function friendlyError(status, body) {
  // Airtable error responses have shape { error: { type, message } } or
  // { error: "STRING" }. Surface what the agent can act on.
  let detail = '';
  try {
    if (body && typeof body === 'object') {
      detail = body.error && (body.error.message || body.error.type || body.error);
    }
  } catch {}

  if (status === 401) return 'Airtable rejected your PAT — it may have been revoked. Re-enter it on the form.';
  if (status === 403) return 'Your PAT does not have permission to write to this base or table.';
  if (status === 404) return 'Airtable could not find this base or table. Check the IDs on the form.';
  if (status === 422) {
    const detailStr = String(detail || '');
    const typeStr = (body && body.error && body.error.type) ? String(body.error.type) : '';
    if (/UNKNOWN_FIELD_NAME/i.test(typeStr) || /unknown field/i.test(detailStr)) {
      return 'A submission field does not exist in your Airtable table. Check the field map.';
    }
    return `Airtable rejected the record: ${detailStr.slice(0, 200)}`;
  }
  if (status >= 500) return 'Airtable returned a server error. Try again in a moment.';
  return `Airtable returned ${status}${detail ? ': ' + String(detail).slice(0, 200) : ''}`;
}

// ---------- Public interface -------------------------------------------------

export default async function sendToAgentAirtable(ctx) {
  const { form, payload, reference } = ctx;

  // Validate config
  const baseId  = (form.fields[F.airtableBaseId]  || '').trim();
  const tableId = (form.fields[F.airtableTableId] || '').trim();
  const encPat  = form.fields[F.airtablePAT];

  if (!baseId)            return { status: 'failed', error: 'No Airtable base ID configured' };
  if (!isValidBaseId(baseId))  return { status: 'failed', error: 'Invalid Airtable base ID format' };
  if (!tableId)           return { status: 'failed', error: 'No Airtable table ID configured' };
  if (!isValidTableId(tableId)) return { status: 'failed', error: 'Invalid Airtable table ID format' };
  if (!encPat)            return { status: 'failed', error: 'No Airtable PAT configured — enter one on the form' };

  // Decrypt PAT — held only in this function scope, never logged
  let pat;
  try {
    pat = decryptPat(encPat);
  } catch (err) {
    // Most likely cause: TG_PAT_ENCRYPTION_KEY rotated without re-encrypting
    // existing blobs, or the stored value isn't a v1 blob.
    console.error('[routing/airtable] PAT decrypt failed:', err.message);
    const msg = 'Could not decrypt the saved PAT — please re-enter it on the form';
    await writePatHealth(form, false, msg);
    return { status: 'failed', error: msg };
  }

  // Build record body
  const fieldMap = parseFieldMap(form.fields[F.airtableFieldMap]);
  const recordFields = buildRecordFields({ form, payload, reference, fieldMap });

  // Bail if we got nothing — pathological case but avoid empty writes
  if (Object.keys(recordFields).length === 0) {
    return { status: 'failed', error: 'No fields to write — submission was empty' };
  }

  // POST to the agent's base
  const url = `${AIRTABLE_API}/${baseId}/${tableId}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${pat}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        records: [{ fields: recordFields }],
        typecast: true,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      let body = null;
      try { body = await response.json(); } catch {}
      const friendly = friendlyError(response.status, body);
      console.error('[routing/airtable] Write failed:', response.status, JSON.stringify(body).slice(0, 300));
      await writePatHealth(form, false, friendly);
      return { status: 'failed', statusCode: response.status, error: friendly };
    }

    await writePatHealth(form, true, '');
    return { status: 'ok', statusCode: response.status };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      const msg = 'Airtable timeout after 10 seconds';
      await writePatHealth(form, false, msg);
      return { status: 'failed', error: msg };
    }
    console.error('[routing/airtable] Fetch error:', err);
    const msg = `Network error: ${err.message}`;
    await writePatHealth(form, false, msg);
    return { status: 'failed', error: msg };
  }
}
