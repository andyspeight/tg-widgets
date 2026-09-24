/**
 * Weather widget: the live "Right now" strip (24 Sep 2026).
 *
 * Andy: "ok, lets get the weather live". The strip was a Phase 1 placeholder
 * (showLiveWeather, forced off) because the Destination Content base had no
 * coordinates. It has them now (the World Map needed them), so three pieces
 * were built and this checks each, end to end:
 *
 *   1. /api/destination-content returns the record's own coordinates as
 *      `geo` (the real handler, with Airtable stood in for).
 *   2. /api/weather-current answers ANY website (it used to answer five
 *      listed domains only, which would have blanked the strip on every
 *      client's site), shares one cache entry per place, and moves to
 *      Open-Meteo's commercial host when OPEN_METEO_API_KEY is set.
 *   3. widget-weather.js draws the strip from that answer: in all layouts, in
 *      the reader's units and language, once per place, without moving focus
 *      or scrolling, and draws nothing at all when it cannot.
 *
 * Run: node test/weather-live-smoke.mjs   (npm run test:weather-live)
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

let passed = 0, failed = 0;
const ok = (name, cond, detail) => {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (detail ? '  — ' + detail : '')); }
};
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const realFetch = globalThis.fetch;

function mockRes() {
  return {
    statusCode: 200, headers: {}, body: undefined,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    getHeader(k) { return this.headers[k.toLowerCase()]; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; },
  };
}

// ── 1. The destination feed carries coordinates ───────────────────────────
console.log('\nThe destination feed returns the record\'s coordinates\n');
{
  process.env.AIRTABLE_KEY = 'test-key';
  process.env.AIRTABLE_BASE_ID = 'appTEST0000000000';
  process.env.AIRTABLE_DESTINATION_CONTENT_PAT = 'test-pat';
  const CITY = 'tblTkKujdVZgWPAQe';
  let cityUrl = '';
  let cityFields = {};
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/Widgets?')) {
      // Each widget points at its own record: the feed caches per record.
      const recordId = u.includes('tgw_geo_two') ? 'recNOGEO000000000' : 'recDUBAI000000000';
      return { ok: true, status: 200, json: async () => ({ records: [{ fields: { Config: JSON.stringify({ destination: { level: 'city', recordId } }) } }] }) };
    }
    if (u.includes('/' + CITY + '?')) {
      cityUrl = u;
      return { ok: true, status: 200, json: async () => ({ records: [{ id: 'recX', fields: cityFields }] }) };
    }
    return { ok: true, status: 200, json: async () => ({ records: [] }) };
  };
  const { default: handler, shapeGeo } = await import('../api/destination-content.js');
  const base = {
    fld2VkY61c1JKUWKB: 'Dubai',
    fldxjOSYkYRPOZQgx: '24,25,28,33,37,39,41,41,39,35,30,26',
    fldHwvHjSwkpEgFa2: 'best,best,best,shoulder,off,off,off,off,off,shoulder,best,best',
  };
  const call = async (id) => {
    const res = mockRes();
    await handler({ method: 'GET', query: { id }, headers: { 'x-forwarded-for': '198.51.100.' + Math.floor(Math.random() * 200) } }, res);
    return res;
  };
  try {
    cityFields = Object.assign({}, base, { fldjk3yUCbVQRuxx8: 25.1972, fldNSlAA0Qb1akknz: 55.2744 });
    const r = await call('tgw_geo_one');
    ok('a city with coordinates comes back with geo', r.statusCode === 200 && r.body && r.body.geo && r.body.geo.lat === 25.1972 && r.body.geo.lng === 55.2744, JSON.stringify(r.body && r.body.geo));
    ok('it asks Airtable for the Latitude and Longitude fields (not the empty Lat/Lng duplicates)',
      cityUrl.includes('fields%5B%5D=fldjk3yUCbVQRuxx8') && cityUrl.includes('fields%5B%5D=fldNSlAA0Qb1akknz'));
    cityFields = Object.assign({}, base);
    const r2 = await call('tgw_geo_two');
    ok('a record without coordinates says geo: null (the widget then draws no strip)', r2.statusCode === 200 && r2.body.geo === null);
  } finally { globalThis.fetch = realFetch; }
  ok('coordinates are checked: 0,0, out of range and text are refused', shapeGeo(0, 0) === null && shapeGeo(95, 10) === null && shapeGeo('x', 1) === null && shapeGeo(null, 2) === null);
  ok('and rounded to 4 places, as the weather route rounds them', JSON.stringify(shapeGeo('-33.868812', '151.209295')) === '{"lat":-33.8688,"lng":151.2093}');
  const SRC = readFileSync(new URL('../api/destination-content.js', import.meta.url), 'utf8');
  ok('all three levels read their coordinates (country, city, resort)',
    /lat:\s*'fldlxsWrbmU6ELUPW'/.test(SRC) && /lat:\s*'fldjk3yUCbVQRuxx8'/.test(SRC) && /lat:\s*'fld4INRwIKWCG21RV'/.test(SRC));
}

// ── 2. The weather route answers any website ─────────────────────────────
console.log('\nThe weather route answers client websites\n');
{
  const { default: handler } = await import('../api/weather-current.js');
  let asked = '';
  globalThis.fetch = async (url) => {
    asked = String(url);
    return { ok: true, json: async () => ({ current: { temperature_2m: 23.4, apparent_temperature: 21.2, weather_code: 2, wind_speed_10m: 24, relative_humidity_2m: 52, is_day: 1 } }) };
  };
  const call = async (origin, query = { lat: '37.9838', lng: '23.7275', units: 'c' }) => {
    const res = mockRes();
    const headers = { 'x-forwarded-for': '203.0.113.' + Math.floor(Math.random() * 200) };
    if (origin !== undefined) headers.origin = origin;
    await handler({ method: 'GET', query, headers }, res);
    return res;
  };
  try {
    delete process.env.OPEN_METEO_API_KEY;
    const client = await call('https://www.freefromtravel.co.uk');
    ok('a client\'s own website may read it (Access-Control-Allow-Origin: *)', client.statusCode === 200 && client.headers['access-control-allow-origin'] === '*');
    const preview = await call('null');
    ok('so may the editor preview (a data: page, origin "null")', preview.headers['access-control-allow-origin'] === '*');
    ok('one cache entry per place for every site (no Vary: Origin)', !/origin/i.test(client.headers['vary'] || ''));
    ok('the browser keeps it 5 minutes, the edge 15', /max-age=300/.test(client.headers['cache-control']) && /s-maxage=900/.test(client.headers['cache-control']));
    ok('without a key it uses Open-Meteo\'s free host, with no key in the URL', asked.startsWith('https://api.open-meteo.com/v1/forecast?') && !/apikey=/.test(asked));
    process.env.OPEN_METEO_API_KEY = 'test-commercial-key';
    await call('https://www.freefromtravel.co.uk');
    ok('with OPEN_METEO_API_KEY set it uses the commercial host and sends the key', asked.startsWith('https://customer-api.open-meteo.com/v1/forecast?') && /apikey=test-commercial-key/.test(asked));
    ok('and still only the coordinates we checked', /latitude=37\.9838/.test(asked) && /longitude=23\.7275/.test(asked));
  } finally { delete process.env.OPEN_METEO_API_KEY; globalThis.fetch = realFetch; }
}

// ── 3. The widget draws the strip ─────────────────────────────────────────
console.log('\nThe widget draws "Right now"\n');
const WIDGET = readFileSync(new URL('../public/widget-weather.js', import.meta.url), 'utf8');
const GREECE = {
  level: 'country', name: 'Greece', region: 'Southern Europe', geo: { lat: 37.9838, lng: 23.7275 },
  climate: {
    temps: [13, 14, 16, 20, 25, 30, 33, 33, 29, 24, 19, 15],
    rainfall: [56, 47, 41, 23, 15, 6, 5, 5, 11, 50, 58, 71],
    season: ['off', 'off', 'shoulder', 'shoulder', 'best', 'best', 'best', 'best', 'best', 'shoulder', 'off', 'off'],
  },
};
const LIVE = { ok: true, temp: 23.4, feels: 21.2, code: 2, desc: 'Partly cloudy', icon: 'sun-cloud', wind: 24, humidity: 52, isDay: true, units: 'c' };

function makeWin({ answer = LIVE, status = 200, lang = 'en' } = {}) {
  const dom = new JSDOM('<!doctype html><html lang="' + lang + '"><body></body></html>', { url: 'https://www.clientsite.example/greece', runScripts: 'outside-only' });
  const win = dom.window;
  win.__TG_WIDGET_API__ = 'https://widgets.travelify.io/api/widget-config';
  const calls = [];
  win.fetch = (url) => {
    calls.push(String(url));
    return Promise.resolve({ ok: status === 200, status, json: async () => answer });
  };
  // Nothing on render may move the host page.
  let grabs = 0;
  win.HTMLElement.prototype.focus = function () { grabs++; };
  win.Element.prototype.scrollIntoView = function () { grabs++; };
  win.eval(WIDGET);
  return { win, calls, grabs: () => grabs };
}
function mount(win, cfg) {
  const el = win.document.createElement('div');
  win.document.body.appendChild(el);
  const w = new win.TGWeatherWidget(el, cfg);
  return { el, w, root: el.shadowRoot };
}

{
  const { win, calls, grabs } = makeWin();
  const { root } = mount(win, { destinationData: GREECE });
  await tick(10);
  const strip = root.querySelector('.tgw-live');
  ok('the strip is drawn once the weather lands', !!strip);
  ok('from our own weather route on the widget host, in Celsius',
    calls.length === 1 && calls[0] === 'https://widgets.travelify.io/api/weather-current?lat=37.9838&lng=23.7275&units=c', calls.join(' | '));
  ok('it reads "Right now", 23°C, Partly cloudy', /Right now/.test(strip.textContent) && root.querySelector('.tgw-live-temp').textContent === '23°C' && root.querySelector('.tgw-live-desc').textContent === 'Partly cloudy');
  ok('feels like, wind in mph for an English reader, and humidity', /Feels like 21°/.test(strip.textContent) && /Wind 15 mph/.test(strip.textContent) && /Humidity 52%/.test(strip.textContent), strip.textContent);
  const credit = root.querySelector('.tgw-live-credit');
  ok('credits Open-Meteo (CC BY 4.0) with a safe link', credit && credit.getAttribute('href') === 'https://open-meteo.com/' && /noopener/.test(credit.getAttribute('rel')) && /Open-Meteo/.test(credit.textContent));
  ok('it sits under the header and above the month callout',
    !!root.querySelector('.tgw-header + .tgw-live-slot + .tgw-callout'));
  const cBtn = root.querySelector('.tgw-climate-unit[data-unit="F"]');
  cBtn.click();
  await tick(10);
  ok('switching to °F converts the strip too (74°F, feels 70°)', root.querySelector('.tgw-live-temp').textContent === '74°F' && /Feels like 70°/.test(root.querySelector('.tgw-live').textContent));
  ok('without asking for the weather again', calls.length === 1);
  ok('nothing moved focus or scrolled the page', grabs() === 0);
}

{
  const { win, calls } = makeWin();
  mount(win, { destinationData: GREECE, layout: 'wide' });
  mount(win, { destinationData: GREECE, layout: 'compact' });
  const three = mount(win, { destinationData: GREECE, layout: 'standard' });
  await tick(10);
  ok('three widgets for the same place on one page ask once', calls.length === 1, String(calls.length));
  ok('the wide and compact layouts draw it too', win.document.querySelectorAll('div').length === 3 &&
    Array.from(win.document.querySelectorAll('body > div')).every((d) => !!d.shadowRoot.querySelector('.tgw-live')));
  ok('in the wide layout it sits in the left column under the header', !!win.document.querySelector('body > div').shadowRoot.querySelector('.tgw-wide-left > .tgw-header + .tgw-live-slot'));
  void three;
}

{
  const { win, calls } = makeWin();
  const { root } = mount(win, { destinationData: GREECE, sections: { live: false } });
  await tick(10);
  ok('switched off in the editor: no strip and no request', !root.querySelector('.tgw-live-slot') && calls.length === 0);
}

{
  const { win, calls } = makeWin();
  const noGeo = Object.assign({}, GREECE, { geo: null });
  const { root } = mount(win, { destinationData: noGeo });
  await tick(10);
  ok('a destination without coordinates: no strip and no request', !root.querySelector('.tgw-live-slot') && calls.length === 0);
}

{
  const { win } = makeWin();
  // What every one of the 73 saved widgets carries: the retired placeholder.
  const { root } = mount(win, { destinationData: GREECE, showLiveWeather: false, sections: { header: true, callout: true, climate: true, bestMonths: true, cta: true } });
  await tick(10);
  ok('a widget saved before 1.2.0 (showLiveWeather: false, no sections.live) shows it', !!root.querySelector('.tgw-live'));
}

{
  const { win } = makeWin({ status: 502, answer: { ok: false, error: 'Upstream weather service unavailable' } });
  const { root } = mount(win, { destinationData: GREECE });
  await tick(10);
  ok('weather unavailable: no strip, no error box, the climate widget as before',
    !root.querySelector('.tgw-live') && !root.querySelector('.tgw-notice') && !!root.querySelector('.tgw-climate-chart') && root.querySelector('.tgw-live-slot').innerHTML === '');
}

{
  const { win } = makeWin({ answer: { ok: true, temp: '<img src=x onerror=alert(1)>', code: 1 } });
  const { root } = mount(win, { destinationData: GREECE });
  await tick(10);
  ok('an answer with no real temperature draws nothing (remote data is checked)', !root.querySelector('.tgw-live') && !root.innerHTML.includes('onerror'));
}

{
  const { win } = makeWin({ answer: Object.assign({}, LIVE, { code: 95, wind: 40, temp: 31, feels: 34, humidity: 61 }), lang: 'fr' });
  const { root } = mount(win, { destinationData: GREECE });
  await tick(10);
  const t = root.querySelector('.tgw-live').textContent;
  ok('in French it reads "En ce moment", "Orages", wind in km/h', /En ce moment/.test(t) && /Orages/.test(t) && /Vent 40 km\/h/.test(t), t);
}

{
  const { win } = makeWin({ answer: Object.assign({}, LIVE, { code: 0, isDay: false }) });
  const { root } = mount(win, { destinationData: GREECE });
  await tick(10);
  ok('a clear night shows the moon, not the sun', root.querySelector('.tgw-live-icon').innerHTML.includes('M12 3a6 6 0 0 0 9 9'));
}

{
  const { win, calls } = makeWin();
  const { root } = mount(win, { destinationData: GREECE, liveData: LIVE });
  ok('the editor\'s inline weather draws at once, with no request', !!root.querySelector('.tgw-live') && calls.length === 0);
  ok('and without the entrance animation (the preview reloads on every keystroke)', root.querySelector('.tgw-live').getAttribute('data-enter') === null);
}

// ── 4. The editor offers the switch and feeds the preview ────────────────
console.log('\nThe editor\n');
{
  const ED = readFileSync(new URL('../public/editor-weather.html', import.meta.url), 'utf8');
  ok('a "Weather right now" switch among the section switches', /key: 'live',\s+label: 'Weather right now'/.test(ED));
  ok('on by default for a new widget', /sections: \{\s*header: true, live: true,/.test(ED));
  ok('the retired showLiveWeather is dropped on load, not saved again', /delete state\.config\.showLiveWeather/.test(ED) && !/showLiveWeather: false/.test(ED));
  ok('the preview gets the weather inline (liveData), fetched once per place', /cfg\.liveData = live/.test(ED) && /liveCache\[key\] !== undefined/.test(ED));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
