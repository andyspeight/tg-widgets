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
// eslint-disable-next-line no-eval
const parseJsonResponse = eval('(' + ex(widget, 'async function parseJsonResponse(res, label)') + ')');

const realFetch = global.fetch;

// ── isNavAwayError: network/abort → true; real errors → false ────────────────
ok(isNavAwayError('Failed to fetch') === true, 'Failed to fetch → nav-away');
ok(isNavAwayError('Load failed') === true, 'Safari "Load failed" → nav-away');
ok(isNavAwayError('The user aborted a request.') === true, 'abort message → nav-away');
ok(isNavAwayError('Travelify returned an error.') === false, 'real Travelify error → NOT nav-away (still alerts)');
ok(isNavAwayError('API 500') === false, 'HTTP status error → NOT nav-away');
ok(isNavAwayError('') === false, 'empty → NOT nav-away');

// ── Source guards: the defensive parser replaced the bare res.json() sites ────
ok(/async function parseJsonResponse\(res, label\)/.test(widget), 'shared defensive JSON parser is defined');
// Two offer fetches remain since the widget went cache-only (v1.16.0): the
// main read and the board's re-read. The live-proxy site is gone, not unwired.
ok((widget.match(/parseJsonResponse\(res, '/g) || []).length >= 2, 'defensive parser wired at both remaining offer fetch sites');
const _v = (widget.match(/const VERSION = '(\d+)\.(\d+)\.(\d+)'/) || []).slice(1).map(Number);
ok(_v.length === 3 && (_v[0] > 1 || (_v[0] === 1 && _v[1] >= 14)), `VERSION is at least 1.14.0 (is ${_v.join('.')})`);

// ── 23 Jul 2026 rate-limit lockout: editor/preview exemption + fail-soft ─────
ok(/function withPreview\(headers, cfg\)/.test(widget), 'withPreview helper tags editor/preview requests for limiter exemption');
ok((widget.match(/withPreview\(/g) || []).length >= 3, 'withPreview wired at both offer fetch sites (plus its definition)');
// The fail-soft rules moved from the live proxy onto the cache read when the
// widget went cache-only. The reasons they exist did not change: a 429 is our
// own limiter throttling a busy shared address, not a fault, and must never
// alert; a 5xx is a real outage and must. Both must be handled BEFORE
// parseJsonResponse, which would otherwise throw and be read as unreachable.
const cacheFetch = widget.slice(widget.indexOf('async _fetchFromCache('), widget.indexOf('\n    _needsFlightRows()'));
ok(/res && res\.status === 429/.test(cacheFetch), 'the cache read detects a 429 from our own limiter');
ok(/res && res\.status === 429[\s\S]{0,400}_showEmpty\(\)/.test(cacheFetch),
  'a 429 fails soft via _showEmpty — no raw "retry in 3600s" banner');
const after429 = cacheFetch.slice(cacheFetch.indexOf('if (res && res.status === 429)'));
ok(after429.indexOf('parseJsonResponse') > 0, 'the 429 soft-path runs BEFORE parseJsonResponse');
// A 429 must NOT beacon. Alerting per throttled visitor is how a busy office
// buries the outages that matter.
const block429 = cacheFetch.slice(cacheFetch.indexOf('if (res && res.status === 429)'),
  cacheFetch.indexOf('if (res && typeof res.status'));
ok(!/tgReport/.test(block429), 'a 429 does NOT fire an alert');
ok(/res\.status >= 500[\s\S]{0,400}_showEmpty\(\)/.test(cacheFetch), 'a 5xx fails soft via _showEmpty');
const after5xx = cacheFetch.slice(cacheFetch.indexOf("if (res && typeof res.status === 'number' && res.status >= 500)"));
ok(after5xx.indexOf('parseJsonResponse') > 0, 'the 5xx soft-path also runs BEFORE parseJsonResponse');
ok(/res\.status >= 500[\s\S]{0,500}tgReport/.test(cacheFetch), 'a 5xx DOES alert — it is our own outage and nothing else reports it');

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

  // ── parseJsonResponse: the fix for the 23 Jul 2026 "Unexpected end of JSON
  //    input" alert. An empty/non-JSON gateway body must yield a clean,
  //    status-bearing message, never the raw parser error. ──────────────────────
  const mkRes = (rok, status, text) => ({ ok: rok, status, text: async () => text });
  const grab = async (r, label) => {
    try { return { ok: true, data: await parseJsonResponse(r, label) }; }
    catch (e) { return { ok: false, msg: e.message }; }
  };
  let p;

  p = await grab(mkRes(true, 200, JSON.stringify({ success: true, data: [1, 2] })), 'Offers service');
  ok(p.ok && p.data && p.data.success === true, 'valid 200 JSON → parsed object returned');

  p = await grab(mkRes(true, 200, ''), 'Offers service');
  ok(!p.ok && /unavailable \(HTTP 200\)/.test(p.msg), 'empty 200 body → clean "unavailable (HTTP 200)"');
  ok(!p.ok && !/Unexpected end of JSON input/.test(p.msg), 'empty body NEVER surfaces the raw "Unexpected end of JSON input"');

  p = await grab(mkRes(false, 504, ''), 'Offers service');
  ok(!p.ok && p.msg === 'Offers service unavailable (HTTP 504)', 'empty 504 (the incident body) → exact classified message');

  p = await grab(mkRes(false, 429, JSON.stringify({ success: false, error: 'Too many requests. Please slow down and retry in 60 seconds.' })), 'Offers service');
  ok(!p.ok && /Too many requests/.test(p.msg), 'non-2xx JSON body → proxy .error surfaced (error contract preserved)');

  p = await grab(mkRes(false, 502, ''), 'Offers service');
  ok(!p.ok && /unavailable \(HTTP 502\)/.test(p.msg), 'empty 502 → classified with its status');

  p = await grab(mkRes(true, 200, '<html>gateway error</html>'), 'Offers service');
  ok(!p.ok && /invalid response \(HTTP 200\)/.test(p.msg) && !/Unexpected end of JSON input/.test(p.msg), 'non-JSON 200 body → "invalid response", not the raw parser error');
}

run()
  .catch((e) => { failed++; console.error('  FAIL: unexpected throw', e && e.message); })
  .finally(() => {
    global.fetch = realFetch;
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  });
