/**
 * GET /api/auth/_debug-permissions
 *
 * TEMPORARY — diagnostic endpoint for the unified-auth rollout.
 * Delete once Permissions resolution is confirmed working in production.
 *
 * Auth: requires owner role to call. This is sensitive — it surfaces
 * the formula being sent to Airtable and the raw response shape, which
 * would be useful for an attacker probing internals.
 */

import { setCors, requireMethod, jsonOk, jsonError } from '../_lib/auth/http.js';
import { requireAuth } from '../_lib/auth/middleware.js';
import { listRecords } from '../_lib/auth/airtable.js';
import { PERMISSIONS, PRODUCTS, USERS } from '../_lib/auth/schema.js';

export default async function handler(req, res) {
  if (setCors(req, res)) return;
  if (!requireMethod(req, res, 'GET')) return;

  const ctx = await requireAuth(req, res);
  if (!ctx) return;

  // Owner-only — protect the diagnostic.
  if (ctx.role !== 'owner') {
    return jsonError(res, 403, 'forbidden', 'Owner only');
  }

  const userRecordId = ctx.userRecordId;
  const checks = [];

  // 1. Can we read the Products table at all?
  try {
    const products = await listRecords(PRODUCTS.tableId, { maxRecords: 100 });
    checks.push({
      name: 'products_read',
      ok: true,
      count: products.length,
      slugs: products.map(p => p.fields[PRODUCTS.fields.productId]).filter(Boolean)
    });
  } catch (e) {
    checks.push({ name: 'products_read', ok: false, error: e.message, status: e.status });
  }

  // 2. Can we read the Permissions table without any filter?
  try {
    const all = await listRecords(PERMISSIONS.tableId, { maxRecords: 50 });
    checks.push({
      name: 'permissions_read_unfiltered',
      ok: true,
      count: all.length,
      first: all[0] ? {
        id: all[0].id,
        userField: all[0].fields[PERMISSIONS.fields.user],
        productField: all[0].fields[PERMISSIONS.fields.product],
        roleField: all[0].fields[PERMISSIONS.fields.role],
        statusField: all[0].fields[PERMISSIONS.fields.status]
      } : null
    });
  } catch (e) {
    checks.push({ name: 'permissions_read_unfiltered', ok: false, error: e.message, status: e.status });
  }

  // 3. Can we read with the FIND filter on this user?
  const findFormula = `FIND('${userRecordId}', ARRAYJOIN({${PERMISSIONS.fields.user}}))>0`;
  try {
    const filtered = await listRecords(PERMISSIONS.tableId, {
      formula: findFormula,
      maxRecords: 50
    });
    checks.push({
      name: 'permissions_read_find_only',
      ok: true,
      formula: findFormula,
      count: filtered.length
    });
  } catch (e) {
    checks.push({ name: 'permissions_read_find_only', ok: false, formula: findFormula, error: e.message, status: e.status });
  }

  // 4. Full formula as the resolver uses it.
  const fullFormula =
    `AND(` +
      `FIND('${userRecordId}', ARRAYJOIN({${PERMISSIONS.fields.user}}))>0,` +
      `{${PERMISSIONS.fields.status}}='${PERMISSIONS.statuses.ACTIVE}',` +
      `OR(BLANK()={${PERMISSIONS.fields.expiresAt}}, IS_AFTER({${PERMISSIONS.fields.expiresAt}}, NOW()))` +
    `)`;
  try {
    const filtered = await listRecords(PERMISSIONS.tableId, {
      formula: fullFormula,
      maxRecords: 50
    });
    checks.push({
      name: 'permissions_read_full_formula',
      ok: true,
      formula: fullFormula,
      count: filtered.length,
      sample: filtered[0]?.fields || null
    });
  } catch (e) {
    checks.push({ name: 'permissions_read_full_formula', ok: false, formula: fullFormula, error: e.message, status: e.status });
  }

  return jsonOk(res, {
    userRecordId,
    schema: {
      permissionsTable: PERMISSIONS.tableId,
      productsTable: PRODUCTS.tableId,
      userField: PERMISSIONS.fields.user,
      productField: PERMISSIONS.fields.product,
      statusField: PERMISSIONS.fields.status,
      expiresAtField: PERMISSIONS.fields.expiresAt
    },
    checks
  });
}
