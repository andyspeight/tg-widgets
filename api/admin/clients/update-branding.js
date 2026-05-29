/**
 * POST /api/admin/clients/update-branding
 *
 * Updates the white-label branding fields on an existing Client record:
 *   - appName            (text, the app name travellers see)
 *   - brandPrimaryColour (hex string, e.g. #1B2B5B)
 *   - brandAccentColour  (hex string, e.g. #00B4D8)
 *   - welcomeMessage     (text, greeting on first app open)
 *   - logoUrl            (https URL of the agency logo, public Vercel Blob)
 *
 * Phase 3 (continued). Companion to update-integration.js and
 * update-entitlement.js — same auth, same helpers, same response style.
 * Powers Luna Travel's per-agency white-labelling: Control stores the brand,
 * Luna Travel reads it via /api/admin/clients/get.
 *
 * Auth: widget_suite owner or admin.
 *
 * Body:
 *   { id: 'recXXX', appName: 'Coast & Crown', brandPrimaryColour: '#0F4C5C',
 *     brandAccentColour: '#E36414', welcomeMessage: 'Welcome aboard...' }
 *
 * Any field omitted is left unchanged. Pass an empty string to clear a field.
 */

import { requireAuth, requireProductAccess } from '../../_lib/auth/middleware.js';
import { getRecord, updateRecord } from '../../_lib/auth/airtable.js';
import { jsonError } from '../../_lib/auth/http.js';
import {
  PRODUCTS,
  PERMISSIONS,
  CLIENTS,
} from '../../_lib/auth/schema.js';

const REC_ID_RE = /^rec[A-Za-z0-9]{14}$/;
// #RGB or #RRGGBB
const HEX_RE = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;
const APP_NAME_MAX = 60;
const WELCOME_MAX = 500;
const LOGO_URL_MAX = 1000;

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

  // Only validate fields actually supplied. undefined => leave unchanged.
  // '' => clear the field.
  const errors = [];
  const updates = {};

  if (body.appName !== undefined) {
    const v = String(body.appName).trim();
    if (v.length > APP_NAME_MAX) errors.push(`appName must be ${APP_NAME_MAX} characters or fewer`);
    updates[CLIENTS.fields.appName] = v;
  }

  if (body.brandPrimaryColour !== undefined) {
    const v = String(body.brandPrimaryColour).trim();
    if (v && !HEX_RE.test(v)) errors.push('brandPrimaryColour must be a hex colour like #1B2B5B');
    updates[CLIENTS.fields.brandPrimaryColour] = v;
  }

  if (body.brandAccentColour !== undefined) {
    const v = String(body.brandAccentColour).trim();
    if (v && !HEX_RE.test(v)) errors.push('brandAccentColour must be a hex colour like #00B4D8');
    updates[CLIENTS.fields.brandAccentColour] = v;
  }

  if (body.welcomeMessage !== undefined) {
    const v = String(body.welcomeMessage).trim();
    if (v.length > WELCOME_MAX) errors.push(`welcomeMessage must be ${WELCOME_MAX} characters or fewer`);
    updates[CLIENTS.fields.welcomeMessage] = v;
  }

  if (body.logoUrl !== undefined) {
    const v = String(body.logoUrl).trim();
    if (v) {
      if (v.length > LOGO_URL_MAX) errors.push(`logoUrl must be ${LOGO_URL_MAX} characters or fewer`);
      if (!/^https:\/\//i.test(v)) errors.push('logoUrl must be an https URL');
    }
    updates[CLIENTS.fields.logoUrl] = v;
  }

  if (Object.keys(updates).length === 0) {
    return jsonError(res, 400, 'nothing_to_update', 'No fields supplied');
  }
  if (errors.length) {
    return jsonError(res, 400, 'validation_failed', errors.join(' · '));
  }

  // Confirm the record exists.
  let target;
  try {
    target = await getRecord(CLIENTS.tableId, id).catch((err) => {
      if (err?.status === 404) return null;
      throw err;
    });
  } catch (err) {
    console.error('[admin/clients/update-branding] failed to load client:', err);
    return jsonError(res, 500, 'internal_error', 'Could not load client');
  }
  if (!target) {
    return jsonError(res, 404, 'client_not_found', 'No client with that id');
  }

  try {
    const updated = await updateRecord(CLIENTS.tableId, id, updates);
    return res.status(200).json({
      ok: true,
      branding: {
        id: updated.id,
        appName: updated.fields[CLIENTS.fields.appName] || '',
        brandPrimaryColour: updated.fields[CLIENTS.fields.brandPrimaryColour] || '',
        brandAccentColour: updated.fields[CLIENTS.fields.brandAccentColour] || '',
        welcomeMessage: updated.fields[CLIENTS.fields.welcomeMessage] || '',
        logoUrl: updated.fields[CLIENTS.fields.logoUrl] || '',
      },
    });
  } catch (err) {
    console.error('[admin/clients/update-branding] update failed:', err);
    return jsonError(res, 500, 'internal_error', 'Failed to save branding');
  }
}
