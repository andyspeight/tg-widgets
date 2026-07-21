/**
 * One-click Google Sheets provisioning for Widgets-table form types.
 *
 *   POST /api/sheets-provision
 *     Body: { widgetRecordId: 'rec...' }   — the Widgets table record id
 *     Creates a ready-made spreadsheet via the platform service account,
 *     shares it with the CLIENT's email (the widget's owning account, never
 *     the caller) and returns the wiring for the routing config:
 *     { created: true, sheetId, url, tab, sharedWith }
 *
 * Serves the lead-router form types (Newsletter today; any Widgets-table
 * form type tomorrow). No tab rename and no header row here on purpose: the
 * lead router's Google Sheets destination writes its own header with the
 * right per-widget column layout on first append, into the default "Sheet1"
 * tab. The Enquiry pipeline has its own endpoint with a fixed layout
 * (api/enquiry/sheets-provision.js); both share api/_lib/sheets-provisioning.js.
 *
 * Security mirrors api/routing-configs.js: session required, the widget's
 * ClientEmail must match the caller (or the caller is Travelgenix staff).
 * The share target prefers the owning Clients record's email (the account
 * the widget is on) over ClientEmail, which can be a staff address for
 * staff-created widgets. Rate limited per caller.
 */
import {
  requireAuth,
  setCors,
  applyRateLimit,
} from './_auth.js';
import { getRecord } from './_lib/auth/airtable.js';
import { USERS, CLIENTS } from './_lib/auth/schema.js';
import { isStaffEmail } from './_lib/auth/staff.js';
import { credentialsConfigured, SERVICE_ACCOUNT_EMAIL } from './enquiry/_lib/routing/google-sheets.js';
import { provisionSpreadsheet, provisionErrorResponse } from './_lib/sheets-provisioning.js';

const BASE_ID = process.env.AIRTABLE_BASE_ID;
const PAT = process.env.AIRTABLE_KEY;
const WIDGETS_TABLE_ID = 'tblVAThVqAjqtria2';

const PROVISION_RATE_LIMIT = { max: 10, windowMs: 15 * 60 * 1000 };
const REC_ID_RE = /^rec[A-Za-z0-9]{14}$/;

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
  if (!user.email && user.recordId) {
    try {
      const u = await getRecord(USERS.tableId, user.recordId);
      const email = u?.fields?.[USERS.fields.email];
      if (typeof email === 'string' && email.trim()) user.email = email.trim();
    } catch (err) {
      console.warn('[sheets-provision:widgets] email hydrate failed:', err.message);
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
  const widgetRecordId = body && body.widgetRecordId;
  if (typeof widgetRecordId !== 'string' || !REC_ID_RE.test(widgetRecordId)) {
    return res.status(400).json({ error: 'Invalid widgetRecordId' });
  }

  try {
    // ── Resolve the widget + access check (mirrors routing-configs.js) ─────
    const widgetRes = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${WIDGETS_TABLE_ID}/${widgetRecordId}`,
      { headers: { Authorization: `Bearer ${PAT}` }, signal: AbortSignal.timeout(5000) }
    );
    if (widgetRes.status === 404) return res.status(404).json({ error: 'Widget not found' });
    if (!widgetRes.ok) {
      const err = new Error(`widget lookup HTTP ${widgetRes.status}`);
      err.stage = 'lookup';
      throw err;
    }
    const widget = await widgetRes.json();
    const wf = widget.fields || {};
    const clientEmail = String(wf.ClientEmail || '').toLowerCase().trim();
    if (!isStaffEmail(agentEmail) && (!clientEmail || clientEmail !== agentEmail)) {
      return res.status(403).json({ error: 'Widget not found or not yours' });
    }

    // Share target: the owning ACCOUNT's email when the pointer carries a
    // ClientRecordId (ClientEmail can be a staff address on staff-created
    // widgets), falling back to ClientEmail.
    let shareWith = clientEmail;
    const clientRecordId = String(wf.ClientRecordId || '').trim();
    if (REC_ID_RE.test(clientRecordId)) {
      try {
        const cli = await getRecord(CLIENTS.tableId, clientRecordId);
        const accountEmail = cli?.fields?.[CLIENTS.fields.email];
        if (typeof accountEmail === 'string' && accountEmail.trim()) {
          shareWith = accountEmail.toLowerCase().trim();
        }
      } catch (err) {
        console.warn('[sheets-provision:widgets] client record read failed:', err.message);
      }
    }
    if (!shareWith) {
      return res.status(400).json({ error: 'This widget has no client email to share the spreadsheet with' });
    }

    const { sheetId, url, tab } = await provisionSpreadsheet({
      title: `${wf.ClientName || wf.Name || 'Widget'} leads`,
      shareWith,
      // No tabName / headers: the lead router's Sheets destination writes its
      // own per-widget header into "Sheet1" on first append.
    });

    console.log('[sheets-provision:widgets] created', sheetId, 'for', widgetRecordId, 'shared with', shareWith);
    return res.status(200).json({
      created: true,
      sheetId,
      url,
      tab,
      sharedWith: shareWith,
      serviceAccount: SERVICE_ACCOUNT_EMAIL,
    });
  } catch (err) {
    console.error('[sheets-provision:widgets] failed:', err.message || err);
    const mapped = provisionErrorResponse(err);
    return res.status(mapped.status).json(mapped.body);
  }
}
