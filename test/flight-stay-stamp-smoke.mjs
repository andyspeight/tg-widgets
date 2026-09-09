/**
 * The flight package's stay calendar is stamped across every surface
 * (9 Sep 2026). Every event widget carries the same flow: the flight
 * button opens the stay calendar first, preselected to a two-night stay
 * from the event day, and the Choose airport button hands the dates to
 * the chooser. This guard fails when a widget misses part of the stamp —
 * the class of miss that left the venue guide unwritten on 1 Sep.
 */
import { readFileSync } from 'node:fs';

const WIDGETS = [
  ['public/widget-tickets.js', 'tgtk'],
  ['public/widget-eventmenu.js', 'tgtk'], // carries the kit verbatim
  ['public/widget-nextevent.js', 'tgne'],
  ['public/widget-clubpicker.js', 'tgcp'],
  ['public/widget-ticketsearch.js', 'tgts'],
  ['public/widget-ticketmonth.js', 'tgtm'],
  ['public/widget-venueguide.js', 'tgvg'],
];

let passed = 0;
let failed = 0;
function check(cond, label) {
  if (cond) { passed++; } else { failed++; console.error('FAIL ' + label); }
}

for (const [path, p] of WIDGETS) {
  const s = readFileSync(new URL('../' + path, import.meta.url), 'utf8');
  check(s.includes('var STAY_PKG_NIGHTS = 2;'), path + ': two-night default constant');
  check(s.includes("if (btn) { stayOpen(w, btn); return; } // dates first, then the chooser"),
    path + ': flight button opens the calendar first');
  check(s.includes("t.closest('[data-fly]')) return; // flyInit routes that click"),
    path + ': stayInit leaves flight clicks to flyInit');
  check(s.includes('function goPkg()'), path + ': goPkg present');
  check(s.includes('setTimeout(function () { flyOpen(w, btn, tpl); }, 0);'),
    path + ': chooser opens after the dispatch that pressed the button');
  check(s.includes('function flyOpen(w, btn, tplOverride)'), path + ': chooser accepts a stay-adjusted template');
  check(s.includes('checkOut: pkg ? stayShift(eventDay, STAY_PKG_NIGHTS) : null'),
    path + ': stay preselected in package mode');
  check(s.includes('.' + p + '-stay-go{display:block'), path + ': continue button styled');
  check(s.includes('Choose airport &middot;'), path + ': continue button labelled');
}

// The explorer mirrors the flow in light DOM.
const ex = readFileSync(new URL('../public/events-explorer.js', import.meta.url), 'utf8');
check(ex.includes('var STAY_PKG_NIGHTS = 2;'), 'explorer: two-night default constant');
check(ex.includes('stayPicker(flyBtn, tpl, true)'), 'explorer: flight button opens the calendar first');
check(ex.includes('function goPkg()'), 'explorer: goPkg present');
check(ex.includes("el('button', { class: 'ev-stay-go'"), 'explorer: continue button');
const excss = readFileSync(new URL('../public/events-explorer.css', import.meta.url), 'utf8');
check(excss.includes('.ev-stay-go {'), 'explorer: continue button styled');

console.log(passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
