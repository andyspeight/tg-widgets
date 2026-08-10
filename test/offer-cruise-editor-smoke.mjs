/**
 * Special Offers — Cruise design picker in the editor (Andy, 10 Aug 2026).
 *
 * "Cruise" is now a one-click design in the offer builder: a Cruise card style
 * plus a Cruise page template, coupled so choosing either sets both. The grid
 * also couples defensively — a cruise page template renders cruise cards even on
 * a hand-written embed. Demo pages expose the option too.
 *
 * Source guards over the editor HTML + grid widget + demos.
 *
 * Run: node test/offer-cruise-editor-smoke.mjs  (also: npm run test:offer-cruise-editor)
 */
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

const rd = (p) => readFileSync(new URL('../public/' + p, import.meta.url), 'utf8');
const editor = rd('editor-offer-builder.html');
const grid = rd('widget-offers-grid.js');
const demoPage = rd('demo-offer-page.html');
const demoGrid = rd('demo-offers-grid.html');

// Both pickers offer Cruise.
ok(/data-layout="cruise"/.test(editor), 'editor: Cruise card style button');
ok(/<option value="cruise">Cruise<\/option>/.test(editor), 'editor: Cruise page template option');

// Coupled so it reads as one design choice.
ok(/function syncCruise\(source\)/.test(editor), 'editor: syncCruise coupling helper');
ok(/source === 'layout' && c\.cardLayout === 'cruise'[\s\S]{0,80}c\.template = 'cruise'/.test(editor), 'picking the Cruise card sets the Cruise page');
ok(/source === 'template' && c\.template === 'cruise'[\s\S]{0,120}c\.cardLayout = 'cruise'/.test(editor), 'picking the Cruise page sets the Cruise card');
ok(/syncCruise\('layout'\)/.test(editor), 'card-style click runs the coupling');
ok(/\$\('cfgTemplate'\)\.addEventListener\('change'[\s\S]{0,140}syncCruise\('template'\)/.test(editor), 'page-template change runs the coupling');
// cfgTemplate is no longer in the generic select map (it has its own coupled handler).
ok(/const sel = \{ cfgColumns:'columns', cfgCurrency:'currency', cfgProtection:'protection' \}/.test(editor), 'cfgTemplate pulled out of the generic select handler');

// Grid safety net.
ok(/cfg\.template === 'cruise' \? 'cruise' : cfg\.layout/.test(grid), 'grid renders cruise cards for a cruise page template');

// Demos expose it.
ok(/<option value="cruise">Cruise<\/option>/.test(demoPage), 'demo offer page has a Cruise template option');
ok(/<option value="cruise">Cruise<\/option>/.test(demoGrid), 'demo offers grid has a Cruise card style option');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
