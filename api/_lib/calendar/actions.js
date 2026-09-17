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
      // booking.clientEmail is the scheduler's owner, recorded when the booking
      // was made, so a cancel reaches the same calendar the event was put into.
      const tok = await getAccessToken(booking.clientRecordId, booking.clientEmail);
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
    const tok = await getAccessToken(booking.clientRecordId, booking.clientEmail);
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
  // A moved booking earns fresh reminders for its new time (previously a
  // rescheduled booking never got another reminder at all).
  booking.remindersSent = [];
  booking.reminded = false;
  delete booking.remindedAt;
  await saveBooking(booking);
  if (booking.dayCounted && newDay !== oldDay) { await decDayCount(booking.clientRecordId, oldDay); await incDayCount(booking.clientRecordId, newDay); }

  const manageUrl = (opts.origin && booking.manageToken) ? (opts.origin + '/manage-booking?token=' + booking.manageToken) : '';
  await sendRescheduled(booking, { manageUrl });
  return { ok: true, booking };
}

/**
 * Put a booking into the scheduler owner's calendar.
 *
 * Extracted from /api/appointment/book on 17 Sep 2026 so the backfill below and
 * a live booking cannot drift: both create the same event, with the same
 * description, the same attendee and the same conference handling.
 *
 * Why a backfill was needed at all. Calendars became per-person on 11 Sep 2026,
 * and a connection made before that carries no recorded owner. Andy's did not
 * resolve afterwards, so /api/appointment/book took the bookings, sent both
 * confirmation emails and skipped the calendar write WITHOUT SAYING SO. He
 * found out by looking at his diary and not seeing the meeting. The lesson is
 * in the return value: this never throws, and it always says which of the three
 * things happened, so the caller can record it on the booking.
 *
 * Returns { status: 'created' | 'not-connected' | 'clash' | 'failed',
 *           providerEventId, calendarLink, meetingUrl, provider, error }
 */
export async function syncBookingToCalendar(booking, opts) {
  opts = opts || {};
  const out = {
    status: 'failed', providerEventId: '', calendarLink: '',
    meetingUrl: booking.meetingUrl || '', provider: '', error: '',
  };

  let tok;
  try {
    // The scheduler owner's calendar, never the agency's by default: a
    // colleague's connection must not swallow this person's bookings.
    tok = await getAccessToken(booking.clientRecordId, booking.clientEmail);
  } catch (e) {
    out.error = e.message || 'token lookup failed';
    return out;
  }
  if (!tok) { out.status = 'not-connected'; return out; }
  out.provider = tok.provider || 'google';

  const startMs = Date.parse(booking.startISO);
  const endMs = Date.parse(booking.endISO);
  const provider = getProvider(tok.provider);

  try {
    // Respect before/after buffers: the slot plus its buffers must be clear.
    // Skipped on a backfill, where the booking is already made and a clash is
    // something to tell the owner about rather than a reason to refuse.
    if (opts.checkClash) {
      const before = Math.max(0, Number(opts.bufferBefore) || 0) * 60000;
      const after = Math.max(0, Number(opts.bufferAfter) || 0) * 60000;
      const busy = await provider.freeBusy(
        tok.accessToken, tok.calendarId,
        new Date(startMs - before).toISOString(), new Date(endMs + after).toISOString(),
      );
      const clash = busy.some(b => Date.parse(b.start) < (endMs + after) && Date.parse(b.end) > (startMs - before));
      if (clash) { out.status = 'clash'; return out; }
    }

    const v = booking.invitee || {};
    const answers = v.answers || {};
    const descLines = [
      'Booked via the website scheduler.',
      'Visitor: ' + (v.name || '') + ' <' + (v.email || '') + '>' + (v.phone ? ', ' + v.phone : ''),
    ];
    Object.keys(answers).forEach((k) => { descLines.push(k + ': ' + answers[k]); });
    if (booking.meetingUrl) descLines.unshift('Join the meeting: ' + booking.meetingUrl);

    const created = await provider.insertEvent(tok.accessToken, tok.calendarId, {
      summary: (booking.eventLabel || 'Appointment') + ' with ' + (v.name || ''),
      description: descLines.join('\n'),
      start: { dateTime: booking.startISO, timeZone: booking.hostTimezone || 'UTC' },
      end: { dateTime: booking.endISO, timeZone: booking.hostTimezone || 'UTC' },
      location: booking.meetingUrl || opts.location || '',
      attendees: v.email ? [{ email: v.email, displayName: v.name || '' }] : [],
      reminders: { useDefault: true },
      // Video meetings still without a link (no event link, no Zoom) get one
      // minted by the calendar (Google Meet / Teams).
      _conference: !booking.meetingUrl && booking.mode === 'video',
    });
    out.status = 'created';
    out.providerEventId = created.id || '';
    out.calendarLink = created.htmlLink || '';
    if (!booking.meetingUrl && created.meetingUrl) out.meetingUrl = created.meetingUrl;
  } catch (e) {
    out.error = (e && e.message) ? String(e.message).slice(0, 200) : 'calendar write failed';
    console.error('[actions.sync]', out.error);
  }
  return out;
}

/** Stamp the outcome of a calendar write onto the booking, in one place. */
export function applyCalendarResult(booking, result) {
  booking.provider = result.provider || booking.provider || '';
  booking.providerEventId = result.providerEventId || '';
  booking.calendarLink = result.calendarLink || '';
  if (result.meetingUrl) booking.meetingUrl = result.meetingUrl;
  // Why there is (or is not) an event, recorded on the booking itself so the
  // next time this goes wrong it is a lookup rather than an investigation.
  booking.calendarStatus = result.status;
  booking.calendarCheckedAt = new Date().toISOString();
  if (result.error) booking.calendarError = result.error;
  else delete booking.calendarError;
  return booking;
}
