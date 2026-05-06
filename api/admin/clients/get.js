/**
 * GET /api/admin/clients/get?id=recXXX
 *
 * Returns a single client record with everything the detail view needs:
 *   - The client's own fields
 *   - The package details
 *   - The full entitlements grid (every catalogue item, with current
 *     enabled state for this client)
 *   - The users belonging to this client
 *
 * Three parallel reads keeps latency low.
 *
 * Auth: widget_suite owner or admin.
 */

import { requireAuth, requireProductAccess } from '../../_lib/auth/middleware.js';
import { getRecord, listAllRecords } from '../../_lib/auth/airtable.js';
import { jsonError } from '../../_lib/auth/http.js';
import {
  PRODUCTS,
  PERMISSIONS,
  CLIENTS,
  PACKAGES,
  USERS,
  CATALOGUE,
  CLIENT_ENTITLEMENTS,
} from '../../_lib/auth/schema.js';

const REC_ID_RE = /^rec[A-Za-z0-9]{14}$/;

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

  const id = String(req.query?.id || '').trim();
  if (!REC_ID_RE.test(id)) {
    return jsonError(res, 400, 'invalid_id', 'id query param must be a valid record id');
  }

  try {
    const [client, packages, users, catalogue, entitlements] = await Promise.all([
      getRecord(CLIENTS.tableId, id).catch((err) => {
        if (err?.status === 404) return null;
        throw err;
      }),
      listAllRecords(PACKAGES.tableId),
      listAllRecords(USERS.tableId),
      listAllRecords(CATALOGUE.tableId),
      listAllRecords(CLIENT_ENTITLEMENTS.tableId),
    ]);

    if (!client) {
      return jsonError(res, 404, 'client_not_found', 'No client with that id');
    }

    // Resolve the package (if any)
    const pkgIds = client.fields[CLIENTS.fields.package] || [];
    const pkgRec = pkgIds.length ? packages.find((p) => p.id === pkgIds[0]) : null;
    const pkg = pkgRec
      ? {
          id: pkgRec.id,
          name: pkgRec.fields[PACKAGES.fields.packageName] || '',
          code: pkgRec.fields[PACKAGES.fields.packageCode] || '',
          monthlyPrice: pkgRec.fields[PACKAGES.fields.monthlyPrice] ?? null,
          setupFee: pkgRec.fields[PACKAGES.fields.setupFee] ?? null,
        }
      : null;

    // Filter users to those linked to this client
    const clientUsers = users
      .filter((u) => (u.fields[USERS.fields.client] || []).includes(id))
      .map((u) => ({
        id: u.id,
        email: u.fields[USERS.fields.email] || '',
        fullName: u.fields[USERS.fields.fullName] || '',
        role: u.fields[USERS.fields.role] || '',
        status: u.fields[USERS.fields.status] || '',
        lastLogin: u.fields[USERS.fields.lastLogin] || null,
      }))
      .sort((a, b) => {
        // Owners first, then admins, then members. Within group, by name.
        const roleOrder = { owner: 0, admin: 1, member: 2 };
        const ra = roleOrder[a.role] ?? 99;
        const rb = roleOrder[b.role] ?? 99;
        if (ra !== rb) return ra - rb;
        return (a.fullName || a.email).localeCompare(b.fullName || b.email);
      });

    // Build the entitlements grid: every active catalogue item, with the
    // client's current enabled/source state if a row exists for them.
    const entitlementByCatalogueId = new Map();
    for (const e of entitlements) {
      const clientIds = e.fields[CLIENT_ENTITLEMENTS.fields.client] || [];
      if (!clientIds.includes(id)) continue;
      const catIds = e.fields[CLIENT_ENTITLEMENTS.fields.catalogueItem] || [];
      for (const cid of catIds) {
        entitlementByCatalogueId.set(cid, e);
      }
    }

    const entitlementGrid = catalogue
      .filter((c) => !!c.fields[CATALOGUE.fields.active])
      .map((c) => {
        const ent = entitlementByCatalogueId.get(c.id);
        return {
          catalogueItemId: c.id,
          productCode: c.fields[CATALOGUE.fields.productCode] || '',
          productName: c.fields[CATALOGUE.fields.productName] || '',
          category: c.fields[CATALOGUE.fields.category] || '',
          sortOrder: c.fields[CATALOGUE.fields.sortOrder] ?? 999,
          entitlementId: ent?.id || null,
          enabled: ent ? !!ent.fields[CLIENT_ENTITLEMENTS.fields.enabled] : false,
          source: ent ? ent.fields[CLIENT_ENTITLEMENTS.fields.source] || '' : '',
          activatedDate: ent?.fields[CLIENT_ENTITLEMENTS.fields.activatedDate] || null,
          notes: ent?.fields[CLIENT_ENTITLEMENTS.fields.notes] || '',
        };
      })
      .sort((a, b) => a.sortOrder - b.sortOrder);

    // Group by category for the UI
    const entitlementsByCategory = {};
    for (const cat of CATALOGUE.categoryOrder) entitlementsByCategory[cat] = [];
    for (const row of entitlementGrid) {
      if (!entitlementsByCategory[row.category]) entitlementsByCategory[row.category] = [];
      entitlementsByCategory[row.category].push(row);
    }

    return res.status(200).json({
      client: {
        id: client.id,
        clientName: client.fields[CLIENTS.fields.clientName] || '',
        tradingName: client.fields[CLIENTS.fields.tradingName] || '',
        primaryEmail: client.fields[CLIENTS.fields.email] || '',
        primaryContactName: client.fields[CLIENTS.fields.primaryContactName] || '',
        primaryContactPhone: client.fields[CLIENTS.fields.primaryContactPhone] || '',
        websiteUrl: client.fields[CLIENTS.fields.websiteUrl] || '',
        travelifyAppId: client.fields[CLIENTS.fields.travelifyAppId] || '',
        travelifySiteId: client.fields[CLIENTS.fields.travelifySiteId] || '',
        status: client.fields[CLIENTS.fields.status] || '',
        plan: client.fields[CLIENTS.fields.plan] || '',
        mrr: client.fields[CLIENTS.fields.mrr] ?? null,
        setupFeeCharged: client.fields[CLIENTS.fields.setupFeeCharged] ?? null,
        setupDate: client.fields[CLIENTS.fields.setupDate] || null,
        goLiveDate: client.fields[CLIENTS.fields.goLiveDate] || null,
        createdAt: client.fields[CLIENTS.fields.createdAt] || null,
        lastLogin: client.fields[CLIENTS.fields.lastLogin] || null,
        notes: client.fields[CLIENTS.fields.notes] || '',
      },
      package: pkg,
      users: clientUsers,
      entitlements: entitlementGrid,
      entitlementsByCategory,
      categoryOrder: CATALOGUE.categoryOrder,
    });
  } catch (err) {
    console.error('[admin/clients/get] error:', err);
    return jsonError(res, 500, 'internal_error', 'Failed to load client');
  }
}
