/**
 * GET /api/dashboard/me-products
 *
 * Returns the list of products the signed-in user should see on the
 * id.travelify.io launchpad.
 *
 * SOURCE OF TRUTH: TG Control.
 *
 * The launchpad is now driven by the client's entitlements (the Catalogue +
 * Client Entitlements tables that Control reads and writes), NOT by per-user
 * Permissions rows. Whatever a client has switched on in Control is exactly
 * what their people see when they sign in. This is the wiring that the
 * Catalogue.productSlug bridge field (added 7 May 2026) was always meant to
 * enable but never had connected.
 *
 * Resolution:
 *   1. Travelgenix staff in their OWN account see every active product
 *      (full internal view, including staff-only tools like TG Control).
 *   2. Travelgenix staff ACTING AS a client see exactly that client's
 *      entitlement-derived tiles, so the act-as switcher doubles as a true
 *      preview of what the client sees.
 *   3. A normal client user sees the tiles their client is entitled to:
 *      every enabled Client Entitlement, mapped through Catalogue.productSlug
 *      to a launchpad product.
 *
 * SAFETY NET: if a client has no enabled entitlements yet (e.g. an older
 * client onboarded before the catalogue model, whose entitlement rows were
 * never seeded), we fall back to the legacy per-user Permissions tiles so
 * nobody is left staring at an empty launchpad mid-migration. When that
 * fallback fires we log it, so we can see which clients still need their
 * entitlements seeded in Control.
 *
 * Response:
 *   {
 *     user: { email, fullName, clientName },
 *     products: [ { slug, name, description, role, roleLabel, url, staff } ]
 *   }
 *
 * Auth: any signed-in user.
 */

import { requireAuth } from '../_lib/auth/middleware.js';
import { listAllRecords, getRecord } from '../_lib/auth/airtable.js';
import { jsonError } from '../_lib/auth/http.js';
import { isStaffEmail } from '../_lib/auth/staff.js';
import {
  PRODUCTS,
  PERMISSIONS,
  CLIENTS,
  USERS,
  CATALOGUE,
  CLIENT_ENTITLEMENTS,
} from '../_lib/auth/schema.js';

// Where each product opens. Same-domain products use relative paths; other
// Travelgenix products live on their own subdomains and need absolute URLs.
const PRODUCT_URLS = {
  [PRODUCTS.slugs.WIDGET_SUITE]:   '/',
  [PRODUCTS.slugs.LUNA_CHAT]:      'https://chat.travelify.io/dashboard.html',
  [PRODUCTS.slugs.LUNA_MARKETING]: 'https://marketing.travelify.io/client.html',
  [PRODUCTS.slugs.LUNA_BRAIN]:     'https://brain.travelify.io/',
  [PRODUCTS.slugs.LUNA_TRENDS]:    'https://trends.travelify.io/',
  [PRODUCTS.slugs.LUNA_QA]:        'https://qa.travelify.io/',
  [PRODUCTS.slugs.TOOL_HUB]:       '/admin/',
};

// Products that are Travelgenix staff only. The launchpad renders a small
// "Staff" pill on these tiles. Staff slugs gate visual treatment; the
// entitlement/permission resolution still decides who sees the tile at all.
const STAFF_SLUGS = new Set([
  PRODUCTS.slugs.TOOL_HUB,
  PRODUCTS.slugs.LUNA_QA,
]);

const ROLE_LABELS = {
  owner:        'Owner',
  admin:        'Admin',
  client_owner: 'Owner',
  client_user:  'User',
  member:       'User',
  agent:        'Agent',
  supervisor:   'Supervisor',
  viewer:       'Viewer',
};

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return jsonError(res, 405, 'method_not_allowed', 'GET only');
  }

  const ctx = await requireAuth(req, res);
  if (!ctx) return;

  try {
    const [allProducts, catalogue, entitlements, allPermissions, userRec] = await Promise.all([
      listAllRecords(PRODUCTS.tableId),
      listAllRecords(CATALOGUE.tableId),
      listAllRecords(CLIENT_ENTITLEMENTS.tableId),
      listAllRecords(PERMISSIONS.tableId),
      getRecord(USERS.tableId, ctx.userRecordId).catch(() => null),
    ]);

    // Build slug → product tile, for ACTIVE products only.
    const productBySlug = new Map();
    for (const p of allProducts) {
      const slug = p.fields[PRODUCTS.fields.productId] || '';
      const status = p.fields[PRODUCTS.fields.status] || '';
      if (!slug || status !== PRODUCTS.statuses.ACTIVE) continue;
      productBySlug.set(slug, {
        slug,
        name: p.fields[PRODUCTS.fields.displayName] || slug,
        description: p.fields[PRODUCTS.fields.description] || '',
        url: PRODUCT_URLS[slug] || '/',
        staff: STAFF_SLUGS.has(slug),
      });
    }

    // catalogueItemId → productSlug (the Control → launchpad bridge).
    const slugByCatalogueId = new Map();
    for (const c of catalogue) {
      const ps = c.fields[CATALOGUE.fields.productSlug];
      // singleSelect comes back as { name } when expanded, or a string.
      const slug = typeof ps === 'string' ? ps : (ps && ps.name) || '';
      if (slug) slugByCatalogueId.set(c.id, slug);
    }

    // Is this Travelgenix staff, and are they acting as a client that isn't
    // one of their own linked clients (impersonation / preview)?
    const email = ctx.email || (userRec?.fields?.[USERS.fields.email]) || '';
    const staff = isStaffEmail(email);
    const linkedClientIds = (userRec?.fields?.[USERS.fields.client] || [])
      .map((x) => (typeof x === 'string' ? x : x && x.id))
      .filter(Boolean);
    const impersonating =
      !!ctx.clientRecordId && !linkedClientIds.includes(ctx.clientRecordId);

    // Decide which product slugs are visible.
    let visibleSlugs;
    let resolvedFrom;

    if (staff && !impersonating) {
      // Staff in their own account: full internal view.
      visibleSlugs = new Set(productBySlug.keys());
      resolvedFrom = 'staff_all';
    } else {
      // Client view (real client user, OR staff previewing a client):
      // derive from the client's enabled entitlements.
      const enabledSlugs = new Set();
      for (const e of entitlements) {
        const clientLinks = e.fields[CLIENT_ENTITLEMENTS.fields.client] || [];
        if (!clientLinks.includes(ctx.clientRecordId)) continue;
        if (!e.fields[CLIENT_ENTITLEMENTS.fields.enabled]) continue;
        const catLinks = e.fields[CLIENT_ENTITLEMENTS.fields.catalogueItem] || [];
        for (const cid of catLinks) {
          const slug = slugByCatalogueId.get(cid);
          if (slug && productBySlug.has(slug)) enabledSlugs.add(slug);
        }
      }

      if (enabledSlugs.size > 0) {
        visibleSlugs = enabledSlugs;
        resolvedFrom = 'entitlements';
      } else {
        // SAFETY NET: no entitlements seeded for this client yet. Fall back to
        // the legacy per-user Permissions tiles so the launchpad isn't blank.
        const fallback = new Set();
        for (const perm of allPermissions) {
          const userIds = perm.fields[PERMISSIONS.fields.user] || [];
          const status = perm.fields[PERMISSIONS.fields.status];
          if (!userIds.includes(ctx.userRecordId)) continue;
          if (status !== PERMISSIONS.statuses.ACTIVE) continue;
          const productIds = perm.fields[PERMISSIONS.fields.product] || [];
          for (const pid of productIds) {
            const prodRec = allProducts.find((p) => p.id === pid);
            const slug = prodRec?.fields?.[PRODUCTS.fields.productId];
            if (slug && productBySlug.has(slug)) fallback.add(slug);
          }
        }
        visibleSlugs = fallback;
        resolvedFrom = 'permissions_fallback';
        console.warn(
          `[dashboard/me-products] no entitlements for client ${ctx.clientRecordId} ` +
          `(user ${ctx.userRecordId}) — fell back to ${fallback.size} permission tile(s). ` +
          `Seed entitlements in Control to fix.`
        );
      }
    }

    // Role label comes from the user's client role (we no longer carry a
    // per-product role in the entitlement model).
    const role = ctx.role || 'member';
    const roleLabel = ROLE_LABELS[role] || '';

    const products = Array.from(visibleSlugs)
      .map((slug) => {
        const tile = productBySlug.get(slug);
        if (!tile) return null;
        return { ...tile, role, roleLabel };
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (a.slug === PRODUCTS.slugs.WIDGET_SUITE) return -1;
        if (b.slug === PRODUCTS.slugs.WIDGET_SUITE) return 1;
        return a.name.localeCompare(b.name);
      });

    // Client name for the page header.
    let clientName = '';
    if (ctx.clientRecordId) {
      try {
        const c = await getRecord(CLIENTS.tableId, ctx.clientRecordId);
        clientName = c.fields[CLIENTS.fields.clientName] || '';
      } catch {}
    }

    return res.status(200).json({
      user: {
        email,
        fullName: ctx.fullName || '',
        clientName,
      },
      products,
      _resolvedFrom: resolvedFrom,
    });
  } catch (err) {
    console.error('[dashboard/me-products] error:', err);
    return jsonError(res, 500, 'internal_error', 'Failed to load your products');
  }
}
