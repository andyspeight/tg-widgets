/**
 * Special Offer builder — the save/reopen round-trip keeps what you entered
 * (Andy, Aug 2026). Three data-loss bugs on reopening a saved offer:
 *
 *   1. CURRENCY reverted to £. The editor reopened the builder with the
 *      editor-wide currency (default GBP), not the offer's OWN saved currency,
 *      and _prefillOffer never restored it — so a €/$ offer came back as £ and,
 *      re-saved, was silently rewritten to £.
 *   2. A saved IMAGE url of 600-1000 chars was dropped on reopen: the client
 *      safePhotoUrl cap (600) was tighter than the server's persisted cap
 *      (1000), so a valid saved photo vanished. The caps now match.
 *
 * Source-guards each fix. A jsdom functional round-trip lives alongside in the
 * dev check; this file is the CI guard (no jsdom needed).
 *
 * Run: node test/offer-roundtrip-smoke.mjs  (npm run test:offer-roundtrip)
 */
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const EDITOR = read('public/editor-offer-builder.html');
const BUILDER = read('public/widget-offer-builder.js');

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };

console.log('Currency round-trips (no more reverting to £)');
{
  ok('the editor reopens an offer in its OWN saved currency',
    /currency: \(offer && offer\.currency\) \|\| c\.currency/.test(EDITOR));
  ok('_prefillOffer restores the offer currency onto cfg',
    /if \(offer\.currency\) \{\s*this\.cfg\.currency = offer\.currency;/.test(BUILDER));
  ok('_prefillOffer refreshes the £/€/$ prefix symbols',
    /currencySymbol\(offer\.currency\)[\s\S]*?\.ob-prefix \.sym[\s\S]*?el\.textContent = sym/.test(BUILDER));
}

console.log('A saved image url is not dropped on reopen (client cap matches the server)');
{
  ok('safePhotoUrl caps at 1000, matching strArr(s.images, 20, 1000)', /if \(u\.length > 1000\) return '';/.test(BUILDER));
  ok('the old 600-char client cap is gone', !/u\.length > 600/.test(BUILDER));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
