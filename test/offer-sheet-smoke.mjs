/**
 * Special Offers spreadsheet (sheet) — import/export logic smoke test.
 *
 * Covers the pure offer-import.js helpers that back the new flow:
 *   - the template carries an Offer ID column (blank = new offer)
 *   - headerCheck enforces the template (rejects a random spreadsheet)
 *   - rowsToOffers puts an Offer ID onto offer.id (drives update-on-reupload)
 *   - offersToCsv exports saved offers and round-trips back through the parser
 *
 * Run: node test/offer-sheet-smoke.mjs   (also: npm run test:offer-sheet)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// The repo is type:module, so a .js require() would be treated as ESM and skip
// the file's module.exports branch. Evaluate it with a module object instead.
const SRC = readFileSync(join(__dirname, '..', 'public', 'offer-import.js'), 'utf8');
const mod = { exports: {} };
// eslint-disable-next-line no-new-func
new Function('module', 'window', SRC)(mod, undefined);
const TG = mod.exports;

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}

// ── Template ───────────────────────────────────────────────────────────
console.log('Template');
{
  const csv = TG.templateCsv();
  const header = csv.split(/\r?\n/)[0];
  ok('template header starts with Offer ID', header.indexOf('Offer ID') === 0);
  ok('template has Title', /(^|,)Title(,|$)/.test(header));
  const rows = TG.parseCsv(csv);
  ok('template example row parses', rows.length === 1);
  ok('example Offer ID is blank (a new offer)', (rows[0]['Offer ID'] || '') === '');
}

// ── headerCheck enforces the template ──────────────────────────────────
console.log('headerCheck (template-only upload)');
{
  const good = TG.templateCsv();
  ok('accepts the real template', TG.headerCheck(good).ok === true);

  // Drop a required column (Board) → rejected, names it.
  const noBoard = good.replace(/(^|,)Board(,|$)/, '$1$2').replace(',,', ',');
  const chk = TG.headerCheck('Title,Price,Nights\nX,1,2\n');
  ok('rejects a random spreadsheet', chk.ok === false);
  ok('reports missing columns', Array.isArray(chk.missing) && chk.missing.indexOf('Board') !== -1);

  // A file WITHOUT the optional Offer ID column still passes (back-compat).
  const noId = good.split(/\r?\n/).map(function (line) {
    return line.split(',').slice(1).join(','); // drop first (Offer ID) column
  }).join('\r\n');
  ok('optional Offer ID column not required', TG.headerCheck(noId).ok === true);

  ok('empty text is not a template', TG.headerCheck('').ok === false);
}

// ── rowsToOffers: Offer ID → offer.id (update), blank → create ─────────
console.log('rowsToOffers');
{
  const csv = 'Offer ID,Title,Price,Board,Includes\n'
    + 'off_abc123,Sunny week,499,All inclusive,Flights | Transfers\n'
    + ',Brand new deal,299,Half board,\n';
  const mapped = TG.rowsToOffers(TG.parseCsv(csv));
  ok('two rows mapped', mapped.length === 2);
  ok('row with Offer ID gets offer.id (update)', mapped[0].offer.id === 'off_abc123');
  ok('title mapped into fields', mapped[0].offer.fields.title === 'Sunny week');
  ok('Includes split on pipe', Array.isArray(mapped[0].offer.includes) && mapped[0].offer.includes.length === 2);
  ok('blank Offer ID → no id (create)', !mapped[1].offer.id);
  ok('no errors on valid rows', mapped[0].errors.length === 0 && mapped[1].errors.length === 0);

  const bad = TG.rowsToOffers(TG.parseCsv('Offer ID,Title,Price\n,,50\n'));
  ok('missing Title is flagged', bad[0].errors.indexOf('Missing Title') !== -1);
}

// ── offersToCsv export + round-trip ────────────────────────────────────
console.log('offersToCsv export');
{
  const saved = [
    { id: 'off_xyz789', offer: { currency: 'GBP', fields: { title: 'Cancun escape', price: '899', board: 'All inclusive', nights: '7', hotelDesc: 'A five star right on the beach with five pools.', countryDesc: 'Warm all year, driest Nov to Apr.' }, images: ['https://a/1.jpg', 'https://a/2.jpg'], tags: ['Beachfront'] } }
  ];
  const csv = TG.offersToCsv(saved);
  ok('export includes the Offer ID', csv.indexOf('off_xyz789') !== -1);
  ok('export includes the title', csv.indexOf('Cancun escape') !== -1);
  ok('export includes long content fields', csv.indexOf('five pools') !== -1);

  // Round-trip: export → parse → map → same id + fields, ready to re-upload as an update.
  const back = TG.rowsToOffers(TG.parseCsv(csv));
  ok('round-trip keeps one offer', back.length === 1);
  ok('round-trip keeps the id (update path)', back[0].offer.id === 'off_xyz789');
  ok('round-trip keeps the price', back[0].offer.fields.price === '899');
  ok('round-trip keeps the images', Array.isArray(back[0].offer.images) && back[0].offer.images.length === 2);
  ok('round-trip keeps the hotel description', back[0].offer.fields.hotelDesc === 'A five star right on the beach with five pools.');
  ok('round-trip keeps the country description', back[0].offer.fields.countryDesc === 'Warm all year, driest Nov to Apr.');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
