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
const dataSrc = readFileSync(join(PUB, 'showcase-data.js'), 'utf8');

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

/* Pictures and the map. Andy's note on 21 Sep 2026 was that the thing read as
   a technical walk through rather than something that sells: gradients where
   photographs belong, and soft shapes where a map belongs. Both are now real,
   so both are now guarded. */
console.log('showcase: real pictures');
const arts = [...html.matchAll(/lt-art--([a-z]+)/g)].map(m => m[1])
  .concat([...dataSrc.matchAll(/lt-art--([a-z]+)/g)].map(m => m[1]));
check('the markup asks for at least three pictures', new Set(arts).size >= 3, [...new Set(arts)].join(','));
for (const a of new Set(arts)) {
  const rule = new RegExp(`\\.lt-art--${a}\\s*\\{[^}]*background-image:\\s*url\\(([^)]+)\\)`);
  const m = css.match(rule);
  check(`lt-art--${a} names a file`, !!m, 'no background-image');
  if (m) check(`lt-art--${a} file is committed`, existsSync(join(PUB, m[1].replace(/^\//, ''))), m[1]);
  check(`lt-art--${a} has a colour under it`,
    new RegExp(`\\.lt-art--${a}\\s*\\{[^}]*background-color`).test(css));
}
check('no gradient is standing in for a photograph any more',
  !/\.lt-art--[a-z]+\s*\{[^}]*linear-gradient/.test(css));

console.log('showcase: the map is a map');
check('the basemap is committed, not fetched from a tile service',
  existsSync(join(PUB, 'showcase/img/world.webp')));
for (const [label, f] of [['stylesheet', css], ['engine', js], ['content', dataSrc]]) {
  check(`no third-party tile host in the ${label}`,
    !/cartocdn|tile\.openstreetmap|arcgisonline|mapbox|maps\.wikimedia/.test(f));
}
check('OpenStreetMap is credited', /OpenStreetMap contributors/.test(dataSrc));
check('offline keeps the soft map', /navigator\.onLine === false/.test(js));
check('the soft map is hidden only once the basemap is up',
  /\.lt-map\.is-live \.lt-map-land\s*\{[^}]*display:\s*none/.test(css));

/* The pins are real coordinates, not eyeballed positions. Re-derive them here
   rather than trusting the numbers in the stylesheet: a nudged pixel is a
   moved airport, and nothing else in the suite would notice. */
const Z = 2, SCALE = 1.25, W = 256 * 2 ** Z;
const project = (lat, lon) => [
  (lon + 180) / 360 * W * SCALE,
  (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * W * SCALE,
];
const PLACES = [
  ['1', 'London Heathrow', 51.4700, -0.4543],
  ['2', 'Abu Dhabi', 24.4330, 54.6511],
  ['3', 'Reethi Beach Resort', 5.1167, 73.0833],
];
const frame = css.match(/\.lt-map-world\s*\{([^}]*)\}/);
check('the map frame is declared', !!frame);
if (frame) {
  const w = +(frame[1].match(/width:\s*(\d+)px/) || [])[1];
  const h = +(frame[1].match(/height:\s*(\d+)px/) || [])[1];
  check('the frame is a whole number of tiles', w === 4 * 256 * SCALE && h === 3 * 256 * SCALE, `${w}x${h}`);
  const mid = PLACES.map(p => project(p[2], p[3]));
  const cx = (mid[0][0] + mid[2][0]) / 2, cy = (mid[0][1] + mid[2][1]) / 2;
  const ml = -+(frame[1].match(/margin-left:\s*-?(\d+)px/) || [])[1];
  const mt = -+(frame[1].match(/margin-top:\s*-?(\d+)px/) || [])[1];
  check('the frame is centred on the route', Math.abs(ml + cx) <= 1 && Math.abs(mt + cy) <= 1,
    `css ${ml},${mt} vs projected ${-Math.round(cx)},${-Math.round(cy)}`);
}
for (const [n, name, lat, lon] of PLACES) {
  const [x, y] = project(lat, lon);
  const rule = css.match(new RegExp(`\\.lt-pin--${n}\\s*\\{\\s*left:\\s*(\\d+)px;\\s*top:\\s*(\\d+)px`));
  check(`${name} is pinned where it is`,
    !!rule && Math.abs(+rule[1] - x) <= 1 && Math.abs(+rule[2] - y) <= 1,
    rule ? `css ${rule[1]},${rule[2]} vs projected ${Math.round(x)},${Math.round(y)}` : 'no rule');
  check(`${name} is named in full`, dataSrc.includes(name));
}
const d = (dataSrc.match(/<path d="([^"]+)"/) || [])[1] || '';
const nums = d.match(/\d+/g) || [];
const first = project(PLACES[0][2], PLACES[0][3]);
const last = project(PLACES[2][2], PLACES[2][3]);
check('the flight path starts and ends on the end pins',
  nums.length >= 4 &&
  Math.abs(+nums[0] - first[0]) <= 1 && Math.abs(+nums[1] - first[1]) <= 1 &&
  Math.abs(+nums[nums.length - 2] - last[0]) <= 1 &&
  Math.abs(+nums[nums.length - 1] - last[1]) <= 1,
  d ? `${nums[0]},${nums[1]} to ${nums[nums.length - 2]},${nums[nums.length - 1]}` : 'no path');

/* The attract screen. Andy, 21 Sep 2026: "start it on the image splash screen
   as that is the hero/money shot". A stand gets seconds to stop someone, so
   the first thing on screen is the photograph, not a text card. */
console.log('showcase: the splash');
check('the splash photograph is committed', existsSync(join(PUB, 'showcase/img/splash.webp')));
check('the attract screen paints it',
  /\.tg-attract-bg\s*\{[^}]*url\(\/showcase\/img\/splash\.webp\)/.test(css));
check('it covers the screen', /\.tg-attract-bg\s*\{[^}]*cover/.test(css));
check('the engine puts the picture in', /tg-attract-bg/.test(js));
check('the picture is asked for before the script builds the screen',
  /rel="preload"[^>]*splash\.webp/.test(html));
check('there is a scrim so the words are legible over it',
  /\.tg-attract::after\s*\{[^}]*linear-gradient/.test(css));
/* Navy on a navy photograph is invisible from across a hall. */
check('the primary call to action is inverted over the photograph',
  /\.tg-attract \.tg-cta[^{]*\{[^}]*background:\s*#fff/.test(css));
check('the copy over the photograph is light, not body grey',
  !/\.tg-attract p\s*\{[^}]*var\(--tg-text-2\)/.test(css) &&
  !/\.tg-attract-note\s*\{[^}]*var\(--tg-text-3\)/.test(css));
check('the drift honours reduced motion',
  /prefers-reduced-motion[\s\S]*animation-duration:\s*\.001ms/.test(css));

/* And the same shot on the phone. Andy, 21 Sep 2026: "the hero shot should
   also be on the phone, within the xxx days until you go, welcome message".
   It was a 168px card underneath a notification banner. */
console.log('showcase: the phone leads with the picture');
const home = data.products[0].screens[0].html;
const iShot = home.indexOf('lt-topshot');
const iBody = home.indexOf('lt-body');
check('the home screen opens with the picture, before anything else',
  iShot > -1 && iBody > -1 && iShot < iBody);
check('the status bar sits on it', home.indexOf('lt-statusbar') > iShot && home.indexOf('lt-statusbar') < iBody);
check('the welcome sits on it', home.indexOf('lt-welcome') > iShot && home.indexOf('lt-welcome') < iBody);
check('the countdown sits on it', home.indexOf('lt-countdown') > iShot && home.indexOf('lt-countdown') < iBody);
check('it is the same file the stand opens on',
  /lt-art--hero/.test(home) && /\.lt-art--hero\s*\{[^}]*splash\.webp/.test(css));
/* The stacking rule is specific enough to beat a bare position:absolute, which
   dropped the countdown into the column on top of the dates. */
check('the countdown is pinned out of the flow',
  /\.lt-topshot > \.lt-countdown\s*\{[^}]*position:\s*absolute/.test(css));
check('the status bar is light over the photograph',
  /\.lt-topshot \.lt-statusbar\s*\{[^}]*#fff/.test(css));
check('the old card is gone', !/lt-hero\b/.test(css) && !/lt-hero\b/.test(dataSrc));

check('the image assets have headers',
  vercel.headers.some(h => /showcase\/img/.test(h.source)));

console.log(failures ? `\n${failures} failing check(s)` : '\nshowcase: all checks passed');
process.exit(failures ? 1 : 0);
