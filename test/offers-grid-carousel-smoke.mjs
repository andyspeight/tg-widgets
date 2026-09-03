/**
 * Special Offers Grid — carousel display + type/tag filter (client feedback,
 * Sep 2026: "a carousel of all offers of a certain type", because a grid of
 * every offer makes the page very long).
 *
 * `display:"carousel"` lays the same offer cards on a horizontal scroll-snap
 * track (arrows, dots, swipe, opt-in autoplay that never runs under reduced
 * motion), and `filterType` / `filterTags` show only offers of one builder
 * type or carrying a tag — in either display — so several typed embeds can
 * share one offer pool.
 *
 * Source-guards the new code paths, then functionally mounts the REAL grid
 * widget in jsdom (with a stub card, inline offers so no network) and checks
 * the carousel markup, the filters and the calm empty state.
 *
 * Run: node test/offers-grid-carousel-smoke.mjs   (npm run test:offers-grid-carousel)
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const GRID = readFileSync(new URL('../public/widget-offers-grid.js', import.meta.url), 'utf8');
const EDITOR = readFileSync(new URL('../public/editor-offer-builder.html', import.meta.url), 'utf8');

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };

console.log('Source guards — the carousel is additive and safe');
{
  ok('display is whitelisted (anything but carousel falls back to grid)',
    /display: c\.display === 'carousel' \? 'carousel' : 'grid'/.test(GRID));
  ok('the carousel track is a scroll-snap flex row',
    /\.tgog-car-track \{[\s\S]*?scroll-snap-type: x mandatory;/.test(GRID));
  ok('reduced motion kills smooth scrolling on the track',
    /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.tgog-car-track \{ scroll-behavior: auto; \}/.test(GRID));
  ok('autoplay is gated OFF for reduced-motion visitors',
    /carouselAutoplay && !reduce/.test(GRID));
  ok('reduced motion also governs arrow/dot/keyboard scrolling (explicit smooth would override the CSS)',
    /reduce \? 'auto' : 'smooth'/.test(GRID) && /behavior: scrollBehavior/.test(GRID));
  ok('autoplay interval is clamped to sane bounds',
    /Math\.max\(2, Math\.min\(20, this\.cfg\.carouselInterval \|\| 6\)\) \* 1000/.test(GRID));
  ok('a deliberate stop (arrow/dot/keyboard) sticks — autoplay cannot restart itself',
    /userStopped/.test(GRID) && /!autoplayOn \|\| userStopped \|\| timer/.test(GRID));
  ok('autoplay self-terminates when the widget DOM is discarded (no zombie timers on rebuild)',
    /track\.isConnected/.test(GRID) && /removeEventListener\('visibilitychange'/.test(GRID));
  ok('arrows use aria-disabled, never the native attribute (disabling a focused button dumps focus to body)',
    /aria-disabled/.test(GRID) && !/\.disabled = /.test(GRID));
  ok('the clamped final scroll position counts as the LAST page (5 offers at 3-up lights dot 2 of 2)',
    /atTrackEnd\(\)\) return pages - 1;/.test(GRID));
  ok('the type/tag filter helper exists and lower-cases both sides',
    /function matchesFilter\(item, cfg\)/.test(GRID) && /filterTags\.indexOf\(String\(tags\[i\]\)\.trim\(\)\.toLowerCase\(\)\)/.test(GRID));
  ok('filter values are normalised once in _defaults',
    /filterType: String\(c\.filterType \|\| ''\)\.trim\(\)\.toLowerCase\(\)/.test(GRID));
  ok('nothing in the wire path steals focus or scrolls the host page',
    !/scrollIntoView/.test(GRID) && !/\.focus\(/.test(GRID));
  ok('the accent custom property only accepts a hex colour',
    /\/\^#\[0-9a-fA-F\]\{3,8\}\$\/\.test\(cfg\.accentColor\)/.test(GRID));
  ok('VERSION bumped to 0.2+', (() => {
    const m = GRID.match(/const VERSION = '(\d+)\.(\d+)\.(\d+)'/);
    return !!m && (+m[1] > 0 || +m[2] >= 2);
  })());
}

console.log('Editor guards — the builder editor exposes display + filter');
{
  ok('a Grid/Carousel display control exists', /id="displayGrid"/.test(EDITOR) && /data-display="carousel"/.test(EDITOR));
  ok('carousel sub-options (autoplay + interval) exist', /id="cfgCarAutoplay"/.test(EDITOR) && /id="cfgCarInterval"/.test(EDITOR));
  ok('the type filter offers the builder type list (Cruise, Ski holiday…)',
    /id="cfgFilterType"/.test(EDITOR) && /<option>Cruise<\/option>/.test(EDITOR) && /<option>Ski holiday<\/option>/.test(EDITOR));
  ok('a tags filter input exists', /id="cfgFilterTags"/.test(EDITOR));
  ok('the embed snippet carries display + filters',
    /conf\.display = 'carousel'/.test(EDITOR) && /conf\.filterType = c\.filterType/.test(EDITOR) && /conf\.filterTags = c\.filterTags/.test(EDITOR));
  ok('tag input strips apostrophes (the embed lives in a single-quoted attribute)',
    /replace\(\/'\/g, ''\)/.test(EDITOR));
}

console.log('Functional — the real widget in jsdom with inline offers');
{
  const { window } = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'dangerously', pretendToBeVisual: true });
  // Stub the card so ensureCard() resolves without loading widget-offer-card.js.
  const stub = window.document.createElement('script');
  stub.textContent = 'window.TGOfferCardWidget = function (el, cfg) { el.setAttribute("data-stub-card", (cfg.offer && cfg.offer.fields && cfg.offer.fields.title) || ""); };';
  window.document.body.appendChild(stub);
  const s = window.document.createElement('script'); s.textContent = GRID; window.document.body.appendChild(s);

  const OFFERS = [
    { id: 'o1', offer: { currency: 'GBP', fields: { title: 'Cancun', type: 'Package holiday (flight + hotel)' }, tags: ['Family friendly'] } },
    { id: 'o2', offer: { currency: 'GBP', fields: { title: 'Fjords', type: 'Cruise' }, tags: ['Cruise', 'Scenic'] } },
    { id: 'o3', offer: { currency: 'GBP', fields: { title: 'Val Thorens', type: 'Ski holiday' }, tags: ['Ski'] } },
    { id: 'o4', offer: { currency: 'GBP', fields: { title: 'Algarve', type: 'Hotel / accommodation only' }, tags: [] } },
    { id: 'o5', offer: { currency: 'GBP', fields: { title: 'Med cruise', type: 'Cruise' }, tags: ['cruise'] } },
    { id: 'o6', offer: { currency: 'GBP', fields: { title: 'Tenerife', type: 'Package holiday (flight + hotel)' }, tags: [] } },
  ];
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const mk = (cfg) => {
    const d = window.document.createElement('div');
    window.document.body.appendChild(d);
    return new window.TGOffersGridWidget(d, Object.assign({ offers: OFFERS }, cfg || {}));
  };

  const grid = mk({});
  await tick();
  ok('default display is the classic grid (no carousel frame)',
    !!grid.root.querySelector('.tgog-items.grid') && !grid.root.querySelector('[data-car]'));
  ok('all six offers render as cards in the grid',
    grid.root.querySelectorAll('[data-stub-card]').length === 6);

  const car = mk({ display: 'carousel' });
  await tick();
  ok('carousel display renders the frame, track, arrows and dot rail',
    !!car.root.querySelector('[data-car]') && !!car.root.querySelector('[data-track]')
    && !!car.root.querySelector('.tgog-car-arrow[data-dir="prev"]') && !!car.root.querySelector('.tgog-car-arrow[data-dir="next"]')
    && !!car.root.querySelector('[data-dots]'));
  ok('the track is keyboard-focusable with a real role and accessible name',
    car.root.querySelector('[data-track]').getAttribute('tabindex') === '0'
    && car.root.querySelector('[data-track]').getAttribute('role') === 'group'
    && car.root.querySelector('[data-track]').getAttribute('aria-roledescription') === 'carousel'
    && !!car.root.querySelector('[data-track]').getAttribute('aria-label'));
  ok('all six offers become slides', car.root.querySelectorAll('[data-track] > div').length === 6);
  ok('slides get explicit pixel widths from the wire step',
    /px$/.test(car.root.querySelector('[data-track] > div').style.width || ''));
  {
    const dots = car.root.querySelectorAll('[data-dot]');
    ok('the dot rail is built from real cards-per-view (6 offers / 3-up = 2 pages)', dots.length === 2);
    ok('the first dot is current', dots.length > 0 && dots[0].getAttribute('aria-current') === 'true');
  }

  const cruises = mk({ display: 'carousel', filterType: 'Cruise' });
  await tick();
  ok('filterType shows only offers of that type', cruises.root.querySelectorAll('[data-track] > div').length === 2);

  const tagged = mk({ filterTags: ['SKI'] });
  await tick();
  ok('filterTags matches case-insensitively, in the grid too',
    tagged.root.querySelectorAll('[data-stub-card]').length === 1
    && tagged.root.querySelector('[data-stub-card]').getAttribute('data-stub-card') === 'Val Thorens');

  const none = mk({ filterType: 'Rail holiday' });
  await tick();
  ok('a filter that matches nothing shows the calm empty state', !!none.root.querySelector('.tgog-empty'));

  const max = mk({ display: 'carousel', filterType: 'Cruise', max: 1 });
  await tick();
  ok('max still caps the filtered list', max.root.querySelectorAll('[data-track] > div').length === 1);
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
