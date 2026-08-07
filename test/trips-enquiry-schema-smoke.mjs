/**
 * Group Trips enquiry — canonical lead shape (plain Node, no browser).
 * Run: node test/trips-enquiry-schema-smoke.mjs   (npm run test:trips-enquiry)
 *
 * Proves the router will accept a Group Trips enquiry: 'trips' is a known
 * widget, party size lands in travel.adults, the message + trip title ride in
 * custom, and a bad widget name is still rejected (the allowlist bites).
 */
import assert from 'node:assert';
import { buildCanonicalLead, KNOWN_WIDGETS, ValidationError } from '../api/_lib/routing/schema.js';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

// 'trips' is on the allowlist.
ok(KNOWN_WIDGETS.includes('trips'), "schema: 'trips' is a known widget");

// A well-formed trips enquiry canonicalises cleanly.
const recId = 'rec' + 'A'.repeat(14);
const lead = buildCanonicalLead({
  source: { widget: 'trips', widgetId: recId, clientEmail: 'agent@agency.co.uk', clientName: 'Aurora Travel' },
  contact: { email: 'traveller@example.com', firstName: 'Ada', lastName: 'Lovelace' },
  travel: { adults: 4, destinations: ['Santorini, Greece'] },
  custom: { tripTitle: 'Santorini Yoga Retreat 2027', partySize: 4, message: 'Do you have a single room?' },
  tags: ['group-trips', 'enquiry'],
});
ok(lead.source.widget === 'trips', 'schema: widget preserved as trips');
ok(lead.source.widgetId === recId, 'schema: record id preserved');
ok(lead.contact.email === 'traveller@example.com', 'schema: contact email preserved');
ok(lead.travel.adults === 4, 'schema: party size -> travel.adults');
ok(lead.travel.destinations[0] === 'Santorini, Greece', 'schema: destination carried');
ok(lead.custom.message === 'Do you have a single room?', 'schema: message rides in custom');
ok(lead.custom.tripTitle === 'Santorini Yoga Retreat 2027', 'schema: trip title rides in custom');
ok(lead.tags.includes('group-trips') && lead.tags.includes('enquiry'), 'schema: tags carried');
ok(typeof lead.leadId === 'string' && lead.leadId.startsWith('lead_'), 'schema: a lead id is minted');

// A bad email is rejected.
let threw = false;
try { buildCanonicalLead({ source: { widget: 'trips', widgetId: recId, clientEmail: 'agent@agency.co.uk' }, contact: { email: 'nope' } }); }
catch (e) { threw = e instanceof ValidationError; }
ok(threw, 'schema: invalid contact email rejected');

// An unknown widget name is rejected — proves the allowlist is enforced.
let threw2 = false;
try { buildCanonicalLead({ source: { widget: 'not-a-widget', widgetId: recId, clientEmail: 'agent@agency.co.uk' }, contact: { email: 'a@b.co' } }); }
catch (e) { threw2 = e instanceof ValidationError; }
ok(threw2, 'schema: unknown widget name rejected (allowlist bites)');

// Party size out of range is clamped, not accepted raw.
const clamped = buildCanonicalLead({
  source: { widget: 'trips', widgetId: recId, clientEmail: 'agent@agency.co.uk' },
  contact: { email: 'a@b.co' },
  travel: { adults: 999 },
});
ok(clamped.travel.adults === 50, `schema: adults clamped to 50 (got ${clamped.travel.adults})`);

console.log(`\n${passed} passed, ${failed} failed`);
assert.strictEqual(failed, 0, 'trips enquiry schema failures');
