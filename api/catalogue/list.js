/**
 * GET /api/admin/catalogue/list
 *
 * Returns every catalogue item, grouped by category and sorted by sortOrder.
 * Powers the Catalogue tab in the admin UI.
 *
 * Auth: requires widget_suite owner or admin.
 */

import { listRecords } from '../../_lib/auth/airtable.js';
import { requireAdmin, json, setAdminCors } from '../_lib/auth.js';
import { BASE_ID, CATALOGUE } from '../_lib/schema.js';

export default async function handler(req, res) {
  if (setAdminCors(req, res)) return;

  if (req.method !== 'GET') {
    return json(res, 405, { error: 'method_not_allowed' });
  }

  const admin = await requireAdmin(req, res);
  if (!admin) return;

  try {
    const records = await listRecords(CATALOGUE.tableId, {
      maxRecords: 200,
      // Sort by category first then explicit sort order
      sort: [{ field: CATALOGUE.fields.sortOrder, direction: 'asc' }],
    });

    const items = records.map((r) => ({
      id: r.id,
      productCode: r.fields[CATALOGUE.fields.productCode] || '',
      productName: r.fields[CATALOGUE.fields.productName] || '',
      category: r.fields[CATALOGUE.fields.category] || '',
      description: r.fields[CATALOGUE.fields.description] || '',
      active: !!r.fields[CATALOGUE.fields.active],
      sortOrder: r.fields[CATALOGUE.fields.sortOrder] ?? 999,
    }));

    // Group by category in the canonical order
    const byCategory = {};
    for (const cat of CATALOGUE.categoryOrder) byCategory[cat] = [];
    for (const item of items) {
      if (!byCategory[item.category]) byCategory[item.category] = [];
      byCategory[item.category].push(item);
    }

    return json(res, 200, {
      items,
      byCategory,
      categoryOrder: CATALOGUE.categoryOrder,
    });
  } catch (err) {
    console.error('[admin/catalogue/list] error:', err);
    return json(res, 500, { error: 'internal_error', detail: 'failed to load catalogue' });
  }
}
