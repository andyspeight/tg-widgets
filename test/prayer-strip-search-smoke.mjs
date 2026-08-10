/**
 * Prayer Times — type-to-search on the horizontal (strip) layout (Andy, 10 Aug 2026).
 *
 * Bug: on the strip layout there was no way to type a destination on the live
 * widget. _renderStrip ignored locationSearch and only ever offered the plain
 * name or the quick-pick <select>; the type-to-search combobox was card-only.
 *
 * Fix: the strip lead renders the same combobox the card uses (a .tgpt-search
 * input + a [data-search-panel] results panel) when locationSearch is on, so
 * _bindSearch() — which is layout-agnostic — wires it up. The lead bar is the
 * dark brand colour, so the input + placeholder get white ink.
 *
 * Source guards over public/widget-prayer.js (jsdom is a CI-only devDep; the
 * behavioural flow is exercised in test/prayer-times-smoke.mjs).
 *
 * Run: node test/prayer-strip-search-smoke.mjs  (also: npm run test:prayer-strip-search)
 */
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../public/widget-prayer.js', import.meta.url), 'utf8');

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };

// Isolate the strip render so a card-only match can't satisfy these guards.
// Anchor on the method DEFINITIONS ('name() {'), not the earlier call sites.
const start = SRC.indexOf('_renderStrip() {');
const end = SRC.indexOf('_updateDynamic() {', start);
const strip = SRC.slice(start, end);
ok('found the _renderStrip body', start !== -1 && end !== -1 && strip.length > 200);

console.log('Strip renders the type-to-search combobox when locationSearch is on');
{
  ok('branches on this.c.locationSearch', /if\s*\(\s*this\.c\.locationSearch\s*\)/.test(strip));
  ok('renders the search input in the lead bar',
    /tgpt-strip-lead-loc--search/.test(strip) && /input class="tgpt-search"/.test(strip));
  ok('input is pre-filled with the current location name (escaped)',
    /placeholder="Search a city" value="'\s*\+\s*esc\(this\._locName\(\)\)/.test(strip));
  ok('renders the results panel _bindSearch looks for',
    /data-search-panel/.test(strip));
  ok('the panel is a sibling of the strip (below it, not clipped)',
    /'<\/div>'\s*\+\s*\n?\s*panel\s*\+/.test(strip) || /\+\s*panel\s*\+/.test(strip));
}

console.log('Plain layout still falls back to name / quick-pick dropdown');
{
  ok('else branch keeps the pin + picker/name',
    /else\s*\{[\s\S]{0,200}?_pickerActive\(\)[\s\S]{0,120}?tgpt-strip-lead-loc/.test(strip));
}

console.log('_bindSearch is wired for every layout (generic)');
{
  ok('_render calls _bindSearch when locationSearch is on',
    /if\s*\(this\.c\.locationSearch\)\s*this\._bindSearch\(\);/.test(SRC));
  ok('_bindSearch resolves controls off this.root (layout-agnostic)',
    /_bindSearch\(\)\s*\{[\s\S]{0,160}?this\.root\.querySelector\('\.tgpt-search'\)/.test(SRC));
}

console.log('CSS gives the dark lead bar white ink');
{
  ok('.tgpt-strip-lead-loc--search stretches to full width',
    /\.tgpt-strip-lead-loc--search\s*\{[^}]*width:\s*100%/.test(SRC));
  ok('search input text is white on the strip',
    /\.tgpt-strip-lead-loc--search\s+\.tgpt-search\s*\{\s*color:\s*#fff;\s*\}/.test(SRC));
  ok('search placeholder is legible white on the strip',
    /\.tgpt-strip-lead-loc--search\s+\.tgpt-search::placeholder\s*\{\s*color:\s*rgba\(255,255,255/.test(SRC));
}

console.log('Version bumped for the fix');
{
  const vm = SRC.match(/const VERSION = '(\d+)\.(\d+)\.(\d+)'/);
  const atLeast = vm && (+vm[1] > 1 || (+vm[1] === 1 && (+vm[2] > 0 || (+vm[2] === 0 && +vm[3] >= 1))));
  ok('VERSION is at or beyond 1.0.1', !!atLeast);
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
