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

import { requireAuth, requireProductAccess } from '../../_lib/auth/middleware.js';
import { createRecord, updateRecord } from '../../_lib/auth/airtable.js';
import { jsonError } from '../../_lib/auth/http.js';
import { PRODUCTS, PERMISSIONS, CATALOGUE } from '../../_lib/auth/schema.js';

const ALLOWED_CATEGORIES = new Set([
  'Luna Suite',
  'Marketing',
  'CRM',
  'Quick Quote',
  'University',
  'Widget',
]);

// Product code rules: lowercase, alphanumeric + hyphens only, 3–60 chars,
// must start with a letter (so we don't accept '-foo' or '0widget')
const PRODUCT_CODE_RE = /^[a-z][a-z0-9-]{2,59}$/;
const REC_ID_RE = /^rec[A-Za-z0-9]{14}$/;

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'PATCH') {
    return jsonError(res, 405, 'method_not_allowed', 'POST or PATCH only');
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

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  } catch {
    return jsonError(res, 400, 'invalid_json', 'Body must be JSON');
  }

  // ─── Validation ──────────────────────────────────────────────────
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

  if (body.id && !REC_ID_RE.test(body.id)) {
    errors.push('id must be a valid record id when provided');
  }

  if (errors.length) {
    return jsonError(res, 400, 'validation_failed', errors.join(' · '));
  }

  // ─── Build field payload ─────────────────────────────────────────
  const fields = {
    [CATALOGUE.fields.productCode]: productCode,
    [CATALOGUE.fields.productName]: productName,
    [CATALOGUE.fields.category]: category,
    [CATALOGUE.fields.description]: description,
    [CATALOGUE.fields.active]: active,
    [CATALOGUE.fields.sortOrder]: sortOrder,
  };

  try {
    if (body.id) {
      // Update path
      await updateRecord(CATALOGUE.tableId, body.id, fields);
      return res.status(200).json({ ok: true, action: 'updated', id: body.id });
    } else {
      // Create path — also stamp Created
      fields[CATALOGUE.fields.created] = new Date().toISOString();
      const record = await createRecord(CATALOGUE.tableId, fields);
      return res.status(200).json({ ok: true, action: 'created', id: record.id });
    }
  } catch (err) {
    console.error('[admin/catalogue/upsert] error:', err);
    return jsonError(res, 500, 'internal_error', 'Failed to save catalogue item');
  }
}
