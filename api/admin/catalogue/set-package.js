/**
 * POST /api/admin/catalogue/set-package
 *
 * Sets (or clears) whether a single catalogue item is included by default in a
 * single package. This is one cell of the package x product matrix, written
 * from the product-centric Catalogue tab. It reconciles the SAME Package
 * Catalogue join table that /api/admin/packages/save edits, using identical
 * semantics so the Packages tab and the Catalogue tab never disagree:
 *
 *   - includedByDefault = true:
 *       update the existing join (preserving its add-on flag/price), or
 *       create one if none exists.
 *   - includedByDefault = false:
 *       if the join is still an add-on, just clear the included flag (keep it);
 *       otherwise delete the join entirely (a row with both flags false is
 *       meaningless — matches packages/save).
 *
 * This drives NEW client onboarding (the wizard seeds entitlements from these
 * defaults) and keeps the Packages tab in sync. It does not retroactively
 * change existing clients — see the access-layer note in the Catalogue page.
 *
 * Auth: requires widget_suite owner or admin.
 *
 * Body: { catalogueItemId: 'recXXX', packageId: 'recYYY', includedByDefault: true }
 */

import { requireAuth, requireProductAccess } from '../../_lib/auth/middleware.js';
import {
  getRecord,
  listAllRecords,
  updateRecord,
  createRecord,
  bulkDeleteRecords,
} from '../../_lib/auth/airtable.js';
import { jsonError } from '../../_lib/auth/http.js';
import {
  PRODUCTS,
  PERMISSIONS,
  PACKAGES,
  CATALOGUE,
  PACKAGE_CATALOGUE,
} from '../../_lib/auth/schema.js';

const REC_ID_RE = /^rec[A-Za-z0-9]{14}$/;

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

  const catalogueItemId = String(body.catalogueItemId || '').trim();
  const packageId = String(body.packageId || '').trim();
  const includedByDefault = body.includedByDefault === true;

  if (!REC_ID_RE.test(catalogueItemId)) {
    return jsonError(res, 400, 'invalid_catalogue_id', 'catalogueItemId must be a valid record id');
  }
  if (!REC_ID_RE.test(packageId)) {
    return jsonError(res, 400, 'invalid_package_id', 'packageId must be a valid record id');
  }
  if (typeof body.includedByDefault !== 'boolean') {
    return jsonError(res, 400, 'invalid_included', 'includedByDefault must be true or false');
  }

  // Confirm both ends of the link exist (avoids orphan join rows).
  try {
    const [pkg, item] = await Promise.all([
      getRecord(PACKAGES.tableId, packageId).catch((err) => {
        if (err?.status === 404) return null;
        throw err;
      }),
      getRecord(CATALOGUE.tableId, catalogueItemId).catch((err) => {
        if (err?.status === 404) return null;
        throw err;
      }),
    ]);
    if (!pkg) return jsonError(res, 404, 'package_not_found', 'No package with that id');
    if (!item) return jsonError(res, 404, 'catalogue_item_not_found', 'No catalogue item with that id');
  } catch (err) {
    console.error('[admin/catalogue/set-package] existence check failed:', err);
    return jsonError(res, 500, 'internal_error', 'Could not verify package or product');
  }

  // Find the existing join row for this (package, item) pair.
  let existing = null;
  try {
    const allJoins = await listAllRecords(PACKAGE_CATALOGUE.tableId);
    existing = allJoins.find((j) => {
      const pkgs = j.fields[PACKAGE_CATALOGUE.fields.package] || [];
      const cats = j.fields[PACKAGE_CATALOGUE.fields.catalogueItem] || [];
      return pkgs.includes(packageId) && cats.includes(catalogueItemId);
    }) || null;
  } catch (err) {
    console.error('[admin/catalogue/set-package] failed listing joins:', err);
    return jsonError(res, 500, 'internal_error', 'Could not load package matrix');
  }

  try {
    let action;
    let joinId = existing ? existing.id : null;

    if (includedByDefault) {
      if (existing) {
        await updateRecord(PACKAGE_CATALOGUE.tableId, existing.id, {
          [PACKAGE_CATALOGUE.fields.includedByDefault]: true,
        });
        action = 'updated';
      } else {
        const created = await createRecord(PACKAGE_CATALOGUE.tableId, {
          [PACKAGE_CATALOGUE.fields.package]: [packageId],
          [PACKAGE_CATALOGUE.fields.catalogueItem]: [catalogueItemId],
          [PACKAGE_CATALOGUE.fields.includedByDefault]: true,
          [PACKAGE_CATALOGUE.fields.availableAsAddOn]: false,
          [PACKAGE_CATALOGUE.fields.addOnMonthlyPrice]: null,
        });
        joinId = created.id;
        action = 'created';
      }
    } else {
      if (existing) {
        const stillAddOn = !!existing.fields[PACKAGE_CATALOGUE.fields.availableAsAddOn];
        if (stillAddOn) {
          await updateRecord(PACKAGE_CATALOGUE.tableId, existing.id, {
            [PACKAGE_CATALOGUE.fields.includedByDefault]: false,
          });
          action = 'updated';
        } else {
          await bulkDeleteRecords(PACKAGE_CATALOGUE.tableId, [existing.id]);
          joinId = null;
          action = 'deleted';
        }
      } else {
        action = 'noop';
      }
    }

    return res.status(200).json({ ok: true, includedByDefault, action, joinId });
  } catch (err) {
    console.error('[admin/catalogue/set-package] write failed:', err);
    return jsonError(res, 500, 'internal_error', 'Failed to update package matrix');
  }
}
