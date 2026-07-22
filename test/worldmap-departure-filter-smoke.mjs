/**
 * World Map — departure-point filter (Andy, 22 Jul 2026).
 *
 * The offers cache sweeps multiple departure markets (UK + Ireland), so a
 * client can now limit their map to offers departing from chosen countries:
 * a comma-delimited country-code list in the editor, blank = all departures.
 *
 * Exercises the REAL parsing/mapping functions (extracted from the widget
 * source and evaluated) plus source guards pinning that the filter is
 * applied on BOTH deals fetch paths (country load and resort drill-down)
 * and that the editor field sits under Destinations shown as specified.
 *
 * Run: node test/worldmap-departure-filter-smoke.mjs
 */
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

const widget = readFileSync(new URL('../public/widget-worldmap.js', import.meta.url), 'utf8');
const editor = readFileSync(new URL('../public/editor-worldmap.html', import.meta.url), 'utf8');

// ── Extract and evaluate the real functions from the widget source ───────────
const between = (src, start, end) => {
  const i = src.indexOf(start);
  if (i === -1) throw new Error(`marker not found: ${start}`);
  const j = src.indexOf(end, i);
  if (j === -1) throw new Error(`end marker not found after: ${start}`);
  return src.slice(i, j + end.length);
};
const airportsBlock = between(widget, 'const UK_AIRPORTS = {', '\n  };');
const irishBlock = between(widget, 'const IRISH_AIRPORTS = new Set(', ');');
const originFn = between(widget, 'function originCountry(iata) {', '\n  }');
const parseFn = between(widget, 'function parseDepartureCountries(raw) {', '\n  }');
const { originCountry, parseDepartureCountries } = new Function(
  `${airportsBlock}\n${irishBlock}\n${originFn}\n${parseFn}\nreturn { originCountry, parseDepartureCountries };`
)();

// Parsing
ok(parseDepartureCountries('') === null && parseDepartureCountries('   ') === null, 'blank → null (no filter, all departure points shown)');
ok(parseDepartureCountries(undefined) === null && parseDepartureCountries(42) === null, 'non-string config → null, never throws');
{
  const one = parseDepartureCountries('GB');
  ok(one instanceof Set && one.size === 1 && one.has('GB'), 'single code parses');
  const two = parseDepartureCountries('gb, ie');
  ok(two && two.has('GB') && two.has('IE') && two.size === 2, 'comma-delimited list, case-insensitive, whitespace-tolerant');
  const uk = parseDepartureCountries('UK');
  ok(uk && uk.has('GB') && !uk.has('UK'), 'UK is normalised to GB (clients will type UK)');
  ok(parseDepartureCountries('GBR') === null, 'a 3-letter code alone is invalid → no filter rather than an empty map');
  const mixed = parseDepartureCountries('GB, XYZ123, ie');
  ok(mixed && mixed.size === 2 && mixed.has('GB') && mixed.has('IE'), 'junk entries dropped, valid ones kept');
}

// Airport → country mapping
ok(originCountry('LGW') === 'GB' && originCountry('MAN') === 'GB' && originCountry('BFS') === 'GB', 'UK departure airports map to GB');
ok(originCountry('DUB') === 'IE' && originCountry('kir') === 'IE', 'Irish departure airports map to IE (case-insensitive)');
ok(originCountry('JFK') === null && originCountry('') === null && originCountry(null) === null, 'unknown or missing airports map to null');

// Combined semantics (mirrors the widget's filter expression)
const allows = (allowSet, origin) => !allowSet || allowSet.has(originCountry(origin));
{
  const gbOnly = parseDepartureCountries('GB');
  ok(allows(gbOnly, 'LGW') && !allows(gbOnly, 'DUB'), 'GB filter keeps Gatwick, drops Dublin');
  ok(!allows(gbOnly, 'JFK'), 'unknown departure airports are hidden while a filter is set');
  ok(allows(null, 'DUB') && allows(null, 'JFK'), 'no filter → every departure point shown');
  const both = parseDepartureCountries('GB,IE');
  ok(allows(both, 'LGW') && allows(both, 'DUB'), 'GB,IE keeps both markets');
}

// ── Source guards ────────────────────────────────────────────────────────────
ok(/departureCountries: ''/.test(widget), 'config default present (blank = all)');
ok(/this\._depAllow = parseDepartureCountries\(this\.cfg\.departureCountries\)/.test(widget), 'filter parsed once per widget instance');
{
  const uses = (widget.match(/this\._depAllow\.has\(originCountry\(o\.origin\)\)/g) || []).length;
  ok(uses >= 2, `filter applied on BOTH deals paths — country load and resort drill-down (found ${uses})`);
}
{
  const vm = widget.match(/VERSION = '(\d+)\.(\d+)\.(\d+)'/);
  ok(vm && (+vm[1] > 3 || (+vm[1] === 3 && +vm[2] >= 12)), 'widget version at or beyond 3.12');
}
ok(/id="f-departures"/.test(editor) && /C\.departureCountries = e\.target\.value/.test(editor), 'editor input wired to config.departureCountries');
ok(/getElementById\('f-departures'\)\.value = C\.departureCountries/.test(editor), 'editor field restored on load');
ok(editor.indexOf('Departure points') > editor.indexOf('Destinations shown') && editor.indexOf('Departure points') !== -1,
  'Departure points sits below Destinations shown in the Content column, as specified');
// The resort drill-down path also re-applies the supplier filter it was missing
ok(widget.slice(widget.indexOf("'?airport='")).slice(0, 1500).includes('mapSupplierAllows(o, this.cfg.supplierFilter)'),
  'resort drill-down re-applies the supplier filter too');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
