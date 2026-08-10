/**
 * Text FX — rotating words must not stack on first load (Andy, 10 Aug 2026).
 *
 * Bug: on first load the rotating effect stacked every word on top of each
 * other. Root cause: renderWord() only cleaned up a previous word when it had
 * `.is-active`, and `.is-active` is added inside a requestAnimationFrame. A
 * backgrounded tab (or a tab that is not foreground while the page loads)
 * pauses rAF but keeps firing the setTimeout-driven cycle, so word after word
 * was appended with none ever activated and none ever cleaned up. The instant
 * the tab refocused, the queued frames flushed and activated all of them at
 * once — every absolutely-positioned word visible together, stacked.
 *
 * Fix: cleanup transitions out EVERY current word regardless of activation
 * state, so the track can never hold more than the active + a leaving word.
 * A CSS default of opacity:0 (only .is-active is opacity:1) is the belt-and-
 * braces layer so a word can never paint before it is activated.
 *
 * Source guards over public/widget-textfx.js (jsdom is a CI-only devDep).
 *
 * Run: node test/textfx-rotating-nostack-smoke.mjs  (also: npm run test:textfx-nostack)
 */
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../public/widget-textfx.js', import.meta.url), 'utf8');

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };

// Isolate the rotating render so guards can't be satisfied by unrelated code.
const rotStart = SRC.indexOf('_renderRotating()');
const rotEnd = SRC.indexOf('// ---------- Counter', rotStart);
const rot = SRC.slice(rotStart, rotEnd);
ok('found the _renderRotating body', rotStart !== -1 && rotEnd !== -1 && rot.length > 200);

console.log('Cleanup does not depend on .is-active (the accumulation bug)');
{
  // The gate that caused the bug must be gone from the rotating render.
  ok('no `if (...contains(\'is-active\'))` guard around cleanup',
    !/if\s*\(\s*w\.classList\.contains\(\s*['"]is-active['"]\s*\)\s*\)/.test(rot));
  // Every existing word is transitioned out unconditionally.
  ok('existing words are all marked leaving each cycle',
    /existing\.forEach\(\s*w\s*=>\s*\{[\s\S]{0,160}?w\.classList\.remove\(\s*['"]is-active['"]\s*\);[\s\S]{0,80}?w\.classList\.add\(\s*['"]is-leaving['"]\s*\);/.test(rot));
  // ...and removed after the transition.
  ok('leaving words are removed after the transition',
    /setTimeout\(\s*\(\)\s*=>\s*\{\s*if\s*\(w\.parentNode\)\s*w\.parentNode\.removeChild\(w\);\s*\}\s*,\s*600\s*\)/.test(rot));
  // Intent is documented so nobody re-adds the gate.
  ok('the reason is documented in a comment',
    /backgrounded tab|requestAnimationFrame/i.test(rot));
}

console.log('CSS keeps a rotating word hidden until it is active (defense)');
{
  const wordBlock = SRC.slice(SRC.indexOf('.tgx-rot-word {'), SRC.indexOf('.tgx-rot-word.is-active'));
  ok('.tgx-rot-word defaults to opacity: 0', /opacity:\s*0;/.test(wordBlock));
  ok('.tgx-rot-word.is-active raises opacity to 1', /\.tgx-rot-word\.is-active\s*\{\s*opacity:\s*1;\s*\}/.test(SRC));
}

console.log('Version bumped for the fix');
{
  const vm = SRC.match(/const VERSION = '(\d+)\.(\d+)\.(\d+)'/);
  const atLeast = vm && (+vm[1] > 1 || (+vm[1] === 1 && (+vm[2] > 0 || (+vm[2] === 0 && +vm[3] >= 4))));
  ok('VERSION is at or beyond 1.0.4', !!atLeast);
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
