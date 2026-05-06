/**
 * GET /api/admin/packages/get?id=recXXX
 *
 * Returns a single package and a complete product grid: every active
 * catalogue item alongside this package's current included/add-on flags.
 * Used by the Packages tab edit view — gives the UI everything it needs
 * to render the full grid in one fetch.
 *
 * Auth: widget_suite owner or admin.
 */

import { requireAuth, requireProductAccess } from '../../_lib/auth/middleware.js';
import { getRecord, listAllRecords } from '../../_lib/auth/airtable.js';
import { jsonError } from '../../_lib/auth/http.js';
import {
  PRODUCTS,
  PERMISSIONS,
  CATALOGUE,
  PACKAGES,
  PACKAGE_CATALOGUE,
} from '../../_lib/auth/schema.js';

const REC_ID_RE = /^rec[A-Za-z0-9]{14}$/;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return jsonError(res, 405, 'method_not_allowed', 'GET only');
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

  // Vercel parses the query string into req.query
  const id = String(req.query?.id || '').trim();
  if (!REC_ID_RE.test(id)) {
    return jsonError(res, 400, 'invalid_id', 'id query param must be a valid record id');
  }

  try {
    // Fetch the package, all catalogue items, and existing joins for this
    // package — three parallel reads keeps latency low.
    const [pkg, catalogueRecords, joinRecords] = await Promise.all([
      getRecord(PACKAGES.tableId, id).catch((err) => {
        if (err?.status === 404) return null;
        throw err;
      }),
      listAllRecords(CATALOGUE.tableId),
      listAllRecords(PACKAGE_CATALOGUE.tableId),
    ]);

    if (!pkg) return jsonError(res, 404, 'package_not_found', 'No package with that id');

    // Build map: catalogueRecordId -> existing join row for this package
    const joinByCatalogueId = new Map();
    for (const j of joinRecords) {
      const pkgIds = j.fields[PACKAGE_CATALOGUE.fields.package] || [];
      if (!pkgIds.includes(id)) continue;
      const catIds = j.fields[PACKAGE_CATALOGUE.fields.catalogueItem] || [];
      for (const cid of catIds) joinByCatalogueId.set(cid, j);
    }

    // Build the grid: one row per active catalogue item
    const grid = catalogueRecords
      .filter((c) => !!c.fields[CATALOGUE.fields.active])
      .map((c) => {
        const join = joinByCatalogueId.get(c.id);
        return {
          catalogueItemId: c.id,
          productCode: c.fields[CATALOGUE.fields.productCode] || '',
          productName: c.fields[CATALOGUE.fields.productName] || '',
          category: c.fields[CATALOGUE.fields.category] || '',
          sortOrder: c.fields[CATALOGUE.fields.sortOrder] ?? 999,
          joinId: join?.id || null,
          includedByDefault: join
            ? !!join.fields[PACKAGE_CATALOGUE.fields.includedByDefault]
            : false,
          availableAsAddOn: join
            ? !!join.fields[PACKAGE_CATALOGUE.fields.availableAsAddOn]
            : false,
          addOnMonthlyPrice:
            join?.fields[PACKAGE_CATALOGUE.fields.addOnMonthlyPrice] ?? null,
        };
      })
      .sort((a, b) => a.sortOrder - b.sortOrder);

    // Group by category in canonical order
    const byCategory = {};
    for (const cat of CATALOGUE.categoryOrder) byCategory[cat] = [];
    for (const row of grid) {
      if (!byCategory[row.category]) byCategory[row.category] = [];
      byCategory[row.category].push(row);
    }

    return res.status(200).json({
      package: {
        id: pkg.id,
        packageName: pkg.fields[PACKAGES.fields.packageName] || '',
        packageCode: pkg.fields[PACKAGES.fields.packageCode] || '',
        monthlyPrice: pkg.fields[PACKAGES.fields.monthlyPrice] ?? null,
        setupFee: pkg.fields[PACKAGES.fields.setupFee] ?? null,
        description: pkg.fields[PACKAGES.fields.description] || '',
        active: !!pkg.fields[PACKAGES.fields.active],
        sortOrder: pkg.fields[PACKAGES.fields.sortOrder] ?? 999,
      },
      grid,
      byCategory,
      categoryOrder: CATALOGUE.categoryOrder,
    });
  } catch (err) {
    console.error('[admin/packages/get] error:', err);
    return jsonError(res, 500, 'internal_error', 'Failed to load package');
  }
}
