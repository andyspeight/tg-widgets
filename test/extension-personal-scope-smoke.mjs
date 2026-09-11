/**
 * The scheduler panel asks only for ITS OWN schedulers (11 Sep 2026).
 *
 * "Jess has now installed version 3 and it is STILL showing my meetings and i
 * can see hers in my original version."
 *
 * Three releases had gone into the Coming up diary. The panel OPENS on its
 * Meetings tab, and that tab asked /api/widget-list with no scope, which
 * returns every widget in the CLIENT. Two people in one agency account each
 * saw the other's schedulers on the first screen the panel shows. Symmetric,
 * which is what was described both ways round, and nothing in the calendar work
 * could ever have touched it.
 *
 * This loads the REAL extension into a real Chromium and watches what its panel
 * actually puts on the wire, because the last three fixes were reasoned about
 * rather than observed. It checks two things that must both hold:
 *
 *   1. the panel asks for ?scope=self, and makes no unscoped call at all;
 *   2. the request carries Sec-Fetch-Site: none and no Origin or Referer.
 *
 * (2) is what lets the SERVER recognise the extension and scope a copy that was
 * installed before this build, which mattered because three updates had already
 * been handed out. Chrome sends no Origin for an extension fetch to a host it
 * holds permission for, so Sec-Fetch-Site is the only marker available, and it
 * is one the browser sets and page script cannot forge.
 *
 * Run: TGS_CHROMIUM=/opt/pw-browsers/chromium node test/extension-personal-scope-smoke.mjs
 *      (npm run test:extension-personal-scope)
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, '..', 'extension', 'scheduler-companion');
const PORT = 8312;

let passed = 0, failed = 0;
const ok = (label, cond, detail) => {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.error('  ✗ ' + label + (detail ? '\n      ' + detail : '')); }
};

// A copy of the real extension pointed at a local stand-in for our API, and
// granted permission for it exactly as it holds permission for our hosts.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-ext-'));
const EXT = path.join(dir, 'ext');
fs.cpSync(SRC, EXT, { recursive: true });
{
  const p = path.join(EXT, 'panel.js');
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8')
    .replace("const API = 'https://widgets.travelify.io';", `const API = 'http://localhost:${PORT}';`));
  const mp = path.join(EXT, 'manifest.json');
  const m = JSON.parse(fs.readFileSync(mp, 'utf8'));
  m.host_permissions = [`http://localhost:${PORT}/*`].concat(m.host_permissions || []);
  fs.writeFileSync(mp, JSON.stringify(m, null, 2));
}

const seen = [];
const server = await new Promise((res) => {
  const s = http.createServer((req, rsp) => {
    seen.push({ url: req.url, headers: Object.assign({}, req.headers) });
    rsp.setHeader('Content-Type', 'application/json');
    rsp.setHeader('Access-Control-Allow-Origin', '*');
    if (req.url.startsWith('/api/auth/me')) return rsp.end(JSON.stringify({ email: 'jess@example.com', fullName: 'Jess' }));
    if (req.url.startsWith('/api/widget-list')) return rsp.end('[]');
    rsp.end('{"ok":true}');
  });
  s.listen(PORT, () => res(s));
});

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-prof-'));
const ctx = await chromium.launchPersistentContext(userDataDir, {
  executablePath: process.env.TGS_CHROMIUM || '/opt/pw-browsers/chromium',
  headless: false,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--headless=new',
    `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});

try {
  await new Promise((r) => setTimeout(r, 2500));
  let extId = '';
  for (const w of ctx.serviceWorkers()) {
    const m = w.url().match(/^chrome-extension:\/\/([a-p]+)\//);
    if (m) extId = m[1];
  }
  ok('the real extension loads', !!extId, 'no service worker found');

  if (extId) {
    const page = await ctx.newPage();
    await page.goto(`chrome-extension://${extId}/panel.html`).catch(() => {});
    await new Promise((r) => setTimeout(r, 2500));
  }

  const lists = seen.filter((r) => r.url.startsWith('/api/widget-list'));
  ok('the panel asked for the widget list', lists.length > 0, 'it made no call at all');

  console.log('What it asked for');
  ok('every widget-list call is scoped to the caller',
    lists.length > 0 && lists.every((r) => /[?&]scope=self(&|$)/.test(r.url)),
    lists.map((r) => r.url).join(' | '));
  ok('it makes no unscoped call alongside it',
    !lists.some((r) => !/[?&]scope=/.test(r.url)),
    lists.map((r) => r.url).join(' | ') + ' — an unscoped call returns the whole agency');
  ok('it asks once, not twice', lists.length === 1, String(lists.length));

  console.log('What the server can tell about the caller');
  const h = (lists[0] || {}).headers || {};
  ok('Chrome sends no Origin for an extension fetch (so Origin cannot identify it)',
    h.origin === undefined, String(h.origin));
  ok('and no Referer either', h.referer === undefined, String(h.referer));
  ok('Sec-Fetch-Site is "none", which is the marker the server uses',
    String(h['sec-fetch-site']) === 'none', String(h['sec-fetch-site']));
  ok('Sec-Fetch-Dest is "empty", so a typed-in URL cannot be mistaken for this',
    String(h['sec-fetch-dest']) === 'empty', String(h['sec-fetch-dest']));

  console.log('The server rule matches what the browser actually sends');
  const src = fs.readFileSync(path.join(__dirname, '..', 'api', 'widget-list.js'), 'utf8');
  ok('widget-list reads sec-fetch-site', /sec-fetch-site/.test(src));
  ok('and pairs it with sec-fetch-dest', /sec-fetch-dest/.test(src));
  ok('and treats that pair as the caller-only scope',
    /fromExtension[\s\S]{0,200}selfScope|selfScope[\s\S]{0,200}fromExtension/.test(src));
} finally {
  await ctx.close();
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(userDataDir, { recursive: true, force: true });
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
