/**
 * Event widgets — Book buttons restyled + a Book-button text colour setting
 * (client feedback, Aug 2026).
 *
 * The Book buttons were flat and unappealing. They now carry an accent-tinted
 * drop shadow, a hover lift and bolder text across the whole family, and each
 * widget gains a `bookTextColor` setting so the agent can pick the button text
 * colour (drives --<prefix>-on-accent; default keeps the current dark).
 *
 * Source-level guard across all five listing widgets + their editors, plus a
 * functional check that a chosen colour actually reaches the rendered CSS.
 *
 * Run: node test/event-book-button-smoke.mjs   (npm run test:event-book-button)
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

const WIDGETS = [
  ['clubpicker', 'cp'], ['tickets', 'tk'], ['nextevent', 'ne'], ['ticketsearch', 'ts'], ['ticketmonth', 'tm'],
];

console.log('Every listing widget restyles the Book button and drives its text colour from config');
for (const [name, px] of WIDGETS) {
  const src = read('../public/widget-' + name + '.js');
  ok(name + ': reads bookTextColor via safeColour', new RegExp('safeColour\\(cfg\\.bookTextColor').test(src));
  ok(name + ': the on-accent token is driven by the setting', new RegExp('--tg' + px + '-on-accent:\' \\+ btnText').test(src));
  ok(name + ': Book button lifts on hover (restyle)', new RegExp('\\.tg' + px + '-btn:hover\\{transform:translateY\\(-1px\\)').test(src));
  ok(name + ': Book button has an accent-tinted shadow', new RegExp('\\.tg' + px + '-btn\\{[^}]*box-shadow:0 2px').test(src.replace(/\n\s*\+\s*'/g, '')));
}

console.log('Every editor exposes a Book-button-text colour picker, wired');
for (const [name] of WIDGETS) {
  const src = read('../public/editor-' + name + '.html');
  ok(name + ' editor: has the f-btntext colour control', /id="f-btntext-swatch"/.test(src) && /id="f-btntext"/.test(src));
  ok(name + ' editor: wires it to bookTextColor', /c\.colour\('f-btntext-swatch', 'f-btntext', 'bookTextColor'\)/.test(src));
  ok(name + ' editor: syncs it', /c\.colourSync\('f-btntext-swatch', 'f-btntext', C\.bookTextColor\)/.test(src));
  ok(name + ' editor: has a bookTextColor default', /bookTextColor: '#04212B'/.test(src));
}

console.log('A chosen Book-button text colour reaches the rendered CSS');
{
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom;
  window.fetch = async () => ({ ok: true, json: async () => ({ items: [], events: [] }) });
  const s = window.document.createElement('script'); s.textContent = read('../public/widget-clubpicker.js'); window.document.body.appendChild(s);
  const el = window.document.createElement('div'); window.document.body.appendChild(el);
  const w = new window.TGClubPickerWidget(el, { bookTextColor: '#ffffff' });
  ok('a set colour is injected as --tgcp-on-accent', w.shadow.innerHTML.includes('--tgcp-on-accent:#ffffff'));

  const el2 = window.document.createElement('div'); window.document.body.appendChild(el2);
  const w2 = new window.TGClubPickerWidget(el2, {});
  ok('the default keeps the built-in dark on-accent', w2.shadow.innerHTML.includes('--tgcp-on-accent:#04212B'));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
