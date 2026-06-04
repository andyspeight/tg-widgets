/**
 * POST /api/dashboard/request-widget
 *
 * Raised from the widget dashboard when a signed-in client clicks "Upgrade"
 * on a widget they are not yet entitled to. Logs the interest to the
 * "Upgrade Requests" table in the Control base so it becomes a real upsell
 * pipeline rather than a dead button.
 *
 * The client's identity (which company, which user, what plan) is taken from
 * the verified session — NEVER from the request body. The body only carries
 * non-sensitive display data about the widget being requested, and the widget
 * code is validated against the live catalogue before anything is written.
 *
 * Body:   { widgetCode, widgetName?, neededTier? }
 * Returns:
 *   { ok: true, requested: true }            — new request logged
 *   { ok: true, already: true }              — an open request already exists
 *
 * Auth: any signed-in client user (must belong to a client).
 */

import { requireAuth } from '../_lib/auth/middleware.js';
import { listAllRecords, getRecord, createRecord } from '../_lib/auth/airtable.js';
import { jsonOk, jsonError } from '../_lib/auth/http.js';
import { applyRateLimit, RATE_LIMITS } from '../_auth.js';
import { CATALOGUE, CLIENTS } from '../_lib/auth/schema.js';
import { sendViaSendGrid, buildFromField } from '../_lib/sendgrid.js';

const NOTIFY_TO = 'info@travelgenix.io';
const CONTROL_URL = 'https://widgets.travelify.io/admin#clients';

// Branded HTML notification for the account-manager inbox. Plain text would get
// missed, so this is a proper card with the request at a glance and one CTA.
function renderRequestEmail({ widgetName, widgetCode, clientName, currentPlan, neededTier, userEmail, whenText }) {
  const row = (label, value) => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #E2E8F0;font:600 12px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#64748B;text-transform:uppercase;letter-spacing:.04em;width:130px;vertical-align:top">${label}</td>
      <td style="padding:10px 0;border-bottom:1px solid #E2E8F0;font:400 14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0F172A">${value}</td>
    </tr>`;
  const tierVal = neededTier
    ? `<span style="display:inline-block;background:#ECFDF5;color:#0E9488;font-weight:700;font-size:13px;padding:3px 10px;border-radius:999px">${neededTier}</span>`
    : '<span style="color:#94A3B8">Not specified</span>';
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#F1F5F9">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">A client wants to add ${widgetName} to their site.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9;padding:28px 16px">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#FFFFFF;border-radius:16px;overflow:hidden;box-shadow:0 8px 28px rgba(15,23,42,.08)">
        <tr><td style="background:#1B2B5B;padding:20px 32px">
          <span style="font:800 16px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#FFFFFF;letter-spacing:-.01em">Travelgenix Control</span>
        </td></tr>
        <tr><td style="padding:32px 32px 8px">
          <div style="font:700 11px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0E9488;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">New upgrade request</div>
          <h1 style="margin:0 0 6px;font:800 22px/1.25 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0F172A">${clientName || 'A client'} wants ${widgetName}</h1>
          <p style="margin:0 0 20px;font:400 14px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#64748B">They tapped Request access from their widget dashboard. Reach out to get them set up.</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${row('Widget', `${widgetName} <span style="color:#94A3B8;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px">${widgetCode}</span>`)}
            ${row('Current plan', currentPlan || '<span style="color:#94A3B8">Unknown</span>')}
            ${row('Included from', tierVal)}
            ${row('Requested by', userEmail || '<span style="color:#94A3B8">Unknown</span>')}
            ${row('When', whenText)}
          </table>
        </td></tr>
        <tr><td style="padding:24px 32px 32px">
          <a href="${CONTROL_URL}" style="display:inline-block;background:#0E9488;color:#FFFFFF;font:700 15px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;text-decoration:none;padding:14px 28px;border-radius:10px">Open Control</a>
          <p style="margin:16px 0 0;font:400 13px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#94A3B8">Reply to this email to respond to ${userEmail || 'the client'} directly.</p>
        </td></tr>
        <tr><td style="padding:18px 32px;background:#F8FAFC;border-top:1px solid #E2E8F0">
          <p style="margin:0;font:400 12px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#94A3B8">Travelgenix · Running a travel business can be complex, but your technology shouldn't be.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

// "Upgrade Requests" table (Control base appAYzWZxvK6qlwXK). Inlined rather
// than added to the shared schema so the blast radius of this feature is one
// file. Created 2026-06-04.
const REQ = {
  tableId: 'tbl3S1VHOzSwuteLo',
  fields: {
    summary:     'fldO5HVzTHsXIXBzN', // primary
    client:      'fldXXJlCLIrIGv5mf', // link → Clients
    userEmail:   'fldjvCjFiyEkqdR5h',
    widgetName:  'fldNYJhke1BKldfrE',
    widgetCode:  'fldj6rU63g2DF4fyf',
    currentPlan: 'fldnPTl34YBnqrxi1',
    neededTier:  'fldyPujXwaWGarHJD',
    status:      'fldzw649fEe0pYNme', // singleSelect: New | Contacted | Converted | Declined
    created:     'fldgtQ7dhkRtx68Hm',
    notes:       'fldmJzWSxsyuKI8ei',
  },
  statuses: { NEW: 'New' },
};

const CODE_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;
const TIERS = new Set(['Spark', 'Boost', 'Ignite', 'Bespoke']);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return jsonError(res, 405, 'method_not_allowed', 'POST only');
  }

  const ctx = await requireAuth(req, res);
  if (!ctx) return;

  if (!applyRateLimit(res, `upgradereq:${ctx.userRecordId}`, RATE_LIMITS.widgetWrite)) return;

  if (!ctx.clientRecordId) {
    return jsonError(res, 400, 'no_client', 'Your account is not linked to a client');
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  } catch {
    return jsonError(res, 400, 'invalid_json', 'Body must be JSON');
  }

  const widgetCode = String(body.widgetCode || '').trim().toLowerCase();
  if (!CODE_RE.test(widgetCode)) {
    return jsonError(res, 400, 'invalid_widget', 'A valid widgetCode is required');
  }
  const neededTier = TIERS.has(String(body.neededTier || '').trim())
    ? String(body.neededTier).trim()
    : '';
  const sentName = String(body.widgetName || '').trim().slice(0, 80);

  try {
    // Validate the widget code against the live catalogue and grab the
    // authoritative product name so the logged record is trustworthy.
    const catalogue = await listAllRecords(CATALOGUE.tableId);
    const catItem = catalogue.find(
      (c) => String(c.fields[CATALOGUE.fields.productCode] || '').toLowerCase() === widgetCode
    );
    if (!catItem) {
      return jsonError(res, 400, 'unknown_widget', 'That widget is not in the catalogue');
    }
    const widgetName = catItem.fields[CATALOGUE.fields.productName] || sentName || widgetCode;

    // Client context from the session, never the body.
    let clientName = '';
    let currentPlan = '';
    try {
      const clientRec = await getRecord(CLIENTS.tableId, ctx.clientRecordId);
      clientName = clientRec.fields[CLIENTS.fields.clientName] || '';
      const planVal = clientRec.fields[CLIENTS.fields.plan];
      currentPlan = typeof planVal === 'object' && planVal ? (planVal.name || '') : (planVal || '');
    } catch {
      // Non-fatal — we can still log the request without the plan.
    }

    // Dedupe: if this client already has an open (New) request for this widget,
    // don't create a second one. Keeps the pipeline clean and lets the UI show
    // a quiet "Requested" state on repeat clicks.
    const existing = await listAllRecords(REQ.tableId);
    const already = existing.some((r) => {
      const linked = r.fields[REQ.fields.client] || [];
      const code = String(r.fields[REQ.fields.widgetCode] || '').toLowerCase();
      const status = r.fields[REQ.fields.status];
      return linked.includes(ctx.clientRecordId) && code === widgetCode && status === REQ.statuses.NEW;
    });
    if (already) {
      return jsonOk(res, { ok: true, already: true });
    }

    const nowIso = new Date().toISOString();
    await createRecord(REQ.tableId, {
      [REQ.fields.summary]:     `${widgetName} — ${clientName || 'Unknown client'}`,
      [REQ.fields.client]:      [ctx.clientRecordId],
      [REQ.fields.userEmail]:   ctx.email || '',
      [REQ.fields.widgetName]:  widgetName,
      [REQ.fields.widgetCode]:  widgetCode,
      [REQ.fields.currentPlan]: currentPlan,
      [REQ.fields.neededTier]:  neededTier,
      [REQ.fields.status]:      REQ.statuses.NEW,
      [REQ.fields.created]:     nowIso,
    });

    // Best-effort notify the account-manager inbox. Never blocks the request —
    // the Airtable row is the source of truth, the email is the nudge.
    try {
      const whenText = new Date().toLocaleString('en-GB', {
        timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'short',
      });
      await sendViaSendGrid({
        from: buildFromField('Travelgenix Control'),
        to: NOTIFY_TO,
        replyTo: ctx.email || undefined,
        subject: `Upgrade request: ${widgetName} — ${clientName || 'a client'}`,
        html: renderRequestEmail({
          widgetName, widgetCode, clientName, currentPlan, neededTier,
          userEmail: ctx.email || '', whenText,
        }),
        categoryTag: 'upgrade-request',
      });
    } catch (mailErr) {
      console.warn('[dashboard/request-widget] notify email failed:', mailErr?.message);
    }

    return jsonOk(res, { ok: true, requested: true });
  } catch (err) {
    console.error('[dashboard/request-widget] failed:', err?.message);
    return jsonError(res, 500, 'internal_error', 'Could not log your request');
  }
}
