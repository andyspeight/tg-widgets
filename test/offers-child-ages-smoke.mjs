/**
 * Travel Offers — child ages in the pax popover / deeplink (Andy, 10 Aug 2026).
 *
 * BUG: the "Travellers" popover let a visitor pick a child COUNT but collected
 * no ages, so it built a deeplink with chd=<n> and NO chdage — an invalid child
 * search. The Travelify spec requires one chdage per child (chd=2&chdage=4&chdage=5).
 *
 * FIX: the popover now asks for each child's age and the deeplink repeats chdage
 * once per child. This drives the REAL applyPaxToDeeplink helper (extracted from
 * the widget source) plus source guards on the popover UI and the confirm wiring.
 *
 * Run: node test/offers-child-ages-smoke.mjs  (also: npm run test:offers-child-ages)
 */
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

const widget = readFileSync(new URL('../public/widget-offers.js', import.meta.url), 'utf8');

// ── Extract the real applyPaxToDeeplink from the widget source ───────────────
const fnBody = (src, sig) => {
  const i = src.indexOf(sig);
  if (i === -1) throw new Error('not found: ' + sig);
  const open = src.indexOf('{', i);
  let depth = 0, j = open;
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(open + 1, j);
};
const applyPaxToDeeplink = new Function('url', 'state', fnBody(widget, 'function applyPaxToDeeplink(url, state)'));

const DL = 'https://dl.tvllnk.com/deeplink/370?st=Packages&adt=2';
const agesOf = (u) => new URL(u).searchParams.getAll('chdage');
const paramsOf = (u) => new URL(u).searchParams;

// ── Two children with ages 4 and 5 → chd=2 + chdage=4 + chdage=5 ─────────────
{
  const out = applyPaxToDeeplink(DL, { adults: 2, children: 2, infants: 0, childAges: [4, 5] });
  const p = paramsOf(out);
  ok(p.get('chd') === '2', 'chd reflects the child count');
  ok(p.get('adt') === '2' && p.get('inf') === '0', 'adt + inf carried through');
  ok(agesOf(out).join(',') === '4,5', 'one chdage per child, in order (4,5)');
  ok((out.match(/chdage=/g) || []).length === 2, 'exactly two chdage params for two children');
}

// ── No children → chd=0 and NO chdage at all ────────────────────────────────
{
  const out = applyPaxToDeeplink(DL, { adults: 2, children: 0, infants: 0, childAges: [] });
  ok(paramsOf(out).get('chd') === '0', 'chd=0 when no children');
  ok(agesOf(out).length === 0, 'no chdage when there are no children');
}

// ── childAges longer than the count is truncated to the count ───────────────
{
  const out = applyPaxToDeeplink(DL, { adults: 2, children: 1, infants: 0, childAges: [4, 5, 6] });
  ok(agesOf(out).join(',') === '4', 'ages truncated to the child count (1 child → one age)');
}

// ── A stale chdage already on the URL is cleared, not duplicated ────────────
{
  const stale = DL + '&chdage=9';
  const out = applyPaxToDeeplink(stale, { adults: 2, children: 2, infants: 0, childAges: [7, 8] });
  ok(agesOf(out).join(',') === '7,8', 'pre-existing chdage is replaced, not appended to');
}

// ── Infants carry through as a count (no age needed) ────────────────────────
{
  const out = applyPaxToDeeplink(DL, { adults: 3, children: 1, infants: 2, childAges: [10] });
  const p = paramsOf(out);
  ok(p.get('adt') === '3' && p.get('inf') === '2' && p.get('chd') === '1', 'adults/infants/children all set');
  ok(agesOf(out).join(',') === '10', 'child age emitted; infants need none');
}

// ── Fallback branch: a non-absolute url still gets valid pax appended ────────
{
  const out = applyPaxToDeeplink('deeplink/370?st=Packages', { adults: 2, children: 2, infants: 0, childAges: [3, 6] });
  ok(/chd=2/.test(out) && /chdage=3/.test(out) && /chdage=6/.test(out), 'fallback append still emits chd + one chdage per child');
  ok((out.match(/chdage=/g) || []).length === 2, 'fallback emits exactly two chdage');
}

// ── Source guards: the popover collects ages and the wiring is in place ──────
ok(/data-tgo-child-ages/.test(widget), 'popover has a child-ages container');
ok(/const renderChildAges = \(\) =>/.test(widget), 'renderChildAges draws one select per child');
ok(/data-tgo-child-age="' \+ i \+ '"/.test(widget), 'each child gets an age select');
ok(/CHILD_AGE_MIN = 2, CHILD_AGE_MAX = 15/.test(widget), 'child age range matches the widget model (2 to 15)');
ok(/if \(kind === 'children'\) \{ renderChildAges\(\); positionPopover\(\); \}/.test(widget), 'changing the child count re-renders the age selects');
ok(/state\.childAges\[i\] = v/.test(widget), 'age select changes update the ages array');
ok(/applyPaxToDeeplink\(url, state\)/.test(widget), 'confirm handler builds the deeplink via applyPaxToDeeplink');
ok(/childAges: Array\.from\(\{ length: children \}/.test(widget), 'childAges initialised to the prefilled child count');
// i18n
ok(/childAges: 'Child ages'/.test(widget) && /childNum: 'Child \{n\}'/.test(widget), 'child-age labels present in MESSAGES');
// CSS
ok(/\.tgo-pax-ages-grid \{/.test(widget), 'child-age grid styles present');
// Version
{
  const vm = widget.match(/VERSION = '(\d+)\.(\d+)\.(\d+)'/);
  ok(vm && (+vm[1] > 1 || (+vm[1] === 1 && +vm[2] >= 19)), 'widget version at or beyond 1.19');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
