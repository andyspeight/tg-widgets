/**
 * Special Offers dashboard "Sheet" (quick loader) — render smoke test.
 *
 * Evaluates the real renderSheet/wireSheet functions out of
 * editor-offer-builder.html in jsdom (with the offer-builder widget loaded for
 * its offerMeta), then checks the produced table:
 *   - Type is the first data column and is a dropdown
 *   - a hotel row shows resort/board/nights inputs
 *   - a cruise row shows ship/cruise line/cabin and greys out board/resort
 *   - a mixed list unions the columns from both types
 *   - the blank "add" row adapts when its type changes
 *
 * Run: node test/offer-sheet-render-smoke.mjs   (also: npm run test:offer-sheet-render)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const WIDGET = readFileSync(join(ROOT, 'public', 'widget-offer-builder.js'), 'utf8');
const HTML = readFileSync(join(ROOT, 'public', 'editor-offer-builder.html'), 'utf8');

// Pull the sheet helpers + renderSheet + wireSheet straight out of the editor.
const start = HTML.indexOf('    const SHEET_UNIV_BEFORE = [');
const end = HTML.indexOf('    const saveTimers = {};');
if (start < 0 || end < 0 || end <= start) { console.error('Could not locate the sheet code slice'); process.exit(1); }
const SLICE = HTML.slice(start, end);

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}

const dom = new JSDOM('<!doctype html><body><div id="offersList"></div></body>', { runScripts: 'outside-only' });
const { window } = dom;
window.fetch = () => Promise.reject(new Error('no network'));
// eslint-disable-next-line no-eval
window.eval(WIDGET); // defines window.TGOfferBuilderWidget.offerMeta

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const state = { offers: [], newType: '' };
const setState = (html) => { window.document.getElementById('offersList').innerHTML = html; };
const $ = (id) => window.document.getElementById(id);
const noop = () => {};
const offerMeta = () => window.TGOfferBuilderWidget.offerMeta;

// eslint-disable-next-line no-new-func
const sheet = new Function(
  'esc', 'state', 'statusOf', 'setState', '$', 'queueEdit', 'openById', 'tryCreateNewRow', 'window', 'document',
  SLICE + '\n;return { renderSheet: renderSheet, sheetTypeCols: sheetTypeCols };'
)(esc, state, () => '', setState, $, noop, noop, noop, window, window.document);

function headerLabels() {
  return Array.prototype.slice.call($('offersList').querySelectorAll('thead th')).map((th) => th.textContent.trim());
}
function rowFor(id) { return $('offersList').querySelector('tr[data-row="' + id + '"]'); }
function keyCells(tr) {
  return Array.prototype.slice.call(tr.querySelectorAll('[data-key],[data-newkey]')).map((e) => e.getAttribute('data-key') || e.getAttribute('data-newkey'));
}

console.log('Type is the first data column and a dropdown');
{
  state.offers = [{ id: 'a1', title: 'Beach week', type: 'Hotel / accommodation only', resort: 'Albufeira', nights: '7', board: 'All inclusive' }];
  sheet.renderSheet();
  const heads = headerLabels();
  ok('first data header is Type', heads[1] === 'Type');
  ok('second data header is Title', heads[2] === 'Title');
  const typeCell = rowFor('a1').querySelector('td.f-type select[data-key="type"]');
  ok('the type cell is a select', !!typeCell);
  ok('the type select shows the row type', typeCell && typeCell.value === 'Hotel / accommodation only');
}

console.log('Hotel row shows resort / board / nights');
{
  const keys = keyCells(rowFor('a1'));
  ok('has resort', keys.indexOf('resort') !== -1);
  ok('has board', keys.indexOf('board') !== -1);
  ok('has nights', keys.indexOf('nights') !== -1);
  ok('no ship column input on a hotel row', keys.indexOf('shipName') === -1);
}

console.log('Cruise row shows the ship and greys out board');
{
  state.offers = [{ id: 'c1', title: 'Med sailing', type: 'Cruise', cruiseLine: 'Royal Caribbean', shipName: 'Wonder', cabinType: 'Balcony', nights: '10' }];
  sheet.renderSheet();
  const keys = keyCells(rowFor('c1'));
  ok('has cruise line', keys.indexOf('cruiseLine') !== -1);
  ok('has ship', keys.indexOf('shipName') !== -1);
  ok('has cabin', keys.indexOf('cabinType') !== -1);
  ok('no board input on a cruise row', keys.indexOf('board') === -1);
  ok('shows greyed not-applicable cells', $('offersList').querySelectorAll('tr[data-row="c1"] td.na').length > 0);
}

console.log('Mixed list unions the columns');
{
  state.offers = [
    { id: 'a1', title: 'Beach week', type: 'Hotel / accommodation only', resort: 'Albufeira', board: 'All inclusive', nights: '7' },
    { id: 'c1', title: 'Med sailing', type: 'Cruise', cruiseLine: 'RCL', shipName: 'Wonder', cabinType: 'Balcony', nights: '10' }
  ];
  sheet.renderSheet();
  const heads = headerLabels();
  ok('header has Resort (from the hotel)', heads.indexOf('Resort') !== -1);
  ok('header has Ship (from the cruise)', heads.indexOf('Ship') !== -1);
  ok('header has Board (from the hotel)', heads.indexOf('Board') !== -1);
  // Hotel row fills resort, greys ship; cruise row fills ship, greys board.
  const hotel = rowFor('a1'), cruise = rowFor('c1');
  ok('hotel row has a resort input', !!hotel.querySelector('input[data-key="resort"]'));
  ok('hotel row greys the ship cell', keyCells(hotel).indexOf('shipName') === -1 && hotel.querySelectorAll('td.na').length > 0);
  ok('cruise row has a ship input', !!cruise.querySelector('input[data-key="shipName"]'));
}

console.log('Blank add row adapts to its chosen type');
{
  state.offers = [];
  state.newType = 'Cruise';
  sheet.renderSheet();
  const newRow = $('offersList').querySelector('tr[data-newrow]');
  const keys = keyCells(newRow);
  ok('add row type select present', !!newRow.querySelector('select[data-newkey="type"]'));
  ok('add row (cruise) offers a ship field', keys.indexOf('shipName') !== -1);
  ok('add row (cruise) has no board field', keys.indexOf('board') === -1);
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
