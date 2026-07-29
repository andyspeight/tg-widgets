/**
 * POST /api/admin/clients/update-entitlement
 *
 * Enables or disables a single product entitlement for an existing client.
 *
 * Phase 3 (continued). Companion to update-integration.js — same auth, same
 * helpers, same response style. This closes the gap where entitlements could
 * only be set during onboarding (New Client wizard) and were read-only on the
 * client detail page afterwards.
 *
 * Behaviour (find-or-create):
 *   - If a Client Entitlement row already exists for this client + catalogue
 *     item, its `enabled` flag is updated.
 *   - If no row exists yet (e.g. a product added to the catalogue after the
 *     client was onboarded, like Luna Travel), a new row is created.
 *   - Any entitlement toggled here is marked source = 'Manual Override',
 *     because it is a deliberate post-onboarding change, distinct from a
 *     package default.
 *
 * Auth: widget_suite owner or admin.
 *
 * Body:
 *   { clientId: 'recXXX', catalogueItemId: 'recYYY', enabled: true }
 */

import { requireAuth, requireProductAccess } from '../../_lib/auth/middleware.js';
import {
  getRecord,
  listAllRecords,
  updateRecord,
  createRecord,
} from '../../_lib/auth/airtable.js';
import { jsonError } from '../../_lib/auth/http.js';
import { provisionLunaChat } from '../../_lib/luna-chat-provision.js';
import {
  PRODUCTS,
  PERMISSIONS,
  CLIENTS,
  CATALOGUE,
  CLIENT_ENTITLEMENTS,
} from '../../_lib/auth/schema.js';

const REC_ID_RE = /^rec[A-Za-z0-9]{14}$/;
const MANUAL_OVERRIDE = 'Manual Override';

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

  const clientId = String(body.clientId || '').trim();
  const catalogueItemId = String(body.catalogueItemId || '').trim();
  const enabled = body.enabled === true;

  if (!REC_ID_RE.test(clientId)) {
    return jsonError(res, 400, 'invalid_client_id', 'clientId must be a valid record id');
  }
  if (!REC_ID_RE.test(catalogueItemId)) {
    return jsonError(res, 400, 'invalid_catalogue_id', 'catalogueItemId must be a valid record id');
  }
  if (typeof body.enabled !== 'boolean') {
    return jsonError(res, 400, 'invalid_enabled', 'enabled must be true or false');
  }

  // Confirm the client exists.
  let client;
  try {
    client = await getRecord(CLIENTS.tableId, clientId).catch((err) => {
      if (err?.status === 404) return null;
      throw err;
    });
  } catch (err) {
    console.error('[update-entitlement] failed to load client:', err);
    return jsonError(res, 500, 'internal_error', 'Could not load client');
  }
  if (!client) {
    return jsonError(res, 404, 'client_not_found', 'No client with that id');
  }

  // Confirm the catalogue item exists and is active.
  let catalogueItem;
  try {
    catalogueItem = await getRecord(CATALOGUE.tableId, catalogueItemId).catch((err) => {
      if (err?.status === 404) return null;
      throw err;
    });
  } catch (err) {
    console.error('[update-entitlement] failed to load catalogue item:', err);
    return jsonError(res, 500, 'internal_error', 'Could not load catalogue item');
  }
  if (!catalogueItem) {
    return jsonError(res, 404, 'catalogue_item_not_found', 'No catalogue item with that id');
  }
  if (!catalogueItem.fields[CATALOGUE.fields.active]) {
    return jsonError(res, 400, 'catalogue_item_inactive', 'That product is not active in the catalogue');
  }

  const nowIso = new Date().toISOString();

  // Find an existing entitlement row for this client + catalogue item.
  let existing = null;
  try {
    const allEntitlements = await listAllRecords(CLIENT_ENTITLEMENTS.tableId);
    existing = allEntitlements.find((e) => {
      const clientLinks = e.fields[CLIENT_ENTITLEMENTS.fields.client] || [];
      const catLinks = e.fields[CLIENT_ENTITLEMENTS.fields.catalogueItem] || [];
      return clientLinks.includes(clientId) && catLinks.includes(catalogueItemId);
    }) || null;
  } catch (err) {
    console.error('[update-entitlement] failed to load entitlements:', err);
    return jsonError(res, 500, 'internal_error', 'Could not load entitlements');
  }

  try {
    let rowId;
    let source;

    if (existing) {
      // Update the existing row. Mark as Manual Override since this is a
      // deliberate post-onboarding change.
      const updates = {
        [CLIENT_ENTITLEMENTS.fields.enabled]: enabled,
        [CLIENT_ENTITLEMENTS.fields.source]: MANUAL_OVERRIDE,
        [CLIENT_ENTITLEMENTS.fields.lastModified]: nowIso,
      };
      // Stamp activatedDate the first time it goes enabled.
      if (enabled && !existing.fields[CLIENT_ENTITLEMENTS.fields.activatedDate]) {
        updates[CLIENT_ENTITLEMENTS.fields.activatedDate] = nowIso;
      }
      const updated = await updateRecord(CLIENT_ENTITLEMENTS.tableId, existing.id, updates);
      rowId = updated.id;
      source = updated.fields[CLIENT_ENTITLEMENTS.fields.source] || MANUAL_OVERRIDE;
    } else {
      // No row yet — create one. (Common for products added to the catalogue
      // after the client was onboarded, e.g. Luna Travel.)
      const created = await createRecord(CLIENT_ENTITLEMENTS.tableId, {
        [CLIENT_ENTITLEMENTS.fields.client]:        [clientId],
        [CLIENT_ENTITLEMENTS.fields.catalogueItem]: [catalogueItemId],
        [CLIENT_ENTITLEMENTS.fields.enabled]:       enabled,
        [CLIENT_ENTITLEMENTS.fields.source]:        MANUAL_OVERRIDE,
        [CLIENT_ENTITLEMENTS.fields.activatedDate]: enabled ? nowIso : null,
        [CLIENT_ENTITLEMENTS.fields.created]:       nowIso,
        [CLIENT_ENTITLEMENTS.fields.lastModified]:  nowIso,
      });
      rowId = created.id;
      source = MANUAL_OVERRIDE;
    }

    // Luna Chat keeps its own client records, so switching the product on here
    // has to create the client over there as well. Before this, that step was
    // done by hand and routinely missed: a client could be live in Client
    // Control and simply not exist in Luna Chat — invisible in its client list
    // and in "Act as" — or exist with no App ID (so Luna invented booking links
    // that 404'd) or no AuthClientId (so they could not sign in at all).
    //
    // Deliberately NOT fatal. The entitlement above is the source of truth and
    // must stand even if Luna Chat is unreachable; we return a warning instead
    // so the admin can retry rather than being told the whole save failed.
    let lunaChat;
    if (catalogueItem.fields[CATALOGUE.fields.productSlug] === PRODUCTS.slugs.LUNA_CHAT) {
      lunaChat = await provisionLunaChat(client, enabled);
    }

    return res.status(200).json({
      ok: true,
      entitlement: {
        entitlementId: rowId,
        catalogueItemId,
        enabled,
        source,
      },
      ...(lunaChat ? { lunaChat } : {}),
      ...(lunaChat && lunaChat.warning ? { warning: lunaChat.warning } : {}),
    });
  } catch (err) {
    console.error('[update-entitlement] write failed:', err);
    return jsonError(res, 500, 'internal_error', 'Failed to update entitlement');
  }
}
