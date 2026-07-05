/**
 * Smoke test for the Cookie Consent widget (public/widget-consent.js).
 *
 * Launches headless Chromium (Playwright), serves public/ plus stubbed
 * /api/consent-geo, /api/consent-log and /api/widget-log endpoints from an
 * in-process server (same-origin, nothing backgrounded), then walks the
 * real consent flows and asserts the signals that matter for compliance:
 *
 *   1. Consent Mode v2 defaults to denied at parse time, before any consent
 *   2. A gated script does NOT run pre-consent
 *   3. Accept all → gated script runs, cookie persisted, signals granted
 *   4. The choice survives a reload (no banner, gating auto-applies)
 *   5. Reject all persists and keeps gated scripts dormant after reload
 *   6. The preference centre grants a single category only
 *   7. An opt-out geo answer shows the light notice and applies implied consent
 *   8. Consent receipts reach /api/consent-log with no IP-ish fields
 *
 * Run: node test/consent-smoke.mjs
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');

let passed = 0, failed = 0;
const ok = (cond, label) => {
  if (cond) { passed++; console.log('  ok  ', label); }
  else { failed++; console.error('  FAIL', label); }
};

// ── In-process server: static public/ + API stubs ──────────────────
let geoMode = 'gdpr';
const consentLogBodies = [];

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const send = (code, body, type = 'application/json') => {
    res.writeHead(code, {
      'Content-Type': type,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    });
    res.end(body);
  };
  if (req.method === 'OPTIONS') return send(204, '');
  if (url.pathname === '/api/consent-geo') {
    return send(200, JSON.stringify({ country: geoMode === 'gdpr' ? 'GB' : 'US', mode: geoMode }));
  }
  if (url.pathname === '/api/consent-log') {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      try { consentLogBodies.push(JSON.parse(raw)); } catch { consentLogBodies.push({ parseError: raw }); }
      send(204, '');
    });
    return;
  }
  if (url.pathname === '/api/widget-log') {
    req.resume();
    req.on('end', () => send(204, ''));
    return;
  }
  if (url.pathname === '/fixture') {
    return send(200, FIXTURE_HTML, 'text/html; charset=utf-8');
  }
  const file = join(PUBLIC_DIR, url.pathname.replace(/^\/+/, ''));
  if (file.startsWith(PUBLIC_DIR) && existsSync(file)) {
    const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.html') ? 'text/html' : 'text/plain';
    return send(200, readFileSync(file), type + '; charset=utf-8');
  }
  send(404, JSON.stringify({ error: 'not found' }));
});

// A minimal client page: consent widget in <head> above a gated script,
// exactly as a Duda site would carry it.
const FIXTURE_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<script src="/widget-consent.js" data-geo="auto" data-privacy-url="/privacy"></script>
</head><body>
<h1>Fixture travel site</h1>
<script type="text/plain" data-tg-consent="analytics">window.__GATED_ANALYTICS__ = true;</script>
<script type="text/plain" data-tg-consent="marketing">window.__GATED_MARKETING__ = true;</script>
<a href="#tg-consent" id="footer-link">Cookie settings</a>
</body></html>`;

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const BASE = `http://127.0.0.1:${server.address().port}`;

// Prefer the environment's pre-installed Chromium when the pinned Playwright
// revision isn't downloaded (remote containers ship /opt/pw-browsers).
const PREINSTALLED = '/opt/pw-browsers/chromium';
const browser = await chromium.launch({
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  ...(existsSync(PREINSTALLED) ? { executablePath: PREINSTALLED } : {}),
});

const shadow = (page) => page.locator('[data-tg-widget="consent"]');
const inShadow = (page, sel) =>
  page.evaluateHandle((s) => document.querySelector('[data-tg-widget="consent"]').shadowRoot.querySelector(s), sel);
const clickShadow = async (page, sel) => {
  await page.evaluate((s) => {
    const el = document.querySelector('[data-tg-widget="consent"]').shadowRoot.querySelector(s);
    if (!el) throw new Error('not found in shadow: ' + s);
    el.click();
  }, sel);
};
const shadowHas = (page, sel) =>
  page.evaluate((s) => !!document.querySelector('[data-tg-widget="consent"]')?.shadowRoot.querySelector(s), sel);
const consentDefault = (page) =>
  page.evaluate(() => {
    const dl = window.dataLayer || [];
    for (const item of dl) {
      if (item && item[0] === 'consent' && item[1] === 'default') return { ...item[2] };
    }
    return null;
  });
const lastConsentUpdate = (page) =>
  page.evaluate(() => {
    const dl = window.dataLayer || [];
    let last = null;
    for (const item of dl) {
      if (item && item[0] === 'consent' && item[1] === 'update') last = { ...item[2] };
    }
    return last;
  });

// ── 1–4: GDPR accept-all journey ────────────────────────────────────
{
  console.log('\nGDPR flow: defaults denied, accept all, persistence');
  geoMode = 'gdpr';
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(BASE + '/fixture');
  await page.waitForFunction(() => !!window.tgConsent);
  await page.waitForFunction(() =>
    !!document.querySelector('[data-tg-widget="consent"]')?.shadowRoot.querySelector('.b-accept'));

  const def = await consentDefault(page);
  ok(def && def.analytics_storage === 'denied' && def.ad_storage === 'denied' &&
     def.ad_user_data === 'denied' && def.ad_personalization === 'denied',
     'Consent Mode default is denied for all non-essential signals');
  ok(def && def.security_storage === 'granted', 'security_storage stays granted');
  ok(await page.evaluate(() => window.__GATED_ANALYTICS__ === undefined), 'gated analytics script has NOT run pre-consent');
  ok(await shadowHas(page, '.b-reject'), 'Reject all is present on the first layer');
  ok(await shadowHas(page, 'a.plink'), 'privacy policy link is present');

  await clickShadow(page, '[data-act="accept"]');
  await page.waitForFunction(() => window.__GATED_ANALYTICS__ === true);
  ok(true, 'gated analytics script runs after Accept all');
  ok(await page.evaluate(() => window.__GATED_MARKETING__ === true), 'gated marketing script runs after Accept all');
  const upd = await lastConsentUpdate(page);
  ok(upd && upd.analytics_storage === 'granted' && upd.ad_storage === 'granted',
     'Consent Mode update grants analytics + ads');
  const cookies = await ctx.cookies(BASE);
  const cc = cookies.find((c) => c.name === 'tg_consent');
  ok(!!cc, 'tg_consent cookie persisted');
  ok(await shadowHas(page, '.badge'), 'floating re-entry badge appears after the choice');

  // Reload: no banner, gating auto-applies from the stored choice.
  await page.goto(BASE + '/fixture');
  await page.waitForFunction(() => !!window.tgConsent);
  await page.waitForFunction(() => window.__GATED_ANALYTICS__ === true);
  ok(true, 'reload: gated script auto-runs from the stored choice');
  await page.waitForFunction(() =>
    !!document.querySelector('[data-tg-widget="consent"]')?.shadowRoot.querySelector('.badge'));
  ok(!(await shadowHas(page, '.b-accept')), 'reload: banner does not re-appear');
  ok(await page.evaluate(() => window.tgConsent.isGranted('analytics')), 'API reports analytics granted');
  await ctx.close();
}

// ── 5: GDPR reject-all journey ──────────────────────────────────────
{
  console.log('\nGDPR flow: reject all persists');
  geoMode = 'gdpr';
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(BASE + '/fixture');
  await page.waitForFunction(() =>
    !!document.querySelector('[data-tg-widget="consent"]')?.shadowRoot.querySelector('.b-reject'));
  await clickShadow(page, '[data-act="reject"]');
  await page.waitForFunction(() =>
    !!document.querySelector('[data-tg-widget="consent"]')?.shadowRoot.querySelector('.badge'));
  ok(await page.evaluate(() => window.__GATED_ANALYTICS__ === undefined), 'gated script stays dormant after Reject all');
  const upd = await lastConsentUpdate(page);
  ok(upd && upd.analytics_storage === 'denied' && upd.ad_storage === 'denied', 'update keeps everything denied');

  await page.goto(BASE + '/fixture');
  await page.waitForFunction(() => !!window.tgConsent);
  await page.waitForFunction(() =>
    !!document.querySelector('[data-tg-widget="consent"]')?.shadowRoot.querySelector('.badge'));
  ok(!(await shadowHas(page, '.b-accept')), 'reload after reject: no banner re-prompt');
  ok(await page.evaluate(() => window.__GATED_ANALYTICS__ === undefined), 'reload after reject: gated script still dormant');
  await ctx.close();
}

// ── 6: preference centre grants a single category ──────────────────
{
  console.log('\nPreference centre: analytics only');
  geoMode = 'gdpr';
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(BASE + '/fixture');
  await page.waitForFunction(() =>
    !!document.querySelector('[data-tg-widget="consent"]')?.shadowRoot.querySelector('[data-act="prefs"]'));
  await clickShadow(page, '[data-act="prefs"]');
  await page.waitForFunction(() =>
    !!document.querySelector('[data-tg-widget="consent"]')?.shadowRoot.querySelector('input[data-cat="analytics"]'));
  ok(await shadowHas(page, '.lock'), 'necessary category is locked Always on');
  await clickShadow(page, 'input[data-cat="analytics"]');
  await clickShadow(page, '[data-act="save"]');
  await page.waitForFunction(() => window.__GATED_ANALYTICS__ === true);
  ok(true, 'analytics-gated script runs after granular save');
  ok(await page.evaluate(() => window.__GATED_MARKETING__ === undefined), 'marketing-gated script stays dormant');
  const upd = await lastConsentUpdate(page);
  ok(upd && upd.analytics_storage === 'granted' && upd.ad_storage === 'denied',
     'Consent Mode update: analytics granted, ads denied');
  await ctx.close();
}

// ── 7: opt-out region shows the light notice with implied consent ──
{
  console.log('\nOpt-out region: implied consent notice');
  geoMode = 'optout';
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(BASE + '/fixture');
  await page.waitForFunction(() => window.__GATED_ANALYTICS__ === true);
  ok(true, 'implied consent: gated script runs without a click');
  ok(await shadowHas(page, '[data-act="dismiss"]'), 'light notice with OK is shown');
  ok(await shadowHas(page, '[data-act="prefs"]'), 'notice offers an opt-out path');
  const upd = await lastConsentUpdate(page);
  ok(upd && upd.analytics_storage === 'granted', 'implied consent updates Consent Mode to granted');

  // Opting out from the notice: toggles arrive granted (implied consent), so
  // switch marketing off and save. The downgrade purges and reloads by design.
  await clickShadow(page, '[data-act="prefs"]');
  await page.waitForFunction(() =>
    !!document.querySelector('[data-tg-widget="consent"]')?.shadowRoot.querySelector('input[data-cat="marketing"]'));
  ok(await page.evaluate(() =>
    document.querySelector('[data-tg-widget="consent"]').shadowRoot.querySelector('input[data-cat="marketing"]').checked),
    'prefs toggles reflect the implied-consent state');
  await clickShadow(page, 'input[data-cat="marketing"]');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'load' }).catch(() => {}),
    clickShadow(page, '[data-act="save"]'),
  ]);
  await page.waitForFunction(() => !!window.tgConsent && window.tgConsent.hasChoice());
  ok(await page.evaluate(() => !window.tgConsent.isGranted('marketing') && window.tgConsent.isGranted('analytics')),
    'opt-out from notice sticks after the downgrade reload');
  ok(!(await shadowHas(page, '[data-act="dismiss"]')), 'notice does not re-appear once a real choice exists');
  await ctx.close();
}

// ── 8: consent receipts ─────────────────────────────────────────────
{
  console.log('\nConsent receipts');
  const withCats = consentLogBodies.filter((b) => b.action);
  ok(withCats.some((b) => b.action === 'accept_all'), 'accept_all receipt logged');
  ok(withCats.some((b) => b.action === 'reject_all'), 'reject_all receipt logged');
  ok(withCats.some((b) => b.action === 'implied'), 'implied receipt logged');
  ok(withCats.every((b) => /^v-[a-z0-9]+$/.test(String(b.id))), 'receipts carry a random anonymous id');
  ok(withCats.every((b) => !('ip' in b) && !('userAgent' in b) && !('email' in b)), 'receipts carry no personal fields');
}

await browser.close();
server.close();

console.log(`\nconsent-smoke: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
