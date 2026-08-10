/**
 * Escorted Tour card (widget-tour-card.js) smoke — headless Playwright.
 * Run: node test/tour-card-smoke.mjs        (npm run test:tour-card)
 *
 *   1. Renders from inline config: title, summary, date/duration, location,
 *      "from <price> pp".
 *   2. Links to the full page when tour.pageUrl is set (card is an <a>, shows
 *      the "View tour" cue); a plain <section> with no cue when it is not.
 *   3. Two cards flow side by side on a wide page (same top, different left),
 *      and STACK on a narrow one — the narrow case proves the row check bites.
 *   4. XSS control — a hostile title renders as inert text.
 *   5. Departed tour shows the honest closed state, no price.
 *   6. NEGATIVE CONTROL — an unconfigured card renders nothing.
 *   7. Live availability (places left / sold out / hidden) via the stubbed
 *      /api/trip-availability endpoint (same one the trips card uses).
 *   8. Plumbing — vercel.json CORS header, config round-trips pageUrl, editor
 *      exposes the link field.
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
      if (p.startsWith('/api/')) { rsp.statusCode = 404; rsp.setHeader('Content-Type', 'application/json'); rsp.setHeader('Access-Control-Allow-Origin', '*'); return rsp.end('{"error":"not here"}'); }
      const fp = path.join(dir, p === '/' ? 'index.html' : p);
      if (!fp.startsWith(dir) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) { rsp.statusCode = 404; return rsp.end('nf'); }
      rsp.setHeader('Content-Type', MIME[path.extname(fp)] || 'application/octet-stream');
      fs.createReadStream(fp).pipe(rsp);
    });
    s.listen(port, () => res(s));
  });
}

const PORT = 8128;
const BASE = `http://localhost:${PORT}`;
const server = await serve(PUBLIC, PORT);
const executablePath = process.env.TGS_CHROMIUM || undefined;
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

const isNoise = (t) => /Failed to load resource|net::|ERR_|fonts\.googleapis|fonts\.gstatic|images\.unsplash|favicon/i.test(t);
async function newPage() {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e));
  page.on('console', (m) => { if (m.type() === 'error' && !isNoise(m.text())) errors.push('console: ' + m.text()); });
  await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://fonts.gstatic.com/**', (r) => r.abort());
  await page.route('https://images.unsplash.com/**', (r) => r.abort());
  return { page, errors };
}

const cfgAttr = (o) => JSON.stringify(o).replace(/'/g, '&#39;');

// ── 1 + 2. Render + link ─────────────────────────────────────────────────────
{
  const { page, errors } = await newPage();
  const linked = cfgAttr({ tour: {
    title: 'Kenya Johari Safari', subtitle: 'Eleven days from the Masai Mara to the Indian Ocean.',
    location: 'Kenya', startDate: '2026-10-24', endDate: '2026-11-03', durationText: '11 days / 10 nights',
    currency: 'gbp', pricePerPersonPence: 349500, capacity: 7, pageUrl: 'https://aurora.example/tours/kenya',
  } });
  const plain = cfgAttr({ tour: {
    title: 'Duration Only Tour', subtitle: 'No fixed dates, sold by duration.',
    location: 'Peru', durationText: '9 days / 8 nights', currency: 'gbp', pricePerPersonPence: 275000,
  } });
  await page.setContent(
    `<!doctype html><html><body>` +
    `<div id="l" data-tg-widget="tour-card" data-tg-config='${linked}'></div>` +
    `<div id="p" data-tg-widget="tour-card" data-tg-config='${plain}'></div>` +
    `<script src="${BASE}/widget-tour-card.js"></script></body></html>`,
    { waitUntil: 'load' }
  );
  await page.waitForFunction(() => {
    const el = document.getElementById('l');
    return !!(el && el.shadowRoot && el.shadowRoot.querySelector('[data-role="title"]'));
  }, { timeout: 8000 }).catch(() => {});

  const m = await page.evaluate(() => {
    const sr = document.getElementById('l').shadowRoot;
    const txt = (s) => sr.querySelector(s)?.textContent || '';
    const card = sr.querySelector('.tgtc-card');
    return {
      title: txt('[data-role="title"]'),
      summary: txt('[data-role="summary"]'),
      dates: txt('[data-role="dates"]'),
      location: txt('[data-role="location"]'),
      price: txt('[data-role="price"]'),
      foot: txt('.tgtc-foot'),
      tag: card?.tagName.toLowerCase() || '',
      href: card?.getAttribute('href') || '',
      hasCta: !!sr.querySelector('.tgtc-cta'),
    };
  });
  ok(m.title === 'Kenya Johari Safari', `card: title (got "${m.title}")`);
  ok(/Masai Mara/.test(m.summary), 'card: summary rendered');
  ok(m.dates.includes('24 Oct – 3 Nov 2026'), `card: date range formatted (got "${m.dates}")`);
  ok(m.location.includes('Kenya'), 'card: location rendered');
  ok(m.price === '£3,495', `card: price from pricePerPersonPence (got "${m.price}")`);
  ok(/from/.test(m.foot) && /pp/.test(m.foot), 'card: "from … pp" framing present');
  ok(m.tag === 'a' && m.href === 'https://aurora.example/tours/kenya', `card: links to the full page (tag=${m.tag}, href="${m.href}")`);
  ok(m.hasCta, 'card: shows the "View tour" cue when linked');

  const plainCard = await page.evaluate(() => {
    const sr = document.getElementById('p').shadowRoot;
    return {
      tag: sr.querySelector('.tgtc-card')?.tagName.toLowerCase() || '',
      hasCta: !!sr.querySelector('.tgtc-cta'),
      duration: sr.querySelector('[data-role="duration"]')?.textContent || '',
      dates: !!sr.querySelector('[data-role="dates"]'),
    };
  });
  ok(plainCard.tag === 'button', 'card: with no pageUrl the card is a button (opens the overlay)');
  ok(plainCard.hasCta, 'card: shows the "View tour" cue');
  ok(plainCard.duration.includes('9 days / 8 nights') && !plainCard.dates, 'card: falls back to duration text when there are no dates');
  ok(errors.length === 0, 'card: no script errors (' + errors.join(' | ') + ')');
  await page.close();
}

// ── 3. Two-up flows on a wide page, stacks on a narrow one ───────────────────
{
  const { page, errors } = await newPage();
  const c = (t) => cfgAttr({ tour: { title: t, durationText: '7 days', location: 'X', currency: 'gbp', pricePerPersonPence: 200000 } });
  const html = (w) =>
    `<!doctype html><html><body style="margin:0">` +
    `<div style="width:${w}px">` +
      `<div id="a" data-tg-widget="tour-card" data-tg-config='${c('Tour A')}'></div>` +
      `<div id="b" data-tg-widget="tour-card" data-tg-config='${c('Tour B')}'></div>` +
    `</div><script src="${BASE}/widget-tour-card.js"></script></body></html>`;
  const box = () => page.evaluate(() => {
    const r = (id) => { const e = document.getElementById(id).getBoundingClientRect(); return { top: Math.round(e.top), left: Math.round(e.left), w: Math.round(e.width) }; };
    return { a: r('a'), b: r('b') };
  });

  await page.setContent(html(1000), { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('b')?.shadowRoot?.querySelector('[data-role="title"]'), { timeout: 8000 }).catch(() => {});
  let g = await box();
  ok(g.a.top === g.b.top && g.b.left > g.a.left, `card two-up: side by side on a wide page (a.top=${g.a.top} b.top=${g.b.top}, a.left=${g.a.left} b.left=${g.b.left})`);
  ok(g.a.w <= 460, `card two-up: each card is compact (~420px, got ${g.a.w})`);

  await page.setContent(html(380), { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('b')?.shadowRoot?.querySelector('[data-role="title"]'), { timeout: 8000 }).catch(() => {});
  g = await box();
  ok(g.b.top > g.a.top, `card two-up: stacks on a narrow page (a.top=${g.a.top} b.top=${g.b.top}) — proves the row check bites`);
  ok(errors.length === 0, 'card two-up: no script errors (' + errors.join(' | ') + ')');
  await page.close();
}

// ── 4. XSS control ───────────────────────────────────────────────────────────
{
  const { page, errors } = await newPage();
  const cfg = cfgAttr({ tour: { title: '<img src=x onerror=window.__xss=1>', subtitle: 'safe?', durationText: '5 days', pageUrl: 'javascript:alert(1)' } });
  await page.setContent(
    `<!doctype html><html><body><div id="t" data-tg-widget="tour-card" data-tg-config='${cfg}'></div>` +
    `<script src="${BASE}/widget-tour-card.js"></script></body></html>`, { waitUntil: 'load' });
  await page.waitForTimeout(200);
  const xss = await page.evaluate(() => {
    const sr = document.getElementById('t')?.shadowRoot;
    return {
      fired: typeof window.__xss !== 'undefined',
      titleText: sr?.querySelector('[data-role="title"]')?.textContent || '',
      imgInTitle: !!sr?.querySelector('[data-role="title"] img'),
      tag: sr?.querySelector('.tgtc-card')?.tagName.toLowerCase() || '',
      href: sr?.querySelector('.tgtc-card')?.getAttribute('href') || '',
    };
  });
  ok(!xss.fired, 'xss: onerror payload never executed');
  ok(xss.titleText.includes('<img src=x'), 'xss: hostile title renders as literal text');
  ok(!xss.imgInTitle, 'xss: no element created from config text');
  ok(xss.tag === 'button' && !xss.href, 'xss: javascript: URL is rejected, card is a button not a link');
  ok(errors.length === 0, 'xss: no script errors (' + errors.join(' | ') + ')');
  await page.close();
}

// ── 4b. Click-to-open overlay: card alone opens the full tour ────────────────
// Only the CARD script is on the page. Clicking loads widget-tour.js on demand
// and mounts the full tour (from the whole config) in a dialog over the page.
{
  const { page, errors } = await newPage();
  const full = cfgAttr({
    tour: { title: 'Kenya Safari', subtitle: 'Eleven days.', location: 'Kenya', durationText: '11 days', currency: 'gbp', pricePerPersonPence: 349500 },
    days: [
      { label: 'Day 1', title: 'Arrival', body: 'Land in Nairobi.' },
      { label: 'Day 2', title: 'Safari', body: 'Game drives.' },
    ],
    highlights: ['Big cats', 'Great Rift Valley'],
    enquiry: { heading: 'Enquire' },
    design: { brandColor: '#1B2B5B', accentColor: '#C2410C' },
  });
  await page.setContent(
    `<!doctype html><html><body style="margin:0"><div id="c" data-tg-widget="tour-card" data-tg-config='${full}'></div>` +
    `<script src="${BASE}/widget-tour-card.js"></script></body></html>`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('c')?.shadowRoot?.querySelector('.tgtc-card'), { timeout: 8000 });

  // Nothing open yet, and the full-tour script is NOT loaded until we click.
  const before = await page.evaluate(() => ({
    tourScript: !!window.TGTourWidget,
    overlay: !!document.querySelector('[data-tg-tour-overlay]'),
  }));
  ok(!before.tourScript, 'overlay: full-tour script not loaded until the card is clicked');
  ok(!before.overlay, 'overlay: no overlay before click');

  // Click the card face.
  await page.evaluate(() => document.getElementById('c').shadowRoot.querySelector('.tgtc-card').click());
  await page.waitForFunction(() => {
    const h = document.querySelector('[data-tg-tour-overlay]');
    const m = h?.shadowRoot?.querySelector('.ov-mount');
    return !!(m && m.shadowRoot && m.shadowRoot.querySelector('[data-role="title"]'));
  }, { timeout: 8000 }).catch(() => {});

  const opened = await page.evaluate(() => {
    const h = document.querySelector('[data-tg-tour-overlay]');
    const ov = h?.shadowRoot?.querySelector('.ov');
    const tourSr = h?.shadowRoot?.querySelector('.ov-mount')?.shadowRoot;
    return {
      loaded: !!window.TGTourWidget,
      visible: ov ? !ov.hidden : false,
      title: tourSr?.querySelector('[data-role="title"]')?.textContent || '',
      days: tourSr ? tourSr.querySelectorAll('[data-role="day"]').length : 0,
      scrollLocked: document.body.style.overflow === 'hidden',
    };
  });
  ok(opened.loaded, 'overlay: clicking loaded the full-tour script on demand');
  ok(opened.visible, 'overlay: dialog is shown after click');
  ok(opened.title === 'Kenya Safari', `overlay: full tour rendered inside (title "${opened.title}")`);
  ok(opened.days === 2, `overlay: full itinerary rendered from the whole config (got ${opened.days} days)`);
  ok(opened.scrollLocked, 'overlay: background scroll is locked while open');

  // Escape closes it and restores scroll.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  const closed = await page.evaluate(() => {
    const ov = document.querySelector('[data-tg-tour-overlay]')?.shadowRoot?.querySelector('.ov');
    return { hidden: ov ? !!ov.hidden : true, scrollFree: document.body.style.overflow !== 'hidden' };
  });
  ok(closed.hidden, 'overlay: Escape closes the dialog');
  ok(closed.scrollFree, 'overlay: background scroll restored on close');
  ok(errors.length === 0, 'overlay: no script errors (' + errors.join(' | ') + ')');
  await page.close();
}

// ── 5. Departed tour ─────────────────────────────────────────────────────────
{
  const { page } = await newPage();
  const cfg = cfgAttr({ tour: { title: 'Past Tour', startDate: '2024-05-01', endDate: '2024-05-10', location: 'X', currency: 'gbp', pricePerPersonPence: 200000 } });
  await page.setContent(
    `<!doctype html><html><body><div id="d" data-tg-widget="tour-card" data-tg-config='${cfg}'></div>` +
    `<script src="${BASE}/widget-tour-card.js"></script></body></html>`, { waitUntil: 'load' });
  await page.waitForTimeout(200);
  const d = await page.evaluate(() => {
    const sr = document.getElementById('d')?.shadowRoot;
    return { departed: !!sr?.querySelector('[data-role="departed"]'), hasPrice: !!sr?.querySelector('[data-role="price"]') };
  });
  ok(d.departed, 'departed: past end date shows the closed state');
  ok(!d.hasPrice, 'departed: no price shown');
  await page.close();
}

// ── 6. NEGATIVE CONTROL — unconfigured renders nothing ───────────────────────
{
  const { page } = await newPage();
  await page.setContent(
    `<!doctype html><html><body><div id="e" data-tg-widget="tour-card" data-tg-config='{}'></div>` +
    `<script src="${BASE}/widget-tour-card.js"></script></body></html>`, { waitUntil: 'load' });
  await page.waitForTimeout(200);
  const neg = await page.evaluate(() => {
    const el = document.getElementById('e');
    return {
      hidden: el?.getAttribute('data-tg-hidden') || '',
      title: el?.shadowRoot?.querySelector('[data-role="title"]')?.textContent ?? null,
      empty: (el?.shadowRoot?.innerHTML || '').trim() === '',
    };
  });
  ok(neg.hidden === 'unconfigured', 'negative: host marked data-tg-hidden=unconfigured');
  ok(neg.title === null, 'negative: no title node without config (selector bites)');
  ok(neg.empty, 'negative: shadow root stays empty');
  await page.close();
}

// ── 7. Live availability ─────────────────────────────────────────────────────
{
  const { page, errors } = await newPage();
  let availResp = { ok: true, available: true, capacity: 12, remaining: 2, soldOut: false };
  await page.route('**/api/trip-availability**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(availResp) }));
  const cfg = cfgAttr({ tour: { title: 'Avail Tour', durationText: '7 days', location: 'X', currency: 'gbp', pricePerPersonPence: 200000, capacity: 12 } });
  const mount = async () => {
    await page.setContent(
      `<!doctype html><html><body><div id="c" data-tg-widget="tour-card" data-tg-id="tgw_t1" data-tg-config='${cfg}'></div>` +
      `<script src="${BASE}/widget-tour-card.js"></script></body></html>`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.getElementById('c')?.shadowRoot?.querySelector('[data-role="title"]'), { timeout: 6000 });
    await page.waitForTimeout(200);
  };
  const avail = () => page.evaluate(() => {
    const n = document.getElementById('c')?.shadowRoot?.querySelector('[data-role="avail"]');
    return { text: n?.textContent || '', hidden: n ? !!n.hidden : true };
  });

  await mount(); let s = await avail();
  ok(!s.hidden && /Only 2 places left/.test(s.text), `card avail: "Only 2 places left" (got "${s.text}")`);
  availResp = { ok: true, available: true, capacity: 12, remaining: 0, soldOut: true };
  await mount(); s = await avail();
  ok(!s.hidden && /Sold out/.test(s.text), `card avail: "Sold out" (got "${s.text}")`);
  availResp = { ok: true, available: false };
  await mount(); s = await avail();
  ok(s.hidden, 'card avail: hidden when availability is unknown');
  ok(errors.length === 0, 'card avail: no script errors (' + errors.join(' | ') + ')');
  await page.close();
}

await browser.close();
server.close();

// ── 8. Plumbing ──────────────────────────────────────────────────────────────
{
  const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const widgetTour = fs.readFileSync(path.join(PUBLIC, 'widget-tour.js'), 'utf8');
  const editorTour = fs.readFileSync(path.join(PUBLIC, 'editor-tour.html'), 'utf8');
  const cardFile = fs.existsSync(path.join(PUBLIC, 'widget-tour-card.js'));

  ok(cardFile, 'plumbing: widget-tour-card.js exists');
  const hdr = (vercel.headers || []).find(h => h.source === '/widget-tour-card.js');
  ok(!!hdr && hdr.headers.some(h => h.key === 'Access-Control-Allow-Origin' && h.value === '*'), 'plumbing: widget-tour-card.js CORS header');
  ok(/pageUrl:\s*safeUrl\(tour\.pageUrl\)/.test(widgetTour), 'plumbing: widget-tour.js round-trips tour.pageUrl through save');
  ok(/pageUrl/.test(editorTour), 'plumbing: editor exposes the full-page link field');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
