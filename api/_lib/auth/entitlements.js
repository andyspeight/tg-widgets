/**
 * Pure entitlement resolution for GET /api/auth/me.
 *
 * Control (the Airtable auth base) is the single source of truth for what a
 * client can launch and which widget-suite and contracting products they hold.
 * This turns the raw Catalogue, Products, Client Entitlements and Package
 * Catalogue rows into the launchpad + dashboard shape, with NO network calls or
 * global state, so it can be unit tested against real record shapes.
 *
 * Records are passed in exactly as Airtable returns them with
 * returnFieldsByFieldId=true: each record is { id, fields } and fields is keyed
 * by field ID (see schema.js for the IDs).
 *
 * Returns:
 *   entitledWidgetCodes — Catalogue Product Codes this client is entitled to.
 *     Widget-suite codes follow the client's PLAN (package defaults). Contracting
 *     codes (category "Contracting", e.g. contract-loader-flights) follow the
 *     client's ENABLED Client Entitlements, because contracting is granted per
 *     client not by package, so the plan pass never lists them. The Contract
 *     Loader reads this list and keeps the contract-loader-* codes, so a
 *     contracting client is only let in when their enabled entitlements show up
 *     here.
 *   activeWidgetCodes — every ACTIVE Catalogue Product Code (dashboard show-and-tag).
 *   allActiveSlugs — every ACTIVE product slug (used to grant staff full access).
 *   accessibleProducts — [{ slug, name, role }] the user can launch right now.
 */

import {
  PRODUCTS, CATALOGUE, CLIENT_ENTITLEMENTS, PACKAGE_CATALOGUE,
} from './schema.js';

// Airtable returns a singleSelect as either a plain string or a { name } object
// depending on the read path. Normalise to the option name.
function selectName(v) {
  return typeof v === 'string' ? v : (v && v.name) || '';
}

export function resolveEntitlements({
  catalogue = [],
  products = [],
  entitlements = [],
  packageCatalogue = [],
  clientRecordId,
  clientPackageId = null,
  isStaff = false,
  isImpersonating = false,
  permissions = [],
  role = 'member',
}) {
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
  const allActiveSlugs = Array.from(activeSlugs);

  // Map catalogueId → product slug / product code. ACTIVE items only: a client
  // can carry a stale enabled entitlement row for a product that was later
  // switched off in the catalogue, and those must not surface. We also capture
  // the full set of ACTIVE codes and note which active rows are contracting.
  const slugByCatalogueId = new Map();
  const codeByCatalogueId = new Map();
  const activeCodeSet = new Set();
  const contractingCatalogueIds = new Set();
  for (const c of catalogue) {
    if (!c.fields[CATALOGUE.fields.active]) continue;
    const slug = selectName(c.fields[CATALOGUE.fields.productSlug]);
    if (slug) slugByCatalogueId.set(c.id, slug);
    const code = c.fields[CATALOGUE.fields.productCode];
    if (code) {
      codeByCatalogueId.set(c.id, code);
      activeCodeSet.add(code);
    }
    if (selectName(c.fields[CATALOGUE.fields.category]) === CATALOGUE.categories.CONTRACTING) {
      contractingCatalogueIds.add(c.id);
    }
  }

  // Slugs and codes the client is currently entitled to. Control is truth.
  // We accumulate the enabled contracting codes separately so they can be folded
  // into entitledWidgetCodes regardless of the client's package plan.
  const entitledSlugs = new Set();
  const entitledCodeSet = new Set();
  const entitledContractingCodes = new Set();
  for (const ent of entitlements) {
    const linked = ent.fields[CLIENT_ENTITLEMENTS.fields.client] || [];
    if (!linked.includes(clientRecordId)) continue;
    if (!ent.fields[CLIENT_ENTITLEMENTS.fields.enabled]) continue;
    const cats = ent.fields[CLIENT_ENTITLEMENTS.fields.catalogueItem] || [];
    for (const cId of cats) {
      const slug = slugByCatalogueId.get(cId);
      if (slug) entitledSlugs.add(slug);
      const code = codeByCatalogueId.get(cId);
      if (code) {
        entitledCodeSet.add(code);
        if (contractingCatalogueIds.has(cId)) entitledContractingCodes.add(code);
      }
    }
  }

  // Widget create-access follows the client's PLAN via the Package Catalogue, so
  // Control stays the single source of truth and staff can change it live. A
  // widget is available when the client's package includes it (includedByDefault)
  // and the catalogue item is active. Staff get every active widget. On any error
  // we fall back to the client's own entitlement rows so a hiccup never strips
  // access.
  const activeWidgetCodes = Array.from(activeCodeSet);
  let widgetCodes;
  if (isStaff) {
    widgetCodes = new Set(activeCodeSet);
  } else {
    widgetCodes = new Set();
    try {
      if (clientPackageId) {
        for (const row of packageCatalogue) {
          if (!row.fields[PACKAGE_CATALOGUE.fields.includedByDefault]) continue;
          const pkgs = row.fields[PACKAGE_CATALOGUE.fields.package] || [];
          if (!pkgs.includes(clientPackageId)) continue;
          for (const cId of (row.fields[PACKAGE_CATALOGUE.fields.catalogueItem] || [])) {
            const code = codeByCatalogueId.get(cId); // active items only
            if (code) widgetCodes.add(code);
          }
        }
      } else {
        for (const code of entitledCodeSet) widgetCodes.add(code);
      }
    } catch {
      widgetCodes = new Set(entitledCodeSet);
    }
  }

  // Contracting is granted per client in Client Entitlements, not through the
  // package plan, so the plan pass above never lists it. Fold this client's
  // ENABLED contracting entitlements in so the Contract Loader lets them in with
  // exactly the engines their account has switched on. Staff already hold every
  // active code so this is a no-op for them, and a client with contracting
  // switched off gets nothing here and is still refused, exactly as intended.
  for (const code of entitledContractingCodes) widgetCodes.add(code);
  const entitledWidgetCodes = Array.from(widgetCodes);

  // Launchpad slugs. Travelgenix staff in their OWN account see every active
  // product. Staff acting AS a client and ordinary client users both see the
  // client's entitled products, so the launchpad mirrors Control exactly.
  let launchSlugs;
  if (isStaff && !isImpersonating) {
    launchSlugs = Array.from(activeSlugs);
  } else if (entitledSlugs.size > 0) {
    launchSlugs = Array.from(entitledSlugs).filter((s) => productInfoBySlug.has(s));
  } else {
    // Safety net: this client has no entitlements seeded yet. Fall back to the
    // user's permission products so the launchpad is not blank during setup.
    launchSlugs = (permissions || []).map((p) => p.product);
  }

  const accessibleProducts = [];
  const seen = new Set();
  for (const slug of launchSlugs) {
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    const info = productInfoBySlug.get(slug);
    accessibleProducts.push({
      slug,
      name: info ? info.name : slug,
      role: role || 'member',
    });
  }

  return { entitledWidgetCodes, activeWidgetCodes, allActiveSlugs, accessibleProducts };
}
