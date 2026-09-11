/**
 * GET /api/appointment/list?from=&to=&days=&scope=
 * Auth required. Returns bookings in a time window (default: now .. +60 days),
 * soonest first. Read-only.
 *
 * By default this is the agency view: every booking for the client, which is
 * what the bookings page wants. ?scope=self narrows it to schedulers the
 * CALLER owns, which is what a personal tool wants — the browser extension
 * asks for it, so one person's panel no longer lists a colleague's meetings
 * (reported 11 Sep 2026). It mirrors ?scope=self on /api/widget-list, and
 * matches on the same field: the widget's ClientEmail, recorded on every
 * booking when it is made.
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
    answers: v.answers || {}, calendarLink: b.calendarLink || '', meetingUrl: b.meetingUrl || '', createdAt: b.createdAt,
    sourceUrl: b.sourceUrl || '',
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const ctx = await requireAuth(req, res);
  if (!ctx) return;
  // One person's bookings are never cacheable. Without this the response
  // carried an ETag and revalidated as 304, so a browser kept showing the body
  // it had fetched BEFORE a fix shipped. Seen in the runtime log on 11 Sep 2026
  // while chasing exactly that.
  res.setHeader('Cache-Control', 'private, no-store');
  if (!storageReady()) return res.status(200).json({ ok: true, bookings: [], storage: false });

  const q = req.query || {};
  const now = Date.now();
  const fromMs = q.from && Number.isFinite(Date.parse(q.from)) ? Date.parse(q.from) : now;
  const days = Math.max(1, Math.min(180, Number(q.days) || 60));
  const toMs = q.to && Number.isFinite(Date.parse(q.to)) ? Date.parse(q.to) : (fromMs + days * 86400000);

  const self = String(q.scope || '').toLowerCase() === 'self';
  const me = String(ctx.email || '').toLowerCase().trim();

  try {
    let bookings = await listBookings(ctx.clientRecordId, fromMs, toMs);
    // Fail CLOSED: asked for my own and we cannot tell who I am, show none
    // rather than everyone's.
    if (self) bookings = me ? bookings.filter((b) => String(b.clientEmail || '').toLowerCase().trim() === me) : [];
    return res.status(200).json({ ok: true, storage: true, scope: self ? 'self' : 'client', bookings: bookings.map(view) });
  } catch (e) {
    return res.status(500).json({ error: 'Could not load bookings' });
  }
}
