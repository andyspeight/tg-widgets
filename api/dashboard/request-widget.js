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

    return jsonOk(res, { ok: true, requested: true });
  } catch (err) {
    console.error('[dashboard/request-widget] failed:', err?.message);
    return jsonError(res, 500, 'internal_error', 'Could not log your request');
  }
}
