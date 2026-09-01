/**
 * Weather widget — the root wrapper is transparent (Andy feedback, Sep 2026).
 *
 * .tgw-root used to paint a solid --tgw-bg (#FFFFFF light / #0F172A dark). That
 * put an opaque square behind the rounded .tgw-card, so on any coloured host
 * page the card's corners showed white/dark triangles instead of the page. The
 * fix: the root is transparent; only the card paints a background. The --tgw-bg
 * token stays because the dark-mode climate toggle reuses it as a cutout colour.
 *
 * Source guard (the widget builds its CSS as a string inside the IIFE, no DOM
 * unit test). Run: node test/weather-transparent-root-smoke.mjs
 *   (npm run test:weather-transparent)
 */
import { readFileSync } from 'node:fs';

const WIDGET = readFileSync(new URL('../public/widget-weather.js', import.meta.url), 'utf8');

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };

// Isolate the .tgw-root { ... } rule block (up to its first closing brace).
const rootStart = WIDGET.indexOf('.tgw-root {');
const rootBlock = WIDGET.slice(rootStart, WIDGET.indexOf('}', rootStart));

console.log('The root wrapper paints no background — corners show the host page');
{
  ok('.tgw-root sets background: transparent', /background:\s*transparent/.test(rootBlock));
  ok('.tgw-root no longer paints the opaque --tgw-bg fill', !/background:\s*var\(--tgw-bg\)/.test(rootBlock));
  ok('.tgw-root paints no hard-coded white/dark either', !/background:\s*#(fff|ffffff|0f172a)/i.test(rootBlock));
}

console.log('The card itself is still opaque — only the wrapper went transparent');
{
  const cardStart = WIDGET.indexOf('.tgw-card {');
  const cardBlock = WIDGET.slice(cardStart, WIDGET.indexOf('}', cardStart));
  ok('.tgw-card still paints var(--tgw-card)', /background:\s*var\(--tgw-card\)/.test(cardBlock));
  ok('.tgw-card keeps its rounded corners', /border-radius:\s*var\(--tgw-radius\)/.test(cardBlock));
}

console.log('The --tgw-bg token survives for the dark-mode toggle cutout');
{
  ok('--tgw-bg is still declared', /--tgw-bg:\s*#FFFFFF/.test(WIDGET));
  ok('--tgw-bg is used exactly once now (the toggle), not on the root', (WIDGET.match(/background:\s*var\(--tgw-bg\)/g) || []).length === 1);
  ok('the dark toggle still reads --tgw-bg', /\.tgw-root\[data-theme="dark"\]\s*\.tgw-climate-unit\[aria-pressed="true"\][\s\S]*?background:\s*var\(--tgw-bg\)/.test(WIDGET));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
