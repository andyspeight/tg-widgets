/**
 * Appointment SMS reminder smoke test.
 * Proves the Twilio module normalises UK numbers to E.164 (and refuses to
 * guess), composes a bounded reminder text with the h12 noon fix, no-ops
 * cleanly when unconfigured, and posts the right payload when configured.
 * Stubs global fetch — no real Twilio call.
 * Run: node test/appointment-sms-smoke.mjs
 */
import assert from 'node:assert';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) passed++; else { failed++; console.error('  FAIL:', label); } };

// Import BEFORE env vars are set to test the unconfigured path first.
const sms = await import('../api/_lib/calendar/sms.js');

// ── normalisePhone ──
ok(sms.normalisePhone('07123 456789') === '+447123456789', 'UK mobile 07… becomes +447…');
ok(sms.normalisePhone('0161 496 0000') === '+441614960000', 'UK landline 01… becomes +441…');
ok(sms.normalisePhone('+44 7123 456-789') === '+447123456789', 'already-international numbers pass through cleaned');
ok(sms.normalisePhone('0034 612 345 678') === '+34612345678', '00 prefix converts to +');
ok(sms.normalisePhone('+1 (415) 555-0100') === '+14155550100', 'US number in +CC form passes');
ok(sms.normalisePhone('12345') === '', 'a short scrap is refused, not guessed');
ok(sms.normalisePhone('call me later') === '', 'junk text is refused');
ok(sms.normalisePhone('') === '' && sms.normalisePhone(null) === '', 'empty and null are inert');

// ── reminderSmsBody ──
const noonBooking = {
  company: 'Sunshine Holidays', eventLabel: 'Travel consultation',
  startISO: '2026-09-02T11:00:00.000Z', // 12:00 noon in Europe/London (BST)
  visitorTimezone: 'Europe/London', hostTimezone: 'Europe/London',
};
const body = sms.reminderSmsBody(noonBooking, { manageUrl: 'https://widgets.travelify.io/manage-booking?token=abc' });
ok(/^Reminder from Sunshine Holidays: Travel consultation on /.test(body), 'text leads with the agency and meeting');
ok(body.includes('12:00pm'), 'noon renders as 12:00pm, never 0:00pm (h12 fix, got: ' + body + ')');
ok(body.includes('Manage: https://'), 'manage link included when provided');
ok(body.length <= 300, 'text stays within the two-segment cap');
const longBooking = Object.assign({}, noonBooking, { company: 'X'.repeat(200), eventLabel: 'Y'.repeat(200) });
ok(sms.reminderSmsBody(longBooking, {}).length <= 300, 'oversized fields are clamped');

// ── Unconfigured: everything no-ops ──
ok(sms.smsConfigured() === false, 'not configured without env vars');
let fetchCalls = [];
globalThis.fetch = async (url, opts) => { fetchCalls.push({ url: String(url), opts }); return { ok: true, json: async () => ({}) }; };
ok((await sms.sendSms('07123456789', 'hi')) === false, 'sendSms returns false when unconfigured');
ok(fetchCalls.length === 0, 'unconfigured sendSms never calls the network');

// ── Configured: correct Twilio request ──
process.env.TWILIO_ACCOUNT_SID = 'ACtest123';
process.env.TWILIO_AUTH_TOKEN = 'secret-token';
process.env.TWILIO_FROM = '+447700900123';
ok(sms.smsConfigured() === true, 'configured once the three env vars exist');
ok((await sms.sendSms('07123 456789', 'Reminder test')) === true, 'configured send reports success');
ok(fetchCalls.length === 1, 'exactly one Twilio call made');
const call = fetchCalls[0];
ok(call.url === 'https://api.twilio.com/2010-04-01/Accounts/ACtest123/Messages.json', 'posts to the account Messages endpoint');
ok(call.opts.headers.Authorization === 'Basic ' + Buffer.from('ACtest123:secret-token').toString('base64'), 'basic auth from sid:token');
const params = new URLSearchParams(call.opts.body);
ok(params.get('To') === '+447123456789', 'To is the normalised E.164 number');
ok(params.get('From') === '+447700900123', 'From is the configured sender');
ok(params.get('Body') === 'Reminder test', 'Body carries the message');

// ── Configured but bad number: refuses without a network call ──
fetchCalls = [];
ok((await sms.sendSms('not a number', 'hi')) === false, 'unusable number refused');
ok(fetchCalls.length === 0, 'no network call for an unusable number');

// ── Twilio failure surfaces as false, never a throw ──
globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({ message: 'auth' }) });
ok((await sms.sendSms('07123456789', 'hi')) === false, 'a Twilio error returns false');
globalThis.fetch = async () => { throw new Error('boom'); };
ok((await sms.sendSms('07123456789', 'hi')) === false, 'a network throw returns false');

console.log(`\n${passed} passed, ${failed} failed`);
assert.strictEqual(failed, 0, 'sms smoke failures');
