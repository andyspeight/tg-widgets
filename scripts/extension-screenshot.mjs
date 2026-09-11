/**
 * Render the Chrome Web Store screenshot for the Scheduler extension.
 *
 *   npm run extension:screenshot
 *
 * The store wants 1280x800. The extension is a narrow side panel, so a bare
 * 1280x800 grab would be mostly empty space. This renders the REAL panel
 * (panel.html + panel.css + panel.js, untouched) against stubbed API responses,
 * then sets that panel on a 1280x800 plate with a one-line caption, which is
 * how side-panel extensions are normally shown.
 *
 * The data is invented but the shapes are the live ones, so what appears is the
 * genuine interface and not a mock-up of it. If the panel changes, re-run this
 * and the screenshot follows. Regenerate rather than retouch.
 *
 * Output: build/store-screenshot-1280x800.png
 */
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, extname } from 'node:path';
import { chromium } from 'playwright';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'extension', 'scheduler-companion');
const OUT_DIR = join(ROOT, 'build');
const OUT = join(OUT_DIR, 'store-screenshot-1280x800.png');

const PANEL_W = 420;
const PANEL_H = 720;

// Invented agency, so no real client or colleague appears in a public listing.
const ME = { user: { fullName: 'Sarah Whitfield', email: 'sarah@sunshinetravel.co.uk' } };
const WIDGETS = [
  { widgetId: 'tgw_demo_consult', type: 'Appointment', name: 'Sunshine Travel' },
  { widgetId: 'tgw_demo_review', type: 'Appointment', name: 'Honeymoon desk' },
];
const CONFIGS = {
  tgw_demo_consult: { config: { eventTypes: [
    { id: 'discovery', label: 'Holiday discovery call', mins: 15 },
    { id: 'planning', label: 'Trip planning session', mins: 45 },
  ] } },
  tgw_demo_review: { config: { eventTypes: [
    { id: 'honeymoon', label: 'Honeymoon consultation', mins: 30 },
    { id: 'quote', label: 'Quote walk-through', mins: 20 },
  ] } },
};

const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json' };

function serve() {
  const server = createServer((req, res) => {
    const rel = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '') || 'panel.html';
    const file = join(SRC, rel);
    if (!file.startsWith(SRC) || !existsSync(file)) { res.writeHead(404); res.end('no'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, port: server.address().port })));
}

const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

const { server, port } = await serve();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--disable-gpu'] });

try {
  const page = await browser.newPage({ viewport: { width: PANEL_W, height: PANEL_H }, deviceScaleFactor: 2 });

  await page.route('https://widgets.travelify.io/**', (route) => {
    const url = route.request().url();
    if (url.includes('/api/auth/me')) return route.fulfill(json(ME));
    // Staff-only endpoint: 403 for a normal user, so no "acting as" strip.
    if (url.includes('/api/auth/staff-clients')) return route.fulfill({ status: 403, contentType: 'application/json', body: '{}' });
    if (url.includes('/api/widget-list')) return route.fulfill(json(WIDGETS));
    if (url.includes('/api/widget-config')) {
      const id = new URL(url).searchParams.get('id');
      return route.fulfill(json(CONFIGS[id] || { config: {} }));
    }
    if (url.includes('/api/appointment/agenda')) return route.fulfill(json({ connected: true, events: [] }));
    if (url.includes('/api/appointment/list')) return route.fulfill(json({ bookings: [] }));
    return route.fulfill({ status: 404, body: '{}' });
  });

  await page.goto('http://127.0.0.1:' + port + '/panel.html', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.mcard', { timeout: 15000 });
  await page.waitForTimeout(400); // let the account strip settle

  const cards = await page.locator('.mcard').count();
  if (cards < 2) throw new Error('only ' + cards + ' meeting cards rendered; the stub data or the panel changed');

  const panelPng = (await page.screenshot({ type: 'png' })).toString('base64');

  // Compose the plate. Kept deliberately plain: the product is the subject.
  const plate = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await plate.setContent(`<!doctype html><html><head><meta charset="utf-8">
    <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700&display=swap" rel="stylesheet">
    <style>
      *{margin:0;padding:0;box-sizing:border-box}
      body{width:1280px;height:800px;display:flex;align-items:center;justify-content:center;gap:64px;
           background:linear-gradient(135deg,#0E7490 0%,#0891B2 55%,#22B8CF 100%);
           font-family:'DM Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#fff;padding:0 72px}
      .copy{max-width:440px}
      h1{font-size:40px;line-height:1.15;font-weight:700;letter-spacing:-.02em;margin-bottom:18px}
      p{font-size:19px;line-height:1.5;opacity:.92;font-weight:400}
      .shot{width:${PANEL_W}px;border-radius:16px;overflow:hidden;flex:0 0 auto;
            box-shadow:0 30px 70px rgba(2,32,45,.45),0 6px 18px rgba(2,32,45,.3)}
      .shot img{display:block;width:${PANEL_W}px}
    </style></head><body>
    <div class="copy">
      <h1>Your booking links, one click away</h1>
      <p>Every meeting type from every scheduler, ready to copy or to share as times that suit. Plus your next two weeks at a glance.</p>
    </div>
    <div class="shot"><img src="data:image/png;base64,${panelPng}" alt=""></div>
  </body></html>`, { waitUntil: 'networkidle' });
  await plate.waitForTimeout(600); // webfont

  mkdirSync(OUT_DIR, { recursive: true });
  await plate.screenshot({ path: OUT });
  console.log('\n  ' + cards + ' meeting cards rendered from the real panel');
  console.log('  ' + OUT.replace(ROOT + '/', '') + '  (1280x800)\n');
} finally {
  await browser.close();
  server.close();
}
