/**
 * Special Offer builder — Holiday style is a datalist input: pick a preset,
 * type your own, or leave it blank (Andrea, Aug 2026).
 *
 * It used to be a fixed dropdown that always forced one of the eight presets.
 * Now it is a text input backed by a datalist of those presets, so the author
 * can also enter custom text or leave it empty for no style at all. The card
 * already drops an empty style (it filters the eyebrow and hides the cruise
 * "luxury" ribbon), so blank simply shows nothing.
 *
 * Source-guards the control and functionally round-trips a preset, a custom
 * value and a blank through the real builder.
 *
 * Run: node test/offer-style-custom-smoke.mjs   (npm run test:offer-style-custom)
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const BUILDER = readFileSync(new URL('../public/widget-offer-builder.js', import.meta.url), 'utf8');

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };

console.log('The style control is a datalist input, not a fixed dropdown');
{
  ok('style is a text input bound to a datalist', /<input type="text" data-key="style" list="ob-styles"/.test(BUILDER));
  ok('the presets are offered as datalist options', /<datalist id="ob-styles">/.test(BUILDER));
  ok('style is no longer a plain select', !/select\('style',/.test(BUILDER));
}

console.log('A preset, a custom value and a blank all round-trip through _collect');
{
  const { window } = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'dangerously', pretendToBeVisual: true });
  const s = window.document.createElement('script'); s.textContent = BUILDER; window.document.body.appendChild(s);
  const mk = () => { const d = window.document.createElement('div'); window.document.body.appendChild(d); return new window.TGOfferBuilderWidget(d, { currency: 'GBP' }); };
  const setStyle = (b, v) => { const el = b.root.querySelector('[data-key="style"]'); el.value = v; el.dispatchEvent(new window.Event('input')); };

  const b = mk();
  const styleEl = b.root.querySelector('[data-key="style"]');
  ok('the style control renders as an <input>', styleEl && styleEl.tagName === 'INPUT');
  ok('a datalist of presets is present with All inclusive + Luxury',
    !!b.root.querySelector('datalist#ob-styles option[value="All inclusive"]') && !!b.root.querySelector('datalist#ob-styles option[value="Luxury"]'));

  setStyle(b, 'Luxury');
  ok('a preset is collected as the style', b._collect().fields.style === 'Luxury');

  setStyle(b, 'Winter Sun Escapes');
  ok('a custom typed value is collected as the style', b._collect().fields.style === 'Winter Sun Escapes');

  setStyle(b, '');
  ok('a blank style is collected as no style (offer carries no style field)', !('style' in b._collect().fields));

  // Reopening an offer with a custom style must repopulate the input.
  const b2 = mk();
  b2._prefillOffer({ fields: { title: 'X', style: 'Winter Sun Escapes' } });
  ok('a saved custom style reopens in the input', b2.root.querySelector('[data-key="style"]').value === 'Winter Sun Escapes');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
