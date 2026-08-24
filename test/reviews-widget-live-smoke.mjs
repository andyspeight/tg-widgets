/**
 * Reviews widget — live Google connection (Aug 2026).
 *
 * When c.liveSource + c.liveId are set, a REAL embed pulls the latest reviews
 * from our cached feed on load and shows them (with Google branding and the real
 * overall rating/count). The reviews baked into config are the instant first
 * paint and the offline fallback. Two safety rules matter:
 *   - The CONSTRUCTOR must never fetch — otherwise the editor preview and the
 *     dashboard mini-preview would spend billed Wextractor calls on every
 *     re-render. Only the init() real-embed path calls _loadLive().
 *   - A live failure must keep the baked snapshot, never blank the widget.
 *
 * jsdom + a mocked fetch — no network, no credits.
 *
 * Run: node test/reviews-widget-live-smoke.mjs   (npm run test:reviews-widget-live)
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const WIDGET = readFileSync(new URL('../public/widget-reviews.js', import.meta.url), 'utf8');

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FEED = {
  ok: true, source: 'google',
  business: { id: 'ChIJ_x', name: 'Sunshine Travel' },
  rating: { average: 4.7, count: 1234 },
  count: 2,
  reviews: [
    { id: 'g1', author: 'Jane Smith', rating: 5, text: 'Faultless honeymoon booking.', date: '2026-07-03', source: 'google', photoUrl: '', hasPhoto: false, helpful: 2, reply: 'Thank you Jane!', tags: [] },
    { id: 'g2', author: 'Tom Brown', rating: 4, text: 'Good value, would use again.', date: '2026-06-15', source: 'google', photoUrl: '', hasPhoto: false, helpful: 0, reply: '', tags: [] },
  ],
  updated: '2026-08-24T00:00:00.000Z',
};

function makeWindow() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'dangerously', pretendToBeVisual: true });
  const s = dom.window.document.createElement('script');
  s.textContent = WIDGET;
  dom.window.document.body.appendChild(s);
  return dom.window;
}

console.log('A real embed upgrades to the live feed');
{
  const window = makeWindow();
  const calls = [];
  window.fetch = async (url) => { calls.push(String(url)); return { ok: true, json: async () => FEED }; };

  const el = window.document.createElement('div');
  window.document.body.appendChild(el);
  const w = new window.TGReviewsWidget(el, { liveSource: 'google', liveId: 'ChIJ_x', reviews: [] });

  ok('the constructor does NOT fetch (editor/dashboard cost safety)', calls.length === 0);

  await w._loadLive();
  await sleep(0);

  ok('_loadLive fetched the reviews feed', calls.length === 1 && /\/reviews-feed\?/.test(calls[0]));
  ok('it passed the source and id', /source=google/.test(calls[0]) && /id=ChIJ_x/.test(calls[0]));
  ok('the live reviews replace the (empty) config reviews', w.c.reviews.length === 2);
  ok('a reply string is normalised to { author, text }', w.c.reviews[0].reply && w.c.reviews[0].reply.text === 'Thank you Jane!' && w.c.reviews[0].reply.author === 'Sunshine Travel');
  ok('a blank reply becomes null (no empty reply box)', w.c.reviews[1].reply === null);
  ok('the overall rating comes from the feed', w.c.place.rating === 4.7 && w.c.place.total === 1234);
  ok('the business name comes from the feed', w.c.place.name === 'Sunshine Travel');

  const html = w.shadow.innerHTML;
  ok('a live review renders in the shadow DOM', /Faultless honeymoon booking/.test(html));
}

console.log('A live failure keeps the baked snapshot (never blanks)');
{
  const window = makeWindow();
  window.fetch = async () => { throw new Error('network down'); };

  const snapshot = [{ id: 's1', author: 'Saved User', rating: 5, text: 'Snapshot review from config.', date: '2026-01-01', source: 'google', reply: null, tags: [] }];
  const el = window.document.createElement('div');
  window.document.body.appendChild(el);
  const w = new window.TGReviewsWidget(el, { liveSource: 'google', liveId: 'ChIJ_x', reviews: JSON.parse(JSON.stringify(snapshot)) });

  await w._loadLive();
  await sleep(0);

  ok('the snapshot reviews survive a failed live fetch', w.c.reviews.length === 1 && w.c.reviews[0].text === 'Snapshot review from config.');
  ok('the widget still shows the snapshot', /Snapshot review from config/.test(w.shadow.innerHTML));
}

console.log('With no connection, nothing is fetched');
{
  const window = makeWindow();
  const calls = [];
  window.fetch = async (url) => { calls.push(String(url)); return { ok: true, json: async () => FEED }; };
  const el = window.document.createElement('div');
  window.document.body.appendChild(el);
  const w = new window.TGReviewsWidget(el, { reviews: [{ id: 'm1', author: 'A', rating: 5, text: 'Manual only.', date: '2026-01-01', reply: null, tags: [] }] });
  await w._loadLive();
  await sleep(0);
  ok('_loadLive is a no-op without liveSource/liveId', calls.length === 0);
  ok('manual reviews are untouched', w.c.reviews.length === 1 && w.c.reviews[0].text === 'Manual only.');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
