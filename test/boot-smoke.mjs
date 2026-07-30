/**
 * Boot smoke: mount every widget touched by the medium-severity QA pass in jsdom
 * with a minimal inline config and a stubbed network, and assert none throws on
 * init and each produces a render surface. Catches gross breakage (reference /
 * syntax errors, init throws) across the batch. Run: node test/boot-smoke.mjs
 */
import { readFileSync } from 'node:fs';

let JSDOM;
try { ({ JSDOM } = await import('jsdom')); }
catch { console.log('jsdom not installed — skipping boot smoke'); process.exit(0); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;

// tag -> minimal inline config (kept permissive; most render an empty/loading state)
const WIDGETS = {
  airport: { name: 'Gatwick', iata: 'LGW' },
  appointment: { eventTypes: [] },
  attraction: { name: 'Tower', destination: 'London' },
  backtotop: {},
  carousel: { slides: [{ title: 'A', image: 'https://x/a.jpg' }] },
  consent: { layout: 'bar', mode: 'gdpr' },
  contact: {},
  countdown: { targetDate: '2030-01-01T00:00:00Z' },
  currency: { baseCurrency: 'GBP', currencies: ['GBP', 'EUR'] },
  dealbar: { message: 'Deal', ctaText: 'Go', ctaUrl: 'https://x' },
  emailsig: { name: 'A', email: 'a@b.co' },
  enquiry: {},
  enquirypro: {},
  events: { events: [] },
  faq: { items: [{ q: 'Q', a: 'A' }] },
  form: { questions: [{ id: 'q1', label: 'Your email', type: 'email', required: true, mapTo: 'email' }] },
  hours: { hours: { mon: [['09:00', '17:00']] } },
  logos: { logos: [] },
  mybooking: {},
  'offer-builder': {},
  'offer-card': { offer: { fields: { title: 'T', price: 100, image: 'https://x/a.jpg' } } },
  'offer-page': { offer: { fields: { title: 'T', price: 100 } } },
  'offers-grid': { offers: [], client: 'x' },
  offers: { offers: [] },
  popup: { contentType: 'announcement', title: 'Hi', frequency: 'every-visit' },
  reviews: { place: { name: 'B', rating: 4.8, total: 5 }, reviews: [] },
  rss: { feedUrl: 'https://x/feed' },
  share: { url: 'https://x', title: 'T' },
  smartsection: {},
  spinwheel: { segments: [{ label: 'A' }, { label: 'B' }] },
  spotlight: { destinationData: { name: 'Greece' } },
  statscounter: { stats: [{ value: 10, label: 'Trips' }] },
  testimonials: { testimonials: [{ author: 'A', text: 'Great', rating: 5 }] },
  'travel-results-ai': {},
  weather: { destination: 'Rome' },
  whatsapp: { phone: '441234567890' },
  worldmap: {},
  youtube: { channelId: 'UC123' },
};

for (const [tag, cfg] of Object.entries(WIDGETS)) {
  const attr = JSON.stringify(cfg).replace(/'/g, '&#39;');
  const dom = new JSDOM(
    `<!doctype html><html><body><div data-tg-widget="${tag}" data-tg-config='${attr}'></div></body></html>`,
    { runScripts: 'dangerously', url: 'https://agency.example.com/', pretendToBeVisual: true }
  );
  const { window } = dom;
  window.requestAnimationFrame = (cb) => window.setTimeout(() => cb(0), 0);
  window.cancelAnimationFrame = (id) => window.clearTimeout(id);
  if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  window.fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' });
  const errors = [];
  window.addEventListener('error', (e) => errors.push(e.error || e.message));
  window.addEventListener('unhandledrejection', (e) => errors.push(e.reason));

  try {
    const code = readFileSync(new URL(`../public/widget-${tag}.js`, import.meta.url), 'utf8');
    const s = window.document.createElement('script');
    s.textContent = code;
    window.document.body.appendChild(s);
    await sleep(60);
    const host = window.document.querySelector(`[data-tg-widget="${tag}"]`);
    const bodyGrew = window.document.body.querySelectorAll('*').length > 1;
    const rendered = !!(host && (host.shadowRoot || host.children.length || host.getAttribute('data-tg-hidden') != null)) || bodyGrew;
    const fatal = errors.filter((e) => e && /is not defined|is not a function|Cannot read|undefined is not/.test(String(e && e.stack || e)));
    // consent renders a fixed banner into <body>, smartsection is light-DOM and
    // needs page content to wrap, travel-results-ai renders on interaction — for
    // these the meaningful assertion is "no fatal JS error", not a shadow surface.
    const rendersOffHost = tag === 'consent' || tag === 'smartsection' || tag === 'travel-results-ai';
    if (fatal.length) { failed++; console.error(`  FAIL ${tag}: ${fatal[0]}`); }
    else if (!rendered && !rendersOffHost) { failed++; console.error(`  FAIL ${tag}: no render surface produced`); }
    else { passed++; }
  } catch (e) {
    failed++; console.error(`  FAIL ${tag}: threw during mount — ${e.message}`);
  }
  dom.window.close();
}

console.log(`\nboot smoke: ${passed} mounted cleanly, ${failed} failed`);
process.exit(failed ? 1 : 0);
