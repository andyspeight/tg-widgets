// =============================================================================
//  /api/_lib/routing/log.js
// =============================================================================
//
//  Writes to the RoutingLog table. One record per (lead × destination attempt).
//  Also writes the master Submissions record and stamps the lead with the
//  resulting record ID.
//
//  Fire-and-forget pattern: log writes never throw upward. A failed log
//  entry is annoying but must not block lead delivery. Errors are emitted
//  to console.error for the Vercel logs.
//
//  PLACEHOLDERS — patch after Airtable schema is created. See /docs/SCHEMA.md.
//
// =============================================================================

import { randomBytes } from 'crypto';
import { redactLead } from './schema.js';

const ENQUIRIES_BASE_ID = process.env.TG_ENQUIRIES_AIRTABLE_BASE_ID;
const ENQUIRIES_PAT = process.env.TG_ENQUIRIES_AIRTABLE_PAT;

// ⚠️ Patch after schema is created
export const LOG_TABLE_ID = process.env.ROUTING_LOG_TABLE_ID || 'tblPLACEHOLDER_LOG';
export const SUBMISSIONS_TABLE_ID = 'tblxtRPhALFjeMVA6'; // existing, stable

// ── PLACEHOLDER FIELD IDS — patch after schema is created ──────────────

export const LOG_FIELDS = {
  logId:          'fldPLACEHOLDER_LOG_ID',
  leadId:         'fldPLACEHOLDER_LEAD_ID',
  submission:     'fldPLACEHOLDER_LOG_SUBMISSION',
  routingConfig:  'fldPLACEHOLDER_LOG_CONFIG',
  widgetType:     'fldPLACEHOLDER_LOG_WIDGET_TYPE',
  widgetRecordId: 'fldPLACEHOLDER_LOG_WIDGET_REC_ID',
  clientEmail:    'fldPLACEHOLDER_LOG_CLIENT_EMAIL',
  destination:    'fldPLACEHOLDER_LOG_DESTINATION',
  status:         'fldPLACEHOLDER_LOG_STATUS',
  statusCode:     'fldPLACEHOLDER_LOG_STATUS_CODE',
  errorMessage:   'fldPLACEHOLDER_LOG_ERROR',
  durationMs:     'fldPLACEHOLDER_LOG_DURATION',
  attempt:        'fldPLACEHOLDER_LOG_ATTEMPT',
  testMode:       'fldPLACEHOLDER_LOG_TEST_MODE',
  requestPayload: 'fldPLACEHOLDER_LOG_REQ',
  responseBody:   'fldPLACEHOLDER_LOG_RESP',
};

// Existing Submissions table — using IDs from the existing enquiry submit endpoint
export const SUBMISSION_FIELDS = {
  reference:      'fldNXTIZnLr7EwSf1',
  formId:         'fldMDhl75atiALwj4',
  formName:       'fldR4ipGZ4tp6fPrZ',
  clientName:     'fldJK3dXI664gGO9v',
  visitorId:      'fldOcQW20Q0L19P9G',
  ipAddress:      'fldTS4E0HWXc1IbZs',
  userAgent:      'fldaHLfF6bfNVQCbE',
  sourceUrl:      'fld6Ko6chs2aerwPg',
  firstName:      'fldHIsFu8aTma2Udh',
  lastName:       'fldokNLczzqR1dJkF',
  email:          'fldNhL2013qhCCU87',
  phone:          'fldeSiHPPRo983s8f',
  destinationsJSON:'fldanxHheVASVcVHj',
  departureAirport:'fldA0JrLek6nvuZfC',
  departDate:     'fldsuLhoevjubPcBF',
  returnDate:     'fldgUVAATk4ptvuEQ',
  flexibleDates:  'fldWTNvplA98gEfNt',
  durationNights: 'fldukKv5npF3yu7xy',
  customDuration: 'fldKR402UW3FkmMGv',
  adults:         'fldsc0GlhRfT7KExm',
  children:       'fldBcyotWmETyjSOB',
  childAgesJSON:  'fldg8LtnXntJsVkdn',
  infants:        'fldF8uRIwmb6aDtsY',
  budgetPP:       'fldIbsjCV7EThsowD',
  stars:          'fldysKVijEzqo1wWH',
  boardBasis:     'fld8FymwGJmeb0PPe',
  interestsJSON:  'fldl6rVXUjLmSOb7v',
  notes:          'fldEQAYJmYQlatoWq',
  contactConsent: 'fld4kh6AfKWuamN0i',
  marketingConsent:'fldiHCjnbG8EaWj6Z',
  rawPayloadJSON: 'fld1LrJ05E51ieQaF',
  routingStatusJSON:'fldwxrWm49MhddhUd',
  status:         'fld4C1iU7lC3BVmtU',
  ownerEmail:     'fldPP6tud7N2wwcUG',

  // ⚠️ These fields are NEW — patch IDs after schema additions
  sourceWidget:    'fldPLACEHOLDER_SUB_SOURCE_WIDGET',
  sourceWidgetId:  'fldPLACEHOLDER_SUB_SOURCE_WIDGET_ID',
  leadId:          'fldPLACEHOLDER_SUB_LEAD_ID',
  tags:            'fldPLACEHOLDER_SUB_TAGS',
  customFieldsJSON:'fldPLACEHOLDER_SUB_CUSTOM_JSON',
  visitorIdNew:    'fldPLACEHOLDER_SUB_VISITOR_ID',
};

// ── Helpers ─────────────────────────────────────────────────────────────

function generateLogId() {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  return `LOG-${yyyy}${mm}${dd}-${randomBytes(3).toString('hex').toUpperCase()}`;
}

function generateReference() {
  const now = new Date();
  const yy = String(now.getUTCFullYear()).slice(2);
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const rand = randomBytes(2).toString('hex').toUpperCase();
  return `LEAD-${yy}${mm}${dd}-${rand}`;
}

function airtableUrl(tableId, recordId) {
  let u = `https://api.airtable.com/v0/${ENQUIRIES_BASE_ID}/${tableId}`;
  if (recordId) u += `/${recordId}`;
  return u;
}

async function airtableRequest(method, tableId, body, recordId) {
  if (!ENQUIRIES_BASE_ID || !ENQUIRIES_PAT) {
    throw new Error('Airtable env vars not configured');
  }
  const resp = await fetch(airtableUrl(tableId, recordId), {
    method,
    headers: {
      'Authorization': `Bearer ${ENQUIRIES_PAT}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`Airtable ${resp.status}: ${txt.slice(0, 200)}`);
  }
  return resp.json();
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Write the master Submissions record for a lead.
 * Returns the new record ID, or null if the write failed.
 *
 * If new schema fields haven't been added yet (placeholder field IDs),
 * we still write to the proven existing fields and skip the new ones.
 */
export async function writeSubmission(lead, options = {}) {
  if (!ENQUIRIES_BASE_ID || !ENQUIRIES_PAT) {
    console.warn('[log] Cannot write submission — Airtable env not configured');
    return null;
  }

  const f = SUBMISSION_FIELDS;
  const fields = {};

  // Always-on fields (proven, exist today)
  fields[f.reference] = generateReference();
  fields[f.email] = lead.contact.email;
  if (lead.contact.firstName) fields[f.firstName] = lead.contact.firstName;
  if (lead.contact.lastName) fields[f.lastName] = lead.contact.lastName;
  if (lead.contact.phone) fields[f.phone] = lead.contact.phone;
  if (lead.source.sourceUrl) {
    try {
      const u = new URL(lead.source.sourceUrl);
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        fields[f.sourceUrl] = lead.source.sourceUrl;
      }
    } catch {}
  }
  if (lead.source.ipAddress) fields[f.ipAddress] = lead.source.ipAddress;
  if (lead.source.userAgent) fields[f.userAgent] = lead.source.userAgent;
  if (lead.source.clientName) fields[f.clientName] = lead.source.clientName;

  // Travel canonical → existing fields
  if (lead.travel.destinations.length) fields[f.destinationsJSON] = JSON.stringify(lead.travel.destinations);
  if (lead.travel.departureAirport) fields[f.departureAirport] = lead.travel.departureAirport;
  if (lead.travel.departDate) fields[f.departDate] = lead.travel.departDate;
  if (lead.travel.returnDate) fields[f.returnDate] = lead.travel.returnDate;
  if (lead.travel.flexibleDates) fields[f.flexibleDates] = true;
  if (lead.travel.durationNights != null) fields[f.durationNights] = lead.travel.durationNights;
  if (lead.travel.customDuration) fields[f.customDuration] = lead.travel.customDuration;
  if (lead.travel.adults != null) fields[f.adults] = lead.travel.adults;
  if (lead.travel.children != null) fields[f.children] = lead.travel.children;
  if (lead.travel.childAges.length) fields[f.childAgesJSON] = JSON.stringify(lead.travel.childAges);
  if (lead.travel.infants != null) fields[f.infants] = lead.travel.infants;
  if (lead.travel.budgetPP != null) fields[f.budgetPP] = lead.travel.budgetPP;
  if (lead.travel.starRating != null) fields[f.stars] = lead.travel.starRating;
  if (lead.travel.boardBasis) fields[f.boardBasis] = lead.travel.boardBasis;
  if (lead.travel.interests.length) fields[f.interestsJSON] = JSON.stringify(lead.travel.interests);

  // Notes — keep the [POPUP LEAD] / [WIDGET] prefix for back-compat with
  // existing inbox views until the SourceWidget field is added
  const widgetTag = `[${(lead.source.widget || 'WIDGET').toUpperCase()}]`;
  const noteParts = [
    widgetTag,
    `Tags: ${lead.tags.join(', ')}`,
    `Lead ID: ${lead.leadId}`,
    lead.source.referrer ? `Referrer: ${lead.source.referrer}` : '',
  ].filter(Boolean);
  fields[f.notes] = noteParts.join(' | ').slice(0, 5000);

  // Consent
  if (lead.consent.contact) fields[f.contactConsent] = true;
  if (lead.consent.marketing) fields[f.marketingConsent] = true;

  // Raw + routing status
  fields[f.rawPayloadJSON] = JSON.stringify(redactLead(lead)).slice(0, 100000);
  fields[f.status] = 'New';

  // ⚠️ NEW FIELDS — only write if the field IDs have been patched away
  // from placeholders (otherwise Airtable will 422)
  const NEW_FIELDS = ['sourceWidget', 'sourceWidgetId', 'leadId', 'tags', 'customFieldsJSON', 'visitorIdNew'];
  for (const key of NEW_FIELDS) {
    if (f[key] && !f[key].startsWith('fldPLACEHOLDER')) {
      if (key === 'sourceWidget') fields[f.sourceWidget] = lead.source.widget;
      if (key === 'sourceWidgetId') fields[f.sourceWidgetId] = lead.source.widgetId;
      if (key === 'leadId') fields[f.leadId] = lead.leadId;
      if (key === 'tags' && lead.tags.length) fields[f.tags] = lead.tags;
      if (key === 'customFieldsJSON' && Object.keys(lead.custom).length) {
        fields[f.customFieldsJSON] = JSON.stringify(lead.custom);
      }
      if (key === 'visitorIdNew' && lead.source.visitorId) {
        fields[f.visitorIdNew] = lead.source.visitorId;
      }
    }
  }

  try {
    const result = await airtableRequest('POST', SUBMISSIONS_TABLE_ID, {
      records: [{ fields }],
      typecast: true,
    });
    const rec = result.records?.[0];
    return rec?.id || null;
  } catch (err) {
    console.error('[log] writeSubmission failed:', err.message);
    return null;
  }
}

/**
 * Write a single RoutingLog entry for a dispatch attempt.
 * Fire-and-forget; never throws.
 */
export async function writeLog(entry) {
  if (LOG_TABLE_ID.startsWith('tblPLACEHOLDER')) {
    // Schema not ready yet — just emit to console so we don't lose the trail
    console.log('[routing-log]', JSON.stringify(entry));
    return null;
  }

  const f = LOG_FIELDS;
  const fields = {};
  fields[f.logId] = entry.logId || generateLogId();
  if (entry.leadId) fields[f.leadId] = entry.leadId;
  if (entry.submissionRecordId) fields[f.submission] = [entry.submissionRecordId];
  if (entry.configRecordId) fields[f.routingConfig] = [entry.configRecordId];
  if (entry.widgetType) fields[f.widgetType] = entry.widgetType;
  if (entry.widgetRecordId) fields[f.widgetRecordId] = entry.widgetRecordId;
  if (entry.clientEmail) fields[f.clientEmail] = entry.clientEmail;
  if (entry.destination) fields[f.destination] = entry.destination;
  if (entry.status) fields[f.status] = entry.status;
  if (entry.statusCode != null) fields[f.statusCode] = entry.statusCode;
  if (entry.errorMessage) fields[f.errorMessage] = String(entry.errorMessage).slice(0, 5000);
  if (entry.durationMs != null) fields[f.durationMs] = entry.durationMs;
  if (entry.attempt) fields[f.attempt] = entry.attempt;
  if (entry.testMode) fields[f.testMode] = true;
  if (entry.requestPayload) {
    fields[f.requestPayload] = (typeof entry.requestPayload === 'string'
      ? entry.requestPayload
      : JSON.stringify(entry.requestPayload)).slice(0, 10000);
  }
  if (entry.responseBody) {
    fields[f.responseBody] = String(entry.responseBody).slice(0, 2000);
  }

  try {
    await airtableRequest('POST', LOG_TABLE_ID, {
      records: [{ fields }],
      typecast: true,
    });
    return fields[f.logId];
  } catch (err) {
    console.error('[log] writeLog failed:', err.message);
    return null;
  }
}
