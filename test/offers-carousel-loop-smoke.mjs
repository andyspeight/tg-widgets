/**
 * The Special Offers carousel returns to the start (17 Sep 2026).
 *
 * Andy asked whether auto-rotate could go back to the beginning when it reaches
 * the end. It already does, but nothing held it there, and the behaviour is
 * invisible to a source read: it depends on atTrackEnd() measuring a real
 * scrollWidth against a real clientWidth, which only a browser has. So this
 * drives the real widget and watches it wrap.
 *
 * It also pins the deliberate part that makes it LOOK broken when you test it
 * by hand: autoplay stops for good once a visitor navigates on purpose (arrow,
 * dot or keyboard), so clicking to the end and waiting shows nothing happening.
 * That is a choice, not a fault — a pause the visitor chose must not undo
 * itself — and it is worth failing a test if it ever changes silently.
 *
 * Run: node test/offers-carousel-loop-smoke.mjs  (npm run test:offers-carousel-loop)
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let passed = 0, failed = 0;
const ok = (label, cond, detail) => {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.error('  ✗ ' + label + (detail ? '\n      ' + detail : '')); }
};

const WIDGET_PATH = new URL('../public/widget-offers-grid.js', import.meta.url).pathname;
const INTERVAL_S = 2;

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<style>body{margin:0;padding:20px;font-family:system-ui;width:900px}</style></head><body>
<div id="host" data-tg-widget="offers-grid"></div>
<script src="${WIDGET_PATH}"><\/script>
<script>
  const offers = Array.from({length: 9}, (_, i) => ({
    id: 'o' + (i+1), title: 'Offer ' + (i+1), destination: 'Dest ' + (i+1),
    price: 499 + i*50, currency: 'GBP', nights: 7, type: 'Package', image: '',
    description: 'Offer number ' + (i+1),
  }));
  window.__W = new window.TGOffersGridWidget(document.getElementById('host'), {
    display: 'carousel', carouselAutoplay: true, carouselInterval: ${INTERVAL_S},
    cardLayout: 'vertical', columns: 3, currency: 'GBP', offers: offers,
  });
<\/script></body></html>`;

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
});
// Autoplay is disabled by design for a reduced-motion visitor, so the default
// must be set explicitly or this suite would silently test nothing.
const page = await browser.newPage({ viewport: { width: 900, height: 700 }, reducedMotion: 'no-preference' });
const DIR = mkdtempSync(join(tmpdir(), 'tg-carousel-'));
const HTML = join(DIR, 'carousel.html');
writeFileSync(HTML, PAGE);
await page.goto('file://' + HTML);
await page.waitForTimeout(900);

const probe = () => page.evaluate(() => {
  const root = document.getElementById('host').shadowRoot;
  const track = root && root.querySelector('.tgog-car-track');
  if (!track) return null;
  return {
    left: Math.round(track.scrollLeft),
    atEnd: (track.scrollLeft + track.clientWidth) >= (track.scrollWidth - 1),
    scrollable: track.scrollWidth > track.clientWidth + 1,
  };
});

console.log('Auto-rotate walks to the end and starts again');
{
  const first = await probe();
  ok('the carousel rendered and has something to scroll', !!first && first.scrollable, JSON.stringify(first));
  let sawEnd = false, wrapped = false, moved = false, prev = first ? first.left : 0;
  for (let i = 0; i < 12 && !wrapped; i++) {
    await page.waitForTimeout(INTERVAL_S * 1000 + 350);
    const p = await probe();
    if (!p) break;
    if (p.left > prev) moved = true;
    if (p.atEnd) sawEnd = true;
    if (sawEnd && p.left <= 2 && prev > 2) wrapped = true;
    prev = p.left;
  }
  ok('it advances on its own', moved);
  ok('it reaches the end', sawEnd);
  ok('and then goes back to the beginning rather than stopping there', wrapped);
}

console.log('A visitor who takes over keeps control');
{
  // A fresh page, not setContent on the used one: the widget attaches to the
  // host it was given, and re-running the script over a torn-down DOM leaves no
  // shadow root to read.
  const page2 = await browser.newPage({ viewport: { width: 900, height: 700 }, reducedMotion: 'no-preference' });
  await page2.goto('file://' + HTML);
  await page2.waitForTimeout(1000);
  const probe2 = () => page2.evaluate(() => {
    const host = document.getElementById('host');
    const root = host && host.shadowRoot;
    const track = root && root.querySelector('.tgog-car-track');
    return track ? { left: Math.round(track.scrollLeft) } : null;
  });
  const clicked = await page2.evaluate(() => {
    const root = document.getElementById('host').shadowRoot;
    const next = root && root.querySelector('.tgog-car-arrow[data-dir="next"]');
    if (!next) return false;
    next.click();
    return true;
  });
  ok('the next arrow is there to click', clicked);
  await page2.waitForTimeout(900);
  const afterClick = await probe2();
  await page2.waitForTimeout(INTERVAL_S * 1000 * 2 + 600);
  const later = await probe2();
  ok('autoplay does not resume behind them once they navigate',
    !!later && !!afterClick && later.left === afterClick.left,
    JSON.stringify({ afterClick, later }));
  await page2.close();
}

await browser.close();
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
