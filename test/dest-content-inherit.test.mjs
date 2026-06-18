/**
 * Inheritance smoke test for /api/destination-content.
 *
 * Runs the REAL handler with a stubbed global.fetch so we can prove that a
 * resort-level Spotlight inherits the new "Good to know" planning fields:
 *   - trip duration from its parent CITY (own value wins)
 *   - price band / booking lead / visa status + advisory / health from its
 *     grandparent COUNTRY (walked up two levels)
 *
 * No network, no Airtable. Field IDs mirror destination-content.js LEVEL_MAP.
 *
 * Run: node test/dest-content-inherit.test.mjs
 */

process.env.AIRTABLE_KEY = 'key_test';
process.env.AIRTABLE_BASE_ID = 'appWIDGETSXXXXXXX';
process.env.AIRTABLE_DESTINATION_CONTENT_PAT = 'pat_test';

// ---- Canned Airtable records, keyed by field ID (returnFieldsByFieldId) ----
const RESORT_ID  = 'recRESORT00000001';
const CITY_ID    = 'recCITY0000000001';
const COUNTRY_ID = 'recCOUNTRY0000001';

const resortFields = {
  fldnvOipaWpG3W1rx: 'Oludeniz',                 // name
  fldrUx3VrEMJPheIP: [CITY_ID],                  // City/Region parent link
  // everything else (facts + planning) deliberately blank -> must inherit
};

const cityFields = {
  fld2VkY61c1JKUWKB: 'Dalaman',                  // name
  fldmJaOJZcMFtJNZD: [COUNTRY_ID],               // Country parent link
  fldPSVfkYVAIhtNDp: ['7 nights'],               // Trip Duration (own -> should win)
  // price/visa/health not held at city level -> inherit from country
};

const countryFields = {
  flddJJrpwcXOwWIow: 'Turkey',                   // name
  fldoe2LemU2kZS3EP: 'Turkish Lira (₺)',         // currency (a quick fact, to prove facts still inherit)
  fldJOZeflKobE2o9g: '££',                       // Price Band UK
  fld3JLyT3MsMGWVT4: 'Book ahead (3-6 months)',  // Booking Lead Time
  flduOcMEuPq3cnVG5: ['7 nights', '10-14 nights'], // Trip Duration (country)
  fldmKvRkDDRjj7PT2: 'eVisa required',           // Visa Status UK
  fldecKeSnkZ6ABZfd: 'UK passport holders need an eVisa. Apply online before travel.', // Visa Advisory
  fldOGSgbbH3BIoU6A: 'No mandatory vaccinations. Routine UK vaccinations recommended.', // Health Notes
};

const widgetConfig = { destination: { level: 'resort', recordId: RESORT_ID } };

// ---- fetch stub ----
function recordResponse(id, fields) {
  return { ok: true, status: 200, json: async () => ({ records: [{ id, fields }] }) };
}

global.fetch = async (url) => {
  const u = String(url);
  if (u.includes('/Widgets?') || u.includes('/Widgets&') || /\/Widgets(\?|$)/.test(u)) {
    return { ok: true, status: 200, json: async () => ({ records: [{ id: 'recWIDGET00000001', fields: { Config: JSON.stringify(widgetConfig) } }] }) };
  }
  if (u.includes('tblwV9gnbVEyZ99gI')) return recordResponse(RESORT_ID, resortFields);   // resorts
  if (u.includes('tblTkKujdVZgWPAQe')) return recordResponse(CITY_ID, cityFields);       // cities
  if (u.includes('tblsxbqbyhTDoWhbo')) return recordResponse(COUNTRY_ID, countryFields); // countries
  throw new Error('Unexpected fetch URL in test: ' + u);
};

// ---- mock req/res ----
function makeRes() {
  return {
    _status: 200,
    _json: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this._status = c; return this; },
    json(obj) { this._json = obj; return this; },
    end() { return this; },
  };
}

function assert(cond, msg) {
  if (!cond) { console.error('FAIL: ' + msg); process.exitCode = 1; }
  else { console.log('  ok  ' + msg); }
}

const handler = (await import('../api/destination-content.js')).default;

const req = {
  method: 'GET',
  query: { id: 'tgs_test_widget' },
  headers: { 'x-forwarded-for': '203.0.113.7' },
  socket: { remoteAddress: '203.0.113.7' },
};
const res = makeRes();
await handler(req, res);

console.log('\nHTTP', res._status);
const p = res._json || {};
console.log(JSON.stringify(p.planning, null, 2));
console.log('planningInherited:', JSON.stringify(p.planningInherited));

console.log('\nAssertions:');
assert(res._status === 200, 'responds 200');
assert(p.level === 'resort', 'level is resort');
assert(p.planning, 'planning object present');
assert(p.planning.priceBand === '££', 'price band inherited from country (££)');
assert(p.planning.bookingLead === 'Book ahead (3-6 months)', 'booking lead inherited from country');
assert(p.planning.visaStatus === 'eVisa required', 'visa status inherited from country');
assert(/eVisa/.test(p.planning.visaAdvisory || ''), 'visa advisory inherited from country');
assert(/vaccinations/.test(p.planning.healthNotes || ''), 'health notes inherited from country');
assert(Array.isArray(p.planning.tripDuration) && p.planning.tripDuration.join(',') === '7 nights',
  'trip duration uses the CITY own value (7 nights), not the country list');
assert(p.planningInherited && p.planningInherited.priceBand === 'country', 'priceBand marked inherited from country');
assert(p.planningInherited && p.planningInherited.tripDuration === 'city', 'tripDuration marked inherited from city');
assert(p.facts && p.facts.currency === 'Turkish Lira (₺)', 'quick facts still inherit (currency from country)');

console.log(process.exitCode ? '\nRESULT: FAILURES' : '\nRESULT: ALL PASS');
