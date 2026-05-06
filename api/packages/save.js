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
 * Batch sized to 10 records per Airtable call as per the airtable-operations
 * skill rules. With 15 catalogue items in scope, that's at most 2 batches
 * per operation type.
 *
 * Auth: widget_suite owner or admin.
 *
 * Request body:
 *   {
 *     id: 'recXXX',                       // required - package record id
 *     packageName: string,
 *     packageCode: string,
 *     monthlyPrice?: number | null,
 *     setupFee?: number | null,
 *     description?: string,
 *     active?: boolean,
 *     sortOrder?: number,
 *     grid: [
 *       {
 *         catalogueItemId: 'recXXX',
 *         joinId: 'recYYY' | null,
 *         includedByDefault: boolean,
 *         availableAsAddOn: boolean,
 *         addOnMonthlyPrice?: number | null
 *       }, ...
 *     ]
 *   }
 */

import {
  listRecords,
  updateRecords,
  createRecords,
  deleteRecords,
} from '../../_lib/auth/airtable.js';
import { requireAdmin, json, setAdminCors } from '../_lib/auth.js';
import { PACKAGES, PACKAGE_CATALOGUE } from '../_lib/schema.js';

const PACKAGE_CODE_RE = /^[a-z][a-z0-9-]{2,40}$/;
const REC_ID_RE = /^rec[A-Za-z0-9]{14}$/;

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export default async function handler(req, res) {
  if (setAdminCors(req, res)) return;

  if (req.method !== 'POST') {
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

  // ─── Validate package fields ──────────────────────────────────
  const errors = [];

  if (!REC_ID_RE.test(body.id || '')) {
    errors.push('id must be a valid Airtable record id');
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
  if (monthlyPrice !== null && (!Number.isFinite(monthlyPrice) || monthlyPrice < 0 || monthlyPrice > 100000)) {
    errors.push('monthlyPrice must be a non-negative number under 100000');
  }

  const setupFee =
    body.setupFee == null || body.setupFee === ''
      ? null
      : Number(body.setupFee);
  if (setupFee !== null && (!Number.isFinite(setupFee) || setupFee < 0 || setupFee > 100000)) {
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
    return json(res, 400, { error: 'validation_failed', errors });
  }

  // ─── Validate each grid row ───────────────────────────────────
  const gridRows = [];
  for (const row of body.grid) {
    if (!REC_ID_RE.test(row?.catalogueItemId || '')) {
      return json(res, 400, { error: 'invalid_grid_row', detail: 'each row needs a valid catalogueItemId' });
    }
    if (row.joinId && !REC_ID_RE.test(row.joinId)) {
      return json(res, 400, { error: 'invalid_grid_row', detail: 'joinId must be a valid record id or null' });
    }
    const addOnPrice =
      row.addOnMonthlyPrice == null || row.addOnMonthlyPrice === ''
        ? null
        : Number(row.addOnMonthlyPrice);
    if (addOnPrice !== null && (!Number.isFinite(addOnPrice) || addOnPrice < 0 || addOnPrice > 100000)) {
      return json(res, 400, { error: 'invalid_grid_row', detail: 'addOnMonthlyPrice must be 0–100000' });
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
    await updateRecords(
      PACKAGES.tableId,
      [{ id: body.id, fields: packageFields }],
      { typecast: true }
    );
  } catch (err) {
    console.error('[admin/packages/save] failed updating package record:', err);
    return json(res, 500, { error: 'failed_to_update_package' });
  }

  // ─── 2. Reconcile the join rows ───────────────────────────────
  // Pull the current join rows for this package (defence in depth — don't
  // trust the client's joinId values fully).
  let existingJoins;
  try {
    const allJoins = await listRecords(PACKAGE_CATALOGUE.tableId, { maxRecords: 1000 });
    existingJoins = allJoins.filter((j) => {
      const pkgs = j.fields[PACKAGE_CATALOGUE.fields.package] || [];
      return pkgs.includes(body.id);
    });
  } catch (err) {
    console.error('[admin/packages/save] failed listing existing joins:', err);
    return json(res, 500, { error: 'failed_to_load_joins' });
  }

  const existingByCatalogueId = new Map();
  for (const j of existingJoins) {
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
        fields: {
          [PACKAGE_CATALOGUE.fields.package]: [body.id],
          [PACKAGE_CATALOGUE.fields.catalogueItem]: [row.catalogueItemId],
          [PACKAGE_CATALOGUE.fields.includedByDefault]: row.includedByDefault,
          [PACKAGE_CATALOGUE.fields.availableAsAddOn]: row.availableAsAddOn,
          [PACKAGE_CATALOGUE.fields.addOnMonthlyPrice]: row.addOnMonthlyPrice,
        },
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
  // Batch each operation at 10 records per call (skill rule).
  try {
    for (const batch of chunk(toDelete, 10)) {
      if (batch.length) await deleteRecords(PACKAGE_CATALOGUE.tableId, batch);
    }
    for (const batch of chunk(toUpdate, 10)) {
      if (batch.length) await updateRecords(PACKAGE_CATALOGUE.tableId, batch, { typecast: true });
    }
    for (const batch of chunk(toCreate, 10)) {
      if (batch.length) await createRecords(PACKAGE_CATALOGUE.tableId, batch, { typecast: true });
    }
  } catch (err) {
    console.error('[admin/packages/save] failed reconciling joins:', err);
    return json(res, 500, {
      error: 'failed_to_save_grid',
      detail: 'package details saved but entitlement grid is partially saved',
    });
  }

  return json(res, 200, {
    ok: true,
    summary: {
      created: toCreate.length,
      updated: toUpdate.length,
      deleted: toDelete.length,
    },
  });
}
