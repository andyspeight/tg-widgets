/**
 * POST /api/admin/packages/save
 *
 * Saves a package's details AND its entitlement defaults grid in a single
 * call. Reconciles existing Package Catalogue join rows:
 *   - If a row should exist (included or add-on tickbox is true) and one
 *     does, it's updated.
 *   - If a row should exist and none does, it's created.
 *   - If a row exists but should not (both flags false), it's deleted.
 *
 * Batch sized to 10 records per Airtable call (matches existing
 * bulkUpdateRecords / bulkDeleteRecords contract). Creates go through
 * createRecord which is single-record-only in this codebase.
 *
 * Auth: widget_suite owner or admin.
 */

import { requireAuth, requireProductAccess } from '../../_lib/auth/middleware.js';
import {
  listAllRecords,
  updateRecord,
  bulkUpdateRecords,
  createRecord,
  bulkDeleteRecords,
} from '../../_lib/auth/airtable.js';
import { jsonError } from '../../_lib/auth/http.js';
import {
  PRODUCTS,
  PERMISSIONS,
  PACKAGES,
  PACKAGE_CATALOGUE,
} from '../../_lib/auth/schema.js';

const PACKAGE_CODE_RE = /^[a-z][a-z0-9-]{2,40}$/;
const REC_ID_RE = /^rec[A-Za-z0-9]{14}$/;

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return jsonError(res, 405, 'method_not_allowed', 'POST only');
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

  // ─── Validate package fields ──────────────────────────────────
  const errors = [];

  if (!REC_ID_RE.test(body.id || '')) {
    errors.push('id must be a valid record id');
  }

  const packageName = String(body.packageName || '').trim();
  if (packageName.length < 2 || packageName.length > 60) {
    errors.push('packageName must be 2–60 characters');
  }

  const packageCode = String(body.packageCode || '').trim().toLowerCase();
  if (!PACKAGE_CODE_RE.test(packageCode)) {
    errors.push('packageCode must be lowercase letters/numbers/hyphens, starting with a letter, 3–40 chars');
  }

  const monthlyPrice =
    body.monthlyPrice == null || body.monthlyPrice === ''
      ? null
      : Number(body.monthlyPrice);
  if (
    monthlyPrice !== null &&
    (!Number.isFinite(monthlyPrice) || monthlyPrice < 0 || monthlyPrice > 100000)
  ) {
    errors.push('monthlyPrice must be a non-negative number under 100000');
  }

  const setupFee =
    body.setupFee == null || body.setupFee === ''
      ? null
      : Number(body.setupFee);
  if (
    setupFee !== null &&
    (!Number.isFinite(setupFee) || setupFee < 0 || setupFee > 100000)
  ) {
    errors.push('setupFee must be a non-negative number under 100000');
  }

  const description = body.description == null ? '' : String(body.description).trim();
  if (description.length > 2000) {
    errors.push('description max 2000 characters');
  }

  const active = body.active === undefined ? true : !!body.active;
  const sortOrder = Number.isFinite(body.sortOrder) ? Math.floor(body.sortOrder) : 999;

  if (!Array.isArray(body.grid)) {
    errors.push('grid must be an array');
  }

  if (errors.length) {
    return jsonError(res, 400, 'validation_failed', errors.join(' · '));
  }

  // ─── Validate each grid row ───────────────────────────────────
  const gridRows = [];
  for (const row of body.grid) {
    if (!REC_ID_RE.test(row?.catalogueItemId || '')) {
      return jsonError(res, 400, 'invalid_grid_row', 'each row needs a valid catalogueItemId');
    }
    if (row.joinId && !REC_ID_RE.test(row.joinId)) {
      return jsonError(res, 400, 'invalid_grid_row', 'joinId must be a valid record id or null');
    }
    const addOnPrice =
      row.addOnMonthlyPrice == null || row.addOnMonthlyPrice === ''
        ? null
        : Number(row.addOnMonthlyPrice);
    if (
      addOnPrice !== null &&
      (!Number.isFinite(addOnPrice) || addOnPrice < 0 || addOnPrice > 100000)
    ) {
      return jsonError(res, 400, 'invalid_grid_row', 'addOnMonthlyPrice must be 0–100000');
    }
    gridRows.push({
      catalogueItemId: row.catalogueItemId,
      joinId: row.joinId || null,
      includedByDefault: !!row.includedByDefault,
      availableAsAddOn: !!row.availableAsAddOn,
      addOnMonthlyPrice: addOnPrice,
    });
  }

  // ─── 1. Update the package record itself ──────────────────────
  const packageFields = {
    [PACKAGES.fields.packageName]: packageName,
    [PACKAGES.fields.packageCode]: packageCode,
    [PACKAGES.fields.monthlyPrice]: monthlyPrice,
    [PACKAGES.fields.setupFee]: setupFee,
    [PACKAGES.fields.description]: description,
    [PACKAGES.fields.active]: active,
    [PACKAGES.fields.sortOrder]: sortOrder,
  };

  try {
    await updateRecord(PACKAGES.tableId, body.id, packageFields);
  } catch (err) {
    console.error('[admin/packages/save] failed updating package record:', err);
    return jsonError(res, 500, 'failed_to_update_package', 'Could not save package details');
  }

  // ─── 2. Reconcile the join rows ───────────────────────────────
  // Re-pull current join rows for this package — defence in depth, don't
  // trust client-supplied joinIds completely.
  let existingForPackage;
  try {
    const allJoins = await listAllRecords(PACKAGE_CATALOGUE.tableId);
    existingForPackage = allJoins.filter((j) => {
      const pkgs = j.fields[PACKAGE_CATALOGUE.fields.package] || [];
      return pkgs.includes(body.id);
    });
  } catch (err) {
    console.error('[admin/packages/save] failed listing existing joins:', err);
    return jsonError(res, 500, 'failed_to_load_joins', 'Could not reconcile entitlement grid');
  }

  const existingByCatalogueId = new Map();
  for (const j of existingForPackage) {
    const cats = j.fields[PACKAGE_CATALOGUE.fields.catalogueItem] || [];
    for (const cid of cats) existingByCatalogueId.set(cid, j);
  }

  const toCreate = [];
  const toUpdate = [];
  const toDelete = [];

  for (const row of gridRows) {
    const shouldExist = row.includedByDefault || row.availableAsAddOn;
    const existing = existingByCatalogueId.get(row.catalogueItemId);

    if (shouldExist && !existing) {
      toCreate.push({
        [PACKAGE_CATALOGUE.fields.package]: [body.id],
        [PACKAGE_CATALOGUE.fields.catalogueItem]: [row.catalogueItemId],
        [PACKAGE_CATALOGUE.fields.includedByDefault]: row.includedByDefault,
        [PACKAGE_CATALOGUE.fields.availableAsAddOn]: row.availableAsAddOn,
        [PACKAGE_CATALOGUE.fields.addOnMonthlyPrice]: row.addOnMonthlyPrice,
      });
    } else if (shouldExist && existing) {
      toUpdate.push({
        id: existing.id,
        fields: {
          [PACKAGE_CATALOGUE.fields.includedByDefault]: row.includedByDefault,
          [PACKAGE_CATALOGUE.fields.availableAsAddOn]: row.availableAsAddOn,
          [PACKAGE_CATALOGUE.fields.addOnMonthlyPrice]: row.addOnMonthlyPrice,
        },
      });
    } else if (!shouldExist && existing) {
      toDelete.push(existing.id);
    }
    // shouldExist=false && !existing → nothing to do
  }

  // Execute in the right order: deletes, then updates, then creates.
  // - Deletes/updates batch at 10 per call (Airtable limit, enforced by helpers).
  // - Creates go through createRecord one at a time (codebase has no
  //   bulkCreateRecords yet — the volume here is small so it's fine).
  try {
    for (const batch of chunk(toDelete, 10)) {
      if (batch.length) await bulkDeleteRecords(PACKAGE_CATALOGUE.tableId, batch);
    }
    for (const batch of chunk(toUpdate, 10)) {
      if (batch.length) await bulkUpdateRecords(PACKAGE_CATALOGUE.tableId, batch);
    }
    for (const fields of toCreate) {
      await createRecord(PACKAGE_CATALOGUE.tableId, fields);
    }
  } catch (err) {
    console.error('[admin/packages/save] failed reconciling joins:', err);
    return jsonError(res, 500, 'failed_to_save_grid', 'Package details saved but entitlement grid is partially saved. Refresh and try again.');
  }

  return res.status(200).json({
    ok: true,
    summary: {
      created: toCreate.length,
      updated: toUpdate.length,
      deleted: toDelete.length,
    },
  });
}
