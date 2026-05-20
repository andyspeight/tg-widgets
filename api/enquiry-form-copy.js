/**
 * POST /api/enquiry-form-copy
 *
 * Duplicates an Enquiry Form. Enquiry forms live in TWO Airtable records:
 *   1. A pointer record in the Widgets table (main base) — the dashboard
 *      reads this for the widget list.
 *   2. The real record in the Enquiry Forms table — holds all fields, JSON,
 *      routing config, anti-spam, integrations, encrypted PAT, etc.
 *
 * The copy creates fresh records in both tables, linked by a new widgetId.
 *
 * The new form:
 *   - gets a fresh widgetId (tgw_xxx); FormID is a formula, regenerates itself
 *   - has " (Copy)" appended to its Form Name (or uses caller-supplied name)
 *   - belongs to the SAME user as the source
 *   - has Status = 'Draft' by design — users explicitly opted into a "review
 *     before going live" workflow; copies don't go straight to Live
 *   - resets SubmissionCount to 0 (submissions belong to the original record)
 *   - copies the encrypted Airtable PAT verbatim (per user choice — see
 *     yesterday's scoping conversation; if security tightens later, drop
 *     the PAT fields from the copyable list below)
 *
 * Request:  { widgetId: 'tgw_xxx', name?: 'New name' }
 * Response: { success: true, widgetId, recordId, formId }
 *
 * Rollback: if pointer create fails after EF create succeeds, we delete the
 * orphaned EF record. Pattern lifted from enquiry-form-config.js create path.
 */

import { requireAuth, setCors, applyRateLimit, RATE_LIMITS } from './_auth.js';
import { getRecord } from './_lib/auth/airtable.js';
import { USERS } from './_lib/auth/schema.js';

const AIRTABLE_API = 'https://api.airtable.com/v0';
const WIDGETS_TABLE = 'Widgets';
const ENQUIRY_FORMS_TABLE = 'tblpw4TCmQfJHZIlF'; // ID — name has spaces

// Field IDs in the Enquiry Forms table. MUST match enquiry-form-config.js EF.
// Kept inline (not imported) to keep this file self-contained — if the schema
// changes, both files need updating either way.
const EF = {
  formName:            'fldC0MLSyJqg6U1zT',
  sequential:          'fldatpd9Ms5J5JGPy',
  clientName:          'fldrw1eTFYCFIo0pp',
  status:              'fldTR9W1dhMRoT0MK',
  template:            'fldaM2kxvZDutozGT',
  layoutMode:          'fldCEfu1NVD9Ewp4O',
  fieldsJSON:          'fldYdK8X3BgN7hPCx',
  stepsJSON:           'flddIHep7nOXNugJK',
  headerTitle:         'fldCflEWJo9YxxA8Y',
  headerSubtitle:      'fldRBu8uajKutfX60',
  submitButtonText:    'fldjrfgcfK7580bft',
  thankYouMode:        'fldTy6oSMKUwYEYjQ',
  thankYouMessage:     'fldiB3PkfcsHRKEWd',
  redirectUrl:         'fldYkShCNfibHChpg',
  referencePrefix:     'fldXJxPXCLBnQeb7f',
  buttonColour:        'fldxyawmdBzNiOb7g',
  accentColour:        'fldD113UMPvDR4zOL',
  theme:               'fldliFN8Q7koARRU5',
  routingGoogleSheets: 'fldGg7Yew1GCkmW08',
  sheetId:             'fldtfW0lFELg7yiv2',
  sheetTab:            'fldJ9KIeaiVsU4jP4',
  routingAirtable:     'fld3JRqVuEKw2R9Hy',
  airtableBaseId:      'fldMJzweCfekIBAoF',
  airtableTableId:     'flddiEIebjjtGJMWY',
  airtablePAT:         'fldA6v05RBuCovsh6',
  airtablePATVerifiedAt:'fldU9OeeLqwRVfPYN',
  airtablePATLastError:'fldEvB2ncXRAVZQIG',
  airtableFieldMap:    'fldMF5oFaWCyqsNhL',
  routingEmail:        'fldkwZwxheNZJ8CrH',
  routingEmailTo:      'fldlu1HcErBfp2wh2',
  routingAutoReply:    'fldmqrE0BG0xuWTMx',
  emailTemplateHTML:   'fldmboZUbr73kiuyJ',
  autoReplyHTML:       'fldTocc7Yd5IurXVl',
  routingWebhook:      'fldH7rQpSid6uqw0p',
  webhookURL:          'fldNyUqKUUDElxrGS',
  webhookSecret:       'fldcoECqbqhWSj7eW',
  routingLunaWork:     'fld3RUFhBQPmFZpAW',
  routingLunaMarketing:'fld1HDVC7zzb5LL4d',
  routingLunaChat:     'fldrnewg30EV3xMzY',
  antiSpamHoneypot:    'fldVTzbUzzLjVldEk',
  antiSpamRateLimit:   'fldgwmG6xCrGuniEa',
  antiSpamTurnstile:   'fldl0efl9oLr2hngY',
  allowedOrigins:      'fldTOt0kOMUooJCuC',
  submissionCount:     'fldvjS3fx96TGmkax',
  formId:              'fldZTiyzyhXjCIapn', // formula — read only
  widgetId:            'fld4LTXFnaJahj0uX',
  ownerEmail:          'fldLzWF0XnEXeZYH1',
};

// Fields that should NOT be copied as-is. Each handled specially below.
//   widgetId         — new value minted
//   formId           — formula, regenerates itself
//   submissionCount  — reset to 0 (submissions belong to the source)
//   status           — forced to Draft on copy regardless of source
//   sequential       — Airtable autonumber, regenerates
//   formName         — modified to add " (Copy)"
const FIELDS_TO_RESET = new Set([
  EF.widgetId, EF.formId, EF.submissionCount, EF.status, EF.sequential, EF.formName,
]);

async function hydrateUserEmail(user) {
  if (!user || user.email || !user.recordId) return;
  try {
    const u = await getRecord(USERS.tableId, user.recordId);
    const email = u?.fields?.[USERS.fields.email];
    if (typeof email === 'string' && email.trim()) {
      user.email = email.trim();
    } else {
      console.warn('[enquiry-form-copy] hydrate: no email on user record', user.recordId);
    }
  } catch (err) {
    console.warn('[enquiry-form-copy] hydrate failed:', err.message);
  }
}

async function fetchEnquiryFormByWidgetId(widgetId, headers, baseId) {
  const safe = widgetId.replace(/'/g, "\\'");
  const formula = encodeURIComponent(`{${EF.widgetId}}='${safe}'`);
  const url = `${AIRTABLE_API}/${baseId}/${ENQUIRY_FORMS_TABLE}?filterByFormula=${formula}&maxRecords=1&returnFieldsByFieldId=true`;
  const resp = await fetch(url, { headers });
  if (!resp.ok) throw new Error(`EF lookup failed — ${resp.status}`);
  const data = await resp.json();
  return (data.records || [])[0] || null;
}

async function fetchPointerByWidgetId(widgetId, headers, baseId) {
  const safe = widgetId.replace(/'/g, "\\'");
  const formula = encodeURIComponent(`{WidgetID}='${safe}'`);
  const url = `${AIRTABLE_API}/${baseId}/${WIDGETS_TABLE}?filterByFormula=${formula}&maxRecords=1`;
  const resp = await fetch(url, { headers });
  if (!resp.ok) throw new Error(`pointer lookup failed — ${resp.status}`);
  const data = await resp.json();
  return (data.records || [])[0] || null;
}

export default async function handler(req, res) {
  if (setCors(req, res)) return;

  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const auth = requireAuth(req);
    if (auth.error) return res.status(auth.status).json({ error: auth.error });
    const user = auth.user;
    await hydrateUserEmail(user);

    if (!user.email) {
      console.warn('[enquiry-form-copy] no email on user after hydration; cannot proceed');
      return res.status(401).json({ error: 'User email missing' });
    }

    if (!applyRateLimit(res, `enquiry-copy:${user.email}`, RATE_LIMITS.widgetWrite)) return;

    const body = req.body || {};
    const widgetId = typeof body.widgetId === 'string' ? body.widgetId.trim() : '';
    if (!widgetId || widgetId.length > 100) {
      console.warn('[enquiry-form-copy] 400: invalid widgetId');
      return res.status(400).json({ error: 'widgetId is required' });
    }
    const customName = (typeof body.name === 'string' && body.name.trim()) ? body.name.trim().slice(0, 200) : null;

    const apiKey = process.env.AIRTABLE_API_KEY;
    const baseId = process.env.AIRTABLE_BASE_ID;
    if (!apiKey || !baseId) {
      console.error('[enquiry-form-copy] missing AIRTABLE env vars');
      return res.status(500).json({ error: 'Service temporarily unavailable' });
    }
    const headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };

    // 1. Look up the source EF record
    const sourceEf = await fetchEnquiryFormByWidgetId(widgetId, headers, baseId);
    if (!sourceEf) {
      console.warn('[enquiry-form-copy] source not found', { widgetId });
      return res.status(404).json({ error: 'Form not found' });
    }

    // Ownership check
    const ownerEmail = (sourceEf.fields[EF.ownerEmail] || '').toLowerCase().trim();
    const userEmail = (user.email || '').toLowerCase().trim();
    if (!ownerEmail || ownerEmail !== userEmail) {
      console.warn('[enquiry-form-copy] 403: ownership mismatch', {
        ownerEmail: ownerEmail || '(empty)',
        userEmail: userEmail || '(empty)',
        widgetId
      });
      return res.status(403).json({ error: 'You do not have permission to copy this form' });
    }

    // 2. Mint new widgetId
    const newWidgetId = `tgw_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // 3. Build new EF fields by copying every field from source except the
    //    reset list. Per-field copy (not Object.assign) so a future schema
    //    addition that's NOT in EF won't accidentally get carried over.
    const newEfFields = {};
    for (const [key, fieldId] of Object.entries(EF)) {
      if (FIELDS_TO_RESET.has(fieldId)) continue;
      const val = sourceEf.fields[fieldId];
      if (val !== undefined && val !== null) {
        newEfFields[fieldId] = val;
      }
    }

    // Forced overrides
    newEfFields[EF.widgetId] = newWidgetId;
    newEfFields[EF.status] = 'Draft';
    newEfFields[EF.submissionCount] = 0;
    newEfFields[EF.ownerEmail] = user.email;

    const originalFormName = (sourceEf.fields[EF.formName] || '').trim();
    const derivedName = customName || `${originalFormName} (Copy)`.slice(0, 200);
    newEfFields[EF.formName] = derivedName;

    // 4. Create the new EF record FIRST so we can read the generated FormID
    const efCreateUrl = `${AIRTABLE_API}/${baseId}/${ENQUIRY_FORMS_TABLE}?returnFieldsByFieldId=true`;
    const efCreateResp = await fetch(efCreateUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ records: [{ fields: newEfFields }] }),
    });
    if (!efCreateResp.ok) {
      const errText = await efCreateResp.text();
      console.error('[enquiry-form-copy] EF create failed:', efCreateResp.status, errText.slice(0, 400));
      return res.status(500).json({ error: 'Form copy failed (EF table)' });
    }
    const efCreated = await efCreateResp.json();
    const newEfRec = efCreated.records[0];
    const newFormId = newEfRec.fields[EF.formId] || '';

    // 5. Create the pointer record in Widgets. Mirror the shape used by the
    //    create path in enquiry-form-config.js — formId, status, submissionCount.
    //    Reads back what the dashboard will see.
    const pointerConfig = JSON.stringify({
      formId: newFormId,
      status: 'Draft',
      submissionCount: 0,
    });

    // For the pointer Name, use the same derivedName (without bothering
    // to fetch the source pointer record — its name should match the EF's
    // formName anyway).
    const pointerCreateUrl = `${AIRTABLE_API}/${baseId}/${WIDGETS_TABLE}`;
    const pointerCreateResp = await fetch(pointerCreateUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        records: [{
          fields: {
            WidgetID: newWidgetId,
            Name: derivedName,
            Config: pointerConfig,
            Status: 'Active', // Widgets table Status — generic widgets have one option.
            WidgetType: 'Enquiry Form',
            ClientName: user.clientName || '',
            ClientEmail: user.email,
            CreatedAt: new Date().toISOString(),
            UpdatedAt: new Date().toISOString(),
          },
        }],
      }),
    });

    // 6. Rollback EF if pointer create fails — same pattern as the create path
    if (!pointerCreateResp.ok) {
      const errText = await pointerCreateResp.text();
      console.error('[enquiry-form-copy] pointer create failed, rolling back EF:', pointerCreateResp.status, errText.slice(0, 300));
      try {
        await fetch(`${AIRTABLE_API}/${baseId}/${ENQUIRY_FORMS_TABLE}/${newEfRec.id}`, {
          method: 'DELETE',
          headers,
        });
      } catch (rbErr) {
        console.error('[enquiry-form-copy] rollback also failed — orphaned EF record:', newEfRec.id, rbErr.message);
      }
      return res.status(500).json({ error: 'Form copy failed (pointer record)' });
    }

    return res.status(201).json({
      success: true,
      widgetId: newWidgetId,
      recordId: newEfRec.id,
      formId: newFormId,
      name: derivedName,
    });
  } catch (err) {
    console.error('[enquiry-form-copy]', err.message);
    return res.status(500).json({ error: 'Service temporarily unavailable' });
  }
}
