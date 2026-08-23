/**
 * Measures what a published page does in a real browser.
 *
 *   node tools/build-perf-page.mjs && node tools/verify-perf.mjs
 *   node tools/verify-perf.mjs --save-baseline
 *
 * WHAT THIS IS FOR. We want to be able to quote numbers, and a number nobody can
 * reproduce is a claim. This serves the real renderer's output with the real
 * stylesheet, throttles a real Chromium to the profile Lighthouse uses for
 * mobile, and reports the same things Lighthouse reports: when the first and
 * largest paints land, whether anything shifts, what was downloaded, and how
 * much of the stylesheet the page actually used.
 *
 * WHAT IT CANNOT SEE, AND THIS MATTERS WHEN QUOTING IT. There is no server here,
 * so there is no time to first byte, no cache header and no database. Everything
 * below starts from a first byte that arrives instantly, which the real site's
 * never will. So these numbers are a FLOOR: the real page cannot beat them, and
 * the gap between them and PageSpeed Insights on the live site IS the server
 * cost. Never quote a number from this file as a site score.
 *
 * THE THROTTLING IS APPLIED, NOT SIMULATED. Lighthouse observes a fast load and
 * models a slow one. This actually slows the transport and the CPU, so the two
 * are not directly comparable and this one is generally the harsher of the pair.
 * That is the right direction for a regression gate.
 */

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const outDir = resolve(root, 'perf/out');
const baselineFile = resolve(root, 'perf/baseline.json');

const saveBaseline = process.argv.includes('--save-baseline');

/* Lighthouse's mobile profile: slow 4G and a four times slower CPU. */
const NETWORK = { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 };
const CPU_SLOWDOWN = 4;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};
const COMPRESSIBLE = new Set(['.html', '.css', '.js']);

/* Gzip for text, exactly as a CDN would, because the CSS number is the point. */
function serve() {
  const server = createServer(async (req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    const file = resolve(outDir, path.replace(/^\//, '') || 'designed.html');
    if (!file.startsWith(outDir)) { res.writeHead(403).end(); return; }
    try {
      const body = await readFile(file);
      const ext = extname(file);
      const headers = { 'Content-Type': TYPES[ext] ?? 'application/octet-stream', 'Cache-Control': 'no-store' };
      if (COMPRESSIBLE.has(ext)) {
        const gz = gzipSync(body, { level: 9 });
        res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', 'Content-Length': gz.length }).end(gz);
      } else {
        res.writeHead(200, { ...headers, 'Content-Length': body.length }).end(body);
      }
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

/* Collected in the page: the three metrics a client would be quoted. */
const COLLECT = `() => new Promise((done) => {
  const out = { fcp: null, lcp: null, cls: 0, lcpElement: null, lcpUrl: null };

  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') out.fcp = e.startTime;
  }).observe({ type: 'paint', buffered: true });

  new PerformanceObserver((l) => {
    const es = l.getEntries();
    const last = es[es.length - 1];
    if (!last) return;
    out.lcp = last.startTime;
    out.lcpUrl = last.url || null;
    out.lcpElement = last.element ? last.element.tagName.toLowerCase() + (last.element.className ? '.' + String(last.element.className).split(' ')[0] : '') : null;
  }).observe({ type: 'largest-contentful-paint', buffered: true });

  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) if (!e.hadRecentInput) out.cls += e.value;
  }).observe({ type: 'layout-shift', buffered: true });

  // Settle: LCP can still change until interaction or a quiet period.
  setTimeout(() => done(out), 2500);
})`;

async function measure(server, profile) {
  const port = server.address().port;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();

  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', NETWORK);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_SLOWDOWN });

  const requests = [];
  page.on('response', async (r) => {
    const sizes = await r.request().sizes().catch(() => null);
    requests.push({
      url: new URL(r.url()).pathname,
      type: r.request().resourceType(),
      transfer: sizes ? sizes.responseBodySize + sizes.responseHeadersSize : 0,
    });
  });

  await page.coverage.startCSSCoverage();
  await page.goto(`http://127.0.0.1:${port}/${profile}.html`, { waitUntil: 'load', timeout: 120_000 });
  /*
   * Self-invoked. Passing a bare function source to evaluate() returns the
   * function rather than calling it, and the result comes back undefined.
   */
  const metrics = await page.evaluate(`(${COLLECT})()`);
  const coverage = await page.coverage.stopCSSCoverage();

  const css = coverage.find((c) => c.url.endsWith('globals.css'));
  const cssUsed = css ? css.ranges.reduce((n, r) => n + (r.end - r.start), 0) : 0;
  const cssTotal = css ? css.text.length : 0;

  await browser.close();

  const byType = {};
  for (const r of requests) byType[r.type] = (byType[r.type] ?? 0) + r.transfer;

  return {
    profile,
    fcp: metrics.fcp,
    lcp: metrics.lcp,
    cls: metrics.cls,
    lcpElement: metrics.lcpElement,
    lcpUrl: metrics.lcpUrl ? new URL(metrics.lcpUrl).pathname : null,
    requests: requests.length,
    transferByType: byType,
    transferTotal: Object.values(byType).reduce((a, b) => a + b, 0),
    cssTotalBytes: cssTotal,
    cssUsedBytes: cssUsed,
    cssUnusedPct: cssTotal ? Math.round(((cssTotal - cssUsed) / cssTotal) * 1000) / 10 : 0,
  };
}

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const ms = (n) => (n == null ? 'n/a' : `${Math.round(n)} ms`);

try {
  await stat(resolve(outDir, 'designed.html'));
} catch {
  console.error('perf/out is missing. Run: node tools/build-perf-page.mjs');
  process.exit(1);
}

const server = await serve();
const results = [];
for (const profile of ['designed', 'native']) results.push(await measure(server, profile));
server.close();

let baseline = null;
try { baseline = JSON.parse(await readFile(baselineFile, 'utf8')); } catch { /* none yet */ }

console.log('\n  Applied throttling: slow 4G (150 ms RTT, 1.6 Mbps), CPU 4x, 390px mobile');
console.log('  No server in this harness, so no TTFB. These are a floor, not a site score.\n');

for (const r of results) {
  const was = baseline?.find?.((b) => b.profile === r.profile);
  const d = (now, then, unit) =>
    was && then != null && now != null
      ? ` (was ${unit(then)}, ${now - then >= 0 ? '+' : ''}${unit === ms ? Math.round(now - then) + ' ms' : ((now - then) / 1024).toFixed(1) + ' KB'})`
      : '';

  console.log(`  ${r.profile}`);
  console.log(`    FCP                ${ms(r.fcp)}${d(r.fcp, was?.fcp, ms)}`);
  console.log(`    LCP                ${ms(r.lcp)}${d(r.lcp, was?.lcp, ms)}   <- ${r.lcpElement ?? 'unknown'}${r.lcpUrl ? ' ' + r.lcpUrl : ''}`);
  console.log(`    CLS                ${r.cls.toFixed(4)}${was ? ` (was ${was.cls.toFixed(4)})` : ''}`);
  console.log(`    Requests           ${r.requests}`);
  console.log(`    Transferred        ${kb(r.transferTotal)}${d(r.transferTotal, was?.transferTotal, kb)}`);
  for (const [t, n] of Object.entries(r.transferByType).sort((a, b) => b[1] - a[1])) {
    console.log(`      ${t.padEnd(16)} ${kb(n)}`);
  }
  console.log(`    globals.css        ${kb(r.cssUsedBytes)} used of ${kb(r.cssTotalBytes)}, ${r.cssUnusedPct}% unused${was ? ` (was ${was.cssUnusedPct}%)` : ''}`);
  console.log('');
}

if (saveBaseline) {
  await writeFile(baselineFile, JSON.stringify(results, null, 2) + '\n', 'utf8');
  console.log(`  Baseline written to perf/baseline.json\n`);
} else if (!baseline) {
  console.log('  No baseline yet. Run with --save-baseline to record one.\n');
}
