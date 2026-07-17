/**
 * Quote PDF — branding colours survive the server render path.
 *
 * The editor saves a 6-colour model (topBar, hero, accent, labels, titles,
 * text). Two real functions carry those colours to the PDF/email:
 *   1. buildRenderOpts(config)  in api/quote-pdf.js  — reads the saved config
 *      and builds the opts handed to the renderer.
 *   2. resolveBrand(opts)       in render-quote.js   — validates each colour
 *      and maps it onto the template's CSS variables (with legacy fallback).
 *
 * Regression guard: buildRenderOpts used to forward only the LEGACY keys
 * (primary/primaryDark/accent/accentDark), silently dropping five of the six
 * new keys. The PDF then fell back to the default navy while the editor preview
 * showed the client's colours. This test drives BOTH real functions in series
 * and asserts a configured colour reaches the resolved brand unchanged.
 *
 * We extract and drive the REAL functions from the shipped files.
 * Run: node test/quote-pdf-brand-smoke.mjs
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

const api = readFileSync(new URL('../api/quote-pdf.js', import.meta.url), 'utf8');
const renderer = readFileSync(new URL('../render-quote.js', import.meta.url), 'utf8');

// eslint-disable-next-line no-eval
const buildRenderOpts = eval('(' + ex(api, 'function buildRenderOpts(config)') + ')');
// eslint-disable-next-line no-eval
const resolveBrand = eval('(' + ex(renderer, 'function resolveBrand(opts)') + ')');

// End-to-end: a saved config → the colours the renderer will actually paint.
const resolve = (config) => resolveBrand(buildRenderOpts(config)).colors;

const DEFAULTS = { topBar: '#111D3E', hero: '#1B2B5B', accent: '#00B4D8', labels: '#0096B7', titles: '#1B2B5B', text: '#0F172A' };

// ── The bug: a full 6-colour config must reach the renderer intact ───────────
const CUSTOM = { topBar: '#123456', hero: '#223344', accent: '#33AA55', labels: '#446677', titles: '#556688', text: '#010203' };
let r = resolve({ colors: CUSTOM });
for (const k of Object.keys(CUSTOM)) {
  ok(r[k] === CUSTOM[k], `custom ${k} forwarded (${r[k]} === ${CUSTOM[k]})`);
  ok(r[k] !== DEFAULTS[k], `custom ${k} is not the default navy (regression guard)`);
}

// ── Untouched form → the Travelgenix defaults, unchanged ─────────────────────
r = resolve({});
for (const k of Object.keys(DEFAULTS)) ok(r[k] === DEFAULTS[k], `no colours → default ${k}`);
r = resolve({ colors: {} });
ok(r.topBar === DEFAULTS.topBar && r.hero === DEFAULTS.hero, 'empty colours object → defaults');

// ── Legacy 4-colour config still maps through resolveBrand's fallback ────────
r = resolve({ colors: { primary: '#AA0000', primaryDark: '#BB0000', accent: '#CC0000', accentDark: '#DD0000' } });
ok(r.topBar === '#BB0000', 'legacy primaryDark → topBar');
ok(r.hero === '#AA0000', 'legacy primary → hero');
ok(r.titles === '#AA0000', 'legacy primary → titles');
ok(r.accent === '#CC0000', 'legacy accent → accent');
ok(r.labels === '#DD0000', 'legacy accentDark → labels');

// ── New keys win over legacy keys when both are present ──────────────────────
r = resolve({ colors: { topBar: '#0A0A0A', primaryDark: '#BB0000' } });
ok(r.topBar === '#0A0A0A', 'new topBar wins over legacy primaryDark');

// ── Malformed colours fall back to defaults (validation lives in resolveBrand)
r = resolve({ colors: { topBar: 'red', hero: '#GGGGGG', accent: '#123', titles: 42 } });
ok(r.topBar === DEFAULTS.topBar, 'named colour → default');
ok(r.hero === DEFAULTS.hero, 'non-hex chars → default');
ok(r.accent === DEFAULTS.accent, 'short hex → default');
ok(r.titles === DEFAULTS.titles, 'non-string → default');

// ── Non-colour brand fields still flow (proves the config shape is right) ────
const full = resolveBrand(buildRenderOpts({ brandName: 'Exclusively Travel', supportPhone: '0203 012 9623', colors: CUSTOM }));
ok(full.name === 'Exclusively Travel', 'brandName flows through');
ok(full.supportPhone === '0203 012 9623', 'supportPhone flows through');

// ── Header text contrast: light top bar must get dark text, not white ────────
// A client set a white/light top bar; the phone + email were hard-coded white
// and vanished. readableSet() chooses the text set from the background luminance.
// eslint-disable-next-line no-eval
const readableSet = eval('(' + ex(renderer, 'function readableSet(bgHex)') + ')');
ok(readableSet('#FFFFFF').ink === '#1F2937', 'white top bar → dark ink (the reported bug)');
ok(readableSet('#F5F7FA').ink === '#1F2937', 'near-white bar → dark ink');
ok(readableSet('#111D3E').ink === '#FFFFFF', 'default dark navy → white ink (unchanged)');
ok(readableSet('#1B2B5B').ink === '#FFFFFF', 'default hero navy → white ink (unchanged)');
ok(readableSet('nope').ink === '#FFFFFF', 'malformed → assume dark bg (no regression)');
ok(readableSet(undefined).ink === '#FFFFFF', 'missing → assume dark bg');
ok(readableSet('#FFFFFF').muted === '#475569' && readableSet('#FFFFFF').ref === '#64748B', 'light bar → dark muted + ref');
ok(readableSet('#111D3E').muted === '#C7D2E8' && readableSet('#111D3E').ref === '#9DB0D4', 'dark bar → pale muted + ref');

// ── Wiring guard: the template uses the contrast vars, not hard-coded white ───
ok(/\.brand-meta strong\{color:var\(--brand-ink\);\}/.test(renderer), 'brand-meta strong uses --brand-ink');
ok(!/\.brand-meta strong\{color:#fff;?\}/.test(renderer), 'old hard-coded white brand-meta strong is gone');
ok(/--brand-ink:\$\{topBarText\.ink\}/.test(renderer), 'top bar ink var injected from readableSet');
ok(/--hero-ink:\$\{heroText\.ink\}/.test(renderer), 'hero ink var injected from readableSet');

// ── Email sender name: the client's company, not the platform ────────────────
// The customer email must go FROM the client's company (configured brandName),
// falling back to the env sender name, then the generic default, only when a
// widget has no brand name (e.g. the demo).
// eslint-disable-next-line no-eval
const quoteFromName = eval('(' + ex(api, 'function quoteFromName(opts)') + ')');
const savedEnv = { q: process.env.QUOTE_PDF_FROM_NAME, s: process.env.SENDGRID_FROM_NAME_FALLBACK };
const setEnv = (q, s) => {
  if (q === undefined) delete process.env.QUOTE_PDF_FROM_NAME; else process.env.QUOTE_PDF_FROM_NAME = q;
  if (s === undefined) delete process.env.SENDGRID_FROM_NAME_FALLBACK; else process.env.SENDGRID_FROM_NAME_FALLBACK = s;
};

setEnv(undefined, undefined);
ok(quoteFromName({ brand: { name: 'Exclusively Travel' } }) === 'Exclusively Travel', 'configured brand name is the sender (the reported bug)');
ok(quoteFromName(undefined) === 'Travelgenix', 'no brand, no env → Travelgenix default');
ok(quoteFromName({ brand: { name: '   ' } }) === 'Travelgenix', 'blank brand name → default');
ok(quoteFromName({ brand: {} }) === 'Travelgenix', 'missing brand name → default');

setEnv('QP Sender', 'SG Fallback');
ok(quoteFromName({ brand: { name: 'Exclusively Travel' } }) === 'Exclusively Travel', 'brand name WINS over env override');
ok(quoteFromName(undefined) === 'QP Sender', 'no brand → QUOTE_PDF_FROM_NAME');

setEnv(undefined, 'SG Fallback');
ok(quoteFromName(undefined) === 'SG Fallback', 'no brand, no QP name → SENDGRID fallback');

setEnv(savedEnv.q, savedEnv.s); // restore

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
