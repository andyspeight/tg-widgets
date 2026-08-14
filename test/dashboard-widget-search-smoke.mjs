/**
 * Dashboard — per-type widget list search box (Jess / Better Lifestyle, Aug 2026).
 *
 * A destination build runs to dozens of widgets per type, so the type-detail
 * modal gained a live search box that filters the list by name or widget id in
 * place. This drives the REAL filterTypeModal (extracted from index.html) against
 * a tiny fake DOM — no jsdom, so it runs anywhere — and source-guards the wiring
 * (the input, the per-item data-search, the >8 threshold, the CSS).
 *
 * Run: node test/dashboard-widget-search-smoke.mjs  (npm run test:dashboard-search)
 */
import { readFileSync } from 'node:fs';

const HTML = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };

// ── Extract the real filterTypeModal and run it against a fake DOM ──
const m = HTML.match(/function filterTypeModal\(q\) \{[\s\S]*?\n\}/);
ok('filterTypeModal is defined in the dashboard', !!m);

function makeItem(search) {
  return { style: { display: '' }, getAttribute: (a) => (a === 'data-search' ? search : null) };
}
function run(items, query) {
  const nomatch = { hidden: false };
  const list = { querySelectorAll: (sel) => (sel === '.type-modal-item' ? items : []) };
  const doc = {
    querySelector: (sel) => (sel === '#typeModalInner .type-modal-list' ? list : null),
    getElementById: (id) => (id === 'typeModalNoMatch' ? nomatch : null),
  };
  const fn = new Function('document', m[0] + '\nreturn filterTypeModal;')(doc);
  fn(query);
  return { items, nomatch };
}

console.log('The search filters the list in place, case-insensitively');
{
  const items = [makeItem('chile weather tgw_1'), makeItem('japan weather tgw_2'), makeItem('brazil weather tgw_3')];
  const { nomatch } = run(items, 'JAPAN');
  ok('only the matching item stays visible', items[1].style.display === '' && items[0].style.display === 'none' && items[2].style.display === 'none');
  ok('a matched search hides the no-match line', nomatch.hidden === true);
}

console.log('An empty query restores every item');
{
  const items = [makeItem('chile'), makeItem('japan')];
  run(items, 'chile');
  run(items, '   ');
  ok('all items shown again on a blank query', items[0].style.display === '' && items[1].style.display === '');
}

console.log('A query that matches nothing surfaces the no-match line');
{
  const items = [makeItem('chile'), makeItem('japan')];
  const { nomatch } = run(items, 'narnia');
  ok('every item hidden', items.every((i) => i.style.display === 'none'));
  ok('the no-match line is revealed', nomatch.hidden === false);
}

console.log('It can match on the widget id, not just the name');
{
  const items = [makeItem('chile tgw_1786697472069_t6xwaa'), makeItem('japan tgw_9')];
  run(items, 't6xwaa');
  ok('matches by widget id', items[0].style.display === '' && items[1].style.display === 'none');
}

console.log('Dashboard wiring');
{
  ok('items carry a lowercased data-search of name + id',
    /data-search="\$\{esc\(\(\(w\.name \|\| 'Untitled'\) \+ ' ' \+ \(w\.widgetId \|\| ''\)\)\.toLowerCase\(\)\)\}"/.test(HTML));
  ok('the search input is rendered only when the list is long (>8)',
    /\$\{n > 8 \? `<div class="type-modal-search">/.test(HTML));
  ok('the input calls filterTypeModal on input', /oninput="filterTypeModal\(this\.value\)"/.test(HTML));
  ok('the input is labelled for screen readers', /aria-label="Search \$\{esc\(reg\.name\)\} widgets"/.test(HTML));
  ok('a no-match element exists in the list', /id="typeModalNoMatch" hidden/.test(HTML));
  ok('the search box has its own styles', /\.type-modal-search\{/.test(HTML) && /\.type-modal-nomatch\{/.test(HTML));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
