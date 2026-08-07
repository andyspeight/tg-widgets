/**
 * Group Trips — tour page + enquiry smoke (headless Playwright).
 * Run: node test/trips-page-smoke.mjs        (npm run test:trips-page)
 *
 * Covers the full landing page render, the enquiry form's three paths
 * (preview / honeypot / real POST) and the house negative + XSS controls:
 *   1. demo-trips-page renders the full details from inline config
 *   2. XSS control — a hostile overview/message renders as inert text
 *   3. NEGATIVE CONTROL — an unconfigured trips-page renders nothing
 *   4. Enquiry preview mode (no widgetId) shows the preview notice, no POST
 *   5. Enquiry honeypot — filling the hidden field shows thanks, no POST
 *   6. Enquiry real submit — posts the right payload to /api/trip-enquiry
 *      and shows the thank-you state
 *   7. Enquiry validation — bad email is blocked client-side, no POST
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, '..', 'public');

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
function serve(dir, port) {
  return new Promise((res) => {
    const s = http.createServer((req, rsp) => {
      const p = decodeURIComponent(req.url.split('?')[0]);
      if (p.startsWith('/api/')) { rsp.statusCode = 404; rsp.setHeader('Content-Type', 'application/json'); return rsp.end('{"error":"not here"}'); }
      const fp = path.join(dir, p === '/' ? 'index.html' : p);
      if (!fp.startsWith(dir) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) { rsp.statusCode = 404; return rsp.end('nf'); }
      rsp.setHeader('Content-Type', MIME[path.extname(fp)] || 'application/octet-stream');
      fs.createReadStream(fp).pipe(rsp);
    });
    s.listen(port, () => res(s));
  });
}

const PORT = 8124;
const BASE = `http://localhost:${PORT}`;
const server = await serve(PUBLIC, PORT);

const executablePath = process.env.TGS_CHROMIUM || undefined;
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

const isNoise = (t) => /Failed to load resource|net::|ERR_|fonts\.googleapis|fonts\.gstatic|images\.unsplash|favicon/i.test(t);

async function newPage() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e));
  page.on('console', (m) => { if (m.type() === 'error' && !isNoise(m.text())) errors.push('console: ' + m.text()); });
  await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://fonts.gstatic.com/**', (r) => r.abort());
  await page.route('https://images.unsplash.com/**', (r) => r.abort());
  return { page, errors };
}

// ── 1. Demo tour page renders full details from inline config ────────────────
{
  const { page, errors } = await newPage();
  await page.goto(`${BASE}/demo-trips-page.html`, { waitUntil: 'load', timeout: 20000 });
  await page.waitForFunction(() => {
    const el = document.getElementById('demo-page');
    return !!(el && el.shadowRoot && el.shadowRoot.querySelector('[data-role="title"]'));
  }, { timeout: 8000 }).catch(() => {});

  const d = await page.evaluate(() => {
    const sr = document.getElementById('demo-page')?.shadowRoot;
    if (!sr) return null;
    return {
      title: sr.querySelector('[data-role="title"]')?.textContent || '',
      price: sr.querySelector('[data-role="price"]')?.textContent || '',
      overview: (sr.querySelector('[data-role="overview"]')?.textContent || ''),
      highlights: sr.querySelectorAll('.tgtp-highlights li').length,
      included: sr.querySelectorAll('.tgtp-inc li').length,
      excluded: sr.querySelectorAll('.tgtp-exc li').length,
      itinerary: sr.querySelectorAll('.tgtp-itin li').length,
      gallery: sr.querySelectorAll('.tgtp-gallery img').length,
      hasForm: !!sr.querySelector('[data-role="form"]'),
      depositNote: sr.querySelector('[data-role="deposit-note"]')?.textContent || '',
      hasBookBtn: /book now|pay deposit/i.test(sr.textContent || ''),
    };
  });
  ok(!!d, 'page: tour page mounted a shadow root');
  if (d) {
    ok(d.title === 'Santorini Yoga Retreat 2027', `page: title from config (got "${d.title}")`);
    ok(d.price === '£1,899', `page: price-from strip (got "${d.price}")`);
    ok(/caldera rim/.test(d.overview), 'page: overview rendered');
    ok(d.highlights === 6, `page: 6 highlights (got ${d.highlights})`);
    ok(d.included === 6, `page: 6 included items (got ${d.included})`);
    ok(d.excluded === 4, `page: 4 excluded items (got ${d.excluded})`);
    ok(d.itinerary === 7, `page: 7 itinerary days (got ${d.itinerary})`);
    ok(d.gallery === 3, `page: 3 gallery images (got ${d.gallery})`);
    ok(d.hasForm, 'page: enquiry form present');
    ok(/deposit/.test(d.depositNote) && /coming soon/i.test(d.depositNote), 'page: deposit note reads as coming soon');
    ok(!d.hasBookBtn, 'page: no book/pay-deposit button yet (enquiry only)');
  }
  ok(errors.length === 0, 'page: no script errors (' + errors.join(' | ') + ')');
  await page.close();
}

// ── 2. XSS control — hostile overview + message stay inert ───────────────────
{
  const { page, errors } = await newPage();
  const cfg = JSON.stringify({
    trip: { title: 'X Trip', startDate: '2027-05-10', location: 'Testville', currency: 'gbp', pricePence: 100000 },
    details: { overview: '<img src=x onerror=window.__xss=1>', highlights: ['<b>safe?</b>'] },
  }).replace(/'/g, '&#39;');
  await page.setContent(
    `<!doctype html><html><body><div id="t" data-tg-widget="trips-page" data-tg-config='${cfg}'></div>` +
    `<script src="${BASE}/widget-trips-page.js"></script></body></html>`,
    { waitUntil: 'load' }
  );
  await page.waitForTimeout(250);
  const xss = await page.evaluate(() => {
    const sr = document.getElementById('t')?.shadowRoot;
    return {
      fired: typeof window.__xss !== 'undefined',
      overviewText: sr?.querySelector('[data-role="overview"]')?.textContent || '',
      rogueImg: !!sr?.querySelector('img[src="x"]'),
      boldInjected: !!sr?.querySelector('.tgtp-highlights b'),
    };
  });
  ok(!xss.fired, 'xss: onerror payload never executed');
  ok(xss.overviewText.includes('<img src=x'), 'xss: hostile overview renders as literal text');
  ok(!xss.rogueImg, 'xss: no element created from overview text');
  ok(!xss.boldInjected, 'xss: highlight markup not parsed as HTML');
  ok(errors.length === 0, 'xss: no script errors (' + errors.join(' | ') + ')');
  await page.close();
}

// ── 3. NEGATIVE CONTROL — unconfigured page renders nothing ──────────────────
{
  const { page } = await newPage();
  await page.setContent(
    `<!doctype html><html><body><div id="empty" data-tg-widget="trips-page" data-tg-config='{}'></div>` +
    `<script src="${BASE}/widget-trips-page.js"></script></body></html>`,
    { waitUntil: 'load' }
  );
  await page.waitForTimeout(200);
  const neg = await page.evaluate(() => {
    const el = document.getElementById('empty');
    return {
      hiddenAttr: el?.getAttribute('data-tg-hidden') || '',
      title: el?.shadowRoot?.querySelector('[data-role="title"]')?.textContent ?? null,
      form: el?.shadowRoot?.querySelector('[data-role="form"]') ?? null,
    };
  });
  ok(neg.hiddenAttr === 'unconfigured', 'negative: host marked data-tg-hidden=unconfigured');
  ok(neg.title === null && neg.form === null, 'negative: no title and no form without config (selectors bite)');
  await page.close();
}

// Helper: mount a configured tour page, optionally with a widget id.
async function mountPage(page, { withId } = {}) {
  const cfg = JSON.stringify({
    trip: { title: 'Enquiry Trip', startDate: '2027-05-10', location: 'Testville', currency: 'gbp', pricePence: 150000, depositPence: 30000 },
    details: { overview: 'A trip.' },
    enquiry: { heading: 'Ask us', buttonText: 'Send' },
  }).replace(/'/g, '&#39;');
  const idAttr = withId ? ` data-tg-id="tgw_test_page_1"` : '';
  await page.setContent(
    `<!doctype html><html><body><div id="t" data-tg-widget="trips-page"${idAttr} data-tg-config='${cfg}'></div>` +
    `<script src="${BASE}/widget-trips-page.js"></script></body></html>`,
    { waitUntil: 'load' }
  );
  await page.waitForFunction(() => {
    const el = document.getElementById('t');
    return !!(el && el.shadowRoot && el.shadowRoot.querySelector('[data-role="form"]'));
  }, { timeout: 6000 });
}

// Fill and submit the shadow-DOM enquiry form via evaluate (inputs live in shadow).
async function fillAndSubmit(page, { name, email, message, honeypot }) {
  await page.evaluate((vals) => {
    const sr = document.getElementById('t').shadowRoot;
    const set = (sel, v) => { const el = sr.querySelector(sel); if (el != null) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); } };
    set('#tgtp-name', vals.name || '');
    set('#tgtp-email', vals.email || '');
    set('#tgtp-message', vals.message || '');
    if (vals.honeypot) set('input[name="website"]', vals.honeypot);
    sr.querySelector('[data-role="form"]').requestSubmit(sr.querySelector('[data-role="submit"]'));
  }, { name, email, message, honeypot });
  await page.waitForTimeout(150);
}

const statusText = (page) => page.evaluate(() => {
  const sr = document.getElementById('t').shadowRoot;
  return {
    status: sr.querySelector('[data-role="status"]')?.textContent || '',
    thanks: !!sr.querySelector('[data-role="thanks"]'),
  };
});

// ── 4. Preview mode (no widgetId) — notice shown, no POST ────────────────────
{
  const { page, errors } = await newPage();
  let posted = false;
  await page.route('**/api/trip-enquiry', (r) => { posted = true; r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); });
  await mountPage(page, { withId: false });
  await fillAndSubmit(page, { name: 'Ada', email: 'ada@example.com', message: 'hi' });
  const s = await statusText(page);
  ok(/preview/i.test(s.status), `preview: shows a preview notice (got "${s.status}")`);
  ok(!posted, 'preview: no enquiry POST made without a saved widget id');
  ok(errors.length === 0, 'preview: no script errors (' + errors.join(' | ') + ')');
  await page.close();
}

// ── 5. Honeypot — thanks shown, no POST ──────────────────────────────────────
{
  const { page } = await newPage();
  let posted = false;
  await page.route('**/api/trip-enquiry', (r) => { posted = true; r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); });
  await mountPage(page, { withId: true });
  await fillAndSubmit(page, { name: 'Bot', email: 'bot@example.com', message: 'spam', honeypot: 'http://spam' });
  const s = await statusText(page);
  ok(s.thanks, 'honeypot: shows the thank-you state');
  ok(!posted, 'honeypot: filled hidden field means no POST');
  await page.close();
}

// ── 6. Real submit — correct payload posted, thank-you shown ─────────────────
{
  const { page, errors } = await newPage();
  let body = null;
  await page.route('**/api/trip-enquiry', (r) => {
    try { body = JSON.parse(r.request().postData() || '{}'); } catch { body = {}; }
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, leadId: 'lead_x' }) });
  });
  await mountPage(page, { withId: true });
  await fillAndSubmit(page, { name: 'Grace Hopper', email: 'grace@example.com', message: 'Two rooms please' });
  await page.waitForTimeout(150);
  const s = await statusText(page);
  ok(!!body, 'submit: an enquiry POST was made');
  if (body) {
    ok(body.widgetId === 'tgw_test_page_1', `submit: posts the widget id (got "${body.widgetId}")`);
    ok(body.email === 'grace@example.com', 'submit: posts the email');
    ok(body.name === 'Grace Hopper', 'submit: posts the name');
    ok(body.message === 'Two rooms please', 'submit: posts the message');
    ok(body.website === '', 'submit: honeypot field posted empty');
  }
  ok(s.thanks, 'submit: shows the thank-you state on success');
  ok(errors.length === 0, 'submit: no script errors (' + errors.join(' | ') + ')');
  await page.close();
}

// ── 7. Validation — bad email blocked client-side, no POST ───────────────────
{
  const { page } = await newPage();
  let posted = false;
  await page.route('**/api/trip-enquiry', (r) => { posted = true; r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); });
  await mountPage(page, { withId: true });
  await fillAndSubmit(page, { name: 'Ada', email: 'not-an-email', message: 'hi' });
  const s = await statusText(page);
  ok(/valid email/i.test(s.status), `validation: rejects a bad email (got "${s.status}")`);
  ok(!posted, 'validation: no POST on invalid email');
  await page.close();
}

// ── 8. Proper demo page — card AND full page from one seeded config ──────────
// /demo-trips is the canonical demo the dashboard links to: card on top, full
// tour page beneath, both built from a single shared config.
{
  const { page, errors } = await newPage();
  await page.goto(`${BASE}/demo-trips.html`, { waitUntil: 'load', timeout: 20000 });
  await page.waitForFunction(() => {
    const c = document.getElementById('demo-card');
    const p = document.getElementById('demo-page');
    return !!(c && c.shadowRoot && c.shadowRoot.querySelector('[data-role="title"]')
      && p && p.shadowRoot && p.shadowRoot.querySelector('[data-role="form"]'));
  }, { timeout: 8000 }).catch(() => {});

  const s = await page.evaluate(() => {
    const card = document.getElementById('demo-card')?.shadowRoot;
    const pg = document.getElementById('demo-page')?.shadowRoot;
    return {
      cardTitle: card?.querySelector('[data-role="title"]')?.textContent || '',
      cardPrice: card?.querySelector('[data-role="price"]')?.textContent || '',
      pageTitle: pg?.querySelector('[data-role="title"]')?.textContent || '',
      pageItinerary: pg?.querySelectorAll('.tgtp-itin li').length || 0,
      pageForm: !!pg?.querySelector('[data-role="form"]'),
    };
  });
  ok(s.cardTitle === 'Santorini Yoga Retreat 2027', `suite: card renders the tour (got "${s.cardTitle}")`);
  ok(s.cardPrice === '£1,899', `suite: card shows the price (got "${s.cardPrice}")`);
  ok(s.pageTitle === 'Santorini Yoga Retreat 2027', 'suite: full page renders the same tour');
  ok(s.pageItinerary === 7, `suite: full page shows the itinerary (got ${s.pageItinerary} days)`);
  ok(s.pageForm, 'suite: full page includes the enquiry form');
  ok(errors.length === 0, 'suite: no script errors (' + errors.join(' | ') + ')');
  await page.close();
}

await browser.close();
server.close();

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
