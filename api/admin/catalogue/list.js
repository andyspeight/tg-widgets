/**
 * GET /api/admin/catalogue/list
 *
 * Returns every catalogue item, grouped by category and sorted by sortOrder.
 * Powers the Catalogue tab in the admin UI.
 *
 * Auth: requires widget_suite owner or admin.
 */

import { requireAuth, requireProductAccess } from '../../_lib/auth/middleware.js';
import { listAllRecords } from '../../_lib/auth/airtable.js';
import { jsonError } from '../../_lib/auth/http.js';
import { PRODUCTS, PERMISSIONS, CATALOGUE } from '../../_lib/auth/schema.js';

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

  try {
    const records = await listAllRecords(CATALOGUE.tableId);

    const items = records
      .map((r) => ({
        id: r.id,
        productCode: r.fields[CATALOGUE.fields.productCode] || '',
        productName: r.fields[CATALOGUE.fields.productName] || '',
        category: r.fields[CATALOGUE.fields.category] || '',
        description: r.fields[CATALOGUE.fields.description] || '',
        active: !!r.fields[CATALOGUE.fields.active],
        sortOrder: r.fields[CATALOGUE.fields.sortOrder] ?? 999,
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder);

    // Group by category in canonical order
    const byCategory = {};
    for (const cat of CATALOGUE.categoryOrder) byCategory[cat] = [];
    for (const item of items) {
      if (!byCategory[item.category]) byCategory[item.category] = [];
      byCategory[item.category].push(item);
    }

    return res.status(200).json({
      items,
      byCategory,
      categoryOrder: CATALOGUE.categoryOrder,
    });
  } catch (err) {
    console.error('[admin/catalogue/list] error:', err);
    return jsonError(res, 500, 'internal_error', 'Failed to load catalogue');
  }
}
