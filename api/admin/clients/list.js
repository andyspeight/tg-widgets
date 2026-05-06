/**
 * GET /api/admin/clients/list
 *
 * Returns the list of all clients for the Clients tab. Includes
 * package name, MRR, contact, status, and counts of users + entitlements
 * so the table can show summary info without N+1 lookups.
 *
 * Optional query params:
 *   q       — search string, matches client name, trading name, primary email
 *   status  — filter by status value
 *   package — filter by package record id
 *
 * Auth: widget_suite owner or admin.
 */

import { requireAuth, requireProductAccess } from '../../_lib/auth/middleware.js';
import { listAllRecords } from '../../_lib/auth/airtable.js';
import { jsonError } from '../../_lib/auth/http.js';
import {
  PRODUCTS,
  PERMISSIONS,
  CLIENTS,
  PACKAGES,
  USERS,
  CLIENT_ENTITLEMENTS,
} from '../../_lib/auth/schema.js';

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

  const q = String(req.query?.q || '').trim().toLowerCase();
  const statusFilter = String(req.query?.status || '').trim();
  const packageFilter = String(req.query?.package || '').trim();

  try {
    // Pull everything we need in parallel
    const [clients, packages, users, entitlements] = await Promise.all([
      listAllRecords(CLIENTS.tableId),
      listAllRecords(PACKAGES.tableId),
      listAllRecords(USERS.tableId),
      listAllRecords(CLIENT_ENTITLEMENTS.tableId),
    ]);

    // Build package lookup map for name resolution
    const packageById = new Map();
    for (const p of packages) {
      packageById.set(p.id, {
        id: p.id,
        name: p.fields[PACKAGES.fields.packageName] || '',
        code: p.fields[PACKAGES.fields.packageCode] || '',
      });
    }

    // Build user count per client
    const userCountByClient = new Map();
    for (const u of users) {
      const clientIds = u.fields[USERS.fields.client] || [];
      for (const cid of clientIds) {
        userCountByClient.set(cid, (userCountByClient.get(cid) || 0) + 1);
      }
    }

    // Build entitlement count per client (only count enabled ones)
    const entitlementCountByClient = new Map();
    for (const e of entitlements) {
      if (!e.fields[CLIENT_ENTITLEMENTS.fields.enabled]) continue;
      const clientIds = e.fields[CLIENT_ENTITLEMENTS.fields.client] || [];
      for (const cid of clientIds) {
        entitlementCountByClient.set(cid, (entitlementCountByClient.get(cid) || 0) + 1);
      }
    }

    // Build the result rows
    const rows = clients.map((c) => {
      const pkgIds = c.fields[CLIENTS.fields.package] || [];
      const pkg = pkgIds.length ? packageById.get(pkgIds[0]) : null;

      return {
        id: c.id,
        clientName: c.fields[CLIENTS.fields.clientName] || '',
        tradingName: c.fields[CLIENTS.fields.tradingName] || '',
        primaryEmail: c.fields[CLIENTS.fields.email] || '',
        primaryContactName: c.fields[CLIENTS.fields.primaryContactName] || '',
        websiteUrl: c.fields[CLIENTS.fields.websiteUrl] || '',
        status: c.fields[CLIENTS.fields.status] || '',
        plan: c.fields[CLIENTS.fields.plan] || '',
        package: pkg,
        mrr: c.fields[CLIENTS.fields.mrr] ?? null,
        setupDate: c.fields[CLIENTS.fields.setupDate] || null,
        goLiveDate: c.fields[CLIENTS.fields.goLiveDate] || null,
        lastLogin: c.fields[CLIENTS.fields.lastLogin] || null,
        userCount: userCountByClient.get(c.id) || 0,
        entitlementCount: entitlementCountByClient.get(c.id) || 0,
      };
    });

    // Apply filters
    let filtered = rows;
    if (q) {
      filtered = filtered.filter((r) =>
        r.clientName.toLowerCase().includes(q) ||
        r.tradingName.toLowerCase().includes(q) ||
        r.primaryEmail.toLowerCase().includes(q) ||
        r.primaryContactName.toLowerCase().includes(q)
      );
    }
    if (statusFilter) {
      filtered = filtered.filter((r) => r.status === statusFilter);
    }
    if (packageFilter) {
      filtered = filtered.filter((r) => r.package?.id === packageFilter);
    }

    // Sort by client name
    filtered.sort((a, b) => a.clientName.localeCompare(b.clientName));

    return res.status(200).json({
      clients: filtered,
      total: rows.length,
      packages: Array.from(packageById.values()).sort((a, b) =>
        a.name.localeCompare(b.name)
      ),
    });
  } catch (err) {
    console.error('[admin/clients/list] error:', err);
    return jsonError(res, 500, 'internal_error', 'Failed to load clients');
  }
}
