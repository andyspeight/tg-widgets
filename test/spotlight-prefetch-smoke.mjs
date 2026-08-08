/**
 * Spotlight family speed — Step 3: fire config + content in parallel.
 *
 * The widgets used to fetch their display config, then (only once it arrived)
 * fetch their content — a waterfall. Now the content request is kicked off in
 * init at the same time as the config, and the load method consumes it.
 *
 * This loads a widget in jsdom with a fetch stub that counts requests in flight,
 * and asserts the config and content requests overlapped and the prefetched
 * content was actually consumed. Plus source guards that all five widgets wire
 * the prefetch. Airport is the representative (no auto-detect); spotlight's
 * fixed-destination path is checked too.
 *
 * Run: node test/spotlight-prefetch-smoke.mjs  (also: npm run test:spotlight-prefetch)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Drive one widget: eval it in a jsdom window with a concurrency-tracking fetch
// stub, then report what happened.
async function run(widgetFile, tag, id, contentMatch, contentPayload) {
  const SRC = readFileSync(join(ROOT, 'public', widgetFile), 'utf8');
  const dom = new JSDOM('<!doctype html><body><div data-tg-widget="' + tag + '" data-tg-id="' + id + '"></div></body>', {
    runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://client.example/holidays',
  });
  const { window } = dom;
  window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  // The widget resolves its API base from the script origin; force it explicit.
  window.__TG_WIDGET_API__ = 'https://widgets.test/api/widget-config';
  window.__TG_DEST_CONTENT_API__ = 'https://widgets.test/api/destination-content';
  window.__TG_AIRPORT_CONTENT_API__ = 'https://widgets.test/api/airport-content';
  window.__TG_ATTRACTION_API__ = 'https://widgets.test/api/attraction-content';
  window.__TG_EVENTS_API__ = 'https://widgets.test/api/events-content';

  const state = { inFlight: 0, maxInFlight: 0, configFetched: false, contentFetched: false, contentJsonRead: false };
  window.fetch = async (url) => {
    const u = String(url);
    state.inFlight++; if (state.inFlight > state.maxInFlight) state.maxInFlight = state.inFlight;
    try {
      await wait(25);
      if (u.indexOf('/api/widget-config') !== -1) {
        state.configFetched = true;
        return { ok: true, status: 200, json: async () => ({ config: { widgetId: id }, name: 'x' }) };
      }
      if (u.indexOf(contentMatch) !== -1) {
        state.contentFetched = true;
        return { ok: true, status: 200, json: async () => { state.contentJsonRead = true; return contentPayload; } };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    } finally { state.inFlight--; }
  };

  // eslint-disable-next-line no-eval
  window.eval(SRC);
  await wait(180); // let init fire both requests and the widget consume the content
  return state;
}

console.log('Airport: config and content fetch together, content consumed');
{
  const s = await run('widget-airport.js', 'airport', 'tgw_air', '/api/airport-content',
    { found: true, airport: { iata: 'DLM', name: 'Dalaman', servesResorts: [], facts: {}, sections: {} } });
  ok('config was requested', s.configFetched);
  ok('content was requested', s.contentFetched);
  ok('the two overlapped (maxInFlight >= 2)', s.maxInFlight >= 2);
  ok('the prefetched content was consumed', s.contentJsonRead);
}

console.log('Spotlight (fixed destination): config and content fetch together');
{
  const s = await run('widget-spotlight.js', 'spotlight', 'tgw_spot', '/api/destination-content',
    { level: 'country', name: 'Greece', images: [], climate: {}, facts: {}, highlights: [], bestForTags: [], events: [], planning: {}, pairedWith: [] });
  ok('config was requested', s.configFetched);
  ok('content was requested', s.contentFetched);
  ok('the two overlapped (maxInFlight >= 2)', s.maxInFlight >= 2);
  ok('the prefetched content was consumed', s.contentJsonRead);
}

console.log('All five widgets wire the parallel prefetch');
{
  const files = {
    spotlight: 'widget-spotlight.js', airport: 'widget-airport.js', weather: 'widget-weather.js',
    attraction: 'widget-attraction.js', events: 'widget-events.js',
  };
  for (const [name, f] of Object.entries(files)) {
    const src = readFileSync(join(ROOT, 'public', f), 'utf8');
    ok(name + ': defines startContent()', /function startContent\(/.test(src));
    ok(name + ': init hands over __contentResponse', /__contentResponse = contentP/.test(src));
    ok(name + ': load consumes the prefetch', /this\.(c|cfg) && this\.(c|cfg)\.__contentResponse/.test(src) || /const prefetched = this\.(c|cfg)/.test(src));
  }
  const spot = readFileSync(join(ROOT, 'public', 'widget-spotlight.js'), 'utf8');
  ok('spotlight aborts the prefetch in auto-detect mode', /prefetched\.__abort\(\)/.test(spot));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
