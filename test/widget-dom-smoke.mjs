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

// ── 6. World Clock renders live times for multiple zones ──
{
  const cfg = JSON.stringify({
    heading: 'Times',
    destinations: [
      { label: 'London', tz: 'Europe/London', cc: 'GB' },
      { label: 'Tokyo', tz: 'Asia/Tokyo', cc: 'JP' },
    ],
    use24h: true, showSeconds: false, showDayNight: true,
  }).replace(/'/g, '&#39;');
  const dom = new JSDOM(`<!doctype html><html><body><div data-tg-widget="worldclock" data-tg-config='${cfg}'></div></body></html>`, { runScripts: 'dangerously', url: 'https://x.example/' });
  const s = dom.window.document.createElement('script');
  s.textContent = readFileSync(new URL('../public/widget-worldclock.js', import.meta.url), 'utf8');
  dom.window.document.body.appendChild(s);
  await sleep(40);
  const host = dom.window.document.querySelector('[data-tg-widget="worldclock"]');
  ok(!!host.shadowRoot, 'worldclock: shadow root attached');
  const times = [...host.shadowRoot.querySelectorAll('[data-role="time"]')];
  ok(times.length === 2, 'worldclock: one clock per destination (got ' + times.length + ')');
  ok(times.every(t => /^\d{1,2}:\d{2}$/.test(t.textContent)), 'worldclock: 24h times render as HH:MM (got: ' + times.map(t => t.textContent).join(', ') + ')');
  ok(times[0].textContent !== times[1].textContent, 'worldclock: London and Tokyo show different times');
  ok(host.shadowRoot.querySelectorAll('[data-role="dn"] svg').length === 2, 'worldclock: day/night marker rendered per row');
  ok(typeof dom.window.TGWorldClockWidget === 'function', 'worldclock: exposes window.TGWorldClockWidget');
  dom.window.close(); // stops the tick interval
}

// ── 7. Flight Time & Distance computes a great-circle route ──
{
  const cfg = JSON.stringify({ heading: 'Route', defaultFrom: 'LHR', defaultTo: 'JFK', units: 'both' }).replace(/'/g, '&#39;');
  const dom = new JSDOM(`<!doctype html><html><body><div data-tg-widget="flighttime" data-tg-config='${cfg}'></div></body></html>`, { runScripts: 'dangerously', url: 'https://x.example/' });
  const s = dom.window.document.createElement('script');
  s.textContent = readFileSync(new URL('../public/widget-flighttime.js', import.meta.url), 'utf8');
  dom.window.document.body.appendChild(s);
  await sleep(40);
  const host = dom.window.document.querySelector('[data-tg-widget="flighttime"]');
  ok(!!host.shadowRoot, 'flighttime: shadow root attached');
  const kmOf = (txt) => parseInt(((txt.match(/([\d,]+)\s*km/) || [])[1] || '0').replace(/,/g, ''), 10);
  const distTxt = host.shadowRoot.getElementById('dist').textContent;
  ok(kmOf(distTxt) >= 5400 && kmOf(distTxt) <= 5700, 'flighttime: LHR→JFK ~5540 km (got ' + distTxt + ')');
  ok(/\d+h/.test(host.shadowRoot.getElementById('time').textContent), 'flighttime: shows an approximate flight time');
  ok(typeof dom.window.TGFlightTimeWidget.AIRPORTS === 'object', 'flighttime: exposes the bundled AIRPORTS table');
  // swap to JFK→LHR — distance is symmetric, should stay in range
  host.shadowRoot.getElementById('swap').click();
  await sleep(5);
  ok(kmOf(host.shadowRoot.getElementById('dist').textContent) >= 5400, 'flighttime: swap keeps the symmetric distance');
  dom.window.close();
}

// ── 8. Stats Counter renders formatted final figures ──
{
  // animate:false so the final values render synchronously (deterministic).
  const cfg = JSON.stringify({
    stats: [
      { value: 12000, label: 'Customers', prefix: '', suffix: '+', decimals: 0 },
      { value: 4.9, label: 'Rating', prefix: '', suffix: '/5', decimals: 1 },
      { value: 2.4, label: 'Raised', prefix: '£', suffix: 'M', decimals: 1 },
    ],
    columns: 3, animate: false,
  }).replace(/'/g, '&#39;');
  const dom = new JSDOM(`<!doctype html><html><body><div data-tg-widget="statscounter" data-tg-config='${cfg}'></div></body></html>`, { runScripts: 'dangerously', url: 'https://x.example/' });
  const s = dom.window.document.createElement('script');
  s.textContent = readFileSync(new URL('../public/widget-statscounter.js', import.meta.url), 'utf8');
  dom.window.document.body.appendChild(s);
  await sleep(40);
  const host = dom.window.document.querySelector('[data-tg-widget="statscounter"]');
  ok(!!host.shadowRoot, 'stats: shadow root attached');
  const nums = [...host.shadowRoot.querySelectorAll('[data-role="n"]')].map(n => n.textContent);
  ok(nums.length === 3, 'stats: one number per stat (got ' + nums.length + ')');
  ok(nums[0] === '12,000', 'stats: thousands separator on final value (got ' + nums[0] + ')');
  ok(nums[1] === '4.9', 'stats: respects 1 decimal place (got ' + nums[1] + ')');
  // prefix/suffix render around the number in accent spans
  const affixes = [...host.shadowRoot.querySelectorAll('.sc-affix')].map(a => a.textContent);
  ok(affixes.includes('£') && affixes.includes('M') && affixes.includes('/5'), 'stats: prefixes and suffixes render');
  ok(typeof dom.window.TGStatsCounterWidget === 'function', 'stats: exposes window.TGStatsCounterWidget');
  dom.window.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
assert.strictEqual(failed, 0, 'DOM smoke failures');
