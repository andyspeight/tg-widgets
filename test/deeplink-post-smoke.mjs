/**
 * Deeplink token-transport test: when an `x-access-token` cookie is present, a
 * click on a Travelify deeplink anchor is handed over as an auto-POST form with
 * the token in the body instead of a GET; otherwise the GET is left untouched.
 *
 * Extracts the real getCookie / postDeeplinkWithToken / wireDeeplinkPost helpers
 * from the shipped widget and drives them in jsdom (form.submit is stubbed, since
 * jsdom does not navigate). Run: node test/deeplink-post-smoke.mjs
 */
import { readFileSync } from 'node:fs';

let JSDOM;
try { ({ JSDOM } = await import('jsdom')); }
catch { console.log('jsdom not installed — skipping deeplink-post smoke'); process.exit(0); }

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

// Balanced-brace slice to pull a function's real source out of the widget file.
function sliceBalanced(src, fromIdx) {
  let i = src.indexOf('{', fromIdx); const open = i;
  let d = 0, str = null, line = false, block = false;
  for (; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (line) { if (c === '\n') line = false; continue; }
    if (block) { if (c === '*' && n === '/') { block = false; i++; } continue; }
    if (str) { if (c === '\\') { i++; continue; } if (c === str) str = null; continue; }
    if (c === '/' && n === '/') { line = true; i++; continue; }
    if (c === '/' && n === '*') { block = true; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { str = c; continue; }
    if (c === '{') d++; else if (c === '}') { d--; if (d === 0) return src.slice(open, i + 1); }
  }
  throw new Error('unbalanced');
}
function ex(src, sig) { const at = src.indexOf(sig); if (at < 0) throw new Error('not found: ' + sig); return sig + sliceBalanced(src, at + sig.length); }

function harness(file) {
  const src = readFileSync(new URL('../public/' + file, import.meta.url), 'utf8');
  const fns = [
    ex(src, 'function getCookie(name)'),
    ex(src, 'function postDeeplinkWithToken(url, newTab)'),
    ex(src, 'function wireDeeplinkPost(shadowRoot)'),
  ].join('\n');

  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'dangerously', url: 'https://shop.example.com/' });
  const { window } = dom;
  let submitted = null;
  window.HTMLFormElement.prototype.submit = function () { submitted = this; };
  window.eval(fns + '\nwindow.__wire = wireDeeplinkPost;');

  const host = window.document.createElement('div');
  window.document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML =
    '<a id="dl" href="https://dl.tvllnk.com/deeplink/370?st=Packages&adt=2" target="_blank"><span>Book</span></a>'
    + '<a id="ext" href="https://example.com/other" target="_blank">Other</a>';
  window.__wire(shadow);

  const click = (id) => {
    submitted = null;
    const el = shadow.getElementById(id);
    // click the inner span for #dl to prove closest('a') resolves the anchor
    const target = id === 'dl' ? el.querySelector('span') : el;
    const ev = new window.MouseEvent('click', { bubbles: true, cancelable: true });
    target.dispatchEvent(ev);
    return { ev, form: submitted };
  };
  return { window, shadow, click };
}

// ── Offers widget ─────────────────────────────────────────────────────────
{
  const h = harness('widget-offers.js');

  // No cookie → normal GET, no form, default not prevented.
  let r = h.click('dl');
  ok(r.form === null, 'offers/no-cookie: no POST form created');
  ok(r.ev.defaultPrevented === false, 'offers/no-cookie: GET navigation left intact');

  // Cookie with reserved chars (+ / =) → POST with the decoded token in the body.
  h.window.document.cookie = 'x-access-token=abc%2Bdef%2Fghi%3D';
  r = h.click('dl');
  ok(!!r.form, 'offers/cookie: POST form submitted');
  ok(r.form && r.form.method.toLowerCase() === 'post', 'offers/cookie: method=POST');
  ok(r.form && /dl\.tvllnk\.com\/deeplink\/370\?st=Packages&adt=2$/.test(r.form.action), 'offers/cookie: action is the deeplink verbatim (query string intact)');
  ok(r.form && r.form.target === '_blank', 'offers/cookie: opens in a new tab (target preserved)');
  const input = r.form && r.form.querySelector('input[name="x-access-token"]');
  ok(input && input.type === 'hidden', 'offers/cookie: single hidden x-access-token input');
  ok(input && input.value === 'abc+def/ghi=', 'offers/cookie: token decoded once; + / = round-trip intact');
  ok(!/x-access-token/.test(r.form.action), 'offers/cookie: token is NOT in the action URL');
  ok(r.ev.defaultPrevented === true, 'offers/cookie: GET navigation prevented');

  // A non-deeplink link is never touched, even with the cookie set.
  r = h.click('ext');
  ok(r.form === null, 'offers/non-deeplink: left as a normal GET');
  ok(r.ev.defaultPrevented === false, 'offers/non-deeplink: default not prevented');
}

// ── World map widget (identical helpers) ───────────────────────────────────
{
  const h = harness('widget-worldmap.js');
  let r = h.click('dl');
  ok(r.form === null, 'map/no-cookie: no POST form');
  h.window.document.cookie = 'x-access-token=Zm9v%2BYmFy';
  r = h.click('dl');
  ok(!!r.form && r.form.method.toLowerCase() === 'post', 'map/cookie: POST form submitted');
  const input = r.form && r.form.querySelector('input[name="x-access-token"]');
  ok(input && input.value === 'Zm9v+YmFy', 'map/cookie: token decoded into the body');
  ok(r.ev.defaultPrevented === true, 'map/cookie: GET prevented');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
