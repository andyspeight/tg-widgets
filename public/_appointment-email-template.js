/**
 * Appointment Scheduler emails — shared server + editor module.
 *
 * Lives in public/ so it is BOTH the server renderer (imported by
 * api/_lib/calendar/mail.js) and the live preview inside the Appointment
 * editor. One module, so the wording a client writes is the wording their
 * customer receives.
 *
 * This widget sends more email than any other in the suite: eight messages
 * across a booking's life, four of them to the customer. Until Sep 2026 a
 * client could not change a single word of any of them, so every travel firm
 * on the platform sent byte-identical emails written in our voice under their
 * own name. The four CUSTOMER messages now take the client's own prose and
 * subject; the four agency notifications stay as they were, because their
 * bodies are generated readouts of the booking rather than copy.
 *
 * Splitting this out was the real work: the copy used to be built inline
 * inside the async senders that also performed the SendGrid POST, so there was
 * no render entry point to preview. Everything here is now pure and
 * runtime-neutral — no Node imports, no DOM, and crucially no Buffer, which
 * is why the .ics attachment builder stays behind in mail.js.
 */

export const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Time is formatted with an explicit hourCycle:'h12', NOT hour12:true. With
// hour12:true the 'en-GB' locale resolves to the h11 hour cycle on some ICU
// builds (notably Vercel's Lambda runtime), which renders noon as "0:00pm" and
// midnight as "0:00am" — a real client saw "0:00pm" in a confirmation email.
// h12 pins the 1–12 clock so noon/midnight read as "12:00pm"/"12:00am".
export function whenString(iso, tz) {
  try {
    const d = new Date(iso);
    const ds = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d);
    const ts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: 'numeric', minute: '2-digit', hourCycle: 'h12' }).format(d).replace(/[  \s]/g, '').toLowerCase();
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
    const f = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: 'numeric', minute: '2-digit', hourCycle: 'h12' }).format(new Date(iso)).replace(/[  \s]/g, '').toLowerCase();
    const start = f(booking.startISO);
    const end = booking.endISO ? f(booking.endISO) : '';
    return start + (end ? ' – ' + end : '') + ' (' + (booking.durationMins || 30) + ' min)';
  } catch (e) { return booking.startISO; }
}

const MODE_LABELS = { callback: 'We will call you', phone: 'Phone call', video: 'Video call', inperson: 'In person' };
export const accentOf = (b) => (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(b && b.accent || '')) ? b.accent : '#0891B2');
const companyOf = (b) => (b && b.company) || 'our travel team';
const firstName = (b) => ((b.invitee && b.invitee.name) || '').split(' ')[0] || 'there';

const FONT = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export function shell(booking, title, innerHtml, preheader) {
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
    (booking.company ? '<div style="' + FONT + ';font-size:12px;color:#94A3B8;padding:14px 0 0">' + esc(booking.company) + '</div>' : '') +
    '</td></tr></table>';
}

export function para(text) {
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

export function manageLine(manageUrl, accent, label) {
  if (!manageUrl) return '';
  return '<p style="margin:18px 0 0;font-size:13.5px"><a href="' + esc(manageUrl) + '" style="color:' + accent + ';font-weight:bold;text-decoration:none">' + (label || 'Reschedule or cancel this booking') + ' →</a></p>';
}

export function detailTable(rows) {
  return '<table style="border-collapse:collapse;margin:4px 0 14px;' + FONT + ';font-size:14px">' +
    rows.map(([k, v]) => '<tr><td style="padding:5px 16px 5px 0;color:#64748B;font-weight:bold;vertical-align:top;white-space:nowrap">' + esc(k) + '</td><td style="padding:5px 0;color:#0F172A">' + esc(v) + '</td></tr>').join('') +
    '</table>';
}

/* ── Client-authored copy ─────────────────────────────────────────────────
   A client can write their own wording per lifecycle email in the Appointment
   editor. Their prose replaces our intro paragraph and nothing else: the
   details card, the manage link and the attached calendar invite are added for
   them, so a client cannot accidentally send an email with no time in it.
   Tags are filled here, escaped, and an unknown tag is left as-is so a typo
   shows rather than silently blanking. */

export const APPOINTMENT_EMAIL_KINDS = ['confirmation', 'rescheduled', 'reminder', 'cancelled'];

/** The merge tags offered in the editor. Keep in step with buildTags below. */
export const APPOINTMENT_EMAIL_TAGS = [
  { tag: '{firstName}', label: 'First name' },
  { tag: '{fullName}', label: 'Full name' },
  { tag: '{company}', label: 'Your company' },
  { tag: '{meeting}', label: 'Meeting type' },
  { tag: '{when}', label: 'Date and time' },
  { tag: '{date}', label: 'Date' },
  { tag: '{time}', label: 'Time' },
  { tag: '{duration}', label: 'Duration' },
  { tag: '{reference}', label: 'Reference' },
];

function buildTags(booking, tz) {
  const v = booking.invitee || {};
  return {
    firstname: firstName(booking),
    fullname: (v.name || '').trim(),
    company: companyOf(booking),
    meeting: booking.eventLabel || 'appointment',
    when: whenString(booking.startISO, tz),
    date: dateLine(booking.startISO, tz),
    time: timeLine(booking, tz),
    duration: String(booking.durationMins || 30) + ' min',
    reference: booking.ref || '',
  };
}

function applyTags(text, tags) {
  return String(text == null ? '' : text).replace(/\{\s*([a-zA-Z]+)\s*\}/g, (m, key) => {
    const k = key.toLowerCase();
    return Object.prototype.hasOwnProperty.call(tags, k) ? String(tags[k] == null ? '' : tags[k]) : m;
  });
}

/** Client prose -> escaped paragraphs, in the same voice as para(). */
function proseToHtml(text, tags) {
  return String(text || '').replace(/\r\n/g, '\n').split(/\n{2,}/)
    .map(b => b.trim()).filter(Boolean)
    .map(b => para(esc(applyTags(b, tags)).replace(/\n/g, '<br>')))
    .join('');
}

/** Only the four known kinds, with the caps the editor advertises. */
export function normaliseAppointmentEmails(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  APPOINTMENT_EMAIL_KINDS.forEach((kind) => {
    const t = raw[kind];
    if (!t || typeof t !== 'object') return;
    const subject = typeof t.subject === 'string' ? t.subject.trim().slice(0, 200) : '';
    const body = typeof t.body === 'string' ? t.body.trim().slice(0, 4000) : '';
    if (subject || body) out[kind] = { subject, body };
  });
  return out;
}

/**
 * Render one of the four CUSTOMER emails, exactly as the sender does.
 *
 * @param {string} kind    confirmation | rescheduled | reminder | cancelled
 * @param {object} booking The stamped booking (branding and copy travel with it)
 * @param {object} [opts]  { manageUrl }
 * @returns {{subject: string, html: string}}
 */
export function renderAppointmentEmail(kind, booking, opts) {
  const o = opts || {};
  const b = booking || {};
  const accent = accentOf(b);
  const tz = b.visitorTimezone || b.hostTimezone || 'Europe/London';
  const tags = buildTags(b, tz);
  const label = b.eventLabel || 'Appointment';
  const when = whenString(b.startISO, tz);

  const tpl = (b.emails && b.emails[kind]) || {};
  const prose = typeof tpl.body === 'string' ? tpl.body.trim() : '';
  const customSubject = typeof tpl.subject === 'string' ? tpl.subject.trim() : '';

  // Our wording, per kind, unchanged from what the senders have always sent.
  const D = {
    confirmation: {
      title: 'You\'re booked in ✓',
      preheader: 'Your ' + (b.eventLabel || 'appointment') + ' is confirmed — details and calendar invite inside.',
      subject: 'Confirmed: ' + label + ' — ' + when,
      intro: 'Hi ' + esc(firstName(b)) + ', you\'re all set — your ' + esc(label) + ' with ' + esc(companyOf(b)) + ' is confirmed.',
      note: 'The calendar invite is attached' + (b.meetingUrl ? ', with the join link included' : '') + '. We look forward to speaking with you.',
      card: true, manage: 'Reschedule or cancel this booking',
    },
    rescheduled: {
      title: 'Your booking has moved',
      preheader: 'New time inside — updated invite attached.',
      subject: 'Moved: ' + label + ' is now ' + when,
      intro: 'Hi ' + esc(firstName(b)) + ', your ' + esc(label) + ' with ' + esc(companyOf(b)) + ' has moved to the new time below.',
      note: 'An updated calendar invite is attached.',
      card: true, manage: 'Reschedule or cancel again',
    },
    reminder: {
      title: 'See you soon',
      preheader: 'A reminder of your upcoming appointment' + (b.meetingUrl ? ' — join link inside.' : '.'),
      subject: 'Reminder: ' + (b.eventLabel || 'your appointment') + ' on ' + when,
      intro: 'Hi ' + esc(firstName(b)) + ', a quick reminder of your upcoming ' + esc(label) + ' with ' + esc(companyOf(b)) + '.',
      note: '', card: true, manage: 'Reschedule or cancel this booking',
    },
    cancelled: {
      title: 'Your booking is cancelled',
      preheader: 'This booking has been cancelled.',
      subject: 'Cancelled: ' + label,
      intro: 'Hi ' + esc(firstName(b)) + ', your ' + esc(label) + ' on ' + esc(when)
        + ' has been cancelled. If this was a mistake, just book again on our website — it only takes a minute.',
      note: '', card: false, manage: '',
    },
  }[kind];

  if (!D) return { subject: '', html: '' };

  const introHtml = prose ? proseToHtml(prose, tags) : para(D.intro);
  const inner = introHtml
    + (D.card ? detailsCard(b) : '')
    + (D.note ? para('<span style="font-size:13px;color:#64748B">' + D.note + '</span>') : '')
    + (D.manage ? manageLine(o.manageUrl, accent, D.manage) : '');

  const subject = customSubject
    ? (applyTags(customSubject, tags).slice(0, 200).trim() || D.subject)
    : D.subject;

  return { subject: subject, html: shell(b, D.title, inner, D.preheader) };
}
