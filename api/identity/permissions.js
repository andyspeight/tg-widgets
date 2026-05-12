/**
 * /api/identity/permissions
 *
 * POST    → grant a permission     { userId, productSlug, role, expiresAt? }
 * PATCH   → modify a permission    { permissionId, role?, status?, expiresAt? }
 * DELETE  → revoke a permission    ?id=recXXX
 *
 * Auth: widget_suite owner or admin.
 */

import {
  requireAuth,
  requireProductAccess,
} from '../_lib/auth/middleware.js';
import { setCors, jsonError, parseJson } from '../_lib/auth/http.js';
import {
  listAllRecords,
  createRecord,
  updateRecord,
  bulkDeleteRecords,
  getRecord,
} from '../_lib/auth/airtable.js';
import {
  PERMISSIONS,
  PRODUCTS,
  USERS,
} from '../_lib/auth/schema.js';
import { invalidateUserPermissions } from '../_lib/auth/permissions.js';

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

  if (req.method === 'POST')   return handleGrant(req, res, ctx);
  if (req.method === 'PATCH')  return handleUpdate(req, res, ctx);
  if (req.method === 'DELETE') return handleRevoke(req, res, ctx);

  return jsonError(res, 405, 'method_not_allowed', 'POST, PATCH or DELETE');
}

async function handleGrant(req, res, ctx) {
  const body = await parseJson(req);
  if (!body) return jsonError(res, 400, 'bad_json', 'Invalid JSON body');

  const userId = String(body.userId || '');
  const productSlug = String(body.productSlug || '');
  const desiredRole = String(body.role || 'member').toLowerCase();
  const expiresAt = body.expiresAt ? String(body.expiresAt) : null;

  if (!/^rec[A-Za-z0-9]{14}$/.test(userId)) {
    return jsonError(res, 400, 'bad_user_id', 'Invalid userId');
  }
  if (!productSlug) return jsonError(res, 400, 'no_product', 'productSlug required');
  if (!Object.values(PERMISSIONS.roles).includes(desiredRole)) {
    return jsonError(res, 400, 'bad_role', 'Invalid role');
  }

  // Verify target user is in the same Client
  let user;
  try {
    user = await getRecord(USERS.tableId, userId);
  } catch {
    return jsonError(res, 404, 'user_not_found', 'User not found');
  }
  const userClients = user.fields[USERS.fields.client] || [];
  if (!userClients.includes(ctx.clientRecordId)) {
    return jsonError(res, 403, 'wrong_client', 'User is not in your client');
  }

  try {
    // Find the product record
    const products = await listAllRecords(PRODUCTS.tableId);
    const product = products.find((p) => p.fields[PRODUCTS.fields.productId] === productSlug);
    if (!product) return jsonError(res, 400, 'unknown_product', `Unknown product: ${productSlug}`);

    // Check for duplicate
    const allPerms = await listAllRecords(PERMISSIONS.tableId);
    const dup = allPerms.find(
      (p) =>
        (p.fields[PERMISSIONS.fields.user] || []).includes(userId) &&
        (p.fields[PERMISSIONS.fields.product] || []).includes(product.id)
    );
    if (dup) {
      return jsonError(res, 409, 'already_granted', 'User already has a permission for this product');
    }

    const fields = {
      [PERMISSIONS.fields.user]:      [userId],
      [PERMISSIONS.fields.product]:   [product.id],
      [PERMISSIONS.fields.role]:      desiredRole,
      [PERMISSIONS.fields.status]:    PERMISSIONS.statuses.ACTIVE,
      [PERMISSIONS.fields.grantedBy]: [ctx.userRecordId],
      [PERMISSIONS.fields.granted]:   new Date().toISOString(),
    };
    if (expiresAt) fields[PERMISSIONS.fields.expiresAt] = expiresAt;

    const created = await createRecord(PERMISSIONS.tableId, fields);
    invalidateUserPermissions(userId);
    return res.status(201).json({ ok: true, permissionId: created.id });
  } catch (err) {
    console.error('[identity/permissions POST]', err);
    return jsonError(res, 500, 'grant_failed', 'Failed to grant permission');
  }
}

async function handleUpdate(req, res, ctx) {
  const body = await parseJson(req);
  if (!body) return jsonError(res, 400, 'bad_json', 'Invalid JSON body');

  const id = String(body.permissionId || '');
  if (!/^rec[A-Za-z0-9]{14}$/.test(id)) {
    return jsonError(res, 400, 'bad_id', 'Invalid permissionId');
  }

  // Confirm the permission row's user is in the same Client
  let perm;
  try {
    perm = await getRecord(PERMISSIONS.tableId, id);
  } catch {
    return jsonError(res, 404, 'not_found', 'Permission not found');
  }
  const userLinks = perm.fields[PERMISSIONS.fields.user] || [];
  if (userLinks.length > 0) {
    try {
      const user = await getRecord(USERS.tableId, userLinks[0]);
      const userClients = user.fields[USERS.fields.client] || [];
      if (!userClients.includes(ctx.clientRecordId)) {
        return jsonError(res, 403, 'wrong_client', 'Permission belongs to a different client');
      }
    } catch {
      // User missing — let the update proceed; admin can clean up
    }
  }

  const fields = {};
  if (body.role && Object.values(PERMISSIONS.roles).includes(String(body.role).toLowerCase())) {
    fields[PERMISSIONS.fields.role] = String(body.role).toLowerCase();
  }
  if (body.status && Object.values(PERMISSIONS.statuses).includes(body.status)) {
    fields[PERMISSIONS.fields.status] = body.status;
  }
  if (body.expiresAt === null) {
    fields[PERMISSIONS.fields.expiresAt] = null;
  } else if (typeof body.expiresAt === 'string') {
    fields[PERMISSIONS.fields.expiresAt] = body.expiresAt;
  }

  if (Object.keys(fields).length === 0) {
    return jsonError(res, 400, 'no_changes', 'No valid fields to update');
  }

  try {
    await updateRecord(PERMISSIONS.tableId, id, fields);
    if (userLinks[0]) invalidateUserPermissions(userLinks[0]);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[identity/permissions PATCH]', err);
    return jsonError(res, 500, 'update_failed', 'Failed to update permission');
  }
}

async function handleRevoke(req, res, ctx) {
  const id = String(req.query?.id || '');
  if (!/^rec[A-Za-z0-9]{14}$/.test(id)) {
    return jsonError(res, 400, 'bad_id', 'Invalid permission id');
  }

  let perm;
  try {
    perm = await getRecord(PERMISSIONS.tableId, id);
  } catch {
    return jsonError(res, 404, 'not_found', 'Permission not found');
  }
  const userLinks = perm.fields[PERMISSIONS.fields.user] || [];
  if (userLinks.length > 0) {
    try {
      const user = await getRecord(USERS.tableId, userLinks[0]);
      const userClients = user.fields[USERS.fields.client] || [];
      if (!userClients.includes(ctx.clientRecordId)) {
        return jsonError(res, 403, 'wrong_client', 'Permission belongs to a different client');
      }
    } catch {
      // permit cleanup
    }
  }

  try {
    await bulkDeleteRecords(PERMISSIONS.tableId, [id]);
    if (userLinks[0]) invalidateUserPermissions(userLinks[0]);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[identity/permissions DELETE]', err);
    return jsonError(res, 500, 'revoke_failed', 'Failed to revoke permission');
  }
}
