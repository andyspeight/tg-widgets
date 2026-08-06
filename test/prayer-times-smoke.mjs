/**
 * Prayer Times widget — smoke test.
 *
 * Exercises the real widget-prayer.js inside jsdom with a stubbed Aladhan
 * fetch and a frozen clock:
 *   - card + strip render, prayer rows, Hijri/Gregorian header
 *   - next-prayer detection + live countdown (today and after-Isha rollover)
 *   - Aladhan URL + tune-string ordering, method/school/latAdj clamping
 *   - localStorage cache hit (no second fetch)
 *   - graceful degradation (stale note from last-good; silent hide otherwise)
 *   - HTML escaping of the location label
 *
 * Run: node test/prayer-times-smoke.mjs   (also: npm run test:prayer)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, '..', 'public', 'widget-prayer.js'), 'utf8');

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}
const delay = (ms) => new Promise(r => setTimeout(r, ms));

const RealDate = Date;
function freezeClock(win, h, mi, s, Y, Mo, D) {
  function FD(arg) {
    if (arguments.length === 0) {
      return {
        getHours: () => h, getMinutes: () => mi, getSeconds: () => s, getMilliseconds: () => 0,
        getFullYear: () => Y, getMonth: () => Mo, getDate: () => D, getTime: () => 0,
      };
    }
    return new RealDate(arg);
  }
  FD.now = () => 0;
  win.Date = FD;
}

// A canned Aladhan `data` object. No meta.timezone → the widget uses the
// (frozen) local clock, which keeps the countdown assertions deterministic.
function aladhanData() {
  return {
    timings: {
      Fajr: '05:12', Sunrise: '06:40', Dhuhr: '12:21', Asr: '15:45',
      Sunset: '18:02', Maghrib: '18:02', Isha: '19:32', Imsak: '05:02', Midnight: '00:02',
    },
    date: {
      readable: '06 Aug 2026',
      hijri: { day: '12', month: { number: 2, en: 'Safar' }, year: '1448', designation: { abbreviated: 'AH' } },
      gregorian: { day: '06', month: { number: 8, en: 'August' }, year: '2026', weekday: { en: 'Thursday' } },
    },
    meta: { latitude: 51.5, longitude: -0.12, timezone: '', method: { id: 3 } },
  };
}

function makeDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://widgets.travelify.io/', runScripts: 'outside-only' });
  const win = dom.window;
  win.__TG_PREVIEW__ = true; // so silent-hide path renders a visible notice we can assert on
  // localStorage in jsdom is present; clear between runs.
  try { win.localStorage.clear(); } catch (e) { /* noop */ }
  win.eval(SRC);
  return { dom, win };
}

async function mount(win, cfg) {
  const el = win.document.createElement('div');
  win.document.body.appendChild(el);
  const w = new win.TGPrayerWidget(el, cfg);
  await delay(30);
  return { el, w };
}

async function run() {
  // ── 1. Card render + next prayer at 14:00 (Asr next, 1h 45m) ──────────
  console.log('Card render + next-prayer countdown');
  {
    const { win } = makeDom();
    let lastUrl = '';
    win.fetch = (url) => { lastUrl = url; return Promise.resolve({ ok: true, json: async () => ({ code: 200, status: 'OK', data: aladhanData() }) }); };
    freezeClock(win, 14, 0, 0, 2026, 7, 6);
    const { el, w } = await mount(win, {
      location: { mode: 'city', city: 'London', country: 'United Kingdom' },
      method: 3, hourFormat: '24',
    });
    const html = el.shadowRoot.innerHTML;
    ok('renders a card', /tgpt-card/.test(html));
    ok('shows all five prayers + sunrise', ['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'].every(p => html.includes('>' + p + '<')));
    ok('shows the Aladhan time for Asr (15:45)', html.includes('15:45'));
    ok('Hijri header present', html.includes('12 Safar 1448 AH'));
    ok('Gregorian header present', html.includes('Thursday, 06 August 2026'));
    const asrRow = el.shadowRoot.querySelector('.tgpt-row[data-key="Asr"]');
    ok('Asr is the next prayer', asrRow && asrRow.getAttribute('data-next') === 'true');
    const dhuhrRow = el.shadowRoot.querySelector('.tgpt-row[data-key="Dhuhr"]');
    ok('Dhuhr is marked passed', dhuhrRow && dhuhrRow.getAttribute('data-passed') === 'true');
    const count = el.shadowRoot.querySelector('[data-hero-count]');
    ok('countdown reads 1h 45m until Asr', count && /1h\s*45m/.test(count.textContent) && /Asr/.test(count.textContent));
    ok('hero time shows 15:45', /15:45/.test(el.shadowRoot.querySelector('[data-hero-time]').textContent));
    ok('used timingsByCity endpoint', lastUrl.includes('/timingsByCity/06-08-2026'));
    ok('city + country in the query', lastUrl.includes('city=London') && lastUrl.includes('country=United%20Kingdom'));
    w.destroy();
  }

  // ── 2. After Isha → next is tomorrow's Fajr ───────────────────────────
  console.log('After-Isha rollover to tomorrow Fajr');
  {
    const { win } = makeDom();
    win.fetch = () => Promise.resolve({ ok: true, json: async () => ({ code: 200, status: 'OK', data: aladhanData() }) });
    freezeClock(win, 20, 0, 0, 2026, 7, 6); // 20:00, after Isha 19:32
    const { el, w } = await mount(win, { location: { mode: 'city', city: 'London', country: 'United Kingdom' } });
    const count = el.shadowRoot.querySelector('[data-hero-count]');
    // (05:12 + 24h) - 20:00 = 9h 12m
    ok('countdown rolls to tomorrow Fajr (9h 12m)', count && /9h\s*12m/.test(count.textContent) && /Fajr/.test(count.textContent));
    ok('no row marked next (next is tomorrow)', !el.shadowRoot.querySelector('.tgpt-row[data-next="true"]'));
    w.destroy();
  }

  // ── 3. Strip layout ───────────────────────────────────────────────────
  console.log('Strip layout');
  {
    const { win } = makeDom();
    win.fetch = () => Promise.resolve({ ok: true, json: async () => ({ code: 200, status: 'OK', data: aladhanData() }) });
    freezeClock(win, 14, 0, 0, 2026, 7, 6);
    const { el, w } = await mount(win, { layout: 'strip', showSunrise: false, location: { mode: 'city', city: 'London', country: 'United Kingdom' } });
    const html = el.shadowRoot.innerHTML;
    ok('renders the strip', /tgpt-strip/.test(html));
    const cells = el.shadowRoot.querySelectorAll('.tgpt-cell');
    ok('five cells when sunrise hidden', cells.length === 5);
    ok('lead shows the next prayer', /Asr/.test(el.shadowRoot.querySelector('[data-hero-count]').textContent));
    w.destroy();
  }

  // ── 4. Coords + tune ordering + clamping ──────────────────────────────
  console.log('Coords URL, tune ordering, clamping');
  {
    const { win } = makeDom();
    let lastUrl = '';
    win.fetch = (url) => { lastUrl = url; return Promise.resolve({ ok: true, json: async () => ({ code: 200, status: 'OK', data: aladhanData() }) }); };
    freezeClock(win, 14, 0, 0, 2026, 7, 6);
    const { w } = await mount(win, {
      location: { mode: 'coords', lat: 21.4225, lng: 39.8262 },
      method: 4, school: 1, latitudeAdjustment: 2,
      tune: { Fajr: 2, Isha: -3 },
    });
    ok('used /timings with coords', lastUrl.includes('/timings/06-08-2026'));
    ok('latitude + longitude present', lastUrl.includes('latitude=21.4225') && lastUrl.includes('longitude=39.8262'));
    ok('method 4 / school 1 / latAdj 2', lastUrl.includes('method=4') && lastUrl.includes('school=1') && lastUrl.includes('latitudeAdjustmentMethod=2'));
    // Aladhan tune order: Imsak,Fajr,Sunrise,Dhuhr,Asr,Maghrib,Sunset,Isha,Midnight
    ok('tune string ordered correctly', decodeURIComponent(lastUrl).includes('tune=0,2,0,0,0,0,0,-3,0'));
    w.destroy();
  }
  {
    const { win } = makeDom();
    let lastUrl = '';
    win.fetch = (url) => { lastUrl = url; return Promise.resolve({ ok: true, json: async () => ({ code: 200, status: 'OK', data: aladhanData() }) }); };
    freezeClock(win, 14, 0, 0, 2026, 7, 6);
    const { w } = await mount(win, { location: { mode: 'city', city: 'X', country: 'Y' }, method: 999, school: 7, latitudeAdjustment: 9 });
    ok('bad method clamps to 3 (MWL)', lastUrl.includes('method=3'));
    ok('bad school clamps to 0', lastUrl.includes('school=0'));
    ok('bad latAdj clamps to 3', lastUrl.includes('latitudeAdjustmentMethod=3'));
    w.destroy();
  }

  // ── 5. Cache hit — second instance makes no fetch ─────────────────────
  console.log('localStorage cache');
  {
    const { win } = makeDom();
    let calls = 0;
    win.fetch = () => { calls++; return Promise.resolve({ ok: true, json: async () => ({ code: 200, status: 'OK', data: aladhanData() }) }); };
    freezeClock(win, 14, 0, 0, 2026, 7, 6);
    const a = await mount(win, { location: { mode: 'city', city: 'London', country: 'United Kingdom' } });
    ok('first mount fetches once', calls === 1);
    a.w.destroy();
    const b = await mount(win, { location: { mode: 'city', city: 'London', country: 'United Kingdom' } });
    ok('second mount serves from cache (no new fetch)', calls === 1);
    ok('cached render still shows Asr time', b.el.shadowRoot.innerHTML.includes('15:45'));
    b.w.destroy();
  }

  // ── 6. Graceful degradation ───────────────────────────────────────────
  console.log('Graceful degradation');
  {
    // Prime last-good, then a failing fetch on a fresh (uncached) day.
    const { win } = makeDom();
    let mode = 'ok';
    win.fetch = () => mode === 'ok'
      ? Promise.resolve({ ok: true, json: async () => ({ code: 200, status: 'OK', data: aladhanData() }) })
      : Promise.reject(new Error('network down'));
    freezeClock(win, 14, 0, 0, 2026, 7, 6);
    const a = await mount(win, { location: { mode: 'city', city: 'London', country: 'United Kingdom' } });
    a.w.destroy();
    mode = 'fail';
    freezeClock(win, 14, 0, 0, 2026, 7, 7); // next day → cache miss → fetch → fail → last-good
    const b = await mount(win, { location: { mode: 'city', city: 'London', country: 'United Kingdom' } });
    ok('falls back to last-good with a stale note', /Times may be outdated/.test(b.el.shadowRoot.innerHTML));
    b.w.destroy();
  }
  {
    // No cache at all + failing fetch, not a preview → widget hides itself.
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://widgets.travelify.io/', runScripts: 'outside-only' });
    const win = dom.window;
    try { win.localStorage.clear(); } catch (e) { /* noop */ }
    win.eval(SRC);
    win.fetch = () => Promise.reject(new Error('down'));
    freezeClock(win, 14, 0, 0, 2026, 7, 6);
    const el = win.document.createElement('div');
    win.document.body.appendChild(el);
    const w = new win.TGPrayerWidget(el, { location: { mode: 'city', city: 'London', country: 'United Kingdom' } });
    await delay(30);
    ok('hides silently when nothing to show', el.style.display === 'none');
    w.destroy();
  }

  // ── 6b. update() presentation-only change makes no new fetch ──────────
  console.log('update() — presentation change reuses the model');
  {
    const { win } = makeDom();
    let calls = 0;
    win.fetch = () => { calls++; return Promise.resolve({ ok: true, json: async () => ({ code: 200, status: 'OK', data: aladhanData() }) }); };
    freezeClock(win, 14, 0, 0, 2026, 7, 6);
    const { el, w } = await mount(win, { location: { mode: 'city', city: 'London', country: 'United Kingdom' }, hourFormat: '24' });
    ok('mounted with one fetch', calls === 1);
    w.update({ accentColor: '#FF0000', hourFormat: '12' });
    await delay(20);
    ok('presentation change made no new fetch', calls === 1);
    ok('12-hour format now applied (pm)', /pm/.test(el.shadowRoot.innerHTML));
    w.destroy();
  }

  // ── 6c. Visitor location picker (multiple locations) ─────────────────
  console.log('Location picker — visitor can switch');
  {
    const { win } = makeDom();
    const urls = [];
    win.fetch = (url) => { urls.push(url); return Promise.resolve({ ok: true, json: async () => ({ code: 200, status: 'OK', data: aladhanData() }) }); };
    freezeClock(win, 14, 0, 0, 2026, 7, 6);
    const { el, w } = await mount(win, {
      locations: [
        { mode: 'city', city: 'Makkah', country: 'Saudi Arabia', label: 'Makkah' },
        { mode: 'city', city: 'Madinah', country: 'Saudi Arabia', label: 'Madinah' },
        { mode: 'city', city: 'London', country: 'United Kingdom', label: 'London' },
      ],
    });
    const sel = el.shadowRoot.querySelector('.tgpt-picker');
    ok('a picker dropdown is rendered', !!sel);
    ok('picker has all three locations', sel && sel.querySelectorAll('option').length === 3);
    ok('first location is selected and fetched', urls[0] && urls[0].includes('city=Makkah'));
    // Visitor switches to Madinah.
    sel.value = '1';
    sel.dispatchEvent(new win.Event('change'));
    await delay(20);
    ok('switching the picker fetches the new city', urls.some(u => u.includes('city=Madinah')));
    w.destroy();
  }
  {
    // Single location + no visitor location → no picker.
    const { win } = makeDom();
    win.fetch = () => Promise.resolve({ ok: true, json: async () => ({ code: 200, status: 'OK', data: aladhanData() }) });
    freezeClock(win, 14, 0, 0, 2026, 7, 6);
    const { el, w } = await mount(win, { location: { mode: 'city', city: 'London', country: 'United Kingdom' } });
    ok('no picker when there is only one option', !el.shadowRoot.querySelector('.tgpt-picker'));
    w.destroy();
  }

  // ── 6d. Browser location as the default ───────────────────────────────
  console.log('Visitor location default + fallback');
  {
    const { win } = makeDom();
    const urls = [];
    win.fetch = (url) => { urls.push(url); return Promise.resolve({ ok: true, json: async () => ({ code: 200, status: 'OK', data: aladhanData() }) }); };
    freezeClock(win, 14, 0, 0, 2026, 7, 6);
    // Grant geolocation.
    Object.defineProperty(win.navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: (okCb) => okCb({ coords: { latitude: 21.42, longitude: 39.83 } }) },
    });
    const { el, w } = await mount(win, {
      useVisitorLocation: true,
      locations: [{ mode: 'city', city: 'London', country: 'United Kingdom', label: 'London' }],
    });
    ok('defaults to the browser location (coords fetch)', urls[0] && urls[0].includes('latitude=21.42'));
    ok('picker offers a "Near me" option', /Near me/.test(el.shadowRoot.innerHTML));
    w.destroy();
  }
  {
    // Geolocation denied → falls back to the first configured place.
    const { win } = makeDom();
    const urls = [];
    win.fetch = (url) => { urls.push(url); return Promise.resolve({ ok: true, json: async () => ({ code: 200, status: 'OK', data: aladhanData() }) }); };
    freezeClock(win, 14, 0, 0, 2026, 7, 6);
    Object.defineProperty(win.navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: (okCb, errCb) => errCb({ code: 1, message: 'denied' }) },
    });
    const { w } = await mount(win, {
      useVisitorLocation: true,
      locations: [{ mode: 'city', city: 'Makkah', country: 'Saudi Arabia', label: 'Makkah' }],
    });
    ok('falls back to the configured place on deny', urls.some(u => u.includes('city=Makkah')) && !urls.some(u => u.includes('latitude=')));
    w.destroy();
  }

  // ── 7. HTML escaping of the location label ────────────────────────────
  console.log('Security — label escaping');
  {
    const { win } = makeDom();
    win.fetch = () => Promise.resolve({ ok: true, json: async () => ({ code: 200, status: 'OK', data: aladhanData() }) });
    freezeClock(win, 14, 0, 0, 2026, 7, 6);
    const { el, w } = await mount(win, { location: { mode: 'city', city: 'London', country: 'United Kingdom', label: '<img src=x onerror=alert(1)>' } });
    const html = el.shadowRoot.innerHTML;
    ok('label is escaped, no raw <img', !html.includes('<img src=x'));
    ok('escaped entities present', html.includes('&lt;img'));
    w.destroy();
  }

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
}

run().catch(err => { console.error(err); process.exit(1); });
