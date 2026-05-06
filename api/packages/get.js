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

import { listRecords } from '../../_lib/auth/airtable.js';
import { requireAdmin, json, setAdminCors } from '../_lib/auth.js';
import { CATALOGUE, PACKAGES, PACKAGE_CATALOGUE } from '../_lib/schema.js';

export default async function handler(req, res) {
  if (setAdminCors(req, res)) return;

  if (req.method !== 'GET') {
    return json(res, 405, { error: 'method_not_allowed' });
  }

  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const id = String(req.query?.id || '').trim();
  if (!/^rec[A-Za-z0-9]{14}$/.test(id)) {
    return json(res, 400, { error: 'invalid_id' });
  }

  try {
    // Fetch the package, all active catalogue items, and existing joins for this package.
    // Three parallel reads keeps latency low.
    const [packageRecords, catalogueRecords, joinRecords] = await Promise.all([
      listRecords(PACKAGES.tableId, { recordIds: [id] }),
      listRecords(CATALOGUE.tableId, {
        maxRecords: 200,
        sort: [{ field: CATALOGUE.fields.sortOrder, direction: 'asc' }],
      }),
      listRecords(PACKAGE_CATALOGUE.tableId, { maxRecords: 1000 }),
    ]);

    const pkg = packageRecords[0];
    if (!pkg) return json(res, 404, { error: 'package_not_found' });

    // Build a map: catalogueRecordId -> existing join row for this package
    const joinByCatalogueId = new Map();
    for (const j of joinRecords) {
      const pkgIds = j.fields[PACKAGE_CATALOGUE.fields.package] || [];
      if (!pkgIds.includes(id)) continue;
      const catIds = j.fields[PACKAGE_CATALOGUE.fields.catalogueItem] || [];
      for (const cid of catIds) {
        joinByCatalogueId.set(cid, j);
      }
    }

    // Build the grid: one row per catalogue item, with the join state if any
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
          // Join state
          joinId: join?.id || null,
          includedByDefault: join ? !!join.fields[PACKAGE_CATALOGUE.fields.includedByDefault] : false,
          availableAsAddOn: join ? !!join.fields[PACKAGE_CATALOGUE.fields.availableAsAddOn] : false,
          addOnMonthlyPrice: join?.fields[PACKAGE_CATALOGUE.fields.addOnMonthlyPrice] ?? null,
        };
      });

    // Group by category in canonical order
    const byCategory = {};
    for (const cat of CATALOGUE.categoryOrder) byCategory[cat] = [];
    for (const row of grid) {
      if (!byCategory[row.category]) byCategory[row.category] = [];
      byCategory[row.category].push(row);
    }

    return json(res, 200, {
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
    return json(res, 500, { error: 'internal_error', detail: 'failed to load package' });
  }
}
