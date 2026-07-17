/**
 * Offers widget — offer-data load resilience + alert-noise suppression.
 *
 * A client alert ("offers failing … Failed to fetch", detail "cards") traced to
 * the live-proxy offer fetch having no timeout and no retry: a transient network
 * blip, or a visitor navigating away mid-load (which aborts the request), blanked
 * the widget and fired a false alert.
 *
 * Two real functions from public/widget-offers.js carry the fix:
 *   1. fetchWithRetry(url, opts, attempts, timeoutMs) — bounds each attempt and
 *      retries once on a network-level failure, so a blip self-heals.
 *   2. isNavAwayError(message) — recognises a network/abort error so _showError
 *      can drop the alert when the page is already hidden (navigate-away).
 *
 * We extract and drive the REAL functions from the shipped file.
 * Run: node test/offers-resilience-smoke.mjs
 */
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

function sliceBalanced(src, fromIdx) {
  let i = src.indexOf('{', fromIdx); const open = i;
  let d = 0, str = null, line = false, block = false;
  for (; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (line) { if (c === '\n') line = false; continue; }
    if (block) { if (c === '*' && n === '/') { block = false; i++; } continue; }
    if (str) { if (c === '\\') { i++; continue; } if (c === str) str = null; continue; }
    if (c === '/' && n === '/') { line = true; i++; continue; }
    if (c === '/' && n === '*') { block = true; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { str = c; continue; }
    if (c === '{') d++; else if (c === '}') { d--; if (d === 0) return src.slice(open, i + 1); }
  }
  throw new Error('unbalanced');
}
function ex(src, sig) { const at = src.indexOf(sig); if (at < 0) throw new Error('not found: ' + sig); return sig + sliceBalanced(src, at + sig.length); }

const widget = readFileSync(new URL('../public/widget-offers.js', import.meta.url), 'utf8');

// eslint-disable-next-line no-eval
const fetchWithRetry = eval('(' + ex(widget, 'function fetchWithRetry(url, opts, attempts, timeoutMs)') + ')');
// eslint-disable-next-line no-eval
const isNavAwayError = eval('(' + ex(widget, 'function isNavAwayError(message)') + ')');

const realFetch = global.fetch;

// ── isNavAwayError: network/abort → true; real errors → false ────────────────
ok(isNavAwayError('Failed to fetch') === true, 'Failed to fetch → nav-away');
ok(isNavAwayError('Load failed') === true, 'Safari "Load failed" → nav-away');
ok(isNavAwayError('The user aborted a request.') === true, 'abort message → nav-away');
ok(isNavAwayError('Travelify returned an error.') === false, 'real Travelify error → NOT nav-away (still alerts)');
ok(isNavAwayError('API 500') === false, 'HTTP status error → NOT nav-away');
ok(isNavAwayError('') === false, 'empty → NOT nav-away');

async function run() {
  let calls;

  // success on first attempt → one call
  calls = 0;
  global.fetch = async () => { calls++; return { ok: true, json: async () => ({ success: true }) }; };
  let res = await fetchWithRetry('u', {}, 2, 200);
  ok(calls === 1, 'success → one call only');
  ok(res && res.ok === true, 'success → resolves with the response');

  // one transient reject, then success → two calls
  calls = 0;
  global.fetch = async () => { calls++; if (calls === 1) throw new TypeError('Failed to fetch'); return { ok: true }; };
  res = await fetchWithRetry('u', {}, 2, 200);
  ok(calls === 2, 'reject then ok → retried once (two calls)');
  ok(res && res.ok === true, 'retry → resolves with the second response');

  // both attempts reject → rejects after exactly two calls
  calls = 0;
  global.fetch = async () => { calls++; throw new TypeError('Failed to fetch'); };
  let threw = false;
  try { await fetchWithRetry('u', {}, 2, 200); } catch (e) { threw = true; }
  ok(threw === true, 'both fail → rejects');
  ok(calls === 2, 'both fail → exactly two attempts (no infinite loop)');

  // a resolved HTTP error is NOT retried (won't self-heal) — handed straight back
  calls = 0;
  global.fetch = async () => { calls++; return { ok: false, status: 500 }; };
  res = await fetchWithRetry('u', {}, 2, 200);
  ok(calls === 1, 'HTTP 500 response → not retried (one call)');
  ok(res && res.status === 500, 'HTTP error response handed back to caller');

  // a hung request is aborted by the timeout, then retried
  calls = 0;
  global.fetch = (url, opts) => new Promise((_, reject) => {
    calls++;
    const sig = opts && opts.signal;
    if (sig) sig.addEventListener('abort', () => reject(new Error('The operation was aborted')));
  });
  threw = false;
  try { await fetchWithRetry('u', {}, 2, 40); } catch (e) { threw = true; }
  ok(threw === true, 'hung request → times out and ultimately rejects');
  ok(calls === 2, 'hung request → aborted and retried once (two attempts)');

  // caller opts (POST method + body) preserved alongside the injected signal
  calls = 0;
  let sawMethod = null, sawBody = null;
  global.fetch = async (url, opts) => { calls++; sawMethod = opts && opts.method; sawBody = opts && opts.body; return { ok: true }; };
  await fetchWithRetry('u', { method: 'POST', body: '{"a":1}' }, 2, 200);
  ok(sawMethod === 'POST' && sawBody === '{"a":1}', 'caller opts (method + body) preserved with the injected signal');
}

run()
  .catch((e) => { failed++; console.error('  FAIL: unexpected throw', e && e.message); })
  .finally(() => {
    global.fetch = realFetch;
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  });
