/**
 * The reply promise on an offer page is the agency's to set.
 *
 * It used to be hardcoded: "A travel expert replies within one working hour",
 * in three places and six languages, which made a commitment on behalf of every
 * client running the widget without any of them agreeing to it (Andy,
 * 10 Sep 2026). The default is now "We will be in touch shortly", and a client
 * can set their own on the Special Offers widget.
 *
 * The chain has four links, and this exercises each:
 *   editor field -> grid config -> /offer?reply= -> the page's three messages.
 *
 * Rendering was verified in Chromium across English and French, default and
 * custom, at all three sites. This pins the wiring that produces it.
 *
 * Run: node test/offer-reply-promise-smoke.mjs  (also: npm run test:offer-reply)
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

const page = readFileSync(new URL('../public/widget-offer-page.js', import.meta.url), 'utf8');
const grid = readFileSync(new URL('../public/widget-offers-grid.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../api/offer-page.js', import.meta.url), 'utf8');

// ── The old promise is gone, in every language ──────────────────
const OLD = ['working hour', 'heure ouvrée', 'Arbeitsstunde', 'hora laborable', 'ora lavorativa', 'oră lucrătoare'];
OLD.forEach((phrase) => ok(!page.includes(phrase), 'the old reply-time promise is gone: "' + phrase + '"'));
ok(page.includes("replyDefault: 'We will be in touch shortly.'"), 'the English default is the new wording');

// ── Every language carries a default and tokenises all three sites ──
const LANGS = ['en', 'fr', 'de', 'es', 'it', 'ro'];
ok((page.match(/replyDefault:/g) || []).length === LANGS.length,
  'all ' + LANGS.length + ' languages define replyDefault');
['trustLine', 'enqBandCopy', 'thanksName'].forEach((key) => {
  const lines = page.split('\n').filter((l) => l.trim().startsWith(key + ':'));
  ok(lines.length === LANGS.length, key + ' is defined in all ' + LANGS.length + ' languages');
  ok(lines.every((l) => l.includes('{reply}')), key + ' takes the {reply} token in every language');
  ok(lines.every((l) => !/travel expert|expert voyages|Reiseexperte|experto en viajes|esperto di viaggi|expert în călătorii/.test(l)),
    key + ' no longer hardcodes a reply time');
});
ok(/thanksName: 'Thanks \{name\}\. \{reply\}'/.test(page), 'the thank-you keeps {name} alongside {reply}');

// ── The page resolves the agency's words, or the localised default ──
ok(/_reply\(\) \{ return this\.cfg\.replyPromise \|\| this\.t\('replyDefault'\); \}/.test(page),
  'a set promise wins, blank falls back to the localised default');
ok(/replyPromise: \(typeof c\.replyPromise === 'string'\) \? c\.replyPromise\.slice\(0, 120\)\.trim\(\) : ''/.test(page),
  'the page caps the promise at 120 characters');
['trustLine', 'enqBandCopy', 'thanksName'].forEach((key) => {
  ok(new RegExp("t\\('" + key + "', \\{[^}]*reply: this\\._reply\\(\\)").test(page),
    key + ' is rendered with the resolved promise');
});
// All three go through esc(), so a promise cannot inject markup.
ok((page.match(/esc\((?:this\.)?t\('(?:trustLine|enqBandCopy|thanksName)'/g) || []).length === 3,
  'all three sites escape the promise before it reaches the page');

// ── The grid carries it to the offer page link ──────────────────
ok(/replyPromise: \(typeof c\.replyPromise === 'string'\) \? c\.replyPromise\.slice\(0, 120\)\.trim\(\) : ''/.test(grid),
  'the grid accepts and caps the setting');
ok(/q\.push\('reply=' \+ encodeURIComponent\(this\.cfg\.replyPromise\)\)/.test(grid),
  'the grid URL-encodes it onto the card link');
// Run the real _offerPageBase against a mock instance.
const bodyOf = (src, sig) => {
  const i = src.indexOf(sig); const open = src.indexOf('{', i);
  let depth = 0, j = open;
  for (; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}') { depth--; if (!depth) break; } }
  return src.slice(open + 1, j);
};
const offerPageBase = new Function(bodyOf(grid, '_offerPageBase() {'));
const urlFor = (cfg) => offerPageBase.call({ cfg: Object.assign({ template: 'classic', theme: 'light' }, cfg) });
globalThis.SCRIPT_BASE = 'https://widgets.travelify.io/';
ok(urlFor({ replyPromise: 'We reply within 24 hours.' }).includes('reply=We%20reply%20within%2024%20hours.'),
  'the promise is encoded into the link');
ok(!urlFor({}).includes('reply='), 'no promise set means no reply param');
ok(!urlFor({ replyPromise: 'a&b=c' }).includes('&b=c&'), 'an ampersand cannot split the query string');

// ── The offer page API whitelists and caps it ───────────────────
ok(/replyPromise: typeof q\.reply === 'string' \? q\.reply\.slice\(0, 120\) : ''/.test(api),
  'the API reads ?reply= and caps it at 120 characters');
ok(/reply passthrough/.test(api), 'the passthrough list documents it');

// ── The editor exposes it, hydrates it and saves it ─────────────
const raw = readFileSync(new URL('../public/editor-offer-builder.html', import.meta.url), 'utf8');
const STUBS = `<script>
  window.tgse = { init(o){ window.__init = o; }, onReady(){}, isLoggedIn(){return false;},
    setSaveState(){}, markDirty(){}, toast(){}, doSave(){} };
  window.TGOfferBuilderWidget = function(el, cfg){ window.__builderCfg = cfg; this.submit = function(){}; };
  window.TGOfferBuilderWidget.offerMeta = { types:[], sheetColsFor(){return [];}, sheetColOrder:[], sheetColLabels:{}, numericKeys:[] };
  window.TGOfferCardWidget = function(el, cfg){ window.__cardCfg = cfg; };
  window.fetch = function(){ return Promise.resolve({ ok:true, json(){ return Promise.resolve({offers:[]}); } }); };
</script>`;
const html = raw.replace(/<script[^>]*\bsrc=[^>]*><\/script>/g, '').replace('</head>', STUBS + '</head>');
const { window } = new JSDOM(html, { runScripts: 'dangerously', url: 'https://widgets.travelify.io/editor-offer-builder' });
// The sidebar inputs are wired in boot(), which normally runs after login.
window.boot();
const field = window.document.getElementById('cfgReplyPromise');

ok(!!field, 'the editor has a Reply promise field');
ok(field.getAttribute('maxlength') === '120', 'the field is capped at 120 characters, matching the widget');
ok(/We will be in touch shortly/.test(field.getAttribute('placeholder') || ''),
  'the placeholder shows what blank will produce');
ok(/never translated/i.test(field.closest('.field').textContent), 'the help text says it is not translated');

// Typing must reach the config the widget is saved with.
field.value = 'We reply within 24 hours.';
field.dispatchEvent(new window.Event('input', { bubbles: true }));
ok(window.__init && typeof window.__init.getConfig === 'function', 'the editor registered a getConfig with the shell');
ok(window.__init.getConfig().replyPromise === 'We reply within 24 hours.',
  'typing in the field lands in the saved config');

// A saved config must come back into the box when an existing widget is opened.
window.__init.setConfig({ replyPromise: 'A travel expert calls you back the same day.' });
ok(field.value === 'A travel expert calls you back the same day.',
  'reopening a saved widget puts the promise back in the field');
ok(window.__init.getConfig().replyPromise === 'A travel expert calls you back the same day.',
  'and it round-trips back out again');

// The offer form preview is handed the same promise, so what the agent sees
// while editing matches what a visitor gets.
window.openForm(null);
ok(window.__builderCfg && window.__builderCfg.replyPromise === 'A travel expert calls you back the same day.',
  'the builder preview is given the promise too');

// Blank means the widget default, not an empty sentence.
window.__init.setConfig({ replyPromise: '' });
ok(window.__init.getConfig().replyPromise === '', 'blank stays blank so the widget falls back to its default');

console.log('\nOffer reply promise: ' + passed + ' passed, ' + failed + ' failed.');
process.exit(failed ? 1 : 0);
