/**
 * POST /api/admin/catalogue/upsert
 *
 * Creates a new catalogue item or updates an existing one. Used by the
 * Catalogue tab in the admin UI. Validates every input — product codes
 * are written into client config, so a typo here is forever.
 *
 * Auth: widget_suite owner or admin.
 *
 * Request body:
 *   {
 *     id?: 'recXXX' (omit for create),
 *     productCode: 'widget-foo',
 *     productName: 'Foo Widget',
 *     category: 'Widget' | 'Luna Suite' | 'Marketing' | 'CRM' | 'Quick Quote' | 'University',
 *     description?: string,
 *     active?: boolean,
 *     sortOrder?: number
 *   }
 */

import { createRecords, updateRecords } from '../../_lib/auth/airtable.js';
import { requireAdmin, json, setAdminCors } from '../_lib/auth.js';
import { CATALOGUE } from '../_lib/schema.js';

const ALLOWED_CATEGORIES = new Set([
  'Luna Suite',
  'Marketing',
  'CRM',
  'Quick Quote',
  'University',
  'Widget',
]);

// Product code rules: lowercase, alphanumeric + hyphens only, 3–60 chars
const PRODUCT_CODE_RE = /^[a-z][a-z0-9-]{2,59}$/;

export default async function handler(req, res) {
  if (setAdminCors(req, res)) return;

  if (req.method !== 'POST' && req.method !== 'PATCH') {
    return json(res, 405, { error: 'method_not_allowed' });
  }

  const admin = await requireAdmin(req, res);
  if (!admin) return;

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
  } catch {
    return json(res, 400, { error: 'invalid_json' });
  }

  // Validation
  const errors = [];
  const productCode = String(body.productCode || '').trim().toLowerCase();
  if (!PRODUCT_CODE_RE.test(productCode)) {
    errors.push('productCode must be lowercase letters, numbers and hyphens, starting with a letter, 3–60 chars');
  }

  const productName = String(body.productName || '').trim();
  if (productName.length < 2 || productName.length > 80) {
    errors.push('productName must be 2–80 characters');
  }

  const category = String(body.category || '').trim();
  if (!ALLOWED_CATEGORIES.has(category)) {
    errors.push(`category must be one of: ${[...ALLOWED_CATEGORIES].join(', ')}`);
  }

  const description = body.description == null ? '' : String(body.description).trim();
  if (description.length > 2000) {
    errors.push('description max 2000 characters');
  }

  const active = body.active === undefined ? true : !!body.active;
  const sortOrder = Number.isFinite(body.sortOrder) ? Math.floor(body.sortOrder) : 999;

  if (errors.length) {
    return json(res, 400, { error: 'validation_failed', errors });
  }

  const fields = {
    [CATALOGUE.fields.productCode]: productCode,
    [CATALOGUE.fields.productName]: productName,
    [CATALOGUE.fields.category]: category,
    [CATALOGUE.fields.description]: description,
    [CATALOGUE.fields.active]: active,
    [CATALOGUE.fields.sortOrder]: sortOrder,
  };

  try {
    if (body.id && /^rec[A-Za-z0-9]{14}$/.test(body.id)) {
      // Update
      const updated = await updateRecords(CATALOGUE.tableId, [
        { id: body.id, fields },
      ], { typecast: true });
      return json(res, 200, { ok: true, action: 'updated', record: updated[0] });
    } else {
      // Create — also stamp Created
      fields[CATALOGUE.fields.created] = new Date().toISOString();
      const created = await createRecords(CATALOGUE.tableId, [{ fields }], { typecast: true });
      return json(res, 200, { ok: true, action: 'created', record: created[0] });
    }
  } catch (err) {
    console.error('[admin/catalogue/upsert] error:', err);
    return json(res, 500, { error: 'internal_error', detail: 'failed to save catalogue item' });
  }
}
