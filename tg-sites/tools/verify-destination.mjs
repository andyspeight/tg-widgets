/**
 * The destination panel, drawn in a real browser and checked for the one class
 * of fault a unit test cannot see: a colour nobody can make out.
 *
 * WHY THIS EXISTS. The first version of the climate chart tinted its shoulder
 * months with `color-mix(in srgb, var(--tgs-accent) 42%, var(--tgs-bg))`. Every
 * unit test passed: the payload validated, twelve months came back, the heights
 * were right. Rendered on a light theme it drew NOTHING for March and April,
 * because 42 per cent of a terracotta mixed into cream lands within a shade of
 * the cream. Two of the twelve months simply were not there, and the legend
 * swatch that explained them was invisible too.
 *
 * So this renders the panel against the BUILT stylesheet and asks the questions
 * a person would: is every month drawn, is each season a different colour from
 * the other two, and does each one stand out from the ground it sits on.
 *
 * Run it after `npx next build`, like every other browser check here. It reads
 * the built stylesheet rather than globals.css for the same reason the perf
 * harness does: the source is not what a visitor gets.
 */

import { chromium } from 'playwright';
import * as esbuild from 'esbuild';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
/* The same resolution every other browser check here uses. */
const CHROMIUM = process.env.TG_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const bundle = resolve(root, '.next/cache/verify-destination.cjs');

/** The biggest built stylesheet is the site's; the smaller ones are the tool's own screens. */
function builtCss() {
  const dir = resolve(root, '.next/static/css');
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.css'))
    .map((name) => ({ name, size: statSync(resolve(dir, name)).size }))
    .sort((a, b) => b.size - a.size);
  if (!files.length) throw new Error('No built CSS. Run: npx next build');
  return readFileSync(resolve(dir, files[0].name), 'utf8');
}

/*
 * TWO THEMES, BECAUSE THE BUG THIS FILE EXISTS FOR ONLY APPEARED IN ONE.
 *
 * The invisible shoulder months were `color-mix(..., var(--tgs-bg))` on a CREAM
 * ground. Against the stylesheet's own default tokens the same rule draws
 * something perfectly visible, so a check that rendered with no theme passed the
 * broken build. Proved by reintroducing the bug: it still said PASS.
 *
 * So the panel is drawn once per theme and every check runs against each. These
 * two are the extremes a client site actually reaches: a warm light ground with
 * a mid accent, and a dark one.
 */
const THEMES = {
  'the light cream theme': [
    '--tgs-bg:#f2efe9', '--tgs-text:#14202b', '--tgs-text-muted:#5b6770',
    '--tgs-accent:#c4552f', '--tgs-border:#d7d5d0', '--tgs-border-strong:#c1c0bc',
  ].join(';'),
  'the dark theme': [
    '--tgs-bg:#101820', '--tgs-text:#e8ebe8', '--tgs-text-muted:#96a3ad',
    '--tgs-accent:#e08a68', '--tgs-border:#2a343d', '--tgs-border-strong:#3c4750',
  ].join(';'),
  /*
   * A REAL TENANT THEME, WHICH IS SPARSER THAN THE DEFAULTS, and this is the one
   * that catches the bug. Coastwise's token set does not define --tgs-bg at all.
   *
   * WHY THAT WAS FATAL RATHER THAN MERELY UNTIDY. A var() that cannot be
   * substituted makes the whole declaration invalid AT COMPUTED-VALUE TIME, and
   * the property then takes its INITIAL value. It does not fall back to the
   * earlier declaration in the cascade, which is what everyone expects it to do.
   * So `background: color-mix(in srgb, var(--tgs-accent) 42%, var(--tgs-bg))`
   * did not come out grey from the base rule above it; it came out transparent,
   * and two months of the year were simply not on the page.
   *
   * Any rule here that reads a token a client theme might not carry has the same
   * hole in it, so this theme deliberately carries only what a real one does.
   */
  'a real tenant theme (sparse tokens)': ['--tgs-accent:#c8452c', '--tgs-border-strong:#c1c0bc', '--tgs-text:#14202b'].join(';'),
};

/* A country with all three seasons in its year, so every colour is on the page. */
const GREECE = {
  __ref: {
    kind: 'country',
    sourceId: 'recVerify',
    flightTime: '3h 45m',
    timeZone: 'GMT +2',
    currency: 'Euro (€)',
    language: 'Greek',
    voltage: '230V · Type F',
    bestFor: ['Couples', 'Island hopping'],
    climate: {
      temps: [13, 13, 15, 19, 24, 29, 32, 32, 28, 23, 18, 15],
      rainfall: [62, 50, 44, 26, 15, 6, 4, 6, 13, 52, 68, 78],
      season: ['off', 'off', 'shoulder', 'shoulder', 'best', 'best', 'best', 'best', 'best', 'shoulder', 'off', 'off'],
    },
  },
};

await esbuild.build({
  stdin: {
    contents: `
      import { renderToStaticMarkup } from 'react-dom/server';
      import { DestinationPanel } from './components/render/DestinationPanel';
      import { referenceFacts } from './lib/content/reference';
      export function render(payload) {
        const facts = referenceFacts(payload);
        if (!facts) throw new Error('the fixture did not validate');
        return renderToStaticMarkup(DestinationPanel({ facts }));
      }`,
    resolveDir: root,
    loader: 'tsx',
  },
  bundle: true, format: 'cjs', platform: 'node', target: ['node20'], jsx: 'automatic',
  outfile: bundle,
  external: ['react', 'react-dom', 'react-dom/server', 'react/jsx-runtime'],
  alias: { 'server-only': resolve(root, 'tests/stubs/server-only.ts') },
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'warning',
});

const { render } = createRequire(import.meta.url)(bundle);
const css = builtCss();
const panel = render(GREECE);

const browser = await chromium.launch({ executablePath: CHROMIUM });
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });

/** What is actually behind an element: the nearest ancestor that paints. */
const GROUND_OF = `(node) => {
  for (let el = node; el; el = el.parentElement) {
    const paint = getComputedStyle(el).backgroundColor;
    const alpha = (paint.match(/[\d.]+/g) ?? [])[3];
    if (paint && paint !== 'transparent' && alpha !== '0') return paint;
  }
  return 'rgb(255,255,255)';
}`;

const looks = {};
for (const [name, tokens] of Object.entries(THEMES)) {
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"><style>${css}
     html,body{margin:0}main{padding:32px}</style></head>
     <body><main class="tgs-page" style="${tokens}">${panel}</main></body></html>`,
    { waitUntil: 'load' },
  );

  looks[name] = await page.evaluate((groundSource) => {
    const groundOf = eval(groundSource);
    const bars = [...document.querySelectorAll('.tgs-dest__bar')].map((bar) => {
      const box = bar.getBoundingClientRect();
      const row = bar.closest('.tgs-dest__month');
      return {
        season: row?.getAttribute('data-season') ?? '',
        width: Math.round(box.width),
        height: Math.round(box.height),
        fill: getComputedStyle(bar).backgroundColor,
        ground: groundOf(bar.parentElement),
      };
    });
    const key = [...document.querySelectorAll('.tgs-dest__key-item')].map((item) => ({
      season: item.getAttribute('data-season') ?? '',
      fill: getComputedStyle(item, '::before').backgroundColor,
      ground: groundOf(item),
    }));
    return { bars, key };
  }, GROUND_OF);
}

await browser.close();
rmSync(bundle, { force: true });

/** An rgb()/rgba() string as numbers, alpha composited onto the ground behind it. */
function onGround(colour, ground) {
  const read = (value) => (value.match(/[\d.]+/g) ?? []).map(Number);
  const [gr = 255, gg = 255, gb = 255] = read(ground);
  const [r = 0, g = 0, b = 0, a = 1] = read(colour);
  return [r * a + gr * (1 - a), g * a + gg * (1 - a), b * a + gb * (1 - a)];
}

const apart = (one, two) =>
  Math.sqrt(one.reduce((sum, value, i) => sum + (value - two[i]) ** 2, 0));

const problems = [];
const MIN_APART = 40;
let seasonsSeen = 0;

for (const [theme, seen] of Object.entries(looks)) {
  const where = `on ${theme}`;

  if (seen.bars.length !== 12) {
    problems.push(`Expected twelve months ${where}, drew ${seen.bars.length}.`);
  }

  for (const [i, bar] of seen.bars.entries()) {
    if (bar.width < 2 || bar.height < 2) {
      problems.push(`Month ${i + 1} (${bar.season}) drew nothing ${where}: ${bar.width}x${bar.height}px.`);
    }
    /*
     * TRANSPARENT IS THE SIGNATURE OF A TOKEN THE THEME HAS NOT GOT. A var()
     * that cannot resolve invalidates its declaration at computed-value time and
     * the property falls to its initial value rather than to the rule above it,
     * so a bar with no colour at all almost always means a rule reading a token
     * this theme does not define. Worth its own message, because "invisible" and
     * "you named a token that is not there" send you to different places.
     */
    const alpha = (bar.fill.match(/[\d.]+/g) ?? [])[3];
    if (bar.fill === 'transparent' || alpha === '0') {
      problems.push(
        `Month ${i + 1} (${bar.season}) has no colour at all ${where}. `
        + 'That is what an unresolvable var() computes to, so check the rule for a token this theme does not define.',
      );
    }
  }

  /*
   * EVERY SEASON A DIFFERENT COLOUR FROM WHAT IS BEHIND IT, and from the other
   * two. A plain Euclidean distance in sRGB rather than a contrast ratio, because
   * these are blocks of colour beside each other rather than text on a ground,
   * and 40 is comfortably past "is that the same colour or not".
   */
  const fills = new Map();
  for (const bar of seen.bars) {
    if (bar.season) fills.set(bar.season, { fill: onGround(bar.fill, bar.ground), ground: onGround(bar.ground, 'rgb(255,255,255)') });
  }
  seasonsSeen = fills.size;

  for (const [season, { fill, ground }] of fills) {
    const distance = apart(fill, ground);
    if (distance < MIN_APART) {
      problems.push(
        `The ${season} months are invisible ${where}: their fill is ${Math.round(distance)} from what is behind them (needs ${MIN_APART}).`,
      );
    }
  }

  const seasons = [...fills.keys()];
  for (let i = 0; i < seasons.length; i += 1) {
    for (let j = i + 1; j < seasons.length; j += 1) {
      const distance = apart(fills.get(seasons[i]).fill, fills.get(seasons[j]).fill);
      if (distance < MIN_APART) {
        problems.push(
          `${seasons[i]} and ${seasons[j]} are the same colour ${where} (${Math.round(distance)} apart), so the chart says nothing.`,
        );
      }
    }
  }

  /* The key has to match the bars it explains, or it explains the wrong thing. */
  for (const item of seen.key) {
    const bar = fills.get(item.season);
    if (!bar) continue;
    const distance = apart(onGround(item.fill, item.ground), bar.fill);
    if (distance > 12) {
      problems.push(`The key's ${item.season} swatch does not match its bars ${where} (${Math.round(distance)} apart).`);
    }
  }
}

if (problems.length) {
  console.error('\n  The destination panel has problems a reader would see:\n');
  for (const problem of problems) console.error(`    - ${problem}`);
  console.error('');
  process.exit(1);
}

console.log(
  `\n  PASS  destination panel: twelve months drawn, ${seasonsSeen} seasons legible and distinct on ${Object.keys(looks).length} themes\n`,
);
