/**
 * Drives the Tripbuster BULK IMPORT UI in a real browser.
 *
 * Runs the real login / my-deals / import / offer-import handlers against an
 * in-memory PostgREST stand-in and a stand-in for the Travelgenix offer cache
 * (Upstash REST), so the whole journey is the production code path.
 *
 * Journey: sign in -> add deals in bulk -> template download -> upload a CSV ->
 * fix an unrecognised heading -> preview -> import -> re-upload (updates) ->
 * publish -> live feed locked (upsell) -> connected -> import offers -> resync
 * -> history.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import puppeteer from 'puppeteer-core';

const PUBLIC_DIR = path.resolve(import.meta.dirname, '..', 'public');
const SHOT_DIR = process.env.TB_SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'tb-import-'));
const PG_PORT = 8361;
const REDIS_PORT = 8362;
const APP_PORT = 8360;

process.env.TRIPBUSTER_SUPABASE_URL = `http://127.0.0.1:${PG_PORT}`;
process.env.TRIPBUSTER_SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.TRIPBUSTER_SESSION_SECRET = 'import-drive-secret-long-enough-for-hmac-32';
process.env.UPSTASH_REDIS_REST_URL = `http://127.0.0.1:${REDIS_PORT}`;
process.env.UPSTASH_REDIS_REST_TOKEN = 'test-redis-token';
process.env.RL_DISABLED = '1';

const bcrypt = (await import('bcryptjs')).default;
const { default: loginHandler } = await import('../api/tripbuster/login.js');
const { default: dealsHandler } = await import('../api/tripbuster/my-deals.js');
const { default: importHandler } = await import('../api/tripbuster/import.js');
const { default: offerImport } = await import('../api/tripbuster/offer-import.js');
const { default: accountHandler } = await import('../api/tripbuster/account.js');

const AGENT_ID = '00000001-0000-4000-8000-000000000000';
let n = 100;
const uid = () => `${String(++n).padStart(8, '0')}-0000-4000-8000-000000000000`;

const db = { agents: [], deals: [], import_runs: [] };
function seed() {
  db.deals = [];
  db.import_runs = [];
  db.agents = [{
    id: AGENT_ID, slug: 'sunseeker-travel', name: 'Sunseeker Travel',
    email: 'hello@sunseeker.co.uk', plan: 'Ignite', status: 'active',
    default_clickout_url: 'https://sunseekertravel.co.uk',
    atol_number: '11542', abta_number: null, protection_type: 'ATOL',
    tg_client_email: null, password_hash: bcrypt.hashSync('right-password', 10),
    phone: '01204 555 118', billing_mode: 'click', call_min_seconds: 60,
  }];
}

// ── PostgREST stand-in ──────────────────────────────────────
function matches(row, q) {
  for (const [k, v] of q.entries()) {
    if (['select', 'order', 'limit', 'offset'].includes(k)) continue;
    if (v === 'not.is.null') { if (row[k] === null || row[k] === undefined) return false; continue; }
    if (v === 'is.null') { if (!(row[k] === null || row[k] === undefined)) return false; continue; }
    if (!v.startsWith('eq.')) continue;
    if (String(row[k] ?? '') !== v.slice(3)) return false;
  }
  return true;
}

const pg = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const url = new URL(req.url, `http://127.0.0.1:${PG_PORT}`);
    const send = (code, obj) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(obj === undefined ? '' : JSON.stringify(obj));
    };
    const table = url.pathname.replace('/rest/v1/', '');
    const body = raw ? JSON.parse(raw) : null;

    if (table === 'rpc/tb_agent_deal_counts') {
      const mine = db.deals.filter((d) => d.agent_id === body.p_agent_id);
      return send(200, {
        live: mine.filter((d) => d.status === 'live').length,
        draft: mine.filter((d) => d.status === 'draft').length,
        paused: mine.filter((d) => d.status === 'paused').length,
        expired: 0, total: mine.length,
      });
    }
    if (table === 'rpc/tb_agent_source_counts') {
      const mine = db.deals.filter((d) => d.agent_id === body.p_agent_id);
      return send(200, {
        manual: mine.filter((d) => d.source === 'manual').length,
        spreadsheet: mine.filter((d) => d.source === 'spreadsheet').length,
        live_cache: mine.filter((d) => d.source === 'live_cache').length,
        total: mine.length,
      });
    }
    if (table === 'rpc/tb_agent_stats') {
      return send(200, {
        days: body.p_days, impressions: 4200, clicks: 130, billableClicks: 118,
        calls: 46, billableCalls: 29, ctr: 3.1, callRate: 1.1, perDeal: {},
      });
    }
    if (table === 'rpc/tb_agent_billing_counts') {
      const agent = db.agents.find((a) => a.id === body.p_agent_id);
      const mine = db.deals.filter((d) => d.agent_id === body.p_agent_id);
      const resolved = (d) => d.billing_mode || (agent && agent.billing_mode) || 'click';
      return send(200, {
        click: mine.filter((d) => resolved(d) === 'click').length,
        call: mine.filter((d) => resolved(d) === 'call').length,
        both: mine.filter((d) => resolved(d) === 'both').length,
        overridden: mine.filter((d) => !!d.billing_mode).length,
        total: mine.length,
      });
    }

    const store = db[table];
    if (!store) return send(404, { message: 'no table' });
    if (req.method === 'GET') return send(200, store.filter((r) => matches(r, url.searchParams)));
    if (req.method === 'POST') {
      const rows = (Array.isArray(body) ? body : [body])
        .map((r) => ({ id: uid(), created_at: new Date().toISOString(), ...r }));
      if (table === 'deals') {
        const clash = rows.some((r) => r.external_ref && db.deals.some(
          (d) => d.agent_id === r.agent_id && d.external_ref === r.external_ref));
        if (clash) return send(409, { message: 'duplicate key' });
      }
      store.push(...rows);
      return send(201, rows);
    }
    if (req.method === 'PATCH') {
      const hit = store.filter((r) => matches(r, url.searchParams));
      hit.forEach((r) => Object.assign(r, body));
      return send(200, hit);
    }
    if (req.method === 'DELETE') {
      const hit = store.filter((r) => matches(r, url.searchParams));
      db[table] = store.filter((r) => !hit.includes(r));
      return send(200, hit);
    }
    return send(405, {});
  });
});

// ── offer cache stand-in (Upstash REST) ─────────────────────
const redisStore = new Map();
const redis = http.createServer((req, res) => {
  const send = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  const segs = req.url.split('?')[0].split('/').filter(Boolean).map(decodeURIComponent);
  const [cmd, ...args] = segs;
  if (cmd === 'get') return send({ result: redisStore.get(args.join('/')) ?? null });
  if (cmd === 'keys') {
    const re = new RegExp(`^${args[0].replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
    return send({ result: [...redisStore.keys()].filter((k) => re.test(k)) });
  }
  return send({ result: null });
});

const nowMs = Date.now();
const inDays = (d) => new Date(nowMs + d * 86400000).toISOString();
const offer = (o) => ({
  id: 'OF1', type: 'Packages', price: 1200, pricePP: 600, currency: 'GBP',
  airport: 'ALC', airportName: 'Alicante', countryCode: 'ES', resort: 'Benidorm',
  hotel: 'Hotel Sol Pelicanos', rating: 3, boardBasis: 'All Inclusive', nights: 7,
  reviewRating: 8.4, origin: 'MAN', originName: 'Manchester', carrier: 'Jet2',
  outboundDate: inDays(45), returnDate: inDays(52),
  fetchedAt: new Date(nowMs - 3600e3).toISOString(),
  image: null, url: 'https://sunseekertravel.co.uk/book/OF1',
  adults: 2, children: 0, ...o,
});
function seedCache(offers) {
  redisStore.clear();
  redisStore.set('offers:packages:ES', JSON.stringify({ refreshedAt: new Date(nowMs - 7200e3).toISOString(), offers }));
}

// ── app server ──────────────────────────────────────────────
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };
function vercelify(req, res, url) {
  req.query = Object.fromEntries(url.searchParams.entries());
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => {
    if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(o));
    return res;
  };
  res.send = (s) => { res.end(String(s)); return res; };
}

const app = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${APP_PORT}`);
  const route = {
    '/api/tripbuster/login': loginHandler,
    '/api/tripbuster/my-deals': dealsHandler,
    '/api/tripbuster/import': importHandler,
    '/api/tripbuster/offer-import': offerImport,
    '/api/tripbuster/account': accountHandler,
  }[url.pathname];
  if (route) {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    await new Promise((r) => req.on('end', r));
    try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = {}; }
    vercelify(req, res, url);
    try { await route(req, res); } catch (e) {
      console.error('handler threw', e);
      if (!res.headersSent) res.writeHead(500).end('{}');
    }
    return;
  }
  const rel = url.pathname === '/tripbuster/dashboard' ? '/tripbuster/dashboard.html' : url.pathname;
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end('nf'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'text/plain' });
  res.end(fs.readFileSync(file));
});

await new Promise((r) => pg.listen(PG_PORT, r));
await new Promise((r) => redis.listen(REDIS_PORT, r));
await new Promise((r) => app.listen(APP_PORT, r));
seed();
seedCache([offer({}), offer({ id: 'OF2', hotel: 'Melia Benidorm', pricePP: 745, rating: 4 })]);

// ── the CSV files the agent uploads ─────────────────────────
const CSV_MAIN = [
  'Deal ref,Deal name,Hotel,Resort,Board,Nights,Flying from,Price PP,Was,Travel from,Internal notes,Status',
  'SUN-1,"7 nights in Benidorm, all inclusive",Hotel Sol Pelicanos,Benidorm,AI,7,Manchester|Gatwick,"£229","£319",01/02/2027,checked by Jo,live',
  'SUN-2,Algarve half board escape,Balaia Golf Village,Albufeira,HB,7,Gatwick,489,,10/05/2027,,live',
  'SUN-3,Costa Blanca late deal,Hotel Bali,Benidorm,BB,4,Birmingham,159,199,03/03/2027,,draft',
].join('\n');
const CSV_UPDATE = [
  'Deal ref,Price PP',
  'SUN-1,199',
].join('\n');
const CSV_MAIN_PATH = path.join(SHOT_DIR, 'agent-deals.csv');
const CSV_UPDATE_PATH = path.join(SHOT_DIR, 'agent-deals-prices.csv');
fs.writeFileSync(CSV_MAIN_PATH, CSV_MAIN);
fs.writeFileSync(CSV_UPDATE_PATH, CSV_UPDATE);

// ── drive ───────────────────────────────────────────────────
const results = [];
const check = (name, pass, detail) => results.push({ name, pass, detail });

const browser = await puppeteer.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1360, height: 1100, deviceScaleFactor: 1 });

const jsErrors = [];
const resourceNoise = [];
page.on('pageerror', (e) => jsErrors.push(e.message));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const t = m.text();
  if (/Failed to load resource/i.test(t)) resourceNoise.push(t);
  else jsErrors.push(t);
});
const csvResponses = [];
page.on('response', (r) => {
  if (r.url().includes('format=csv')) csvResponses.push({ status: r.status(), type: r.headers()['content-type'] });
});

const text = (sel) => page.$eval(sel, (el) => el.innerText);
const shot = (name) => page.screenshot({ path: path.join(SHOT_DIR, name), fullPage: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  await page.goto(`http://127.0.0.1:${APP_PORT}/tripbuster/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loginForm', { visible: true });
  await page.type('#li-email', 'hello@sunseeker.co.uk');
  await page.type('#li-pass', 'right-password');
  await page.click('#loginBtn');
  await page.waitForSelector('#appView', { visible: true });
  check('signs in', true);

  // ── the bulk import view ──────────────────────────────────
  await page.click('.nav-i[data-view="import"]');
  await page.waitForSelector('#v-import.on', { visible: true });
  check('the bulk import view opens from the sidebar', true);

  const routeCount = await page.$$eval('#routes .route', (b) => b.length);
  check('all three ingestion routes are offered', routeCount === 3, `${routeCount} routes`);

  const sheetActive = await page.$eval('.route[data-route="sheet"]', (b) => b.getAttribute('aria-pressed'));
  check('the spreadsheet route is selected by default', sheetActive === 'true', `aria-pressed=${sheetActive}`);

  // ── template download ─────────────────────────────────────
  await page.click('#getTemplate');
  await wait(400);
  const csvOk = csvResponses.some((r) => r.status === 200 && /text\/csv/.test(r.type || ''));
  check('the template downloads as CSV', csvOk, JSON.stringify(csvResponses));

  // ── upload a real file ────────────────────────────────────
  const input = await page.$('#fileInput');
  await input.uploadFile(CSV_MAIN_PATH);
  await page.waitForSelector('#previewCard', { visible: true });
  check('uploading a spreadsheet produces a preview', true);

  // Nothing may be written by a preview.
  check('the preview wrote nothing to the database', db.deals.length === 0, `${db.deals.length} deals`);

  // ── the unrecognised heading ──────────────────────────────
  const mapVisible = await page.$eval('#mapCard', (el) => el.style.display !== 'none');
  const mapHeader = mapVisible ? await text('#mapRows') : '';
  check('an unrecognised heading is surfaced for mapping',
    mapVisible && /Internal notes/.test(mapHeader), mapHeader.slice(0, 80));

  // ── what the preview says ─────────────────────────────────
  const previewText = await text('#previewTable');
  check('every row is shown as new', (previewText.match(/\bNEW\b/gi) || []).length === 3, previewText.slice(0, 200));
  check('the £ price and thousands separator were read', /229/.test(previewText), previewText.slice(0, 200));
  check('the day-first date was read as 1 February 2027',
    /2027-02-01/.test(previewText), previewText.slice(0, 300));
  check('the resort came through', /Benidorm/.test(previewText));

  const summary = await text('#previewSummary');
  check('the summary counts the new deals', /3 new/.test(summary), summary);

  const notes = await text('#previewNotes');
  check('the ignored column is reported', /did not recognise/.test(notes), notes.slice(0, 160));

  await shot('tb-imp-1-preview.png');

  // ── map the stray column, then re-check ───────────────────
  await page.select('#mapRows select', 'strapline');
  await page.click('#remap');
  await wait(500);
  const notes2 = await text('#previewNotes');
  check('mapping the stray column clears the warning', !/did not recognise/.test(notes2), notes2.slice(0, 160));
  const preview2 = await text('#previewTable');
  check('the preview still shows three new deals after remapping',
    (preview2.match(/\bNEW\b/gi) || []).length === 3);

  // ── import as drafts ──────────────────────────────────────
  await page.click('#doImport');
  await page.waitForFunction(() => document.querySelector('#previewCard').style.display === 'none',
    { timeout: 5000 });
  check('importing three deals writes three rows', db.deals.length === 3, `${db.deals.length}`);
  check('imported deals are stamped as coming from a spreadsheet',
    db.deals.every((d) => d.source === 'spreadsheet'));
  check('imported deals belong to the signed-in agent',
    db.deals.every((d) => d.agent_id === AGENT_ID));
  check('nothing went live, because publishing was left off',
    db.deals.every((d) => d.status === 'draft'), db.deals.map((d) => d.status).join(','));
  check('the reference was stored so a re-upload can match it',
    db.deals.every((d) => String(d.external_ref).startsWith('sheet:')),
    db.deals.map((d) => d.external_ref).join(','));

  // The deals list should now show them.
  await page.click('.nav-i[data-view="deals"]');
  await page.waitForSelector('#v-deals.on', { visible: true });
  await wait(400);
  const dealsText = await text('#dealList');
  check('the imported deals appear in My deals', /Benidorm/.test(dealsText), dealsText.slice(0, 160));

  // ── re-upload the price-only sheet: updates, not duplicates ──
  await page.click('.nav-i[data-view="import"]');
  await page.waitForSelector('#v-import.on', { visible: true });
  const input2 = await page.$('#fileInput');
  await input2.uploadFile(CSV_UPDATE_PATH);
  await page.waitForSelector('#previewCard', { visible: true });
  await wait(300);
  const upPreview = await text('#previewTable');
  check('re-uploading a known reference is shown as an update, not a new deal',
    /\bUPDATE\b/i.test(upPreview) && !/\bNEW\b/i.test(upPreview), upPreview.slice(0, 200));

  await page.click('#doImport');
  await page.waitForFunction(() => document.querySelector('#previewCard').style.display === 'none',
    { timeout: 5000 });
  check('the re-upload did not duplicate anything', db.deals.length === 3, `${db.deals.length}`);
  const sun1 = db.deals.find((d) => d.external_ref === 'sheet:SUN-1');
  check('the price was refreshed', Number(sun1.price_from) === 199, String(sun1.price_from));
  check('the title the sheet did not mention was left alone',
    /Benidorm/.test(sun1.title), sun1.title);

  // ── publish on ────────────────────────────────────────────
  const input3 = await page.$('#fileInput');
  await input3.uploadFile(CSV_MAIN_PATH);
  await page.waitForSelector('#previewCard', { visible: true });
  await wait(300);
  await page.click('#publishSheet');
  await page.click('#doImport');
  await page.waitForFunction(() => document.querySelector('#previewCard').style.display === 'none',
    { timeout: 5000 });
  const liveNow = db.deals.filter((d) => d.status === 'live');
  check('with publishing on, the rows marked live go live', liveNow.length === 2,
    db.deals.map((d) => `${d.external_ref}=${d.status}`).join(' '));
  check('the row marked draft in the sheet stayed a draft',
    db.deals.find((d) => d.external_ref === 'sheet:SUN-3').status === 'draft');

  await shot('tb-imp-2-imported.png');

  // ── the live feed, not a Travelgenix client ───────────────
  await page.click('.route[data-route="feed"]');
  await page.waitForFunction(() => document.querySelector('#feedLocked').style.display !== 'none',
    { timeout: 5000 });
  const locked = await text('#feedLocked');
  check('a non-Travelgenix agent sees the upsell, not an error',
    /Travelgenix clients/.test(locked), locked.slice(0, 120));
  check('the upsell says the other routes are still open',
    /Nothing here is locked behind it/.test(locked));
  const feedLiveHidden = await page.$eval('#feedLive', (el) => el.style.display === 'none');
  check('the offer browser stays hidden while unconnected', feedLiveHidden);
  await shot('tb-imp-3-feed-locked.png');

  // The upsell's own button routes to the spreadsheet panel.
  await page.click('#feedLocked .btn-primary');
  await wait(200);
  const backToSheet = await page.$eval('#panelSheet', (el) => el.style.display !== 'none');
  check('the upsell routes the agent to the spreadsheet instead', backToSheet);

  // ── connect the agent and reload ──────────────────────────
  db.agents[0].tg_client_email = 'sunseeker@travelgenix.io';
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#appView', { visible: true }); // session survives in sessionStorage
  await page.click('.nav-i[data-view="import"]');
  await page.waitForSelector('#v-import.on', { visible: true });
  await page.click('.route[data-route="feed"]');
  await page.waitForFunction(() => document.querySelector('#feedLive').style.display !== 'none',
    { timeout: 5000 });
  check('a connected agent gets the offer browser', true);

  const pill = await text('#feedPill');
  check('the route card shows it is connected', /Connected/.test(pill), pill);

  await page.waitForFunction(() => document.querySelectorAll('#offerList .offer').length > 0,
    { timeout: 5000 });
  const offerCount = await page.$$eval('#offerList .offer', (o) => o.length);
  check('live offers are listed', offerCount === 2, `${offerCount} offers`);

  const offerText = await text('#offerList');
  check('an offer shows the hotel and resort', /Sol Pelicanos/.test(offerText) && /Benidorm/.test(offerText),
    offerText.slice(0, 160));
  // The name and its details are separate spans; if they are not stacked they
  // render as one run-on line.
  const stacked = await page.$eval('#offerList .offer',
    (el) => getComputedStyle(el.querySelector('.offer-nm')).display === 'block'
         && getComputedStyle(el.querySelector('.offer-meta')).display === 'block');
  check('the offer name and its details are on separate lines', stacked);
  check('an offer shows a per-person price', /£600/.test(offerText), offerText.slice(0, 200));
  check('the destination filter is populated with real countries',
    /Spain/.test(await page.$eval('#fCountry', (s) => s.innerText)));

  const feedMeta = await text('#feedMeta');
  check('the feed says when it was last updated', /feed updated/.test(feedMeta), feedMeta);

  // ── select and import ─────────────────────────────────────
  await page.click('#selAll');
  const selCount = await text('#selCount');
  check('select all picks both offers', /2 selected/.test(selCount), selCount);

  const dealsBefore = db.deals.length;
  await page.click('#doFeedImport');
  await page.waitForFunction((before) => true, {}, dealsBefore);
  await wait(1200);
  const fromFeed = db.deals.filter((d) => d.source === 'live_cache');
  check('importing from the feed creates deals', fromFeed.length === 2, `${fromFeed.length}`);
  check('feed deals are stamped live_cache and owned by the agent',
    fromFeed.every((d) => d.agent_id === AGENT_ID));
  check('feed deals carry the price from the cache, not the browser',
    fromFeed.some((d) => Number(d.price_from) === 600), fromFeed.map((d) => d.price_from).join(','));
  check('feed deals record when they were synced', fromFeed.every((d) => !!d.synced_at));
  check('feed deals came in as drafts', fromFeed.every((d) => d.status === 'draft'));
  check('the deal title was built from the offer',
    fromFeed.some((d) => /Sol Pelicanos, Benidorm, 7 nights all inclusive/.test(d.title)),
    fromFeed.map((d) => d.title).join(' | '));

  await shot('tb-imp-4-feed-connected.png');

  // Already-imported offers are marked as such on the refreshed list.
  await wait(600);
  const offerText2 = await text('#offerList');
  check('an already-imported offer says so', /already imported/.test(offerText2), offerText2.slice(0, 200));

  // ── resync ────────────────────────────────────────────────
  // The agent rewrites a headline, then the upstream price changes.
  const mine = db.deals.find((d) => d.source === 'live_cache' && Number(d.price_from) === 600);
  mine.title = 'Our hand-picked Benidorm favourite';
  seedCache([offer({ pricePP: 429 }), offer({ id: 'OF2', hotel: 'Melia Benidorm', pricePP: 745, rating: 4 })]);
  await page.click('#resync');
  await wait(1200);
  const after = db.deals.find((d) => d.id === mine.id);
  check('a resync refreshes the price', Number(after.price_from) === 429, String(after.price_from));
  check('a resync keeps the headline the agent wrote',
    after.title === 'Our hand-picked Benidorm favourite', after.title);

  // ── history ───────────────────────────────────────────────
  await wait(600);
  const historyVisible = await page.$eval('#historyCard', (el) => el.style.display !== 'none');
  const runsText = historyVisible ? await text('#runs') : '';
  check('recent imports are listed', historyVisible && /Spreadsheet/.test(runsText) && /Live feed/.test(runsText),
    runsText.slice(0, 220));
  const lead = await text('#historyLead');
  check('the history summarises where deals came from',
    /from a spreadsheet/.test(lead) && /from your live feed/.test(lead), lead);

  await shot('tb-imp-5-history.png');

  // ── what the agency is charged for ────────────────────────
  await page.click('.nav-i[data-view="plan"]');
  await page.waitForSelector('#v-plan.on', { visible: true });
  await wait(500);

  const modeCount = await page.$$eval('#billModes .route', (b) => b.length);
  check('all three billing modes are offered', modeCount === 3, `${modeCount}`);

  const clickSelected = await page.$eval('.route[data-mode="click"]', (b) => b.getAttribute('aria-pressed'));
  check('the current mode is shown as selected', clickSelected === 'true', `aria-pressed=${clickSelected}`);

  // On clicks, the phone settings are irrelevant and stay out of the way.
  const phoneHiddenOnClick = await page.$eval('#callSettings', (el) => el.style.display === 'none');
  check('phone settings are hidden while charging for clicks', phoneHiddenOnClick);

  await page.click('.route[data-mode="call"]');
  await wait(200);
  const phoneShown = await page.$eval('#callSettings', (el) => el.style.display !== 'none');
  const noteShown = await page.$eval('#callNote', (el) => el.style.display !== 'none');
  check('choosing calls reveals the number and qualifying length', phoneShown);
  check('and explains what is actually chargeable', noteShown);

  const noteText = await text('#callNote');
  check('the note is honest that an unproven tap is not charged for',
    /never charged for/.test(noteText), noteText.slice(0, 140));

  // Saving with no number must be refused, not silently accepted.
  await page.$eval('#acctPhone', (el) => { el.value = ''; });
  await page.click('#saveBilling');
  await wait(700);
  const errShown = await page.$eval('#billErr', (el) => el.classList.contains('on'));
  check('switching to calls with no number is refused', errShown);
  check('and the agency was not switched over', db.agents[0].billing_mode === 'click',
    db.agents[0].billing_mode);

  await page.type('#acctPhone', '0141 555 907');
  await page.select('#acctMinSecs', '90');
  await page.click('#saveBilling');
  await wait(900);
  check('with a number it saves', db.agents[0].billing_mode === 'call', db.agents[0].billing_mode);
  check('the qualifying length saves too', db.agents[0].call_min_seconds === 90,
    String(db.agents[0].call_min_seconds));
  check('the number keeps its spacing for travellers to read',
    db.agents[0].phone === '0141 555 907', db.agents[0].phone);

  // The performance tiles follow the mode: no click-through rate on a call-first
  // agency, because that figure means nothing to them.
  await page.click('.nav-i[data-view="deals"]');
  await page.waitForSelector('#v-deals.on', { visible: true });
  await wait(700);
  const statsText = await text('#stats');
  check('the figures switch to calls', /Calls/i.test(statsText), statsText.replace(/\n/g, ' | ').slice(0, 160));
  check('and drop the click-through rate', !/Click-through rate/i.test(statsText),
    statsText.replace(/\n/g, ' | ').slice(0, 160));

  // A single deal can disagree with its agency.
  await page.click('.nav-i[data-view="editor"]');
  await page.waitForSelector('#v-editor.on', { visible: true });
  await wait(300);
  const overrideOptions = await page.$$eval('#f-billing_mode option', (o) => o.map((x) => x.value));
  check('a deal can override the agency billing mode',
    overrideOptions.join(',') === ',click,call,both', overrideOptions.join(','));
  const inheritHint = await text('#billingHint');
  check('the editor says what the deal would inherit',
    /calls to your number/.test(inheritHint), inheritHint);

  const pageText = await page.evaluate(() => document.body.innerText);
  check('no date anywhere reads as "Invalid Date"', !/Invalid Date/.test(pageText));

  check('no uncaught JavaScript errors across the whole journey',
    jsErrors.length === 0, jsErrors.join(' | ').slice(0, 400));
} catch (err) {
  check('the drive completed', false, err.message);
  try { await shot('tb-imp-FAIL.png'); } catch (e) { /* ignore */ }
} finally {
  await browser.close();
  await new Promise((r) => app.close(r));
  await new Promise((r) => redis.close(r));
  await new Promise((r) => pg.close(r));
}

let pass = 0;
for (const r of results) {
  if (r.pass) { pass++; console.log(`PASS  ${r.name}`); } else {
    console.log(`FAIL  ${r.name}${r.detail ? `\n      ${r.detail}` : ''}`);
  }
}
if (resourceNoise.length) console.log(`\n(resource console noise, not asserted: ${resourceNoise.length})`);
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
