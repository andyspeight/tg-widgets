/**
 * Appointment reminder smoke test.
 * Proves sendReminder() emails BOTH the visitor and the agency/owner.
 * Stubs SendGrid (global fetch) and inspects the payloads.
 * Run: node test/appointment-reminder-smoke.mjs
 */
import assert from 'node:assert';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) passed++; else { failed++; console.error('  FAIL:', label); } };

// sgSend only proceeds when a SendGrid key is present.
process.env.SENDGRID_API_KEY = 'test-key';

// Capture every send instead of hitting SendGrid.
const sent = [];
globalThis.fetch = async (url, opts) => {
  if (String(url).includes('sendgrid')) { sent.push(JSON.parse(opts.body)); return { ok: true, status: 202 }; }
  return { ok: false, status: 404 };
};

const mail = await import('../api/_lib/calendar/mail.js');

const start = new Date(Date.now() + 3600 * 1000);
const booking = {
  ref: 'BK-TEST-1', status: 'confirmed',
  startISO: start.toISOString(),
  endISO: new Date(start.getTime() + 30 * 60000).toISOString(),
  durationMins: 30, eventLabel: 'Travel consultation',
  hostTimezone: 'Europe/London', visitorTimezone: 'Europe/London',
  clientEmail: 'agency@example.com',
  invitee: { name: 'Sam Visitor', email: 'sam@example.com', phone: '07123 456789' },
};

const result = await mail.sendReminder(booking, { manageUrl: 'https://widgets.travelify.io/manage-booking?token=abc' });

const tos = sent.map(p => p.personalizations[0].to[0].email);
ok(sent.length === 2, 'sends exactly two reminder emails (got ' + sent.length + ')');
ok(tos.includes('sam@example.com'), 'one reminder goes to the visitor');
ok(tos.includes('agency@example.com'), 'one reminder goes to the owner/agency');
ok(sent.every(p => /reminder/i.test(p.subject)), 'both subjects are reminders');
ok(result === true, 'returns true so the cron marks the booking reminded');

// Visitor email carries the .ics; the owner note names the booker.
const visitor = sent.find(p => p.personalizations[0].to[0].email === 'sam@example.com');
const owner = sent.find(p => p.personalizations[0].to[0].email === 'agency@example.com');
ok(visitor && Array.isArray(visitor.attachments) && visitor.attachments.length === 1, 'visitor reminder includes the calendar .ics');
ok(owner && /Sam Visitor/.test(owner.content[0].value), 'owner reminder names the person who booked');

// Falls back to a sensible owner address if the booking has no clientEmail.
sent.length = 0;
await mail.sendReminder(Object.assign({}, booking, { clientEmail: '' }), {});
ok(sent.some(p => p.personalizations[0].to[0].email === (process.env.CONTACT_TO || 'info@travelgenix.io')), 'owner reminder falls back to CONTACT_TO when no clientEmail');

console.log(`\n${passed} passed, ${failed} failed`);
assert.strictEqual(failed, 0, 'reminder smoke failures');
