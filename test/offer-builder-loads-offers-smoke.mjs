/**
 * The Special Offers workspace loads the agent's offers when it opens.
 * (21 Sep 2026 — Tullys Travel.)
 *
 * Andrea at Tullys reported that every custom offer she had built was live on
 * tullys.ie but the editor showed "My offers 0" and an empty table, so she
 * could not edit them or add more.
 *
 * Nothing was lost. The offers were in storage the whole time: the public feed
 * `/api/saved-offers?client=<clientRecordId>` was serving all five to her
 * website. The editor simply never asked for them. Commit 635c0d1 (17 Sep)
 * rewrote boot() so the editor loads its widget before painting — a real fix
 * for a real bug — and in the rewrite the `loadOffers()` call fell off the end
 * of the line. Every other call site is a reaction to something the agent does
 * (save, delete, import, leave the bin, close the form), so a freshly opened
 * workspace fetched nothing and showed the "0" that sits in the static markup.
 *
 * Two things make this invisible to a source grep, which is why it is a browser
 * test:
 *   - `loadOffers` is still defined and still called in six places, so the name
 *     appears in the file either way. Only running boot() shows whether the
 *     list is fetched on load.
 *   - the count element is hard-coded to 0 in the HTML, so "0 offers" is what
 *     the page shows both when the list is genuinely empty and when it was
 *     never requested. The two states are indistinguishable without watching
 *     the network.
 *
 * It also guards the second symptom: state.feedKey is only ever set by the
 * offers response, so an editor that skips the load tells the agent
 * "your account is missing a client id — please contact support" when they
 * click Get embed code, which is alarming and untrue.
 *
 * Run: node test/offer-builder-loads-offers-smoke.mjs
 *      (npm run test:offer-builder-loads-offers)
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const ROOT = new URL('../public/', import.meta.url).pathname;
const FEED_KEY = 'recTESTclient00001';

// Three offers, shaped the way the list endpoint really answers: a summary per
// offer plus the feedKey the embed builder reads.
const OFFERS = [
  { id: 'Z3D4TKX9neoJ', title: '7 Night Mediterranean Fly Cruise', type: 'Cruise', price: '4535', currency: 'EUR' },
  { id: 'whaE2qZCronN', title: '12 Night Spain, Canaries & Morocco', type: 'Cruise', price: '1185', currency: 'EUR' },
  { id: 'K0i6G6OPhrr4', title: '8 Night Mediterranean & Adriatic', type: 'Cruise', price: '1373', currency: 'EUR' },
];

let passed = 0;
let failed = 0;
function ok(label, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.log('  ✗ ' + label + (detail ? '  — ' + detail : '')); }
}

// Use whichever Chromium this machine actually has. Playwright looks for the
// exact build its version pins, which a CI image or a sandbox often does not
// carry; TG_CHROMIUM lets the runner point at the one that is installed rather
// than fail on a missing download.
const browser = await chromium.launch(
  process.env.TG_CHROMIUM ? { executablePath: process.env.TG_CHROMIUM } : {}
);
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message.slice(0, 120)));

// Every request the workspace makes to the list endpoint, in order, so we can
// prove the load happened without any user action.
const listCalls = [];

await page.route('**/*', async (route) => {
  const req = route.request();
  const url = req.url();
  const path = url.replace(/^https?:\/\/[^/]+/, '');
  const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

  // The offers list: GET /api/saved-offers with no id/client/export/trash.
  if (req.method() === 'GET' && /^\/api\/saved-offers(\?|$)/.test(path)) {
    const q = new URLSearchParams(path.split('?')[1] || '');
    if (!q.get('id') && !q.get('client') && !q.get('export') && !q.get('trash')) {
      listCalls.push(path);
      return json({ offers: OFFERS, feedKey: FEED_KEY });
    }
    return json({ offers: [] });
  }

  if (path.startsWith('/api/widget-config?id=')) {
    return json({ name: 'Tullys Offers', config: { columns: 3 }, columns: 3 });
  }
  if (path.startsWith('/api/auth/me')) {
    return json({ user: { email: 'probe@example.com', plan: 'Ignite' } });
  }
  if (path.startsWith('/api/')) return json({});

  let file = path.split('?')[0].replace(/^\//, '');
  if (!/\.[a-z0-9]+$/i.test(file)) file += '.html';
  try {
    const body = readFileSync(ROOT + file, 'utf8');
    const type = file.endsWith('.js') ? 'application/javascript'
      : file.endsWith('.css') ? 'text/css' : 'text/html';
    return route.fulfill({ status: 200, contentType: type, body });
  } catch { return route.fulfill({ status: 404, body: '' }); }
});

await page.addInitScript(() => {
  try {
    localStorage.setItem('tg_token', 'probe');
    localStorage.setItem('tg_user', JSON.stringify({ email: 'probe@example.com', plan: 'Ignite' }));
  } catch (e) { /* private mode */ }
});

console.log('\nSpecial Offers workspace: the offers load when it opens\n');

await page.goto('https://tg-widgets.vercel.app/editor-offer-builder?id=tgw_probe', { timeout: 20000 });
await page.waitForTimeout(2600);

// ---- The load itself -------------------------------------------------------
// Nothing has been clicked. If the list was never requested, the agent is
// looking at an empty workspace and has no way to know their offers exist.
ok('the workspace asks for the offers on load, with no user action',
  listCalls.length >= 1, 'no GET /api/saved-offers was made');

ok('it asks once, not once per render',
  listCalls.length <= 1, 'made ' + listCalls.length + ' calls: ' + listCalls.join(', '));

// ---- What the agent sees ---------------------------------------------------
const count = await page.evaluate(() => {
  const el = document.getElementById('offerCount');
  return el ? el.textContent.trim() : '(missing)';
});
ok('the count shows the offers returned, not the 0 in the static markup',
  count === String(OFFERS.length), 'count read ' + JSON.stringify(count));

// The workspace opens in the spreadsheet view, where each title is an editable
// cell, so the titles live in input VALUES rather than in the page text.
const shown = await page.evaluate(() => Array.from(
  document.querySelectorAll('#listView input.cell[data-key="title"]')
).map((el) => el.value));
for (const o of OFFERS) {
  ok('"' + o.title + '" is in the sheet, ready to edit',
    shown.includes(o.title), 'sheet holds ' + JSON.stringify(shown));
}

// ---- The embed panel -------------------------------------------------------
// feedKey arrives only on the offers response, so an editor that skipped the
// load accuses the agent's account of being broken.
const embedText = await page.evaluate(() => {
  const btn = document.getElementById('btn-embed');
  if (btn) btn.click();
  const box = document.getElementById('embedCode');
  return box ? (box.textContent || '') : '(missing)';
});
ok('Get embed code does not claim the account is missing a client id',
  !/missing a client id/i.test(embedText), 'embed panel said: ' + embedText.slice(0, 120));
ok('the embed snippet carries the client feed key',
  embedText.includes(FEED_KEY), 'feed key not in the snippet');

// ---- No collateral damage --------------------------------------------------
// The load must not disturb the fix it sits next to: the widget's own name and
// config still have to arrive (635c0d1's reason for existing).
const nameVal = await page.evaluate(() => document.getElementById('name-input')?.value ?? '(missing)');
ok('the widget name still loads alongside the offers',
  nameVal === 'Tullys Offers', 'name box read ' + JSON.stringify(nameVal));

ok('the workspace boots without a page error',
  pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
