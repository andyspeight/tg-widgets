/**
 * Travelify integration — the behavioural half.
 *
 * Drives the real /api/v1 handlers and the real SSO deep-link resolver against
 * a mocked Airtable, pinning every acceptance criterion in the contract
 * (docs/travelify-widget-integration.md):
 *
 *   - a valid key and a valid Application ID return correctly scoped JSON
 *   - a missing or wrong key returns 401 AND NO WIDGET DATA
 *   - a non-integer Application ID is 400; a real integer for an unknown
 *     application is 404
 *   - My Widgets returns only installed widgets, each with a count of 1 or more
 *   - a valid widgetId deep links; an unknown one falls back without erroring
 *   - all three touchpoints use the identical widgetId
 *
 * Run: node test/travelify-platform-api-smoke.mjs  (npm run test:travelify-api)
 */
let passed = 0, failed = 0;
const ok = (cond, label, detail) => {
  if (cond) { passed++; }
  else { failed++; console.error('  FAIL: ' + label + (detail ? '\n        ' + detail : '')); }
};

const API_KEY = 'shared-secret-under-test';
process.env.TRAVELIFY_PLATFORM_API_KEY = API_KEY;
process.env.AIRTABLE_KEY = 'pat_test';
process.env.AIRTABLE_PAT = 'pat_test';
process.env.AIRTABLE_BASE_ID = 'appAYzWZxvK6qlwXK';
process.env.TG_SESSION_SECRET = 'test-session-secret-0123456789abcdef0123456789';
process.env.TG_PUBLIC_ORIGIN = 'https://widgets.travelify.io';
// Keep the catalogue-status read off Redis so the tests are deterministic.
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.KV_REST_API_URL;

const CLIENTS_TABLE = 'tblikekpaTKraMktZ';
const CATALOGUE_TABLE = 'tblJHOJlt63QmuxEq';
const CF_EMAIL = 'fldVRiIAlrTjxnNHP';
const CF_PLAN = 'fldBgDeQdtwMqTIS4';
const CAT_WIDGET_ID = 'fldAF01jPEeJSpGFr';
const CAT_STATUS = 'flddYY41TmQRi2ZFr';

const CLIENT_ID = 'recCLIENTAAAAAAAA';

// Mutable fixture the individual cases reshape.
const state = {
  clientsByAppId: { '12345': { id: CLIENT_ID, fields: { [CF_EMAIL]: 'agency@example.com', [CF_PLAN]: 'Ignite' } } },
  clientsByEmail: { 'agency@example.com': [CLIENT_ID] },
  widgetRows: [],
  catalogueStatuses: {},
  widgetQueryUrls: [],
};

const json = (obj) => ({ ok: true, status: 200, json: async () => obj, text: async () => JSON.stringify(obj) });

global.fetch = async (url) => {
  const u = String(url);

  // Clients lookup by Travelify App ID, or by email for the shared-email check.
  if (u.includes(`/${CLIENTS_TABLE}?`)) {
    const formula = decodeURIComponent(new URL(u).searchParams.get('filterByFormula') || '');
    const appId = (formula.match(/Travelify App ID\}(?:&'')?=n?'?(\d+)'?/) || [])[1]
      || (formula.match(/(\d+)/) || [])[1];
    if (/Travelify App ID/.test(formula)) {
      const rec = state.clientsByAppId[appId];
      return json({ records: rec ? [rec] : [] });
    }
    const email = (formula.match(/Email\}\)='([^']+)'/) || [])[1];
    const ids = state.clientsByEmail[email] || [];
    return json({ records: ids.map((id) => ({ id, fields: {} })) });
  }

  // Client record by id (plan resolution).
  const byId = u.match(new RegExp(`/${CLIENTS_TABLE}/(rec[A-Za-z0-9]{14})`));
  if (byId) {
    const rec = Object.values(state.clientsByAppId).find((c) => c.id === byId[1]);
    return rec ? json(rec) : { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  }

  // Widget Catalogue Status.
  if (u.includes(CATALOGUE_TABLE)) {
    return json({
      records: Object.entries(state.catalogueStatuses).map(([id, status], i) => ({
        id: `recCAT${String(i).padStart(11, '0')}`,
        fields: { [CAT_WIDGET_ID]: id, [CAT_STATUS]: status },
      })),
    });
  }

  // The Widgets table — My Widgets instance counting.
  if (u.includes('/Widgets?')) {
    state.widgetQueryUrls.push(u);
    return json({ records: state.widgetRows.map((type, i) => ({ id: `recW${i}`, fields: { WidgetType: type } })) });
  }

  throw new Error('unmocked fetch: ' + u);
};

const { default: directory } = await import('../api/v1/applications/[applicationId]/widget-directory.js');
const { default: myWidgets } = await import('../api/v1/applications/[applicationId]/my-widgets.js');
const { _test: ssoTest } = await import('../api/auth/sso.js');
const { WIDGETS_BY_ID } = await import('../api/_lib/widget-registry.js');
const { TRAVELIFY_CATEGORIES } = await import('../api/_lib/widget-public-categories.js');

function mockReq({ applicationId = '12345', key = API_KEY, method = 'GET', headers = {} } = {}) {
  return {
    method,
    query: { applicationId },
    headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'widgets.travelify.io',
      ...(key === null ? {} : { 'x-api-key': key }), ...headers },
  };
}
function mockRes() {
  return {
    statusCode: 200, body: undefined, headers: {},
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    getHeader(k) { return this.headers[k.toLowerCase()]; },
    status(n) { this.statusCode = n; return this; },
    json(o) { if (this.body === undefined) this.body = o; return this; },
    send(s) { if (this.body === undefined) this.body = typeof s === 'string' ? JSON.parse(s) : s; return this; },
    end() { return this; },
  };
}
async function call(handler, opts) {
  const res = mockRes();
  await handler(mockReq(opts), res);
  return res;
}

console.log('Travelify platform API\n');

// ── Authentication ─────────────────────────────────────────────────────────
for (const [label, key] of [['missing', null], ['wrong', 'not-the-key'], ['empty', '   ']]) {
  for (const [name, handler] of [['directory', directory], ['my-widgets', myWidgets]]) {
    const res = await call(handler, { key });
    ok(res.statusCode === 401, `${name}: a ${label} key is 401`, `got ${res.statusCode}`);
    ok(res.body?.error?.code === 'invalid_api_key', `${name}: a ${label} key uses the error envelope`);
    ok(res.body?.widgets === undefined, `${name}: a ${label} key returns NO widget data`);
  }
}

// ── Application ID validation ──────────────────────────────────────────────
for (const bad of ['abc', '', '12.5', '-1', '12345678901', 'null']) {
  const res = await call(directory, { applicationId: bad });
  ok(res.statusCode === 400, `application id "${bad}" is 400`, `got ${res.statusCode}`);
  ok(res.body?.error?.code === 'invalid_application_id', `application id "${bad}" reports invalid_application_id`);
}

const missing = await call(directory, { applicationId: '99999' });
ok(missing.statusCode === 404, 'a valid integer for an unknown application is 404', `got ${missing.statusCode}`);
ok(missing.body?.error?.code === 'invalid_application', '404 uses the invalid_application code');
ok(/99999/.test(missing.body?.error?.message || ''), '404 message names the application');
ok(!/rec[A-Za-z0-9]{14}/.test(JSON.stringify(missing.body)), '404 leaks no internal record id');

const wrongMethod = await call(directory, { method: 'POST' });
ok(wrongMethod.statusCode === 405, 'a non-GET is 405');

// ── Directory happy path ───────────────────────────────────────────────────
const dir = await call(directory);
ok(dir.statusCode === 200, 'directory returns 200', `got ${dir.statusCode} ${JSON.stringify(dir.body)}`);
ok(dir.body?.applicationId === 12345, 'directory echoes applicationId as an integer');
ok(Array.isArray(dir.body?.widgets) && dir.body.widgets.length > 0, 'directory returns widgets');
ok(dir.body.widgets.every((w) => TRAVELIFY_CATEGORIES.includes(w.category)),
  'every directory category is from the controlled list');
ok(dir.body.widgets.every((w) => w.imageUrl.startsWith('https://')),
  'every directory imageUrl is absolute HTTPS');
ok(dir.body.widgets.every((w) => w.widgetId && w.name && w.description && w.category && w.imageUrl),
  'every directory widget carries all five required fields');
ok(dir.body.widgets.every((w) => WIDGETS_BY_ID[w.widgetId]),
  'every directory widgetId resolves in the registry (so the SSO deep link works)');
ok(typeof dir.getHeader('etag') === 'string', 'directory sends an ETag');
ok(/max-age/.test(dir.getHeader('cache-control') || ''), 'directory is cacheable');

// Conditional request → 304, no body.
const etag = dir.getHeader('etag');
const res304 = mockRes();
await directory(mockReq({ headers: { 'if-none-match': etag } }), res304);
ok(res304.statusCode === 304, 'directory answers 304 for a matching ETag', `got ${res304.statusCode}`);
ok(res304.body === undefined, '304 carries no body');

// ── Plan scoping ───────────────────────────────────────────────────────────
state.clientsByAppId['12345'].fields[CF_PLAN] = 'Spark';
const spark = await call(directory);
ok(spark.body.widgets.length < dir.body.widgets.length,
  'a Spark client sees fewer widgets than an Ignite client',
  `spark=${spark.body.widgets.length} ignite=${dir.body.widgets.length}`);

// A coming-soon widget is withheld even when the plan includes it.
const sparkIds = spark.body.widgets.map((w) => w.widgetId);
state.catalogueStatuses = { [sparkIds[0]]: 'coming-soon' };
const withSoon = await call(directory);
ok(!withSoon.body.widgets.some((w) => w.widgetId === sparkIds[0]),
  'a coming-soon widget is withheld from the directory');
state.catalogueStatuses = {};
state.clientsByAppId['12345'].fields[CF_PLAN] = 'Ignite';

// An entitled-to-nothing application still gets 200 and an empty array.
state.clientsByAppId['12345'].fields[CF_PLAN] = '';
const noPlan = await call(directory);
ok(noPlan.statusCode === 200 && Array.isArray(noPlan.body.widgets) && noPlan.body.widgets.length === 0,
  'a valid application entitled to nothing is 200 with an empty array');
state.clientsByAppId['12345'].fields[CF_PLAN] = 'Ignite';

// ── My Widgets ─────────────────────────────────────────────────────────────
state.widgetRows = [];
const emptyMine = await call(myWidgets);
ok(emptyMine.statusCode === 200 && emptyMine.body.widgets.length === 0,
  'an application with nothing installed is 200 with an empty array');

state.widgetRows = ['Google Reviews', 'Google Reviews', 'FAQ', 'Not A Real Type', 'Escorted Tour'];
const mine = await call(myWidgets);
ok(mine.statusCode === 200, 'my-widgets returns 200', `got ${mine.statusCode} ${JSON.stringify(mine.body)}`);
const counts = Object.fromEntries(mine.body.widgets.map((w) => [w.widgetId, w.instanceCount]));
ok(counts.reviews === 2, 'my-widgets counts repeated instances', JSON.stringify(counts));
ok(counts.faq === 1 && counts.tour === 1, 'my-widgets counts single instances');
ok(mine.body.widgets.length === 3, 'a row whose type is not in the registry is left out', JSON.stringify(counts));
ok(mine.body.widgets.every((w) => w.instanceCount >= 1), 'every instanceCount is 1 or more');
ok(mine.body.widgets.every((w) => w.widgetId && w.name && w.description && w.category && w.imageUrl),
  'my-widgets returns the full field set, not just what Travelify renders today');
ok(mine.body.widgets.every((w) => TRAVELIFY_CATEGORIES.includes(w.category)),
  'every my-widgets category is from the controlled list');
const names = mine.body.widgets.map((w) => w.name);
ok(names.join() === [...names].sort((a, b) => a.localeCompare(b, 'en')).join(),
  'my-widgets is ordered deterministically, so the ETag is stable');

// The scope formula must pin the owning client, never the email alone.
const lastQuery = decodeURIComponent(state.widgetQueryUrls.at(-1) || '');
ok(lastQuery.includes(`{ClientRecordId}='${CLIENT_ID}'`), 'my-widgets scopes by the owning client record');

// A shared login email must drop the legacy email fallback.
state.clientsByEmail['agency@example.com'] = [CLIENT_ID, 'recOTHERCLIENTXXX'];
await call(myWidgets);
const sharedQuery = decodeURIComponent(state.widgetQueryUrls.at(-1) || '');
ok(!sharedQuery.includes('ClientEmail'),
  'a login email shared with another account drops the legacy fallback');
state.clientsByEmail['agency@example.com'] = [CLIENT_ID];

// ── The same widget is described identically everywhere ────────────────────
state.widgetRows = ['Google Reviews'];
const both = await call(myWidgets);
const fromMine = both.body.widgets.find((w) => w.widgetId === 'reviews');
const fromDir = (await call(directory)).body.widgets.find((w) => w.widgetId === 'reviews');
ok(fromMine && fromDir, 'reviews appears in both responses');
ok(fromMine.name === fromDir.name && fromMine.category === fromDir.category
  && fromMine.imageUrl === fromDir.imageUrl && fromMine.description === fromDir.description,
  'directory and my-widgets describe the same widget identically');

// ── SSO deep link ──────────────────────────────────────────────────────────
const ignite = { fields: { [CF_PLAN]: 'Ignite' } };
ok(await ssoTest.widgetDeepLink('faq', ignite) === WIDGETS_BY_ID.faq.editorUrl,
  'a valid widgetId deep links to that widget editor');
ok(await ssoTest.widgetDeepLink('FAQ', ignite) === WIDGETS_BY_ID.faq.editorUrl,
  'widgetId matching is case-insensitive');
ok(await ssoTest.widgetDeepLink(undefined, ignite) === null,
  'no widgetId means the normal target (homepage behaviour is preserved)');
ok(await ssoTest.widgetDeepLink('no-such-widget', ignite) === null,
  'an unknown widgetId falls back rather than erroring');
ok(await ssoTest.widgetDeepLink('reviews', { fields: { [CF_PLAN]: 'Spark' } }) === null,
  'a widgetId the plan does not include falls back');
ok(await ssoTest.widgetDeepLink('faq', { fields: {} }) === null,
  'an unresolved plan falls back rather than deep linking');

// Open redirect: nothing from the query may reach the Location header.
for (const hostile of [
  'https://evil.example.com', '//evil.example.com', '/admin', '../admin',
  '/editor-faq', 'faq/../../admin', 'javascript:alert(1)', '%2Fadmin',
]) {
  ok(await ssoTest.widgetDeepLink(hostile, ignite) === null,
    `deep link refuses a hostile widgetId: ${hostile}`);
}
ok(await ssoTest.widgetDeepLink(['faq', 'evil'], ignite) === WIDGETS_BY_ID.faq.editorUrl,
  'a repeated widgetId param takes the first value safely');

// safeNext is untouched by the change.
ok(ssoTest.safeNext(undefined) === '/dashboard.html', 'no next still lands on the dashboard');
ok(ssoTest.safeNext('https://evil.example.com') === '/dashboard.html', 'next still refuses an absolute URL');
ok(ssoTest.safeNext('/dashboard.html') === '/dashboard.html', 'next still allows the dashboard');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
