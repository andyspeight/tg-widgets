/**
 * AI prompt coaching helper (tgse.wireAiPrompt) — the friendly front line that
 * stops thin "sidney faq" prompts reaching the paid endpoint, and coaches the
 * client toward a usable description. Extracts the REAL function from
 * public/editor-shell.js and drives it against a jsdom DOM, then source-guards
 * the wiring across every business-description editor.
 *
 * Run: node test/ai-prompt-coach-smoke.mjs
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

const shellSrc = readFileSync(new URL('../public/editor-shell.js', import.meta.url), 'utf8');

// Extract the real wireAiPrompt function body (balanced-brace slice that
// skips strings AND comments — apostrophes live inside // comments here).
function extractFn(src, signature) {
  const at = src.indexOf(signature);
  if (at === -1) throw new Error('not found: ' + signature);
  let i = src.indexOf('{', at), depth = 0, str = null, line = false, block = false;
  for (; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (line) { if (c === '\n') line = false; continue; }
    if (block) { if (c === '*' && n === '/') { block = false; i++; } continue; }
    if (str) { if (c === str && src[i - 1] !== '\\') str = null; continue; }
    if (c === '/' && n === '/') { line = true; i++; continue; }
    if (c === '/' && n === '*') { block = true; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { str = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(at, i + 1); }
  }
  throw new Error('unbalanced: ' + signature);
}
const wireSrc = extractFn(shellSrc, 'function wireAiPrompt(opts)');

const dom = new JSDOM('<!doctype html><body><div class="field"><textarea id="ai-prompt"></textarea></div><button id="ai-go">Generate</button><div id="hint"></div></body>');
const { document } = dom.window;
global.document = document;
const wireAiPrompt = new Function(`${wireSrc}; return wireAiPrompt;`)();

const ta = document.getElementById('ai-prompt');
const btn = document.getElementById('ai-go');
const hint = document.getElementById('hint');
const setVal = (v) => { ta.value = v; ta.dispatchEvent(new dom.window.Event('input')); };

const api = wireAiPrompt({ textarea: '#ai-prompt', button: '#ai-go', hintEl: '#hint', minChars: 30, minWords: 5 });

// Empty on open
ok(btn.disabled === true, 'empty description → Generate disabled on open');
ok(!!document.querySelector('[data-tgse-ai-checklist]'), 'checklist rendered under the field');
ok(/who you are/.test(document.querySelector('[data-tgse-ai-checklist]').textContent), 'checklist names the three things');

// The reported junk
setVal('sidney faq');
ok(btn.disabled === true && api.isReady() === false, '"sidney faq" → still disabled (10 chars / 2 words)');
ok(/more detail/.test(hint.textContent), 'live hint coaches the client while too thin');

// A thin-but-longer string that fails the WORD floor
setVal('travelagencytravelagencytravelagency');
ok(btn.disabled === true, 'long single run of characters (1 word) still blocked by the word floor');

// A substantive description
setVal('We are Free From Travel, an ABTA agency in Bristol arranging allergy-friendly family holidays.');
ok(btn.disabled === false && api.isReady() === true, 'a real description → Generate enabled');
ok(hint.textContent === '', 'hint clears when the description is good');

// Capture-phase guard blocks a click even if something re-enabled the button
setVal('too short');
btn.disabled = false; // simulate an editor's finally-block re-enable
let reached = false;
btn.addEventListener('click', () => { reached = true; });
btn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
ok(reached === false, 'capture-phase guard swallows a generate click while the description is thin');

// The checklist renders only once across repeated wiring
wireAiPrompt({ textarea: '#ai-prompt', button: '#ai-go' });
ok(document.querySelectorAll('[data-tgse-ai-checklist]').length === 1, 're-wiring does not duplicate the checklist');

// ── Source guards: shell exports it, editors wire it, floors corrected ───────
ok(/wireAiPrompt,/.test(shellSrc) && /version: '1\.3/.test(shellSrc), 'shell exports wireAiPrompt and bumps its version');

const wired = {
  'editor-faq.html':       /tgse\.wireAiPrompt\(/,
  'editor-weather.html':   /tgse\.wireAiPrompt\(\{ textarea: '#aiPrompt', button: '#aiGenerate'/,
  'editor-countdown.html': /tgse\.wireAiPrompt\(\{[\s\S]*?button: '#aiGenerateBtn'/,
  'editor-spotlight.html': /tgse\.wireAiPrompt\(\{ textarea: '#aiPrompt', button: '#aiGenerate'/,
};
for (const [file, re] of Object.entries(wired)) {
  ok(re.test(readFileSync(new URL(`../public/${file}`, import.meta.url), 'utf8')), `${file} wires the coaching helper`);
}

const apiSrc = readFileSync(new URL('../api/widget-ai.js', import.meta.url), 'utf8');
ok(/WEATHER:\s*\{ chars: 30, words: 5, kind: 'business' \}/.test(apiSrc), 'server: Weather carries the full business floor (it themes FROM the business)');
ok(/buildAccountContext/.test(apiSrc) && /account_context/.test(apiSrc), 'server: account grounding present');
ok(/aiCacheGet\(cacheKey\)/.test(apiSrc) && /aiCacheSet\(cacheKey/.test(apiSrc), 'server: identical-retry dedupe present');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
