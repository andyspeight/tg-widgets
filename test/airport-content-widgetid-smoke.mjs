/**
 * Airport content endpoint — accepts the widget's PUBLIC WidgetID (27 Jul 2026).
 *
 * The Airport Spotlight widget fetches content with ?widgetId=<data-tg-id>, which
 * is the public WidgetID (tgw_...). The endpoint used to require an Airtable
 * record id (isRecordId) and read the Config field by NAME while fetching
 * id-keyed fields, so EVERY live embed got a 400 and showed "Could not load
 * airport details" (the editor still worked because it previews by IATA).
 *
 * Drives the REAL handler with a mocked Airtable fetch and asserts the public
 * WidgetID path resolves the airport, a rec id still works, and junk is refused.
 * Run: node test/airport-content-widgetid-smoke.mjs
 */
process.env.AIRTABLE_KEY = 'key_test';

const { default: handler } = await import('../api/airport-content.js');

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

const CONFIG_FIELD = 'fldSLN8AteAGB7qE1'; // Widgets.Config
const AF_NAME = 'fldlT6eApAdQHGYED', AF_IATA = 'fldcS9uu4NWMVaIVP', AF_ROLE = 'fldUSTC6kdgXNgKfI';
const AIRPORT_REC = 'recAIRPORT1234567'; // rec + 14 chars

const okJson = (obj) => ({ ok: true, status: 200, json: async () => obj, text: async () => JSON.stringify(obj) });
const widgetRecord = {
  id: 'recWIDGET1234567',
  fields: { [CONFIG_FIELD]: JSON.stringify({ airport: { recordId: AIRPORT_REC, iata: 'DXB' } }) },
};
const airportRecord = { id: AIRPORT_REC, fields: { [AF_NAME]: 'Dubai International', [AF_IATA]: 'DXB', [AF_ROLE]: 'origin' } };

let calledWidgetLookupBy = null;
global.fetch = async (url) => {
  const u = String(url);
  if (u.includes('/tblI2iVAbIGCtsGa7/' + AIRPORT_REC)) return okJson(airportRecord); // airport by id
  if (u.includes('/tblVAThVqAjqtria2')) {
    calledWidgetLookupBy = u.includes('filterByFormula') ? 'formula' : 'getRecord';
    // A WidgetID formula lookup returns a list; a getRecord returns the record.
    return okJson(u.includes('filterByFormula') ? { records: [widgetRecord] } : widgetRecord);
  }
  return okJson({ records: [] });
};

function mockRes() {
  const r = { statusCode: 0, body: null, headers: {} };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.end = () => r;
  return r;
}
const run = async (query) => {
  const res = mockRes();
  await handler({ method: 'GET', query, headers: { origin: 'https://client.example' } }, res);
  return res;
};

// ── The reported case: the public WidgetID (tgw_...) now resolves the airport ──
calledWidgetLookupBy = null;
let res = await run({ widgetId: 'tgw_1785157117434_ipetu2' });
ok(res.statusCode === 200, `public WidgetID → 200 (got ${res.statusCode})`);
ok(res.body && res.body.found === true, 'found: true');
ok(res.body && res.body.airport && res.body.airport.iata === 'DXB', 'resolved the DXB airport');
ok(res.body && res.body.airport.name === 'Dubai International', 'airport name resolved');
ok(calledWidgetLookupBy === 'formula', 'a public WidgetID is looked up via {WidgetID} filterByFormula');

// ── A rec id still works (editor / direct), via getRecord ────────────────────
calledWidgetLookupBy = null;
res = await run({ widgetId: 'recWIDGET12345678' }); // rec + 14 chars
ok(res.statusCode === 200 && res.body.found === true, 'a rec-id widgetId still resolves');
ok(calledWidgetLookupBy === 'getRecord', 'a rec id is resolved by getRecord, not a formula');

// ── Junk widgetId is refused (formula-injection guard) ───────────────────────
res = await run({ widgetId: "tgw' OR 1=1 --" });
ok(res.statusCode === 400, 'a widgetId with unsafe characters → 400');

// ── Direct IATA mode still works ─────────────────────────────────────────────
global.fetch = async (url) => {
  const u = String(url);
  if (u.includes('filterByFormula') && u.includes('tblI2iVAbIGCtsGa7')) return okJson({ records: [airportRecord] });
  return okJson({ records: [] });
};
res = await run({ iata: 'DXB' });
ok(res.statusCode === 200 && res.body.found === true, 'IATA mode (editor preview) still works');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
