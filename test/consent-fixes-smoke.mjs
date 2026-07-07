/**
 * Regression test for the four pieces of client feedback on the Cookie Consent
 * widget (7 July 2026):
 *   1. Editor inputs lost focus on every keystroke (preview reloaded + banner
 *      autofocus stole focus). Fix: debounced preview + focusOnOpen:false.
 *   2. Massive gap in the bar layout at <=560px (bar .copy flex-basis 320px
 *      became a 320px tall box in the column layout).
 *   3. Badge alignment: new badgeAlign (left/center/right) + badgeOffset.
 *   4. Font not saved/applied: standardised on fontFamily; picker synced on load.
 *
 * Run: node test/consent-fixes-smoke.mjs
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; console.log('  ok  ', label); } else { failed++; console.error('  FAIL', label); } };

// Saved config the editor GET stub returns — proves load-time sync.
const SAVED = {
  config: {
    layout: 'card', position: 'bottom-left', theme: 'light', accent: '#1B2B5B',
    fontFamily: 'Poppins', badgeAlign: 'center', badgeOffset: 40, badge: true,
    cookies: [{ name: '_ga', provider: 'Google', purpose: 'stats', duration: '2y', category: 'analytics' }],
  },
  name: 'Saved consent',
};

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const send = (code, body, type) => {
    res.writeHead(code, { 'Content-Type': type || 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(body);
  };
  if (req.method === 'OPTIONS') return send(204, '');
  if (url.pathname === '/api/widget-config') return send(200, JSON.stringify(SAVED));
  if (url.pathname === '/api/consent-geo') return send(200, JSON.stringify({ country: 'GB', mode: 'gdpr' }));
  if (url.pathname.startsWith('/api/')) return send(200, '{}');
  if (url.pathname === '/fixture') {
    const cfg = url.searchParams.get('cfg') || '{}';
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<script src="/widget-consent.js" data-tg-config='${cfg.replace(/'/g, '&#39;')}'></script>
</head><body><h1>site</h1></body></html>`;
    return send(200, html, 'text/html; charset=utf-8');
  }
  let p = url.pathname.replace(/^\/+/, '') || 'index.html';
  let file = join(PUBLIC_DIR, p);
  if (!existsSync(file) && existsSync(file + '.html')) file = file + '.html';
  if (file.startsWith(PUBLIC_DIR) && existsSync(file)) {
    const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html';
    return send(200, readFileSync(file), type + '; charset=utf-8');
  }
  send(404, 'nf', 'text/plain');
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const PW = '/opt/pw-browsers/chromium';
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'], ...(existsSync(PW) ? { executablePath: PW } : {}) });

const fixtureUrl = (cfg) => BASE + '/fixture?cfg=' + encodeURIComponent(JSON.stringify(cfg));

// ── 3 + 4 (widget side): badge alignment/offset and font family ──
{
  console.log('\nWidget: badge alignment, offset and font');
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // Font: Poppins should reach the shadow .wrap font-family stack.
  await page.goto(fixtureUrl({ geo: 'gdpr', fontFamily: 'Poppins', log: false }));
  await page.waitForFunction(() => !!document.querySelector('[data-tg-widget="consent"]')?.shadowRoot.querySelector('.wrap'));
  const fam = await page.evaluate(() => {
    const w = document.querySelector('[data-tg-widget="consent"]').shadowRoot.querySelector('.wrap');
    return getComputedStyle(w).fontFamily;
  });
  ok(/Poppins/i.test(fam), 'fontFamily reaches the banner stack (got: ' + fam + ')');

  // Badge alignment + offset after a choice.
  await page.goto(fixtureUrl({ geo: 'gdpr', badgeAlign: 'center', badgeOffset: 40, log: false }));
  await page.waitForFunction(() => !!document.querySelector('[data-tg-widget="consent"]')?.shadowRoot.querySelector('.b-accept'));
  await page.evaluate(() => document.querySelector('[data-tg-widget="consent"]').shadowRoot.querySelector('[data-act="accept"]').click());
  await page.waitForFunction(() => !!document.querySelector('[data-tg-widget="consent"]')?.shadowRoot.querySelector('.badge'));
  const badge = await page.evaluate(() => {
    const b = document.querySelector('[data-tg-widget="consent"]').shadowRoot.querySelector('.badge');
    return { cls: b.className, bottom: b.style.bottom, left: getComputedStyle(b).left };
  });
  ok(/b-center/.test(badge.cls), 'badge centre alignment class applied');
  ok(badge.bottom === '40px', 'badge offset applied (bottom 40px, got: ' + badge.bottom + ')');
  await ctx.close();
}

// ── 2 (widget side): no massive gap in the bar layout at 560px ──
{
  console.log('\nWidget: bar layout has no giant gap at 560px');
  const ctx = await browser.newContext({ viewport: { width: 560, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(fixtureUrl({ geo: 'gdpr', layout: 'bar', log: false }));
  await page.waitForFunction(() => !!document.querySelector('[data-tg-widget="consent"]')?.shadowRoot.querySelector('.bar .copy'));
  const copyH = await page.evaluate(() => {
    const c = document.querySelector('[data-tg-widget="consent"]').shadowRoot.querySelector('.bar .copy');
    return c.getBoundingClientRect().height;
  });
  // Before the fix the copy box was forced to ~320px tall. Content is ~110px.
  ok(copyH < 180, 'bar .copy is content-height, not the 320px flex-basis box (got: ' + Math.round(copyH) + 'px)');
  await ctx.close();
}

// ── 1 + 4 (editor side): focus retention and font picker sync on load ──
{
  console.log('\nEditor: focus retention while typing, font picker synced on load');
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.route('https://id.travelify.io/api/auth/me', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, user: { email: 'demo@travelgenix.io', fullName: 'Demo', role: 'admin' }, client: { clientName: 'Demo', recordId: 'rec1', packageName: 'Ignite' }, permissions: [] }),
  }));
  await page.goto(BASE + '/editor-consent.html?id=tgw_demo');
  await page.waitForFunction(() => window.__consentReady || document.getElementById('in-privacy-url'));
  await page.waitForTimeout(900); // let load + sync settle

  // #4: the font picker reflects the saved Poppins, not the DM Sans default.
  const fp = await page.evaluate(() => window.tgse && tgse._fontPicker ? tgse._fontPicker.value : null);
  ok(fp === 'Poppins', 'font picker synced to saved fontFamily on load (got: ' + fp + ')');
  // The badge align picker reflects saved 'center'.
  const badgeOn = await page.evaluate(() => document.querySelector('#pick-badge-align .pick-btn.is-on')?.dataset.v);
  ok(badgeOn === 'center', 'badge alignment picker synced to saved value (got: ' + badgeOn + ')');

  // #1: type into the privacy URL input character by character; focus must hold
  // and the full string must land. It lives on the Content tab.
  await page.click('[data-tab="content"][role="tab"]');
  await page.waitForTimeout(150);
  const sel = '#in-privacy-url';
  await page.click(sel);
  await page.fill(sel, '');
  for (const ch of 'privacy-policy') {
    await page.type(sel, ch, { delay: 40 });
  }
  await page.waitForTimeout(400); // debounce window would reload preview here
  const state = await page.evaluate((s) => ({
    value: document.querySelector(s).value,
    focused: document.activeElement === document.querySelector(s),
  }), sel);
  ok(state.value === 'privacy-policy', 'full string typed without interruption (got: ' + state.value + ')');
  ok(state.focused === true, 'input keeps focus after the debounced preview render');
  await ctx.close();
}

await browser.close();
server.close();
console.log(`\nconsent-fixes-smoke: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
