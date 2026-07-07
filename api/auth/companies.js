/**
 * GET /api/auth/companies
 *
 * Returns the list of companies (clients) the current authenticated user
 * is linked to. Powers the company-switcher dropdown on the dashboard
 * launchpad (/dashboard.html).
 *
 * Response shape:
 *   {
 *     ok: true,
 *     companies: [
 *       {
 *         id:           'rec...',
 *         name:         'Demo Travel Company',
 *         status:       'active' | 'suspended' | ...,
 *         packageName:  'Ignite',
 *         packageCode:  'ignite',
 *         current:      true   // matches the user's current session's clientId
 *       },
 *       ...
 *     ],
 *     currentClientId: 'rec...'
 *   }
 *
 * Auth: any valid session. We use ctx.userRecordId to find the user's linked
 * clients — NOT ctx.clientRecordId (which is only the current one).
 *
 * Performance: one read for the user record, then a parallel batch for each
 * linked client and their packages. Typical users have 1–3 linked companies
 * so this is cheap.
 */

import { setCors, requireMethod, jsonOk } from '../_lib/auth/http.js';
import { requireAuth } from '../_lib/auth/middleware.js';
import { getRecord } from '../_lib/auth/airtable.js';
import { USERS, CLIENTS, PACKAGES } from '../_lib/auth/schema.js';

export default async function handler(req, res) {
  if (setCors(req, res)) return;
  if (!requireMethod(req, res, 'GET')) return;

  const ctx = await requireAuth(req, res);
  if (!ctx) return;

  // Load the user record to get their full client links list. ctx.permissions
  // is keyed on product, not client, so doesn't carry the company list.
  let userRec;
  try {
    userRec = await getRecord(USERS.tableId, ctx.userRecordId);
  } catch (err) {
    console.error('[auth/companies] failed to load user record:', err.message);
    return jsonOk(res, { companies: [], currentClientId: ctx.clientRecordId || null });
  }

  const clientIds = userRec.fields[USERS.fields.client] || [];

  // Load each client + their package in parallel
  const clientResults = await Promise.all(
    clientIds.map(async (cid) => {
      try {
        const c = await getRecord(CLIENTS.tableId, cid);
        const pkgLinks = c.fields[CLIENTS.fields.package] || [];
        let packageName = '';
        let packageCode = '';
        if (pkgLinks.length > 0) {
          const pkgRec = await getRecord(PACKAGES.tableId, pkgLinks[0]).catch(() => null);
          if (pkgRec) {
            packageName = pkgRec.fields[PACKAGES.fields.packageName] || '';
            packageCode = pkgRec.fields[PACKAGES.fields.packageCode] || '';
          }
        }
        return {
          id: c.id,
          name: c.fields[CLIENTS.fields.clientName] || '',
          status: c.fields[CLIENTS.fields.status] || '',
          packageName,
          packageCode,
          current: c.id === ctx.clientRecordId,
        };
      } catch (err) {
        console.warn('[auth/companies] could not load client', cid, ':', err.message);
        return null;
      }
    })
  );

  const companies = clientResults
    .filter(Boolean)
    // Sort: current first, then alphabetical by name
    .sort((a, b) => {
      if (a.current && !b.current) return -1;
      if (b.current && !a.current) return 1;
      return (a.name || '').localeCompare(b.name || '');
    });

  return jsonOk(res, {
    companies,
    currentClientId: ctx.clientRecordId || null,
  });
}
