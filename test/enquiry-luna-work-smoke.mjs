/**
 * Luna Work routing module: field mapping + signature (04 Aug 2026).
 *
 * routing/luna-work.js maps a widget submission onto the Luna Work CRM's
 * enquiry contract and signs it per agency so the CRM's POST /api/widget/lead
 * can verify it. This guards three things that must not drift:
 *
 *   1. The mapping — a website submission must arrive as a usable enquiry:
 *      name joined, destinations flattened, budget marked per-person, the
 *      visitor's words kept, and everything the contract can't hold folded
 *      into the note rather than dropped.
 *   2. The endpoint guard — HTTPS only, never an internal host (SSRF).
 *   3. The signature — byte-identical to what the CRM recomputes, or every
 *      lead is rejected. We recompute the HMAC independently here (the CRM's
 *      scheme) and require a match.
 *
 * Pure — no network. The module's default export is exercised only for its
 * up-front config refusals, which return before any fetch.
 *
 * Run: node test/enquiry-luna-work-smoke.mjs
 */
import crypto from 'node:crypto';
import sendToLunaWork, { _test } from '../api/enquiry/_lib/routing/luna-work.js';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

const { buildLeadBody, isValidEndpoint, signBody } = _test;

// ---- A representative full submission ---------------------------------------

const form = { id: 'recForm', fields: { fldC0MLSyJqg6U1zT: 'Beach Escapes', fldrw1eTFYCFIo0pp: 'Sunseeker Travel' } };
const payload = {
  fields: {
    first_name: '  Sarah ',
    last_name: 'Thompson',
    email: 'sarah@example.com',
    phone: '07700 900123',
    contact_consent: true,
    marketing_consent: true,
    destinations: [{ id: 'd1', name: 'Maldives' }, { id: 'd2', name: 'Sri Lanka' }],
    departure_airport: ['London Heathrow (LHR)', 'Gatwick (LGW)'],
    travel_dates: { depart: '2026-09-14', return: '2026-09-24', flexible: true },
    duration: { nights: 10 },
    travellers: { adults: 2, children: 2, childAges: [6, 9], infants: 1 },
    budget_pp: 4000,
    board: 'AI',
    stars: 5,
    flights_included: true,
    interests: ['direct flights', 'kids club'],
    notes: 'Honeymoon-ish, would love an overwater villa.',
  },
};

const body = buildLeadBody({ form, payload, reference: 'TG-2026-04823' });

ok(body.contact_name === 'Sarah Thompson', 'first + last name joined and trimmed');
ok(body.contact_email === 'sarah@example.com', 'email carried');
ok(body.contact_phone === '07700 900123', 'phone carried');
ok(body.destination === 'Maldives, Sri Lanka', 'destinations flattened to a string');
ok(body.departure_airport === 'London Heathrow (LHR), Gatwick (LGW)', 'airports flattened');
ok(body.depart_date === '2026-09-14', 'depart date carried');
ok(body.date_flexibility === 'flexible', 'flexible dates mapped');
ok(body.duration_nights === 10, 'duration nights carried');
ok(body.adults === 2 && body.children === 2, 'traveller counts carried');
ok(body.child_ages === '6, 9', 'child ages joined');
ok(body.budget === 4000, 'budget carried');
ok(body.budget_basis === 'per_person', 'budget marked per-person (widget collects pp)');
ok(body.board_basis === 'All inclusive', 'board code expanded to label');
ok(Array.isArray(body.must_haves) && body.must_haves.join(',') === 'direct flights,kids club', 'interests → must_haves');
ok(body.original_wording === 'Honeymoon-ish, would love an overwater villa.', "visitor's words kept as original wording");
ok(body.source === 'website', 'source pinned to website');
// Extras with no contract home must survive on the note, not vanish.
ok(/Return date: 2026-09-24/.test(body.notes), 'return date folded into note');
ok(/Infants: 1/.test(body.notes), 'infants folded into note');
ok(/Preferred rating: 5 star/.test(body.notes), 'star preference folded into note');
ok(/Flights included/.test(body.notes), 'flights flag folded into note');
ok(body.consent && body.consent.marketing_email === true, 'marketing consent → consent block');
ok(typeof body.consent.given_at === 'string', 'consent carries a timestamp');

// ---- A minimal submission (only the required fields) ------------------------

const minimal = buildLeadBody({
  form: { id: 'r', fields: {} },
  payload: { fields: { first_name: 'Jo', last_name: 'Bloggs', email: 'jo@example.com', contact_consent: true } },
  reference: 'TG-2026-1',
});
ok(minimal.contact_name === 'Jo Bloggs', 'minimal: name joined');
ok(minimal.destination === null, 'minimal: no destination is null, not empty string');
ok(minimal.date_flexibility === null, 'minimal: no dates → flexibility null');
ok(minimal.budget === null && minimal.budget_basis === null, 'minimal: no budget → both null');
ok(minimal.consent === undefined, 'minimal: no marketing consent → no consent block');
ok(Array.isArray(minimal.must_haves) && minimal.must_haves.length === 0, 'minimal: must_haves is an empty array');

// ---- Endpoint guard ---------------------------------------------------------

ok(isValidEndpoint('https://crm.travelify.io/api/widget/lead'), 'https CRM endpoint allowed');
ok(!isValidEndpoint('http://crm.travelify.io/api/widget/lead'), 'plain http rejected');
ok(!isValidEndpoint('https://localhost/api/widget/lead'), 'localhost rejected');
ok(!isValidEndpoint('https://127.0.0.1/x'), '127.0.0.1 rejected');
ok(!isValidEndpoint('https://10.0.0.5/x'), 'private 10.x rejected');
ok(!isValidEndpoint('https://169.254.169.254/latest/meta-data'), 'cloud metadata IP rejected');
ok(!isValidEndpoint('not a url'), 'garbage rejected');

// ---- Signature: byte-identical to what the CRM recomputes -------------------

const SECRET = 'a'.repeat(64);
const RAW = JSON.stringify({ contact_name: 'Sarah', contact_email: 'sarah@example.com' });
const header = signBody(RAW, SECRET);
const m = /^t=(\d+),v1=([0-9a-f]+)$/.exec(header);
ok(!!m, 'signature header has the t=…,v1=… shape');
if (m) {
  const t = m[1];
  const v1 = m[2];
  const expected = crypto.createHmac('sha256', SECRET).update(`${t}.${RAW}`).digest('hex');
  ok(v1 === expected, 'v1 is HMAC-SHA256 over `${t}.${rawBody}` (CRM verifies this exactly)');
  const wrong = crypto.createHmac('sha256', 'b'.repeat(64)).update(`${t}.${RAW}`).digest('hex');
  ok(v1 !== wrong, 'a different secret yields a different signature');
}

// ---- Default export: config refusals return before any network -------------

const noKey = await sendToLunaWork({ form: { id: 'r', fields: {} }, payload, reference: 'x' });
ok(noKey.status === 'failed' && /key/i.test(noKey.error), 'no ingest key → failed, no fetch');

const badKey = await sendToLunaWork({
  form: { id: 'r', fields: { fldG6LfpJb5sA1HkV: 'not-a-key', fldNmeld83IwtYlxT: SECRET } },
  payload, reference: 'x',
});
ok(badKey.status === 'failed' && /malformed/i.test(badKey.error), 'malformed key → failed, no fetch');

const noSecret = await sendToLunaWork({
  form: { id: 'r', fields: { fldG6LfpJb5sA1HkV: 'wlk_abcdef012345' } },
  payload, reference: 'x',
});
ok(noSecret.status === 'failed' && /secret/i.test(noSecret.error), 'no secret → failed, no fetch');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
