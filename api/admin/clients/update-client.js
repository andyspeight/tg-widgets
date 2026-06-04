/**
 * POST /api/admin/clients/update-client
 *
 * Updates the company, primary-contact and commercial fields on an existing
 * Client record from the Control client-detail page. Companion to
 * update-branding.js / update-integration.js / update-entitlement.js — same
 * auth, same helpers, same response style.
 *
 * Editable fields (any omitted field is left unchanged; '' clears a text field):
 *   - clientName            (legal name)
 *   - tradingName
 *   - websiteUrl            (https:// auto-prepended if a scheme is missing)
 *   - status               (single-select: Active | Pending | Disabled)
 *   - primaryEmail         (the Client's primary email / primary contact email)
 *   - primaryContactName
 *   - primaryContactPhone
 *   - mrr                  (number, monthly recurring revenue)
 *   - setupFeeCharged      (number)
 *   - setupDate            (YYYY-MM-DD)
 *   - goLiveDate           (YYYY-MM-DD)
 *   - notes                (free text)
 *   - packageId            (a Packages record id — STORE ONLY)
 *
 * IMPORTANT: packageId is stored on the Client (it updates the linked Package
 * and the matching plan single-select for display) but it does NOT re-provision
 * entitlements. Entitlements are managed only from the Entitlements tab via
 * update-entitlement.js. Changing the package here is a metadata change.
 *
 * Auth: widget_suite owner or admin (Travelgenix staff).
 *
 * Body: { id: 'recXXX', clientName?, tradingName?, ... , packageId? }
 */

import { requireAuth, requireProductAccess } from '../../_lib/auth/middleware.js';
import { getRecord, updateRecord } from '../../_lib/auth/airtable.js';
import { jsonError } from '../../_lib/auth/http.js';
import {
  PRODUCTS,
  PERMISSIONS,
  CLIENTS,
  PACKAGES,
} from '../../_lib/auth/schema.js';

const REC_ID_RE = /^rec[A-Za-z0-9]{14}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}/;

const NAME_MAX = 120;
const PHONE_MAX = 40;
const URL_MAX = 300;
const NOTES_MAX = 5000;
const STATUS_OPTIONS = ['Active', 'Pending', 'Disabled'];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return jsonError(res, 405, 'method_not_allowed', 'POST only');
  }

  const ctx = await requireAuth(req, res);
  if (!ctx) return;

  const role = requireProductAccess(
    ctx,
    PRODUCTS.slugs.WIDGET_SUITE,
    [PERMISSIONS.roles.OWNER, PERMISSIONS.roles.ADMIN],
    res
  );
  if (!role) return;

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  } catch {
    return jsonError(res, 400, 'invalid_json', 'Body must be JSON');
  }

  const id = String(body.id || '').trim();
  if (!REC_ID_RE.test(id)) {
    return jsonError(res, 400, 'invalid_id', 'id must be a valid record id');
  }

  const errors = [];
  const updates = {};

  // ── Text fields ──────────────────────────────────────────────────────
  if (body.clientName !== undefined) {
    const v = String(body.clientName).trim();
    if (v.length > NAME_MAX) errors.push(`Legal name must be ${NAME_MAX} characters or fewer`);
    updates[CLIENTS.fields.clientName] = v;
  }
  if (body.tradingName !== undefined) {
    const v = String(body.tradingName).trim();
    if (v.length > NAME_MAX) errors.push(`Trading name must be ${NAME_MAX} characters or fewer`);
    updates[CLIENTS.fields.tradingName] = v;
  }
  if (body.primaryContactName !== undefined) {
    const v = String(body.primaryContactName).trim();
    if (v.length > NAME_MAX) errors.push(`Contact name must be ${NAME_MAX} characters or fewer`);
    updates[CLIENTS.fields.primaryContactName] = v;
  }
  if (body.primaryContactPhone !== undefined) {
    const v = String(body.primaryContactPhone).trim();
    if (v.length > PHONE_MAX) errors.push(`Phone must be ${PHONE_MAX} characters or fewer`);
    updates[CLIENTS.fields.primaryContactPhone] = v;
  }
  if (body.notes !== undefined) {
    const v = String(body.notes);
    if (v.length > NOTES_MAX) errors.push(`Notes must be ${NOTES_MAX} characters or fewer`);
    updates[CLIENTS.fields.notes] = v;
  }

  // ── Website (normalise scheme) ───────────────────────────────────────
  if (body.websiteUrl !== undefined) {
    let v = String(body.websiteUrl).trim();
    if (v) {
      if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
      if (v.length > URL_MAX) errors.push(`Website must be ${URL_MAX} characters or fewer`);
      if (!/^https?:\/\/[^\s.]+\.[^\s]+$/i.test(v)) errors.push('Website must look like a valid URL');
    }
    updates[CLIENTS.fields.websiteUrl] = v;
  }

  // ── Primary email ────────────────────────────────────────────────────
  if (body.primaryEmail !== undefined) {
    const v = String(body.primaryEmail).trim().toLowerCase();
    if (v && !EMAIL_RE.test(v)) errors.push('Primary email is not a valid email address');
    updates[CLIENTS.fields.email] = v;
  }

  // ── Status (single-select) ───────────────────────────────────────────
  if (body.status !== undefined) {
    const v = String(body.status).trim();
    if (!STATUS_OPTIONS.includes(v)) {
      errors.push(`Status must be one of: ${STATUS_OPTIONS.join(', ')}`);
    } else {
      updates[CLIENTS.fields.status] = v;
    }
  }

  // ── Money (numbers) ──────────────────────────────────────────────────
  for (const [key, field, label] of [
    ['mrr', CLIENTS.fields.mrr, 'MRR'],
    ['setupFeeCharged', CLIENTS.fields.setupFeeCharged, 'Setup fee'],
  ]) {
    if (body[key] !== undefined) {
      const raw = body[key];
      if (raw === '' || raw === null) {
        updates[field] = null;
      } else {
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0) errors.push(`${label} must be a number of 0 or more`);
        else updates[field] = n;
      }
    }
  }

  // ── Dates (YYYY-MM-DD) ───────────────────────────────────────────────
  for (const [key, field, label] of [
    ['setupDate', CLIENTS.fields.setupDate, 'Setup date'],
    ['goLiveDate', CLIENTS.fields.goLiveDate, 'Go-live date'],
  ]) {
    if (body[key] !== undefined) {
      const v = String(body[key] || '').trim();
      if (!v) {
        updates[field] = null;
      } else if (!DATE_RE.test(v)) {
        errors.push(`${label} must be a date (YYYY-MM-DD)`);
      } else {
        updates[field] = v.slice(0, 10);
      }
    }
  }

  // ── Package (STORE ONLY — never re-provisions entitlements) ──────────
  // Resolve the package up front so we can fail cleanly and set the matching
  // plan single-select for display. A blank packageId is treated as "no
  // change" rather than clearing, to avoid accidental wipes.
  let packageName = null;
  if (body.packageId !== undefined && String(body.packageId).trim()) {
    const pkgId = String(body.packageId).trim();
    if (!REC_ID_RE.test(pkgId)) {
      errors.push('packageId must be a valid record id');
    } else {
      try {
        const pkg = await getRecord(PACKAGES.tableId, pkgId).catch((err) => {
          if (err?.status === 404) return null;
          throw err;
        });
        if (!pkg) {
          errors.push('No package with that id');
        } else {
          packageName = pkg.fields[PACKAGES.fields.packageName] || '';
          updates[CLIENTS.fields.package] = [pkgId];
          // Keep the display plan single-select in step with the linked package.
          if (packageName) updates[CLIENTS.fields.plan] = packageName;
        }
      } catch (err) {
        console.error('[admin/clients/update-client] failed to load package:', err);
        return jsonError(res, 500, 'internal_error', 'Could not load package');
      }
    }
  }

  if (Object.keys(updates).length === 0) {
    return jsonError(res, 400, 'nothing_to_update', 'No fields supplied');
  }
  if (errors.length) {
    return jsonError(res, 400, 'validation_failed', errors.join(' · '));
  }

  // Confirm the client exists.
  let target;
  try {
    target = await getRecord(CLIENTS.tableId, id).catch((err) => {
      if (err?.status === 404) return null;
      throw err;
    });
  } catch (err) {
    console.error('[admin/clients/update-client] failed to load client:', err);
    return jsonError(res, 500, 'internal_error', 'Could not load client');
  }
  if (!target) {
    return jsonError(res, 404, 'client_not_found', 'No client with that id');
  }

  try {
    const u = await updateRecord(CLIENTS.tableId, id, updates);
    const f = u.fields;
    const out = {
      ok: true,
      client: {
        id: u.id,
        clientName: f[CLIENTS.fields.clientName] || '',
        tradingName: f[CLIENTS.fields.tradingName] || '',
        websiteUrl: f[CLIENTS.fields.websiteUrl] || '',
        status: f[CLIENTS.fields.status] || '',
        plan: f[CLIENTS.fields.plan] || '',
        primaryEmail: f[CLIENTS.fields.email] || '',
        primaryContactName: f[CLIENTS.fields.primaryContactName] || '',
        primaryContactPhone: f[CLIENTS.fields.primaryContactPhone] || '',
        mrr: f[CLIENTS.fields.mrr] ?? null,
        setupFeeCharged: f[CLIENTS.fields.setupFeeCharged] ?? null,
        setupDate: f[CLIENTS.fields.setupDate] || null,
        goLiveDate: f[CLIENTS.fields.goLiveDate] || null,
        notes: f[CLIENTS.fields.notes] || '',
      },
    };
    // If the package changed, hand back the resolved {id,name} so the page can
    // refresh the header pill and the Package field without a reload.
    if (packageName !== null) {
      out.package = { id: String(body.packageId).trim(), name: packageName };
    }
    return res.status(200).json(out);
  } catch (err) {
    console.error('[admin/clients/update-client] update failed:', err);
    return jsonError(res, 500, 'internal_error', 'Failed to save client');
  }
}
