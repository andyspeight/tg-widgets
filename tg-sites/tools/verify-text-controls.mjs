/**
 * Browser checks for the text controls: does each one do what its label says?
 *
 * WHY THIS EXISTS
 *
 * Andy, 17 September 2026: "the sizing of the text makes no sense. When you
 * select large, bigger, giant etc either nothing happens or the text gets
 * smaller." He was right, and nothing in the suite could see it. The size menu
 * offered an absolute rem ladder ending at 2.5rem, which is 40px, and a theme's
 * H1 is 48px: so on any heading worth styling, EVERY option in that group was
 * smaller than the heading already was, and picking H1 while on an H1 did
 * nothing at all. Every field was wired, every value was valid, every unit test
 * passed. The fault was in the arithmetic between two correct things.
 *
 * So this measures the result rather than the wiring: the real stylesheet, the
 * real motion script, the markup the renderer really emits, and a real pointer.
 * A control that draws nothing fails here.
 *
 * THE SIZES COME FROM lib/content/styles.ts rather than from a copy, bundled on
 * the way in, so the day somebody adds a size the check covers it.
 *
 *   node tools/verify-text-controls.mjs
 */

import { chromium } from 'playwright';
import { chromiumPath } from './chromium.mjs';
import * as esbuild from 'esbuild';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const CHROMIUM = chromiumPath();

/** The size menu itself, as the toolbar offers it. */
const work = await mkdtemp(join(tmpdir(), 'tg-text-'));
const bundle = join(work, 'styles.cjs');
await esbuild.build({
  entryPoints: [resolve(root, 'lib/content/styles.ts')],
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  logLevel: 'error',
  absWorkingDir: root,
});
const { FONT_SIZES } = await import(`file://${bundle}`);

const css = await readFile(resolve(root, 'app/globals.css'), 'utf8');
const script = await readFile(resolve(root, 'public/tg-motion.js'), 'utf8');

const checks = [];
const check = (name, ok, detail = '') => checks.push([name, ok, ok ? '' : detail]);

/** A heading's words, split the way lib/content/words.ts splits them. */
const words = (text) =>
  text
    .split(' ')
    .map((word, i) => `<span class="tgs-w" style="--i:${i}"><span class="tgs-wi">${word}</span></span>`)
    .join(' ');

const TEXT = 'Norway fjords by small ship';
const scale = FONT_SIZES.filter((size) => size.group !== 'From your theme');
const themeSizes = FONT_SIZES.filter((size) => size.group === 'From your theme');

const page = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><style>${css}
.case { padding: 4px 24px; }</style></head><body><div class="tgs-page">
${['h1', 'h2', 'h3', 'h4', 'h5', 'h6']
  .map((style) => `<div class="case"><div class="tgs-block"><h2 class="tgs-heading" id="style-${style}" data-style="${style}">${TEXT}</h2></div></div>`)
  .join('')}
${['left', 'centre', 'right']
  .map((align) => `<div class="case"><div class="tgs-block" data-align="${align}"><h2 class="tgs-heading" id="align-${align}" data-style="h2">${TEXT}</h2></div></div>`)
  .join('')}
${['soft', 'strong']
  .map((shadow) => `<div class="case"><div class="tgs-block"><h2 class="tgs-heading" id="shadow-${shadow}" data-style="h2" data-shadow="${shadow}">${TEXT}</h2></div></div>`)
  .join('')}
<div class="case"><div class="tgs-block"><h2 class="tgs-heading" id="shadow-none" data-style="h2">${TEXT}</h2></div></div>
<div class="case"><div class="tgs-block"><h2 class="tgs-heading" id="outlined" data-style="h2" data-outlined="">${TEXT}</h2></div></div>
<div class="case"><div class="tgs-block" data-gradient=""><h2 class="tgs-heading" id="gradient" data-style="h2">${TEXT}</h2></div></div>
${scale
  .map((size, i) => `<div class="case"><div class="tgs-block"><h1 class="tgs-heading" id="scale-${i}" data-style="h1">Norway <span style="font-size:${size.value}">fjords</span></h1></div></div>`)
  .join('')}
${scale
  .map((size, i) => `<div class="case"><div class="tgs-block"><div class="tgs-text" id="pscale-${i}"><p>Norway <span style="font-size:${size.value}">fjords</span></p></div></div></div>`)
  .join('')}
${themeSizes
  .map((size, i) => `<div class="case"><div class="tgs-block"><h3 class="tgs-heading" id="theme-${i}" data-style="h3">Norway <span style="font-size:${size.value}">fjords</span></h3></div></div>`)
  .join('')}
${['s', 'm', 'l']
  .map((size) => `<div class="case"><div class="tgs-block"><div class="tgs-text" id="text-${size}" data-size="${size}"><p>${TEXT}</p></div></div></div>`)
  .join('')}
${['words', 'words-blur', 'words-mask']
  .map((arrive) => `<div class="case"><div class="tgs-block"><h2 class="tgs-heading" id="arrive-${arrive}" data-style="h2" data-arrive="${arrive}" data-arrive-fb="1">${words(TEXT)}</h2></div></div>`)
  .join('')}
${['lift', 'focus', 'proximity']
  .map((hover) => `<div class="case"><div class="tgs-block"><h1 class="tgs-heading" id="hover-${hover}" data-style="h1" data-hover="${hover}">${words(TEXT)}</h1></div></div>`)
  .join('')}
</div><script>${script}<\/script></body></html>`;

const browser = await chromium.launch({ executablePath: CHROMIUM });
const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
const tab = await context.newPage();
const errors = [];
tab.on('pageerror', (error) => errors.push(String(error)));
tab.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
await tab.setContent(page, { waitUntil: 'load' });
await tab.waitForTimeout(150);

const px = (id, selector) =>
  tab.evaluate(
    ([target, inner]) => {
      const el = document.querySelector(inner ? `#${target} ${inner}` : `#${target}`);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return {
        size: parseFloat(cs.fontSize),
        align: cs.textAlign,
        shadow: cs.textShadow,
        stroke: parseFloat(cs.webkitTextStrokeWidth),
        gradient: cs.backgroundImage !== 'none',
      };
    },
    [id, selector ?? ''],
  );

// --- the named styles are a ladder, largest first -------------------------
const styleSizes = [];
for (const style of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) styleSizes.push((await px(`style-${style}`)).size);
check(
  'H1 to H6 are six different sizes, descending',
  styleSizes.every((size, i) => i === 0 || size < styleSizes[i - 1]),
  styleSizes.join(' > '),
);

// --- alignment ------------------------------------------------------------
const aligns = {};
for (const align of ['left', 'centre', 'right']) aligns[align] = (await px(`align-${align}`)).align;
check(
  'left, centre and right each align differently',
  aligns.left !== aligns.centre && aligns.centre !== aligns.right,
  JSON.stringify(aligns),
);

// --- shadow, outline, gradient -------------------------------------------
const none = await px('shadow-none');
for (const shadow of ['soft', 'strong']) {
  const got = await px(`shadow-${shadow}`);
  check(`the ${shadow} heading shadow draws one`, got.shadow !== 'none' && got.shadow !== none.shadow, got.shadow);
}
check('outlined draws a stroke', (await px('outlined')).stroke > 0, String((await px('outlined')).stroke));
check('the gradient heading paints a gradient', (await px('gradient')).gradient === true);

// --- the size menu, which is what was wrong ------------------------------
const h1 = (await px('style-h1')).size;
const onHeading = [];
for (let i = 0; i < scale.length; i += 1) onHeading.push((await px(`scale-${i}`, 'span')).size);
const onParagraph = [];
for (let i = 0; i < scale.length; i += 1) onParagraph.push((await px(`pscale-${i}`, 'span')).size);

check(
  'every size in the menu is a step up from the one before it, on a heading',
  onHeading.every((size, i) => i === 0 || size > onHeading[i - 1]),
  scale.map((size, i) => `${size.label} ${onHeading[i]}px`).join(', '),
);
check(
  'and on a paragraph',
  onParagraph.every((size, i) => i === 0 || size > onParagraph[i - 1]),
  scale.map((size, i) => `${size.label} ${onParagraph[i]}px`).join(', '),
);

/*
 * THE ONE ANDY HIT. Every size above Normal has to be bigger than the heading
 * it is used in, or the menu is lying: "Giant" that shrinks an H1 is the whole
 * bug, and it passed every other kind of test there is.
 */
const normalAt = scale.findIndex((size) => size.label === 'Normal');
for (let i = normalAt + 1; i < scale.length; i += 1) {
  check(
    `${scale[i].label} is bigger than the H1 it is used in`,
    onHeading[i] > h1,
    `${scale[i].label} is ${onHeading[i]}px inside a ${h1}px heading`,
  );
}
for (let i = 0; i < normalAt; i += 1) {
  check(`${scale[i].label} is smaller than the H1 it is used in`, onHeading[i] < h1, `${onHeading[i]}px vs ${h1}px`);
}
check('Normal leaves the heading exactly as it was', Math.abs(onHeading[normalAt] - h1) < 0.5, `${onHeading[normalAt]} vs ${h1}`);

// --- the theme's own sizes stay absolute ---------------------------------
const h3 = (await px('style-h3')).size;
const themeOnH3 = [];
for (let i = 0; i < themeSizes.length; i += 1) themeOnH3.push((await px(`theme-${i}`, 'span')).size);
check(
  'the theme sizes resolve to the theme, not to the heading around them',
  themeOnH3.some((size) => size > h3) && themeOnH3.some((size) => size < h3),
  themeSizes.map((size, i) => `${size.label} ${themeOnH3[i]}px`).join(', '),
);

// --- the text block's own three --------------------------------------------
const textSizes = [];
for (const size of ['s', 'm', 'l']) textSizes.push((await px(`text-${size}`, 'p')).size);
check('the text block’s small, normal and large ascend', textSizes[0] < textSizes[1] && textSizes[1] < textSizes[2], textSizes.join(' < '));

// --- the words arriving ----------------------------------------------------
for (const arrive of ['words', 'words-blur', 'words-mask']) {
  const animated = await tab.evaluate((id) => {
    const head = document.getElementById(id);
    const outer = head.querySelector('.tgs-w');
    const inner = head.querySelector('.tgs-wi');
    const names = [getComputedStyle(outer).animationName, getComputedStyle(inner).animationName];
    return names.filter((name) => name && name !== 'none');
  }, `arrive-${arrive}`);
  check(`"${arrive}" gives the words an animation`, animated.length > 0, JSON.stringify(animated));
}

// --- under the pointer, with a real pointer --------------------------------
for (const hover of ['lift', 'focus', 'proximity']) {
  const word = await tab.$(`#hover-${hover} .tgs-w`);
  await word.scrollIntoViewIfNeeded();
  const box = await word.boundingBox();
  await tab.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
  await tab.waitForTimeout(220);
  const got = await tab.evaluate((id) => {
    const el = document.querySelector(`#${id} .tgs-w`);
    const cs = getComputedStyle(el);
    return {
      transform: cs.transform,
      colour: cs.color,
      opacity: cs.opacity,
      outline: parseFloat(cs.outlineWidth),
      near: el.style.getPropertyValue('--near'),
    };
  }, `hover-${hover}`);
  const moved = got.transform !== 'none' && got.transform !== 'matrix(1, 0, 0, 1, 0, 0)';
  const answered = hover === 'focus' ? got.outline > 0 : moved;
  check(`"${hover}" answers the pointer`, answered, JSON.stringify(got));
  await tab.mouse.move(2, 2);
  await tab.waitForTimeout(120);
}

await browser.close();
await rm(work, { recursive: true, force: true });

let failed = false;
console.log('');
for (const [name, ok, detail] of checks) {
  if (!ok) failed = true;
  console.log(`  ${(ok ? 'PASS' : `FAIL (${detail})`).padEnd(34)} ${name}`);
}
if (errors.length > 0) {
  failed = true;
  console.log('\n  Console errors:');
  for (const error of errors.slice(0, 5)) console.log(`    ${error}`);
} else {
  console.log('\n  No console errors.');
}
console.log(`\n  ${checks.length} checks on the text controls.\n`);
process.exit(failed ? 1 : 0);
