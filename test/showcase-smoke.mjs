/**
 * Showcase smoke test.
 *
 * The showcase runs unattended on a stand, so the things that would ruin a
 * day there are the things checked here: a hotspot that points at nothing,
 * a QR code that does not scan, a screen that never got wired up, and the
 * house copy rules.
 *
 * Structure only, no browser needed. Placement and layout are checked by
 * eye against a real render when the screens change.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUB = join(ROOT, 'public');

let failures = 0;
function check(name, ok, detail) {
  if (ok) { console.log(`  ok   ${name}`); return; }
  failures++;
  console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`);
}

console.log('showcase: files');
for (const f of ['showcase.html', 'showcase.css', 'showcase.js', 'showcase-data.js']) {
  check(f, existsSync(join(PUB, f)));
}

/* Load the data the way the browser does. */
global.window = {};
new Function(readFileSync(join(PUB, 'showcase-data.js'), 'utf8'))();
const data = global.window.TG_SHOWCASE;

console.log('showcase: data shape');
check('TG_SHOWCASE defined', !!data);
check('has products', Array.isArray(data.products) && data.products.length > 0);

for (const p of data.products) {
  console.log(`showcase: ${p.name}`);
  for (const field of ['id', 'name', 'category', 'tagline', 'summary']) {
    check(`${field} present`, typeof p[field] === 'string' && p[field].length > 0);
  }
  check('has screens', Array.isArray(p.screens) && p.screens.length > 0);

  /* Every hotspot must point at an element that exists on its own screen,
     or the dot silently vanishes and the feature goes unsold. */
  let spots = 0;
  for (const s of p.screens) {
    check(`${s.id}: has markup`, typeof s.html === 'string' && s.html.length > 0);
    check(`${s.id}: has a blurb`, typeof s.blurb === 'string' && s.blurb.length > 0);
    check(`${s.id}: has hotspots`, Array.isArray(s.hotspots) && s.hotspots.length > 0);
    for (const h of s.hotspots) {
      spots++;
      check(`${s.id} -> ${h.anchor}: anchor exists`,
        new RegExp(`data-hs="${h.anchor}"`).test(s.html));
      check(`${s.id} -> ${h.anchor}: states a feature`,
        typeof h.feature === 'string' && h.feature.length > 20);
      check(`${s.id} -> ${h.anchor}: states a benefit`,
        typeof h.benefit === 'string' && h.benefit.length > 20);
      if (h.at) {
        check(`${s.id} -> ${h.anchor}: known placement`,
          ['center', 'top-left', 'top-right', 'bottom-left', 'bottom-right',
           'outside-left', 'outside-right'].includes(h.at), h.at);
      }
    }
  }
  check('every screen carries hotspots', spots > 0, `${spots} found`);

  /* A QR that does not resolve to a committed file is a dead square of ink. */
  if (p.qr) {
    check('qr url is https', /^https:\/\//.test(p.qr.url), p.qr.url);
    check('qr svg is committed', existsSync(join(PUB, 'showcase', 'qr', `${p.id}.svg`)),
      `public/showcase/qr/${p.id}.svg — run npm run build:showcase-qr`);
  }
}

/* House style: UK English, no em dashes (CLAUDE.md brand voice). */
console.log('showcase: copy rules');
const prose = JSON.stringify(data);
check('no em dashes', !prose.includes('—'));
check('no en dash used as punctuation', !/\w – \w/.test(prose));

/* The page must stay CSP-clean: the widgets it sits beside are, and this
   page is served from the same origin. */
console.log('showcase: csp');
const js = readFileSync(join(PUB, 'showcase.js'), 'utf8');
const html = readFileSync(join(PUB, 'showcase.html'), 'utf8');
check('no eval', !/\beval\s*\(/.test(js));
check('no Function constructor', !/new\s+Function\s*\(/.test(js));
check('no inline handlers in html', !/\son[a-z]+\s*=/i.test(html));
check('data file loaded before engine',
  html.indexOf('showcase-data.js') < html.indexOf('showcase.js'));

/* Small screens. The stage holds a fixed 390x844 canvas, and fitting it to
   the HEIGHT of a split pane once rendered the mock at a third of size with
   4px text on a phone. The breakpoint lives in two files and they have to
   agree, or the CSS switches to the scrolling layout while the JS carries on
   fitting by height (or the reverse). */
console.log('showcase: small screens');
const css = readFileSync(join(PUB, 'showcase.css'), 'utf8');
const cssBp = css.match(/@media \(max-width:\s*(\d+)px\)/);
const jsBp = js.match(/var NARROW_PX = (\d+)/);
check('css has a small-screen breakpoint', !!cssBp);
check('js has a matching breakpoint', !!jsBp);
check('the two breakpoints agree', !!cssBp && !!jsBp && cssBp[1] === jsBp[1],
  `css ${cssBp?.[1]} vs js ${jsBp?.[1]}`);
check('small screens are sized by width, never height',
  /narrow[\s\S]{0,120}availW \/ PHONE_W, 1/.test(js));
check('stage padding is measured, not assumed', /paddingLeft/.test(js));

/* The whole promise of a hotspot demo is that the words and the thing are
   visible together. On a phone the panel covers half the screen, so this
   needs active help: the dot has to be put in the strip left above it, and
   the rail row must not drag the page away from the mock. */
console.log('showcase: the words and the thing');
check('the anchored element is ringed while open', /tg-lit/.test(js));
check('the ring is styled', /\.tg-lit\s*\{/.test(css));
check('the dot is scrolled into the visible strip', /function revealSpot/.test(js));
check('revealSpot measures the panel, not a guess', /getBoundingClientRect\(\)\.top[\s\S]{0,200}band/.test(js));
check('rail scrollIntoView is gated off phones',
  /fromRail \|\| window\.innerWidth > NARROW_PX\) row\.scrollIntoView/.test(js));
check('the phone panel leaves room for the mock', /max-height:\s*50vh/.test(css));

/* Routing: an unrouted page is a 404 on the day. */
console.log('showcase: routing');
const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
check('/showcase rewrite present',
  vercel.rewrites.some(r => r.source === '/showcase' && r.destination === '/showcase.html'));
for (const f of ['/showcase.js', '/showcase-data.js', '/showcase.css']) {
  check(`${f} has headers`, vercel.headers.some(h => h.source === f));
}
/* The stand points at the bare subdomain, so its root has to land on the
   showcase rather than on the widget dashboard. */
const hostRw = vercel.rewrites.find(
  r => r.source === '/' && (r.has || []).some(h => h.type === 'host'));
check('bare showcase subdomain serves the showcase',
  !!hostRw && hostRw.destination === '/showcase.html');
check('the host rewrite is evaluated first', vercel.rewrites[0] === hostRw);

/* The walkthrough. It runs unattended, so what matters is that it exists,
   that it can reach every hotspot, and that the whole thing is a length a
   person would actually stand through. */
console.log('showcase: walkthrough');
for (const fn of ['tourStart', 'tourPause', 'tourResume', 'tourGo', 'tourFinish', 'dwellFor']) {
  check(`${fn} defined`, new RegExp(`function ${fn}\\b`).test(js));
}
check('attract auto-starts the tour', /TOUR_AUTOSTART_MS/.test(js));
check('a running tour is not swept to attract',
  /state\.tour\.on && !state\.tour\.paused[\s\S]{0,80}idleTimer = null/.test(js));
check('a real touch hands control over', /function onUserInput/.test(js));
check('tour controls opt out of the auto-pause', /data-tour-ctl/.test(js));
check('tour state is readable from outside', /tourState:/.test(js));

function num(name) {
  const m = js.match(new RegExp(`var ${name} = (\\d+)`));
  return m ? Number(m[1]) : NaN;
}
const BASE = num('TOUR_BASE_MS'), PER = num('TOUR_PER_WORD_MS');
const MIN = num('TOUR_MIN_MS'), MAX = num('TOUR_MAX_MS');
check('dwell constants parse', [BASE, PER, MIN, MAX].every(n => !isNaN(n)));
check('dwell range is sane', MIN > 3000 && MAX > MIN && MAX <= 20000, `${MIN}..${MAX}`);

let totalMs = 0, steps = 0;
for (const p of data.products) {
  for (const s of p.screens) {
    for (const h of s.hotspots) {
      const words = `${h.title} ${h.feature} ${h.benefit} ${h.edge || ''}`.split(/\s+/).length;
      totalMs += Math.max(MIN, Math.min(MAX, BASE + words * PER));
      steps++;
    }
  }
}
const mins = totalMs / 60000;
console.log(`  info the full walkthrough is ${steps} steps, about ${mins.toFixed(1)} minutes`);
check('walkthrough is a length someone would stand through', mins >= 2 && mins <= 15,
  `${mins.toFixed(1)} minutes`);

console.log(failures ? `\n${failures} failing check(s)` : '\nshowcase: all checks passed');
process.exit(failures ? 1 : 0);
