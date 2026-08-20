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
    <section class="tgs-section" data-tone="light" data-motion="${recipe}"
             data-motion-intensity="${intensity}" style="position:relative;min-height:320px">
      <img class="tgs-section__bg" alt="" src="${swatch('888888')}"
           style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">
      <div class="tgs-section__inner">
        <div class="tgs-cards">${card('444444')}${card('555555')}${card('666666')}</div>
      </div>
    </section>
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

await browser.close();

if (problems.length) {
  console.error('\n  Motion recipe check FAILED:');
  for (const problem of problems) console.error(`    - ${problem}`);
  console.error(`\n${lines.join('\n')}\n`);
  process.exit(1);
}

console.log('  PASS  every live motion recipe moves, desynchronises and stops for reduced motion');
console.log(lines.join('\n'));
