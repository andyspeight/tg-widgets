/**
 * Appointment Scheduler — the four CUSTOMER emails become client-editable.
 *
 * This widget sends more email than anything else in the suite: eight messages
 * across a booking's life, four of them to the customer. Until Sep 2026 a
 * client could not change a single word, so every travel firm on the platform
 * sent byte-identical emails written in our voice under their own name.
 *
 * The audit called this the largest of the remaining jobs, and the reason was
 * real: the copy was built inline INSIDE the async senders that also performed
 * the SendGrid POST, so there was no render entry point to preview. The four
 * customer emails now render from public/_appointment-email-template.js — pure,
 * runtime-neutral, and previewed in the editor through the shared popup. The
 * Buffer-based .ics builder stays behind in mail.js, which is why the split had
 * to happen at that seam.
 *
 * The four AGENCY notifications are deliberately NOT editable: their bodies are
 * generated readouts of the booking rather than copy.
 *
 * Run: node test/appointment-email-editor-smoke.mjs   (npm run test:appointment-email-editor)
 */
import { readFileSync } from 'node:fs';

const R = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const TPL = R('public/_appointment-email-template.js');
const MAIL = R('api/_lib/calendar/mail.js');
const BOOK = R('api/appointment/book.js');
const EDITOR = R('public/editor-appointment.html');

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };

console.log('The renderer is split out, pure, and shared with the sender');
{
  ok('the four customer emails render from public/', /export function renderAppointmentEmail\(/.test(TPL));
  ok('mail.js composes through it', /import \{[\s\S]*?renderAppointmentEmail[\s\S]*?\} from '\.\.\/\.\.\/\.\.\/public\/_appointment-email-template\.js';/.test(MAIL));
  ok('all four customer sends use it, none build copy inline any more',
    (MAIL.match(/renderAppointmentEmail\('(confirmation|rescheduled|reminder|cancelled)'/g) || []).length === 4
    && !/you're all set/.test(MAIL) && !/a quick reminder of your upcoming/.test(MAIL)
    && !/has moved to the new time/.test(MAIL) && !/just book again on our website/.test(MAIL));
  ok('the renderer is runtime-neutral — no Node, no DOM, and crucially no Buffer',
    !/^import /m.test(TPL) && !/require\(/.test(TPL) && !/\bdocument\./.test(TPL)
    && !/process\.env/.test(TPL) && !/\bBuffer\./.test(TPL));
  ok('the .ics builder (which needs Buffer) correctly stayed server-side',
    /Buffer\.from\(buildICS/.test(MAIL) && !/buildICS/.test(TPL));
  ok('mail.js still exports everything its callers import', (() => {
    const wanted = ['sendNewBooking', 'sendRescheduled', 'sendReminder', 'sendCancelled', 'buildICS', 'sgSend', 'whenString'];
    return wanted.every(x => new RegExp('export (async function|function|\\{) ?' + x).test(MAIL) || new RegExp('export \\{ ' + x).test(MAIL));
  })());
}

console.log('Functional — the real renderer, all four emails, ours and theirs');
{
  const { renderAppointmentEmail, normaliseAppointmentEmails, APPOINTMENT_EMAIL_KINDS, APPOINTMENT_EMAIL_TAGS } =
    await import('../public/_appointment-email-template.js');
  const base = {
    ref: 'AP-1042', eventLabel: 'Discovery call', durationMins: 30, mode: 'video',
    startISO: '2027-05-14T09:00:00Z', endISO: '2027-05-14T09:30:00Z',
    visitorTimezone: 'Europe/London', hostTimezone: 'Europe/London',
    invitee: { name: 'Sarah Jones', email: 'sarah@example.com' },
    company: 'Travelaire', accent: '#0891B2', meetingUrl: 'https://meet.example/abc',
  };
  ok('there are exactly four customer emails', APPOINTMENT_EMAIL_KINDS.length === 4);

  const defaults = APPOINTMENT_EMAIL_KINDS.map(k => renderAppointmentEmail(k, base, { manageUrl: 'https://x/m?t=1' }));
  ok('each renders our original subject unchanged', 
    defaults[0].subject.startsWith('Confirmed: Discovery call — ')
    && defaults[1].subject.startsWith('Moved: Discovery call is now ')
    && defaults[2].subject.startsWith('Reminder: Discovery call on ')
    && defaults[3].subject === 'Cancelled: Discovery call');
  ok('each carries our original wording', 
    /you&#39;re all set|you're all set/.test(defaults[0].html)
    && /has moved to the new time below/.test(defaults[1].html)
    && /a quick reminder of your upcoming/.test(defaults[2].html)
    && /just book again on our website/.test(defaults[3].html));
  ok('the three with a details card show the meeting, and the cancelled one does not',
    defaults.slice(0, 3).every(d => /Join the video meeting/.test(d.html)) && !/Join the video meeting/.test(defaults[3].html));
  ok('the company brands every one of them', defaults.every(d => /Travelaire/.test(d.html)));

  const custom = renderAppointmentEmail('confirmation', {
    ...base,
    emails: { confirmation: { subject: 'See you on {date}, {firstName}', body: 'Hi {firstName}\n\nYour {meeting} with {company} is booked for {when}.' } },
  }, { manageUrl: 'https://x/m?t=1' });
  ok('a client subject is used and its tags fill', /^See you on Friday, 14 May 2027, Sarah$/.test(custom.subject));
  ok('client prose replaces our opening lines only', /Your Discovery call with Travelaire is booked for/.test(custom.html)
    && !/you&#39;re all set|you're all set/.test(custom.html));
  ok('...while the details card, join button and manage link all survive',
    /Join the video meeting/.test(custom.html) && /Reschedule or cancel/.test(custom.html));
  ok('blank lines become separate paragraphs', (custom.html.match(/<p style="margin:0 0 16px/g) || []).length >= 2);
  ok('client prose is escaped — no HTML reaches a customer inbox',
    !renderAppointmentEmail('confirmation', { ...base, emails: { confirmation: { body: '<script>alert(1)</script>' } } }, {}).html.includes('<script>alert(1)'));
  ok('a whitespace-only message falls back to ours',
    renderAppointmentEmail('reminder', { ...base, emails: { reminder: { body: '  \n ' } } }, { manageUrl: 'https://x/m?t=1' }).html === defaults[2].html);
  // A typo'd tag stays VISIBLE rather than silently blanking, so the client
  // sees it in the preview's subject line and fixes it before anyone gets it.
  ok('an unknown tag is left as-is, not swallowed',
    renderAppointmentEmail('cancelled', { ...base, emails: { cancelled: { subject: 'Hi {nosuchtag}' } } }, {}).subject === 'Hi {nosuchtag}');
  ok('but a subject that merges to genuinely nothing falls back to ours',
    renderAppointmentEmail('cancelled',
      { ...base, invitee: { email: 'x@y.com' }, emails: { cancelled: { subject: '{fullName}' } } }, {}
    ).subject === 'Cancelled: Discovery call');
  ok('an unknown kind renders nothing rather than a broken email',
    renderAppointmentEmail('bogus', base, {}).html === '');

  ok('normalise keeps only the four known kinds and caps them',
    JSON.stringify(normaliseAppointmentEmails({ confirmation: { subject: 'a', body: 'b' }, bogus: { body: 'x' } })) === '{"confirmation":{"subject":"a","body":"b"}}'
    && normaliseAppointmentEmails({ reminder: { subject: 'x'.repeat(400) } }).reminder.subject.length === 200);
  ok('normalise drops empty templates rather than storing noise',
    Object.keys(normaliseAppointmentEmails({ confirmation: { subject: '', body: '  ' } })).length === 0);

  // CROSS GUARD: a tag offered in the editor that the renderer cannot fill
  // would reach a real customer as literal braces.
  const filled = renderAppointmentEmail('confirmation', {
    ...base, emails: { confirmation: { body: APPOINTMENT_EMAIL_TAGS.map(t => t.tag).join(' | ') } },
  }, {}).html;
  const unmerged = APPOINTMENT_EMAIL_TAGS.filter(t => filled.includes(t.tag));
  ok('every offered tag merges to a value' + (unmerged.length ? ' — literal: ' + unmerged.map(t => t.tag).join(', ') : ''), unmerged.length === 0);
}

console.log('End to end — the real senders, over a captured SendGrid');
{
  process.env.SENDGRID_API_KEY = 'SG.test.key';
  const mail = await import('../api/_lib/calendar/mail.js');
  let sent = [];
  global.fetch = async (url, opts) => {
    sent.push(JSON.parse(opts.body));
    return { ok: true, status: 202, text: async () => '' };
  };
  const booking = (emails) => ({
    ref: 'AP-2001', eventLabel: 'Discovery call', durationMins: 30, mode: 'callback',
    startISO: '2027-05-14T09:00:00Z', endISO: '2027-05-14T09:30:00Z',
    visitorTimezone: 'Europe/London', hostTimezone: 'Europe/London',
    invitee: { name: 'Sarah Jones', email: 'sarah@example.com' },
    company: 'Travelaire', clientEmail: 'team@travelaire.com', emails: emails || {},
  });

  sent = [];
  await mail.sendNewBooking(booking(), { manageUrl: 'https://x/m?t=1' });
  ok('a booking still sends TWO emails: the customer and the agency', sent.length === 2);
  ok('the customer one goes out under the agency name with our default copy',
    sent[0].from.name === 'Travelaire' && /you&#39;re all set|you're all set/.test(sent[0].content[0].value));
  ok('...and still carries the calendar invite', Array.isArray(sent[0].attachments) && sent[0].attachments.length === 1
    && /text\/calendar/.test(sent[0].attachments[0].type));
  ok('the agency one is untouched by any of this',
    sent[1].from.name === 'Travelgenix Scheduler' && /New appointment booked/.test(sent[1].content[0].value));

  sent = [];
  await mail.sendNewBooking(booking({ confirmation: { subject: 'Booked, {firstName}', body: 'See you {when}.' } }), { manageUrl: 'https://x/m?t=1' });
  ok('a client\'s wording reaches the wire', sent[0].subject === 'Booked, Sarah' && /See you Friday, 14 May 2027/.test(sent[0].content[0].value));
  ok('...and the agency notification is NOT affected by the client copy',
    sent[1].subject.startsWith('New booking: ') && !/See you Friday/.test(sent[1].content[0].value));

  sent = [];
  await mail.sendCancelled(booking({ cancelled: { body: 'Sorry to miss you, {firstName}.' } }));
  ok('cancellation copy reaches the wire with a CANCEL invite',
    /Sorry to miss you, Sarah\./.test(sent[0].content[0].value)
    && /method=CANCEL/.test(sent[0].attachments[0].type));

  sent = [];
  const remOk = await mail.sendReminder(booking({ reminder: { body: 'Tomorrow, {firstName}.' } }), { manageUrl: 'https://x/m?t=1' });
  ok('the reminder still reports success for the cron', remOk === true);
  ok('reminder copy reaches the visitor, and the agency still gets its readout',
    /Tomorrow, Sarah\./.test(sent[0].content[0].value) && /Upcoming appointment/.test(sent[1].content[0].value));
}

console.log('The editor writes it, and stops lying about the on-screen fields');
{
  ok('the config carries an emails slot', /\/\/ Client-authored wording for the four CUSTOMER emails\. Blank means ours\.\s*\n\s*emails: \{\},/.test(EDITOR));
  ok('bookings stamp the copy so cron-fired emails still have it',
    /emails: normaliseAppointmentEmails\(config\.emails\),/.test(BOOK)
    && /import \{ normaliseAppointmentEmails \} from '\.\.\/\.\.\/public\/_appointment-email-template\.js';/.test(BOOK));
  ok('the editor loads the shared popup and the real renderer',
    /<script src="\/editor-email-popup\.js"><\/script>/.test(EDITOR)
    && /window\.TGAppointmentEmail = \{ renderAppointmentEmail, APPOINTMENT_EMAIL_TAGS, APPOINTMENT_EMAIL_KINDS \};/.test(EDITOR));
  ok('the section is now "Customer emails", with a card per email',
    /<span class="tgse-section-label">Customer emails<\/span>/.test(EDITOR) && /id="appt-email-cards"/.test(EDITOR)
    && /window\.TGEmailPopup\.card\(\{/.test(EDITOR));
  ok('all four kinds get a card and a tab',
    ['confirmation', 'rescheduled', 'reminder', 'cancelled'].every(k => new RegExp(k + ':').test(EDITOR))
    && /Object\.keys\(APPT_EMAIL_LABELS\)\.map\(/.test(EDITOR));
  ok('the preview goes through the shared renderer with a realistic booking',
    /T\.renderAppointmentEmail\(kind, apptSampleBooking\(kind\), \{/.test(EDITOR)
    && /function apptSampleBooking\(kind\)/.test(EDITOR));
  ok('the cards refresh when the popup closes and on config load',
    /onClose: apptRenderCards/.test(EDITOR) && /\n    apptRenderCards\(\);/.test(EDITOR));
  ok('editing marks the editor dirty', /apptWrite\(kind, field, value\)/.test(EDITOR) && /shell\.markDirty\(\);/.test(EDITOR));
  ok('reset removes the client copy entirely rather than storing blanks',
    /delete apptEmails\(\)\[kind\];/.test(EDITOR));
  // The audit's sharpest finding: two fields that look like email copy and are
  // not. A client editing them believing they changed the email was silently
  // wrong, so the labels now say what they actually do.
  ok('the on-screen confirmation fields no longer masquerade as email copy',
    /On-screen title after booking/.test(EDITOR) && /On-screen message after booking/.test(EDITOR)
    && /They do NOT appear in the confirmation email/.test(EDITOR)
    && !/>Confirmation title</.test(EDITOR));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
