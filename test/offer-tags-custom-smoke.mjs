/**
 * Special Offer builder — Tags accept custom text (Andrea, Aug 2026).
 *
 * Tags used to be a fixed grid of toggle chips: you could only pick from the
 * preset list. They are now the same free-text pill list as promos and
 * includes, with the presets offered as one-tap suggestions, so the author can
 * add their own tags as well as the presets. Promos were already free-text.
 *
 * Source-guards the control + functionally round-trips a preset tag, a custom
 * tag and a reopen through the real builder.
 *
 * Run: node test/offer-tags-custom-smoke.mjs   (npm run test:offer-tags-custom)
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const BUILDER = readFileSync(new URL('../public/widget-offer-builder.js', import.meta.url), 'utf8');

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };

console.log('Tags are a free-text pill list, not a fixed toggle grid');
{
  ok('a tags pill group is rendered', /data-list="tags"[\s\S]*?data-pills="tags"/.test(BUILDER));
  ok('the pill machinery keys tags to this._tags', /key === 'tags' \? '_tags'/.test(BUILDER));
  ok('the old toggle-chip tags UI is gone', !/ob-toggle/.test(BUILDER));
  ok('tags collect from the pill list', /offer\.tags = \(this\._tags \|\| \[\]\)\.slice\(\)/.test(BUILDER));
  ok('tags prefill into the pill list', /this\._tags = Array\.isArray\(offer\.tags\)/.test(BUILDER));
}

console.log('A preset tag, a custom tag and a reopen all round-trip');
{
  const { window } = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'dangerously', pretendToBeVisual: true });
  const s = window.document.createElement('script'); s.textContent = BUILDER; window.document.body.appendChild(s);
  const mk = () => { const d = window.document.createElement('div'); window.document.body.appendChild(d); return new window.TGOfferBuilderWidget(d, { currency: 'GBP' }); };

  const b = mk();
  const group = b.root.querySelector('.ob-pillgroup[data-list="tags"]');
  ok('the tags pill group is present in the DOM', !!group);
  ok('preset tags are offered as suggestions (Family friendly)',
    !!b.root.querySelector('.ob-pillgroup[data-list="tags"] .ob-chip-suggest[data-suggest="Family friendly"]'));

  // Add a preset via its suggestion chip, then a custom one via the input.
  b.root.querySelector('.ob-pillgroup[data-list="tags"] .ob-chip-suggest[data-suggest="Family friendly"]').click();
  const inp = b.root.querySelector('.ob-pillgroup[data-list="tags"] .ob-pill-input');
  inp.value = 'River Cruise Specialist';
  b.root.querySelector('.ob-pillgroup[data-list="tags"] .ob-pill-go').click();

  const tags = b._collect().tags;
  ok('a preset tag is collected', Array.isArray(tags) && tags.indexOf('Family friendly') !== -1);
  ok('a custom typed tag is collected', tags.indexOf('River Cruise Specialist') !== -1);

  // Reopen an offer carrying a preset + a custom tag → both restore as pills.
  const b2 = mk();
  b2._prefillOffer({ fields: { title: 'X' }, tags: ['Adults only', 'Wheelchair friendly'] });
  const restored = b2._collect().tags;
  ok('a saved preset tag reopens', restored.indexOf('Adults only') !== -1);
  ok('a saved custom tag reopens', restored.indexOf('Wheelchair friendly') !== -1);
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
