/**
 * Email + calendar-invite helpers for the Appointment Scheduler.
 *
 * One place for the SendGrid send, the .ics builder, and the lifecycle
 * messages (new booking, rescheduled, reminder, cancelled). Each visitor
 * message carries an .ics attachment and, when the meeting has a video link
 * (the event type's own Zoom/Meet/Teams room, or one minted by the connected
 * calendar), a prominent Join button. A short notification goes to the agency.
 * When the host has a connected calendar Google/Microsoft also send their own
 * invite, so these are additive, never the only signal.
 *
 * Design: email-client-safe HTML (tables + inline styles, system fonts, no
 * external assets). Branding comes from the booking itself (accent + company
 * are stamped on at create time) so every lifecycle email matches the widget.
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
function dateLine(iso, tz) {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));
  } catch (e) { return iso; }
}
function timeLine(booking, tz) {
  try {
    const f = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso)).replace(/[  \s]/g, '').toLowerCase();
    const start = f(booking.startISO);
    const end = booking.endISO ? f(booking.endISO) : '';
    return start + (end ? ' – ' + end : '') + ' (' + (booking.durationMins || 30) + ' min)';
  } catch (e) { return booking.startISO; }
}

const MODE_LABELS = { callback: 'We will call you', phone: 'Phone call', video: 'Video call', inperson: 'In person' };
const accentOf = (b) => (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(b && b.accent || '')) ? b.accent : '#0891B2');
const companyOf = (b) => (b && b.company) || 'our travel team';
const firstName = (b) => ((b.invitee && b.invitee.name) || '').split(' ')[0] || 'there';

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

/* ── Template pieces (tables + inline styles; renders everywhere) ────────── */

const FONT = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function shell(booking, title, innerHtml, preheader) {
  const accent = accentOf(booking);
  return '' +
    '<div style="display:none;max-height:0;overflow:hidden">' + esc(preheader || '') + '</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9;padding:28px 12px">' +
    '<tr><td align="center">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:16px;overflow:hidden">' +
    '<tr><td style="height:6px;background:' + accent + ';font-size:0;line-height:0">&nbsp;</td></tr>' +
    '<tr><td style="padding:30px 32px 28px;' + FONT + ';color:#0F172A">' +
    '<h1 style="margin:0 0 14px;font-size:21px;line-height:1.3;letter-spacing:-0.01em">' + title + '</h1>' +
    innerHtml +
    '</td></tr>' +
    '</table>' +
    '<div style="' + FONT + ';font-size:12px;color:#94A3B8;padding:14px 0 0">' + esc(companyOf(booking)) + ' · Powered by Travelgenix</div>' +
    '</td></tr></table>';
}

function para(text) {
  return '<p style="margin:0 0 16px;font-size:14.5px;line-height:1.6;color:#334155">' + text + '</p>';
}

/** The meeting details card: date big, time, meeting, how, join button. */
function detailsCard(booking, tzPref) {
  const accent = accentOf(booking);
  const tz = tzPref || booking.visitorTimezone || booking.hostTimezone || 'Europe/London';
  const row = (label, valueHtml) =>
    '<tr><td style="padding:0 0 3px;font-size:10.5px;font-weight:bold;letter-spacing:0.06em;color:#64748B;text-transform:uppercase">' + label + '</td></tr>' +
    '<tr><td style="padding:0 0 14px;font-size:14.5px;color:#0F172A">' + valueHtml + '</td></tr>';

  let howHtml = esc(MODE_LABELS[booking.mode] || 'Appointment');
  if (booking.meetingUrl) {
    howHtml = esc(MODE_LABELS[booking.mode] || 'Video call') +
      '<div style="padding:14px 0 2px">' +
      '<a href="' + esc(booking.meetingUrl) + '" style="display:inline-block;background:' + accent + ';color:#FFFFFF;font-size:14px;font-weight:bold;text-decoration:none;padding:12px 22px;border-radius:10px">Join the video meeting</a>' +
      '<div style="font-size:11.5px;color:#94A3B8;padding-top:8px;word-break:break-all">' + esc(booking.meetingUrl) + '</div>' +
      '</div>';
  } else if (booking.location) {
    howHtml += ' · ' + esc(booking.location);
  }

  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:12px"><tr><td style="padding:20px 22px 8px;' + FONT + '">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" width="100%">' +
    row('When', '<span style="font-size:16px;font-weight:bold">' + esc(dateLine(booking.startISO, tz)) + '</span><br>' +
      '<span style="color:#334155">' + esc(timeLine(booking, tz)) + ' · ' + esc(tz) + '</span>') +
    row('Meeting', esc(booking.eventLabel || 'Appointment') + ' with ' + esc(companyOf(booking))) +
    row('How', howHtml) +
    '</table></td></tr></table>';
}

function manageLine(manageUrl, accent, label) {
  if (!manageUrl) return '';
  return '<p style="margin:18px 0 0;font-size:13.5px"><a href="' + esc(manageUrl) + '" style="color:' + accent + ';font-weight:bold;text-decoration:none">' + (label || 'Reschedule or cancel this booking') + ' →</a></p>';
}

function detailTable(rows) {
  return '<table style="border-collapse:collapse;margin:4px 0 14px;' + FONT + ';font-size:14px">' +
    rows.map(([k, v]) => '<tr><td style="padding:5px 16px 5px 0;color:#64748B;font-weight:bold;vertical-align:top;white-space:nowrap">' + esc(k) + '</td><td style="padding:5px 0;color:#0F172A">' + esc(v) + '</td></tr>').join('') +
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

/* ── Lifecycle sends ─────────────────────────────────────────────────────── */

/** New booking: confirm to visitor (+ics +manage link), notify agency. */
export async function sendNewBooking(booking, opts) {
  opts = opts || {};
  const v = booking.invitee || {};
  const accent = accentOf(booking);
  if (v.email) {
    const inner =
      para('Hi ' + esc(firstName(booking)) + ', you\'re all set — your ' + esc(booking.eventLabel || 'appointment') + ' with ' + esc(companyOf(booking)) + ' is confirmed.') +
      detailsCard(booking) +
      para('<span style="font-size:13px;color:#64748B">The calendar invite is attached' + (booking.meetingUrl ? ', with the join link included' : '') + '. We look forward to speaking with you.</span>') +
      manageLine(opts.manageUrl, accent);
    await sgSend({
      personalizations: [{ to: [{ email: v.email, name: v.name }] }],
      from: { email: FROM_EMAIL, name: companyOf(booking) },
      reply_to: booking.clientEmail ? { email: booking.clientEmail } : undefined,
      subject: 'Confirmed: ' + (booking.eventLabel || 'Appointment') + ' — ' + whenString(booking.startISO, booking.visitorTimezone || booking.hostTimezone),
      content: [{ type: 'text/html', value: shell(booking, 'You\'re booked in ✓', inner, 'Your ' + (booking.eventLabel || 'appointment') + ' is confirmed — details and calendar invite inside.') }],
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
  const accent = accentOf(booking);
  if (v.email) {
    const inner =
      para('Hi ' + esc(firstName(booking)) + ', your ' + esc(booking.eventLabel || 'appointment') + ' with ' + esc(companyOf(booking)) + ' has moved to the new time below.') +
      detailsCard(booking) +
      para('<span style="font-size:13px;color:#64748B">An updated calendar invite is attached.</span>') +
      manageLine(opts.manageUrl, accent, 'Reschedule or cancel again');
    await sgSend({
      personalizations: [{ to: [{ email: v.email, name: v.name }] }],
      from: { email: FROM_EMAIL, name: companyOf(booking) },
      reply_to: booking.clientEmail ? { email: booking.clientEmail } : undefined,
      subject: 'Moved: ' + (booking.eventLabel || 'Appointment') + ' is now ' + whenString(booking.startISO, booking.visitorTimezone || booking.hostTimezone),
      content: [{ type: 'text/html', value: shell(booking, 'Your booking has moved', inner, 'New time inside — updated invite attached.') }],
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
    const inner =
      para('Hi ' + esc(firstName(booking)) + ', a quick reminder of your upcoming ' + esc(booking.eventLabel || 'appointment') + ' with ' + esc(companyOf(booking)) + '.') +
      detailsCard(booking) +
      manageLine(opts.manageUrl, accent);
    visitorOk = await sgSend({
      personalizations: [{ to: [{ email: v.email, name: v.name }] }],
      from: { email: FROM_EMAIL, name: companyOf(booking) },
      reply_to: booking.clientEmail ? { email: booking.clientEmail } : undefined,
      subject: 'Reminder: ' + (booking.eventLabel || 'your appointment') + ' on ' + whenString(booking.startISO, booking.visitorTimezone || booking.hostTimezone),
      content: [{ type: 'text/html', value: shell(booking, 'See you soon', inner, 'A reminder of your upcoming appointment' + (booking.meetingUrl ? ' — join link inside.' : '.')) }],
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
    const inner = para('Hi ' + esc(firstName(booking)) + ', your ' + esc(booking.eventLabel || 'appointment') + ' on ' +
      esc(whenString(booking.startISO, booking.visitorTimezone || booking.hostTimezone)) +
      ' has been cancelled. If this was a mistake, just book again on our website — it only takes a minute.');
    await sgSend({
      personalizations: [{ to: [{ email: v.email, name: v.name }] }],
      from: { email: FROM_EMAIL, name: companyOf(booking) },
      subject: 'Cancelled: ' + (booking.eventLabel || 'Appointment'),
      content: [{ type: 'text/html', value: shell(booking, 'Your booking is cancelled', inner, 'This booking has been cancelled.') }],
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
