/**
 * Travel Results AI — the AI endpoint failing must raise a widget-log alert.
 *
 * The widget degrades gracefully to local picks when its AI endpoint fails, but
 * previously did so SILENTLY — no alert — so a real outage (dead ANTHROPIC key,
 * no credit, 5xx) went unnoticed. It now beacons /api/widget-log on a genuine
 * endpoint failure. This drives the REAL widget in jsdom against a mocked
 * endpoint and asserts:
 *   - a non-2xx (HTTP 502) response fires exactly one widget-log alert, tagged
 *     widget:"travel-results-ai" with the status in the detail;
 *   - a network-level reject ("Failed to fetch") fires NO alert (transient /
 *     navigate-away is covered by the local fallback);
 *   - the isEndpointFailure classifier only matches completed HTTP errors.
 *
 * Run: node test/trai-endpoint-alert-smoke.mjs
 */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

const WIDGET = readFileSync(new URL('../public/widget-travel-results-ai.js', import.meta.url), 'utf8');

const SAMPLE = {
  version: 4, searchSession: 'demo-session',
  criteria: { locationName: 'Costa del Sol, Spain', checkinDate: '2026-08-12', checkoutDate: '2026-08-19', nights: 7, passengers: { total: 2, adults: 2 }, rooms: 1, currency: 'GBP', latitude: 36.51, longitude: -4.88 },
  results: [
    { rid: 'p1', name: 'Hotel Marbella Bay', starRating: 4, address: 'Marbella, Spain', latitude: 36.509, longitude: -4.886, description: 'Seafront hotel.', goodFor: ['Couples'], amenities: ['Pool', 'Wi-Fi'], tripadvisor: { rating: 4.5, reviewCount: 1820 }, units: [{ name: 'Double', rates: [{ board: 'Bed & Breakfast', price: 1190, currency: 'GBP', refundability: 'Refundable' }] }] },
    { rid: 'p2', name: 'Sol Playa Apartments', starRating: 3, address: 'Fuengirola, Spain', latitude: 36.539, longitude: -4.624, description: 'Self-catering.', goodFor: ['Families'], amenities: ['Kitchen', 'Pool'], tripadvisor: { rating: 4.1, reviewCount: 640 }, units: [{ name: 'Apartment', rates: [{ board: 'Room Only', price: 720, currency: 'GBP', refundability: 'NonRefundable' }] }] },
    { rid: 'p3', name: 'Gran Hotel Miramar', starRating: 5, address: 'Malaga, Spain', latitude: 36.722, longitude: -4.408, description: 'Five-star.', goodFor: ['Luxury'], amenities: ['Spa', 'Pool'], tripadvisor: { rating: 4.7, reviewCount: 2950 }, units: [{ name: 'Sea View', rates: [{ board: 'Bed & Breakfast', price: 2380, currency: 'GBP', refundability: 'Refundable' }] }] },
    { rid: 'p4', name: 'Torremolinos Inn', starRating: 3, address: 'Torremolinos, Spain', latitude: 36.622, longitude: -4.499, description: 'Budget.', goodFor: ['Budget'], amenities: ['Wi-Fi'], tripadvisor: { rating: 3.9, reviewCount: 410 }, units: [{ name: 'Standard', rates: [{ board: 'Room Only', price: 540, currency: 'GBP', refundability: 'NonRefundable' }] }] },
  ],
};

// Drive the real widget once against a mocked AI endpoint. `aiResponder(url)`
// returns the Promise the AI fetch resolves/rejects with. Returns the captured
// widget-log POST bodies (parsed).
async function run(aiResponder) {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://results.example.test/' });
  const { window } = dom;
  window.console = { log() {}, warn() {}, error() {} };
  const logs = [];
  // Force the fetch path (not sendBeacon) so we can capture the body.
  try { delete window.navigator.sendBeacon; } catch (e) {}
  window.fetch = (url, opts) => {
    const u = String(url);
    if (u.indexOf('/api/widget-log') > -1) {
      try { logs.push(JSON.parse(opts.body)); } catch (e) { logs.push({ raw: opts.body }); }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    }
    if (u.indexOf('/api/travel-results-ai') > -1) return aiResponder(u);
    if (u.indexOf('/api/widget-config') > -1) return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: {} }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  };

  window.eval(WIDGET);
  window.dispatchEvent(new window.CustomEvent('tg:travel-results-v4:accommodation-results-ready', { detail: SAMPLE }));
  await new Promise((r) => setTimeout(r, 300));
  return logs;
}

// ── A non-2xx endpoint response → exactly one alert, tagged + detailed ────────
let logs = await run(() => Promise.resolve({ ok: false, status: 502, json: async () => ({ error: 'AI service unavailable' }) }));
ok(logs.length === 1, `HTTP 502 → exactly one widget-log alert (got ${logs.length})`);
if (logs[0]) {
  ok(logs[0].widget === 'travel-results-ai', 'alert tagged widget:"travel-results-ai"');
  ok(logs[0].event === 'error', 'alert event is "error"');
  ok(/recommendations endpoint failed/.test(logs[0].message || ''), 'message names the endpoint failure');
  ok(/HTTP 502/.test(logs[0].detail || ''), 'detail carries the HTTP status (502)');
}

// ── A network-level reject → NO alert (transient / navigate-away) ─────────────
logs = await run(() => Promise.reject(new TypeError('Failed to fetch')));
ok(logs.length === 0, `network reject → no alert (got ${logs.length})`);

// ── An aborted request (timeout / navigate-away) → NO alert ───────────────────
logs = await run(() => Promise.reject(new Error('The operation was aborted')));
ok(logs.length === 0, `abort → no alert (got ${logs.length})`);

// ── classifier: only completed HTTP errors qualify ───────────────────────────
function sliceBalanced(src, fromIdx) {
  let i = src.indexOf('{', fromIdx); const open = i; let d = 0, str = null, line = false, block = false;
  for (; i < src.length; i++) { const c = src[i], n = src[i + 1];
    if (line) { if (c === '\n') line = false; continue; }
    if (block) { if (c === '*' && n === '/') { block = false; i++; } continue; }
    if (str) { if (c === '\\') { i++; continue; } if (c === str) str = null; continue; }
    if (c === '/' && n === '/') { line = true; i++; continue; }
    if (c === '/' && n === '*') { block = true; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { str = c; continue; }
    if (c === '{') d++; else if (c === '}') { d--; if (d === 0) return src.slice(open, i + 1); } }
  throw new Error('unbalanced');
}
const ex = (src, sig) => sig + sliceBalanced(src, src.indexOf(sig) + sig.length);
// eslint-disable-next-line no-eval
const isEndpointFailure = eval('(' + ex(WIDGET, 'function isEndpointFailure(message)') + ')');
ok(isEndpointFailure('HTTP 502') === true, 'HTTP 502 → failure');
ok(isEndpointFailure('HTTP 500') === true, 'HTTP 500 → failure');
ok(isEndpointFailure('HTTP 429') === true, 'HTTP 429 → failure');
ok(isEndpointFailure('Failed to fetch') === false, 'network reject → not a failure');
ok(isEndpointFailure('The operation was aborted') === false, 'abort → not a failure');
ok(isEndpointFailure('') === false, 'empty → not a failure');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
