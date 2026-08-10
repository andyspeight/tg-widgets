/**
 * Escorted Tour page smoke (headless Playwright).
 * Run: node test/tour-page-smoke.mjs        (npm run test:tour)
 *
 *   1. demo-tour renders every section from the Kenya seed (hero, glance table,
 *      highlights, rich days with facts + optional activities, extras,
 *      includes/excludes, flexible sections, gallery, enquiry)
 *   2. XSS control — hostile day/section content renders inert
 *   3. NEGATIVE CONTROL — an unconfigured tour renders nothing
 *   4. Enquiry preview mode shows the notice, no POST
 *   5. Enquiry real submit posts to /api/trip-enquiry and thanks
 *   6. Availability shows in the price bar (places left / sold out / hidden)
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
      if (p.startsWith('/api/')) { rsp.statusCode = 404; rsp.setHeader('Content-Type', 'application/json'); rsp.setHeader('Access-Control-Allow-Origin', '*'); return rsp.end('{"error":"not here"}'); }
      const fp = path.join(dir, p === '/' ? 'index.html' : p);
      if (!fp.startsWith(dir) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) { rsp.statusCode = 404; return rsp.end('nf'); }
      rsp.setHeader('Content-Type', MIME[path.extname(fp)] || 'application/octet-stream');
      fs.createReadStream(fp).pipe(rsp);
    });
    s.listen(port, () => res(s));
  });
}

const PORT = 8125;
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

// ── 1. Demo renders every section from the Kenya seed ────────────────────────
{
  const { page, errors } = await newPage();
  await page.goto(`${BASE}/demo-tour.html`, { waitUntil: 'load', timeout: 20000 });
  await page.waitForFunction(() => {
    const el = document.getElementById('mount');
    return !!(el && el.shadowRoot && el.shadowRoot.querySelector('[data-role="title"]'));
  }, { timeout: 8000 }).catch(() => {});

  const d = await page.evaluate(() => {
    const sr = document.getElementById('mount')?.shadowRoot;
    if (!sr) return null;
    const txt = (s) => sr.querySelector(s)?.textContent || '';
    return {
      title: txt('[data-role="title"]'),
      price: txt('[data-role="price"]'),
      heroChips: sr.querySelectorAll('.tgto-hero-chips .tgto-chip').length,
      glanceRows: sr.querySelectorAll('[data-role="glance"] tbody tr').length,
      glanceHeadCols: sr.querySelectorAll('[data-role="glance"] thead th').length,
      highlights: sr.querySelectorAll('.tgto-highlights li').length,
      days: sr.querySelectorAll('[data-role="day"]').length,
      dayFacts: sr.querySelectorAll('[data-role="day"] .tgto-facts').length,
      optionalBlocks: sr.querySelectorAll('.tgto-optional').length,
      optionalText: txt('.tgto-optional'),
      extras: sr.querySelectorAll('[data-role="extras"] .tgto-extra').length,
      recExtra: !!sr.querySelector('.tgto-extra.rec .tgto-recpill'),
      included: sr.querySelectorAll('[data-role="incex"] .tgto-inc li').length,
      excluded: sr.querySelectorAll('[data-role="incex"] .tgto-exc li').length,
      sections: sr.querySelectorAll('[data-role="section"]').length,
      hasColumns: !!sr.querySelector('.tgto-cols'),
      hasFeature: !!sr.querySelector('.tgto-feature'),
      gallery: sr.querySelectorAll('.tgto-gallery img').length,
      pricebar: txt('[data-role="pricebar"]'),
      hasForm: !!sr.querySelector('[data-role="form"]'),
    };
  });

  ok(!!d, 'tour: widget mounted a shadow root');
  if (d) {
    ok(d.title === 'Kenya Johari na Bahari Safari', `tour: hero title (got "${d.title}")`);
    ok(d.price === '£3,495', `tour: price-from chip (got "${d.price}")`);
    ok(d.heroChips >= 4, `tour: hero renders dates/duration/location/price as chips (got ${d.heroChips})`);
    ok(d.glanceHeadCols === 4 && d.glanceRows === 11, `tour: at-a-glance table 4 cols x 11 rows (got ${d.glanceHeadCols}x${d.glanceRows})`);
    ok(d.highlights === 7, `tour: 7 highlights (got ${d.highlights})`);
    ok(d.days === 9, `tour: 9 day blocks incl grouped days (got ${d.days})`);
    ok(d.dayFacts >= 8, `tour: per-day facts rendered (got ${d.dayFacts})`);
    ok(d.optionalBlocks >= 1 && /£100 pp/.test(d.optionalText), `tour: per-day priced optional activities (got "${d.optionalText.slice(0,60)}")`);
    ok(d.extras === 2 && d.recExtra, `tour: extras with a Recommended flag (got ${d.extras}, rec=${d.recExtra})`);
    ok(d.included === 11 && d.excluded === 4, `tour: includes/excludes (got ${d.included}/${d.excluded})`);
    ok(d.sections === 4 && d.hasColumns && d.hasFeature, `tour: flexible sections incl columns + feature (got ${d.sections})`);
    ok(d.gallery === 4, `tour: gallery images (got ${d.gallery})`);
    ok(d.pricebar.includes('£3,495') && /per person sharing/i.test(d.pricebar), 'tour: price bar with per-person-sharing');
    ok(d.hasForm, 'tour: enquiry form present');
  }
  ok(errors.length === 0, 'tour: no script errors (' + errors.join(' | ') + ')');
  await page.close();
}

// ── 1b. Day-by-day is collapsible (all closed, click to open) ────────────────
{
  const { page, errors } = await newPage();
  await page.goto(`${BASE}/demo-tour.html`, { waitUntil: 'load', timeout: 20000 });
  await page.waitForFunction(() => {
    const el = document.getElementById('mount');
    return !!(el && el.shadowRoot && el.shadowRoot.querySelector('[data-role="day"]'));
  }, { timeout: 8000 }).catch(() => {});

  const collapsed = await page.evaluate(() => {
    const sr = document.getElementById('mount').shadowRoot;
    const days = [...sr.querySelectorAll('[data-role="day"]')];
    const firstBody = days[0].querySelector('.tgto-day-body');
    return {
      total: days.length,
      open: days.filter(d => d.classList.contains('is-open')).length,
      headsCollapsed: sr.querySelectorAll('.tgto-day-head[aria-expanded="false"]').length,
      isButton: days[0].querySelector('.tgto-day-head')?.tagName === 'BUTTON',
      firstBodyDisplay: firstBody ? getComputedStyle(firstBody).display : 'none',
    };
  });
  ok(collapsed.total === 9 && collapsed.open === 0, `collapse: all ${collapsed.total} days start collapsed (open=${collapsed.open})`);
  ok(collapsed.headsCollapsed === 9 && collapsed.isButton, 'collapse: day heads are buttons with aria-expanded=false');
  ok(collapsed.firstBodyDisplay === 'none', 'collapse: day bodies are hidden by default');

  // Open the first day
  await page.evaluate(() => document.getElementById('mount').shadowRoot.querySelector('.tgto-day-head').click());
  await page.waitForTimeout(100);
  const opened = await page.evaluate(() => {
    const sr = document.getElementById('mount').shadowRoot;
    const first = sr.querySelector('[data-role="day"]');
    const body = first.querySelector('.tgto-day-body');
    return {
      open: first.classList.contains('is-open'),
      expanded: first.querySelector('.tgto-day-head').getAttribute('aria-expanded'),
      bodyDisplay: body ? getComputedStyle(body).display : 'none',
      othersStillClosed: [...sr.querySelectorAll('[data-role="day"]')].slice(1).every(d => !d.classList.contains('is-open')),
    };
  });
  ok(opened.open && opened.expanded === 'true' && opened.bodyDisplay !== 'none', 'collapse: clicking a day opens it (aria-expanded true, body shown)');
  ok(opened.othersStillClosed, 'collapse: opening one day leaves the others closed');
  ok(errors.length === 0, 'collapse: no script errors (' + errors.join(' | ') + ')');
  await page.close();
}

// ── 2. XSS control ───────────────────────────────────────────────────────────
{
  const { page, errors } = await newPage();
  const cfg = JSON.stringify({
    tour: { title: 'X Tour', location: 'Testville', currency: 'gbp', pricePerPersonPence: 100000 },
    days: [{ label: 'Day 1', title: '<img src=x onerror=window.__xss=1>', body: '<b>hi</b>' }],
    sections: [{ type: 'text', heading: 'Note', body: '<script>window.__xss2=1<\/script>' }],
  }).replace(/'/g, '&#39;');
  await page.setContent(
    `<!doctype html><html><body><div id="t" data-tg-widget="tour" data-tg-config='${cfg}'></div>` +
    `<script src="${BASE}/widget-tour.js"></script></body></html>`, { waitUntil: 'load' });
  await page.waitForTimeout(250);
  const xss = await page.evaluate(() => {
    const sr = document.getElementById('t')?.shadowRoot;
    return {
      fired: typeof window.__xss !== 'undefined' || typeof window.__xss2 !== 'undefined',
      dayTitle: sr?.querySelector('.tgto-day-title')?.textContent || '',
      rogueImg: !!sr?.querySelector('img[src="x"]'),
      boldInjected: !!sr?.querySelector('.tgto-day-body b'),
    };
  });
  ok(!xss.fired, 'xss: payloads never executed');
  ok(xss.dayTitle.includes('<img src=x'), 'xss: hostile day title renders as literal text');
  ok(!xss.rogueImg && !xss.boldInjected, 'xss: no elements created from config text');
  ok(errors.length === 0, 'xss: no script errors (' + errors.join(' | ') + ')');
  await page.close();
}

// ── 3. NEGATIVE CONTROL — unconfigured tour renders nothing ──────────────────
{
  const { page } = await newPage();
  await page.setContent(
    `<!doctype html><html><body><div id="e" data-tg-widget="tour" data-tg-config='{}'></div>` +
    `<script src="${BASE}/widget-tour.js"></script></body></html>`, { waitUntil: 'load' });
  await page.waitForTimeout(200);
  const neg = await page.evaluate(() => {
    const el = document.getElementById('e');
    return {
      hiddenAttr: el?.getAttribute('data-tg-hidden') || '',
      title: el?.shadowRoot?.querySelector('[data-role="title"]')?.textContent ?? null,
      form: el?.shadowRoot?.querySelector('[data-role="form"]') ?? null,
    };
  });
  ok(neg.hiddenAttr === 'unconfigured', 'negative: host marked data-tg-hidden=unconfigured');
  ok(neg.title === null && neg.form === null, 'negative: no title and no form without config');
  await page.close();
}

// Helper mount for enquiry / availability tests
async function mountTour(page, { withId } = {}) {
  const cfg = JSON.stringify({
    tour: { title: 'Enquiry Tour', location: 'Testville', currency: 'gbp', pricePerPersonPence: 200000, capacity: 12 },
    days: [{ label: 'Day 1', title: 'Arrive', body: 'A day.' }],
  }).replace(/'/g, '&#39;');
  const idAttr = withId ? ' data-tg-id="tgw_tour_1"' : '';
  await page.setContent(
    `<!doctype html><html><body><div id="t" data-tg-widget="tour"${idAttr} data-tg-config='${cfg}'></div>` +
    `<script src="${BASE}/widget-tour.js"></script></body></html>`, { waitUntil: 'load' });
  await page.waitForFunction(() => {
    const el = document.getElementById('t');
    return !!(el && el.shadowRoot && el.shadowRoot.querySelector('[data-role="form"]'));
  }, { timeout: 6000 });
  await page.waitForTimeout(150);
}
async function submit(page, vals) {
  await page.evaluate((v) => {
    const sr = document.getElementById('t').shadowRoot;
    const set = (s, val) => { const el = sr.querySelector(s); if (el != null) { el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); } };
    set('#tgto-name', v.name || ''); set('#tgto-email', v.email || ''); set('#tgto-message', v.message || '');
    sr.querySelector('[data-role="form"]').requestSubmit(sr.querySelector('[data-role="submit"]'));
  }, vals);
  await page.waitForTimeout(150);
}
const statusOf = (page) => page.evaluate(() => {
  const sr = document.getElementById('t').shadowRoot;
  return { status: sr.querySelector('[data-role="status"]')?.textContent || '', thanks: !!sr.querySelector('[data-role="thanks"]') };
});

// ── 4. Enquiry preview mode ──────────────────────────────────────────────────
{
  const { page } = await newPage();
  let posted = false;
  await page.route('**/api/trip-enquiry', (r) => { posted = true; r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); });
  await mountTour(page, { withId: false });
  await submit(page, { name: 'Ada', email: 'ada@example.com', message: 'hi' });
  const s = await statusOf(page);
  ok(/preview/i.test(s.status), `preview: shows a preview notice (got "${s.status}")`);
  ok(!posted, 'preview: no POST without a saved widget id');
  await page.close();
}

// ── 5. Enquiry real submit ───────────────────────────────────────────────────
{
  const { page, errors } = await newPage();
  let body = null;
  await page.route('**/api/trip-enquiry', (r) => {
    try { body = JSON.parse(r.request().postData() || '{}'); } catch { body = {}; }
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, leadId: 'lead_x' }) });
  });
  await page.route('**/api/trip-availability**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"available":false}' }));
  await mountTour(page, { withId: true });
  await submit(page, { name: 'Grace Hopper', email: 'grace@example.com', message: 'Two rooms please' });
  const s = await statusOf(page);
  ok(!!body && body.widgetId === 'tgw_tour_1', `submit: posts the widget id (got "${body && body.widgetId}")`);
  ok(!!body && body.email === 'grace@example.com' && body.name === 'Grace Hopper', 'submit: posts name + email');
  ok(s.thanks, 'submit: shows the thank-you state');
  ok(errors.length === 0, 'submit: no script errors (' + errors.join(' | ') + ')');
  await page.close();
}

// ── 6. Availability in the price bar ─────────────────────────────────────────
{
  const { page, errors } = await newPage();
  let availResp = { ok: true, available: true, capacity: 12, remaining: 4, soldOut: false };
  await page.route('**/api/trip-availability**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(availResp) }));
  const avail = () => page.evaluate(() => {
    const n = document.getElementById('t')?.shadowRoot?.querySelector('[data-role="avail"]');
    return { text: n?.textContent || '', hidden: n ? !!n.hidden : true };
  });

  await mountTour(page, { withId: true });
  let s = await avail();
  ok(!s.hidden && /Only 4 places left/.test(s.text), `avail: "Only 4 places left" (got "${s.text}")`);

  availResp = { ok: true, available: true, capacity: 12, remaining: 0, soldOut: true };
  await mountTour(page, { withId: true }); s = await avail();
  ok(!s.hidden && /Sold out/.test(s.text), `avail: "Sold out" (got "${s.text}")`);

  availResp = { ok: true, available: false };
  await mountTour(page, { withId: true }); s = await avail();
  ok(s.hidden, 'avail: hidden when unknown');
  ok(errors.length === 0, 'avail: no script errors (' + errors.join(' | ') + ')');
  await page.close();
}

// ── Zero price: the price bar hides and no "£0" shows anywhere ───────────────
{
  const { page, errors } = await newPage();
  const cfg = JSON.stringify({
    tour: { title: 'No Price Tour', location: 'Tanzania', durationText: '11 days', currency: 'gbp', pricePerPersonPence: 0 },
    days: [{ label: 'Day 1', title: 'Arrive', body: 'A day.' }],
    extras: [{ name: 'Optional balloon safari', pricePence: 0, note: 'Price on request.' }],
    enquiry: { heading: 'Enquire' },
  }).replace(/'/g, '&#39;');
  await page.setContent(
    `<!doctype html><html><body><div id="z" data-tg-widget="tour" data-tg-config='${cfg}'></div>` +
    `<script src="${BASE}/widget-tour.js"></script></body></html>`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('z')?.shadowRoot?.querySelector('[data-role="title"]'), { timeout: 8000 }).catch(() => {});
  const z = await page.evaluate(() => {
    const sr = document.getElementById('z').shadowRoot;
    return {
      priceBar: !!sr.querySelector('[data-role="pricebar"]'),
      hasZero: /£0/.test(sr.textContent || ''),
      extraName: !!Array.from(sr.querySelectorAll('.tgto-extra-name')).find(e => /balloon/i.test(e.textContent)),
      extraPrice: !!sr.querySelector('[data-role="extras"] .tgto-extra-price'),
      hasForm: !!sr.querySelector('[data-role="enquiry"]'),
    };
  });
  ok(!z.priceBar, 'zero price: the price bar is hidden when no price is set');
  ok(!z.hasZero, 'zero price: no "£0" is shown anywhere');
  ok(z.extraName && !z.extraPrice, 'zero price: a zero-priced extra shows its name and note but no "£0 pp"');
  ok(z.hasForm, 'zero price: the enquiry form still renders');
  ok(errors.length === 0, 'zero price: no script errors (' + errors.join(' | ') + ')');
  await page.close();
}

await browser.close();
server.close();

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
