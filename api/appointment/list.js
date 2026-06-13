/**
 * GET /api/appointment/list?from=&to=&days=
 * Auth required. Returns the signed-in client's bookings in a time window
 * (default: now .. +60 days), newest-soonest first. Read-only agency view.
 */
import { requireAuth } from '../_lib/auth/middleware.js';
import { listBookings, storageReady } from '../_lib/calendar/store.js';

function view(b) {
  const v = b.invitee || {};
  return {
    ref: b.ref, status: b.status, eventLabel: b.eventLabel, durationMins: b.durationMins, mode: b.mode,
    startISO: b.startISO, endISO: b.endISO, timezone: b.hostTimezone,
    widgetId: b.widgetId || '', eventId: b.eventId || '',
    name: v.name || '', email: v.email || '', phone: v.phone || '',
    answers: v.answers || {}, calendarLink: b.calendarLink || '', createdAt: b.createdAt,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const ctx = await requireAuth(req, res);
  if (!ctx) return;
  if (!storageReady()) return res.status(200).json({ ok: true, bookings: [], storage: false });

  const q = req.query || {};
  const now = Date.now();
  const fromMs = q.from && Number.isFinite(Date.parse(q.from)) ? Date.parse(q.from) : now;
  const days = Math.max(1, Math.min(180, Number(q.days) || 60));
  const toMs = q.to && Number.isFinite(Date.parse(q.to)) ? Date.parse(q.to) : (fromMs + days * 86400000);

  try {
    const bookings = await listBookings(ctx.clientRecordId, fromMs, toMs);
    return res.status(200).json({ ok: true, storage: true, bookings: bookings.map(view) });
  } catch (e) {
    return res.status(500).json({ error: 'Could not load bookings' });
  }
}
