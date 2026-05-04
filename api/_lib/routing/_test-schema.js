// Smoke test for the canonical lead schema.
// Run from router-build directory: node api/_lib/routing/_test-schema.js
//
// This tests buildCanonicalLead in isolation — no Airtable, no SendGrid,
// no external services. Verifies:
//  - valid lead is canonicalised correctly
//  - missing email rejected
//  - bad widget rejected
//  - bad widget ID rejected
//  - oversized custom fields are truncated
//  - control characters stripped
//  - tags clamped

import { buildCanonicalLead, ValidationError } from './schema.js';

let pass = 0;
let fail = 0;

function ok(name, cond, detail) {
  if (cond) { console.log(`✓ ${name}`); pass++; }
  else { console.log(`✗ ${name}${detail ? ' — ' + detail : ''}`); fail++; }
}

function expectThrows(name, fn) {
  try { fn(); ok(name, false, 'expected throw'); }
  catch (e) { ok(name, e instanceof ValidationError, `got ${e.constructor.name}: ${e.message}`); }
}

// 1. Valid lead canonicalises
const valid = buildCanonicalLead({
  source: {
    widget: 'popup',
    widgetId: 'rec140e5vxhm1FOFy',
    clientEmail: 'agent@example.com',
    clientName: 'Sunshine Holidays',
    sourceUrl: 'https://example.com/page',
  },
  contact: { email: 'sarah@example.com', firstName: 'Sarah', lastName: 'Smith' },
  travel: { destinations: ['Algarve'], adults: 2, departDate: '2026-09-15' },
  tags: ['late-deals'],
  custom: { coupon: 'SAVE10' },
});
ok('lead has leadId', !!valid.leadId);
ok('lead.contact.email lowercased', valid.contact.email === 'sarah@example.com');
ok('lead.contact.fullName derived', valid.contact.fullName === 'Sarah Smith');
ok('travel.destinations preserved', valid.travel.destinations[0] === 'Algarve');
ok('travel.departDate preserved as date', valid.travel.departDate === '2026-09-15');
ok('tags preserved', valid.tags.includes('late-deals'));
ok('custom preserved', valid.custom.coupon === 'SAVE10');
ok('routing.requested empty', valid.routing.requested.length === 0);

// 2. Missing email rejected
expectThrows('missing email rejected', () => buildCanonicalLead({
  source: { widget: 'popup', widgetId: 'rec140e5vxhm1FOFy', clientEmail: 'a@b.c' },
  contact: {},
}));

// 3. Bad widget rejected
expectThrows('unknown widget rejected', () => buildCanonicalLead({
  source: { widget: 'banana', widgetId: 'rec140e5vxhm1FOFy', clientEmail: 'a@b.c' },
  contact: { email: 'sarah@example.com' },
}));

// 4. Bad widget ID rejected
expectThrows('invalid widget ID rejected', () => buildCanonicalLead({
  source: { widget: 'popup', widgetId: 'NOT_A_REC_ID', clientEmail: 'a@b.c' },
  contact: { email: 'sarah@example.com' },
}));

// 5. Bad client email rejected
expectThrows('invalid client email rejected', () => buildCanonicalLead({
  source: { widget: 'popup', widgetId: 'rec140e5vxhm1FOFy', clientEmail: 'not-an-email' },
  contact: { email: 'sarah@example.com' },
}));

// 6. Control characters stripped
const stripped = buildCanonicalLead({
  source: { widget: 'popup', widgetId: 'rec140e5vxhm1FOFy', clientEmail: 'a@b.co' },
  contact: { email: 'sarah@example.com', firstName: 'Sa\x00rah\x07' },
});
ok('control chars stripped', stripped.contact.firstName === 'Sarah');

// 7. Tag count clamped to 20
const manyTags = buildCanonicalLead({
  source: { widget: 'popup', widgetId: 'rec140e5vxhm1FOFy', clientEmail: 'a@b.co' },
  contact: { email: 'sarah@example.com' },
  tags: Array.from({ length: 50 }, (_, i) => `tag${i}`),
});
ok('tag count clamped to 20', manyTags.tags.length === 20);

// 8. Custom field count clamped
const manyCustom = {};
for (let i = 0; i < 100; i++) manyCustom[`k${i}`] = `v${i}`;
const customClamped = buildCanonicalLead({
  source: { widget: 'popup', widgetId: 'rec140e5vxhm1FOFy', clientEmail: 'a@b.co' },
  contact: { email: 'sarah@example.com' },
  custom: manyCustom,
});
ok('custom keys clamped to 50', Object.keys(customClamped.custom).length === 50);

// 9. Board basis enum enforced
const bb = buildCanonicalLead({
  source: { widget: 'popup', widgetId: 'rec140e5vxhm1FOFy', clientEmail: 'a@b.co' },
  contact: { email: 'sarah@example.com' },
  travel: { boardBasis: 'INVALID' },
});
ok('invalid boardBasis dropped', bb.travel.boardBasis === '');

// 10. Numbers clamped
const nums = buildCanonicalLead({
  source: { widget: 'popup', widgetId: 'rec140e5vxhm1FOFy', clientEmail: 'a@b.co' },
  contact: { email: 'sarah@example.com' },
  travel: { adults: 999999, starRating: 100 },
});
ok('adults clamped to 50', nums.travel.adults === 50);
ok('starRating clamped to 5', nums.travel.starRating === 5);

console.log(`\n${pass} passed · ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
