/**
 * Travel Results AI endpoint — the stability pass (8 Sep 2026).
 *
 * Low temperature so the same search answers the same way; a model and
 * temperature that change without a deploy; one retry inside the widget's
 * budget; one structured log line per call; and an origin policy that lets a
 * client's own domain through when it sends a valid, on-plan widget id, and
 * refuses everything else WITH a CORS header so the widget can read the 403
 * and alert, instead of the invisible browser block it used to get.
 *
 * Drives the REAL handler with a mocked model and a mocked Airtable.
 *
 * Run: node test/trai-endpoint-smoke.mjs   (npm run test:trai-endpoint)
 */
process.env.NODE_ENV = 'test';
process.env.ANTHROPIC_API_KEY = 'sk-test';
process.env.AIRTABLE_PAT = 'pat-test';
delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.UPSTASH_REDIS_REST_TOKEN;
delete process.env.TRAI_MODEL; delete process.env.TRAI_TEMPERATURE;

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

// ---- mocks ----
const modelQueue = [];            // each entry: { status, body } or 'ok'
const modelBodies = [];
const widgets = {                 // widgetId -> Airtable record (fields by id)
  tgw_ignite: { id: 'recW1', fields: { fldxRWtizMv3Y57Ep: 'tgw_ignite', fldTmwmW7ZNOfxMsS: 'Travel Results AI', fldXaQVeJuIJ51KY4: 'recCIGNITE' } },
  tgw_spark:  { id: 'recW2', fields: { fldxRWtizMv3Y57Ep: 'tgw_spark',  fldTmwmW7ZNOfxMsS: 'Travel Results AI', fldXaQVeJuIJ51KY4: 'recCSPARK' } },
  tgw_faq:    { id: 'recW3', fields: { fldxRWtizMv3Y57Ep: 'tgw_faq',    fldTmwmW7ZNOfxMsS: 'FAQ',               fldXaQVeJuIJ51KY4: 'recCIGNITE' } },
  tgw_legacy: { id: 'recW4', fields: { fldxRWtizMv3Y57Ep: 'tgw_legacy', fldTmwmW7ZNOfxMsS: 'Travel Results AI' } },
};
const clients = { recCIGNITE: { id: 'recCIGNITE', fields: { fldBgDeQdtwMqTIS4: 'Ignite' } }, recCSPARK: { id: 'recCSPARK', fields: { fldBgDeQdtwMqTIS4: 'Spark' } } };
let airtableDown = false;
global.fetch = async (url, opts) => {
  const u = String(url);
  if (u.startsWith('https://api.anthropic.com/')) {
    modelBodies.push(JSON.parse(opts.body));
    const next = modelQueue.length ? modelQueue.shift() : 'ok';
    if (next === 'ok') return { ok: true, status: 200, json: async () => ({ stop_reason: 'end_turn', usage: { input_tokens: 900, output_tokens: 120 }, content: [{ type: 'text', text: JSON.stringify({ reply: 'Two good options.', recommendations: [{ rid: 'p1', category: 'Best value', reason: 'Closest to the centre.' }, { rid: 'zzz', category: 'x', reason: 'made up' }] }) }] }) };
    return { ok: false, status: next.status, text: async () => next.body || 'busy' };
  }
  if (u.startsWith('https://api.airtable.com/')) {
    if (airtableDown) return { ok: false, status: 503, text: async () => 'down' };
    const m = /\/v0\/[^/]+\/(tbl[A-Za-z0-9]+)(?:\/(rec[A-Za-z0-9]+))?(\?.*)?$/.exec(u);
    const table = m && m[1], rec = m && m[2], qs = m && m[3] ? decodeURIComponent(m[3]) : '';
    if (table === 'tblVAThVqAjqtria2') { const id = /='([^']+)'/.exec(qs); const w = id && widgets[id[1]]; return { ok: true, status: 200, json: async () => ({ records: w ? [w] : [] }) }; }
    if (table === 'tblikekpaTKraMktZ') { const c = clients[rec]; return c ? { ok: true, status: 200, json: async () => c } : { ok: false, status: 404, text: async () => 'nf' }; }
    return { ok: false, status: 404, text: async () => 'nf' };
  }
  throw new Error('unexpected fetch ' + u);
};
const logs = [];
const realLog = console.log; console.log = (...a) => { const s = a.join(' '); if (s.startsWith('[trai] ')) logs.push(JSON.parse(s.slice(7))); else realLog(...a); };
const realErr = console.error; console.error = () => {};

const { default: handler } = await import('../api/travel-results-ai.js');

const SHORTLIST = [{ rid: 'p1', n: 'A', star: 4, p: 1190 }, { rid: 'p2', n: 'B', star: 3, p: 720 }];
async function call({ method = 'POST', origin = 'https://www.sunshine-holidays.co.uk', body } = {}) {
  const out = { status: 0, body: null, headers: {} };
  const res = { setHeader: (k, v) => { out.headers[k.toLowerCase()] = v; }, status: (c) => { out.status = c; return res; }, json: (b) => { out.body = b; return res; }, end: () => res };
  const headers = { 'x-forwarded-for': '1.2.3.4' }; if (origin) headers.origin = origin;
  await handler({ method, headers, body: body === undefined ? { criteria: { locationName: 'X' }, shortlist: SHORTLIST, searchSession: 's1' } : body }, res);
  return out;
}
const withId = (widgetId, extra) => Object.assign({ criteria: { locationName: 'X' }, shortlist: SHORTLIST, searchSession: 's1', widgetId }, extra || {});

console.log = realLog;
console.log('Origin policy: demo origins pass, client domains need an on-plan widget');
console.log = (...a) => { const s = a.join(' '); if (s.startsWith('[trai] ')) logs.push(JSON.parse(s.slice(7))); else realLog(...a); };
{
  const pre = await call({ method: 'OPTIONS' });
  ok(pre.status === 204 && pre.headers['access-control-allow-origin'] === 'https://www.sunshine-holidays.co.uk', 'the preflight echoes a client origin so the POST can be judged');
  const demo = await call({ origin: 'https://www.traveldemo.site' });
  ok(demo.status === 200 && demo.headers['access-control-allow-origin'] === 'https://www.traveldemo.site', 'a demo origin passes with no widget id');
  const bare = await call({});
  ok(bare.status === 403 && bare.body.code === 'no_id' && bare.headers['access-control-allow-origin'] === 'https://www.sunshine-holidays.co.uk', 'a client domain with no widget id is refused WITH the CORS header');
  const noOrigin = await call({ origin: '' });
  ok(noOrigin.status === 403 && noOrigin.body.code === 'no_id', 'no Origin at all needs a widget id too');
  const ignite = await call({ body: withId('tgw_ignite') });
  ok(ignite.status === 200 && ignite.body.recommendations.length === 1 && ignite.body.recommendations[0].rid === 'p1', 'an Ignite client widget on its own domain gets an answer (invalid rids dropped)');
  const spark = await call({ body: withId('tgw_spark') });
  ok(spark.status === 403 && spark.body.code === 'not_on_plan', 'a Spark client widget is refused: not on plan');
  const faq = await call({ body: withId('tgw_faq') });
  ok(faq.status === 403 && faq.body.code === 'wrong_type', 'a widget of another type is refused');
  const unknown = await call({ body: withId('tgw_nope') });
  ok(unknown.status === 403 && unknown.body.code === 'not_found', 'an unknown widget id is refused');
  const legacy = await call({ body: withId('tgw_legacy') });
  ok(legacy.status === 200, 'a legacy widget with no owning client fails open');
  ok(logs.some((l) => l.ok === true && l.widgetId === 'tgw_legacy' && l.gate === 'ok_unverified'), 'and the log says the gate was unverified');
  airtableDown = true;
  const down = await call({ body: withId('tgw_fresh1') });
  airtableDown = false;
  ok(down.status === 200 && logs.some((l) => l.widgetId === 'tgw_fresh1' && l.gate === 'ok_unverified'), 'an Airtable outage fails open, like the save-time gate');
  const refused = logs.filter((l) => l.reason === 'refused');
  ok(refused.length >= 4 && refused.every((l) => l.code), 'every refusal is logged with its code');
}

console.log = realLog; console.log('Determinism, overrides, retry and the structured line'); console.log = (...a) => { const s = a.join(' '); if (s.startsWith('[trai] ')) logs.push(JSON.parse(s.slice(7))); else realLog(...a); };
{
  const b = modelBodies[modelBodies.length - 1];
  ok(b.temperature === 0.2, 'temperature 0.2 on every call');
  ok(b.model === 'claude-sonnet-4-6', 'the default model is unchanged');
  ok(b.max_tokens === 700 && Array.isArray(b.system) && b.system[0].cache_control, 'the rest of the request is as before');
  modelQueue.push({ status: 529, body: 'overloaded' });
  const before = modelBodies.length;
  const r = await call({ origin: 'https://www.traveldemo.site' });
  ok(r.status === 200 && modelBodies.length === before + 2, 'a busy model is retried once');
  const line = logs[logs.length - 1];
  ok(line.ok === true && line.attempts === 2 && line.shortlist === 2 && line.returned === 2 && line.valid === 1 && line.model === 'claude-sonnet-4-6' && typeof line.ms === 'number' && line.inTok === 900, 'the structured line records attempts, sizes, validity, tokens and time');
  modelQueue.push({ status: 400, body: 'bad request' });
  const nr = await call({ origin: 'https://www.traveldemo.site' });
  ok(nr.status === 502 && logs[logs.length - 1].reason === 'model' && logs[logs.length - 1].attempts === 1, 'a 4xx from the model is not retried and is logged');
  ok(logs.every((l) => !('lead' in l) && !('name' in l)), 'nothing personal in the log line');
}

console.log = realLog; console.log('Source guards'); 
{
  const { readFileSync } = await import('node:fs');
  const SRC = readFileSync(new URL('../api/travel-results-ai.js', import.meta.url), 'utf8');
  ok(/process\.env\.TRAI_MODEL \|\| 'claude-sonnet-4-6'/.test(SRC) && /process\.env\.TRAI_TEMPERATURE/.test(SRC), 'model and temperature have env overrides');
  ok(/AbortSignal\.timeout\(Math\.min\(ATTEMPT_TIMEOUT_MS, remaining\)\)/.test(SRC) && /TOTAL_BUDGET_MS = 17000/.test(SRC), 'per-attempt timeout inside a 17s budget, under the widget\'s 18s');
  ok(/import \{ PLAN_WIDGET_LIMITS, canonicalisePlan \} from '\.\/widget-config\.js'/.test(SRC), 'the gate reads the same plan table as the save-time gate');
  const V = readFileSync(new URL('../vercel.json', import.meta.url), 'utf8');
  ok(/"api\/travel-results-ai\.js": \{\s*"maxDuration": 30/.test(V), 'the function has a 30s limit in vercel.json');
}
console.error = realErr;
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
