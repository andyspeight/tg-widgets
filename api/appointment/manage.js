/**
 * /api/appointment/manage — view, cancel or reschedule a booking by token.
 *
 * GET  ?token=...                       → booking summary (sanitised)
 * POST { token, action: 'cancel' }      → cancel + remove the calendar event
 * POST { token, action: 'reschedule', startISO } → move to a new slot
 *
 * The token is the unguessable manage token minted at booking time; it is the
 * only credential needed (the link is what gets emailed to the visitor).
 */
import { resolveWidget, pickEvent } from '../_lib/calendar/state.js';
import { isValidSlot } from '../_lib/calendar/slots.js';
import { getBookingByToken, saveBooking, getAccessToken, placeHold, releaseHold } from '../_lib/calendar/store.js';
import * as google from '../_lib/calendar/google.js';
import { sendCancelled, sendRescheduled } from '../_lib/calendar/mail.js';

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

  const token = (req.method === 'GET') ? (req.query && req.query.token) : (req.body && req.body.token);
  if (!token) return res.status(400).json({ error: 'token required' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }

  const booking = await getBookingByToken(token);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });

  if (req.method === 'GET') return res.status(200).json({ ok: true, booking: publicView(booking) });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const action = body && body.action;

  // ── Cancel ──
  if (action === 'cancel') {
    if (booking.status === 'cancelled') return res.status(200).json({ ok: true, booking: publicView(booking) });
    try {
      if (booking.providerEventId) {
        const tok = await getAccessToken(booking.clientRecordId);
        if (tok) await google.deleteEvent(tok.accessToken, tok.calendarId, booking.providerEventId);
      }
    } catch (e) { console.error('[manage] cancel event:', e.message); }
    await releaseHold(booking.clientRecordId, booking.startISO);
    booking.status = 'cancelled';
    booking.cancelledAt = new Date().toISOString();
    await saveBooking(booking);
    await sendCancelled(booking);
    return res.status(200).json({ ok: true, booking: publicView(booking) });
  }

  // ── Reschedule ──
  if (action === 'reschedule') {
    if (booking.status === 'cancelled') return res.status(409).json({ error: 'This booking was cancelled.' });
    const newStart = String(body.startISO || '');
    if (!Number.isFinite(Date.parse(newStart))) return res.status(400).json({ error: 'A valid new time is required' });

    const w = await resolveWidget(booking.widgetId);
    if (!w) return res.status(404).json({ error: 'Widget not found' });
    const ev = pickEvent(w.config || {}, booking.eventId);
    if (!isValidSlot(w.config || {}, ev, newStart)) return res.status(409).json({ error: 'That time is not available. Please pick another.' });

    const startMs = Date.parse(newStart);
    const endMs = startMs + ev.mins * 60000;
    const endISO = new Date(endMs).toISOString();

    const held = await placeHold(booking.clientRecordId, newStart, booking.ref);
    if (!held) return res.status(409).json({ error: 'Someone just took that time. Please pick another.' });

    try {
      const tok = await getAccessToken(booking.clientRecordId);
      if (tok) {
        const busy = await google.freeBusy(tok.accessToken, tok.calendarId, newStart, endISO);
        const clash = busy.some(b => Date.parse(b.start) < endMs && Date.parse(b.end) > startMs);
        if (clash) { await releaseHold(booking.clientRecordId, newStart); return res.status(409).json({ error: 'That time was just booked. Please pick another.' }); }
        if (booking.providerEventId) {
          await google.patchEvent(tok.accessToken, tok.calendarId, booking.providerEventId, {
            start: { dateTime: newStart, timeZone: booking.hostTimezone || 'UTC' },
            end: { dateTime: endISO, timeZone: booking.hostTimezone || 'UTC' },
          });
        }
      }
    } catch (e) { console.error('[manage] reschedule event:', e.message); }

    await releaseHold(booking.clientRecordId, booking.startISO);
    booking.startISO = newStart;
    booking.endISO = endISO;
    booking.rescheduledAt = new Date().toISOString();
    await saveBooking(booking);
    const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0];
    const manageUrl = booking.manageToken ? (proto + '://' + req.headers.host + '/manage-booking?token=' + booking.manageToken) : '';
    await sendRescheduled(booking, { manageUrl });
    return res.status(200).json({ ok: true, booking: publicView(booking) });
  }

  return res.status(400).json({ error: 'Unknown action' });
}
