/**
 * World Map — Travellers party on the fullscreen deal deeplinks (Andy, 10 Aug 2026).
 *
 * The map deal cards used to link adults-only with no passenger UI. A shared
 * "Travellers" control now sets the party (adults/children/infants + one age per
 * child), and every deal card's deeplink carries it: adt/chd/inf plus one chdage
 * per child (Travelify spec: chd=2&chdage=4&chdage=5).
 *
 * Drives the REAL applyPartyToDeeplink helper (extracted from the widget source)
 * plus source guards on the Travellers UI, the per-card base URL and the wiring.
 *
 * Run: node test/worldmap-pax-deeplink-smoke.mjs  (also: npm run test:worldmap-pax)
 */
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

const widget = readFileSync(new URL('../public/widget-worldmap.js', import.meta.url), 'utf8');

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
const applyPartyToDeeplink = new Function('url', 'pax', fnBody(widget, 'function applyPartyToDeeplink(url, pax)'));

const DL = 'https://dl.tvllnk.com/deeplink/370?st=Packages&org=LGW&dst=AGP&adt=2';
const paramsOf = (u) => new URL(u).searchParams;
const agesOf = (u) => new URL(u).searchParams.getAll('chdage');

// ── Two children with ages 6 and 9 → chd=2 + chdage=6 + chdage=9 ────────────
{
  const out = applyPartyToDeeplink(DL, { adults: 2, children: 2, infants: 0, childAges: [6, 9] });
  const p = paramsOf(out);
  ok(p.get('adt') === '2' && p.get('chd') === '2' && p.get('inf') === '0', 'adt/chd/inf all set');
  ok(agesOf(out).join(',') === '6,9', 'one chdage per child, in order (6,9)');
  ok((out.match(/chdage=/g) || []).length === 2, 'exactly two chdage for two children');
  ok(p.get('org') === 'LGW' && p.get('dst') === 'AGP', 'existing deeplink params preserved');
}

// ── No children → chd=0 and no chdage ───────────────────────────────────────
{
  const out = applyPartyToDeeplink(DL, { adults: 2, children: 0, infants: 0, childAges: [] });
  ok(paramsOf(out).get('chd') === '0' && agesOf(out).length === 0, 'no children → chd=0, no chdage');
}

// ── Adults never zero: an invalid 0 falls back to the default couple ────────
{
  const out = applyPartyToDeeplink(DL, { adults: 0, children: 1, infants: 0, childAges: [4] });
  ok(parseInt(paramsOf(out).get('adt'), 10) >= 1, 'never a zero-adult search');
  ok(paramsOf(out).get('adt') === '2', 'adults 0/omitted falls back to 2 (matches buildDeeplink default)');
}

// ── childAges longer than count is truncated ────────────────────────────────
{
  const out = applyPartyToDeeplink(DL, { adults: 2, children: 1, infants: 0, childAges: [4, 5, 6] });
  ok(agesOf(out).join(',') === '4', 'ages truncated to the child count');
}

// ── A stale chdage already on the URL is cleared, not duplicated ────────────
{
  const out = applyPartyToDeeplink(DL + '&chdage=15', { adults: 2, children: 2, infants: 1, childAges: [3, 7] });
  const p = paramsOf(out);
  ok(agesOf(out).join(',') === '3,7' && p.get('inf') === '1', 'stale chdage replaced; infants set');
}

// ── Fallback branch: non-absolute url still gets valid pax appended ──────────
{
  const out = applyPartyToDeeplink('deeplink/370?st=Packages', { adults: 3, children: 2, infants: 0, childAges: [5, 8] });
  ok(/adt=3/.test(out) && /chd=2/.test(out) && /chdage=5/.test(out) && /chdage=8/.test(out), 'fallback emits adt + chd + one chdage per child');
  ok((out.match(/chdage=/g) || []).length === 2, 'fallback emits exactly two chdage');
}

// ── Empty/falsey url passes through untouched ───────────────────────────────
ok(applyPartyToDeeplink('', { adults: 2, children: 1, childAges: [4] }) === '', 'empty url returned as-is');

// ── Source guards: the Travellers UI + per-card wiring ──────────────────────
ok(/this\._pax = \{ adults: 2, children: 0, infants: 0, childAges: \[\] \}/.test(widget), 'party state initialised on the instance');
ok(/data-ov-pax/.test(widget) && /data-ov-pax-label/.test(widget), 'Travellers button in the overlay header');
ok(/paxBtn\.addEventListener\('click', \(\) => this\._openPaxPopover/.test(widget), 'Travellers button opens the popover');
ok(/_openPaxPopover\(triggerEl\) \{/.test(widget), 'popover method defined');
ok(/data-tgwm-dl="\$\{esc\(base\)\}"/.test(widget), 'each card stores its adults-only base deeplink');
ok(/const href = safeUrl\(applyPartyToDeeplink\(base, this\._pax\)\)/.test(widget), 'card href bakes in the current party');
ok(/_updateCardHrefs\(\) \{/.test(widget) && /applyPartyToDeeplink\(base, this\._pax\)/.test(widget), 're-apply party to card hrefs on change (no re-render)');
ok(/data-pax-age="' \+ i \+ '"/.test(widget), 'one age select per child in the modal');
ok(/CHILD_AGE_MIN = 2, CHILD_AGE_MAX = 15/.test(widget), 'child age range 2 to 15');
ok(/state\.childAges\.slice\(0, state\.children\)/.test(widget), 'committed ages truncated to the child count');
// i18n + CSS
ok(/travellers: 'Travellers'/.test(widget) && /childAges: 'Child ages'/.test(widget), 'pax labels present in MESSAGES');
ok(/\.tgwm-pax-dialog \{/.test(widget) && /\.tgwm-ov-pax \{/.test(widget), 'Travellers button + modal styles present');
// Version
{
  const vm = widget.match(/VERSION = '(\d+)\.(\d+)\.(\d+)'/);
  ok(vm && (+vm[1] > 3 || (+vm[1] === 3 && +vm[2] >= 15)), 'widget version at or beyond 3.15');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
