/**
 * GET /api/dashboard/me-products
 *
 * Returns the list of products the signed-in user has access to, for use by
 * the dashboard launchpad page. Reads from the unified Permissions table.
 *
 * Each product comes with its display name, description, the user's role
 * on that product, and the URL to open it. Inactive products and inactive
 * permissions are filtered out.
 *
 * Response:
 *   {
 *     user: { email, fullName, clientName },
 *     products: [
 *       {
 *         slug, name, description, role, url, statusBadge?
 *       }
 *     ]
 *   }
 *
 * Auth: any signed-in user.
 */

import { requireAuth } from '../_lib/auth/middleware.js';
import { listAllRecords, getRecord } from '../_lib/auth/airtable.js';
import { jsonError } from '../_lib/auth/http.js';
import {
  PRODUCTS,
  PERMISSIONS,
  CLIENTS,
  USERS,
} from '../_lib/auth/schema.js';

// Where each product lives. When the user clicks a tile, we send them here.
//
// widget_suite → / (the existing widgets dashboard at the root URL)
// luna_chat, luna_marketing, etc → placeholder paths that 404 until those
//   apps get migrated onto the unified auth (Priorities 4 and 5)
// tool_hub → /admin/ (the TG Control admin console for Travelgenix staff)
const PRODUCT_URLS = {
  [PRODUCTS.slugs.WIDGET_SUITE]:   '/',
  [PRODUCTS.slugs.LUNA_CHAT]:      '/dashboard/luna-chat',
  [PRODUCTS.slugs.LUNA_MARKETING]: '/dashboard/luna-marketing',
  [PRODUCTS.slugs.LUNA_BRAIN]:     '/dashboard/luna-brain',
  [PRODUCTS.slugs.LUNA_TRENDS]:    '/dashboard/luna-trends',
  [PRODUCTS.slugs.LUNA_QA]:        '/dashboard/luna-qa',
  [PRODUCTS.slugs.TOOL_HUB]:       '/admin/',
};

// Friendly labels for each role, shown on the tile
const ROLE_LABELS = {
  owner:        'Owner',
  admin:        'Admin',
  client_owner: 'Owner',
  client_user:  'User',
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
    // ctx already has a list of permissions but we need the full Product
    // records for each. Fetch products + permissions for this user in
    // parallel so we get current data.
    const [allProducts, allPermissions] = await Promise.all([
      listAllRecords(PRODUCTS.tableId),
      listAllRecords(PERMISSIONS.tableId),
    ]);

    // Filter permissions to those for this user, with active status
    const myPermissions = allPermissions.filter((p) => {
      const userIds = p.fields[PERMISSIONS.fields.user] || [];
      const status = p.fields[PERMISSIONS.fields.status];
      return userIds.includes(ctx.userRecordId) && status === PERMISSIONS.statuses.ACTIVE;
    });

    // Build map: productId → { slug, name, description, status }
    const productById = new Map();
    for (const p of allProducts) {
      productById.set(p.id, {
        recordId: p.id,
        slug: p.fields[PRODUCTS.fields.productId] || '',
        name: p.fields[PRODUCTS.fields.displayName] || '',
        description: p.fields[PRODUCTS.fields.description] || '',
        status: p.fields[PRODUCTS.fields.status] || '',
      });
    }

    // Build the response list — one entry per permission, filtered for active
    // products only. Deduplicate on product slug (in case the same user has
    // multiple permission rows for the same product, take the highest role).
    const seenSlugs = new Map();
    for (const perm of myPermissions) {
      const productIds = perm.fields[PERMISSIONS.fields.product] || [];
      for (const productId of productIds) {
        const product = productById.get(productId);
        if (!product) continue;
        if (product.status !== PRODUCTS.statuses.ACTIVE) continue;

        const role = perm.fields[PERMISSIONS.fields.role] || '';
        const existing = seenSlugs.get(product.slug);

        // If we already have a permission for this slug, keep the existing
        // entry — first-seen wins for now, can be enhanced later.
        if (!existing) {
          seenSlugs.set(product.slug, {
            slug: product.slug,
            name: product.name,
            description: product.description,
            role,
            roleLabel: ROLE_LABELS[role] || role,
            url: PRODUCT_URLS[product.slug] || '/',
          });
        }
      }
    }

    // Sort: widget_suite first (most common entry point), then alphabetically
    const products = Array.from(seenSlugs.values()).sort((a, b) => {
      if (a.slug === PRODUCTS.slugs.WIDGET_SUITE) return -1;
      if (b.slug === PRODUCTS.slugs.WIDGET_SUITE) return 1;
      return a.name.localeCompare(b.name);
    });

    // Lookup the client name for the signed-in user (for the page header)
    let clientName = '';
    if (ctx.clientRecordId) {
      try {
        const c = await getRecord(CLIENTS.tableId, ctx.clientRecordId);
        clientName = c.fields[CLIENTS.fields.clientName] || '';
      } catch {}
    }

    return res.status(200).json({
      user: {
        email: ctx.email || '',
        fullName: ctx.fullName || '',
        clientName,
      },
      products,
    });
  } catch (err) {
    console.error('[dashboard/me-products] error:', err);
    return jsonError(res, 500, 'internal_error', 'Failed to load your products');
  }
}
