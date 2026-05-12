/**
 * POST /api/admin/clients/invite-user
 *
 * Cross-tenant admin action: invite a user into a specific client (not
 * necessarily the caller's own client). Used from the Travelgenix Control
 * Client Detail page → Users tab → Add User button.
 *
 * Body:
 *   {
 *     clientId:     'recXXX',         // target client record id
 *     email:        'jane@…',          // invitee
 *     fullName?:    'Jane Smith',     // optional, seeds the User row
 *     role:         'owner' | 'admin' | 'member',
 *     productSlugs: ['widget_suite', 'luna_chat', ...]
 *   }
 *
 * Returns: { ok: true, userRecordId, inviteRecordId, productNames }
 *
 * Security:
 *   - Caller must be widget_suite owner or admin (Travelgenix-internal admin)
 *   - Target client must exist
 *   - Reuses sendAdminInvite() helper which:
 *     · Refuses if email already has an account elsewhere
 *     · Returns alreadyMember:true if already a member of the target client
 *     · Creates User row + Invite token + emails the recipient
 *   - Creates active permission rows for each chosen product
 *   - Rate limited per admin (inviteSend bucket: 30/hour)
 *   - Logs INVITE_SENT auth event with targetClientRecordId
 */

import { requireAuth, requireProductAccess } from '../../_lib/auth/middleware.js';
import {
  setCors, requireMethod, parseJson, jsonOk, jsonError,
  getRequestIp, getUserAgent, isValidEmail, normaliseEmail
} from '../../_lib/auth/http.js';
import { limiters } from '../../_lib/auth/ratelimit.js';
import {
  getRecord, listAllRecords, createRecord,
} from '../../_lib/auth/airtable.js';
import {
  USERS, CLIENTS, PERMISSIONS, PRODUCTS, AUTH_EVENTS,
} from '../../_lib/auth/schema.js';
import { sendAdminInvite } from '../_helpers/invite.js';
import { invalidateUserPermissions } from '../../_lib/auth/permissions.js';
import { logAuthEvent } from '../../_lib/auth/audit.js';

const REC_ID_RE = /^rec[A-Za-z0-9]{14}$/;
const ALLOWED_ROLES = [USERS.roles.OWNER, USERS.roles.ADMIN, USERS.roles.MEMBER];

export default async function handler(req, res) {
  if (setCors(req, res)) return;
  if (!requireMethod(req, res, 'POST')) return;

  const ctx = await requireAuth(req, res);
  if (!ctx) return;

  const role = requireProductAccess(
    ctx,
    PRODUCTS.slugs.WIDGET_SUITE,
    [PERMISSIONS.roles.OWNER, PERMISSIONS.roles.ADMIN],
    res
  );
  if (!role) return;

  const body = await parseJson(req);
  if (!body) return jsonError(res, 400, 'bad_json', 'Invalid JSON body');

  const clientId = String(body.clientId || '').trim();
  const email = normaliseEmail(body.email);
  const fullName = String(body.fullName || '').trim();
  const newUserRole = String(body.role || '').toLowerCase();
  const productSlugs = Array.isArray(body.productSlugs) ? body.productSlugs.map(String) : [];
  const ip = getRequestIp(req);
  const ua = getUserAgent(req);

  if (!REC_ID_RE.test(clientId)) {
    return jsonError(res, 400, 'invalid_client_id', 'clientId is required and must be a valid record id');
  }
  if (!isValidEmail(email)) {
    return jsonError(res, 400, 'invalid_email', 'Enter a valid email address');
  }
  if (fullName && (fullName.length < 2 || fullName.length > 100)) {
    return jsonError(res, 400, 'invalid_name', 'Full name must be 2–100 characters');
  }
  if (!ALLOWED_ROLES.includes(newUserRole)) {
    return jsonError(res, 400, 'invalid_role', 'Role must be owner, admin, or member');
  }
  if (productSlugs.length === 0) {
    return jsonError(res, 400, 'no_products', 'Select at least one product');
  }

  // Rate limit per inviter
  const rl = await limiters.inviteSend({ key: ctx.userRecordId });
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retryAfterSeconds));
    return jsonError(res, 429, 'rate_limit', 'Too many invites. Try again later.');
  }

  // Verify the target client exists
  let targetClient;
  try {
    targetClient = await getRecord(CLIENTS.tableId, clientId);
  } catch (err) {
    if (err?.status === 404) {
      return jsonError(res, 404, 'client_not_found', 'No client with that id');
    }
    console.error('[admin/clients/invite-user] client lookup failed:', err);
    return jsonError(res, 500, 'lookup_failed', 'Could not load target client');
  }

  try {
    // Resolve product slugs → product records up-front so we fail fast on bad input
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

    // Create the invite via the shared helper (creates User + Invite + sends email)
    const inviteResult = await sendAdminInvite({
      email,
      fullName,
      role: newUserRole,
      targetClientRecordId: clientId,
      invitedByUserRecordId: ctx.userRecordId,
      inviterName: ctx.fullName || ctx.email,
    });

    // If they were already a member of this client, no permission changes needed.
    if (inviteResult.alreadyMember) {
      return jsonOk(res, {
        alreadyMember: true,
        userRecordId: inviteResult.userRecordId,
      });
    }

    // Create active permission rows for the new user
    const createdPerms = [];
    for (const product of resolvedProducts) {
      const perm = await createRecord(PERMISSIONS.tableId, {
        [PERMISSIONS.fields.user]:      [inviteResult.userRecordId],
        [PERMISSIONS.fields.product]:   [product.recordId],
        [PERMISSIONS.fields.role]:      newUserRole,
        [PERMISSIONS.fields.status]:    PERMISSIONS.statuses.ACTIVE,
        [PERMISSIONS.fields.grantedBy]: [ctx.userRecordId],
        [PERMISSIONS.fields.granted]:   new Date().toISOString(),
      });
      createdPerms.push(perm);
    }
    invalidateUserPermissions(inviteResult.userRecordId);

    await logAuthEvent({
      type: AUTH_EVENTS.types.INVITE_SENT,
      success: true,
      userRecordId: ctx.userRecordId,
      clientRecordId: ctx.clientRecordId,
      emailAttempted: email,
      ip, userAgent: ua,
      detail: {
        role: newUserRole,
        invitedUserRecordId: inviteResult.userRecordId,
        targetClientRecordId: clientId,
        products: resolvedProducts.map((p) => p.slug),
        source: 'admin_client_detail',
      },
    }).catch(() => {});

    return res.status(201).json({
      ok: true,
      userRecordId: inviteResult.userRecordId,
      inviteRecordId: inviteResult.inviteRecordId,
      productNames: resolvedProducts.map((p) => p.name),
    });
  } catch (err) {
    if (err.code === 'email_taken') {
      return jsonError(res, 409, 'email_taken', err.message);
    }
    console.error('[admin/clients/invite-user] error:', err);
    return jsonError(res, 500, 'invite_failed', 'Failed to send invite');
  }
}
