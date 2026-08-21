/**
 * Do the motion recipes actually MOVE, in a real browser?
 *
 * Same question tools/verify-motion.mjs asks of the reveal, and it is asked again
 * here for the same reason: a stylesheet check proves an animation is ATTACHED, not
 * that it PLAYS. The reveal stayed green for days while nothing moved on the real
 * site, and unit tests could not have caught it.
 *
 * The specific risk here is different from the reveal's. Both recipes take their
 * amplitude, and A6 its duration, from CUSTOM PROPERTIES read inside @keyframes:
 *
 *     @keyframes tgs-motion-ambient-drift { from { transform: scale(var(--tgs-motion-from)); } }
 *
 * That resolves per keyframe rather than being animated itself, which works, but it
 * fails silently when it does not: an undeclared property makes the transform
 * invalid and the element simply sits there. A duration from an undeclared property
 * is worse, because the animation is listed in the computed style with a duration of
 * 0s and every "is it attached" check passes while nothing has ever moved.
 *
 * So this drives the real thing: it loads globals.css into a page shaped like a
 * rendered section, samples the computed transform, waits, and samples again.
 *
 *   node tools/verify-motion-recipes.mjs
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHROMIUM = process.env.TG_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const css = readFileSync(join(HERE, '..', 'app', 'globals.css'), 'utf8');

/* A flat grey, so a moving picture is measurable without fetching anything. */
const swatch = (hex) =>
  `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Crect width='40' height='40' fill='%23${hex}'/%3E%3C/svg%3E`;

/*
 * A section the way PageRenderer emits one: the background picture the A-family
 * background recipes drive, and a card grid whose framed pictures A5 drives.
 */
function html(recipe, intensity) {
  const card = (hex) =>
    `<div class="tgs-card"><div class="tgs-card__frame" style="width:200px;height:120px">`
    + `<img alt="" src="${swatch(hex)}" style="width:100%;height:100%;object-fit:cover"></div></div>`;

  return `<!doctype html><html><head><style>${css}</style></head><body>
  <div class="tgs-page">
    <div style="height:1400px">spacer, so the section starts below the fold</div>
    <section class="tgs-section" data-tone="light" data-motion="${recipe}"
             data-motion-intensity="${intensity}" style="position:relative;min-height:320px">
      <img class="tgs-section__bg" alt="" src="${swatch('888888')}"
           style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">
      <div class="tgs-section__inner">
        <div class="tgs-block"><h2 style="font-size:44px;line-height:0.92;margin:0">Gorgeous Gy quay</h2></div>
        <div class="tgs-block"><p style="margin:0">Second block, for the stagger.</p></div>
        <div class="tgs-block"><p style="margin:0">Third block, for the stagger.</p></div>
        <div class="tgs-cards">${card('444444')}${card('555555')}${card('666666')}</div>
      </div>
    </section>
    <div style="height:1600px">tail, so there is room to scroll the section up</div>
  </div></body></html>`;
}

const browser = await chromium.launch({ executablePath: CHROMIUM });

async function probe({ recipe, intensity, selector, reduced }) {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 900 },
    reducedMotion: reduced ? 'reduce' : 'no-preference',
  });
  await page.setContent(html(recipe, intensity), { waitUntil: 'load' });
  await page.waitForTimeout(150);

  const sample = () =>
    page.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return {
        transform: cs.transform,
        name: cs.animationName,
        duration: cs.animationDuration,
        direction: cs.animationDirection,
      };
    }, selector);

  const first = await sample();
  await page.waitForTimeout(1500);
  const second = await sample();
  await page.close();

  if (!first) throw new Error(`nothing matched ${selector}`);
  return { first, second, moved: first.transform !== second.transform };
}

const problems = [];
const lines = [];

/* Both live recipes, at every intensity band, must genuinely move. */
for (const [recipe, selector] of [
  ['A6', '.tgs-section__bg'],
  ['A5', '.tgs-card:nth-child(1) .tgs-card__frame img'],
]) {
  for (const intensity of [1, 2, 3]) {
    const r = await probe({ recipe, intensity, selector, reduced: false });
    lines.push(`  ${recipe} intensity ${intensity}: ${r.first.transform} -> ${r.second.transform}`);

    if (!r.moved) {
      problems.push(
        `${recipe} at intensity ${intensity} never moved (${r.first.transform}). `
        + `animation-name ${r.first.name}, duration ${r.first.duration}: a duration of 0s means `
        + 'the custom property it reads is not declared for this band.',
      );
    }
    if (r.first.duration === '0s') {
      problems.push(`${recipe} at intensity ${intensity} has a duration of 0s, so it can never play`);
    }
    if (r.first.transform === 'none') {
      problems.push(
        `${recipe} at intensity ${intensity} computed transform: none, so a var() in its `
        + 'keyframes did not resolve',
      );
    }
  }
}

/*
 * A5 desynchronises across the set. Identical durations across a grid is the tell
 * the catalogue warns about, so it is worth asserting rather than trusting.
 */
const durations = [];
for (const n of [1, 2, 3]) {
  const r = await probe({
    recipe: 'A5', intensity: 2, reduced: false,
    selector: `.tgs-card:nth-child(${n}) .tgs-card__frame img`,
  });
  durations.push(r.first.duration);
}
lines.push(`  A5 durations across the set: ${durations.join(', ')}`);
if (new Set(durations).size !== durations.length) {
  problems.push(
    `A5 runs the same duration on more than one card (${durations.join(', ')}), `
    + 'so the set will visibly sync up',
  );
}

/* Reduced motion: a still, finished page, never a half-played one. */
for (const [recipe, selector] of [
  ['A6', '.tgs-section__bg'],
  ['A5', '.tgs-card:nth-child(1) .tgs-card__frame img'],
]) {
  const r = await probe({ recipe, intensity: 2, selector, reduced: true });
  lines.push(`  ${recipe} reduced motion: ${r.first.transform} (${r.first.name})`);
  if (r.moved || r.first.name !== 'none') {
    problems.push(
      `${recipe} still animates under prefers-reduced-motion (name ${r.first.name}), `
      + 'which is the one guard nothing may skip',
    );
  }
  if (r.first.transform !== 'none') {
    problems.push(
      `${recipe} under reduced motion sits at ${r.first.transform} rather than untouched, `
      + 'so the visitor gets a picture frozen part-way through a move',
    );
  }
}

/*
 * THE SCROLL-STEERED RECIPES need the page moved, not just time passed. This opens
 * the same harness, samples with the section below the fold, scrolls it up, and
 * samples again. A recipe that reports the same value at both ends is not steering.
 */
async function probeScrolled({ recipe, intensity, selector, reduced, read }) {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 900 },
    reducedMotion: reduced ? 'reduce' : 'no-preference',
  });
  await page.setContent(html(recipe, intensity), { waitUntil: 'load' });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  const before = await page.evaluate(read, selector);

  await page.evaluate(() => {
    const section = document.querySelector('.tgs-section');
    window.scrollTo(0, section.offsetTop - window.innerHeight * 0.15);
  });
  await page.waitForTimeout(300);
  const after = await page.evaluate(read, selector);
  await page.close();
  return { before, after };
}

const readClip = (s) => {
  const el = document.querySelector(s);
  const cs = getComputedStyle(el);
  return {
    clip: cs.clipPath,
    name: cs.animationName,
    padBottom: cs.paddingBottom,
    marginBottom: cs.marginBottom,
  };
};
const readScale = (s) => {
  const cs = getComputedStyle(document.querySelector(s));
  return { transform: cs.transform, name: cs.animationName, timeline: cs.animationTimeline };
};

/* S1 tide-reveal: clipped to nothing below the fold, fully open once scrolled to. */
for (const intensity of [1, 2, 3]) {
  const r = await probeScrolled({
    recipe: 'S1', intensity, reduced: false,
    selector: '.tgs-block:nth-child(1)', read: readClip,
  });
  lines.push(`  S1 intensity ${intensity}: ${r.before.clip}  ->  ${r.after.clip}`);
  if (r.before.clip === r.after.clip) {
    problems.push(
      `S1 at intensity ${intensity} reported the same clip-path before and after scrolling `
      + `(${r.before.clip}), so the wipe is not steering off the scroll`,
    );
  }
  if (!/100%/.test(r.before.clip)) {
    problems.push(
      `S1 at intensity ${intensity} was already open below the fold (${r.before.clip}), `
      + 'so nothing is being held back to wipe',
    );
  }
}

/*
 * THE DESCENDER TRAP, lesson 2 in the catalogue: a mask plus tight display type eats
 * the tails of g, q and y. The fix is padding the clipped box and taking the same
 * amount back in negative margin, so this checks the two actually cancel (the layout
 * is where it was) and that the end state opens the padded box rather than the bare
 * text box.
 */
{
  const r = await probeScrolled({
    recipe: 'S1', intensity: 2, reduced: false,
    selector: '.tgs-block:nth-child(1)', read: readClip,
  });
  const pad = parseFloat(r.after.padBottom);
  const margin = parseFloat(r.after.marginBottom);
  lines.push(`  S1 descender room: padding-bottom ${r.after.padBottom}, margin-bottom ${r.after.marginBottom}`);
  if (!(pad > 0)) {
    problems.push('S1 has no padding under the clipped box, so a tight heading will lose its descenders');
  }
  if (Math.abs(pad + margin) > 0.5) {
    problems.push(
      `S1's descender padding (${r.after.padBottom}) is not cancelled by its margin `
      + `(${r.after.marginBottom}), so it has shifted the layout`,
    );
  }
}

/* S5 scrub-scale: over-scaled below the fold, settled to rest once scrolled to. */
for (const intensity of [1, 2, 3]) {
  const r = await probeScrolled({
    recipe: 'S5', intensity, reduced: false,
    selector: '.tgs-section__bg', read: readScale,
  });
  lines.push(`  S5 intensity ${intensity}: ${r.before.transform} -> ${r.after.transform}`);
  if (r.before.transform === r.after.transform) {
    problems.push(
      `S5 at intensity ${intensity} did not change on scroll (${r.before.transform}), `
      + 'so it is not settling',
    );
  }
  if (r.before.transform === 'none') {
    problems.push(`S5 at intensity ${intensity} had no over-scale to settle from`);
  }
}

/* S3 sticky-stack: the cards pin, and each pins a little lower than the last. */
{
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await page.setContent(html('S3', 2), { waitUntil: 'load' });
  await page.waitForTimeout(200);
  const stack = await page.evaluate(() =>
    [...document.querySelectorAll('.tgs-cards > .tgs-card')].map((c) => {
      const cs = getComputedStyle(c);
      return { position: cs.position, top: cs.top };
    }));
  await page.close();

  lines.push(`  S3 cards: ${stack.map((c) => `${c.position}@${c.top}`).join(', ')}`);
  if (!stack.every((c) => c.position === 'sticky')) {
    problems.push(
      `S3 did not make the cards sticky (${stack.map((c) => c.position).join(', ')}). `
      + 'An overflow:hidden ancestor is the usual cause, since it becomes the scroll container.',
    );
  }
  const tops = stack.map((c) => parseFloat(c.top));
  if (!tops.every((t, i) => i === 0 || t > tops[i - 1])) {
    problems.push(
      `S3's cards all pin at the same height (${stack.map((c) => c.top).join(', ')}), `
      + 'so they land on top of each other instead of stacking',
    );
  }
}

/* Reduced motion, for all three: still, and structurally back to normal. */
for (const [recipe, selector, read, key] of [
  ['S1', '.tgs-block:nth-child(1)', readClip, 'clip'],
  ['S5', '.tgs-section__bg', readScale, 'transform'],
]) {
  const r = await probeScrolled({ recipe, intensity: 2, selector, read, reduced: true });
  lines.push(`  ${recipe} reduced motion: ${r.before[key]} (${r.before.name})`);
  if (r.before.name !== 'none' || r.before[key] !== r.after[key]) {
    problems.push(`${recipe} still moves under prefers-reduced-motion (${r.before.name})`);
  }
  if (key === 'clip' && r.before.clip !== 'none') {
    problems.push(
      `${recipe} under reduced motion leaves the text clipped at ${r.before.clip}, `
      + 'so the words are hidden from the visitor who asked for less movement',
    );
  }
}

{
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, reducedMotion: 'reduce' });
  await page.setContent(html('S3', 2), { waitUntil: 'load' });
  await page.waitForTimeout(200);
  const positions = await page.evaluate(() =>
    [...document.querySelectorAll('.tgs-cards > .tgs-card')].map((c) => getComputedStyle(c).position));
  await page.close();
  lines.push(`  S3 reduced motion: ${positions.join(', ')}`);
  if (positions.some((p) => p === 'sticky')) {
    problems.push('S3 still pins its cards under prefers-reduced-motion, which is the one guard nothing may skip');
  }
}

await browser.close();

if (problems.length) {
  console.error('\n  Motion recipe check FAILED:');
  for (const problem of problems) console.error(`    - ${problem}`);
  console.error(`\n${lines.join('\n')}\n`);
  process.exit(1);
}

console.log('  PASS  every live motion recipe moves, desynchronises and stops for reduced motion');
console.log(lines.join('\n'));
