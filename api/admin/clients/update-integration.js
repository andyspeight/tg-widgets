/**
 * POST /api/admin/clients/update-integration
 *
 * Updates the Travelify integration fields on an existing Client record:
 *   - travelifyAppId  (numeric, optional, must be unique across clients)
 *   - travelifySiteId (numeric, optional)
 *   - apiKey          (UUID, optional, the Travelify "primarygroupsid")
 *
 * Phase 3 starts here. Other fields on the Overview tab remain read-only
 * for now — this endpoint is scoped specifically to the integration panel
 * because that's where the day-one operational pain is (no API key = no
 * widget). Other edit endpoints follow the same pattern when needed.
 *
 * Auth: widget_suite owner or admin.
 *
 * Body:
 *   { id: 'recXXX', travelifyAppId: '250', travelifySiteId: '250', apiKey: 'A41D...650D' }
 *
 * Any field omitted is left unchanged. Pass an empty string to clear a field.
 */

import { requireAuth, requireProductAccess } from '../../_lib/auth/middleware.js';
import {
  getRecord,
  listAllRecords,
  updateRecord,
} from '../../_lib/auth/airtable.js';
import { jsonError } from '../../_lib/auth/http.js';
import {
  PRODUCTS,
  PERMISSIONS,
  CLIENTS,
} from '../../_lib/auth/schema.js';

const REC_ID_RE = /^rec[A-Za-z0-9]{14}$/;
const NUMERIC_ID_RE = /^\d{1,10}$/;
const UUID_RE = /^[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12}$/;

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

  // Only validate fields that were actually supplied. undefined => leave
  // the field unchanged. '' => clear the field.
  const errors = [];
  const updates = {};

  if (body.travelifyAppId !== undefined) {
    const v = String(body.travelifyAppId).trim();
    if (v && !NUMERIC_ID_RE.test(v)) errors.push('travelifyAppId must be numeric, up to 10 digits');
    updates[CLIENTS.fields.travelifyAppId] = v;
  }

  if (body.travelifySiteId !== undefined) {
    const v = String(body.travelifySiteId).trim();
    if (v && !NUMERIC_ID_RE.test(v)) errors.push('travelifySiteId must be numeric, up to 10 digits');
    updates[CLIENTS.fields.travelifySiteId] = v;
  }

  if (body.apiKey !== undefined) {
    const v = String(body.apiKey).trim();
    if (v && !UUID_RE.test(v)) {
      errors.push('apiKey must be a UUID like A41D180E-CBFE-4E30-A47D-FAAB424A650D');
    }
    updates[CLIENTS.fields.apiKey] = v;
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
    console.error('[admin/clients/update-integration] failed to load client:', err);
    return jsonError(res, 500, 'internal_error', 'Could not load client');
  }
  if (!target) {
    return jsonError(res, 404, 'client_not_found', 'No client with that id');
  }

  // If App ID is changing to a non-empty value, make sure no other client
  // already owns that App ID. Two clients on the same Travelify App ID
  // would corrupt SSO routing.
  const newAppId = body.travelifyAppId !== undefined
    ? String(body.travelifyAppId).trim()
    : null;

  if (newAppId) {
    try {
      const clients = await listAllRecords(CLIENTS.tableId);
      const clash = clients.find((c) =>
        c.id !== id &&
        String(c.fields[CLIENTS.fields.travelifyAppId] || '').trim() === newAppId
      );
      if (clash) {
        const clashName = clash.fields[CLIENTS.fields.clientName] || clash.id;
        return jsonError(res, 409, 'app_id_conflict',
          `Travelify App ID ${newAppId} is already used by ${clashName}`);
      }
    } catch (err) {
      console.error('[admin/clients/update-integration] app id conflict check failed:', err);
      return jsonError(res, 500, 'internal_error', 'Could not verify App ID uniqueness');
    }
  }

  try {
    const updated = await updateRecord(CLIENTS.tableId, id, updates);
    return res.status(200).json({
      ok: true,
      client: {
        id: updated.id,
        travelifyAppId: updated.fields[CLIENTS.fields.travelifyAppId] || '',
        travelifySiteId: updated.fields[CLIENTS.fields.travelifySiteId] || '',
        apiKey: updated.fields[CLIENTS.fields.apiKey] || '',
      },
    });
  } catch (err) {
    console.error('[admin/clients/update-integration] update failed:', err);
    return jsonError(res, 500, 'internal_error', 'Failed to save integration');
  }
}
