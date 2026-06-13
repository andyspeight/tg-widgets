/**
 * Email + calendar-invite helpers for the Appointment Scheduler.
 *
 * One place for the SendGrid send, the .ics builder, and the three lifecycle
 * messages (new booking, rescheduled, cancelled). Each message goes to the
 * visitor with an .ics attachment, and a short notification goes to the agency.
 * When the host has a connected calendar Google also sends its own invite, so
 * these are additive, never the only signal.
 *
 * All sends are best-effort: a mail failure never fails the booking.
 */

const FROM_EMAIL = process.env.CONTACT_FROM || 'info@travelgenix.io';
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icsEsc = (v) => String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

function pad2(n) { return String(n).padStart(2, '0'); }
function icsStamp(ms) {
  const d = new Date(ms);
  return d.getUTCFullYear() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate()) + 'T' + pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()) + '00Z';
}

export function whenString(iso, tz) {
  try {
    const d = new Date(iso);
    const ds = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d);
    const ts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(d).replace(/[  \s]/g, '').toLowerCase();
    return ds + ' at ' + ts;
  } catch (e) { return iso; }
}

/** Build an .ics string. method = 'REQUEST' (new/update) or 'CANCEL'. */
export function buildICS(booking, method) {
  const startMs = Date.parse(booking.startISO);
  const endMs = Date.parse(booking.endISO) || (startMs + (booking.durationMins || 30) * 60000);
  const organiser = booking.clientEmail || FROM_EMAIL;
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Travelgenix//Appointment//EN',
    'CALSCALE:GREGORIAN', 'METHOD:' + (method || 'REQUEST'), 'BEGIN:VEVENT',
    'UID:' + booking.ref + '@travelgenix',
    'SEQUENCE:' + (method === 'CANCEL' ? 2 : (booking.rescheduledAt ? 1 : 0)),
    'DTSTAMP:' + icsStamp(Date.now()),
    'DTSTART:' + icsStamp(startMs), 'DTEND:' + icsStamp(endMs),
    'SUMMARY:' + icsEsc((booking.eventLabel || 'Appointment')),
    'DESCRIPTION:' + icsEsc('Booked via the website scheduler. Reference ' + booking.ref + '.'),
    booking.location ? 'LOCATION:' + icsEsc(booking.location) : '',
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

function shell(title, bodyHtml) {
  return '<div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;line-height:1.55;max-width:560px">' +
    '<h2 style="margin:0 0 14px;font-size:20px">' + title + '</h2>' + bodyHtml + '</div>';
}
function detailTable(rows) {
  return '<table style="border-collapse:collapse;margin:4px 0 14px">' +
    rows.map(([k, v]) => '<tr><td style="padding:4px 16px 4px 0;color:#64748b;font-weight:bold;vertical-align:top">' + esc(k) + '</td><td style="padding:4px 0">' + esc(v) + '</td></tr>').join('') +
    '</table>';
}
function icsAttachment(booking, method) {
  return {
    content: Buffer.from(buildICS(booking, method), 'utf8').toString('base64'),
    type: 'text/calendar; method=' + (method || 'REQUEST'),
    filename: 'appointment.ics',
    disposition: 'attachment',
  };
}
const firstName = (b) => ((b.invitee && b.invitee.name) || '').split(' ')[0] || 'there';
function visitorRows(b) {
  return [
    ['Meeting', (b.eventLabel || 'Appointment') + ' (' + (b.durationMins || 30) + ' min)'],
    ['When', whenString(b.startISO, b.visitorTimezone || b.hostTimezone)],
    ['Timezone', b.visitorTimezone || b.hostTimezone || ''],
    b.location ? ['Where', b.location] : null,
  ].filter(Boolean);
}

/** New booking: confirm to visitor (+ics +manage link), notify agency. */
export async function sendNewBooking(booking, opts) {
  opts = opts || {};
  const v = booking.invitee || {};
  const manage = opts.manageUrl ? '<p style="margin:14px 0 0"><a href="' + esc(opts.manageUrl) + '" style="color:#0891b2;font-weight:bold">Reschedule or cancel this booking</a></p>' : '';
  if (v.email) {
    await sgSend({
      personalizations: [{ to: [{ email: v.email, name: v.name }] }],
      from: { email: FROM_EMAIL, name: 'Travelgenix' },
      reply_to: booking.clientEmail ? { email: booking.clientEmail } : undefined,
      subject: 'Booking confirmed: ' + (booking.eventLabel || 'Appointment') + ' on ' + whenString(booking.startISO, booking.visitorTimezone || booking.hostTimezone),
      content: [{ type: 'text/html', value: shell('You are booked in', '<p>Hi ' + esc(firstName(booking)) + ', your appointment is confirmed.</p>' + detailTable(visitorRows(booking)) + '<p>The calendar invite is attached. We look forward to speaking with you.</p>' + manage) }],
      attachments: [icsAttachment(booking, 'REQUEST')],
    });
  }
  const to = booking.clientEmail || process.env.CONTACT_TO || 'info@travelgenix.io';
  const rows = [['Meeting', (booking.eventLabel || '') + ' (' + (booking.durationMins || 30) + ' min)'], ['When', whenString(booking.startISO, booking.hostTimezone) + ' · ' + (booking.hostTimezone || '')], ['Name', v.name || ''], ['Email', v.email || ''], ['Phone', v.phone || '—']];
  const ans = (v.answers) || {};
  Object.keys(ans).forEach(k => { if (ans[k]) rows.push([k, String(ans[k])]); });
  await sgSend({
    personalizations: [{ to: [{ email: to }] }],
    from: { email: FROM_EMAIL, name: 'Travelgenix Scheduler' },
    reply_to: v.email ? { email: v.email, name: v.name } : undefined,
    subject: 'New booking: ' + (booking.eventLabel || 'Appointment') + ' with ' + (v.name || ''),
    content: [{ type: 'text/html', value: shell('New appointment booked', detailTable(rows) + '<p style="font-size:13px;color:#64748b">Reference ' + esc(booking.ref) + (booking.providerEventId ? ' · added to your calendar' : '') + '</p>') }],
  });
}

export async function sendRescheduled(booking, opts) {
  opts = opts || {};
  const v = booking.invitee || {};
  const manage = opts.manageUrl ? '<p style="margin:14px 0 0"><a href="' + esc(opts.manageUrl) + '" style="color:#0891b2;font-weight:bold">Reschedule or cancel again</a></p>' : '';
  if (v.email) {
    await sgSend({
      personalizations: [{ to: [{ email: v.email, name: v.name }] }],
      from: { email: FROM_EMAIL, name: 'Travelgenix' },
      subject: 'Booking moved: ' + (booking.eventLabel || 'Appointment') + ' is now ' + whenString(booking.startISO, booking.visitorTimezone || booking.hostTimezone),
      content: [{ type: 'text/html', value: shell('Your booking has moved', '<p>Hi ' + esc(firstName(booking)) + ', your appointment has been moved to the new time below.</p>' + detailTable(visitorRows(booking)) + '<p>An updated calendar invite is attached.</p>' + manage) }],
      attachments: [icsAttachment(booking, 'REQUEST')],
    });
  }
  const to = booking.clientEmail || process.env.CONTACT_TO || 'info@travelgenix.io';
  await sgSend({
    personalizations: [{ to: [{ email: to }] }],
    from: { email: FROM_EMAIL, name: 'Travelgenix Scheduler' },
    subject: 'Booking moved: ' + (v.name || '') + ' — ' + whenString(booking.startISO, booking.hostTimezone),
    content: [{ type: 'text/html', value: shell('A booking was rescheduled', detailTable([['Meeting', booking.eventLabel || ''], ['New time', whenString(booking.startISO, booking.hostTimezone)], ['Name', v.name || ''], ['Email', v.email || '']]) + '<p style="font-size:13px;color:#64748b">Reference ' + esc(booking.ref) + '</p>') }],
  });
}

export async function sendCancelled(booking) {
  const v = booking.invitee || {};
  if (v.email) {
    await sgSend({
      personalizations: [{ to: [{ email: v.email, name: v.name }] }],
      from: { email: FROM_EMAIL, name: 'Travelgenix' },
      subject: 'Booking cancelled: ' + (booking.eventLabel || 'Appointment'),
      content: [{ type: 'text/html', value: shell('Your booking is cancelled', '<p>Hi ' + esc(firstName(booking)) + ', your appointment on ' + esc(whenString(booking.startISO, booking.visitorTimezone || booking.hostTimezone)) + ' has been cancelled. If this was a mistake, please book again on our website.</p>') }],
      attachments: [icsAttachment(booking, 'CANCEL')],
    });
  }
  const to = booking.clientEmail || process.env.CONTACT_TO || 'info@travelgenix.io';
  await sgSend({
    personalizations: [{ to: [{ email: to }] }],
    from: { email: FROM_EMAIL, name: 'Travelgenix Scheduler' },
    subject: 'Booking cancelled: ' + (v.name || '') + ' — ' + (booking.eventLabel || ''),
    content: [{ type: 'text/html', value: shell('A booking was cancelled', detailTable([['Meeting', booking.eventLabel || ''], ['Was', whenString(booking.startISO, booking.hostTimezone)], ['Name', v.name || ''], ['Email', v.email || '']]) + '<p style="font-size:13px;color:#64748b">Reference ' + esc(booking.ref) + '</p>') }],
  });
}
