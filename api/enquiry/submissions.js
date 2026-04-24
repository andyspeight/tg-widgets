/**
 * Submissions inbox API — read + update handlers for the inbox page.
 *
 *   GET  /api/enquiry/submissions
 *     List submissions for the authenticated agent.
 *     Query params:
 *       status   — comma-separated statuses (New, Read, Archived, Converted). Default: New,Read.
 *       formId   — limit to one form (e.g. EF-0001)
 *       q        — free-text search (reference, name, destination, etc.)
 *       from,to  — ISO date range
 *       cursor   — pagination cursor from previous response
 *       limit    — page size, default 50, max 100
 *
 *   GET  /api/enquiry/submissions?id=<recordId>
 *     Fetch a single submission in full. Auto-stamps Agent Read At on first view.
 *
 *   PATCH /api/enquiry/submissions?id=<recordId>
 *     Update status or internal note.
 *     Body: { status?: 'New'|'Read'|'Archived'|'Converted', internalNote?: string }
 *
 * Auth: shared tgw_session JWT via _auth.js. Ownership is enforced server-side
 * by filtering on Owner Email. Bypass attempts via query params are ignored.
 */

import { requireAuth, setCors, applyRateLimit, RATE_LIMITS, sanitiseForFormula } from '../_auth.js';

const BASE_ID = process.env.TG_ENQUIRIES_AIRTABLE_BASE_ID || 'appQJYiPZVU5jMAml';
const PAT = process.env.TG_ENQUIRIES_AIRTABLE_PAT;
const TABLE_SUBMISSIONS = 'tblxtRPhALFjeMVA6';

// Field ID map — decouples this code from any future field renames in Airtable.
// Source: Submissions table schema (2026-04-23).
const F = {
  reference:       'fldNXTIZnLr7EwSf1',
  sequential:      'fldNO4d15W4xaXYLd',
  refPrefix:       'fld4335lLxU55RKzS',
  formRecordId:    'fldk4fGMTm1BFY7MD',
  formId:          'fldMDhl75atiALwj4',
  formName:        'fldR4ipGZ4tp6fPrZ',
  clientName:      'fldJK3dXI664gGO9v',
  visitorId:       'fldOcQW20Q0L19P9G',
  ipAddress:       'fldTS4E0HWXc1IbZs',
  userAgent:       'fldaHLfF6bfNVQCbE',
  sourceUrl:       'fld6Ko6chs2aerwPg',
  locale:          'fldO9laEEYmzTMl6V',
  firstName:       'fldHIsFu8aTma2Udh',
  lastName:        'fldokNLczzqR1dJkF',
  email:           'fldNhL2013qhCCU87',
  phone:           'fldeSiHPPRo983s8f',
  destinations:    'fldanxHheVASVcVHj',
  departureAirport:'fldA0JrLek6nvuZfC',
  departDate:      'fldsuLhoevjubPcBF',
  returnDate:      'fldgUVAATk4ptvuEQ',
  flexibleDates:   'fldWTNvplA98gEfNt',
  durationNights:  'fldukKv5npF3yu7xy',
  customDuration:  'fldKR402UW3FkmMGv',
  adults:          'fldsc0GlhRfT7KExm',
  children:        'fldBcyotWmETyjSOB',
  childAges:       'fldg8LtnXntJsVkdn',
  infants:         'fldF8uRIwmb6aDtsY',
  budgetPP:        'fldIbsjCV7EThsowD',
  stars:           'fldysKVijEzqo1wWH',
  boardBasis:      'fld8FymwGJmeb0PPe',
  interests:       'fldl6rVXUjLmSOb7v',
  notes:           'fldEQAYJmYQlatoWq',
  contactConsent:  'fld4kh6AfKWuamN0i',
  marketingConsent:'fldiHCjnbG8EaWj6Z',
  rawPayload:      'fld1LrJ05E51ieQaF',
  routingStatus:   'fldwxrWm49MhddhUd',
  status:          'fld4C1iU7lC3BVmtU',
  submittedAt:     'fldp2oKqNRcCrMcLG',
  ownerEmail:      'fldPP6tud7N2wwcUG',
  internalNote:    'fldpZxNwdkYyZo8NA',
  agentReadAt:     'fldJTd4qlZM1u1VBl',
  lunaChatConv:    'fldtnySO7g4Ve7aNS',
  lunaWorkLead:    'fldrH7JulBo0O4hWZ',
  gdprRequested:   'fldSoTM5ogUOn4dTL',
  gdprDeletedAt:   'fldXdzFytvkzsFPgi',
  // Email delivery tracking (populated by sendgrid-webhook.js from SendGrid
  // Event Webhook events). Status is the single "best" state (Delivered,
  // Opened, Clicked, Bounced, etc.) and Events is the JSON audit log.
  emailStatus:     'fld5vnl2pMMTkaJXZ',
  emailEvents:     'fldY8o2tEXYDf2Eed',
};

const VALID_STATUSES = ['New', 'Read', 'Archived', 'Converted'];
// Email status values the inbox can filter by. Matches the single-select
// options in Airtable exactly — any mismatch would silently filter to 0.
const VALID_EMAIL_STATUSES = [
  'Processed', 'Deferred', 'Delivered', 'Opened',
  'Clicked', 'Bounced', 'Dropped', 'Spam Reported',
];
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export default async function handler(req, res) {
  // CORS via shared helper — consistent with the rest of the API
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!PAT) {
    return res.status(500).json({ error: 'Server misconfigured: missing TG_ENQUIRIES_AIRTABLE_PAT' });
  }

  // Auth — requireAuth returns { user } on success or { error, status } on failure
  const authResult = requireAuth(req);
  if (authResult.error) {
    return res.status(authResult.status).json({ error: authResult.error });
  }
  const agentEmail = String(authResult.user.email || '').toLowerCase().trim();
  if (!agentEmail) {
    return res.status(401).json({ error: 'Session missing email' });
  }

  // Rate limit — per-agent, generous since this is dashboard-style read traffic
  if (!applyRateLimit(res, `inbox:${agentEmail}`, RATE_LIMITS.widgetRead)) return;

  try {
    if (req.method === 'GET') {
      const id = req.query && req.query.id;
      if (id) return await handleGetOne(req, res, agentEmail, id);
      return await handleList(req, res, agentEmail);
    }
    if (req.method === 'PATCH') {
      const id = req.query && req.query.id;
      if (!id) return res.status(400).json({ error: 'Missing submission id' });
      return await handlePatch(req, res, agentEmail, id);
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[submissions] fatal', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/* ============================== LIST ============================== */
async function handleList(req, res, agentEmail) {
  const q = req.query || {};
  const status = q.status || 'New,Read';
  const formId = q.formId || '';
  const search = q.q || '';
  const from = q.from || '';
  const to = q.to || '';
  const cursor = q.cursor || '';
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  // Email status filter — optional. Comma-separated list of valid values.
  // e.g. ?emailStatus=Bounced  or  ?emailStatus=Bounced,Dropped,Spam%20Reported
  const emailStatus = q.emailStatus || '';

  // Filter formula — ALWAYS scoped to agent's ownership. No way to override.
  const filters = [
    `LOWER({${F.ownerEmail}}) = '${sanitiseForFormula(agentEmail)}'`
  ];

  const statusList = status.split(',').map(s => s.trim()).filter(s => VALID_STATUSES.includes(s));
  if (statusList.length) {
    const orClauses = statusList.map(s => `{${F.status}} = '${s}'`);
    filters.push(`OR(${orClauses.join(',')})`);
  }

  // Email status filter — whitelisted to avoid injection via formula
  if (emailStatus) {
    const emailList = emailStatus.split(',').map(s => s.trim()).filter(s => VALID_EMAIL_STATUSES.includes(s));
    if (emailList.length) {
      const orClauses = emailList.map(s => `{${F.emailStatus}} = '${s}'`);
      filters.push(`OR(${orClauses.join(',')})`);
    }
  }

  if (formId && /^[A-Za-z0-9-]+$/.test(formId)) {
    filters.push(`{${F.formId}} = '${sanitiseForFormula(formId)}'`);
  }

  if (from && /^\d{4}-\d{2}-\d{2}/.test(from)) {
    filters.push(`IS_AFTER({${F.submittedAt}}, DATETIME_PARSE('${from}', 'YYYY-MM-DD'))`);
  }
  if (to && /^\d{4}-\d{2}-\d{2}/.test(to)) {
    filters.push(`IS_BEFORE({${F.submittedAt}}, DATETIME_PARSE('${to}', 'YYYY-MM-DD') + 86400000)`);
  }

  if (search && search.trim()) {
    const safe = sanitiseForFormula(search.trim().toLowerCase());
    filters.push(
      `OR(` +
        `FIND('${safe}', LOWER({${F.reference}})),` +
        `FIND('${safe}', LOWER({${F.firstName}})),` +
        `FIND('${safe}', LOWER({${F.lastName}})),` +
        `FIND('${safe}', LOWER({${F.email}})),` +
        `FIND('${safe}', LOWER({${F.formName}})),` +
        `FIND('${safe}', LOWER({${F.destinations}})),` +
        `FIND('${safe}', LOWER({${F.notes}}))` +
      `)`
    );
  }

  const filterFormula = filters.length > 1 ? `AND(${filters.join(',')})` : filters[0];

  const params = new URLSearchParams({
    filterByFormula: filterFormula,
    pageSize: String(limit),
    'sort[0][field]': F.submittedAt,
    'sort[0][direction]': 'desc',
  });
  // Minimal fields for list view — keeps the payload small and avoids
  // leaking IP / user agent / raw payload until the drawer is opened.
  // Includes emailStatus so the list row can show a small delivery dot
  // without a second round-trip.
  const listFields = [
    F.reference, F.formId, F.formName, F.firstName, F.lastName,
    F.email, F.destinations, F.departDate, F.adults, F.children,
    F.budgetPP, F.status, F.submittedAt, F.agentReadAt,
    F.emailStatus,
  ];
  listFields.forEach(f => params.append('fields[]', f));

  if (cursor) params.append('offset', cursor);

  // CRITICAL: returnFieldsByFieldId=true is what makes record.fields keyed
  // by field ID (fldXXX) rather than field name. All downstream code reads
  // records via the F.* field-ID map, so this must be set.
  params.append('returnFieldsByFieldId', 'true');

  const atUrl = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_SUBMISSIONS}?${params.toString()}`;
  const atResponse = await fetch(atUrl, {
    headers: { Authorization: `Bearer ${PAT}` }
  });
  if (!atResponse.ok) {
    const body = await atResponse.text();
    console.error('[submissions] list failed', atResponse.status, body);
    return res.status(502).json({ error: 'Failed to fetch submissions' });
  }
  const data = await atResponse.json();

  const submissions = (data.records || []).map(rec => mapListRecord(rec));

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    submissions,
    nextCursor: data.offset || null,
    count: submissions.length,
  });
}

/* ============================ GET ONE ============================ */
async function handleGetOne(req, res, agentEmail, id) {
  if (!/^rec[A-Za-z0-9]{14}$/.test(id)) {
    return res.status(400).json({ error: 'Invalid submission id' });
  }

  // See list handler — same reason: need field IDs not names
  const atUrl = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_SUBMISSIONS}/${id}?returnFieldsByFieldId=true`;
  const atResponse = await fetch(atUrl, { headers: { Authorization: `Bearer ${PAT}` } });
  if (atResponse.status === 404) return res.status(404).json({ error: 'Submission not found' });
  if (!atResponse.ok) {
    console.error('[submissions] getOne failed', atResponse.status);
    return res.status(502).json({ error: 'Failed to fetch submission' });
  }
  const record = await atResponse.json();

  const recordOwner = String(record.fields[F.ownerEmail] || '').toLowerCase().trim();
  if (recordOwner !== agentEmail) {
    return res.status(403).json({ error: 'Not authorised to view this submission' });
  }

  // Auto-mark as read — stamps Agent Read At if null, and flips status
  // New → Read. Doesn't clobber Archived/Converted.
  const currentStatus = record.fields[F.status] || 'New';
  if (!record.fields[F.agentReadAt]) {
    const updates = { [F.agentReadAt]: new Date().toISOString() };
    if (currentStatus === 'New') updates[F.status] = 'Read';
    // Fire-and-forget — don't block the response
    fetch(atUrl, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${PAT}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fields: updates, typecast: true })
    }).catch(e => console.warn('[submissions] read-stamp failed', e));
    record.fields[F.agentReadAt] = updates[F.agentReadAt];
    if (updates[F.status]) record.fields[F.status] = updates[F.status];
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ submission: mapDetailRecord(record) });
}

/* ============================ PATCH ============================ */
async function handlePatch(req, res, agentEmail, id) {
  if (!/^rec[A-Za-z0-9]{14}$/.test(id)) {
    return res.status(400).json({ error: 'Invalid submission id' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); }
    catch (e) { return res.status(400).json({ error: 'Invalid JSON body' }); }
  }
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'Missing body' });
  }

  // Re-check ownership before mutating. Small extra roundtrip but prevents
  // cross-agent writes if any request-state is stale.
  const getUrl = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_SUBMISSIONS}/${id}?fields[]=${F.ownerEmail}&returnFieldsByFieldId=true`;
  const getRes = await fetch(getUrl, { headers: { Authorization: `Bearer ${PAT}` } });
  if (getRes.status === 404) return res.status(404).json({ error: 'Submission not found' });
  if (!getRes.ok) return res.status(502).json({ error: 'Airtable read failed' });
  const existing = await getRes.json();
  const owner = String(existing.fields[F.ownerEmail] || '').toLowerCase().trim();
  if (owner !== agentEmail) {
    return res.status(403).json({ error: 'Not authorised to modify this submission' });
  }

  const fields = {};
  if (body.status !== undefined) {
    if (!VALID_STATUSES.includes(body.status)) {
      return res.status(400).json({ error: 'Invalid status value' });
    }
    fields[F.status] = body.status;
  }
  if (body.internalNote !== undefined) {
    // Cap at 5000 chars to prevent bloat
    fields[F.internalNote] = String(body.internalNote).slice(0, 5000);
  }
  if (Object.keys(fields).length === 0) {
    return res.status(400).json({ error: 'No updatable fields provided' });
  }

  const patchUrl = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_SUBMISSIONS}/${id}`;
  const patchRes = await fetch(patchUrl, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${PAT}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ fields, typecast: true })
  });
  if (!patchRes.ok) {
    const bodyText = await patchRes.text();
    console.error('[submissions] patch failed', patchRes.status, bodyText);
    return res.status(502).json({ error: 'Failed to update submission' });
  }
  const updated = await patchRes.json();
  return res.status(200).json({ submission: mapDetailRecord(updated) });
}

/* ======================== MAPPERS ======================== */
function mapListRecord(rec) {
  const f = rec.fields || {};
  return {
    id: rec.id,
    reference: f[F.reference] || '',
    formId: f[F.formId] || '',
    formName: f[F.formName] || '',
    firstName: f[F.firstName] || '',
    lastName: f[F.lastName] || '',
    email: f[F.email] || '',
    destinations: parseJsonField(f[F.destinations]),
    departDate: f[F.departDate] || null,
    adults: f[F.adults] || 0,
    children: f[F.children] || 0,
    budgetPP: f[F.budgetPP] || null,
    status: f[F.status] || 'New',
    submittedAt: f[F.submittedAt] || null,
    agentReadAt: f[F.agentReadAt] || null,
    unread: !f[F.agentReadAt] && (f[F.status] || 'New') === 'New',
    // Email delivery state for the row dot. Null if the email has not yet
    // moved through SendGrid (still in processing) — UI shows a neutral dot.
    emailStatus: f[F.emailStatus] || null,
  };
}

function mapDetailRecord(rec) {
  const f = rec.fields || {};
  return {
    id: rec.id,
    reference: f[F.reference] || '',
    sequential: f[F.sequential] || null,
    refPrefix: f[F.refPrefix] || '',

    form: {
      recordId: f[F.formRecordId] || '',
      id: f[F.formId] || '',
      name: f[F.formName] || '',
      clientName: f[F.clientName] || '',
    },

    contact: {
      firstName: f[F.firstName] || '',
      lastName: f[F.lastName] || '',
      fullName: [f[F.firstName], f[F.lastName]].filter(Boolean).join(' '),
      email: f[F.email] || '',
      phone: f[F.phone] || '',
    },

    trip: {
      destinations: parseJsonField(f[F.destinations]),
      departureAirport: f[F.departureAirport] || '',
      departDate: f[F.departDate] || null,
      returnDate: f[F.returnDate] || null,
      flexibleDates: !!f[F.flexibleDates],
      durationNights: f[F.durationNights] || null,
      customDuration: f[F.customDuration] || '',
      adults: f[F.adults] || 0,
      children: f[F.children] || 0,
      childAges: parseJsonField(f[F.childAges]),
      infants: f[F.infants] || 0,
      budgetPP: f[F.budgetPP] || null,
      stars: f[F.stars] || null,
      boardBasis: f[F.boardBasis] || '',
      interests: parseJsonField(f[F.interests]),
      notes: f[F.notes] || '',
    },

    consent: {
      contact: !!f[F.contactConsent],
      marketing: !!f[F.marketingConsent],
    },

    context: {
      visitorId: f[F.visitorId] || '',
      ipAddress: f[F.ipAddress] || '',
      userAgent: f[F.userAgent] || '',
      sourceUrl: f[F.sourceUrl] || '',
      locale: f[F.locale] || '',
    },

    status: f[F.status] || 'New',
    internalNote: f[F.internalNote] || '',
    agentReadAt: f[F.agentReadAt] || null,
    submittedAt: f[F.submittedAt] || null,

    routingStatus: parseJsonField(f[F.routingStatus]),
    rawPayload: parseJsonField(f[F.rawPayload]),

    lunaChatConversationId: f[F.lunaChatConv] || '',
    lunaWorkLeadId: f[F.lunaWorkLead] || '',

    gdpr: {
      deletionRequested: !!f[F.gdprRequested],
      deletedAt: f[F.gdprDeletedAt] || null,
    },

    // Email delivery tracking — status is the single best state, events is
    // the full audit log used by the drawer to render the delivery timeline.
    email: {
      status: f[F.emailStatus] || null,
      events: parseJsonField(f[F.emailEvents]) || [],
    },
  };
}

/* ======================== HELPERS ======================== */
function parseJsonField(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); }
  catch (e) { return raw; }
}
