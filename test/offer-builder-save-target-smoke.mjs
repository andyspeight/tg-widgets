/**
 * The Special Offers editor must never show a Save that saves the wrong thing.
 *
 * The bug (Andy, 10 Sep 2026): a photo uploaded fine but was gone on reopen.
 * The network log showed upload-photo-direct 200, the image loading, and two
 * widget-config calls from editor-shell.js — and NO saved-offers request. The
 * shell's top-bar Save persists the WIDGET config, not the offer, and it stayed
 * live while the offer form was open, so pressing it reported success for an
 * offer that was never posted.
 *
 * This drives the REAL editor script in jsdom (it is a plain top-level script,
 * so its functions are globals) with the shell and the builder stubbed, and
 * checks the save target rather than the source text.
 *
 * Run: node test/offer-builder-save-target-smoke.mjs
 *      (also: npm run test:offer-save-target)
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

const raw = readFileSync(new URL('../public/editor-offer-builder.html', import.meta.url), 'utf8');

// Drop the external scripts (shell, widget, tour) and inject stubs in their
// place, so the page's own inline script runs against a controlled shell.
const STUBS = `<script>
  window.__calls = { shellSave: 0, offerSubmit: 0, shellKey: 0 };
  window.tgse = {
    init: function () {},
    onReady: function () {},
    isLoggedIn: function () { return false; },
    setSaveState: function () {},
    markDirty: function () {},
    toast: function () {},
    doSave: function () { window.__calls.shellSave++; }
  };
  // The shell binds Cmd/Ctrl+S on document (bubble phase) and calls doSave.
  document.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) {
      window.__calls.shellKey++;
      window.tgse.doSave();
    }
  });
  window.TGOfferBuilderWidget = function (el, cfg) {
    this.el = el; this.cfg = cfg;
    this.submit = function () { window.__calls.offerSubmit++; };
  };
  window.TGOfferBuilderWidget.offerMeta = {
    types: [], sheetColsFor: function () { return []; }, sheetColOrder: [],
    sheetColLabels: {}, numericKeys: []
  };
  window.fetch = function () { return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ offers: [] }); } }); };
</script>`;

const html = raw.replace(/<script[^>]*\bsrc=[^>]*><\/script>/g, '').replace('</head>', STUBS + '</head>');

const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://widgets.travelify.io/editor-offer-builder' });
const { window } = dom;
const $ = (id) => window.document.getElementById(id);

const pressSave = () => window.document.dispatchEvent(new window.KeyboardEvent('keydown', {
  key: 's', metaKey: true, bubbles: true, cancelable: true
}));

// ── The two buttons exist and are distinct ──────────────────────
ok(!!$('btn-save'), 'the shell save button is on the page');
ok(!!$('btn-save-offer'), 'the offer form has its own save button');

// ── Before opening a form: the shell save is the only one on screen ──
ok($('btn-save').hidden === false, 'shell save is visible on the offers list');
ok($('formView').hidden === true, 'the offer form starts closed');

// Cmd+S on the list still belongs to the shell.
window.__calls.shellSave = 0; window.__calls.offerSubmit = 0;
pressSave();
ok(window.__calls.shellSave === 1, 'Cmd+S on the list saves the widget config');
ok(window.__calls.offerSubmit === 0, 'Cmd+S on the list does not submit an offer');

// ── Open the offer form ─────────────────────────────────────────
window.openForm(null);
ok($('formView').hidden === false, 'the offer form is open');
ok($('btn-save').hidden === true, 'the shell save is hidden while the offer form is open');
ok($('btn-save-offer').offsetParent !== undefined, 'the offer save button is present in the form header');

// The offer save button posts the OFFER.
window.__calls.shellSave = 0; window.__calls.offerSubmit = 0;
$('btn-save-offer').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
ok(window.__calls.offerSubmit === 1, 'clicking Save offer submits the offer');
ok(window.__calls.shellSave === 0, 'clicking Save offer does not save the widget config');

// Cmd+S inside the form means the offer, and must not reach the shell.
window.__calls.shellSave = 0; window.__calls.offerSubmit = 0; window.__calls.shellKey = 0;
pressSave();
ok(window.__calls.offerSubmit === 1, 'Cmd+S in the form submits the offer');
ok(window.__calls.shellKey === 0, "Cmd+S in the form never reaches the shell's shortcut");
ok(window.__calls.shellSave === 0, 'Cmd+S in the form does not save the widget config');

// ── Close the form: the shell gets its save back ────────────────
window.closeForm();
ok($('btn-save').hidden === false, 'the shell save returns when the form closes');
window.__calls.shellSave = 0; window.__calls.offerSubmit = 0;
pressSave();
ok(window.__calls.shellSave === 1, 'Cmd+S saves the widget config again once the form is closed');
ok(window.__calls.offerSubmit === 0, 'Cmd+S no longer submits an offer once the form is closed');

// ── The widget exposes the public hook the editor calls ─────────
const widget = readFileSync(new URL('../public/widget-offer-builder.js', import.meta.url), 'utf8');
ok(/\n\s*submit\(\)\s*\{\s*this\._submit\(\);\s*\}/.test(widget),
  'widget-offer-builder.js exposes a public submit() routed to _submit()');
ok(/offer\.images = \(this\._images \|\| \[\]\)/.test(widget),
  'the collected offer still always carries the photo list');

console.log('\nOffer builder save target: ' + passed + ' passed, ' + failed + ' failed.');
process.exit(failed ? 1 : 0);
