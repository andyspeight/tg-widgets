/**
 * Does A7 actually stop DOWNLOADING the film for somebody who will not see it?
 *
 * A background video has been hidden under reduced motion by one CSS rule for a long
 * time, and hidden reads like solved. It is not: `display: none` does not stop a
 * fetch, so the visitor who asked for less motion was still paying for every byte of
 * a film they would never see a frame of. The only way to know which it is doing is
 * to count requests in a real browser, which is what this does.
 *
 * It also holds the other half: that the film still plays normally for everybody
 * else. A gate that saves the download by never showing the video to anyone would
 * pass a naive check and fail the point.
 *
 *   node tools/verify-motion-video.mjs
 */

import { chromium } from 'playwright';

const CHROMIUM = process.env.TG_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ORIGIN = 'https://tg-motion-probe.test';

/* The two shapes the renderer emits: today's plain src, and A7's gated source. */
const PLAIN = '<video class="tgs-section__bg tgs-section__bg--video" src="/hero.mp4"'
  + ' poster="/poster.svg" autoplay muted loop playsinline aria-hidden="true" tabindex="-1"></video>';
const GATED = '<video class="tgs-section__bg tgs-section__bg--video"'
  + ' poster="/poster.svg" autoplay muted loop playsinline aria-hidden="true" tabindex="-1">'
  + '<source src="/hero.mp4" media="(prefers-reduced-motion: no-preference)"></video>';

const browser = await chromium.launch({ executablePath: CHROMIUM });
const problems = [];
const lines = [];

async function count(markup, reduced) {
  const page = await browser.newPage({
    reducedMotion: reduced ? 'reduce' : 'no-preference',
  });
  let requests = 0;
  await page.route(`${ORIGIN}/`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<!doctype html><html><body>${markup}</body></html>`,
    }));
  await page.route(`${ORIGIN}/hero.mp4`, (route) => {
    requests += 1;
    route.fulfill({ status: 200, contentType: 'video/mp4', body: Buffer.alloc(4096) });
  });
  await page.route(`${ORIGIN}/poster.svg`, (route) =>
    route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"/>' }));

  await page.goto(`${ORIGIN}/`, { waitUntil: 'load' });
  await page.waitForTimeout(900);
  const picked = await page.evaluate(() => {
    const v = document.querySelector('video');
    return { currentSrc: v.currentSrc };
  });
  await page.close();
  return { requests, picked: picked.currentSrc };
}

const plainNormal = await count(PLAIN, false);
const plainReduced = await count(PLAIN, true);
const gatedNormal = await count(GATED, false);
const gatedReduced = await count(GATED, true);

lines.push(`  plain src   : normal ${plainNormal.requests} request(s), reduced ${plainReduced.requests} request(s)`);
lines.push(`  A7 gated    : normal ${gatedNormal.requests} request(s), reduced ${gatedReduced.requests} request(s)`);

/* The saving, which is the whole reason the recipe exists. */
if (gatedReduced.requests !== 0) {
  problems.push(
    `A7 still fetched the film ${gatedReduced.requests} time(s) under reduced motion, so the `
    + 'gate is not saving anybody the download',
  );
}

/* And the half that is easy to break while chasing the saving. */
if (gatedNormal.requests === 0) {
  problems.push(
    'A7 never fetched the film even for a visitor happy with motion, so the hero is a '
    + 'still picture for everybody and the recipe does nothing',
  );
}
if (!gatedNormal.picked) {
  problems.push('A7 selected no source for a visitor happy with motion, so nothing would play');
}

/*
 * The comparison is the evidence for the change, so it is asserted rather than just
 * printed. If a browser ever stops fetching a hidden plain src, this recipe has lost
 * its reason and somebody should know.
 */
if (plainReduced.requests === 0) {
  problems.push(
    'a plain src no longer downloads under reduced motion, so A7 gains nothing here any '
    + 'more and the trade should be revisited',
  );
}

await browser.close();

if (problems.length) {
  console.error('\n  A7 video check FAILED:');
  for (const problem of problems) console.error(`    - ${problem}`);
  console.error(`\n${lines.join('\n')}\n`);
  process.exit(1);
}

console.log('  PASS  A7 plays for anyone who wants it and is never downloaded by anyone who does not');
console.log(lines.join('\n'));
