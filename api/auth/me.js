/**
 * GET /api/auth/me
 *
 * Returns the current user, their client, and their resolved permissions.
 * Used by:
 *   - Product front-ends on load to confirm the session and gate UI
 *   - Identity Console to refresh after a permission change
 *   - Widget Suite dashboard to show-and-tag widgets by entitlement
 *
 * Note: the launchpad (/dashboard.html) reads /api/dashboard/me-products,
 * not this endpoint. The retired /home.html used to render its tiles here.
 *
 * Accepts auth via either Authorization: Bearer header OR the
 * tg_session cookie (set on .travelify.io for cross-subdomain SSO).
 */

import { setCors, requireMethod, jsonOk } from '../_lib/auth/http.js';
import { requireAuth } from '../_lib/auth/middleware.js';
import { getRecord } from '../_lib/auth/airtable.js';
import { cachedListAll } from '../_lib/auth/tableCache.js';
import {
  USERS, CLIENTS, PACKAGES, PRODUCTS, CATALOGUE, CLIENT_ENTITLEMENTS, PACKAGE_CATALOGUE,
} from '../_lib/auth/schema.js';
import { isStaffEmail } from '../_lib/auth/staff.js';
import { resolveEntitlements } from '../_lib/auth/entitlements.js';

// How long the warm lambda may reuse a whole-table Control read before checking
// Airtable again. The catalogue, products and package rules are the same for
// everyone and barely change; client entitlements only need to be fresh within a
// minute. This is what keeps the sign-in check off Airtable on the hot path.
const CONTROL_TTL_MS = 5 * 60 * 1000;
const ENTITLEMENTS_TTL_MS = 60 * 1000;

export default async function handler(req, res) {
  if (setCors(req, res)) return;
  if (!requireMethod(req, res, 'GET')) return;

  const ctx = await requireAuth(req, res);
  if (!ctx) return;

  // Diagnostic: log the resolved session and client on every me.js call so
  // we can trace which session a given request is hitting. This is temporary
  // — remove once the wrong-default-client bug is resolved.
  console.log('[auth/me] resolved user', ctx.userRecordId,
    'client', ctx.clientRecordId,
    'session', ctx.sessionId || '(no sessionId)',
    'sessionRec', ctx.sessionRecordId || '(no rec)',
    'role', ctx.role);

  // Base client info. One read of the client record here, reused below for the
  // created date and package instead of loading the same record a second time.
  const clientRec = ctx.clientRecordId
    ? await getRecord(CLIENTS.tableId, ctx.clientRecordId).catch(() => null)
    : null;
  const client = clientRec ? {
    recordId: clientRec.id,
    email: clientRec.fields[CLIENTS.fields.email] || '',
    clientName: clientRec.fields[CLIENTS.fields.clientName] || '',
    plan: clientRec.fields[CLIENTS.fields.plan] || '',
    status: clientRec.fields[CLIENTS.fields.status] || '',
  } : null;

  // Extras for the home page — best-effort. Failures here don't break the
  // primary contract; existing callers still get a valid response shape.
  let lastLogin = null;
  let clientCreatedAt = null;
  let packageName = '';
  let packageCode = '';

  // accessibleProducts: products this user can launch in the context of
  // their current client (intersection of their per-product permissions
  // with the client's enabled entitlements). Each entry: { slug, name, role }.
  let accessibleProducts = [];

  // Widget-level entitlement codes for the Widget Suite dashboard show-and-tag:
  //   entitledWidgetCodes — productCodes of this client's ENABLED entitlements
  //   activeWidgetCodes    — productCodes of every ACTIVE catalogue item
  // The dashboard locks only ACTIVE catalogue widgets the client lacks.
  let entitledWidgetCodes = [];
  let activeWidgetCodes = [];
  // All ACTIVE product slugs (populated below). Used to grant staff full
  // access to every product through the shared auth gate.
  let allActiveSlugs = [];

  let userRec = null;
  try {
    if (ctx.userRecordId) {
      userRec = await getRecord(USERS.tableId, ctx.userRecordId);
      lastLogin = userRec.fields[USERS.fields.lastLogin] || null;
    }
  } catch {}

  if (clientRec) {
    try {
      clientCreatedAt = clientRec.fields[CLIENTS.fields.createdAt] || null;
      const pkgLinks = clientRec.fields[CLIENTS.fields.package] || [];
      if (pkgLinks.length > 0) {
        const pkgRec = await getRecord(PACKAGES.tableId, pkgLinks[0]).catch(() => null);
        if (pkgRec) {
          packageName = pkgRec.fields[PACKAGES.fields.packageName] || '';
          packageCode = pkgRec.fields[PACKAGES.fields.packageCode] || '';
        }
      }

      // Pull the Control tables that drive entitlements and the launchpad, then
      // resolve them in one pure pass (see _lib/auth/entitlements.js). Keeping
      // the computation pure lets us smoke test it against real record shapes.
      const [catalogue, products, entitlements, packageCatalogue] = await Promise.all([
        cachedListAll(CATALOGUE.tableId, CONTROL_TTL_MS),
        cachedListAll(PRODUCTS.tableId, CONTROL_TTL_MS),
        cachedListAll(CLIENT_ENTITLEMENTS.tableId, ENTITLEMENTS_TTL_MS),
        cachedListAll(PACKAGE_CATALOGUE.tableId, CONTROL_TTL_MS),
      ]);

      // Staff in their OWN account see everything; staff acting AS a client (the
      // active client is not one of their linked clients) see the client's own
      // entitlements, so the launchpad mirrors Control exactly.
      const linkedClientIds = (userRec?.fields?.[USERS.fields.client] || [])
        .map((x) => (typeof x === 'string' ? x : x && x.id))
        .filter(Boolean);
      const staff = isStaffEmail(ctx.email || '');
      const impersonating = !linkedClientIds.includes(client.recordId);
      const clientPackageId = (clientRec.fields[CLIENTS.fields.package] || [])[0] || null;

      const resolved = resolveEntitlements({
        catalogue,
        products,
        entitlements,
        packageCatalogue,
        clientRecordId: client.recordId,
        clientPackageId,
        isStaff: staff,
        isImpersonating: impersonating,
        permissions: ctx.permissions || [],
        role: ctx.role,
      });

      entitledWidgetCodes = resolved.entitledWidgetCodes;
      activeWidgetCodes = resolved.activeWidgetCodes;
      allActiveSlugs = resolved.allActiveSlugs;
      accessibleProducts = resolved.accessibleProducts;
    } catch (err) {
      console.error('[auth/me] accessibleProducts compute failed:', err.message);
    }
  }

  // Staff (Travelgenix domains) get full access to every product. Surface that
  // as an admin permission for every ACTIVE product, so the shared auth gate
  // lets them into any tool (Contracting, TG Control, etc.) — matching the
  // launchpad, which already shows staff everything. Email-based, so it holds
  // even while acting as a client. Clients are unchanged.
  const isStaff = isStaffEmail(ctx.email || '');
  const responsePermissions = (isStaff && allActiveSlugs.length)
    ? allActiveSlugs.map((slug) => ({ product: slug, role: 'admin', expiresAt: null }))
    : (ctx.permissions || []).map((p) => ({ product: p.product, role: p.role, expiresAt: p.expiresAt || null }));

  return jsonOk(res, {
    user: {
      email: ctx.email,
      fullName: ctx.fullName,
      role: ctx.role,
      lastLogin,
    },
    client: client ? {
      ...client,
      createdAt: clientCreatedAt,
      packageName,
      packageCode,
    } : null,
    permissions: responsePermissions,
    isStaff,
    accessibleProducts,
    entitledWidgetCodes,
    activeWidgetCodes,
  });
}
