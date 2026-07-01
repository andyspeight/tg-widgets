/**
 * DELETE /api/admin/clients/delete?id=recXXX&confirmName=<client name>
 *
 * Hard-deletes a client and everything that hangs off it. Built for clearing
 * out test data (e.g. clients auto-provisioned during SSO testing), so it is
 * deliberately thorough and irreversible.
 *
 * Cascade, in order:
 *   1. Client Entitlement rows for this client — deleted.
 *   2. Users linked to this client:
 *        - If the user belongs ONLY to this client (and isn't the caller):
 *          delete the User row, all their Permission rows, and all their
 *          Session rows.
 *        - If the user also belongs to other clients (or is the caller):
 *          leave the user, just unlink this client from their client array.
 *          Their permissions and sessions are left untouched.
 *   3. The Client record itself — deleted.
 *
 * Widgets and any data held outside the auth base are NOT touched by this
 * endpoint.
 *
 * Safety:
 *   - Auth: widget_suite owner or admin (Travelgenix-internal admin).
 *   - Refuses to delete the client the caller is currently acting as
 *     (self-protection — you can't delete the workspace you're signed into,
 *     which also protects the Travelgenix home client).
 *   - Requires confirmName to match the client's name (case-insensitive,
 *     trimmed) so a delete can't fire by accident.
 *   - Never deletes the caller's own user record.
 *
 * Method: DELETE (query params), mirroring manage-user.
 */

import { requireAuth, requireProductAccess } from '../../_lib/auth/middleware.js';
import {
  setCors, jsonOk, jsonError, getRequestIp, getUserAgent,
} from '../../_lib/auth/http.js';
import {
  getRecord, listAllRecords, updateRecord, bulkDeleteRecords,
} from '../../_lib/auth/airtable.js';
import {
  CLIENTS, USERS, PERMISSIONS, SESSIONS, CLIENT_ENTITLEMENTS,
  PRODUCTS, AUTH_EVENTS,
} from '../../_lib/auth/schema.js';
import { invalidateUserPermissions } from '../../_lib/auth/permissions.js';
import { logAuthEvent } from '../../_lib/auth/audit.js';

const REC_ID_RE = /^rec[A-Za-z0-9]{14}$/;

/** Delete an array of record ids in batches of 10 (Airtable's per-call limit). */
async function deleteInBatches(tableId, ids) {
  let deleted = 0;
  for (let i = 0; i < ids.length; i += 10) {
    const batch = ids.slice(i, i + 10);
    await bulkDeleteRecords(tableId, batch);
    deleted += batch.length;
  }
  return deleted;
}

export default async function handler(req, res) {
  if (setCors(req, res)) return;

  if (req.method !== 'DELETE') {
    return jsonError(res, 405, 'method_not_allowed', 'DELETE only');
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

  const id = String(req.query?.id || '').trim();
  const confirmName = String(req.query?.confirmName || '').trim();

  if (!REC_ID_RE.test(id)) {
    return jsonError(res, 400, 'invalid_id', 'id query param must be a valid record id');
  }
  if (id === ctx.clientRecordId) {
    return jsonError(res, 400, 'cannot_delete_active_client',
      "You can't delete the client you're currently signed into. Switch to another workspace first.");
  }

  // Load the client
  let client;
  try {
    client = await getRecord(CLIENTS.tableId, id);
  } catch (err) {
    if (err?.status === 404) {
      return jsonError(res, 404, 'client_not_found', 'No client with that id');
    }
    console.error('[admin/clients/delete] failed to load client:', err);
    return jsonError(res, 500, 'internal_error', 'Could not load client');
  }

  const clientName = String(client.fields[CLIENTS.fields.clientName] || '').trim();

  // Typed-name confirmation — must match to proceed
  if (!confirmName || confirmName.toLowerCase() !== clientName.toLowerCase()) {
    return jsonError(res, 400, 'confirm_name_mismatch',
      `Type the client's exact name to confirm deletion (expected "${clientName}")`);
  }

  try {
    // Load everything we need to cascade, in parallel
    const [allEntitlements, allUsers, allPerms, allSessions] = await Promise.all([
      listAllRecords(CLIENT_ENTITLEMENTS.tableId),
      listAllRecords(USERS.tableId),
      listAllRecords(PERMISSIONS.tableId),
      listAllRecords(SESSIONS.tableId),
    ]);

    // 1. Entitlement rows for this client
    const entitlementIds = allEntitlements
      .filter((e) => (e.fields[CLIENT_ENTITLEMENTS.fields.client] || []).includes(id))
      .map((e) => e.id);

    // 2. Partition the client's users into "delete" vs "unlink"
    const clientUsers = allUsers.filter(
      (u) => (u.fields[USERS.fields.client] || []).includes(id)
    );

    const usersToDelete = [];   // belong only to this client, and not the caller
    const usersToUnlink = [];   // belong to other clients too, or are the caller

    for (const u of clientUsers) {
      const otherClients = (u.fields[USERS.fields.client] || []).filter((cid) => cid !== id);
      if (otherClients.length === 0 && u.id !== ctx.userRecordId) {
        usersToDelete.push(u);
      } else {
        usersToUnlink.push({ user: u, otherClients });
      }
    }

    const deleteUserIdSet = new Set(usersToDelete.map((u) => u.id));

    // Permission + session rows belonging to the users we're fully deleting
    const permIds = allPerms
      .filter((p) => (p.fields[PERMISSIONS.fields.user] || []).some((uid) => deleteUserIdSet.has(uid)))
      .map((p) => p.id);
    const sessionIds = allSessions
      .filter((s) => (s.fields[SESSIONS.fields.user] || []).some((uid) => deleteUserIdSet.has(uid)))
      .map((s) => s.id);

    // ─── Execute the cascade ───────────────────────────────────────────
    // Children first, client record last.

    const entitlementsDeleted = await deleteInBatches(CLIENT_ENTITLEMENTS.tableId, entitlementIds);
    const permissionsDeleted = await deleteInBatches(PERMISSIONS.tableId, permIds);
    const sessionsDeleted = await deleteInBatches(SESSIONS.tableId, sessionIds);

    // Unlink this client from users who belong to other clients too
    for (const { user, otherClients } of usersToUnlink) {
      await updateRecord(USERS.tableId, user.id, {
        [USERS.fields.client]: otherClients,
      });
      invalidateUserPermissions(user.id);
    }

    // Delete the exclusively-owned users
    const usersDeleted = await deleteInBatches(USERS.tableId, [...deleteUserIdSet]);
    for (const uid of deleteUserIdSet) invalidateUserPermissions(uid);

    // Finally, the client record
    await bulkDeleteRecords(CLIENTS.tableId, [id]);

    logAuthEvent({
      // No dedicated 'client_deleted' type in the schema; reuse INVITE_REVOKED
      // (the same type manage-user uses for destructive user deletes) and tag
      // the real action in detail. Client link is omitted because the client
      // record no longer exists to link to.
      type: AUTH_EVENTS.types.INVITE_REVOKED,
      success: true,
      userRecordId: ctx.userRecordId,
      ip: getRequestIp(req),
      userAgent: getUserAgent(req),
      detail: {
        action: 'admin_delete_client',
        deletedClientId: id,
        deletedClientName: clientName,
        entitlementsDeleted,
        usersDeleted,
        usersUnlinked: usersToUnlink.length,
        permissionsDeleted,
        sessionsDeleted,
        source: 'admin_client_detail',
      },
    }).catch(() => {});

    console.log('[admin/clients/delete] deleted client', id, `("${clientName}")`, {
      entitlementsDeleted, usersDeleted, usersUnlinked: usersToUnlink.length,
      permissionsDeleted, sessionsDeleted,
    });

    return jsonOk(res, {
      ok: true,
      deletedClientId: id,
      entitlementsDeleted,
      usersDeleted,
      usersUnlinked: usersToUnlink.length,
      permissionsDeleted,
      sessionsDeleted,
    });
  } catch (err) {
    console.error('[admin/clients/delete] cascade failed:', err);
    return jsonError(res, 500, 'delete_failed',
      'Failed to delete client — some records may have been removed. Check the client and retry.');
  }
}
