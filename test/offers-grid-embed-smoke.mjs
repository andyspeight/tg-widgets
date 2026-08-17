/**
 * Special Offers grid — the standard data-tg-id embed must load offers.
 *
 * The dashboard generates a `<div data-tg-widget="offers-grid" data-tg-id="tgw_…">`
 * embed, but the grid's init() only ever read an inline data-tg-config, so the
 * embed mounted with an empty config and bailed to "no offers" without fetching.
 * And even when fetched, the saved config carried no `client` feed key. Fix is
 * two parts: the grid now fetches config by id, and widget-config injects the
 * owning client's id as `client` for Special Offers. This guards both.
 *
 * Run: node test/offers-grid-embed-smoke.mjs  (npm run test:offers-grid-embed)
 */
import { readFileSync } from 'node:fs';

const GRID = readFileSync(new URL('../public/widget-offers-grid.js', import.meta.url), 'utf8');
const CFG = readFileSync(new URL('../api/widget-config.js', import.meta.url), 'utf8');

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };

// Isolate the init() function so the assertions can't be satisfied elsewhere.
const initM = GRID.match(/function init\(\) \{[\s\S]*?\n  \}/);
ok('the grid init() is present', !!initM);
const init = initM ? initM[0] : '';

console.log('The grid handles the standard data-tg-id embed');
{
  ok('it reads data-tg-id', /getAttribute\('data-tg-id'\)/.test(init));
  ok('it fetches the widget config by id', /fetch\(resolveApiBase\(\) \+ 'api\/widget-config\?id=' \+ encodeURIComponent\(id\)\)/.test(init));
  ok('it mounts from the fetched config (config or root spread)', /new TGOffersGridWidget\(el, \(d && \(d\.config \|\| d\)\) \|\| \{\}\)/.test(init));
  ok('a fetch failure still mounts (empty) rather than throwing', /\.catch\(\(\) => \{ new TGOffersGridWidget\(el, \{\}\); \}\)/.test(init));
}

console.log('Inline config still works and still wins (no regression)');
{
  ok('inline data-tg-config is parsed and used first', /getAttribute\('data-tg-config'\)[\s\S]*?JSON\.parse\(inline\)[\s\S]*?new TGOffersGridWidget\(el, config\)/.test(init));
  ok('inline path short-circuits before the id fetch', init.indexOf("data-tg-config") < init.indexOf("data-tg-id"));
}

console.log('widget-config injects the client feed key for Special Offers');
{
  ok('it special-cases the Special Offers type', /if \(widgetType === 'Special Offers'\) \{/.test(CFG));
  ok('it reads the owner id from ClientRecordId', /ownerId = String\(widgetRecord\.fields\.ClientRecordId \|\| ''\)\.trim\(\)/.test(CFG));
  ok('it sets config.client to that owner id', /if \(ownerId\) config\.client = ownerId;/.test(CFG));
  ok('the injection happens BEFORE the payload is built (so it ships)',
    CFG.indexOf("config.client = ownerId") < CFG.indexOf('const payload = { config, name, ...config }'));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
