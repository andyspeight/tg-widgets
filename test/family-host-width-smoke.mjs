/**
 * A container-query widget must never collapse to nothing (8 Sep 2026).
 *
 * tailorevents.se/events/fotboll: the Club Picker rendered about 80px wide,
 * centred, with "Nottingham Forest" one letter per line. Every ticket widget
 * uses @container queries, and the containment they need removes the
 * widget's intrinsic width. In plain block flow that is harmless; inside a
 * centred flex column, a centred grid cell or an inline-block wrapper (all
 * common in page builders) the host shrink-wraps to 0px and the badges
 * overflow it one letter at a time.
 *
 * The rule now: :host claims width:100% (fills a flex or grid cell) and
 * carries a zero-height ::before 280px wide as an intrinsic floor (a
 * shrink-to-fit wrapper still gives it 280px), capped at 100% so it never
 * overflows a narrower column.
 *
 * Static checks always run. The measurements run when Playwright's Chromium
 * is available and skip cleanly otherwise.
 *
 * Run: node test/family-host-width-smoke.mjs   (npm run test:family-host-width)
 */
import { readFileSync, existsSync } from 'node:fs';
import http from 'node:http';

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };
const R = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

const FAMILY = ['clubpicker', 'tickets', 'eventmenu', 'ticketsearch', 'ticketmonth', 'nextevent', 'venueguide', 'prism'];
const HOST = ':host{all:initial;display:block;width:100%;min-width:0;}:host::before{content:"";display:block;width:280px;max-width:100%;height:0;}';

console.log('Every container-query widget claims its width');
for (const tag of FAMILY) {
  const src = R('public/widget-' + tag + '.js');
  ok(tag + ': uses container queries', /container-type:inline-size/.test(src));
  ok(tag + ': the host fills its cell and carries the 280px floor', src.includes(HOST));
  ok(tag + ': the old collapsing rule is gone', !src.includes(':host{all:initial;display:block;}'));
}

let chromium = null;
try { ({ chromium } = await import('playwright')); } catch { /* not installed */ }
const exe = '/opt/pw-browsers/chromium';
if (!chromium || !existsSync(exe)) {
  console.log('\n(Playwright Chromium not available here: measurements skipped)');
} else {
  console.log('\nMeasured in Chromium: the Club Picker keeps its width in every wrapper');
  const INDEX = { categories: [{ label: 'Football', slug: 'football' }], competitions: [{ slug: 'epl', label: 'Premier League', category: 'football', categoryLabel: 'Football', events: 380 }] };
  const TEAMS = { items: [{ key: 'ipswich', name: 'Ipswich Town', events: 12 }, { key: 'leeds', name: 'Leeds United', events: 14 }, { key: 'forest', name: 'Nottingham Forest', events: 9 }, { key: 'arsenal', name: 'Arsenal', events: 20 }] };
  const WIDGET = R('public/widget-clubpicker.js');
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/feed') { const v = u.searchParams.get('view'); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(!v ? INDEX : v === 'teams' ? TEAMS : { items: [], events: [] })); return; }
    if (u.pathname.startsWith('/page/')) {
      const mode = u.pathname.slice(6);
      const wrap = mode === 'flex' ? 'display:flex;flex-direction:column;align-items:center;' : mode === 'grid' ? 'display:grid;justify-items:center;' : mode === 'inline' ? 'text-align:center;' : mode === 'narrow' ? 'width:220px;' : '';
      const inner = mode === 'inline' ? '<div style="display:inline-block"><div id="m"></div></div>' : '<div id="m"></div>';
      res.setHeader('Content-Type', 'text/html');
      res.end(`<!doctype html><html><body style="margin:0;padding:24px"><div style="max-width:1000px;margin:0 auto;${wrap}"><h1>Hitta din resa</h1>${inner}</div>
        <script>window.__TG_WIDGET_ORIGIN__='http://127.0.0.1:8789';window.__TG_EVENTS_API__='http://127.0.0.1:8789/feed';</script>
        <script src="/w.js"></script></body></html>`); return;
    }
    if (u.pathname === '/w.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(WIDGET); return; }
    res.statusCode = 404; res.end();
  });
  await new Promise((r) => srv.listen(8789, r));
  let browser = null;
  try { browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--disable-gpu'] }); } catch (e) { console.log('  (browser would not launch: ' + String(e.message).split('\n')[0] + ')'); }
  if (browser) {
    const want = { block: [1000, 1000], flex: [1000, 1000], grid: [1000, 1000], inline: [280, 280], narrow: [220, 220] };
    for (const mode of Object.keys(want)) {
      const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
      await page.goto('http://127.0.0.1:8789/page/' + mode);
      await page.evaluate(() => { new window.TGClubPickerWidget(document.getElementById('m'), { sourceType: 'competition', sourceValue: 'epl', columns: 4 }); });
      await page.waitForTimeout(500);
      const r = await page.evaluate(() => {
        const m = document.getElementById('m');
        const names = [...m.shadowRoot.querySelectorAll('*')].filter((e) => e.textContent.trim() === 'Nottingham Forest' && e.children.length === 0);
        return { host: m.getBoundingClientRect().width, nameH: names[0] ? names[0].getBoundingClientRect().height : 0, scrollW: document.documentElement.scrollWidth };
      });
      const [lo, hi] = want[mode];
      ok(mode + ' wrapper: host ' + Math.round(r.host) + 'px (expected ' + lo + ')', r.host >= lo - 1 && r.host <= hi + 1);
      ok(mode + ' wrapper: a club name sits on one line', r.nameH > 0 && r.nameH < 40);
      ok(mode + ' wrapper: nothing overflows the page', r.scrollW <= 1100);
      await page.close();
    }
    await browser.close();
  }
  srv.close();
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
