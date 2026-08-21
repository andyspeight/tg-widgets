/**
 * Appointment → unified lead router smoke test.
 * Proves bookingToLead maps a saved booking to a partial lead that
 * buildCanonicalLead accepts and canonicalises: 'appointment' is a known
 * widget, the record id keys the routing, the meeting details ride in custom
 * with booking fields winning key clashes, and consent never implies
 * marketing. Pure logic — no Airtable, no dispatch.
 * Run: node test/appointment-lead-smoke.mjs
 */
import assert from 'node:assert';
import { bookingToLead } from '../api/appointment/book.js';
import { buildCanonicalLead, KNOWN_WIDGETS } from '../api/_lib/routing/schema.js';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) passed++; else { failed++; console.error('  FAIL:', label); } };

ok(KNOWN_WIDGETS.includes('appointment'), "'appointment' is a known lead source");

const booking = {
  ref: 'apt_test_1', status: 'confirmed',
  eventLabel: 'Travel consultation', durationMins: 30, mode: 'video',
  startISO: '2026-09-02T11:00:00.000Z', endISO: '2026-09-02T11:30:00.000Z',
  hostTimezone: 'Europe/London', visitorTimezone: 'Europe/Paris',
  meetingUrl: 'https://zoom.us/j/123', sourceUrl: 'https://client.example/contact',
  createdAt: '2026-08-21T10:00:00.000Z',
  invitee: {
    name: 'Sam Q Visitor', email: 'Sam@Example.com', phone: '07123 456789',
    // A crafted answer key that clashes with our canonical booking field —
    // the booking's own value must win.
    answers: { topic: 'Honeymoon', meeting: 'spoofed by visitor' },
  },
};
const widget = { recordId: 'recAAAABBBBCCCCDD', clientName: 'Sunshine Holidays', clientEmail: 'info@sunshineholidays.co.uk' };

const partial = bookingToLead(booking, widget, { ip: '203.0.113.9', userAgent: 'jest-like' });
const lead = buildCanonicalLead(partial);

ok(lead.source.widget === 'appointment', 'source.widget is appointment');
ok(lead.source.widgetId === 'recAAAABBBBCCCCDD', 'source.widgetId is the Airtable record id (passes isRecId)');
ok(lead.source.clientEmail === 'info@sunshineholidays.co.uk', 'client email carried');
ok(lead.source.sourceUrl === 'https://client.example/contact', 'the page the booking came from is on the lead');
ok(lead.contact.email === 'sam@example.com', 'email lowercased by the canonicaliser');
ok(lead.contact.firstName === 'Sam' && lead.contact.lastName === 'Q Visitor', 'name split first/rest');
ok(lead.contact.phone === '07123 456789', 'phone carried');
ok(lead.consent.contact === true && lead.consent.marketing === false, 'contact consent yes, marketing never implied');
ok(lead.custom.booking_ref === 'apt_test_1', 'booking ref rides in custom');
ok(lead.custom.meeting === 'Travel consultation', 'booking field beats a clashing visitor answer');
ok(lead.custom.topic === 'Honeymoon', 'genuine visitor answers still ride along');
ok(lead.custom.start_iso === '2026-09-02T11:00:00.000Z' && lead.custom.meeting_url === 'https://zoom.us/j/123', 'meeting details in custom');
ok(Array.isArray(lead.tags) && lead.tags.includes('appointment') && lead.tags.includes('booking'), 'tagged appointment + booking');
ok(lead.leadId && lead.receivedAt, 'canonicaliser stamps id + receivedAt');

// A widget row missing its record id must fail canonicalisation loudly
// (book.js guards with `if (w.recordId)` so this path never dispatches).
let threw = false;
try { buildCanonicalLead(bookingToLead(booking, { clientEmail: 'a@b.co' }, {})); } catch (e) { threw = true; }
ok(threw, 'no record id = validation error, not a silent mis-keyed lead');

console.log(`\n${passed} passed, ${failed} failed`);
assert.strictEqual(failed, 0, 'lead mapping smoke failures');
