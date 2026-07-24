/**
 * Agent enquiry email — surfaces ALL the captured data, not a small selection.
 *
 * Reported 24 Jul 2026: the notification email dropped fields the customer
 * filled in. Concretely, "Flights included" (Enquiry Pro) was captured but shown
 * nowhere, child ages were dropped from the traveller line, rooms and marketing
 * consent were absent, and a flexible-only date rendered as a bare "—" (which
 * also produced a lone "— · —" Style row).
 *
 * Drives the REAL sendAgentEmail with a captured SendGrid fetch and asserts the
 * rendered HTML now carries every captured field, and cleanly omits absent ones.
 * Run: node test/enquiry-email-fields-smoke.mjs
 */
let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

process.env.SENDGRID_API_KEY = 'SG.test.key';
process.env.SENDGRID_FROM_EMAIL = 'noreply@travelify.io';
delete process.env.SENDGRID_FROM_NAME_FALLBACK;

const { default: sendAgentEmail } = await import('../api/enquiry/_lib/routing/email.js');

const ROUTING_TO_FIELD = 'fldlu1HcErBfp2wh2';
const CLIENT_NAME_FIELD = 'fldrw1eTFYCFIo0pp';

let captured = [];
global.fetch = async (url, opts) => {
  const u = String(url);
  // No authenticated domains → platform sender; we only care about the HTML body.
  if (u.includes('/v3/whitelabel/domains')) return { ok: false, status: 403, json: async () => ({}) };
  captured.push({ url: u, body: JSON.parse(opts.body) });
  return { ok: true, status: 202, headers: { get: () => 'msg-id-1' }, text: async () => '' };
};

const send = async (fields) => {
  captured = [];
  await sendAgentEmail({
    form: { id: 'recFORM', fields: { [ROUTING_TO_FIELD]: 'agent@example.com', [CLIENT_NAME_FIELD]: 'Test Travel' } },
    payload: { fields, sourceUrl: 'https://client.example/enquire' },
    reference: 'TT-2026-00001',
    submissionId: 'recSUB0001',
    meta: { ip: '1.2.3.4', userAgent: 'test' },
  });
  // SendGrid v3 nests the HTML under content[type=text/html].
  const content = captured[0].body.content || [];
  return content.filter((c) => c.type === 'text/html').map((c) => c.value).join('');
};

// ── A rich Enquiry Pro submission: every captured field must appear ──────────
let html = await send({
  first_name: 'Jo', last_name: 'Bloggs', email: 'jo@example.com', phone: '07123456789',
  destinations: [{ name: 'Rome', parentCountry: 'Italy' }],
  travel_dates: { flexible: true },
  duration: { nights: 7 },
  travellers: { adults: 2, children: 2, childAges: [5, 8], infants: 1, rooms: 3 },
  budget_pp: 1500,
  stars: 4, board: 'AI',
  flights_included: true,
  marketing_consent: true,
  interests: ['City break'],
  notes: 'Looking for something relaxed',
});

ok(/Flights/.test(html) && /Included/.test(html), 'Flights included is shown (was captured but dropped before)');
ok(/2 children \(ages 5, 8\)/.test(html), 'child ages appear next to the count');
ok(/1 infant/.test(html), 'infants counted');
ok(/Rooms/.test(html) && /3 rooms/.test(html), 'rooms shown when more than one');
ok(/Marketing consent/.test(html) && /Opted in/.test(html), 'marketing consent surfaced');
ok(/Style/.test(html) && /4-star/.test(html) && /All inclusive/.test(html), 'style shows stars + board');
ok(/Flexible/.test(html) && !/Dates[\s\S]{0,120}>—</.test(html), 'flexible-only dates read "Flexible", not a bare dash');
ok(/Rome/.test(html) && /Italy/.test(html), 'destination with country shown');

// ── A sparse submission: absent fields are omitted cleanly, no lone dashes ────
html = await send({
  first_name: 'Sam', last_name: 'Lee', email: 'sam@example.com',
  destinations: [{ name: 'Paris' }],
  travel_dates: { flexible: true },
  duration: { nights: 3 },
  travellers: { adults: 1 },
  marketing_consent: false,
});

ok(!/— · —/.test(html), 'no lone "— · —" Style row when stars + board are absent');
ok(!/>Flights</.test(html), 'no Flights row when flights_included is absent');
ok(!/>Rooms</.test(html), 'no Rooms row for a single room');
ok(!/>Budget</.test(html), 'no Budget row when no budget given');
ok(/Marketing consent/.test(html) && /Not opted in/.test(html), 'marketing consent shows "Not opted in" when declined');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
