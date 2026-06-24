/**
 * Airtable client for the Destination Content base (appuZdlMJ7HKUt6qS) — the
 * shared reference layer (Countries, Airports, etc) that helps all clients.
 *
 * Separate from the per-client Luna base and the Control base. Uses the
 * destination-content PAT (same one the destination search endpoint uses),
 * falling back to AIRTABLE_PAT.
 *
 * Server-side only.
 */

const AIRTABLE_API = 'https://api.airtable.com/v0';
const BASE_ID = process.env.REFERENCE_BASE_ID || 'appuZdlMJ7HKUt6qS';
const PAT = process.env.AIRTABLE_DESTINATION_CONTENT_PAT || process.env.AIRTABLE_PAT;

export const AIRPORTS_TBL = 'tblI2iVAbIGCtsGa7';

// Stable field IDs on the Airports table.
export const AF = {
  name:        'fldlT6eApAdQHGYED',
  iata:        'fldcS9uu4NWMVaIVP',
  status:      'fldjvujj14Q9QNLLq',
  cityServed:  'fldgrJ2uFjzPcAxUx',
  countryText: 'fldjARk52dZi7TGGc',
  verifiedDate:'fldRCo83Wz1AFZXwP',
  wikipedia:   'fldRqtt44nsacJCwq',
  official:    'fldkrScmky7HhnD0r',
  source1:     'fldEVfcn75Tm0u0Es',
  source2:     'flds3csPG5slNZgKX',
  overview:    'fldmRELkLWrUGL5Ss',
  distance:    'fldk6vN66c33umyEP',
  terminals:   'fldoJm0H4vTRLuJlL',
  parking:     'fldoKcDvovYdGvxqy',
  lounges:     'fldkq66823wiLYMoK',
  train:       'fld9lb4Zzp40PsVmq',
  coach:       'fldv9urpL8JP6PmCw',
  taxi:        'flduHqBj7hcAvIVjs',
  arrival:     'fldIPVLmhkvQR39Dz',
};

// Countries table — the other half of the reference layer.
export const COUNTRIES_TBL = 'tblsxbqbyhTDoWhbo';
export const CF = {
  name:        'flddJJrpwcXOwWIow',
  continent:   'fldeVnkZXLiy8qCcl',
  status:      'fldCpclokepeFkQZ2',
  practical:   'fldvarabAjjpOUKFG',
  visaStatus:  'fldmKvRkDDRjj7PT2',
  visaAdvisory:'fldecKeSnkZ6ABZfd',
  health:      'fldOGSgbbH3BIoU6A',
  currency:    'fldoe2LemU2kZS3EP',
  language:    'fldypaRO1PZgwom22',
  timezone:    'fldOqkxbOYfxL1Qxt',
  flightTime:  'fldGPxNRuf9xao0He',
  bestTime:    'fldwBjpooWzPoJ35H',
};

/** Read every record from a reference table (selected fields), paginated. */
export async function listAll(tableId, fieldIds = [], { filterByFormula } = {}) {
  const params = new URLSearchParams({ returnFieldsByFieldId: 'true', pageSize: '100' });
  fieldIds.forEach(f => params.append('fields[]', f));
  if (filterByFormula) params.set('filterByFormula', filterByFormula);
  const out = [];
  let offset;
  do {
    if (offset) params.set('offset', offset);
    const data = await refFetch(`/${tableId}?${params}`);
    out.push(...data.records);
    offset = data.offset;
  } while (offset);
  return out;
}

// Status choices that exist on the table (no dedicated "stale" option).
export const AIRPORT_STATUS = { DONE: 'Done', LIVE: 'Live', IN_PROGRESS: 'In progress', TODO: 'Todo', DRAFT: 'Draft' };

export function refConfigured() { return !!PAT; }

async function refFetch(path, options = {}, attempt = 1) {
  const url = `${AIRTABLE_API}/${BASE_ID}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  if (res.status === 429 && attempt <= 3) {
    await new Promise(r => setTimeout(r, 1000 * 2 ** (attempt - 1)));
    return refFetch(path, options, attempt + 1);
  }
  if (res.status >= 500 && res.status < 600 && attempt <= 2) {
    await new Promise(r => setTimeout(r, 500 * attempt));
    return refFetch(path, options, attempt + 1);
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
 * Airports whose freshness has lapsed (Verified Date older than ttlDays, or
 * blank) AND that have at least one cited source we can re-check against.
 */
export async function listDueAirports({ ttlDays = 30, limit = 15 } = {}) {
  const stale = `OR({Verified Date}=BLANK(),IS_BEFORE({Verified Date},DATEADD(TODAY(),-${ttlDays},'days')))`;
  const hasSource = `OR(NOT({Wikipedia URL}=BLANK()),NOT({Official Website}=BLANK()))`;
  const params = new URLSearchParams({ returnFieldsByFieldId: 'true', pageSize: '100' });
  params.set('filterByFormula', `AND(${stale},${hasSource})`);
  params.append('sort[0][field]', 'Verified Date');
  params.append('sort[0][direction]', 'asc');
  const out = [];
  let offset;
  do {
    if (offset) params.set('offset', offset);
    const data = await refFetch(`/${AIRPORTS_TBL}?${params}`);
    out.push(...data.records);
    offset = data.offset;
  } while (offset && out.length < limit);
  return out.slice(0, limit);
}

export async function countDueAirports({ ttlDays = 30 } = {}) {
  // Cheap-ish count: fetch ids only.
  const stale = `OR({Verified Date}=BLANK(),IS_BEFORE({Verified Date},DATEADD(TODAY(),-${ttlDays},'days')))`;
  const params = new URLSearchParams({ returnFieldsByFieldId: 'true', pageSize: '100' });
  params.set('filterByFormula', stale);
  params.append('fields[]', AF.iata);
  let n = 0, offset;
  do {
    if (offset) params.set('offset', offset);
    const data = await refFetch(`/${AIRPORTS_TBL}?${params}`);
    n += data.records.length;
    offset = data.offset;
  } while (offset);
  return n;
}

export async function restampVerified(id, isoDate) {
  return refFetch(`/${AIRPORTS_TBL}/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields: { [AF.verifiedDate]: isoDate }, typecast: true, returnFieldsByFieldId: true }),
  });
}

export async function setAirportStatus(id, statusName) {
  return refFetch(`/${AIRPORTS_TBL}/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields: { [AF.status]: statusName }, typecast: true, returnFieldsByFieldId: true }),
  });
}
