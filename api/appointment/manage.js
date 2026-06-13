/**
 * /api/appointment/manage — view, cancel or reschedule a booking by token.
 *
 * GET  ?token=...                       → booking summary (sanitised)
 * POST { token, action: 'cancel' }      → cancel + remove the calendar event
 * POST { token, action: 'reschedule', startISO } → move to a new slot
 *
 * The token is the unguessable manage token minted at booking time; it is the
 * only credential needed (the link is what gets emailed to the visitor). The
 * cancel/reschedule work itself lives in _lib/calendar/actions.js, shared with
 * the agency-side endpoint.
 */
import { getBookingByToken } from '../_lib/calendar/store.js';
import { cancelBooking, rescheduleBooking } from '../_lib/calendar/actions.js';
import { checkRateLimit } from '../_lib/auth/ratelimit.js';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
}

function publicView(b) {
  return {
    ref: b.ref, status: b.status,
    eventLabel: b.eventLabel, durationMins: b.durationMins, mode: b.mode,
    startISO: b.startISO, endISO: b.endISO,
    timezone: b.visitorTimezone || b.hostTimezone,
    name: b.invitee && b.invitee.name, calendarLink: b.calendarLink || '',
    widgetId: b.widgetId, eventId: b.eventId,
  };
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const token = (req.method === 'GET') ? (req.query && req.query.token) : (body && body.token);
  if (!token) return res.status(400).json({ error: 'token required' });

  const booking = await getBookingByToken(token);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });

  if (req.method === 'GET') return res.status(200).json({ ok: true, booking: publicView(booking) });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Rate limit the mutating actions by token, so a single leaked manage link
  // can't be used to spam cancel/reschedule emails. Fail-open.
  const rl = await checkRateLimit({ bucket: 'aptManage', key: String(token).slice(0, 64), max: 12, windowSeconds: 600, failClosed: false });
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retryAfterSeconds || 600));
    return res.status(429).json({ error: 'Too many changes in a short time. Please try again shortly.' });
  }

  const action = body && body.action;
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const origin = proto + '://' + req.headers.host;

  if (action === 'cancel') {
    const r = await cancelBooking(booking);
    return res.status(200).json({ ok: true, booking: publicView(r.booking) });
  }
  if (action === 'reschedule') {
    const r = await rescheduleBooking(booking, String(body.startISO || ''), { origin });
    if (!r.ok) return res.status(r.status || 400).json({ error: r.error });
    return res.status(200).json({ ok: true, booking: publicView(r.booking) });
  }
  return res.status(400).json({ error: 'Unknown action' });
}
