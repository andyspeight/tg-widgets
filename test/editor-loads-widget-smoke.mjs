/**
 * Every editor opens on the widget it was given (17 Sep 2026).
 *
 * Andy reported a copied Special Offers widget that would not keep its changes
 * and showed an empty name. The cause was that editor-offer-builder.html never
 * fetched the widget: it booted from its hardcoded defaults, so the name box
 * was blank, every control showed a default, and the next Save wrote those
 * defaults back over the real config. Silent config loss.
 *
 * That is a whole CLASS of fault, not one editor, and it is invisible to a
 * source grep: the Event family loads through editor-events-kit.js, so grepping
 * the HTML for a fetch says "missing" about seven editors that are perfectly
 * fine. The only honest test is to open each editor in a browser and see.
 *
 * The probe is editor-agnostic on purpose, so it works for all 56 without
 * knowing any of their control ids:
 *   - the NAME is universal. Every shell editor has #name-input and the shell
 *     saves whatever is in it, so a blank name after loading a named widget
 *     means the widget was never read.
 *   - a SENTINEL key in the stored config reaches the save only if the editor
 *     merged what it loaded over its defaults.
 *
 * An editor that builds its save payload field by field legitimately drops an
 * unknown key, so the sentinel alone is not proof of a fault — those are listed
 * as BY_NAME_ONLY below with the reason, and the name check still has to pass.
 *
 * Run: node test/editor-loads-widget-smoke.mjs  (npm run test:editor-loads-widget)
 *      node test/editor-loads-widget-smoke.mjs popup offers   (a subset)
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const ROOT = new URL('../public/', import.meta.url).pathname;

// Editor-agnostic probe. We do not need to know any editor's control ids:
//   - the NAME is universal (every shell editor has #name-input, and the shell
//     saves from it), so a blank name after load means the widget wasn't read;
//   - a SENTINEL key in the stored config survives into the save only if the
//     editor merged what it loaded over its defaults.
import { readdirSync } from 'node:fs';

// Not on the unified shell: it predates it, has no #name-input and saves
// through /api/enquiry-form-config. Documented in the widget-suite skill.
const NOT_ON_SHELL = new Set(['enquiry']);
// A harness page, not a client editor.
const NOT_AN_EDITOR = new Set(['test', 'shell-template']);
// These fetch the widget and apply it, but build their save payload field by
// field, so an unknown key does not survive the round trip. Verified by hand:
// each one calls /api/widget-config?id= and syncs #name-input from the answer.
const BY_NAME_ONLY = new Set(['airport', 'attraction', 'emailsig', 'reviews']);
// Names itself from the connected Google Business profile rather than the
// stored widget name, so the name check cannot apply.
const NAMES_ITSELF = new Set(['reviews']);

const ALL = readdirSync(ROOT)
  .filter((f) => /^editor-.*\.html$/.test(f))
  .map((f) => f.replace(/^editor-/, '').replace(/\.html$/, ''))
  .filter((n) => !NOT_AN_EDITOR.has(n) && !NOT_ON_SHELL.has(n))
  .sort();
const EDITORS = process.argv.slice(2).length ? process.argv.slice(2) : ALL;

let passed = 0, failed = 0;
const ok = (label, cond, detail) => {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.error('  ✗ ' + label + (detail ? '\n      ' + detail : '')); }
};
console.log('Opening ' + EDITORS.length + ' editors on a saved widget\n');
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
});

for (const name of EDITORS) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message.slice(0, 80)));
  let posted = null;
  await page.route('**/*', async (route) => {
    const path = route.request().url().replace(/^https?:\/\/[^/]+/, '');
    if (path.startsWith('/api/widget-config?id=')) {
      const cfg = { __tgProbe: 'SENTINEL' };
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ name: 'PROBE NAME', config: cfg, ...cfg }) });
    }
    if (route.request().method() === 'POST') {
      try { posted = JSON.parse(route.request().postData() || '{}'); } catch { posted = {}; }
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ success: true, widgetId: 'tgw_probe' }) });
    }
    if (path.startsWith('/api/auth/me')) {
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ user: { email: 'probe@example.com', plan: 'Ignite' } }) });
    }
    if (path.startsWith('/api/')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    let file = path.split('?')[0].replace(/^\//, '');
    if (!/\.[a-z0-9]+$/i.test(file)) file += '.html';
    try {
      const body = readFileSync(ROOT + file, 'utf8');
      const type = file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html';
      return route.fulfill({ status: 200, contentType: type, body });
    } catch { return route.fulfill({ status: 404, body: '' }); }
  });
  await page.addInitScript(() => {
    try {
      localStorage.setItem('tg_token', 'probe');
      localStorage.setItem('tg_user', JSON.stringify({ email: 'probe@example.com', plan: 'Ignite' }));
    } catch (e) {}
  });
  try {
    await page.goto('https://tg-widgets.vercel.app/editor-' + name + '?id=tgw_probe', { timeout: 20000 });
    await page.waitForTimeout(2600);
    const nameVal = await page.evaluate(() => {
      const el = document.getElementById('name-input');
      return el ? el.value : '(no name input)';
    });
    await page.evaluate(() => { const b = document.getElementById('btn-save'); if (b) b.click(); });
    await page.waitForTimeout(1400);
    const sentinel = !!(posted && posted.config && posted.config.__tgProbe === 'SENTINEL');
    if (!NAMES_ITSELF.has(name)) {
      ok(name + ': shows the saved widget name, not a blank box',
        nameVal === 'PROBE NAME', 'got ' + JSON.stringify(nameVal));
    }
    if (!BY_NAME_ONLY.has(name)) {
      ok(name + ': a save keeps the stored config rather than writing defaults over it',
        sentinel, posted ? 'sentinel missing from the save' : 'no save was posted at all');
    }
    // A thrown error can leave an editor half-wired while still looking fine:
    // editor-popup.html carried a second tgse.init from a paste and could not
    // be saved at all for two weeks before this suite was written.
    ok(name + ': loads without throwing', errs.length === 0, errs.join(' | '));
  } catch (e) {
    ok(name + ': the editor opens at all', false, (e.message || '').split('\n')[0].slice(0, 90));
  }
  await page.close();
}
await browser.close();
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
