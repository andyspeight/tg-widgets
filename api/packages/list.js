/**
 * GET /api/admin/packages/list
 *
 * Returns every package with a quick summary count of how many products
 * are included by default and how many are offered as add-ons. Powers
 * the Packages tab landing view (the list of cards).
 *
 * Auth: widget_suite owner or admin.
 */

import { listRecords } from '../../_lib/auth/airtable.js';
import { requireAdmin, json, setAdminCors } from '../_lib/auth.js';
import { PACKAGES, PACKAGE_CATALOGUE } from '../_lib/schema.js';

export default async function handler(req, res) {
  if (setAdminCors(req, res)) return;

  if (req.method !== 'GET') {
    return json(res, 405, { error: 'method_not_allowed' });
  }

  const admin = await requireAdmin(req, res);
  if (!admin) return;

  try {
    // Pull both tables in parallel
    const [packageRecords, joinRecords] = await Promise.all([
      listRecords(PACKAGES.tableId, {
        maxRecords: 100,
        sort: [{ field: PACKAGES.fields.sortOrder, direction: 'asc' }],
      }),
      listRecords(PACKAGE_CATALOGUE.tableId, { maxRecords: 1000 }),
    ]);

    // Index join records by package record id for O(1) lookup
    const joinsByPackage = new Map();
    for (const j of joinRecords) {
      const pkgIds = j.fields[PACKAGE_CATALOGUE.fields.package] || [];
      for (const pid of pkgIds) {
        if (!joinsByPackage.has(pid)) joinsByPackage.set(pid, []);
        joinsByPackage.get(pid).push(j);
      }
    }

    const packages = packageRecords.map((p) => {
      const joins = joinsByPackage.get(p.id) || [];
      const includedCount = joins.filter(
        (j) => !!j.fields[PACKAGE_CATALOGUE.fields.includedByDefault]
      ).length;
      const addOnCount = joins.filter(
        (j) => !!j.fields[PACKAGE_CATALOGUE.fields.availableAsAddOn]
      ).length;

      return {
        id: p.id,
        packageName: p.fields[PACKAGES.fields.packageName] || '',
        packageCode: p.fields[PACKAGES.fields.packageCode] || '',
        monthlyPrice: p.fields[PACKAGES.fields.monthlyPrice] ?? null,
        setupFee: p.fields[PACKAGES.fields.setupFee] ?? null,
        description: p.fields[PACKAGES.fields.description] || '',
        active: !!p.fields[PACKAGES.fields.active],
        sortOrder: p.fields[PACKAGES.fields.sortOrder] ?? 999,
        includedCount,
        addOnCount,
      };
    });

    return json(res, 200, { packages });
  } catch (err) {
    console.error('[admin/packages/list] error:', err);
    return json(res, 500, { error: 'internal_error', detail: 'failed to load packages' });
  }
}
