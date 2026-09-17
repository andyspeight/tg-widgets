/**
 * The Special Offers editor opens on the widget it was given (17 Sep 2026).
 *
 * Reported by Andy against tgw_1789647726424_j5cczd: copy a Special Offers
 * widget, change something in the copy, save, and nothing sticks — and the
 * widget name shows empty in the settings.
 *
 * One cause for both. editor-offer-builder.html never fetched the widget. It
 * booted from the hardcoded defaults in `state` every time, so:
 *   - the name input was filled from state.name, which was always '';
 *   - every control showed a default rather than what had been saved;
 *   - and the next Save posted those defaults back, overwriting the real
 *     config and writing the name as "Untitled" (the shell's fallback for an
 *     empty name input).
 *
 * It looked copy-specific only because a copy forces you to open a widget you
 * have not just edited in this tab. It applied to every Special Offers widget.
 *
 * The suite drives the REAL editor in a REAL browser against a stubbed API,
 * because the bug is an ORDER-OF-BOOT bug: hydrateUI paints from state, so the
 * load has to land before it. jsdom would not have caught the race, and a
 * source grep would not have caught it at all.
 *
 * Run: node test/offer-builder-load-smoke.mjs  (npm run test:offer-builder-load)
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const ROOT = new URL('../public/', import.meta.url).pathname;
let passed = 0, failed = 0;
const ok = (label, cond, detail) => {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.error('  ✗ ' + label + (detail ? '\n      ' + detail : '')); }
};

// A saved widget that differs from the defaults in EVERY field we check, so a
// pass cannot come from a default happening to match.
const SAVED = {
  name: 'Test Offers',
  config: {
    cardLayout: 'cruise', columns: 4, template: 'cruise', accentColor: '#ff0000',
    currency: 'EUR', display: 'carousel', carouselAutoplay: true, carouselInterval: 10,
    enquiryEmail: 'hakon@example.com', protection: 'ABTA member',
  },
};

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

let savedBody = null;
await page.route('**/*', async (route) => {
  const path = route.request().url().replace(/^https?:\/\/[^/]+/, '');
  if (path.startsWith('/api/widget-config?id=')) {
    // The API answers { config, name, ...config } — spread included, as it
    // really is, so the editor cannot accidentally depend on the flattened copy.
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ...SAVED, ...SAVED.config }) });
  }
  if (path.startsWith('/api/widget-config') && route.request().method() === 'POST') {
    savedBody = JSON.parse(route.request().postData() || '{}');
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ success: true, widgetId: 'tgw_test' }) });
  }
  if (path.startsWith('/api/saved-offers')) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ offers: [] }) });
  }
  if (path.startsWith('/api/auth/me')) {
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ user: { email: 'hakon@example.com', plan: 'Ignite' } }) });
  }
  let file = path.split('?')[0].replace(/^\//, '');
  if (!/\.[a-z0-9]+$/i.test(file)) file += '.html';   // the vercel.json rewrite
  try {
    const body = readFileSync(ROOT + file, 'utf8');
    const type = file.endsWith('.js') ? 'application/javascript'
      : file.endsWith('.css') ? 'text/css' : 'text/html';
    return route.fulfill({ status: 200, contentType: type, body });
  } catch { return route.fulfill({ status: 404, body: '' }); }
});

await page.addInitScript(() => {
  try {
    localStorage.setItem('tg_token', 'test-token');
    localStorage.setItem('tg_user', JSON.stringify({ email: 'hakon@example.com', plan: 'Ignite' }));
  } catch (e) { /* private mode */ }
});
await page.goto('https://tg-widgets.vercel.app/editor-offer-builder?id=tgw_test');
await page.waitForTimeout(2500);

const seen = await page.evaluate(() => {
  const v = (id) => { const el = document.getElementById(id); return el ? el.value : null; };
  return {
    name: v('name-input'), currency: v('cfgCurrency'), accent: v('cfgAccent'),
    template: v('cfgTemplate'), autoplay: v('cfgCarAutoplay'), interval: v('cfgCarInterval'),
    protection: v('cfgProtection'), enquiry: v('cfgEnquiryEmail'),
  };
});

console.log('The editor opens on the widget it was given');
{
  ok('the editor booted at all', seen.name !== null, 'controls not found; page errors: ' + pageErrors.join(' | '));
  // The reported symptom, first.
  ok('the widget name is the saved one, not blank', seen.name === 'Test Offers', JSON.stringify(seen.name));
  ok('currency is the saved EUR, not the default GBP', seen.currency === 'EUR', seen.currency);
  ok('the accent is the saved colour, not the default teal',
    String(seen.accent).toLowerCase() === '#ff0000', seen.accent);
  ok('the page template is the saved one', seen.template === 'cruise', seen.template);
  ok('carousel autoplay is the saved on, not the default off', seen.autoplay === 'on', seen.autoplay);
  ok('the carousel interval is the saved one', seen.interval === '10', seen.interval);
  ok('the protection line is the saved one', seen.protection === 'ABTA member', seen.protection);
  ok('the enquiry email is the saved one', seen.enquiry === 'hakon@example.com', seen.enquiry);
  ok('nothing threw while loading', pageErrors.length === 0, pageErrors.join(' | '));
}

console.log('And a save writes that back, rather than the defaults over it');
{
  await page.evaluate(() => { const b = document.getElementById('btn-save'); if (b) b.click(); });
  await page.waitForTimeout(1200);
  ok('a save was posted', !!savedBody);
  if (savedBody) {
    // This is the destructive half of the bug: before the fix, pressing Save on
    // a widget you had only just opened replaced its config with the defaults.
    ok('the save keeps the name, rather than "Untitled"', savedBody.name === 'Test Offers', JSON.stringify(savedBody.name));
    const c = savedBody.config || {};
    ok('the save keeps the saved currency', c.currency === 'EUR', String(c.currency));
    ok('the save keeps the saved template', c.template === 'cruise', String(c.template));
    ok('the save keeps the saved carousel settings',
      c.carouselAutoplay === true && c.carouselInterval === 10,
      JSON.stringify({ a: c.carouselAutoplay, i: c.carouselInterval }));
    ok('the save keeps the saved protection line', c.protection === 'ABTA member', String(c.protection));
    ok('and still says which widget type it is', savedBody.widgetType === 'Special Offers', String(savedBody.widgetType));
  }
}

console.log('A brand new widget still opens on the defaults');
{
  savedBody = null;
  await page.goto('https://tg-widgets.vercel.app/editor-offer-builder');
  await page.waitForTimeout(2000);
  const fresh = await page.evaluate(() => {
    const v = (id) => { const el = document.getElementById(id); return el ? el.value : null; };
    return { name: v('name-input'), currency: v('cfgCurrency'), template: v('cfgTemplate') };
  });
  ok('no id means an empty name, ready to be typed', fresh.name === '', JSON.stringify(fresh.name));
  ok('and the defaults, not the last widget\'s settings',
    fresh.currency === 'GBP' && fresh.template === 'classic',
    JSON.stringify(fresh));
}

await browser.close();
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
