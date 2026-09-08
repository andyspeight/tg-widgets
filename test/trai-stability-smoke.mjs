/**
 * Travel Results AI — the stability pass (8 Sep 2026, from the 7 Sep review).
 *
 * The widget used to wear the same card for the AI and for its rule-based
 * fallback, sent no widget id, counted nothing, and could vanish without a
 * trace. Now: the fallback is labelled and every outcome is an event with a
 * source or a reason; the widget id travels with the call and the alerts; a
 * load heartbeat fires once per page; a results set with nothing priced is
 * shown with a plain line rather than a call that would fail.
 *
 * Drives the REAL widget in jsdom against a mocked endpoint.
 *
 * Run: node test/trai-stability-smoke.mjs   (npm run test:trai-stability)
 */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };
const WIDGET = readFileSync(new URL('../public/widget-travel-results-ai.js', import.meta.url), 'utf8');
const WIDGET_ID = 'tgw_1781540609148_2e9uyk';

const hotel = (rid, name, price, extra) => Object.assign({ rid, name, starRating: 4, address: 'Marbella, Spain', latitude: 36.509, longitude: -4.886, description: 'Nice.', goodFor: ['Couples'], amenities: ['Pool', 'Wi-Fi'], tripadvisor: { rating: 4.5, reviewCount: 1820 }, units: [{ name: 'Double', rates: [{ board: 'Bed & Breakfast', price, currency: 'GBP', refundability: 'Refundable' }] }] }, extra || {});
const CRITERIA = { locationName: 'Costa del Sol, Spain', checkinDate: '2026-08-12', checkoutDate: '2026-08-19', nights: 7, passengers: { total: 2, adults: 2 }, rooms: 1, currency: 'GBP', latitude: 36.51, longitude: -4.88 };
const SAMPLE = { version: 4, searchSession: 'demo-session', criteria: CRITERIA, results: [hotel('p1', 'Hotel Marbella Bay', 1190), hotel('p2', 'Sol Playa Apartments', 720), hotel('p3', 'Gran Hotel Miramar', 2380), hotel('p4', 'Torremolinos Inn', 540)] };

async function run({ ai, payload = SAMPLE, config = {}, withId = true, settle = 300 }) {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://results.example.test/' });
  const { window } = dom;
  window.console = { log() {}, warn() {}, error() {} };
  try { delete window.navigator.sendBeacon; } catch (e) {}
  const logs = [], calls = [];
  window.fetch = (url, opts) => {
    const u = String(url);
    if (u.indexOf('/api/widget-log') > -1) { try { logs.push(JSON.parse(opts.body)); } catch (e) { logs.push({ raw: opts.body }); } return Promise.resolve({ ok: true, status: 200, json: async () => ({}) }); }
    if (u.indexOf('/api/travel-results-ai') > -1) { let body = null; try { body = JSON.parse(opts.body); } catch (e) {} calls.push(body); return ai(u, body); }
    if (u.indexOf('/api/widget-config') > -1) return Promise.resolve({ ok: true, status: 200, json: async () => ({ config }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  };
  if (withId) { const s = window.document.createElement('script'); s.setAttribute('src', 'https://tg-widgets.vercel.app/widget-travel-results-ai.js'); s.setAttribute('data-tg-id', WIDGET_ID); window.document.body.appendChild(s); }
  window.eval(WIDGET);
  await new Promise((r) => setTimeout(r, 20));
  window.dispatchEvent(new window.CustomEvent('tg:travel-results-v4:accommodation-results-ready', { detail: payload }));
  await new Promise((r) => setTimeout(r, settle));
  const events = (window.dataLayer || []).map((e) => ({ name: String(e.event || '').replace(/^tg_trai_/, ''), d: e.tgTrai || {} }));
  const host = window.document.getElementById('tg-trai-host');
  const root = host && host.shadowRoot;
  return { window, logs, calls, events, root, text: root ? root.textContent : '' };
}
const ev = (events, name) => events.filter((e) => e.name === name);
const aiOk = (recs, reply = 'Here you go.') => () => Promise.resolve({ ok: true, status: 200, json: async () => ({ version: 1, reply, recommendations: recs }) });

console.log('The widget id travels with the call and with alerts');
{
  const r = await run({ ai: aiOk([{ rid: 'p1', category: 'Best value', reason: 'Closest to the centre with a refundable rate.' }]) });
  ok(r.calls.length === 1 && r.calls[0].widgetId === WIDGET_ID, 'the endpoint payload carries widgetId');
  ok(r.calls[0].lang === 'en', 'and the visitor language');
  const load = r.logs.filter((l) => l.event === 'load');
  ok(load.length === 1 && load[0].widgetId === WIDGET_ID && load[0].widget === 'travel-results-ai', 'one load heartbeat with the widget id');
  ok(r.window.TravelgenixWidgets.travelResultsAiLastPayload === SAMPLE, 'the last payload is kept on the namespace for fixture capture');
  ok(r.window.TravelgenixWidgets.travelResultsAiVersion === '1.11.0', 'version bumped to 1.11.0');
}
{
  const r = await run({ ai: () => Promise.resolve({ ok: false, status: 403, json: async () => ({ error: 'Origin not allowed for this widget', code: 'not_on_plan' }) }) });
  const alerts = r.logs.filter((l) => l.event === 'error');
  ok(alerts.length === 1 && alerts[0].widgetId === WIDGET_ID && /HTTP 403/.test(alerts[0].detail || ''), 'a refused call alerts WITH the widget id');
}

console.log('The fallback is labelled and every outcome is an event');
{
  const r = await run({ ai: aiOk([{ rid: 'p1', category: 'Best value', reason: 'Closest to the centre with a refundable rate.' }, { rid: 'p2', category: 'Top reviewed', reason: 'Best-reviewed option under your budget.' }]) });
  ok(!r.root.querySelector('.fbnote'), 'an AI answer carries no fallback note');
  const rec = ev(r.events, 'recommendations');
  ok(rec.length === 1 && rec[0].d.source === 'ai' && rec[0].d.count === 2, 'the recommendations event says source ai');
  ok(ev(r.events, 'fallback').length === 0, 'no fallback event on a good answer');
}
{
  const r = await run({ ai: () => Promise.resolve({ ok: false, status: 502, json: async () => ({ error: 'AI service unavailable' }) }) });
  const note = r.root.querySelector('.fbnote');
  ok(note && note.textContent === 'Quick picks while the assistant is unavailable.', 'a failed call shows the honest note');
  ok(r.root.querySelectorAll('.rec').length > 0, 'and still shows rule-based picks');
  const fb = ev(r.events, 'fallback');
  ok(fb.length === 1 && fb[0].d.reason === 'http_502', 'fallback event carries the reason');
  const rec = ev(r.events, 'recommendations');
  ok(rec.length === 1 && rec[0].d.source === 'fallback', 'recommendations event says source fallback');
}
{
  const r = await run({ ai: () => Promise.reject(new TypeError('Failed to fetch')) });
  const fb = ev(r.events, 'fallback');
  ok(fb.length === 1 && fb[0].d.reason === 'network', 'a network reject is reason network');
  ok(r.root.querySelector('.fbnote'), 'and is labelled');
}
{
  const r = await run({ ai: aiOk([{ rid: 'nope', category: 'x', reason: 'y' }]) });
  const fb = ev(r.events, 'fallback');
  ok(fb.length === 1 && fb[0].d.reason === 'no_valid_picks', 'picks that fail the rid check are a fallback with reason no_valid_picks');
  ok(r.root.querySelector('.fbnote'), 'and are labelled');
}
{
  const r = await run({ ai: aiOk([{ rid: 'p4', category: 'Best for families', reason: 'Great kids club and a spa on site.' }]) });
  const rr = ev(r.events, 'reason_replaced');
  ok(rr.length === 1 && rr[0].d.rid === 'p4', 'a reason the checker rewrites fires reason_replaced');
  ok(ev(r.events, 'recommendations')[0].d.source === 'ai', 'but the answer is still the AI');
}

console.log('Nothing usable: shown with a line, or hidden with a reason');
{
  const unpriced = { ...SAMPLE, results: [hotel('p1', 'A', 0, { units: [{ name: 'Double', rates: [] }] }), hotel('p2', 'B', 0, { units: [{ name: 'Twin', rates: [] }] })] };
  const r = await run({ ai: aiOk([]), payload: unpriced });
  ok(r.calls.length === 0, 'no endpoint call when nothing has a price');
  ok(r.logs.filter((l) => l.event === 'error').length === 0, 'and no false alert');
  const panel = r.root.getElementById('panel');
  ok(panel && panel.style.display !== 'none', 'the panel is revealed rather than left hidden');
  ok(/No clear matches/.test(r.text) && r.root.querySelector('.fbnote'), 'with the plain line and the honest note');
  const fb = ev(r.events, 'fallback');
  ok(fb.length === 1 && fb[0].d.reason === 'no_candidates', 'fallback event says no_candidates');
}
{
  const r = await run({ ai: aiOk([]), payload: { ...SAMPLE, results: [] } });
  const hid = ev(r.events, 'hidden');
  ok(hid.length === 1 && hid[0].d.reason === 'no_results', 'no results at all: hidden event with reason no_results');
  const panel = r.root.getElementById('panel');
  ok(panel && panel.style.display === 'none', 'and the panel stays hidden');
}

console.log('Six languages carry the note');
{
  for (const l of ['en', 'fr', 'de', 'es', 'it', 'ro']) ok(new RegExp("^\\s+fallbackNote: '", 'm').test(WIDGET) && (WIDGET.match(/fallbackNote:/g) || []).length === 6, 'fallbackNote present x6 (' + l + ')');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
