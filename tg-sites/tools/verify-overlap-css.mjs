/**
 * The PUBLISHED header see-through, checked against the real globals.css.
 *
 * verify-standalone drives the editor, where the header goes see-through under a
 * pulled-up first section via data-tuck-header. The PUBLISHED page does the same a
 * different way, via data-overlapped set in the render, and nothing browser-checked
 * it. Andy hit the gap on the live site (13 Aug 2026): "the background behind the
 * navigation, even though it is showing as transparent in the editor". The editor
 * cleared the header's columns and the published page did not, so a logo or menu
 * column read as a white box over the picture.
 *
 * So this loads the real globals.css over the header markup the renderer emits and
 * asserts the two things that must both hold:
 *   - an OVERLAPPED header clears its section AND its columns (the picture shows), and
 *   - a NORMAL header keeps them (an ordinary header is untouched).
 *
 * No build and no bundle: it reads app/globals.css beside it, so it also works from
 * the probe's worktree. Run: node tools/verify-overlap-css.mjs
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, '../app/globals.css'), 'utf8');

const CHROMIUM = process.env.TG_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

/*
 * The header the way RegionRenderer + PageRenderer emit it: a `.tgs-region` that is
 * also a `.tgs-page`, a `.tgs-section`, then columns. Each carries --tgs-bg inline,
 * which is how boxStyle paints a fill, so a real coloured header is reproduced.
 */
const markup = (overlapped) => `<!doctype html><html><head><style>${css}</style></head><body>
  <header class="tgs-page tgs-region" data-region="header"${overlapped ? ' data-overlapped="true"' : ''}>
    <section class="tgs-section" style="--tgs-bg:#ffffff">
      <div class="tgs-row">
        <div class="tgs-col" id="logo" style="--tgs-bg:#ffffff">LOGO</div>
        <div class="tgs-col" id="nav" style="--tgs-bg:#ffffff">NAV</div>
      </div>
    </section>
  </header></body></html>`;

const browser = await chromium.launch({ executablePath: CHROMIUM });
const page = await browser.newPage();

const measure = async (overlapped) => {
  await page.setContent(markup(overlapped), { waitUntil: 'load' });
  await page.waitForTimeout(120);
  return page.evaluate(() => {
    // A fill is painted as a background-image gradient off --tgs-bg. 'none' means clear.
    const img = (sel) => getComputedStyle(document.querySelector(sel)).backgroundImage;
    return {
      section: img('.tgs-section'),
      logo: img('#logo'),
      nav: img('#nav'),
    };
  });
};

const problems = [];
const over = await measure(true);
const plain = await measure(false);

// Overlapped: section and both columns must be clear, so the picture shows through.
for (const [name, value] of Object.entries(over)) {
  if (value !== 'none') problems.push(`overlapped header left its ${name} filled: ${value}`);
}
// Normal: an ordinary header keeps its fills, or the fix has bled past its scope.
for (const [name, value] of Object.entries(plain)) {
  if (!value.includes('gradient')) problems.push(`a normal header lost its ${name} fill: ${value}`);
}

await browser.close();

if (problems.length) {
  console.error('\n  FAIL  the published header see-through\n' + problems.map((p) => `    - ${p}`).join('\n') + '\n');
  process.exit(1);
}
console.log('  PASS  the published header see-through: section and columns clear when overlapped, a normal header untouched');
