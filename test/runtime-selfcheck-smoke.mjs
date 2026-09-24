/**
 * Node 24 and the preview-only runtime self-check (24 Sep 2026).
 *
 * Vercel stops building Node 20 on 1 October 2026. package.json now pins
 * Node 24, and the two functions that start Chromium (booking PDF, quote PDF)
 * answer `GET ?selfcheck=1` on PREVIEW deployments by drawing a PDF, so a new
 * runtime is proved on the real function before production. This checks the
 * pin, and that the self-check can never run anywhere but a preview.
 *
 * Run: node test/runtime-selfcheck-smoke.mjs   (npm run test:runtime-selfcheck)
 */
import { readFileSync } from 'node:fs';
import { selfCheckAllowed, runSteps, pdfPageCount } from '../api/_lib/runtime-selfcheck.js';

let passed = 0, failed = 0;
const ok = (name, cond, detail) => {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (detail ? '  — ' + detail : '')); }
};
const R = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

console.log('\nThe runtime\n');
const pkg = JSON.parse(R('package.json'));
ok('package.json pins Node 24 (Node 20 stops building on Vercel on 1 Oct 2026)', pkg.engines && pkg.engines.node === '24.x', JSON.stringify(pkg.engines));

console.log('\nThe self-check only ever runs on a preview\n');
const prev = process.env.VERCEL_ENV;
const req = (method, q) => ({ method, query: q, headers: {} });
process.env.VERCEL_ENV = 'preview';
ok('a preview answers GET ?selfcheck=1', selfCheckAllowed(req('GET', { selfcheck: '1' })));
ok('but not a POST', !selfCheckAllowed(req('POST', { selfcheck: '1' })));
ok('nor a GET without the flag', !selfCheckAllowed(req('GET', {})) && !selfCheckAllowed(req('GET', { selfcheck: 'yes' })));
process.env.VERCEL_ENV = 'production';
ok('production never runs it', !selfCheckAllowed(req('GET', { selfcheck: '1' })));
delete process.env.VERCEL_ENV;
ok('nor does anywhere without VERCEL_ENV', !selfCheckAllowed(req('GET', { selfcheck: '1' })));
if (prev !== undefined) process.env.VERCEL_ENV = prev;

console.log('\nThe steps\n');
const r = await runSteps([['one', async () => 1], ['two', async () => { throw new Error('boom'); }], ['three', async () => 3]]);
ok('a failing step fails the check and says why', r.ok === false && r.steps[1].error === 'boom');
ok('and the steps after it are skipped, not run', r.steps[2].skipped === true);
const { PDFDocument } = await import('pdf-lib');
const d = await PDFDocument.create(); d.addPage(); d.addPage();
ok('pages are counted from the PDF itself', (await pdfPageCount(await d.save())) === 2);

console.log('\nWired into the functions that start Chromium\n');
for (const f of ['api/booking-pdf.js', 'api/quote-pdf.js']) {
  const src = R(f);
  const at = src.indexOf('if (selfCheckAllowed(req))');
  ok(f + ': checked before the POST-only guard', at > 0 && at < src.indexOf("if (req.method !== 'POST')"));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
