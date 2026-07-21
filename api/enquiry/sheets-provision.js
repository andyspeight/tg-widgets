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
 * Security:
 *  - Requires a valid session. The caller must OWN the form, or be
 *    Travelgenix staff acting for a client — either way the sheet is shared
 *    with the form's Owner Email, never the caller's.
 *  - The service account owns the file; its only other access is sheets
 *    explicitly shared with it. No project-level Google permissions.
 *  - Rate limited per caller.
 *
 * Requires (beyond the routing module's env): the Google Drive API enabled
 * on the service account's Google Cloud project — sharing is a Drive call.
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
import { getAccessToken, credentialsConfigured, SERVICE_ACCOUNT_EMAIL } from './_lib/routing/google-sheets.js';

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

// Provisioning both creates the file (Sheets API) and shares it (Drive API).
const PROVISION_SCOPE = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive';

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

    let token;
    try {
      token = await getAccessToken(PROVISION_SCOPE);
    } catch (err) {
      err.stage = 'auth';
      throw err;
    }
    const gHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    // ── 1. Create the spreadsheet ──────────────────────────────────────────
    // Google no longer lets service accounts OWN files (My Drive storage for
    // service accounts is closed off — a direct create returns
    // PERMISSION_DENIED). Files are therefore created inside the platform's
    // Shared Drive, where the DRIVE owns them: TG_SHEETS_SHARED_DRIVE_ID is
    // the Shared Drive (or a folder inside it) the service account belongs
    // to as Content manager. Without it we attempt the direct create and
    // translate the refusal into the setup instruction.
    const sharedDriveId = String(process.env.TG_SHEETS_SHARED_DRIVE_ID || '').trim();
    const title = `${form.fields[F.clientName] || form.fields[F.formName] || 'Enquiry form'} enquiries`.slice(0, 120);
    let sheetId;
    if (sharedDriveId) {
      const createRes = await fetch('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true', {
        method: 'POST',
        headers: gHeaders,
        body: JSON.stringify({
          name: title,
          mimeType: 'application/vnd.google-apps.spreadsheet',
          parents: [sharedDriveId],
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!createRes.ok) throw await googleError(createRes, 'create');
      sheetId = (await createRes.json()).id;

      // A Drive-created spreadsheet arrives with a default "Sheet1" tab —
      // rename it to the routing tab and freeze the header row. Brand-new
      // files can stall their first call, hence googleStep's retry.
      const firstTabId = await googleStep('read-tabs', async () => {
        const metaRes = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties.sheetId`,
          { headers: gHeaders, signal: AbortSignal.timeout(15000) }
        );
        if (!metaRes.ok) throw await googleError(metaRes, 'read-tabs');
        const meta = await metaRes.json();
        return meta.sheets && meta.sheets[0] && meta.sheets[0].properties
          ? meta.sheets[0].properties.sheetId : 0;
      });
      await googleStep('rename-tab', async () => {
        const renameRes = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`,
          {
            method: 'POST',
            headers: gHeaders,
            body: JSON.stringify({
              requests: [{
                updateSheetProperties: {
                  properties: { sheetId: firstTabId, title: TAB_NAME, gridProperties: { frozenRowCount: 1 } },
                  fields: 'title,gridProperties.frozenRowCount',
                },
              }],
            }),
            signal: AbortSignal.timeout(15000),
          }
        );
        if (!renameRes.ok) throw await googleError(renameRes, 'rename-tab');
      });
    } else {
      const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
        method: 'POST',
        headers: gHeaders,
        body: JSON.stringify({
          properties: { title },
          sheets: [{ properties: { title: TAB_NAME, gridProperties: { frozenRowCount: 1 } } }],
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!createRes.ok) throw await googleError(createRes, 'create');
      sheetId = (await createRes.json()).spreadsheetId;
    }
    const url = `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;

    // ── 2. Header row ──────────────────────────────────────────────────────
    const range = encodeURIComponent(`'${TAB_NAME}'!A1`);
    await googleStep('headers', async () => {
      const headerRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?valueInputOption=RAW`,
        { method: 'PUT', headers: gHeaders, body: JSON.stringify({ values: [HEADERS] }), signal: AbortSignal.timeout(15000) }
      );
      if (!headerRes.ok) throw await googleError(headerRes, 'headers');
    });

    // ── 3. Share with the form owner (Drive API, sends the standard email) ─
    await googleStep('share', async () => {
      const shareRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${sheetId}/permissions?sendNotificationEmail=true&supportsAllDrives=true`,
        {
          method: 'POST',
          headers: gHeaders,
          body: JSON.stringify({ type: 'user', role: 'writer', emailAddress: ownerEmail }),
          signal: AbortSignal.timeout(15000),
        }
      );
      if (!shareRes.ok) throw await googleError(shareRes, 'share');
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
    const detail = String(err.message || err).slice(0, 200);
    if (err.driveDisabled) {
      return res.status(503).json({
        error: 'The Google Drive API is not enabled on the platform project yet — enable it in Google Cloud Console (project travelgenix-widgets) and try again.',
      });
    }
    // Google policy: service accounts can be refused storage for files they
    // would own themselves. The fix is provisioning into a Shared Drive —
    // name it clearly so it is recognised instantly rather than guessed at.
    if (!sharedDriveIdConfigured() && err.stage === 'create' && /PERMISSION_DENIED|caller does not have permission/i.test(detail)) {
      return res.status(503).json({
        error: 'Google no longer lets service accounts own new files. One-off fix: create a Shared Drive, add the service account as Content manager, then set TG_SHEETS_SHARED_DRIVE_ID in Vercel and redeploy.',
        stage: 'create', detail,
      });
    }
    if (/storage.?quota|storageQuotaExceeded/i.test(detail)) {
      return res.status(503).json({
        error: 'Google refused to store a new file for the service account (storage quota policy). Provisioning needs to move to a Shared Drive.',
        stage: err.stage || 'create', detail,
      });
    }
    return res.status(502).json({
      error: `Could not create the spreadsheet (failed at: ${err.stage || 'unknown'}).`,
      stage: err.stage || 'unknown',
      detail,
    });
  }
}

// Run an idempotent Google step with a stage label and ONE retry — a
// just-created spreadsheet can stall its first follow-up call, and every
// step here (metadata read, tab rename, header write, permission grant) is
// safe to repeat. Aborts and network rejects carry no stage of their own,
// so the label is stamped on whatever escapes.
async function googleStep(stage, fn) {
  try {
    return await fn();
  } catch (first) {
    console.warn(`[sheets-provision] ${stage} retrying after:`, first.message || first);
    try {
      return await fn();
    } catch (err) {
      if (!err.stage) err.stage = stage;
      throw err;
    }
  }
}

function sharedDriveIdConfigured() {
  return !!String(process.env.TG_SHEETS_SHARED_DRIVE_ID || '').trim();
}

// Read a Google error response and produce a typed Error. The one case the
// editor must distinguish is "Drive API not enabled on the project" — a
// one-off platform setup step, not something to retry.
async function googleError(response, stage) {
  let detail = '';
  try { detail = (await response.text()).slice(0, 400); } catch (e) { /* ignore */ }
  const err = new Error(`google ${stage} HTTP ${response.status}: ${detail}`);
  err.stage = stage;
  if (response.status === 403 && /accessNotConfigured|has not been used in project|is disabled/i.test(detail)) {
    err.driveDisabled = true;
  }
  return err;
}
