/**
 * One events booking kit, no drift (8 Sep 2026).
 *
 * The Event Menu lists a chosen competition's events beside the menu with the
 * Event Tickets widget's own card, list, query, departure airport chooser and
 * stay calendar. Widgets are single files on customer sites and cannot
 * import, so the menu carries that code VERBATIM between two markers. This
 * suite fails the moment the two copies differ, and checks the block stays
 * self-contained (no reference to either widget's class or defaults), so a
 * copy can never quietly depend on something only one file has.
 *
 * Run: node test/events-kit-drift-smoke.mjs   (npm run test:events-kit-drift)
 */
import { readFileSync } from 'node:fs';

const R = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const TICKETS = R('public/widget-tickets.js');
const MENU = R('public/widget-eventmenu.js');
let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };

const START = '  // >>> events booking kit';
const END = '  // <<< events booking kit\n';
function block(src) {
  const a = src.indexOf(START), b = src.indexOf(END);
  return (a < 0 || b < 0) ? null : src.slice(a, b + END.length);
}

console.log('The kit is one block, carried verbatim');
{
  const t = block(TICKETS), m = block(MENU);
  ok('the Tickets widget marks the kit', !!t);
  ok('the Event Menu marks its copy', !!m);
  ok('the two are byte for byte the same', !!t && t === m);
  if (t && m && t !== m) {
    const tl = t.split('\n'), ml = m.split('\n');
    for (let i = 0; i < Math.max(tl.length, ml.length); i++) {
      if (tl[i] !== ml[i]) { console.error('    first difference at kit line ' + (i + 1) + ':\n      tickets: ' + tl[i] + '\n      menu:    ' + ml[i]); break; }
    }
  }
  ok('the kit is self-contained: no widget class, no DEFAULTS', !!t && !/TGTicketsWidget|TGEventMenuWidget|\bDEFAULTS\b/.test(t));
  for (const fn of ['safeUrl', 'inkOn', 'kindIcon', 'flyOpen', 'flyClose', 'stayOpen', 'stayClose', 'kitRoot', 'feedQuery', 'fetchEvents', 'cardHtml', 'listHtml', 'dateParts', 'localToday', 'sideOf']) {
    ok('the kit defines ' + fn, !!t && new RegExp('\\n  function ' + fn + '\\(').test(t));
  }
  ok('the kit carries its styles (KIT_CSS, FLY_CSS, STAY_CSS)', !!t && /var KIT_CSS = ''/.test(t) && /var FLY_CSS = /.test(t) && /var STAY_CSS = /.test(t));
  ok('the kit\'s static styles are joined, not swallowed by a bare string statement', !!t && /var KIT_CSS = ''\n\s*\/\/[^\n]*\n\s*\+ '/.test(t));
}

console.log('\nBoth widgets are wired to it the same way');
{
  for (const [name, src] of [['tickets', TICKETS], ['menu', MENU]]) {
    ok(name + ': the departure airport chooser and the stay calendar listen on the shadow root', /flyInit\(this\);\s*stayInit\(this\);/.test(src));
    ok(name + ': the styles come from kitRoot + KIT_CSS', /kitRoot\(/.test(src) && /KIT_CSS/.test(src));
    ok(name + ': the fly and stay styles are appended to the sheet', /FLY_CSS \+ STAY_CSS/.test(src));
    ok(name + ': destroy closes the modals', name === 'tickets' || /flyClose\(this\);\s*stayClose\(this\);/.test(src));
  }
  ok('the Tickets widget delegates its card, list, query and load to the kit', /_cardHtml = function \(ev\) \{ return cardHtml\(this\.cfg, ev\); \}/.test(TICKETS) && /return listHtml\(this\.cfg, \{/.test(TICKETS) && /return feedQuery\(c, \{ type: c\.sourceType/.test(TICKETS) && /fetchEvents\(this\._query\(\)\)/.test(TICKETS));
  ok('the menu\'s icon set carries every path the cards draw', ['clock', 'pin', 'ticket', 'bed', 'plane', 'cal', 'warn'].every((k) => new RegExp('\\n    ' + k + ": 'M").test(MENU)));
  ok('the menu\'s own colour and font helpers stepped aside (no duplicate names with the kit)', (MENU.match(/\n  function safeColour\(/g) || []).length === 1 && (MENU.match(/\n  function safeFont\(/g) || []).length === 1 && /function hexColour\(/.test(MENU) && /function fontStack\(/.test(MENU));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
