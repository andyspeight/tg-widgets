/**
 * Shared cancel / reschedule logic for a booking.
 *
 * Used by both /api/appointment/manage (visitor, authed by manage token) and
 * /api/appointment/admin-action (agency, authed by client ownership) so the two
 * paths behave identically: provider event update, hold release, day-count
 * bookkeeping, persistence and the lifecycle email.
 */
import { resolveWidget, pickEvent } from './state.js';
import { isValidSlot, hostDateKey } from './slots.js';
import { getAccessToken, getZoomAccessToken, saveBooking, placeHold, releaseHold, getDayCount, incDayCount, decDayCount } from './store.js';
import { getProvider } from './providers.js';
import * as zoom from './zoom.js';
import { sendCancelled, sendRescheduled } from './mail.js';

export async function cancelBooking(booking) {
  if (booking.status === 'cancelled') return { ok: true, booking };
  try {
    if (booking.providerEventId) {
      const tok = await getAccessToken(booking.clientRecordId);
      if (tok) await getProvider(tok.provider).deleteEvent(tok.accessToken, tok.calendarId, booking.providerEventId);
    }
  } catch (e) { console.error('[actions.cancel]', e.message); }
  // The per-booking Zoom meeting dies with the booking.
  try {
    if (booking.zoomMeetingId) {
      const ztok = await getZoomAccessToken(booking.clientRecordId);
      if (ztok) await zoom.deleteMeeting(ztok.accessToken, booking.zoomMeetingId);
    }
  } catch (e) { console.error('[actions.cancel.zoom]', e.message); }
  await releaseHold(booking.clientRecordId, booking.startISO);
  if (booking.dayCounted) await decDayCount(booking.clientRecordId, hostDateKey(booking.startISO, booking.hostTimezone));
  booking.status = 'cancelled';
  booking.cancelledAt = new Date().toISOString();
  await saveBooking(booking);
  await sendCancelled(booking);
  return { ok: true, booking };
}

export async function rescheduleBooking(booking, newStart, opts) {
  opts = opts || {};
  if (booking.status === 'cancelled') return { ok: false, status: 409, error: 'This booking was cancelled.' };
  if (!Number.isFinite(Date.parse(newStart))) return { ok: false, status: 400, error: 'A valid new time is required' };

  const w = await resolveWidget(booking.widgetId);
  if (!w) return { ok: false, status: 404, error: 'Widget not found' };
  const ev = pickEvent(w.config || {}, booking.eventId);
  if (!isValidSlot(w.config || {}, ev, newStart)) return { ok: false, status: 409, error: 'That time is not available. Please pick another.' };

  const cap = Math.max(0, Number((w.config || {}).dailyCap) || 0);
  const oldDay = hostDateKey(booking.startISO, booking.hostTimezone);
  const newDay = hostDateKey(newStart, booking.hostTimezone);
  if (booking.dayCounted && cap > 0 && newDay !== oldDay && (await getDayCount(booking.clientRecordId, newDay)) >= cap) {
    return { ok: false, status: 409, error: 'That day is fully booked. Please pick another.' };
  }

  const startMs = Date.parse(newStart);
  const endMs = startMs + ev.mins * 60000;
  const endISO = new Date(endMs).toISOString();

  const held = await placeHold(booking.clientRecordId, newStart, booking.ref);
  if (!held) return { ok: false, status: 409, error: 'Someone just took that time. Please pick another.' };

  try {
    const tok = await getAccessToken(booking.clientRecordId);
    if (tok) {
      const provider = getProvider(tok.provider);
      const busy = await provider.freeBusy(tok.accessToken, tok.calendarId, newStart, endISO);
      const clash = busy.some(b => Date.parse(b.start) < endMs && Date.parse(b.end) > startMs);
      if (clash) { await releaseHold(booking.clientRecordId, newStart); return { ok: false, status: 409, error: 'That time was just booked. Please pick another.' }; }
      if (booking.providerEventId) {
        await provider.patchEvent(tok.accessToken, tok.calendarId, booking.providerEventId, {
          start: { dateTime: newStart, timeZone: booking.hostTimezone || 'UTC' },
          end: { dateTime: endISO, timeZone: booking.hostTimezone || 'UTC' },
        });
      }
    }
  } catch (e) { console.error('[actions.reschedule]', e.message); }
  // Move the per-booking Zoom meeting with it — the join link stays the same.
  try {
    if (booking.zoomMeetingId) {
      const ztok = await getZoomAccessToken(booking.clientRecordId);
      if (ztok) await zoom.updateMeeting(ztok.accessToken, booking.zoomMeetingId, { startISO: newStart, durationMins: ev.mins, timezone: booking.hostTimezone || 'UTC' });
    }
  } catch (e) { console.error('[actions.reschedule.zoom]', e.message); }

  await releaseHold(booking.clientRecordId, booking.startISO);
  booking.startISO = newStart;
  booking.endISO = endISO;
  booking.rescheduledAt = new Date().toISOString();
  await saveBooking(booking);
  if (booking.dayCounted && newDay !== oldDay) { await decDayCount(booking.clientRecordId, oldDay); await incDayCount(booking.clientRecordId, newDay); }

  const manageUrl = (opts.origin && booking.manageToken) ? (opts.origin + '/manage-booking?token=' + booking.manageToken) : '';
  await sendRescheduled(booking, { manageUrl });
  return { ok: true, booking };
}
