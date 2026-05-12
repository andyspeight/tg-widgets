/**
 * /api/admin/clients/manage-user
 *
 * Cross-tenant user management. Used from the Travelgenix Control Client
 * Detail page → Users tab → row actions and edit modal.
 *
 * Unlike /api/identity/users/[id] which requires the target user to be in
 * the CALLER's client, this endpoint lets a Travelgenix-internal admin
 * manage a user that belongs to ANY client — as long as the body specifies
 * the clientId and the target user genuinely belongs to that client.
 *
 * Auth: widget_suite owner or admin (Travelgenix-internal admin).
 *
 * Methods:
 *
 * PATCH — update user
 *   Body: { userId, clientId, fullName?, role?, status?, productSlugs? }
 *   - fullName / role / status: passed through to the USERS row update
 *   - productSlugs: if provided, replaces the user's full set of permissions
 *     for the standard products list (computes diff: grant new, revoke
 *     removed, update role on kept)
 *   - status='suspended' refuses if target user has role='owner' on the client
 *     (don't suspend an owner from this UI; that's a deeper operation)
 *
 * DELETE — delete user and cascade their permissions
 *   Query: ?userId=recXXX&clientId=recYYY
 *   - Refuses if target user is the SAME record as the caller (self-delete
 *     guard, even though target user belongs to a different client in
 *     practice — defence in depth)
 *   - Deletes the User row + all their permission rows
 */

import { requireAuth, requireProductAccess } from '../../_lib/auth/middleware.js';
import {
  setCors, parseJson, jsonOk, jsonError,
  getRequestIp, getUserAgent,
} from '../../_lib/auth/http.js';
import {
  getRecord, listAllRecords, createRecord, updateRecord, bulkDeleteRecords,
} from '../../_lib/auth/airtable.js';
import {
  USERS, CLIENTS, PERMISSIONS, PRODUCTS, AUTH_EVENTS,
} from '../../_lib/auth/schema.js';
import { invalidateUserPermissions } from '../../_lib/auth/permissions.js';
import { logAuthEvent } from '../../_lib/auth/audit.js';

const REC_ID_RE = /^rec[A-Za-z0-9]{14}$/;
const ALLOWED_USER_ROLES = [USERS.roles.OWNER, USERS.roles.ADMIN, USERS.roles.MEMBER];
const ALLOWED_STATUSES = [USERS.statuses.ACTIVE, USERS.statuses.SUSPENDED, USERS.statuses.INVITED];

export default async function handler(req, res) {
  if (setCors(req, res)) return;

  const ctx = await requireAuth(req, res);
  if (!ctx) return;

  const role = requireProductAccess(
    ctx,
    PRODUCTS.slugs.WIDGET_SUITE,
    [PERMISSIONS.roles.OWNER, PERMISSIONS.roles.ADMIN],
    res
  );
  if (!role) return;

  if (req.method === 'PATCH')  return handlePatch(req, res, ctx);
  if (req.method === 'DELETE') return handleDelete(req, res, ctx);

  return jsonError(res, 405, 'method_not_allowed', 'PATCH or DELETE');
}

/**
 * Resolve and verify the target user belongs to the specified client.
 * Returns the target user record on success, sends a 4xx and returns null
 * on any auth/lookup failure.
 */
async function resolveTargetUser({ userId, clientId, res }) {
  if (!REC_ID_RE.test(userId)) {
    jsonError(res, 400, 'invalid_user_id', 'userId is required and must be a valid record id');
    return null;
  }
  if (!REC_ID_RE.test(clientId)) {
    jsonError(res, 400, 'invalid_client_id', 'clientId is required and must be a valid record id');
    return null;
  }

  let user;
  try {
    user = await getRecord(USERS.tableId, userId);
  } catch (err) {
    if (err?.status === 404) {
      jsonError(res, 404, 'user_not_found', 'User not found');
      return null;
    }
    throw err;
  }

  const userClients = user.fields[USERS.fields.client] || [];
  if (!userClients.includes(clientId)) {
    // Don't reveal whether the user exists at a different client — generic 404
    jsonError(res, 404, 'user_not_found', 'User not found in that client');
    return null;
  }
  return user;
}

async function handlePatch(req, res, ctx) {
  const body = await parseJson(req);
  if (!body) return jsonError(res, 400, 'bad_json', 'Invalid JSON body');

  const userId = String(body.userId || '');
  const clientId = String(body.clientId || '');

  const user = await resolveTargetUser({ userId, clientId, res });
  if (!user) return;

  // Build the user-row patch
  const fields = {};
  if (typeof body.fullName === 'string') {
    const fn = body.fullName.trim();
    if (fn.length >= 2 && fn.length <= 100) fields[USERS.fields.fullName] = fn;
  }
  if (body.role && ALLOWED_USER_ROLES.includes(String(body.role).toLowerCase())) {
    fields[USERS.fields.role] = String(body.role).toLowerCase();
  }
  if (body.status && ALLOWED_STATUSES.includes(body.status)) {
    // Defence in depth — never accept suspending an owner via this endpoint
    if (body.status === USERS.statuses.SUSPENDED &&
        user.fields[USERS.fields.role] === USERS.roles.OWNER) {
      return jsonError(res, 400, 'cannot_suspend_owner',
        "Can't suspend an owner from here — change their role first or transfer ownership");
    }
    fields[USERS.fields.status] = body.status;
  }

  // Permissions diff (optional)
  let permSummary = null;
  if (Array.isArray(body.productSlugs)) {
    permSummary = await applyPermissionDiff({
      userId,
      newSlugs: body.productSlugs.map(String),
      // Use the role being assigned (or existing role) for any new permission rows
      desiredRole:
        fields[USERS.fields.role] ||
        user.fields[USERS.fields.role] ||
        USERS.roles.MEMBER,
      grantedByUserRecordId: ctx.userRecordId,
      res,
    });
    if (permSummary === null) return; // jsonError already sent
  }

  if (Object.keys(fields).length === 0 && !permSummary) {
    return jsonError(res, 400, 'no_changes', 'No valid fields to update');
  }

  try {
    if (Object.keys(fields).length > 0) {
      await updateRecord(USERS.tableId, userId, fields);
    }
    invalidateUserPermissions(userId);

    // Audit log (best-effort). No dedicated 'permission_changed' type in the
    // schema yet, so we re-use INVITE_REVOKED for revocations (closest match)
    // and ACCOUNT_LOCKED for suspensions. For pure name/role edits and grants
    // we log with a generic 'admin_edit' detail tag under INVITE_SENT (most
    // permissive existing type that won't be mistaken for a real auth event).
    const logType = fields[USERS.fields.status] === USERS.statuses.SUSPENDED
      ? AUTH_EVENTS.types.ACCOUNT_LOCKED
      : AUTH_EVENTS.types.INVITE_SENT;

    logAuthEvent({
      type: logType,
      success: true,
      userRecordId: ctx.userRecordId,
      clientRecordId: clientId,
      ip: getRequestIp(req),
      userAgent: getUserAgent(req),
      detail: {
        action: 'admin_edit_user',
        targetUserRecordId: userId,
        targetClientRecordId: clientId,
        fieldsChanged: Object.keys(fields),
        permSummary: permSummary || null,
        source: 'admin_client_detail',
      },
    }).catch(() => {});

    return jsonOk(res, { ok: true, permSummary: permSummary || null });
  } catch (err) {
    console.error('[admin/clients/manage-user PATCH] update failed:', err);
    return jsonError(res, 500, 'update_failed', 'Failed to update user');
  }
}

async function handleDelete(req, res, ctx) {
  const userId = String(req.query?.userId || '');
  const clientId = String(req.query?.clientId || '');

  if (userId === ctx.userRecordId) {
    return jsonError(res, 400, 'self_delete', "You can't delete your own account here");
  }

  const user = await resolveTargetUser({ userId, clientId, res });
  if (!user) return;

  try {
    // Delete all permission rows for this user
    const allPerms = await listAllRecords(PERMISSIONS.tableId);
    const myPermIds = allPerms
      .filter((p) => (p.fields[PERMISSIONS.fields.user] || []).includes(userId))
      .map((p) => p.id);

    for (let i = 0; i < myPermIds.length; i += 10) {
      const batch = myPermIds.slice(i, i + 10);
      await bulkDeleteRecords(PERMISSIONS.tableId, batch);
    }

    // Then delete the user
    await bulkDeleteRecords(USERS.tableId, [userId]);
    invalidateUserPermissions(userId);

    logAuthEvent({
      type: AUTH_EVENTS.types.INVITE_REVOKED,
      success: true,
      userRecordId: ctx.userRecordId,
      clientRecordId: clientId,
      ip: getRequestIp(req),
      userAgent: getUserAgent(req),
      detail: {
        action: 'admin_delete_user',
        targetUserRecordId: userId,
        targetClientRecordId: clientId,
        permissionsDeleted: myPermIds.length,
        source: 'admin_client_detail',
      },
    }).catch(() => {});

    return jsonOk(res, { ok: true, permissionsDeleted: myPermIds.length });
  } catch (err) {
    console.error('[admin/clients/manage-user DELETE] failed:', err);
    return jsonError(res, 500, 'delete_failed', 'Failed to delete user');
  }
}

/**
 * Diff the user's current permissions against newSlugs and apply changes.
 * - Adds new permissions for slugs not currently held
 * - Revokes permissions for slugs no longer wanted
 * - Updates role on kept permissions where the role differs
 *
 * Returns { granted, revoked, updated } on success, or null after sending an error.
 */
async function applyPermissionDiff({
  userId, newSlugs, desiredRole, grantedByUserRecordId, res,
}) {
  // Refuse empty selection — if the user should have no products, delete them instead
  if (newSlugs.length === 0) {
    jsonError(res, 400, 'no_products',
      'A user must have access to at least one product. Delete them instead if they should have none.');
    return null;
  }

  // Validate role for new permission rows
  if (!ALLOWED_USER_ROLES.includes(desiredRole)) {
    jsonError(res, 400, 'bad_role', 'Invalid role for permissions');
    return null;
  }

  const allProducts = await listAllRecords(PRODUCTS.tableId);
  const slugToProduct = new Map();
  for (const p of allProducts) {
    const slug = p.fields[PRODUCTS.fields.productId];
    if (slug) slugToProduct.set(slug, { id: p.id });
  }

  for (const slug of newSlugs) {
    if (!slugToProduct.has(slug)) {
      jsonError(res, 400, 'unknown_product', `Unknown product: ${slug}`);
      return null;
    }
  }
  const newSlugSet = new Set(newSlugs);

  // Load the user's existing permissions
  const allPerms = await listAllRecords(PERMISSIONS.tableId);
  const myPerms = allPerms.filter((p) =>
    (p.fields[PERMISSIONS.fields.user] || []).includes(userId)
  );

  // Map productRecordId -> slug for the products we know about
  const productIdToSlug = new Map();
  for (const [slug, info] of slugToProduct.entries()) productIdToSlug.set(info.id, slug);

  // Bucket existing perms
  const currentSlugToPerm = new Map();
  for (const p of myPerms) {
    const productLinks = p.fields[PERMISSIONS.fields.product] || [];
    const slug = productLinks[0] ? productIdToSlug.get(productLinks[0]) : null;
    if (slug) currentSlugToPerm.set(slug, p);
  }
  const currentSlugSet = new Set(currentSlugToPerm.keys());

  const toAdd = [...newSlugSet].filter((s) => !currentSlugSet.has(s));
  const toRemove = [...currentSlugToPerm.entries()]
    .filter(([slug]) => !newSlugSet.has(slug))
    .map(([, perm]) => perm);
  const toUpdate = [...currentSlugToPerm.entries()]
    .filter(([slug, perm]) =>
      newSlugSet.has(slug) &&
      (perm.fields[PERMISSIONS.fields.role] || '') !== desiredRole)
    .map(([, perm]) => perm);

  // Apply: grant new ones
  for (const slug of toAdd) {
    const productInfo = slugToProduct.get(slug);
    await createRecord(PERMISSIONS.tableId, {
      [PERMISSIONS.fields.user]:      [userId],
      [PERMISSIONS.fields.product]:   [productInfo.id],
      [PERMISSIONS.fields.role]:      desiredRole,
      [PERMISSIONS.fields.status]:    PERMISSIONS.statuses.ACTIVE,
      [PERMISSIONS.fields.grantedBy]: [grantedByUserRecordId],
      [PERMISSIONS.fields.granted]:   new Date().toISOString(),
    });
  }

  // Revoke removed ones (batch by 10)
  const removeIds = toRemove.map((p) => p.id);
  for (let i = 0; i < removeIds.length; i += 10) {
    await bulkDeleteRecords(PERMISSIONS.tableId, removeIds.slice(i, i + 10));
  }

  // Update role on kept ones
  for (const perm of toUpdate) {
    await updateRecord(PERMISSIONS.tableId, perm.id, {
      [PERMISSIONS.fields.role]: desiredRole,
    });
  }

  return {
    granted: toAdd.length,
    revoked: toRemove.length,
    updated: toUpdate.length,
  };
}
