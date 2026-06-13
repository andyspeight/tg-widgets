/**
 * POST /api/appointment/admin-action
 * Auth required. Lets the signed-in agency cancel or reschedule one of its own
 * bookings from the /bookings view. Ownership is checked against the booking's
 * clientRecordId; the work itself is the same shared logic the visitor uses.
 *
 * Body: { ref, action: 'cancel' | 'reschedule', startISO? }
 */
import { requireAuth } from '../_lib/auth/middleware.js';
import { getBooking } from '../_lib/calendar/store.js';
import { cancelBooking, rescheduleBooking } from '../_lib/calendar/actions.js';

function view(b) {
  return { ref: b.ref, status: b.status, startISO: b.startISO, endISO: b.endISO, eventLabel: b.eventLabel, timezone: b.hostTimezone };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const ctx = await requireAuth(req, res);
  if (!ctx) return;

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const ref = body && body.ref;
  const action = body && body.action;
  if (!ref) return res.status(400).json({ error: 'ref required' });

  const booking = await getBooking(ref);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });
  if (!booking.clientRecordId || booking.clientRecordId !== ctx.clientRecordId) {
    return res.status(403).json({ error: 'Not your booking' });
  }

  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const origin = proto + '://' + req.headers.host;

  if (action === 'cancel') {
    const r = await cancelBooking(booking);
    return res.status(200).json({ ok: true, booking: view(r.booking) });
  }
  if (action === 'reschedule') {
    const r = await rescheduleBooking(booking, String(body.startISO || ''), { origin });
    if (!r.ok) return res.status(r.status || 400).json({ error: r.error });
    return res.status(200).json({ ok: true, booking: view(r.booking) });
  }
  return res.status(400).json({ error: 'Unknown action' });
}
