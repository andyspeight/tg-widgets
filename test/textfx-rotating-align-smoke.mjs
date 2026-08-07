/**
 * Text FX — rotating-word alignment + letter spacing smoke test.
 *
 * Feedback (Andy, Aug 2026):
 *   1. The rotating word was always centred inside its (longest-word) box, so a
 *      left-aligned widget still floated short words in the middle. It should
 *      follow the overall alignment.
 *   2. Letter spacing should be adjustable to match site-editor text.
 *
 * Renders the widget in jsdom and checks the CSS variables it writes.
 *
 * Run: node test/textfx-rotating-align-smoke.mjs  (also: npm run test:textfx)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, '..', 'public', 'widget-textfx.js'), 'utf8');

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}

const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
// eslint-disable-next-line no-eval
window.eval(SRC);

function render(cfg) {
  const host = window.document.createElement('div');
  window.document.body.appendChild(host);
  const w = new window.TGTextFxWidget(host, Object.assign({ mode: 'rotating', respectReducedMotion: false }, cfg));
  const style = w.root.getAttribute('style') || '';
  const hasTrack = !!w.shadow.querySelector('.tgx-rot-track');
  try { w._teardown(); } catch (e) { /* noop */ }
  host.remove();
  return { style, hasTrack };
}

console.log('Rotating word follows the overall alignment');
{
  ok('left  -> flex-start', render({ align: 'left' }).style.indexOf('--tgx-rot-justify: flex-start') !== -1);
  ok('centre -> center', render({ align: 'center' }).style.indexOf('--tgx-rot-justify: center') !== -1);
  ok('right -> flex-end', render({ align: 'right' }).style.indexOf('--tgx-rot-justify: flex-end') !== -1);
  ok('a bad align value falls back to center', render({ align: 'nonsense' }).style.indexOf('--tgx-rot-justify: center') !== -1);
  ok('the rotating track is actually rendered', render({ align: 'left' }).hasTrack === true);
}

console.log('The CSS wires the track to the alignment variable');
{
  ok('track uses var(--tgx-rot-justify)', SRC.indexOf('justify-content: var(--tgx-rot-justify') !== -1);
}

console.log('Letter spacing is adjustable and clamped');
{
  ok('default keeps -0.020em', render({}).style.indexOf('--tgx-tracking: -0.020em') !== -1);
  ok('a wide value comes through', render({ letterSpacing: 0.2 }).style.indexOf('--tgx-tracking: 0.200em') !== -1);
  ok('a negative value comes through', render({ letterSpacing: -0.05 }).style.indexOf('--tgx-tracking: -0.050em') !== -1);
  ok('an absurd value is clamped to 1em', render({ letterSpacing: 9 }).style.indexOf('--tgx-tracking: 1.000em') !== -1);
  ok('a non-number falls back to -0.020em', render({ letterSpacing: 'wide' }).style.indexOf('--tgx-tracking: -0.020em') !== -1);
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
