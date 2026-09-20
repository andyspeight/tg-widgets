/**
 * Showcase smoke test.
 *
 * The showcase runs unattended on a stand, so this covers the things that
 * would ruin a day there: a hotspot pointing at nothing, a QR that will not
 * scan, a screen never wired up, and the house copy rules. It also pins the
 * decisions that keep the thing readable, because each of them was a real
 * fault first.
 *
 * Structure only, no browser. Layout is checked by eye against real renders
 * at kiosk and phone sizes whenever the shell changes.
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
const js = readFileSync(join(PUB, 'showcase.js'), 'utf8');
const css = readFileSync(join(PUB, 'showcase.css'), 'utf8');
const html = readFileSync(join(PUB, 'showcase.html'), 'utf8');

global.window = {};
new Function(readFileSync(join(PUB, 'showcase-data.js'), 'utf8'))();
const data = global.window.TG_SHOWCASE;

console.log('showcase: data shape');
check('TG_SHOWCASE defined', !!data);
check('has products', Array.isArray(data.products) && data.products.length > 0);

let total = 0;
for (const p of data.products) {
  console.log(`showcase: ${p.name}`);
  for (const field of ['id', 'name', 'category', 'tagline', 'summary']) {
    check(`${field} present`, typeof p[field] === 'string' && p[field].length > 0);
  }
  check('has screens', Array.isArray(p.screens) && p.screens.length > 0);

  for (const s of p.screens) {
    check(`${s.id}: has markup`, typeof s.html === 'string' && s.html.length > 0);
    check(`${s.id}: has a blurb`, typeof s.blurb === 'string' && s.blurb.length > 0);
    check(`${s.id}: has hotspots`, Array.isArray(s.hotspots) && s.hotspots.length > 0);
    for (const h of s.hotspots) {
      total++;
      /* A hotspot whose anchor is gone leaves no marker and nothing to
         spotlight, and the walk silently skips past it. */
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

  if (p.qr) {
    check('qr url is https', /^https:\/\//.test(p.qr.url), p.qr.url);
    check('qr svg is committed', existsSync(join(PUB, 'showcase', 'qr', `${p.id}.svg`)),
      `run npm run build:showcase-qr`);
  }
}

/* House style: UK English, no em dashes (CLAUDE.md brand voice). */
console.log('showcase: copy rules');
const prose = JSON.stringify(data);
check('no em dashes', !prose.includes('—'));
check('no en dash used as punctuation', !/\w – \w/.test(prose));

console.log('showcase: csp');
check('no eval', !/\beval\s*\(/.test(js));
check('no Function constructor', !/new\s+Function\s*\(/.test(js));
check('no inline handlers in html', !/\son[a-z]+\s*=/i.test(html));
check('data file loaded before engine',
  html.indexOf('showcase-data.js') < html.indexOf('showcase.js'));

/* One thing at a time. The first build showed a caption, a device, a product
   summary, a chip row, a 39-item list and a QR at once, with ten numbered
   markers on the device. It read as a debug overlay. */
console.log('showcase: one thing at a time');
check('the walk is a single index across the product', /function flatten/.test(js));
check('only the live marker is loud', /pin\.classList\.add\('is-live'\)/.test(js));
check('quiet markers carry no number', /\.tg-pin\s*\{[^}]*font-size:\s*0/.test(css));
check('the list is behind Contents, not always on', /function openContents/.test(js));
check('the QR waits for the ending', /function finish/.test(js) && /tg-end/.test(css));
check('no permanent feature rail remains', !/tg-feats|tg-screenbtn/.test(js));

/* The words have to point at something. */
console.log('showcase: the words and the thing');
check('the live element is spotlit', /function spotlight/.test(js));
check('the spotlight is clipped by the screen',
  /screen\.appendChild\(spot\)/.test(js) && /screen\.appendChild\(el\.spot\)/.test(js));
check('the spotlight is re-attached after the screen redraws',
  /innerHTML = p\.screens\[item\.screen\]\.html;[\s\S]{0,120}appendChild\(el\.spot\)/.test(js));
check('the live marker sits beside the hole, not on it', /rightRoom/.test(js));
check('the marker is scrolled into view on a phone', /function revealLive/.test(js));

/* Small screens. Fitting a fixed 390x844 canvas to the height of a short
   screen once rendered it 118px wide with 4px text. */
console.log('showcase: small screens');
const cssBp = css.match(/@media \(max-width:\s*(\d+)px\)/);
const jsBp = js.match(/var NARROW_PX = (\d+)/);
check('css has a small-screen breakpoint', !!cssBp);
check('js has a matching breakpoint', !!jsBp);
check('the two breakpoints agree', !!cssBp && !!jsBp && cssBp[1] === jsBp[1],
  `css ${cssBp?.[1]} vs js ${jsBp?.[1]}`);
check('phones size the device by width, never height',
  /narrow\(\)[\s\S]{0,80}w \/ PHONE_W, 1\)/.test(js));
check('the device never draws past life size on a kiosk', /1\.5\)/.test(js));
check('scene padding is measured, not assumed', /paddingTop/.test(js));
check('the caption is bounded so its controls cannot be pushed off',
  /max-height:\s*100%/.test(css));

console.log('showcase: walkthrough');
for (const fn of ['tourStart', 'tourPause', 'tourResume', 'tourNext', 'dwellFor']) {
  check(`${fn} defined`, new RegExp(`function ${fn}\\b`).test(js));
}
check('attract self-starts the walk', /ATTRACT_MS/.test(js));
check('a playing walk is not treated as idle',
  /st\.tour\.on && !st\.tour\.paused[\s\S]{0,80}idleTimer = null/.test(js));
check('a real touch hands control over', /function onInput/.test(js));
check('the play control opts out of the auto-pause', /data-ctl/.test(js));

function num(name) {
  /* They share one var statement, so do not require the keyword. */
  const m = js.match(new RegExp(`\\b${name} = (\\d+)`));
  return m ? Number(m[1]) : NaN;
}
const BASE = num('DWELL_BASE'), PER = num('DWELL_PER_WORD');
const MIN = num('DWELL_MIN'), MAX = num('DWELL_MAX');
check('dwell constants parse', [BASE, PER, MIN, MAX].every(x => !isNaN(x)));
let ms = 0;
for (const p of data.products)
  for (const s of p.screens)
    for (const h of s.hotspots) {
      const words = `${h.title} ${h.feature} ${h.benefit} ${h.edge || ''}`.split(/\s+/).length;
      ms += Math.max(MIN, Math.min(MAX, BASE + words * PER));
    }
const mins = ms / 60000;
console.log(`  info the full walkthrough is ${total} steps, about ${mins.toFixed(1)} minutes`);
check('the walk is a length someone would stand through', mins >= 2 && mins <= 15,
  `${mins.toFixed(1)} minutes`);

console.log('showcase: routing');
const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
check('/showcase rewrite present',
  vercel.rewrites.some(r => r.source === '/showcase' && r.destination === '/showcase.html'));
const hostRw = vercel.rewrites.find(
  r => r.source === '/' && (r.has || []).some(h => h.type === 'host'));
check('bare showcase subdomain serves the showcase',
  !!hostRw && hostRw.destination === '/showcase.html');
check('the host rewrite is evaluated first', vercel.rewrites[0] === hostRw);
for (const f of ['/showcase.js', '/showcase-data.js', '/showcase.css']) {
  check(`${f} has headers`, vercel.headers.some(h => h.source === f));
}

console.log(failures ? `\n${failures} failing check(s)` : '\nshowcase: all checks passed');
process.exit(failures ? 1 : 0);
