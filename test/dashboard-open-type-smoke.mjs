/**
 * Dashboard — opening a type's picker from the address (17 Sep 2026).
 *
 * Andy, after wiring our widgets into Travelify's Widget Directory and My
 * Widgets: "When you click on the manage widgets for that one, it always goes
 * to go and create a new widget, not the ability to pick an existing one...
 * if they do it should go to widget dashboard and open the modal to pick which
 * one they want to edit/create new."
 *
 * The SSO decides which of the two it is and, for a client who already has
 * some, redirects to /?open=<widget id>. This is the other half: the dashboard
 * reading that and opening the picker once its list has loaded.
 *
 * Drives the REAL openRequestedType, extracted from index.html and run against
 * a tiny fake DOM, the same way the type-modal search is tested — no jsdom, so
 * it runs anywhere.
 *
 * Run: node test/dashboard-open-type-smoke.mjs  (npm run test:dashboard-open-type)
 */
import { readFileSync } from 'node:fs';

const HTML = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

let passed = 0, failed = 0;
const ok = (name, cond, detail) => {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (detail ? '\n      ' + detail : '')); }
};

const src = HTML.match(/let openRequestHandled = false;\nfunction openRequestedType\(\) \{[\s\S]*?\n\}/);
ok('openRequestedType is defined in the dashboard', !!src);

// A few real registry entries, read out of the page so the ids cannot drift.
const WIDGETS = [
  { id: 'faq', name: 'FAQ Accordion', airtableType: 'FAQ' },
  { id: 'tti-offers', name: 'TTI Offers', airtableType: 'TTI Offers' },
  { id: 'reviews', name: 'Google Reviews', airtableType: 'Google Reviews' },
];

/** Run the real function with a given address and widget list. */
function run(search, myWidgetData) {
  const opened = [];
  const replaced = [];
  const ctx = {
    WIDGETS,
    myWidgetData,
    openTypeModal: (t) => opened.push(t),
    location: { href: 'https://widgets.travelify.io/' + search, search, pathname: '/', hash: '' },
    history: { replaceState: (a, b, url) => replaced.push(url) },
    URLSearchParams,
    URL,
  };
  const body = src[0];
  const fn = new Function(...Object.keys(ctx), body + '\nreturn openRequestedType;');
  fn(...Object.values(ctx))();
  return { opened, replaced };
}

console.log('A link from Travelify opens the right picker');
{
  const r = run('?open=tti-offers', [{ type: 'TTI Offers' }, { type: 'TTI Offers' }, { type: 'FAQ' }]);
  ok('the picker opened for the type that was asked for', r.opened.join(',') === 'TTI Offers', r.opened.join(','));
  ok('and the parameter came back out of the address',
    r.replaced.length === 1 && !String(r.replaced[0]).includes('open='), String(r.replaced[0]));
}

console.log('It only opens when they actually have some');
{
  const none = run('?open=tti-offers', [{ type: 'FAQ' }]);
  ok('a type they have none of opens nothing', none.opened.length === 0);
  ok('but the address is still cleaned', none.replaced.length === 1);

  const unknown = run('?open=not-a-widget', [{ type: 'FAQ' }]);
  ok('an id that is not in the registry opens nothing', unknown.opened.length === 0);

  const empty = run('', [{ type: 'FAQ' }]);
  ok('no parameter, nothing happens', empty.opened.length === 0 && empty.replaced.length === 0);
}

console.log('The id is matched against the registry, never used as a type');
{
  // The type string is read from the registry entry, so a crafted value cannot
  // reach openTypeModal even if it happens to name a real type.
  const r = run('?open=' + encodeURIComponent('TTI Offers'), [{ type: 'TTI Offers' }]);
  ok('a raw Airtable type in the parameter is not honoured', r.opened.length === 0,
    r.opened.join(','));
  const r2 = run('?open=<script>alert(1)</script>', [{ type: 'FAQ' }]);
  ok('nor is anything hostile', r2.opened.length === 0);
}

console.log('The client\'s own address is left alone');
{
  const r = run('?utm_source=travelify&open=faq&ref=x', [{ type: 'FAQ' }]);
  ok('the picker still opened', r.opened.join(',') === 'FAQ');
  const url = String(r.replaced[0]);
  ok('only open= was removed', !url.includes('open=')
    && url.includes('utm_source=travelify') && url.includes('ref=x'), url);
}

console.log('It runs once, not on every repaint');
{
  // renderMyWidgets is called again after a copy or a delete, and the modal
  // reopening under someone who had closed it would be a bug.
  const ctxOpened = [];
  const body = src[0];
  const fn = new Function('WIDGETS', 'myWidgetData', 'openTypeModal', 'location', 'history',
    'URLSearchParams', 'URL', body + '\nreturn openRequestedType;');
  const once = fn(WIDGETS, [{ type: 'FAQ' }], (t) => ctxOpened.push(t),
    { href: 'https://widgets.travelify.io/?open=faq', search: '?open=faq', pathname: '/', hash: '' },
    { replaceState: () => {} }, URLSearchParams, URL);
  once(); once(); once();
  ok('three renders, one open', ctxOpened.length === 1, String(ctxOpened.length));
}

console.log('The dashboard calls it once its list has loaded');
{
  ok('renderMyWidgets ends by asking', /openRequestedType\(\);\n\}/.test(HTML));
  ok('it is not called before the list exists',
    HTML.indexOf('async function renderMyWidgets') < HTML.indexOf('function openRequestedType'));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
