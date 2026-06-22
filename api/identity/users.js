/**
 * /api/identity/users
 *
 * GET  → list all users in the same Client as the signed-in user, with permissions
 * POST → invite a new user. Creates an 'invited' User row, an Invite token,
 *        the requested product permissions (active immediately on the invited
 *        user row), and emails the recipient a one-time link to set their
 *        own password.
 *
 * Auth: widget_suite owner or admin.
 *
 * Roles for new staff: admin or member only. Owner role cannot be invited —
 * that constraint is inherited from the existing /api/auth/invite/send
 * endpoint and reflects the platform model (owners are created at signup
 * or transferred).
 */

import {
  requireAuth,
  requireProductAccess,
} from '../_lib/auth/middleware.js';
import {
  setCors, requireMethod, parseJson, jsonOk, jsonError,
  getRequestIp, getUserAgent, isValidEmail, normaliseEmail
} from '../_lib/auth/http.js';
import {
  listAllRecords,
  findOneByField,
  createRecord,
  getRecord,
} from '../_lib/auth/airtable.js';
import {
  USERS,
  CLIENTS,
  PERMISSIONS,
  PRODUCTS,
  INVITES,
  AUTH_EVENTS,
} from '../_lib/auth/schema.js';
import { generateSecureToken, hashToken } from '../_lib/auth/crypto.js';
import { sendInviteEmail } from '../_lib/auth/email.js';
import { logAuthEvent } from '../_lib/auth/audit.js';
import { limiters } from '../_lib/auth/ratelimit.js';
import { invalidateUserPermissions } from '../_lib/auth/permissions.js';

const INVITE_LIFETIME_DAYS = 7;
const ALLOWED_NEW_USER_ROLES = [USERS.roles.ADMIN, USERS.roles.MEMBER];

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

  if (req.method === 'GET')  return handleList(req, res, ctx);
  if (req.method === 'POST') return handleInvite(req, res, ctx);

  return jsonError(res, 405, 'method_not_allowed', 'GET or POST only');
}

// ---------------------------------------------------------------------------
// GET — list users in the same Client as the requester, with their perms
// ---------------------------------------------------------------------------
async function handleList(req, res, ctx) {
  try {
    const clientId = ctx.clientRecordId;

    const [allUsers, allPermissions, allProducts] = await Promise.all([
      listAllRecords(USERS.tableId),
      listAllRecords(PERMISSIONS.tableId),
      listAllRecords(PRODUCTS.tableId),
    ]);

    const productByRecordId = new Map();
    for (const p of allProducts) {
      productByRecordId.set(p.id, {
        slug: p.fields[PRODUCTS.fields.productId] || '',
        displayName: p.fields[PRODUCTS.fields.displayName] || p.fields[PRODUCTS.fields.productId] || '',
      });
    }

    const permsByUserId = new Map();
    for (const perm of allPermissions) {
      const f = perm.fields;
      const userLinks = f[PERMISSIONS.fields.user] || [];
      const productLinks = f[PERMISSIONS.fields.product] || [];
      const product = productLinks[0] ? productByRecordId.get(productLinks[0]) : null;
      if (!product) continue;
      for (const uid of userLinks) {
        if (!permsByUserId.has(uid)) permsByUserId.set(uid, []);
        permsByUserId.get(uid).push({
          permissionId: perm.id,
          productSlug: product.slug,
          productName: product.displayName,
          role: f[PERMISSIONS.fields.role] || 'member',
          status: f[PERMISSIONS.fields.status] || PERMISSIONS.statuses.ACTIVE,
          expiresAt: f[PERMISSIONS.fields.expiresAt] || null,
        });
      }
    }

    const users = allUsers
      .filter((u) => (u.fields[USERS.fields.client] || []).includes(clientId))
      .map((u) => {
        const f = u.fields;
        return {
          recordId: u.id,
          email: f[USERS.fields.email] || '',
          fullName: f[USERS.fields.fullName] || '',
          role: f[USERS.fields.role] || 'member',
          status: f[USERS.fields.status] || USERS.statuses.ACTIVE,
          lastLogin: f[USERS.fields.lastLogin] || null,
          createdAt: f[USERS.fields.created] || u.createdTime || null,
          permissions: permsByUserId.get(u.id) || [],
          isMe: u.id === ctx.userRecordId,
        };
      })
      .sort((a, b) => {
        // Active first, then invited, then suspended
        const order = { active: 0, invited: 1, suspended: 2 };
        if (order[a.status] !== order[b.status]) {
          return (order[a.status] ?? 99) - (order[b.status] ?? 99);
        }
        return (a.fullName || a.email || '').localeCompare(b.fullName || b.email || '');
      });

    // Full product catalogue from Control (active products only), so the staff
    // admin UI can offer EVERY product for allocation rather than a hardcoded
    // list that silently drifts out of sync with Control. widget_suite first,
    // then alphabetical — same order the launchpad uses.
    const products = allProducts
      .filter((p) => (p.fields[PRODUCTS.fields.status] || '') === PRODUCTS.statuses.ACTIVE)
      .map((p) => ({
        slug: p.fields[PRODUCTS.fields.productId] || '',
        name: p.fields[PRODUCTS.fields.displayName] || p.fields[PRODUCTS.fields.productId] || '',
      }))
      .filter((p) => p.slug)
      .sort((a, b) => {
        if (a.slug === PRODUCTS.slugs.WIDGET_SUITE) return -1;
        if (b.slug === PRODUCTS.slugs.WIDGET_SUITE) return 1;
        return a.name.localeCompare(b.name);
      });

    return res.status(200).json({ ok: true, users, products });
  } catch (err) {
    console.error('[identity/users GET]', err);
    return jsonError(res, 500, 'list_failed', 'Failed to load users');
  }
}

// ---------------------------------------------------------------------------
// POST — invite a new user, grant them product permissions
// ---------------------------------------------------------------------------
async function handleInvite(req, res, ctx) {
  const body = await parseJson(req);
  if (!body) return jsonError(res, 400, 'bad_json', 'Invalid JSON body');

  const email = normaliseEmail(body.email);
  const newUserRole = String(body.role || USERS.roles.ADMIN).toLowerCase();
  const productSlugs = Array.isArray(body.productSlugs) ? body.productSlugs.map(String) : [];
  const ip = getRequestIp(req);
  const ua = getUserAgent(req);

  if (!isValidEmail(email)) {
    return jsonError(res, 400, 'invalid_email', 'Enter a valid email address');
  }
  if (!ALLOWED_NEW_USER_ROLES.includes(newUserRole)) {
    return jsonError(res, 400, 'invalid_role', 'Role must be admin or member');
  }
  if (productSlugs.length === 0) {
    return jsonError(res, 400, 'no_products', 'Select at least one product');
  }

  // Rate limit per inviter to prevent abuse
  const rl = await limiters.inviteSend({ key: ctx.userRecordId });
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retryAfterSeconds));
    return jsonError(res, 429, 'rate_limit', 'Too many invites. Try again later.');
  }

  // Don't allow inviting someone who already has a User
  const existing = await findOneByField(USERS.tableId, USERS.fields.email, email);
  if (existing) {
    const existingClient = (existing.fields[USERS.fields.client] || [])[0];
    if (existingClient === ctx.clientRecordId) {
      return jsonError(res, 409, 'already_member', 'That email is already a member of your account');
    }
    return jsonError(res, 409, 'email_taken', 'That email already has an account elsewhere');
  }

  try {
    // Resolve product slugs → product records
    const allProducts = await listAllRecords(PRODUCTS.tableId);
    const slugToProduct = new Map();
    for (const p of allProducts) {
      const slug = p.fields[PRODUCTS.fields.productId];
      if (slug) slugToProduct.set(slug, {
        id: p.id,
        name: p.fields[PRODUCTS.fields.displayName] || slug,
      });
    }
    const resolvedProducts = [];
    for (const slug of productSlugs) {
      const match = slugToProduct.get(slug);
      if (!match) return jsonError(res, 400, 'unknown_product', `Unknown product: ${slug}`);
      resolvedProducts.push({ slug, recordId: match.id, name: match.name });
    }

    // Look up client name for the email
    let clientName = '';
    try {
      const c = await getRecord(CLIENTS.tableId, ctx.clientRecordId);
      clientName = c.fields[CLIENTS.fields.clientName] || '';
    } catch {}

    // 1. Create the 'invited' User row
    const userRec = await createRecord(USERS.tableId, {
      [USERS.fields.email]:       email,
      [USERS.fields.client]:      [ctx.clientRecordId],
      [USERS.fields.role]:        newUserRole,
      [USERS.fields.status]:      USERS.statuses.INVITED,
      [USERS.fields.authMethods]: [],
      [USERS.fields.created]:     new Date().toISOString(),
      [USERS.fields.notes]:       `Invited via Identity Console by ${ctx.email} on ${new Date().toISOString().slice(0, 10)}`,
    });

    // 2. Create the Invite token row
    const rawToken = generateSecureToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + INVITE_LIFETIME_DAYS * 24 * 60 * 60 * 1000);

    await createRecord(INVITES.tableId, {
      [INVITES.fields.tokenHash]: tokenHash,
      [INVITES.fields.email]:     email,
      [INVITES.fields.client]:    [ctx.clientRecordId],
      [INVITES.fields.invitedBy]: [ctx.userRecordId],
      [INVITES.fields.role]:      newUserRole,
      [INVITES.fields.status]:    INVITES.statuses.PENDING,
      [INVITES.fields.expiresAt]: expiresAt.toISOString(),
      [INVITES.fields.created]:   new Date().toISOString(),
    });

    // 3. Create the permission rows (one per product). These are active
    //    immediately and linked to the invited user, so when they accept
    //    they already have the right access.
    const createdPerms = [];
    for (const product of resolvedProducts) {
      const perm = await createRecord(PERMISSIONS.tableId, {
        [PERMISSIONS.fields.user]:      [userRec.id],
        [PERMISSIONS.fields.product]:   [product.recordId],
        [PERMISSIONS.fields.role]:      newUserRole,
        [PERMISSIONS.fields.status]:    PERMISSIONS.statuses.ACTIVE,
        [PERMISSIONS.fields.grantedBy]: [ctx.userRecordId],
        [PERMISSIONS.fields.granted]:   new Date().toISOString(),
      });
      createdPerms.push(perm);
    }
    invalidateUserPermissions(userRec.id);

    // 4. Send the invite email
    let emailResult = { sent: false, reason: 'unknown' };
    try {
      await sendInviteEmail({
        to: email,
        inviteToken: rawToken,
        inviterName: ctx.fullName || ctx.email,
        clientName,
        role: newUserRole,
      });
      emailResult = { sent: true };
    } catch (err) {
      console.error('[identity/users POST] sendInviteEmail failed:', err.message);
      emailResult = { sent: false, reason: 'Email send failed (see server logs)' };
      // Don't roll back — admin can use "Resend invite" action
    }

    // 5. Log the auth event
    await logAuthEvent({
      type: AUTH_EVENTS.types.INVITE_SENT,
      success: true,
      userRecordId: ctx.userRecordId,
      clientRecordId: ctx.clientRecordId,
      emailAttempted: email,
      ip, userAgent: ua,
      detail: {
        role: newUserRole,
        invitedUserRecordId: userRec.id,
        products: resolvedProducts.map((p) => p.slug),
        source: 'identity_console',
      },
    });

    return res.status(201).json({
      ok: true,
      user: {
        recordId: userRec.id,
        email,
        role: newUserRole,
        status: USERS.statuses.INVITED,
      },
      permissions: createdPerms.map((r) => ({ permissionId: r.id })),
      productNames: resolvedProducts.map((p) => p.name),
      email: emailResult,
    });
  } catch (err) {
    console.error('[identity/users POST]', err);
    return jsonError(res, 500, 'invite_failed', err.message || 'Failed to send invite');
  }
}
