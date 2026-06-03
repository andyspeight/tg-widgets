/**
 * GET /api/auth/staff-clients
 *
 * Staff-only. Returns every LIVE (Active) client account so a Travelgenix
 * staff member can pick one to "act as" and set up that client's widgets.
 *
 * Contrast with /api/auth/companies, which returns only the clients the
 * current user is personally linked to (the membership switcher on /home).
 * This endpoint returns the full live client list and is therefore gated
 * strictly to Travelgenix staff via isTravelgenixStaff(). Non-staff get a
 * 403 and never see the list.
 *
 * This single endpoint also doubles as the staff gate for the front-end
 * switcher: the browser calls it on load, renders the switcher on 200, and
 * renders nothing on 401/403. So the picker is invisible to non-staff with
 * no separate "am I staff" round-trip.
 *
 * Response: { ok:true, clients:[{ id, name, plan, status }], currentClientId }
 *
 * "Live" is defined as Status === 'Active'. If a different status vocabulary
 * is introduced later (e.g. a dedicated 'Live'), broaden the filter below.
 */

import { setCors, requireMethod, jsonOk, jsonError } from '../_lib/auth/http.js';
import { requireAuth } from '../_lib/auth/middleware.js';
import { listAllRecords } from '../_lib/auth/airtable.js';
import { CLIENTS } from '../_lib/auth/schema.js';
import { isTravelgenixStaff } from '../_lib/auth/staff.js';

export default async function handler(req, res) {
  if (setCors(req, res)) return;
  if (!requireMethod(req, res, 'GET')) return;

  const ctx = await requireAuth(req, res);
  if (!ctx) return;

  // Hard staff gate. This is the single control on a capability that lets the
  // caller act inside any client account, so it fails closed.
  if (!isTravelgenixStaff(ctx)) {
    return jsonError(res, 403, 'not_staff', 'Staff access required');
  }

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
    // Live = Active, and must have a company name to show in the picker.
    .filter((c) => c.status.toLowerCase() === 'active' && c.name)
    .sort((a, b) => a.name.localeCompare(b.name));

  res.setHeader('Cache-Control', 'private, max-age=30');
  return jsonOk(res, { clients, currentClientId: ctx.clientRecordId || null });
}
