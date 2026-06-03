/**
 * GET /api/auth/staff-clients
 *
 * Staff-only. Returns every LIVE (Active) client account so a Travelgenix
 * staff member can pick one to "act as" and set up that client's widgets,
 * plus the context the front-end needs to render the act-as UI.
 *
 * Contrast with /api/auth/companies, which returns only the clients the
 * current user is personally linked to. This returns the full live list and
 * is gated strictly to staff via isTravelgenixStaff(); non-staff get 403 and
 * never see it. The 403/200 split also doubles as the front-end staff gate —
 * the switcher renders only on a 200.
 *
 * Response:
 *   {
 *     ok: true,
 *     clients: [{ id, name, plan, status }],   // all live clients, sorted
 *     currentClientId: 'rec...' | null,         // the session's active client
 *     homeClientId:    'rec...' | null,         // the staff user's own client
 *     impersonating:   true | false             // acting as a non-home client
 *   }
 *
 * "Live" = Status === 'Active'.
 */

import { setCors, requireMethod, jsonOk, jsonError } from '../_lib/auth/http.js';
import { requireAuth } from '../_lib/auth/middleware.js';
import { listAllRecords, getRecord } from '../_lib/auth/airtable.js';
import { CLIENTS, USERS } from '../_lib/auth/schema.js';
import { isTravelgenixStaff } from '../_lib/auth/staff.js';

export default async function handler(req, res) {
  if (setCors(req, res)) return;
  if (!requireMethod(req, res, 'GET')) return;

  const ctx = await requireAuth(req, res);
  if (!ctx) return;

  // Hard staff gate — the single control on a capability that lets the caller
  // act inside any client account, so it fails closed.
  if (!isTravelgenixStaff(ctx)) {
    return jsonError(res, 403, 'not_staff', 'Staff access required');
  }

  // Resolve the staff user's own linked clients → home + impersonation flag.
  let linkedClientIds = [];
  try {
    const u = await getRecord(USERS.tableId, ctx.userRecordId);
    const links = u?.fields?.[USERS.fields.client];
    if (Array.isArray(links)) {
      linkedClientIds = links
        .map((x) => (typeof x === 'string' ? x : x && x.id))
        .filter(Boolean);
    }
  } catch (err) {
    console.warn('[auth/staff-clients] could not load user links:', err.message);
  }
  const homeClientId = linkedClientIds[0] || null;
  const currentClientId = ctx.clientRecordId || null;
  const impersonating = !!currentClientId && !linkedClientIds.includes(currentClientId);

  let records;
  try {
    records = await listAllRecords(CLIENTS.tableId);
  } catch (err) {
    console.error('[auth/staff-clients] list failed:', err.message);
    return jsonError(res, 500, 'lookup_failed', 'Could not load clients');
  }

  const clients = records
    .map((c) => ({
      id: c.id,
      name: c.fields[CLIENTS.fields.clientName] || '',
      plan: c.fields[CLIENTS.fields.plan] || '',
      status: String(c.fields[CLIENTS.fields.status] || '').trim(),
    }))
    .filter((c) => c.status.toLowerCase() === 'active' && c.name)
    .sort((a, b) => a.name.localeCompare(b.name));

  res.setHeader('Cache-Control', 'private, max-age=30');
  return jsonOk(res, { clients, currentClientId, homeClientId, impersonating });
}
