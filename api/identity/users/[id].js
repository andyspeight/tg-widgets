/**
 * /api/identity/users/[id]
 *
 * GET    → fetch one user (must be in same Client as requester) + permissions
 * PATCH  → suspend/reactivate, edit name/role, etc.
 * DELETE → delete the user (also cascades their permissions)
 *
 * Auth: widget_suite owner or admin.
 */

import {
  requireAuth,
  requireProductAccess,
} from '../../_lib/auth/middleware.js';
import { setCors, jsonError, parseJson } from '../../_lib/auth/http.js';
import {
  getRecord,
  updateRecord,
  listAllRecords,
  bulkDeleteRecords,
} from '../../_lib/auth/airtable.js';
import {
  USERS,
  PERMISSIONS,
  PRODUCTS,
} from '../../_lib/auth/schema.js';
import { invalidateUserPermissions } from '../../_lib/auth/permissions.js';

export default async function handler(req, res) {
  if (setCors(req, res)) return;

  const id = String(req.query?.id || '');
  if (!/^rec[A-Za-z0-9]{14}$/.test(id)) {
    return jsonError(res, 400, 'bad_id', 'Invalid user id');
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

  // Load the target user and verify they belong to the same Client as the requester
  let user;
  try {
    user = await getRecord(USERS.tableId, id);
  } catch (err) {
    if (err.status === 404) return jsonError(res, 404, 'not_found', 'User not found');
    throw err;
  }
  const userClientLinks = user.fields[USERS.fields.client] || [];
  if (!userClientLinks.includes(ctx.clientRecordId)) {
    return jsonError(res, 403, 'wrong_client', 'You can only manage users in your own client');
  }

  if (req.method === 'GET')    return handleGet(req, res, ctx, user);
  if (req.method === 'PATCH')  return handlePatch(req, res, ctx, user);
  if (req.method === 'DELETE') return handleDelete(req, res, ctx, user);

  return jsonError(res, 405, 'method_not_allowed', 'GET, PATCH or DELETE');
}

async function handleGet(req, res, ctx, user) {
  try {
    const perms = await listAllRecords(PERMISSIONS.tableId);
    const userPerms = perms.filter((p) => (p.fields[PERMISSIONS.fields.user] || []).includes(user.id));
    const allProducts = await listAllRecords(PRODUCTS.tableId);
    const productById = new Map(allProducts.map((p) => [p.id, p.fields]));

    return res.status(200).json({
      ok: true,
      user: {
        recordId: user.id,
        email: user.fields[USERS.fields.email] || '',
        fullName: user.fields[USERS.fields.fullName] || '',
        role: user.fields[USERS.fields.role] || 'member',
        status: user.fields[USERS.fields.status] || USERS.statuses.ACTIVE,
        lastLogin: user.fields[USERS.fields.lastLogin] || null,
      },
      permissions: userPerms.map((p) => {
        const productLinks = p.fields[PERMISSIONS.fields.product] || [];
        const productFields = productLinks[0] ? productById.get(productLinks[0]) : null;
        return {
          permissionId: p.id,
          productSlug: productFields ? productFields[PRODUCTS.fields.productId] : null,
          productName: productFields ? productFields[PRODUCTS.fields.displayName] : null,
          role: p.fields[PERMISSIONS.fields.role] || 'member',
          status: p.fields[PERMISSIONS.fields.status] || PERMISSIONS.statuses.ACTIVE,
          expiresAt: p.fields[PERMISSIONS.fields.expiresAt] || null,
        };
      }),
    });
  } catch (err) {
    console.error('[identity/users/:id GET]', err);
    return jsonError(res, 500, 'load_failed', 'Failed to load user');
  }
}

async function handlePatch(req, res, ctx, user) {
  const body = await parseJson(req);
  if (!body) return jsonError(res, 400, 'bad_json', 'Invalid JSON body');

  if (body.status === USERS.statuses.SUSPENDED && user.id === ctx.userRecordId) {
    return jsonError(res, 400, 'self_suspend', "You can't suspend your own account");
  }

  const fields = {};
  if (body.status && Object.values(USERS.statuses).includes(body.status)) {
    fields[USERS.fields.status] = body.status;
  }
  if (typeof body.fullName === 'string' && body.fullName.trim().length >= 2) {
    fields[USERS.fields.fullName] = body.fullName.trim();
  }
  if (body.role && Object.values(USERS.roles).includes(body.role)) {
    fields[USERS.fields.role] = body.role;
  }
  if (typeof body.notes === 'string') {
    fields[USERS.fields.notes] = body.notes;
  }

  if (Object.keys(fields).length === 0) {
    return jsonError(res, 400, 'no_changes', 'No valid fields to update');
  }

  try {
    await updateRecord(USERS.tableId, user.id, fields);
    invalidateUserPermissions(user.id);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[identity/users/:id PATCH]', err);
    return jsonError(res, 500, 'update_failed', 'Failed to update user');
  }
}

async function handleDelete(req, res, ctx, user) {
  if (user.id === ctx.userRecordId) {
    return jsonError(res, 400, 'self_delete', "You can't delete your own account");
  }

  try {
    // First, find and delete all permission rows for this user
    const allPerms = await listAllRecords(PERMISSIONS.tableId);
    const myPermIds = allPerms
      .filter((p) => (p.fields[PERMISSIONS.fields.user] || []).includes(user.id))
      .map((p) => p.id);

    // Delete in batches of 10 (Airtable limit)
    for (let i = 0; i < myPermIds.length; i += 10) {
      const batch = myPermIds.slice(i, i + 10);
      await bulkDeleteRecords(PERMISSIONS.tableId, batch);
    }

    // Then delete the user
    await bulkDeleteRecords(USERS.tableId, [user.id]);
    invalidateUserPermissions(user.id);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[identity/users/:id DELETE]', err);
    return jsonError(res, 500, 'delete_failed', 'Failed to delete user');
  }
}
