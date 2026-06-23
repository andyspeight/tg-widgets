/**
 * GET /api/auth/me
 *
 * Returns the current user, their client, and their resolved permissions.
 * Used by:
 *   - Product front-ends on load to confirm the session and gate UI
 *   - Identity Console to refresh after a permission change
 *   - Client home page (/home.html) to render company header + product tiles
 *   - Widget Suite dashboard to show-and-tag widgets by entitlement
 *
 * Accepts auth via either Authorization: Bearer header OR the
 * tg_session cookie (set on .travelify.io for cross-subdomain SSO).
 */

import { setCors, requireMethod, jsonOk } from '../_lib/auth/http.js';
import { requireAuth, loadClientForCtx } from '../_lib/auth/middleware.js';
import { getRecord, listAllRecords } from '../_lib/auth/airtable.js';
import {
  USERS, CLIENTS, PACKAGES, PRODUCTS, CATALOGUE, CLIENT_ENTITLEMENTS, PACKAGE_CATALOGUE,
} from '../_lib/auth/schema.js';
import { isStaffEmail } from '../_lib/auth/staff.js';

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

  // Widget-level entitlement codes for the Widget Suite dashboard show-and-tag:
  //   entitledWidgetCodes — productCodes of this client's ENABLED entitlements
  //   activeWidgetCodes    — productCodes of every ACTIVE catalogue item
  // The dashboard locks only ACTIVE catalogue widgets the client lacks.
  let entitledWidgetCodes = [];
  let activeWidgetCodes = [];

  let userRec = null;
  try {
    if (ctx.userRecordId) {
      userRec = await getRecord(USERS.tableId, ctx.userRecordId);
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
      const [catalogue, products, entitlements, packageCatalogue] = await Promise.all([
        listAllRecords(CATALOGUE.tableId),
        listAllRecords(PRODUCTS.tableId),
        listAllRecords(CLIENT_ENTITLEMENTS.tableId),
        listAllRecords(PACKAGE_CATALOGUE.tableId),
      ]);

      // Product slug → { slug, name }, and the set of ACTIVE product slugs.
      const productInfoBySlug = new Map();
      const activeSlugs = new Set();
      for (const p of products) {
        const slug = p.fields[PRODUCTS.fields.productId];
        if (!slug) continue;
        const name = p.fields[PRODUCTS.fields.displayName] || slug;
        productInfoBySlug.set(slug, { slug, name });
        if (p.fields[PRODUCTS.fields.status] === 'active') activeSlugs.add(slug);
      }

      // Map catalogueId → product slug (the Control → launchpad bridge).
      // Skip INACTIVE catalogue items. A client can carry a stale enabled
      // entitlement row for a product that was later switched off in the
      // catalogue (package-seeded at onboarding, then deactivated). Those must
      // not surface as launchpad tiles. The Catalogue tab's Active flag is the
      // single gate, and the Entitlements tab already honours it (get.js).
      // We also capture productCode here for the widget dashboard show-and-tag,
      // and the full set of ACTIVE codes.
      const slugByCatalogueId = new Map();
      const codeByCatalogueId = new Map();
      const activeCodeSet = new Set();
      for (const c of catalogue) {
        if (!c.fields[CATALOGUE.fields.active]) continue;
        const ps = c.fields[CATALOGUE.fields.productSlug];
        const slug = typeof ps === 'string' ? ps : (ps && ps.name) || '';
        if (slug) slugByCatalogueId.set(c.id, slug);
        const code = c.fields[CATALOGUE.fields.productCode];
        if (code) {
          codeByCatalogueId.set(c.id, code);
          activeCodeSet.add(code);
        }
      }

      // Slugs the client is currently entitled to. Control is the source of truth.
      // We accumulate entitled productCodes in the same pass.
      const entitledSlugs = new Set();
      const entitledCodeSet = new Set();
      for (const ent of entitlements) {
        const linked = ent.fields[CLIENT_ENTITLEMENTS.fields.client] || [];
        if (!linked.includes(client.recordId)) continue;
        if (!ent.fields[CLIENT_ENTITLEMENTS.fields.enabled]) continue;
        const cats = ent.fields[CLIENT_ENTITLEMENTS.fields.catalogueItem] || [];
        for (const cId of cats) {
          const slug = slugByCatalogueId.get(cId);
          if (slug) entitledSlugs.add(slug);
          const code = codeByCatalogueId.get(cId);
          if (code) entitledCodeSet.add(code);
        }
      }

      // Widget create-access follows the client's PLAN via the Package
      // Catalogue (the catalogue toggles), so Control is the single source of
      // truth and staff can change it live. A widget is available when the
      // client's package includes it (includedByDefault) and the catalogue
      // item is active. Staff get every active widget — full access, including
      // while acting as a client. On any error we fall back to the client's own
      // entitlement rows so a hiccup never strips access.
      activeWidgetCodes = Array.from(activeCodeSet);
      if (isStaffEmail(ctx.email || '')) {
        entitledWidgetCodes = Array.from(activeCodeSet);
      } else {
        try {
          const clientPkgId = (clientRec.fields[CLIENTS.fields.package] || [])[0] || null;
          if (clientPkgId) {
            const planCodes = new Set();
            for (const row of packageCatalogue) {
              if (!row.fields[PACKAGE_CATALOGUE.fields.includedByDefault]) continue;
              const pkgs = row.fields[PACKAGE_CATALOGUE.fields.package] || [];
              if (!pkgs.includes(clientPkgId)) continue;
              for (const cId of (row.fields[PACKAGE_CATALOGUE.fields.catalogueItem] || [])) {
                const code = codeByCatalogueId.get(cId); // active items only
                if (code) planCodes.add(code);
              }
            }
            entitledWidgetCodes = Array.from(planCodes);
          } else {
            entitledWidgetCodes = Array.from(entitledCodeSet);
          }
        } catch (e) {
          console.error('[auth/me] plan widget codes failed, using entitlements:', e.message);
          entitledWidgetCodes = Array.from(entitledCodeSet);
        }
      }

      // Travelgenix staff in their OWN account see every active product. Staff
      // ACTING AS a client (the active client is not one of their linked
      // clients) and ordinary client users both see the client's entitled
      // products, so the launchpad mirrors Control exactly. This replaces the
      // old permission ∩ entitlement intersection, which gated the launchpad
      // on the signed-in user's own permissions and so never matched Control.
      const linkedClientIds = (userRec?.fields?.[USERS.fields.client] || [])
        .map((x) => (typeof x === 'string' ? x : x && x.id))
        .filter(Boolean);
      const staff = isStaffEmail(ctx.email || '');
      const impersonating = !linkedClientIds.includes(client.recordId);

      let launchSlugs;
      if (staff && !impersonating) {
        launchSlugs = Array.from(activeSlugs);
      } else if (entitledSlugs.size > 0) {
        launchSlugs = Array.from(entitledSlugs).filter((s) => productInfoBySlug.has(s));
      } else {
        // Safety net: this client has no entitlements seeded yet. Fall back to
        // the user's permission products so the launchpad is not blank while
        // the client is being set up in Control.
        launchSlugs = (ctx.permissions || []).map((p) => p.product);
      }

      const seen = new Set();
      for (const slug of launchSlugs) {
        if (!slug || seen.has(slug)) continue;
        seen.add(slug);
        const info = productInfoBySlug.get(slug);
        accessibleProducts.push({
          slug,
          name: info ? info.name : slug,
          role: ctx.role || 'member',
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
    activeWidgetCodes,
  });
}
