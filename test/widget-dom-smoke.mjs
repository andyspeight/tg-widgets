/**
 * DOM render smoke test for the Currency Converter widget (and a presence check
 * for the Loader). Uses jsdom to mount the real widget script with a stubbed FX
 * response, then asserts it renders a converted value and reacts to a swap.
 * Run: node test/widget-dom-smoke.mjs
 */
import { readFileSync } from 'node:fs';
import assert from 'node:assert';

// jsdom is an optional dev dependency. If it isn't installed, skip cleanly so
// the wider test run never fails just because this machine lacks it.
//   npm install jsdom    (to run this test)
let JSDOM;
try { ({ JSDOM } = await import('jsdom')); }
catch { console.log('jsdom not installed — skipping DOM smoke (run: npm install jsdom)'); process.exit(0); }

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) passed++; else { failed++; console.error('  FAIL:', label); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Stubbed rates: base GBP, EUR=1.2, USD=1.25.
const RATES = { ok: true, base: 'GBP', date: '2026-06-12', rates: { GBP: 1, EUR: 1.2, USD: 1.25 } };

async function mount(scriptFile, configAttr, { stubFetch = true } = {}) {
  const dom = new JSDOM(
    `<!doctype html><html><body><div data-tg-widget="currency" data-tg-config='${configAttr}'></div></body></html>`,
    { runScripts: 'dangerously', url: 'https://agency.example.com/' }
  );
  const { window } = dom;
  if (stubFetch) {
    window.fetch = async () => ({ ok: true, json: async () => RATES });
  }
  const code = readFileSync(new URL(`../public/${scriptFile}`, import.meta.url), 'utf8');
  const s = window.document.createElement('script');
  s.textContent = code;
  window.document.body.appendChild(s);
  await sleep(60); // let init() + _loadRates() resolve
  return dom;
}

// ── 1. Currency widget renders a live conversion ──
{
  const cfg = JSON.stringify({
    baseCurrency: 'GBP', currencies: ['GBP', 'EUR', 'USD'],
    defaultFrom: 'GBP', defaultTo: 'EUR', defaultAmount: 100, decimals: 2,
  }).replace(/'/g, '&#39;');
  const dom = await mount('widget-currency.js', cfg);
  const host = dom.window.document.querySelector('[data-tg-widget="currency"]');
  ok(!!host.shadowRoot, 'currency: shadow root attached');
  const result = host.shadowRoot.getElementById('result');
  ok(result && /120/.test(result.textContent), 'currency: 100 GBP→EUR renders 120 (got: ' + (result && result.textContent) + ')');
  ok(/£|GBP|1\b/.test(host.shadowRoot.getElementById('rate').textContent), 'currency: rate line shows the per-unit rate');
  const live = host.shadowRoot.getElementById('live');
  ok(live && /Live/i.test(live.textContent), 'currency: shows Live rates on a good fetch');

  // ── 2. Swap flips the direction and recomputes (100 EUR→GBP = 83.33) ──
  host.shadowRoot.getElementById('swap').click();
  await sleep(5);
  ok(/83/.test(host.shadowRoot.getElementById('result').textContent), 'currency: swap recomputes to ~83 (got: ' + host.shadowRoot.getElementById('result').textContent + ')');

  // ── 3. Changing the amount updates the result ──
  const amt = host.shadowRoot.getElementById('amt');
  amt.value = '200';
  amt.dispatchEvent(new dom.window.Event('input'));
  await sleep(5);
  ok(/166|167/.test(host.shadowRoot.getElementById('result').textContent), 'currency: 200 EUR→GBP ~166.67 (got: ' + host.shadowRoot.getElementById('result').textContent + ')');
  dom.window.close();
}

// ── 4. Fallback path: fetch fails → indicative rates, still renders a number ──
{
  const cfg = JSON.stringify({ baseCurrency: 'GBP', currencies: ['GBP', 'EUR'], defaultFrom: 'GBP', defaultTo: 'EUR', defaultAmount: 100 }).replace(/'/g, '&#39;');
  const dom = new JSDOM(`<!doctype html><html><body><div data-tg-widget="currency" data-tg-config='${cfg}'></div></body></html>`, { runScripts: 'dangerously', url: 'https://x.example/' });
  dom.window.fetch = async () => { throw new Error('network'); };
  const s = dom.window.document.createElement('script');
  s.textContent = readFileSync(new URL('../public/widget-currency.js', import.meta.url), 'utf8');
  dom.window.document.body.appendChild(s);
  await sleep(40);
  const host = dom.window.document.querySelector('[data-tg-widget="currency"]');
  const result = host.shadowRoot.getElementById('result');
  ok(result && /\d/.test(result.textContent), 'currency: fallback still renders a number when fetch fails');
  const live = host.shadowRoot.getElementById('live');
  ok(live && /Indicative/i.test(live.textContent), 'currency: fallback labels rates as Indicative');
  dom.window.close();
}

// ── 5. Loader script loads in a DOM and exposes its API ──
{
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'dangerously', url: 'https://x.example/' });
  const s = dom.window.document.createElement('script');
  s.textContent = readFileSync(new URL('../public/widget-loader.js', import.meta.url), 'utf8');
  dom.window.document.body.appendChild(s);
  await sleep(10);
  ok(typeof dom.window.TGLoaderWidget === 'function', 'loader: exposes window.TGLoaderWidget');
  ok(dom.window.TGLoader && typeof dom.window.TGLoader.draw === 'function', 'loader: exposes TGLoader.draw');
  dom.window.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
assert.strictEqual(failed, 0, 'DOM smoke failures');
