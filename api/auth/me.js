/**
 * GET /api/auth/me
 *
 * Returns the current user, their client, and their resolved permissions.
 * Used by:
 *   - Product front-ends on load to confirm the session and gate UI
 *   - Identity Console to refresh after a permission change
 *   - Client home page (/home.html) to render company header + product tiles
 *
 * Accepts auth via either Authorization: Bearer header OR the
 * tg_session cookie (set on .travelify.io for cross-subdomain SSO).
 */

import { setCors, requireMethod, jsonOk } from '../_lib/auth/http.js';
import { requireAuth, loadClientForCtx } from '../_lib/auth/middleware.js';
import { getRecord, listAllRecords } from '../_lib/auth/airtable.js';
import {
  USERS, CLIENTS, PACKAGES, PRODUCTS, CATALOGUE, CLIENT_ENTITLEMENTS,
} from '../_lib/auth/schema.js';

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

  // Base client info (existing behaviour)
  const client = await loadClientForCtx(ctx);

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
  // Per-widget catalogue codes the client is entitled to (enabled). Drives the
  // widget dashboard's show-and-tag lock so it mirrors Control exactly.
  let entitledWidgetCodes = [];

  try {
    if (ctx.userRecordId) {
      const userRec = await getRecord(USERS.tableId, ctx.userRecordId);
      lastLogin = userRec.fields[USERS.fields.lastLogin] || null;
    }
  } catch {}

  if (client && client.recordId) {
    try {
      const clientRec = await getRecord(CLIENTS.tableId, client.recordId);
      clientCreatedAt = clientRec.fields[CLIENTS.fields.createdAt] || null;
      const pkgLinks = clientRec.fields[CLIENTS.fields.package] || [];
      if (pkgLinks.length > 0) {
        const pkgRec = await getRecord(PACKAGES.tableId, pkgLinks[0]).catch(() => null);
        if (pkgRec) {
          packageName = pkgRec.fields[PACKAGES.fields.packageName] || '';
          packageCode = pkgRec.fields[PACKAGES.fields.packageCode] || '';
        }
      }

      // Compute accessibleProducts = permissions ∩ client entitlements
      const [catalogue, products, entitlements] = await Promise.all([
        listAllRecords(CATALOGUE.tableId),
        listAllRecords(PRODUCTS.tableId),
        listAllRecords(CLIENT_ENTITLEMENTS.tableId),
      ]);

      // Map productRecordId → { slug, name } for friendly rendering
      const productInfoByRecordId = new Map();
      const productInfoBySlug = new Map();
      for (const p of products) {
        const slug = p.fields[PRODUCTS.fields.productId];
        const name = p.fields[PRODUCTS.fields.displayName] || slug || '';
        if (slug) {
          const info = { slug, name };
          productInfoByRecordId.set(p.id, info);
          productInfoBySlug.set(slug, info);
        }
      }

      // Map catalogueId → product slug, and catalogueId → product code
      const slugByCatalogueId = new Map();
      const codeByCatalogueId = new Map();
      for (const c of catalogue) {
        const slug = c.fields[CATALOGUE.fields.productSlug];
        if (slug) slugByCatalogueId.set(c.id, slug);
        const code = c.fields[CATALOGUE.fields.productCode];
        if (code) codeByCatalogueId.set(c.id, code);
      }

      // Slugs (product-level) and codes (per-widget) the client is entitled to
      const entitledSlugs = new Set();
      const entitledCodes = new Set();
      for (const ent of entitlements) {
        const linked = ent.fields[CLIENT_ENTITLEMENTS.fields.client] || [];
        if (!linked.includes(client.recordId)) continue;
        if (!ent.fields[CLIENT_ENTITLEMENTS.fields.enabled]) continue;
        const cats = ent.fields[CLIENT_ENTITLEMENTS.fields.catalogueItem] || [];
        for (const cId of cats) {
          const slug = slugByCatalogueId.get(cId);
          if (slug) entitledSlugs.add(slug);
          const code = codeByCatalogueId.get(cId);
          if (code) entitledCodes.add(code);
        }
      }
      entitledWidgetCodes = [...entitledCodes];

      // Intersect with the user's permissions
      const seen = new Set();
      for (const perm of (ctx.permissions || [])) {
        if (!entitledSlugs.has(perm.product)) continue;
        if (seen.has(perm.product)) continue;
        seen.add(perm.product);
        const info = productInfoBySlug.get(perm.product);
        accessibleProducts.push({
          slug: perm.product,
          name: info ? info.name : perm.product,
          role: perm.role,
        });
      }
    } catch (err) {
      console.error('[auth/me] accessibleProducts compute failed:', err.message);
    }
  }

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
    permissions: (ctx.permissions || []).map(p => ({
      product: p.product,
      role: p.role,
      expiresAt: p.expiresAt || null
    })),
    accessibleProducts,
    entitledWidgetCodes,
  });
}
