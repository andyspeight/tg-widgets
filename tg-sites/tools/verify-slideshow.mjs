/**
 * Smoke test for the published-page slideshow enhancer.
 *
 * The editor standalone never runs a page script, by design, so the slideshow
 * script has no home in verify-standalone.mjs. This drives it where it actually
 * runs instead: a real browser, a real page built from the exact markup the
 * ImageBlock renderer emits, the real globals.css and the real public/slideshow.js,
 * with the buttons clicked and the autoplay timed. Fails loudly on any console
 * error or page exception.
 *
 *   node tools/verify-slideshow.mjs
 */

import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, '../app/globals.css'), 'utf8');
const script = readFileSync(resolve(here, '../public/slideshow.js'), 'utf8');

// A 1x1 pixel, so the slides carry a real image with no network at all.
const PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';

/**
 * The markup the renderer writes for a three-picture slideshow. data-interval
 * is a brisk one second so the autoplay checks do not sit here for a minute. The
 * decorative CSS dots are present because the renderer emits them; the script
 * hides them and builds its own.
 */
function slideshowPage({ transition = 'fade', arrows = true, dots = true } = {}) {
  const count = 3;
  const slides = Array.from({ length: count })
    .map(
      (_, i) =>
        `<div class="tgs-slideshow__slide" style="animation-delay: calc(${i} * var(--tgs-ss-cycle) / ${count})">` +
        `<img src="${PIXEL}" alt="Slide ${i + 1}" /></div>`,
    )
    .join('');
  const cssDots = dots
    ? `<div class="tgs-slideshow__dots" aria-hidden="true">` +
      Array.from({ length: count })
        .map(() => `<span class="tgs-slideshow__dot"></span>`)
        .join('') +
      `</div>`
    : '';
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head>
<body><div class="tgs-page"><div class="tgs-image"><figure>
<div class="tgs-slideshow" data-transition="${transition}" data-count="${count}" data-interval="1"${
    dots ? ' data-dots="true"' : ''
  }${arrows ? ' data-arrows="true"' : ''} style="--tgs-ss-cycle: ${count}s"
     aria-roledescription="carousel" aria-label="Image slideshow">
  <div class="tgs-slideshow__viewport" data-radius="md" style="aspect-ratio: 16 / 9">${slides}</div>
  ${cssDots}
</div>
</figure></div></div>
<script>${script}</script>
</body></html>`;
}

const CHROMIUM =
  process.env.TG_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const browser = await chromium.launch({ executablePath: CHROMIUM });

const checks = [];
const quiet = process.env.TG_QUIET === '1';
let done = 0;
const check = async (name, fn) => {
  try {
    const value = await fn();
    checks.push([name, value === true ? 'PASS' : `FAIL (${value})`]);
  } catch (error) {
    checks.push([name, `FAIL (${error.message})`]);
  }
  done += 1;
  if (!quiet) {
    const [, status] = checks[checks.length - 1];
    process.stderr.write(`  ${String(done).padStart(2)} ${status.slice(0, 4)}  ${name}\n`);
  }
};

/** A fresh page, watched for console errors, with the slideshow enhanced. */
async function open(opts, { reducedMotion } = {}) {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  if (reducedMotion) await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setContent(slideshowPage(opts), { waitUntil: 'load' });
  // The script runs on load and enhances synchronously; a tick makes sure.
  await page.waitForFunction(() => document.querySelector('.tgs-slideshow.is-live') !== null, {
    timeout: 2000,
  });
  return { page, errors };
}

const currentIndex = (page) =>
  page.evaluate(() => {
    const slides = [...document.querySelectorAll('.tgs-slideshow__slide')];
    return slides.findIndex((s) => s.classList.contains('is-current'));
  });

// --- It takes over and builds the controls --------------------------------

{
  const { page, errors } = await open({ transition: 'fade' });

  await check('the script takes the slideshow live', async () =>
    (await page.locator('.tgs-slideshow.is-live').count()) === 1);

  await check('it builds two arrows', async () =>
    (await page.locator('.tgs-slideshow__arrow').count()) === 2);

  await check('it builds a dot button per slide', async () =>
    (await page.locator('.tgs-slideshow__dotbtn').count()) === 3);

  await check('it builds a pause button, playing to start', async () => {
    const toggle = page.locator('.tgs-slideshow__toggle');
    return (await toggle.count()) === 1 && (await toggle.getAttribute('data-state')) === 'playing';
  });

  await check('it hides the decorative CSS dots', async () =>
    (await page.locator('.tgs-slideshow__dots').first().isHidden()) === true);

  await check('the first slide is the one showing', async () =>
    (await currentIndex(page)) === 0);

  await check('every control it builds is a labelled button', async () => {
    const unnamed = await page.evaluate(() => {
      const hits = [];
      for (const el of document.querySelectorAll(
        '.tgs-slideshow__arrow, .tgs-slideshow__dotbtn, .tgs-slideshow__toggle',
      )) {
        if (el.tagName !== 'BUTTON' || !el.getAttribute('aria-label')) hits.push(el.className);
      }
      return hits;
    });
    return unnamed.length === 0 ? true : `unnamed: ${JSON.stringify(unnamed)}`;
  });

  await check('a screen reader is told which slide shows', async () => {
    const status = page.locator('.tgs-slideshow__status');
    return (
      (await status.getAttribute('aria-live')) === 'polite' &&
      /Slide 1 of 3/.test((await status.textContent()) ?? '')
    );
  });

  await check('no console error building the controls', async () =>
    errors.length === 0 ? true : errors.join(' | '));

  await page.close();
}

// --- The arrows and dots move it ------------------------------------------

{
  const { page } = await open({ transition: 'slide' });

  await check('next moves to the second slide', async () => {
    await page.locator('.tgs-slideshow__arrow--next').click();
    return (await currentIndex(page)) === 1
      ? (await page.locator('.tgs-slideshow').getAttribute('data-dir')) === 'next'
      : `index is ${await currentIndex(page)}`;
  });

  await check('the matching dot is marked current', async () =>
    (await page.locator('.tgs-slideshow__dotbtn').nth(1).getAttribute('aria-current')) === 'true');

  await check('prev from the first slide wraps to the last', async () => {
    // Back to the first, then one more prev.
    await page.locator('.tgs-slideshow__arrow--prev').click();
    await page.locator('.tgs-slideshow__arrow--prev').click();
    return (await currentIndex(page)) === 2
      ? (await page.locator('.tgs-slideshow').getAttribute('data-dir')) === 'prev'
      : `index is ${await currentIndex(page)}`;
  });

  await check('a dot jumps straight to its slide', async () => {
    await page.locator('.tgs-slideshow__dotbtn').nth(0).click();
    return (await currentIndex(page)) === 0 ? true : `index is ${await currentIndex(page)}`;
  });

  await page.close();
}

// --- Autoplay, and the pause button ---------------------------------------

{
  const { page } = await open({ transition: 'fade' });

  await check('it advances on its own', async () => {
    const before = await currentIndex(page);
    await page.waitForTimeout(1400);
    const after = await currentIndex(page);
    return after !== before ? true : `stuck on slide ${before}`;
  });

  await check('pause stops it, and says so', async () => {
    const toggle = page.locator('.tgs-slideshow__toggle');
    await toggle.click();
    // Clicking focuses and hovers the button, which would pause it anyway; step
    // the pointer off and blur so only the pause flag is holding it still.
    await page.mouse.move(450, 690);
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    const state = await toggle.getAttribute('data-state');
    const pressed = await toggle.getAttribute('aria-pressed');
    const at = await currentIndex(page);
    await page.waitForTimeout(1400);
    const still = await currentIndex(page);
    if (state !== 'paused' || pressed !== 'true') return `state ${state}, pressed ${pressed}`;
    return still === at ? true : `moved from ${at} to ${still} while paused`;
  });

  await check('play starts it again', async () => {
    const toggle = page.locator('.tgs-slideshow__toggle');
    await toggle.click();
    // Clicking leaves the pointer over the slideshow, and hover pauses it just
    // as it should; step off so autoplay is free to resume.
    await page.mouse.move(450, 690);
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    const before = await currentIndex(page);
    await page.waitForTimeout(1400);
    return (await currentIndex(page)) !== before ? true : `stuck on slide ${before}`;
  });

  await page.close();
}

// --- Reduced motion: no autoplay, but the buttons still work --------------

{
  const { page } = await open({ transition: 'fade' }, { reducedMotion: true });

  await check('reduced motion does not autoplay', async () => {
    const before = await currentIndex(page);
    await page.waitForTimeout(1400);
    return (await currentIndex(page)) === before ? true : `moved to ${await currentIndex(page)}`;
  });

  await check('reduced motion still lets the arrows work', async () => {
    await page.locator('.tgs-slideshow__arrow--next').click();
    return (await currentIndex(page)) === 1 ? true : `index is ${await currentIndex(page)}`;
  });

  await page.close();
}

// --- The author's toggles are honoured ------------------------------------

{
  const { page } = await open({ transition: 'fade', arrows: false, dots: false });

  await check('arrows off means no arrows', async () =>
    (await page.locator('.tgs-slideshow__arrow').count()) === 0);

  await check('dots off means no dot buttons', async () =>
    (await page.locator('.tgs-slideshow__dotbtn').count()) === 0);

  await check('the pause button is there even so (WCAG 2.2.2)', async () =>
    (await page.locator('.tgs-slideshow__toggle').count()) === 1);

  await page.close();
}

// --- The section background as a slideshow (Andy's original ask) -----------

/**
 * A section whose background is three pictures, the markup PageRenderer writes
 * for a background slideshow: a covering stack behind the scrim and the words.
 * Pure CSS, no script, no controls.
 */
function sectionBgPage() {
  const slides = [0, 1, 2]
    .map(
      (i) =>
        `<img class="tgs-section__bgslide" src="${PIXEL}" alt="" aria-hidden="true" ` +
        `style="animation-delay: calc(${i} * var(--tgs-ss-cycle) / 3)" />`,
    )
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head>
<body><div class="tgs-page"><section class="tgs-section" data-tone="dark"
    style="--tgs-pad: 80px; --tgs-min-h: 420px; --tgs-scrim: 60">
  <div class="tgs-section__bgshow" aria-hidden="true" data-transition="fade" data-count="3"
       style="--tgs-ss-cycle: 9s">${slides}</div>
  <div class="tgs-section__scrim" aria-hidden="true"></div>
  <div class="tgs-section__inner"><h1>Tailor-made Greece</h1></div>
</section></div></body></html>`;
}

async function openSection({ reducedMotion } = {}) {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.emulateMedia({ reducedMotion: reducedMotion ? 'reduce' : 'no-preference' });
  await page.setContent(sectionBgPage(), { waitUntil: 'load' });
  return { page, errors };
}

{
  const { page, errors } = await openSection();

  await check('the background becomes a covering, cycling stack', async () => {
    const show = page.locator('.tgs-section__bgshow');
    if ((await show.count()) !== 1) return 'no bgshow';
    if ((await page.locator('.tgs-section__bgslide').count()) !== 3) return 'wrong slide count';
    const pos = await show.evaluate((el) => getComputedStyle(el).position);
    return pos === 'absolute' ? true : `position is ${pos}`;
  });

  await check('the slides actually animate', async () => {
    const name = await page
      .locator('.tgs-section__bgslide')
      .first()
      .evaluate((el) => getComputedStyle(el).animationName);
    return name && name !== 'none' ? true : `animation-name is ${name}`;
  });

  await check('the scrim sits over the pictures, the words over the scrim', async () => {
    const z = await page.evaluate(() => ({
      show: getComputedStyle(document.querySelector('.tgs-section__bgshow')).zIndex,
      scrim: getComputedStyle(document.querySelector('.tgs-section__scrim')).zIndex,
      inner: getComputedStyle(document.querySelector('.tgs-section__inner')).zIndex,
    }));
    return z.show === '0' && z.scrim === '1' && z.inner === '2'
      ? true
      : `z-order ${JSON.stringify(z)}`;
  });

  await check('the background covers the section, not an aspect-ratio box', async () => {
    const fit = await page.evaluate(() => {
      const section = document.querySelector('.tgs-section').getBoundingClientRect();
      const show = document.querySelector('.tgs-section__bgshow').getBoundingClientRect();
      return Math.abs(section.height - show.height) < 2 && Math.abs(section.width - show.width) < 2;
    });
    return fit === true ? true : 'the stack does not fill the section';
  });

  await check('no console error on the background slideshow', async () =>
    errors.length === 0 ? true : errors.join(' | '));

  await page.close();
}

{
  const { page } = await openSection({ reducedMotion: true });

  await check('reduced motion shows one still picture, no cycle', async () => {
    const state = await page.evaluate(() => {
      const slides = [...document.querySelectorAll('.tgs-section__bgslide')];
      return {
        name: getComputedStyle(slides[0]).animationName,
        first: getComputedStyle(slides[0]).opacity,
        second: getComputedStyle(slides[1]).opacity,
      };
    });
    if (state.name !== 'none') return `still animating: ${state.name}`;
    return state.first === '1' && state.second === '0'
      ? true
      : `opacities ${state.first} / ${state.second}`;
  });

  await page.close();
}

await browser.close();

let failed = false;
for (const [name, status] of checks) {
  if (!status.startsWith('PASS')) failed = true;
  console.log(`${status.padEnd(28)} ${name}`);
}
const passes = checks.filter(([, s]) => s.startsWith('PASS')).length;
console.log(`\n${passes}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
