/**
 * Email + calendar-invite helpers for the Appointment Scheduler.
 *
 * One place for the SendGrid send, the .ics builder, and the lifecycle
 * messages (new booking, rescheduled, reminder, cancelled). Each visitor
 * message carries an .ics attachment and, when the meeting has a video link
 * (the event type's own Zoom/Meet/Teams room, or one minted by the connected
 * calendar), a prominent Join button. A short notification goes to the agency.
 * This branded email is the SINGLE customer-facing signal: we tell the Google
 * calendar write not to email the attendee (sendUpdates=none) so the visitor
 * does not also get Google's own invite on top of this one. They add the
 * meeting to their calendar from the .ics attached here.
 *
 * Design: email-client-safe HTML (tables + inline styles, system fonts, no
 * external assets). Branding comes from the booking itself (accent + company
 * are stamped on at create time) so every lifecycle email matches the widget.
 *
 * All sends are best-effort: a mail failure never fails the booking.
 */

// Customer-facing emails go out under the agency's NAME (companyOf) with the
// agency as reply-to; the envelope sender is the platform's verified sender so
// they deliver, but it is a neutral address (not a travelgenix.io one) so the
// customer never sees the platform brand. Same sender My Booking uses.
import {
  renderAppointmentEmail, whenString, shell, para, detailTable, esc,
  manageLine, accentOf,
} from '../../../public/_appointment-email-template.js';

// Re-exported so existing importers of this module keep working.
export { whenString };

const FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || 'noreply@travelify.io';
const companyOf = (b) => (b && b.company) || 'our travel team';
const icsEsc = (v) => String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

function pad2(n) { return String(n).padStart(2, '0'); }
function icsStamp(ms) {
  const d = new Date(ms);
  return d.getUTCFullYear() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate()) + 'T' + pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()) + '00Z';
}

/** Build an .ics string. method = 'REQUEST' (new/update) or 'CANCEL'. */
export function buildICS(booking, method) {
  const startMs = Date.parse(booking.startISO);
  const endMs = Date.parse(booking.endISO) || (startMs + (booking.durationMins || 30) * 60000);
  const organiser = booking.clientEmail || FROM_EMAIL;
  const desc = 'Booked via the website scheduler. Reference ' + booking.ref + '.'
    + (booking.meetingUrl ? '\nJoin the meeting: ' + booking.meetingUrl : '');
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Travelgenix//Appointment//EN',
    'CALSCALE:GREGORIAN', 'METHOD:' + (method || 'REQUEST'), 'BEGIN:VEVENT',
    'UID:' + booking.ref + '@travelgenix',
    'SEQUENCE:' + (method === 'CANCEL' ? 2 : (booking.rescheduledAt ? 1 : 0)),
    'DTSTAMP:' + icsStamp(Date.now()),
    'DTSTART:' + icsStamp(startMs), 'DTEND:' + icsStamp(endMs),
    'SUMMARY:' + icsEsc((booking.eventLabel || 'Appointment')),
    'DESCRIPTION:' + icsEsc(desc),
    (booking.meetingUrl || booking.location) ? 'LOCATION:' + icsEsc(booking.meetingUrl || booking.location) : '',
    booking.meetingUrl ? 'URL:' + icsEsc(booking.meetingUrl) : '',
    'ORGANIZER;CN=' + icsEsc(organiser) + ':mailto:' + organiser,
    'ATTENDEE;CN=' + icsEsc(booking.invitee && booking.invitee.name || '') + ';RSVP=TRUE:mailto:' + (booking.invitee && booking.invitee.email || ''),
    'STATUS:' + (method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED'),
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean);
  return lines.join('\r\n');
}

export async function sgSend(payload) {
  if (!process.env.SENDGRID_API_KEY) return false;
  try {
    const r = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + process.env.SENDGRID_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!r.ok) console.error('[mail] sendgrid', r.status);
    return r.ok;
  } catch (e) { console.error('[mail] sendgrid', e.message); return false; }
}

function icsAttachment(booking, method) {
  return {
    content: Buffer.from(buildICS(booking, method), 'utf8').toString('base64'),
    type: 'text/calendar; method=' + (method || 'REQUEST'),
    filename: 'appointment.ics',
    disposition: 'attachment',
  };
}

/* ── Lifecycle sends ─────────────────────────────────────────────────────── */

/** New booking: confirm to visitor (+ics +manage link), notify agency. */
export async function sendNewBooking(booking, opts) {
  opts = opts || {};
  const v = booking.invitee || {};
  if (v.email) {
    const { subject, html } = renderAppointmentEmail('confirmation', booking, { manageUrl: opts.manageUrl });
    await sgSend({
      personalizations: [{ to: [{ email: v.email, name: v.name }] }],
      from: { email: FROM_EMAIL, name: companyOf(booking) },
      reply_to: booking.clientEmail ? { email: booking.clientEmail } : undefined,
      subject,
      content: [{ type: 'text/html', value: html }],
      attachments: [icsAttachment(booking, 'REQUEST')],
    });
  }
  const to = booking.clientEmail || process.env.CONTACT_TO || 'info@travelgenix.io';
  const rows = [['Meeting', (booking.eventLabel || '') + ' (' + (booking.durationMins || 30) + ' min)'], ['When', whenString(booking.startISO, booking.hostTimezone) + ' · ' + (booking.hostTimezone || '')], ['Name', v.name || ''], ['Email', v.email || ''], ['Phone', v.phone || '—']];
  if (booking.meetingUrl) rows.push(['Join link', booking.meetingUrl]);
  const ans = (v.answers) || {};
  Object.keys(ans).forEach(k => { if (ans[k]) rows.push([k, String(ans[k])]); });
  await sgSend({
    personalizations: [{ to: [{ email: to }] }],
    from: { email: FROM_EMAIL, name: 'Travelgenix Scheduler' },
    reply_to: v.email ? { email: v.email, name: v.name } : undefined,
    subject: 'New booking: ' + (booking.eventLabel || 'Appointment') + ' with ' + (v.name || ''),
    content: [{ type: 'text/html', value: shell(booking, 'New appointment booked', detailTable(rows) + para('<span style="font-size:13px;color:#64748B">Reference ' + esc(booking.ref) + (booking.providerEventId ? ' · added to your calendar' : '') + '</span>')) }],
  });
}

export async function sendRescheduled(booking, opts) {
  opts = opts || {};
  const v = booking.invitee || {};
  if (v.email) {
    const { subject, html } = renderAppointmentEmail('rescheduled', booking, { manageUrl: opts.manageUrl });
    await sgSend({
      personalizations: [{ to: [{ email: v.email, name: v.name }] }],
      from: { email: FROM_EMAIL, name: companyOf(booking) },
      reply_to: booking.clientEmail ? { email: booking.clientEmail } : undefined,
      subject,
      content: [{ type: 'text/html', value: html }],
      attachments: [icsAttachment(booking, 'REQUEST')],
    });
  }
  const to = booking.clientEmail || process.env.CONTACT_TO || 'info@travelgenix.io';
  await sgSend({
    personalizations: [{ to: [{ email: to }] }],
    from: { email: FROM_EMAIL, name: 'Travelgenix Scheduler' },
    subject: 'Booking moved: ' + (v.name || '') + ' — ' + whenString(booking.startISO, booking.hostTimezone),
    content: [{ type: 'text/html', value: shell(booking, 'A booking was rescheduled', detailTable([['Meeting', booking.eventLabel || ''], ['New time', whenString(booking.startISO, booking.hostTimezone)], ['Name', v.name || ''], ['Email', v.email || '']]) + para('<span style="font-size:13px;color:#64748B">Reference ' + esc(booking.ref) + '</span>')) }],
  });
}

/** Reminder before the appointment — sent to BOTH the visitor and the agency. */
export async function sendReminder(booking, opts) {
  opts = opts || {};
  const v = booking.invitee || {};
  const accent = accentOf(booking);

  let visitorOk = false;
  if (v.email) {
    const { subject, html } = renderAppointmentEmail('reminder', booking, { manageUrl: opts.manageUrl });
    visitorOk = await sgSend({
      personalizations: [{ to: [{ email: v.email, name: v.name }] }],
      from: { email: FROM_EMAIL, name: companyOf(booking) },
      reply_to: booking.clientEmail ? { email: booking.clientEmail } : undefined,
      subject,
      content: [{ type: 'text/html', value: html }],
      attachments: [icsAttachment(booking, 'REQUEST')],
    });
  }

  const to = booking.clientEmail || process.env.CONTACT_TO || 'info@travelgenix.io';
  const rows = [
    ['Meeting', (booking.eventLabel || 'Appointment') + ' (' + (booking.durationMins || 30) + ' min)'],
    ['When', whenString(booking.startISO, booking.hostTimezone) + ' · ' + (booking.hostTimezone || '')],
    ['Name', v.name || ''], ['Email', v.email || ''], ['Phone', v.phone || '—'],
  ];
  if (booking.meetingUrl) rows.push(['Join link', booking.meetingUrl]);
  const ownerOk = await sgSend({
    personalizations: [{ to: [{ email: to }] }],
    from: { email: FROM_EMAIL, name: 'Travelgenix Scheduler' },
    reply_to: v.email ? { email: v.email, name: v.name } : undefined,
    subject: 'Reminder: ' + (booking.eventLabel || 'appointment') + ' with ' + (v.name || '') + ' — ' + whenString(booking.startISO, booking.hostTimezone),
    content: [{ type: 'text/html', value: shell(booking, 'Upcoming appointment', detailTable(rows) + manageLine(opts.manageUrl, accent)) }],
  });

  // Reminded if either party was reached, so the cron marks it done.
  return visitorOk || ownerOk;
}

export async function sendCancelled(booking) {
  const v = booking.invitee || {};
  if (v.email) {
    const { subject, html } = renderAppointmentEmail('cancelled', booking, {});
    await sgSend({
      personalizations: [{ to: [{ email: v.email, name: v.name }] }],
      from: { email: FROM_EMAIL, name: companyOf(booking) },
      subject,
      content: [{ type: 'text/html', value: html }],
      attachments: [icsAttachment(booking, 'CANCEL')],
    });
  }
  const to = booking.clientEmail || process.env.CONTACT_TO || 'info@travelgenix.io';
  await sgSend({
    personalizations: [{ to: [{ email: to }] }],
    from: { email: FROM_EMAIL, name: 'Travelgenix Scheduler' },
    subject: 'Booking cancelled: ' + (v.name || '') + ' — ' + (booking.eventLabel || ''),
    content: [{ type: 'text/html', value: shell(booking, 'A booking was cancelled', detailTable([['Meeting', booking.eventLabel || ''], ['Was', whenString(booking.startISO, booking.hostTimezone)], ['Name', v.name || ''], ['Email', v.email || '']]) + para('<span style="font-size:13px;color:#64748B">Reference ' + esc(booking.ref) + '</span>')) }],
  });
}
