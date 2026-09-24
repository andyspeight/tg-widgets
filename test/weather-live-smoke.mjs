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
 *      client's site), shares one cache entry per place, and reads MET Norway
 *      (free for commercial use, unlike Open-Meteo's free tier) on MET's
 *      terms: an identifying User-Agent, no asking again before Expires.
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
console.log('\nThe weather route answers client websites, from MET Norway\n');
{
  const { default: handler, metSymbolToWmo, apparentTemp, shapeResponse } = await import('../api/weather-current.js');
  const metBody = (symbol = 'partlycloudy_day', details = { air_temperature: 23.4, relative_humidity: 52, wind_speed: 6.7 }) => ({
    properties: {
      meta: { updated_at: '2026-09-24T12:31:07Z' },
      timeseries: [
        { time: new Date(Date.now() - 20 * 60000).toISOString(), data: { instant: { details }, next_1_hours: { summary: { symbol_code: symbol } } } },
        { time: new Date(Date.now() + 40 * 60000).toISOString(), data: { instant: { details: { air_temperature: 99 } }, next_1_hours: { summary: { symbol_code: 'heavysnow' } } } },
      ],
    },
  });
  let asked = '', askedHeaders = {}, expires = null, status = 200;
  globalThis.fetch = async (url, opts) => {
    asked = String(url);
    askedHeaders = (opts && opts.headers) || {};
    return { ok: status >= 200 && status < 300, status, headers: { get: (k) => (String(k).toLowerCase() === 'expires' ? expires : null) }, json: async () => metBody() };
  };
  const call = async (origin, query = { lat: '37.9838', lng: '23.7275', units: 'c' }) => {
    const res = mockRes();
    const headers = { 'x-forwarded-for': '203.0.113.' + Math.floor(Math.random() * 200) };
    if (origin !== undefined) headers.origin = origin;
    await handler({ method: 'GET', query, headers }, res);
    return res;
  };
  try {
    const client = await call('https://www.freefromtravel.co.uk');
    ok('a client\'s own website may read it (Access-Control-Allow-Origin: *)', client.statusCode === 200 && client.headers['access-control-allow-origin'] === '*');
    const preview = await call('null');
    ok('so may the editor preview (a data: page, origin "null")', preview.headers['access-control-allow-origin'] === '*');
    ok('one cache entry per place for every site (no Vary: Origin)', !/origin/i.test(client.headers['vary'] || ''));
    ok('asks MET Norway\'s Locationforecast, with only the coordinates we checked',
      asked === 'https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=37.9838&lon=23.7275', asked);
    const ua = String(askedHeaders['User-Agent'] || '');
    ok('names itself in the User-Agent, as MET requires (a generic one gets a 403)', /TravelgenixWidgets\/\S+/.test(ua) && /widgets\.travelify\.io/.test(ua), ua);
    process.env.MET_NO_USER_AGENT = 'TravelgenixWidgets/1.2 ops@example.com';
    await call('https://www.freefromtravel.co.uk');
    ok('MET_NO_USER_AGENT can replace it (e.g. to add an email)', askedHeaders['User-Agent'] === 'TravelgenixWidgets/1.2 ops@example.com');
    delete process.env.MET_NO_USER_AGENT;
    const b = client.body;
    ok('answers in the same shape as before: 23°C, partly cloudy (WMO 2), daytime', b.ok === true && b.temp === 23 && b.code === 2 && b.desc === 'Partly cloudy' && b.isDay === true && b.source === 'met-norway', JSON.stringify(b));
    ok('the hour nearest now, not a later one', b.temp !== 99);
    ok('wind converted from m/s to km/h (6.7 m/s is 24 km/h)', b.wind === 24);
    ok('"feels like" worked out, since MET sends none (19.6, so 20°C here)', b.feels === 20, String(b.feels));
    ok('the browser keeps it 5 minutes, and with no Expires the edge keeps it 15', /max-age=300/.test(client.headers['cache-control']) && /s-maxage=900/.test(client.headers['cache-control']));
    expires = new Date(Date.now() + 40 * 60000).toUTCString();
    const later = await call('https://www.freefromtravel.co.uk');
    ok('MET\'s Expires is honoured: 40 minutes away means fresh for about 40 minutes', /s-maxage=(239\d|2400)\b/.test(later.headers['cache-control']), later.headers['cache-control']);
    expires = new Date(Date.now() + 5 * 3600000).toUTCString();
    const capped = await call('https://www.freefromtravel.co.uk');
    ok('but never more than an hour', /s-maxage=3600\b/.test(capped.headers['cache-control']));
    expires = null;
    status = 403;
    const refused = await call('https://www.freefromtravel.co.uk');
    ok('a refusal from MET is a clean 502 and is not cached', refused.statusCode === 502 && !refused.headers['cache-control']);
    status = 200;
    const f = await call('https://www.freefromtravel.co.uk', { lat: '37.9838', lng: '23.7275', units: 'f' });
    ok('°F on request (74°F)', f.body.temp === 74 && f.body.units === 'f');
  } finally { delete process.env.MET_NO_USER_AGENT; globalThis.fetch = realFetch; }
  ok('MET symbols map onto WMO codes: clear sky, fair, cloudy, fog',
    metSymbolToWmo('clearsky_night') === 0 && metSymbolToWmo('fair_day') === 1 && metSymbolToWmo('cloudy') === 3 && metSymbolToWmo('fog') === 45);
  ok('rain, showers, sleet and snow keep their strength',
    metSymbolToWmo('lightrain') === 61 && metSymbolToWmo('heavyrain') === 65 && metSymbolToWmo('rainshowers_day') === 81 &&
    metSymbolToWmo('sleet') === 69 && metSymbolToWmo('lightsleetshowers_day') === 83 && metSymbolToWmo('heavysnow') === 75);
  ok('anything with thunder is a thunderstorm, even MET\'s misspelt codes', metSymbolToWmo('heavyrainandthunder') === 95 && metSymbolToWmo('lightssleetshowersandthunder_day') === 95);
  ok('an unknown symbol is no code at all (the widget then shows no words)', metSymbolToWmo('somethingnew') === null && metSymbolToWmo('') === null);
  ok('feels like follows the BoM formula (30°C, 70%, still air: 35.8°C)', Math.abs(apparentTemp(30, 70, 0) - 35.77) < 0.01);
  const night = shapeResponse({ properties: { timeseries: [{ time: new Date().toISOString(), data: { instant: { details: { air_temperature: 12 } }, next_1_hours: { summary: { symbol_code: 'clearsky_night' } } } }] } }, 'c');
  ok('night is read from the symbol, and missing humidity or wind are left out', night.isDay === false && night.feels === null && night.wind === null && night.humidity === null);
  ok('no temperature in the answer: nothing to show', shapeResponse({ properties: { timeseries: [{ time: new Date().toISOString(), data: { instant: { details: {} } } }] } }, 'c') === null);
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
const LIVE = { ok: true, temp: 23.4, feels: 21.2, code: 2, desc: 'Partly cloudy', icon: 'sun-cloud', wind: 24, humidity: 52, isDay: true, units: 'c', source: 'met-norway' };

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
  ok('credits MET Norway, as its licence asks, with a safe link', credit && credit.getAttribute('href') === 'https://www.met.no/en' && /noopener/.test(credit.getAttribute('rel')) && credit.textContent === 'Data by MET Norway');
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
  const { win } = makeWin({ answer: Object.assign({}, LIVE, { code: 69 }), lang: 'de' });
  const { root } = mount(win, { destinationData: GREECE });
  await tick(10);
  ok('sleet, which MET reports, has words too (German: Schneeregen)', /Schneeregen/.test(root.querySelector('.tgw-live').textContent));
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
