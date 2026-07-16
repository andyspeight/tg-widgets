/**
 * Enquiry Form editor — load() outcome contract.
 *
 * The "it saved but my changes vanished on reopen" bug was an orphan-create:
 * when the editor was opened with ?id but load() failed, state.widgetId stayed
 * null and the first save took the CREATE path, writing edits to a brand-new
 * record while the original (still linked from the dashboard) kept its old
 * content. The fix makes load() report WHY it failed so init() can react:
 *   • 404  → form genuinely gone → loadNotFound=true → init starts a clean form
 *   • 5xx / network / 403 → form may exist → loadNotFound=false → init BLOCKS
 *     editing (never a blank that a save would overwrite or orphan)
 *   • 200  → loadNotFound=false, state.widgetId bound to the record
 *   • 401  → throws AUTH (re-login)
 *
 * load() touches no DOM, so we extract its real source from the editor HTML and
 * drive it against a mocked fetch. Run: node test/enquiry-load-smoke.mjs
 */
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

// Balanced-brace slice to pull a function's real source out of the HTML.
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

const html = readFileSync(new URL('../public/editor-enquiry.html', import.meta.url), 'utf8');
const loadSrc = ex(html, 'async function load(widgetId)');

// ── Stubs the extracted load() closes over ──────────────────────────────────
const API_CONFIG = '/api/enquiry-form-config';
const authHeaders = () => ({ 'Content-Type': 'application/json' });
const defaultConfig = () => ({ routing: {}, security: {}, fieldsJSON: '[]', stepsJSON: '[]' });
let state;
let fetchImpl = async () => { throw new Error('no fetch set'); };
globalThis.fetch = (...a) => fetchImpl(...a);

// eslint-disable-next-line no-eval
const load = eval('(' + loadSrc + ')');

const res = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
const freshState = () => ({ widgetId: null, formId: null, config: null, loadNotFound: 'unset' });

// ── 200 success: binds widgetId, clears the not-found flag ───────────────────
state = freshState();
fetchImpl = async () => res(200, { widgetId: 'tgw_real', fieldsJSON: '[]', routing: {}, security: {} });
ok((await load('tgw_real')) === true, 'success returns true');
ok(state.loadNotFound === false, 'success: loadNotFound=false');
ok(state.widgetId === 'tgw_real', 'success: widgetId bound to the record');

// ── 404: genuine not-found → flag set so init starts a clean form ────────────
state = freshState();
fetchImpl = async () => res(404, {});
ok((await load('tgw_gone')) === false, '404 returns false');
ok(state.loadNotFound === true, '404: loadNotFound=true (start-fresh path)');

// ── 5xx: real failure, NOT not-found → init must block, never blank-overwrite ─
state = freshState();
fetchImpl = async () => res(500, {});
ok((await load('tgw_real')) === false, '500 returns false');
ok(state.loadNotFound === false, '500: loadNotFound=false (init blocks, no orphan)');

// ── 403: permission error is also a hard block, not start-fresh ──────────────
state = freshState();
fetchImpl = async () => res(403, {});
ok((await load('tgw_real')) === false, '403 returns false');
ok(state.loadNotFound === false, '403: loadNotFound=false (init blocks)');

// ── network error: same as 5xx — block, don't orphan ─────────────────────────
state = freshState();
fetchImpl = async () => { throw new TypeError('Load failed'); };
ok((await load('tgw_real')) === false, 'network error returns false');
ok(state.loadNotFound === false, 'network error: loadNotFound=false (init blocks)');

// ── 401: expired session throws AUTH so init can re-login ────────────────────
state = freshState();
fetchImpl = async () => res(401, {});
let threw = null;
try { await load('tgw_real'); } catch (e) { threw = e.message; }
ok(threw === 'AUTH', '401 throws AUTH (re-login, not a silent blank)');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
