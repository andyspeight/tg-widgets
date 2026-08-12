/**
 * The test the reveal never had: does the scroll animation actually PLAY?
 *
 * The standalone harness only ever checked that a reveal is ATTACHED, reading the
 * computed animation-name. That is why it stayed green for days while, on the real
 * site, nothing moved. The cause was `.tgs-page { overflow-x: hidden }`: hidden makes
 * a box a scroll container, and `animation-timeline: view()` binds to the nearest
 * scroll-container ancestor. Bound to a page wrapper that never itself scrolls (the
 * viewport does), every reveal froze at fully-in-view and sat at its end state.
 *
 * This drives the MECHANISM in a real browser: a page wrapper, a spacer to push a
 * reveal section below the fold, and a block that should fade in as it is scrolled to.
 * It runs the wrapper both ways and asserts the difference is real:
 *   - overflow-x: clip   -> the block is hidden at the top and shown once scrolled to.
 *   - overflow-x: hidden -> the block never changes, which is the bug this catches.
 *
 *   node tools/verify-motion.mjs
 */

import { chromium } from 'playwright';

const CHROMIUM = process.env.TG_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

/*
 * The reveal exactly as globals.css ships it: the animation, its view() timeline and
 * its entry range, behind the same two guards. Only the wrapper's overflow varies.
 */
function html(overflow) {
  return `<!doctype html><html><head><style>
    * { margin: 0; box-sizing: border-box; }
    .tgs-page { overflow-x: ${overflow}; background: #fff; }
    @media (prefers-reduced-motion: no-preference) {
      @supports (animation-timeline: view()) {
        .tgs-section[data-reveal] .tgs-block {
          animation: tgs-reveal-rise linear both;
          animation-timeline: view();
          animation-range: entry 12% entry 62%;
        }
      }
    }
    @keyframes tgs-reveal-rise {
      from { opacity: 0; transform: translateY(26px); }
      to   { opacity: 1; transform: none; }
    }
  </style></head><body>
    <div class="tgs-page">
      <div style="height: 1600px; background: #eee;">spacer, pushes the section below the fold</div>
      <section class="tgs-section" data-reveal="rise">
        <div class="tgs-block" style="height: 220px; background: #ccc;">reveal me</div>
      </section>
      <div style="height: 1600px;">tail, so there is room to scroll the section to the middle</div>
    </div>
  </body></html>`;
}

const browser = await chromium.launch({ executablePath: CHROMIUM });

async function probe(overflow) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await page.setContent(html(overflow), { waitUntil: 'load' });
  const supported = await page.evaluate(() => CSS.supports('animation-timeline', 'view()'));

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  const atTop = await page.evaluate(
    () => parseFloat(getComputedStyle(document.querySelector('.tgs-block')).opacity),
  );

  // Scroll the section up into the middle of the viewport, well past its entry range.
  await page.evaluate(() => {
    const section = document.querySelector('.tgs-section');
    window.scrollTo(0, section.offsetTop - window.innerHeight * 0.3);
  });
  await page.waitForTimeout(200);
  const scrolledTo = await page.evaluate(
    () => parseFloat(getComputedStyle(document.querySelector('.tgs-block')).opacity),
  );

  await page.close();
  return { supported, atTop, scrolledTo };
}

const clip = await probe('clip');
const hidden = await probe('hidden');
await browser.close();

const problems = [];

if (!clip.supported) {
  problems.push('this browser has no animation-timeline: view(), so the reveal cannot be tested here');
}

// The fix: with clip, the block starts hidden below the fold and is shown once scrolled to.
if (clip.atTop >= 0.5) {
  problems.push(`clip: the block was already visible below the fold (opacity ${clip.atTop}), so the reveal is not holding it back`);
}
if (clip.scrolledTo <= 0.7) {
  problems.push(`clip: the block did not reveal on scroll (opacity ${clip.scrolledTo} after scrolling to it)`);
}
if (clip.scrolledTo - clip.atTop <= 0.4) {
  problems.push(`clip: scrolling barely changed the block (${clip.atTop} -> ${clip.scrolledTo}), so it is not really animating`);
}

// The guard: with hidden, the wrapper is a scroll container, the timeline is frozen,
// and scrolling changes nothing. If this ever animates, the test has stopped meaning
// anything and the clip assertion above is passing for the wrong reason.
if (Math.abs(hidden.scrolledTo - hidden.atTop) >= 0.2) {
  problems.push(`hidden: the block animated (${hidden.atTop} -> ${hidden.scrolledTo}) when a scroll-container ancestor should have frozen it, so this test no longer proves the fix`);
}

if (problems.length) {
  console.error('\n  Motion check FAILED:');
  for (const problem of problems) console.error(`    - ${problem}`);
  console.error(`\n  clip:   at top ${clip.atTop}, scrolled to ${clip.scrolledTo}`);
  console.error(`  hidden: at top ${hidden.atTop}, scrolled to ${hidden.scrolledTo}\n`);
  process.exit(1);
}

console.log('  PASS  a reveal actually animates on scroll under overflow-x: clip');
console.log(`        clip: ${clip.atTop} -> ${clip.scrolledTo}   hidden (frozen): ${hidden.atTop} -> ${hidden.scrolledTo}`);
