/**
 * Smoke test for the Lovable React wrapper's mounting algorithm.
 *
 * The wrapper (lovable/TgWidget.tsx) is TSX, so rather than bundle React we port
 * its mount algorithm to vanilla JS here and run the IDENTICAL logic against the
 * real widget scripts served from ../public, in real Chromium. This validates
 * the three paths that matter:
 *
 *   A. First instance: host created before the script loads → the widget's own
 *      init() mounts it (works for every widget).
 *   B. Observer widget added AFTER its script is cached → self-mounts via the
 *      widget's MutationObserver, no re-init needed.
 *   C. Non-observer widget added AFTER its script is cached → does NOT self-mount;
 *      the wrapper re-runs init() with siblings "parked" so only the new host is
 *      picked up, and the already-mounted sibling is left intact.
 *
 * Run: node test/lovable-wrapper-smoke.mjs
 * If Playwright's bundled browser is absent, point at a Chromium build:
 *   TGS_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node test/lovable-wrapper-smoke.mjs
 */
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, '..', 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };

function serve(dir, port) {
  return new Promise((res) => {
    const s = http.createServer((req, rsp) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/' ) p = '/__blank.html';
      if (p === '/favicon.ico') { rsp.statusCode = 204; return rsp.end(); }
      if (p === '/__blank.html') {
        rsp.setHeader('Content-Type', 'text/html');
        return rsp.end('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');
      }
      const fp = path.join(dir, p);
      if (!fp.startsWith(dir) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) { rsp.statusCode = 404; return rsp.end('nf'); }
      rsp.setHeader('Content-Type', MIME[path.extname(fp)] || 'application/octet-stream');
      rsp.setHeader('Access-Control-Allow-Origin', '*');
      fs.createReadStream(fp).pipe(rsp);
    });
    s.listen(port, () => res(s));
  });
}

// Vanilla port of the wrapper's mount algorithm, injected into the page.
const WRAPPER_RUNTIME = `
const scripts = new Map();
function scriptSrc(type, baseUrl){ return baseUrl.replace(/\\/+$/,'') + '/widget-' + type + '.js'; }
function loadScript(type, baseUrl){
  const src = scriptSrc(type, baseUrl);
  const existing = scripts.get(src);
  if (existing) return existing;
  const entry = { promise: Promise.resolve(), loaded: false };
  entry.promise = new Promise((resolve) => {
    const el = document.createElement('script');
    el.src = src; el.async = true;
    el.addEventListener('load', () => { el.dataset.tgLoaded='true'; entry.loaded=true; resolve(); });
    el.addEventListener('error', () => resolve());
    document.head.appendChild(el);
  });
  scripts.set(src, entry);
  return entry;
}
function isMounted(host){ return !!host.shadowRoot || host.childElementCount > 0; }
function waitMounted(host, timeout){
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      if (isMounted(host)) return resolve(true);
      if (Date.now()-start >= timeout) return resolve(false);
      setTimeout(tick, 40);
    };
    tick();
  });
}
function reinitOnlyFor(host, type, baseUrl){
  const selector = '[data-tg-widget="'+type+'"]';
  const parked = [];
  document.querySelectorAll(selector).forEach((node) => {
    if (node !== host){ node.setAttribute('data-tg-widget-parked', type); node.removeAttribute('data-tg-widget'); parked.push(node); }
  });
  const unpark = () => parked.forEach((n)=>{ n.setAttribute('data-tg-widget', type); n.removeAttribute('data-tg-widget-parked'); });
  const el = document.createElement('script');
  el.src = scriptSrc(type, baseUrl); el.async = true;
  el.addEventListener('load', () => { unpark(); el.remove(); });
  el.addEventListener('error', () => { unpark(); el.remove(); });
  document.head.appendChild(el);
}
async function mount(container, type, config, baseUrl){
  const host = document.createElement('div');
  host.setAttribute('data-tg-widget', type);
  if (config) host.setAttribute('data-tg-config', JSON.stringify(config));
  container.appendChild(host);
  const entry = loadScript(type, baseUrl);
  await entry.promise;
  if (!entry.loaded) return host;
  const mounted = await waitMounted(host, 600);
  if (!mounted) reinitOnlyFor(host, type, baseUrl);
  await waitMounted(host, 600);
  return host;
}
window.__tgMount = mount;
`;

const PORT = 8123;
const BASE = `http://localhost:${PORT}`;
let passed = 0, failed = 0;
const ok = (cond, label) => { if (cond) { passed++; console.log('  PASS:', label); } else { failed++; console.error('  FAIL:', label); } };

const server = await serve(PUBLIC, PORT);
const executablePath = process.env.TGS_CHROMIUM || undefined;
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}/`, { waitUntil: 'load', timeout: 15000 });
  await page.addScriptTag({ content: WRAPPER_RUNTIME });

  // ── A. First instance of a non-observer widget mounts via host-first init ──
  const aMounted = await page.evaluate(async (base) => {
    const c = document.createElement('div'); c.id = 'a'; document.body.appendChild(c);
    const host = await window.__tgMount(c, 'countdown', { theme: 'light' }, base);
    return !!host.shadowRoot || host.childElementCount > 0;
  }, BASE);
  ok(aMounted, 'A: first non-observer widget (countdown) mounts on first load');

  // ── C. Second non-observer instance, added AFTER the script is cached ──
  // This is the path that fails without the wrapper. Also assert the first
  // instance is untouched (no double-mount / teardown).
  const cResult = await page.evaluate(async (base) => {
    const before = document.querySelector('#a > div');
    const beforeMounted = !!before.shadowRoot || before.childElementCount > 0;
    const c = document.createElement('div'); c.id = 'c'; document.body.appendChild(c);
    const host = await window.__tgMount(c, 'countdown', { theme: 'dark' }, base);
    const newMounted = !!host.shadowRoot || host.childElementCount > 0;
    const firstStillMounted = !!before.shadowRoot || before.childElementCount > 0;
    return { beforeMounted, newMounted, firstStillMounted };
  }, BASE);
  ok(cResult.beforeMounted, 'C: precondition — first instance was mounted');
  ok(cResult.newMounted, 'C: late-added non-observer instance mounts via re-init');
  ok(cResult.firstStillMounted, 'C: earlier instance left intact (no double-mount)');

  // ── B. Observer widget added AFTER its script is cached self-mounts ──
  // Load currency once (first instance), then add a second after caching.
  const bResult = await page.evaluate(async (base) => {
    const c1 = document.createElement('div'); c1.id = 'b1'; document.body.appendChild(c1);
    await window.__tgMount(c1, 'currency', { defaultFrom: 'GBP', defaultTo: 'EUR', defaultAmount: 100 }, base);
    const c2 = document.createElement('div'); c2.id = 'b2'; document.body.appendChild(c2);
    const host2 = await window.__tgMount(c2, 'currency', { defaultFrom: 'USD', defaultTo: 'EUR', defaultAmount: 50 }, base);
    return !!host2.shadowRoot || host2.childElementCount > 0;
  }, BASE);
  ok(bResult, 'B: late-added observer widget (currency) self-mounts');

  // No uncaught page errors from the mounting machinery.
  ok(errors.length === 0, 'no uncaught page errors during mounting' + (errors.length ? ' — ' + errors.join(' | ') : ''));
} finally {
  await browser.close();
  server.close();
}

console.log(`\nLovable wrapper smoke: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
