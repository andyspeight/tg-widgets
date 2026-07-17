/**
 * World Map — offers-load resilience + alert-noise suppression.
 *
 * A client alert ("map init failed" / "Failed to fetch") traced to the single
 * offers fetch having no timeout and no retry: a transient network blip, or a
 * visitor navigating away mid-load (which aborts the in-flight request), broke
 * the whole map init and raised a false alert.
 *
 * Two real functions from public/widget-worldmap.js carry the fix:
 *   1. fetchWithRetry(url, opts, attempts, timeoutMs) — bounds each attempt and
 *      retries once on a network-level failure, so a blip self-heals.
 *   2. isNavAwayAbort(message, hidden) — a network/abort error on an already
 *      hidden page is a navigate-away, not an actionable failure, so no alert.
 *
 * We extract and drive the REAL functions from the shipped file.
 * Run: node test/worldmap-offers-resilience-smoke.mjs
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

const widget = readFileSync(new URL('../public/widget-worldmap.js', import.meta.url), 'utf8');

// eslint-disable-next-line no-eval
const fetchWithRetry = eval('(' + ex(widget, 'function fetchWithRetry(url, opts, attempts, timeoutMs)') + ')');
// eslint-disable-next-line no-eval
const isNavAwayAbort = eval('(' + ex(widget, 'function isNavAwayAbort(message, hidden)') + ')');

const realFetch = global.fetch;

// ── isNavAwayAbort: only a network/abort error on a hidden page is suppressed ─
ok(isNavAwayAbort('Failed to fetch', true) === true, 'Failed to fetch + hidden → suppress');
ok(isNavAwayAbort('Failed to fetch', false) === false, 'Failed to fetch + VISIBLE → still alert');
ok(isNavAwayAbort('Load failed', true) === true, 'Safari "Load failed" + hidden → suppress');
ok(isNavAwayAbort('The user aborted a request.', true) === true, 'abort message + hidden → suppress');
ok(isNavAwayAbort('Leaflet failed to load', true) === false, 'Leaflet load failure still alerts (real problem)');
ok(isNavAwayAbort('offers HTTP 500', true) === false, 'server 500 still alerts even if hidden');
ok(isNavAwayAbort('', true) === false, 'empty message → not suppressed');
ok(isNavAwayAbort('Failed to fetch', undefined) === false, 'no hidden flag → not suppressed');

// ── fetchWithRetry: success on first attempt makes exactly one call ───────────
async function run() {
  let calls;

  calls = 0;
  global.fetch = async () => { calls++; return { ok: true, status: 200 }; };
  let res = await fetchWithRetry('u', {}, 2, 200);
  ok(calls === 1, 'success → one call only');
  ok(res && res.ok === true, 'success → resolves with the response');

  // ── one transient network reject, then success → two calls, resolves ───────
  calls = 0;
  global.fetch = async () => { calls++; if (calls === 1) throw new TypeError('Failed to fetch'); return { ok: true, status: 200 }; };
  res = await fetchWithRetry('u', {}, 2, 200);
  ok(calls === 2, 'reject then ok → retried once (two calls)');
  ok(res && res.ok === true, 'retry → resolves with the second response');

  // ── both attempts reject → rejects after exactly two calls ─────────────────
  calls = 0;
  global.fetch = async () => { calls++; throw new TypeError('Failed to fetch'); };
  let threw = false;
  try { await fetchWithRetry('u', {}, 2, 200); } catch (e) { threw = true; }
  ok(threw === true, 'both fail → rejects');
  ok(calls === 2, 'both fail → exactly two attempts (no infinite loop)');

  // ── a hung request is aborted by the timeout, then retried ─────────────────
  calls = 0;
  global.fetch = (url, opts) => new Promise((_, reject) => {
    calls++;
    const sig = opts && opts.signal;
    if (sig) sig.addEventListener('abort', () => reject(new Error('The operation was aborted')));
    // otherwise never settles → the timeout must drive it
  });
  threw = false;
  const t0 = Date.now ? null : null; // Date.now unused; keep timing out of asserts
  try { await fetchWithRetry('u', {}, 2, 40); } catch (e) { threw = true; }
  ok(threw === true, 'hung request → times out and ultimately rejects');
  ok(calls === 2, 'hung request → aborted and retried once (two attempts)');

  // passing a signal through does not stop the caller's opts being honoured
  calls = 0;
  let sawCreds = null;
  global.fetch = async (url, opts) => { calls++; sawCreds = opts && opts.credentials; return { ok: true, status: 200 }; };
  await fetchWithRetry('u', { credentials: 'omit' }, 2, 200);
  ok(sawCreds === 'omit', 'caller opts (credentials) preserved alongside the injected signal');
}

run()
  .catch((e) => { failed++; console.error('  FAIL: unexpected throw', e && e.message); })
  .finally(() => {
    global.fetch = realFetch;
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  });
