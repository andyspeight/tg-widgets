/**
 * Group Trips (GT-1) smoke — headless Playwright.
 * Run: node test/trips-widget-smoke.mjs        (npm run test:trips)
 *
 * Covers the GT-1 acceptance criteria plus the house negative controls:
 *   1. demo-trips.html renders the trip hero, description and pricing strip
 *      from the INLINE config (the embed contract, no API involved).
 *   2. The departed-trip example renders the honest closed state, no price.
 *   3. XSS control — a hostile config title renders as inert text.
 *   4. NEGATIVE CONTROL — an unconfigured widget renders nothing. If the
 *      title selector matched here, assertion 1 would be meaningless; this
 *      proves the test bites.
 *   5. editor-trips.html boots on the shell (auth stubbed to signed-out),
 *      shows the login overlay and still renders the live preview.
 *   6. Registry/plumbing consistency — the five-places rule: index.html
 *      registry + script tag, widget-config.js type + limits, vercel.json
 *      rewrites + CORS headers, editor widgetType. Catches silent drift.
 *
 * Needs playwright (declared in test/package.json): cd test && npm install
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, '..', 'public');
const ROOT = path.join(__dirname, '..');

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

const PORT = 8123;
const BASE = `http://localhost:${PORT}`;
const server = await serve(PUBLIC, PORT);

// Same launch convention as run-smoke.mjs: TGS_CHROMIUM overrides when the
// Playwright browser CDN is blocked; otherwise Playwright finds its own.
const executablePath = process.env.TGS_CHROMIUM || undefined;
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

// Network noise (blocked fonts, missing images) is not a widget bug — only
// real script errors should fail the run.
const isNoise = (t) => /Failed to load resource|net::|ERR_|fonts\.googleapis|fonts\.gstatic|images\.unsplash|favicon/i.test(t);

async function newPage() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e));
  page.on('console', (m) => { if (m.type() === 'error' && !isNoise(m.text())) errors.push('console: ' + m.text()); });
  // Third-party requests (fonts, unsplash, travelify SSO) are stubbed so the
  // suite runs hermetically offline.
  await page.route('https://id.travelify.io/**', (r) => r.fulfill({ status: 401, contentType: 'application/json', body: '{"ok":false}' }));
  await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://fonts.gstatic.com/**', (r) => r.abort());
  await page.route('https://images.unsplash.com/**', (r) => r.abort());
  return { page, errors };
}

// ── 1 + 2. Demo page renders from inline config ──────────────────────────────
{
  const { page, errors } = await newPage();
  await page.goto(`${BASE}/demo-trips.html`, { waitUntil: 'load', timeout: 20000 });
  await page.waitForFunction(() => {
    const el = document.getElementById('demo-main');
    return !!(el && el.shadowRoot && el.shadowRoot.querySelector('[data-role="title"]'));
  }, { timeout: 8000 }).catch(() => {});

  const main = await page.evaluate(() => {
    const sr = document.getElementById('demo-main')?.shadowRoot;
    if (!sr) return null;
    const txt = (sel) => sr.querySelector(sel)?.textContent || '';
    return {
      title: txt('[data-role="title"]'),
      desc: txt('[data-role="description"]'),
      dates: txt('[data-role="dates"]'),
      location: txt('[data-role="location"]'),
      capacity: txt('[data-role="capacity"]'),
      price: txt('[data-role="price"]'),
      deposit: txt('[data-role="deposit"]'),
      heroSrc: sr.querySelector('.tgtr-hero img')?.getAttribute('src') || '',
      departed: !!sr.querySelector('[data-role="departed"]'),
    };
  });

  ok(!!main, 'demo: main widget mounted a shadow root');
  if (main) {
    ok(main.title === 'Santorini Yoga Retreat 2027', `demo: title from inline config (got "${main.title}")`);
    ok(/caldera sunsets/.test(main.desc), 'demo: description rendered');
    ok(main.dates.includes('10–17 May 2027'), `demo: date range formatted (got "${main.dates}")`);
    ok(main.location.includes('Santorini, Greece'), 'demo: location rendered');
    ok(main.capacity.includes('Group of 16'), 'demo: capacity rendered');
    ok(main.price === '£1,899', `demo: price from pricePence (got "${main.price}")`);
    ok(/£300 deposit/.test(main.deposit) && /£1,599/.test(main.deposit) && /10 Mar 2027/.test(main.deposit),
      `demo: deposit line shows deposit, balance and due date (got "${main.deposit}")`);
    ok(main.heroSrc.startsWith('https://images.unsplash.com/'), 'demo: hero image src from config');
    ok(!main.departed, 'demo: a future trip does not show the departed state');
  }

  // Departed example: honest closed state, no price strip.
  const past = await page.evaluate(() => {
    const els = document.querySelectorAll('[data-tg-widget="trips"]');
    const sr = els[1]?.shadowRoot;
    if (!sr) return null;
    return {
      title: sr.querySelector('[data-role="title"]')?.textContent || '',
      departed: !!sr.querySelector('[data-role="departed"]'),
      hasPrice: !!sr.querySelector('[data-role="price"]'),
    };
  });
  ok(!!past, 'demo: departed example mounted');
  if (past) {
    ok(past.title === 'Algarve Golf Week 2025', 'demo: departed example renders its title');
    ok(past.departed, 'demo: past end date renders the departed state');
    ok(!past.hasPrice, 'demo: departed trip shows no price strip');
  }

  ok(errors.length === 0, 'demo: no script errors (' + errors.join(' | ') + ')');
  await page.close();
}

// ── 3. XSS control — hostile title stays inert text ──────────────────────────
{
  const { page, errors } = await newPage();
  const cfg = JSON.stringify({
    trip: { title: '<img src=x onerror=window.__xss=1>', description: 'safe?', startDate: '2027-05-10', location: 'X' },
  }).replace(/'/g, '&#39;');
  await page.setContent(
    `<!doctype html><html><body><div id="t" data-tg-widget="trips" data-tg-config='${cfg}'></div>` +
    `<script src="${BASE}/widget-trips.js"></script></body></html>`,
    { waitUntil: 'load' }
  );
  await page.waitForTimeout(200);
  const xss = await page.evaluate(() => {
    const sr = document.getElementById('t')?.shadowRoot;
    return {
      fired: typeof window.__xss !== 'undefined',
      titleText: sr?.querySelector('[data-role="title"]')?.textContent || '',
      imgInTitle: !!sr?.querySelector('[data-role="title"] img'),
      anyRogueImg: !!sr?.querySelector('img[src="x"]'),
    };
  });
  ok(!xss.fired, 'xss: onerror payload never executed');
  ok(xss.titleText.includes('<img src=x'), 'xss: hostile title renders as literal text');
  ok(!xss.imgInTitle && !xss.anyRogueImg, 'xss: no element was created from config text');
  ok(errors.length === 0, 'xss: no script errors (' + errors.join(' | ') + ')');
  await page.close();
}

// ── 4. NEGATIVE CONTROL — unconfigured widget renders nothing ────────────────
// This proves assertions 1–2 bite: the same selectors must find NOTHING when
// the config carries no trip. If this block ever starts passing a title, the
// positive assertions above have gone soft.
{
  const { page } = await newPage();
  await page.setContent(
    `<!doctype html><html><body><div id="empty" data-tg-widget="trips" data-tg-config='{}'></div>` +
    `<script src="${BASE}/widget-trips.js"></script></body></html>`,
    { waitUntil: 'load' }
  );
  await page.waitForTimeout(200);
  const neg = await page.evaluate(() => {
    const el = document.getElementById('empty');
    return {
      hiddenAttr: el?.getAttribute('data-tg-hidden') || '',
      title: el?.shadowRoot?.querySelector('[data-role="title"]')?.textContent ?? null,
      shadowEmpty: (el?.shadowRoot?.innerHTML || '').trim() === '',
    };
  });
  ok(neg.hiddenAttr === 'unconfigured', 'negative: host marked data-tg-hidden=unconfigured');
  ok(neg.title === null, 'negative: no title node exists without config (selector bites)');
  ok(neg.shadowEmpty, 'negative: shadow root stays empty');
  await page.close();
}

// ── 5a. Editor, signed out: the shell's auth gate redirects to sign-in ───────
{
  const { page } = await newPage();
  await page.goto(`${BASE}/editor-trips.html`, { waitUntil: 'load', timeout: 20000 });
  await page.waitForURL('**/signin.html**', { timeout: 8000 }).catch(() => {});
  const url = page.url();
  ok(/\/signin\.html\?next=%2Feditor-trips/.test(url),
    `editor: signed-out boot redirects to sign-in with a return path (got "${url}")`);
  await page.close();
}

// ── 5b. Editor, seeded legacy session: full boot, preview and field sync ─────
{
  const { page, errors } = await newPage();
  // A legacy localStorage token counts as signed in (shell isLoggedIn()), so
  // the editor boots for real: shell chrome, live preview, sidebar sync.
  await page.addInitScript(() => {
    localStorage.setItem('tg_token', 'smoke-test-token');
    localStorage.setItem('tg_user', JSON.stringify({ email: 'smoke@test.local', plan: 'Bespoke' }));
  });
  await page.goto(`${BASE}/editor-trips.html`, { waitUntil: 'load', timeout: 20000 });
  // The card preview mounts in #mount-card (the editor now also has a full-page
  // preview in #mount-page behind a Card/Page switch).
  await page.waitForFunction(() => {
    const m = document.getElementById('mount-card');
    return !!(m && m.shadowRoot && m.shadowRoot.querySelector('[data-role="title"]'));
  }, { timeout: 8000 }).catch(() => {});

  const ed = await page.evaluate(() => ({
    url: location.pathname,
    sidebar: !!document.querySelector('.tgse-sidebar'),
    saveBtn: !!document.getElementById('btn-save'),
    previewTitle: document.getElementById('mount-card')?.shadowRoot?.querySelector('[data-role="title"]')?.textContent || '',
    previewPrice: document.getElementById('mount-card')?.shadowRoot?.querySelector('[data-role="price"]')?.textContent || '',
    titleField: document.getElementById('trip-title')?.value || '',
    priceField: document.getElementById('trip-price')?.value || '',
    hasPageTab: !!document.querySelector('.tgse-tabs button[data-tab="page"]'),
    hasPvSwitch: document.querySelectorAll('.pv-switch button').length === 2,
  }));
  ok(ed.url === '/editor-trips.html', 'editor: signed-in boot stays on the editor');
  ok(ed.sidebar && ed.saveBtn, 'editor: shell chrome rendered');
  ok(ed.previewTitle === 'Santorini Yoga Retreat 2027', `editor: card preview renders the starter trip (got "${ed.previewTitle}")`);
  ok(ed.previewPrice === '£1,899', `editor: preview price from pence storage (got "${ed.previewPrice}")`);
  ok(ed.titleField === 'Santorini Yoga Retreat 2027', 'editor: sidebar fields synced from config');
  ok(ed.priceField === '1899', `editor: price input shows major units (got "${ed.priceField}")`);
  ok(ed.hasPageTab, 'editor: Tour page tab present');
  ok(ed.hasPvSwitch, 'editor: card/page preview switch present');

  // Switching to the full-page preview mounts the page widget with its enquiry form.
  await page.click('.pv-switch button[data-pv="page"]');
  await page.waitForFunction(() => {
    const m = document.getElementById('mount-page');
    return !!(m && !m.hidden && m.shadowRoot && m.shadowRoot.querySelector('[data-role="form"]'));
  }, { timeout: 6000 }).catch(() => {});
  const pagePrev = await page.evaluate(() => {
    const sr = document.getElementById('mount-page')?.shadowRoot;
    return {
      title: sr?.querySelector('[data-role="title"]')?.textContent || '',
      hasForm: !!sr?.querySelector('[data-role="form"]'),
      cardHidden: !!document.getElementById('mount-card')?.hidden,
    };
  });
  ok(pagePrev.title === 'Santorini Yoga Retreat 2027', `editor: page preview renders the trip (got "${pagePrev.title}")`);
  ok(pagePrev.hasForm, 'editor: page preview includes the enquiry form');
  ok(pagePrev.cardHidden, 'editor: switching to page hides the card preview');
  ok(errors.length === 0, 'editor: no script errors (' + errors.join(' | ') + ')');
  await page.close();
}

await browser.close();
server.close();

// ── 6. Plumbing consistency — the five-places rule ───────────────────────────
{
  const indexHtml = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
  const widgetConfig = fs.readFileSync(path.join(ROOT, 'api', 'widget-config.js'), 'utf8');
  const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const editorHtml = fs.readFileSync(path.join(PUBLIC, 'editor-trips.html'), 'utf8');

  ok(/airtableType:\s*'Group Trips'/.test(indexHtml), 'plumbing: registry entry declares airtableType Group Trips');
  ok(/id:\s*'trips'/.test(indexHtml), 'plumbing: registry entry id trips');
  ok(indexHtml.includes('<script src="/widget-trips.js"></script>'), 'plumbing: dashboard loads widget-trips.js');
  const accessMatch = indexHtml.match(/id:\s*'trips'[\s\S]{0,900}?access:\s*\{\s*Spark:\s*0,\s*Boost:\s*1,\s*Ignite:\s*-1,\s*Bespoke:\s*-1\s*\}/);
  ok(!!accessMatch, 'plumbing: registry access is Spark 0 / Boost 1 / Ignite ∞ / Bespoke ∞');

  ok(/'Group Trips',/.test(widgetConfig), 'plumbing: Group Trips in ALLOWED_WIDGET_TYPES');
  ok(/'Group Trips':\s*\{\s*Spark:\s*0,\s*Boost:\s*1,\s*Ignite:\s*-1,\s*Bespoke:\s*-1\s*\}/.test(widgetConfig),
    'plumbing: PLAN_WIDGET_LIMITS matches the registry access field');

  const rw = vercel.rewrites || [];
  ok(rw.some(r => r.source === '/demo-trips' && r.destination === '/demo-trips.html'), 'plumbing: /demo-trips rewrite');
  ok(rw.some(r => r.source === '/editor-trips' && r.destination === '/editor-trips.html'), 'plumbing: /editor-trips rewrite');
  const hdr = (vercel.headers || []).find(h => h.source === '/widget-trips.js');
  ok(!!hdr && hdr.headers.some(h => h.key === 'Access-Control-Allow-Origin' && h.value === '*'), 'plumbing: widget-trips.js CORS headers');

  ok(/widgetType:\s*'Group Trips'/.test(editorHtml), 'plumbing: editor inits with widgetType Group Trips');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
