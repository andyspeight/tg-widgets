/**
 * Does the A3 rail drift, and does it still work when the script does not?
 *
 * A3 is the one recipe that puts a script on a page, so it gets the one check the
 * CSS recipes cannot need: the page has to be complete WITHOUT it. Nothing in a unit
 * test can tell you whether a track is actually reachable when a file fails to load,
 * and "the card is in the DOM" is not the same as "the visitor can get to it".
 *
 * Three questions, in the order they matter:
 *
 *   1. With no script at all, is every card still reachable? That is clause 2 of the
 *      rule in lib/content/blocks.ts and the reason the rail is a native scroll-snap
 *      carousel rather than a transformed track.
 *   2. With the script, does the rail actually drift on its own?
 *   3. Does it stop when somebody wants it to, and never start under reduced motion?
 *
 *   node tools/verify-motion-rail.mjs
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHROMIUM = process.env.TG_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const css = readFileSync(join(HERE, '..', 'app', 'globals.css'), 'utf8');
const script = readFileSync(join(HERE, '..', 'public', 'tg-motion.js'), 'utf8');

/* Eight cards, so the track is comfortably wider than the viewport. */
function html(withScript, intensity) {
  const cards = Array.from({ length: 8 }, (_, i) =>
    `<div class="tgs-card"><a href="#c${i}">Day ${i + 1}</a><p>A leg of the route.</p></div>`).join('');

  return `<!doctype html><html><head><style>${css}
    .tgs-card { padding: 20px; background: #eee; }
  </style></head><body>
  <div class="tgs-page">
    <section class="tgs-section" data-motion="A3" data-motion-intensity="${intensity}">
      <div class="tgs-section__inner">
        <div class="tgs-cards" data-columns="3" data-gap="m">${cards}</div>
      </div>
    </section>
  </div>
  ${withScript ? `<script>${script}<\/script>` : ''}
  </body></html>`;
}

const browser = await chromium.launch({ executablePath: CHROMIUM });
const problems = [];
const lines = [];

async function open({ withScript, intensity = 2, reduced = false }) {
  const page = await browser.newPage({
    viewport: { width: 1000, height: 800 },
    reducedMotion: reduced ? 'reduce' : 'no-preference',
  });
  await page.setContent(html(withScript, intensity), { waitUntil: 'load' });
  await page.waitForTimeout(300);
  return page;
}

/* 1. WITH NO SCRIPT, every card must still be reachable. */
{
  const page = await open({ withScript: false });
  const state = await page.evaluate(() => {
    const track = document.querySelector('.tgs-cards');
    const cs = getComputedStyle(track);
    return {
      overflowX: cs.overflowX,
      snap: cs.scrollSnapType,
      travel: track.scrollWidth - track.clientWidth,
      cards: track.children.length,
    };
  });

  // Can a visitor actually get to the last card by scrolling the track?
  const reached = await page.evaluate(() => {
    const track = document.querySelector('.tgs-cards');
    track.scrollLeft = track.scrollWidth;
    const last = track.lastElementChild.getBoundingClientRect();
    const box = track.getBoundingClientRect();
    return last.right <= box.right + 2 && last.left >= box.left - 2;
  });
  await page.close();

  lines.push(`  no script: overflow-x ${state.overflowX}, snap ${state.snap}, travel ${state.travel}px, ${state.cards} cards`);
  if (state.overflowX !== 'auto' && state.overflowX !== 'scroll') {
    problems.push(
      `with no script the rail is overflow-x: ${state.overflowX}, so the cards past the `
      + 'edge cannot be reached at all',
    );
  }
  if (state.travel <= 0) {
    problems.push('the rail has no travel, so it is not a track');
  }
  if (!reached) {
    problems.push('the last card could not be scrolled into view without the script');
  }
}

/* 2. WITH the script, the rail must drift on its own. */
for (const intensity of [1, 2, 3]) {
  const page = await open({ withScript: true, intensity });
  const first = await page.evaluate(() => document.querySelector('.tgs-cards').scrollLeft);
  await page.waitForTimeout(2500);
  const second = await page.evaluate(() => document.querySelector('.tgs-cards').scrollLeft);
  const version = await page.evaluate(() => window.__TG_MOTION_VERSION__);
  await page.close();

  lines.push(`  intensity ${intensity}: scrollLeft ${first.toFixed(1)} -> ${second.toFixed(1)} (script ${version})`);
  if (!version) {
    problems.push(`the script did not run at intensity ${intensity}`);
  }
  if (Math.abs(second - first) < 1) {
    problems.push(
      `the rail did not drift at intensity ${intensity} (${first} -> ${second}), `
      + 'so the one recipe that costs a script is not earning it',
    );
  }
}

/* 3a. Reduced motion: the script must never start, and the rail must still work. */
{
  const page = await open({ withScript: true, reduced: true });
  const first = await page.evaluate(() => document.querySelector('.tgs-cards').scrollLeft);
  await page.waitForTimeout(2000);
  const after = await page.evaluate(() => ({
    scrollLeft: document.querySelector('.tgs-cards').scrollLeft,
    overflowX: getComputedStyle(document.querySelector('.tgs-cards')).overflowX,
    marked: document.querySelector('.tgs-cards').getAttribute('data-motion-live'),
  }));
  await page.close();

  lines.push(`  reduced motion: scrollLeft ${first} -> ${after.scrollLeft}, overflow-x ${after.overflowX}, live ${after.marked}`);
  if (Math.abs(after.scrollLeft - first) > 0.5) {
    problems.push('the rail drifted under prefers-reduced-motion, which is the one guard nothing may skip');
  }
  if (after.marked === '1') {
    problems.push('the script initialised the rail under reduced motion instead of refusing to start');
  }
  if (after.overflowX !== 'auto' && after.overflowX !== 'scroll') {
    problems.push(`under reduced motion the rail is overflow-x: ${after.overflowX}, so cards are unreachable`);
  }
}

/* 3b. It has to stop for a pointer, or there is no way to read a moving card. */
{
  const page = await open({ withScript: true });
  await page.hover('.tgs-cards');
  await page.waitForTimeout(200);
  const held = await page.evaluate(() => document.querySelector('.tgs-cards').scrollLeft);
  await page.waitForTimeout(1800);
  const still = await page.evaluate(() => document.querySelector('.tgs-cards').scrollLeft);
  await page.close();

  lines.push(`  pointer over it: ${held.toFixed(1)} -> ${still.toFixed(1)}`);
  if (Math.abs(still - held) > 1) {
    problems.push(
      `the rail kept drifting with a pointer over it (${held} -> ${still}), so a visitor `
      + 'cannot hold it still to read a card',
    );
  }
}

await browser.close();

if (problems.length) {
  console.error('\n  A3 rail check FAILED:');
  for (const problem of problems) console.error(`    - ${problem}`);
  console.error(`\n${lines.join('\n')}\n`);
  process.exit(1);
}

console.log('  PASS  the A3 rail works with no script, drifts with one, and stops when asked');
console.log(lines.join('\n'));
