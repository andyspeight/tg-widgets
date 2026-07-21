/**
 * One-click Google Sheets provisioning for enquiry form routing.
 *
 *   POST /api/enquiry/sheets-provision
 *     Body: { widgetId: 'tgw_...' }
 *     Creates a ready-made spreadsheet via the platform service account,
 *     writes the header row, shares it with the FORM OWNER's email (Editor,
 *     with the standard Google notification email so they get the link), and
 *     returns the wiring for the editor to save onto the form:
 *     { created: true, sheetId, url, tab, sharedWith }
 *
 * WHY: the manual flow (client creates a sheet, shares it with our service
 * account, pastes the ID) proved too much to ask of every client — Andy's
 * call, 20 Jul 2026. Reversing the direction means the client does nothing:
 * the sheet arrives in their inbox already wired up.
 *
 * The creation/share mechanics live in api/_lib/sheets-provisioning.js,
 * shared with the generic Widgets-table endpoint (api/sheets-provision.js).
 *
 * Security:
 *  - Requires a valid session. The caller must OWN the form, or be
 *    Travelgenix staff acting for a client — either way the sheet is shared
 *    with the form's Owner Email, never the caller's.
 *  - Rate limited per caller.
 */
import {
  requireAuth,
  setCors,
  applyRateLimit,
  sanitiseForFormula,
} from '../_auth.js';
import { getRecord } from '../_lib/auth/airtable.js';
import { USERS } from '../_lib/auth/schema.js';
import { isStaffEmail } from '../_lib/auth/staff.js';
import { credentialsConfigured, SERVICE_ACCOUNT_EMAIL } from './_lib/routing/google-sheets.js';
import { provisionSpreadsheet, provisionErrorResponse } from '../_lib/sheets-provisioning.js';

const BASE_ID = process.env.AIRTABLE_BASE_ID;
const PAT = process.env.AIRTABLE_KEY;
const TABLE_FORMS = 'tblpw4TCmQfJHZIlF';

// Field IDs on the Enquiry Forms table
const F = {
  widgetId:   'fld4LTXFnaJahj0uX',
  ownerEmail: 'fldLzWF0XnEXeZYH1',
  formName:   'fldC0MLSyJqg6U1zT',
  clientName: 'fldrw1eTFYCFIo0pp',
};

const PROVISION_RATE_LIMIT = { max: 10, windowMs: 15 * 60 * 1000 };
const TAB_NAME = 'Enquiries';

// Column headers — MUST stay in the routing module's column order (A..Z).
const HEADERS = [
  'Reference', 'Submitted At (UTC)', 'Form Name', 'First Name', 'Last Name',
  'Email', 'Phone', 'Destinations', 'Departure Airport', 'Depart Date',
  'Return Date', 'Flexible Dates', 'Duration', 'Adults', 'Children',
  'Child Ages', 'Infants', 'Budget PP (GBP)', 'Stars', 'Board Basis',
  'Interests', 'Notes', 'Marketing Consent', 'Source URL', 'IP Address',
  'Submission ID',
];

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!PAT || !BASE_ID) {
    return res.status(500).json({ error: 'Server misconfigured: missing AIRTABLE_KEY or AIRTABLE_BASE_ID' });
  }
  if (!credentialsConfigured()) {
    return res.status(503).json({ error: 'Google Sheets is not configured on the platform yet (service account missing)' });
  }

  const authResult = requireAuth(req);
  if (authResult.error) {
    return res.status(authResult.status).json({ error: authResult.error });
  }
  const user = authResult.user;
  // Cookie-SSO sessions can lack the email — resolve it from the Users record
  // like the config endpoint does, instead of bouncing the caller.
  if (!user.email && user.recordId) {
    try {
      const u = await getRecord(USERS.tableId, user.recordId);
      const email = u?.fields?.[USERS.fields.email];
      if (typeof email === 'string' && email.trim()) user.email = email.trim();
    } catch (err) {
      console.warn('[sheets-provision] email hydrate failed:', err.message);
    }
  }
  const agentEmail = String(user.email || '').toLowerCase().trim();
  if (!agentEmail) return res.status(401).json({ error: 'Session missing email' });

  if (!applyRateLimit(res, `sheets-provision:${agentEmail}`, PROVISION_RATE_LIMIT)) return;

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); }
    catch (e) { return res.status(400).json({ error: 'Invalid JSON body' }); }
  }
  const widgetId = body && body.widgetId;
  if (typeof widgetId !== 'string' || !/^tgw_[A-Za-z0-9_-]+$/.test(widgetId)) {
    return res.status(400).json({ error: 'Invalid widgetId' });
  }

  try {
    // ── Resolve the form + access check ────────────────────────────────────
    const formula = `{Widget ID} = '${sanitiseForFormula(widgetId)}'`;
    const lookupUrl = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_FORMS}` +
      `?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1&returnFieldsByFieldId=true`;
    const lookupRes = await fetch(lookupUrl, {
      headers: { Authorization: `Bearer ${PAT}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!lookupRes.ok) {
      const err = new Error(`form lookup HTTP ${lookupRes.status}`);
      err.stage = 'lookup';
      throw err;
    }
    const lookupData = await lookupRes.json();
    const form = (lookupData.records || [])[0];
    if (!form) return res.status(404).json({ error: 'Form not found' });

    const ownerEmail = String(form.fields[F.ownerEmail] || '').toLowerCase().trim();
    if (!isStaffEmail(agentEmail) && (!ownerEmail || ownerEmail !== agentEmail)) {
      return res.status(403).json({ error: 'You do not have permission to manage this form' });
    }
    if (!ownerEmail) {
      return res.status(400).json({ error: 'This form has no owner email to share the spreadsheet with' });
    }

    const { sheetId, url } = await provisionSpreadsheet({
      title: `${form.fields[F.clientName] || form.fields[F.formName] || 'Enquiry form'} enquiries`,
      shareWith: ownerEmail,
      tabName: TAB_NAME,
      headers: HEADERS,
    });

    console.log('[sheets-provision] created', sheetId, 'for', widgetId, 'shared with', ownerEmail);
    return res.status(200).json({
      created: true,
      sheetId,
      url,
      tab: TAB_NAME,
      sharedWith: ownerEmail,
      serviceAccount: SERVICE_ACCOUNT_EMAIL,
    });
  } catch (err) {
    console.error('[sheets-provision] failed:', err.message || err);
    const mapped = provisionErrorResponse(err);
    return res.status(mapped.status).json(mapped.body);
  }
}
