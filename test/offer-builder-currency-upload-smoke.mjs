/**
 * Offer builder feedback (Andrea via Andy, 10 Aug 2026):
 *   - Prices stayed in £ after the currency was switched to € in settings. The
 *     offer form is a separate Shadow DOM widget, so a currency change did not
 *     reach an already-open form. Fix: the builder gains a live update() that
 *     re-labels the price symbols in place (keeping edits), and the editor calls
 *     it when the currency setting changes while an offer is open.
 *   - Photo upload stuck on "Uploading…" forever. The upload awaited a CDN
 *     import of the Blob client and the upload itself with no timeout, so a
 *     stalled request on a locked-down network hung the UI. Fix: both steps are
 *     bounded (withTimeout + AbortController) and the UI always resets.
 *
 * Source guards; the currency flip was also verified live in a real browser
 * (£→€ on update()). Run: node test/offer-builder-currency-upload-smoke.mjs
 * (also: npm run test:offer-builder-currency-upload)
 */
import { readFileSync } from 'node:fs';

const b = readFileSync(new URL('../public/widget-offer-builder.js', import.meta.url), 'utf8');
const ed = readFileSync(new URL('../public/editor-offer-builder.html', import.meta.url), 'utf8');

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };

console.log('Currency change reaches an open offer form');
{
  ok('builder exposes update(patch)', /\bupdate\(patch\) \{/.test(b));
  ok('update() merges the patch into cfg', /Object\.assign\(this\.cfg, patch\);/.test(b));
  ok('update() re-labels the price symbols in place',
    /'currency' in patch[\s\S]{0,200}?\.ob-prefix \.sym[\s\S]{0,80}?el\.textContent = sym/.test(b));
  ok('editor calls builder.update on a currency change while a form is open',
    /if \(k === 'currency' && builder && !\$\('formView'\)\.hidden\) builder\.update\(\{ currency: e\.target\.value \}\);/.test(ed));
  ok('currency still persists (getConfig returns the whole config)',
    /getConfig: \(\) => JSON\.parse\(JSON\.stringify\(state\.config\)\)/.test(ed));
}

console.log('Photo upload can never hang');
{
  ok('a withTimeout helper exists', /function withTimeout\(promise, ms, label\)/.test(b));
  ok('the Blob-client CDN import is time-bounded', /withTimeout\(getBlobClient\(\), 15000/.test(b));
  ok('the upload itself is time-bounded', /withTimeout\(mod\.upload\(pathname, file, opts\), 60000/.test(b));
  ok('the upload is also abortable', /new AbortController\(\)/.test(b) && /opts\.abortSignal = ctrl\.signal/.test(b));
  ok('the timeout timer is always cleared (finally)', /\} finally \{\s*clearTimeout\(killer\);/.test(b));
  // The "Uploading…" state is set then reset regardless of outcome.
  ok('the Uploading state is set and reset', /drop\.textContent = 'Uploading…'/.test(b) && /drop\.classList\.remove\('busy'\); drop\.innerHTML = original;/.test(b));
  ok('a clear fallback message points at the URL option on failure',
    /paste an image URL instead/.test(b));
}

console.log('Version bumped');
{
  const vm = b.match(/VERSION = '(\d+)\.(\d+)\.(\d+)'/);
  ok('builder version >= 0.2.0', vm && (+vm[1] > 0 || (+vm[1] === 0 && +vm[2] >= 2)));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
