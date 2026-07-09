/**
 * Unit tests for the Email Signature widget generator (public/widget-emailsig.js)
 * and the hosted-endpoint helpers (api/_lib/emailsig.js).
 *
 * The generator is security-critical: its output is pasted into a mail client
 * verbatim, so escaping, URL sanitisation and colour whitelisting get heavy
 * coverage. Plain Node, no dependencies. The repo is type:module so this is .cjs.
 *
 * Run: node tests/test-emailsig.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ── Load the widget IIFE in a sandbox with stubbed window/document ──────────
function loadWidget() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'widget-emailsig.js'), 'utf8');
  const win = {};
  const doc = {
    currentScript: null,
    getElementsByTagName: () => [],
    querySelectorAll: () => [],
    addEventListener: () => {},
    readyState: 'complete',
  };
  const sandbox = {
    console, URL, URLSearchParams, encodeURIComponent, setTimeout,
    window: win, document: doc, navigator: {},
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'widget-emailsig.js' });
  if (!sandbox.window.TGEmailSigWidget) throw new Error('widget did not expose TGEmailSigWidget');
  return sandbox.window.TGEmailSigWidget;
}

const Widget = loadWidget();
const ORIGIN = 'https://tg-widgets.vercel.app';
function build(cfg, opts) {
  return Widget.buildSignatureHtml(cfg, Object.assign({ origin: ORIGIN }, opts || {}));
}

// ── Tiny test runner ────────────────────────────────────────────────────────
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; console.error('FAIL  ' + name); console.error('      ' + (e && e.message)); }
}
function ok(cond, msg) { if (!cond) throw new Error(msg || 'expected truthy'); }
function has(str, sub, msg) { if (String(str).indexOf(sub) === -1) throw new Error((msg || 'missing substring') + ': ' + JSON.stringify(sub)); }
function hasNot(str, sub, msg) { if (String(str).indexOf(sub) !== -1) throw new Error((msg || 'unexpected substring') + ': ' + JSON.stringify(sub)); }
function eq(a, b, msg) { if (a !== b) throw new Error((msg || 'not equal') + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }

const PERSON = { name: 'Jane Doe', title: 'Consultant', company: 'Sunshine Travel' };

// ── Escaping / XSS ──────────────────────────────────────────────────────────
test('escapes HTML in the name', () => {
  const out = build({ person: { name: '<script>alert(1)</script>' } });
  hasNot(out, '<script>alert(1)</script>', 'raw script tag leaked');
  has(out, '&lt;script&gt;', 'name not escaped');
});

test('escapes quotes and ampersands', () => {
  const out = build({ person: { name: 'A & "B"', company: "O'Neil" } });
  has(out, '&amp;');
  has(out, '&quot;');
  has(out, '&#039;');
});

test('escapes a disclaimer containing markup', () => {
  const out = build({ person: PERSON, disclaimer: '<b>x</b><img src=x onerror=alert(1)>' });
  hasNot(out, '<b>x</b>');
  hasNot(out, '<img src=x', 'the injected img must not survive as a live element');
  has(out, '&lt;b&gt;');
  has(out, '&lt;img', 'markup should survive only as escaped, inert text');
});

// ── URL sanitisation ────────────────────────────────────────────────────────
test('drops a javascript: photo URL', () => {
  const out = build({ person: { name: 'X', photoUrl: 'javascript:alert(1)' } });
  hasNot(out, 'javascript:');
});

test('keeps a valid https photo URL', () => {
  const out = build({ template: 'classic', person: { name: 'X', photoUrl: 'https://cdn.example.com/p.jpg' } });
  has(out, 'https://cdn.example.com/p.jpg');
});

test('builds tel: and mailto: links', () => {
  const out = build({ person: PERSON, contact: { phone: '+44 20 1234 5678', email: 'jane@x.co' } });
  has(out, 'tel:+442012345678');
  has(out, 'mailto:jane@x.co');
});

test('rejects a malformed email (no mailto link)', () => {
  const out = build({ person: PERSON, contact: { email: 'not-an-email' } });
  hasNot(out, 'mailto:');
});

test('prepends https to a bare website domain and strips scheme for display', () => {
  const out = build({ person: PERSON, contact: { website: 'example.com' } });
  has(out, 'href="https://example.com', 'href not normalised');
  has(out, '>example.com<', 'display text should strip scheme');
});

// ── Colour whitelisting ─────────────────────────────────────────────────────
test('falls back on an invalid accent colour (no style injection)', () => {
  const out = build({ person: PERSON, theme: { accent: 'red;} body{display:none}' } });
  hasNot(out, 'display:none');
  has(out, '#1B2B5B', 'should fall back to default accent');
});

test('accepts a valid hex accent', () => {
  const out = build({ person: PERSON, theme: { accent: '#a1b2c3' } });
  has(out, '#a1b2c3');
});

// ── Numeric clamping ────────────────────────────────────────────────────────
test('clamps an out-of-range font size', () => {
  const out = build({ person: PERSON, theme: { fontSize: 999 } });
  has(out, 'font-size:18px', 'font size should clamp to 18');
  hasNot(out, 'font-size:999px');
});

// ── Templates ───────────────────────────────────────────────────────────────
test('the whole gallery renders a presentation table', () => {
  const ids = Widget.TEMPLATES.map((t) => t.id);
  ok(ids.length >= 10, 'expected a gallery of 10+ templates, got ' + ids.length);
  const full = { person: PERSON, contact: { phone: '+44 20 1234 5678', email: 'a@b.co', website: 'x.com' },
    socials: [{ network: 'facebook', url: 'https://f.co/x' }], cta: { enabled: true, label: 'Go', url: 'https://x.co' },
    travel: { showBadges: true, abta: 'Y1' }, disclaimer: 'Confidential.' };
  for (const id of ids) {
    has(build(Object.assign({ template: id }, full)), '<table role="presentation"', id + ' missing table');
  }
});

test('exported gallery metadata is well-formed', () => {
  ok(Array.isArray(Widget.TEMPLATES) && Widget.TEMPLATES.every((t) => t.id && t.label), 'TEMPLATES metadata malformed');
  ok(Array.isArray(Widget.COLOUR_PRESETS) && Widget.COLOUR_PRESETS.length >= 5, 'COLOUR_PRESETS missing');
});

test('modern template shows the accent bar, compact does not', () => {
  has(build({ template: 'modern', person: PERSON }), 'width:4px', 'modern accent bar missing');
  hasNot(build({ template: 'compact', person: PERSON }), 'width:4px', 'compact should have no accent bar');
});

test('monogram template shows initials from the name', () => {
  const out = build({ template: 'monogram', person: { name: 'Jane Doe' } });
  has(out, '>JD<', 'expected JD monogram');
});

test('header band template paints an accent band', () => {
  const out = build({ template: 'headerband', person: PERSON, theme: { accent: '#123456' } });
  has(out, 'background-color:#123456', 'accent band missing');
  has(out, 'color:#ffffff', 'band text should be white');
});

test('unknown template falls back to classic (still renders)', () => {
  const out = build({ template: 'bogus', person: PERSON });
  has(out, '<table role="presentation"');
});

// ── Social links ────────────────────────────────────────────────────────────
test('keeps only whitelisted networks with valid URLs', () => {
  const out = build({ person: PERSON, socials: [
    { network: 'facebook', url: 'https://facebook.com/x' },
    { network: 'evilnet', url: 'https://e.com' },
    { network: 'linkedin', url: 'javascript:alert(1)' },
    { network: 'instagram', url: 'https://instagram.com/y' },
  ] });
  has(out, 'Facebook');
  has(out, 'Instagram');
  hasNot(out, 'evilnet');
  hasNot(out, 'javascript:');
});

test('social links render as hosted brand icons', () => {
  const out = build({ person: PERSON, socials: [
    { network: 'facebook', url: 'https://facebook.com/x' },
    { network: 'linkedin', url: 'https://linkedin.com/x' },
    { network: 'twitter', url: 'https://twitter.com/x' },
  ] }, { origin: ORIGIN });
  has(out, ORIGIN + '/emailsig-icons/facebook.png', 'facebook icon src missing');
  has(out, ORIGIN + '/emailsig-icons/linkedin.png', 'linkedin icon src missing');
  has(out, '/emailsig-icons/x.png', 'twitter should reuse the x icon');
  has(out, 'alt="Facebook"', 'accessible alt missing');
  has(out, 'title="LinkedIn"', 'accessible title missing');
});

// ── CTA button ──────────────────────────────────────────────────────────────
test('CTA renders only with a label and a valid URL', () => {
  has(build({ person: PERSON, cta: { enabled: true, label: 'Book now', url: 'https://x.co/book' } }), 'Book now');
  hasNot(build({ person: PERSON, cta: { enabled: true, label: 'Book now', url: '' } }), 'Book now');
});

// ── Travel credentials ──────────────────────────────────────────────────────
test('shows ABTA/ATOL and Trustpilot when enabled', () => {
  const out = build({ person: PERSON, travel: { showBadges: true, abta: 'Y1234', atol: '5678', trustpilotRating: '4.8', trustpilotUrl: 'https://tp.com/x' } });
  has(out, 'ABTA No. Y1234');
  has(out, 'ATOL Protected 5678');
  has(out, 'Rated 4.8/5 on Trustpilot');
});

test('hides credentials when the toggle is off', () => {
  const out = build({ person: PERSON, travel: { showBadges: false, abta: 'Y1234' } });
  hasNot(out, 'ABTA No.');
});

// ── Hosted banner + pixel indirection ───────────────────────────────────────
test('updatable banner + saved id uses the /api indirection', () => {
  const out = build(
    { person: PERSON, banner: { enabled: true, imageUrl: 'https://img.example/x.png', linkUrl: 'https://l.example/x', updatable: true } },
    { widgetId: 'tgw_123_ab' }
  );
  has(out, ORIGIN + '/api/emailsig-banner?id=tgw_123_ab');
  has(out, ORIGIN + '/api/emailsig-click?id=tgw_123_ab');
  hasNot(out, 'https://img.example/x.png', 'should not bake the direct image when updatable');
});

test('non-updatable banner uses the direct image URL', () => {
  const out = build(
    { person: PERSON, banner: { enabled: true, imageUrl: 'https://img.example/x.png', linkUrl: 'https://l.example/x', updatable: false } },
    { widgetId: 'tgw_123_ab' }
  );
  has(out, 'https://img.example/x.png');
  hasNot(out, '/api/emailsig-banner');
});

test('banner with no saved id falls back to the direct image URL', () => {
  const out = build({ person: PERSON, banner: { enabled: true, imageUrl: 'https://img.example/x.png', updatable: true } });
  has(out, 'https://img.example/x.png');
  hasNot(out, '/api/emailsig-banner');
});

test('disabled banner renders nothing', () => {
  const out = build({ person: PERSON, banner: { enabled: false, imageUrl: 'https://img.example/x.png' } }, { widgetId: 'tgw_1' });
  hasNot(out, 'img.example');
  hasNot(out, '/api/emailsig-banner');
});

test('open pixel appears only with tracking on AND a saved id', () => {
  has(build({ person: PERSON, tracking: { openPixel: true } }, { widgetId: 'tgw_9' }), '/api/emailsig-pixel?id=tgw_9');
  hasNot(build({ person: PERSON, tracking: { openPixel: true } }), '/api/emailsig-pixel');
  hasNot(build({ person: PERSON, tracking: { openPixel: false } }, { widgetId: 'tgw_9' }), '/api/emailsig-pixel');
});

test('a bad widget id is not trusted for tracking URLs', () => {
  const out = build({ person: PERSON, tracking: { openPixel: true } }, { widgetId: 'bad id!' });
  hasNot(out, '/api/emailsig-pixel');
});

// ── No-JS / email-safety invariants ─────────────────────────────────────────
test('output contains no <script> and no <style> block', () => {
  const out = build({ template: 'modern', person: PERSON, contact: { phone: '123456', email: 'a@b.co', website: 'x.com' },
    socials: [{ network: 'facebook', url: 'https://f.co/x' }], cta: { enabled: true, label: 'Go', url: 'https://x.co' },
    travel: { showBadges: true, abta: 'Y1' }, disclaimer: 'Confidential.' });
  hasNot(out.toLowerCase(), '<script');
  hasNot(out.toLowerCase(), '<style');
  hasNot(out.toLowerCase(), 'onerror=');
  hasNot(out.toLowerCase(), 'onclick=');
});

// ── Shadow-DOM preview assembly (constructor + _render) ─────────────────────
test('renders a preview card with copy buttons and install guide', () => {
  const shadow = { addEventListener() {}, innerHTML: '' };
  const container = { getAttribute: () => null, attachShadow: () => shadow };
  new Widget(container, { person: PERSON, widgetId: 'tgw_1', tracking: { openPixel: true } });
  has(shadow.innerHTML, 'Copy signature');
  has(shadow.innerHTML, 'Copy HTML code');
  has(shadow.innerHTML, 'Gmail');
  has(shadow.innerHTML, 'Apple Mail');
  has(shadow.innerHTML, 'Jane Doe');
  has(shadow.innerHTML, '<table role="presentation"');
});

test('preview nudges the user to save when tracking needs an id', () => {
  const shadow = { addEventListener() {}, innerHTML: '' };
  const container = { getAttribute: () => null, attachShadow: () => shadow };
  new Widget(container, { person: PERSON, tracking: { openPixel: true } }); // no widgetId
  has(shadow.innerHTML, 'Save the widget');
});

// ── Hosted-endpoint helpers (ESM) ───────────────────────────────────────────
(async () => {
  const mod = await import('../api/_lib/emailsig.js');

  test('safeHttpUrl rejects javascript: and accepts https', () => {
    eq(mod.safeHttpUrl('javascript:alert(1)'), '');
    eq(mod.safeHttpUrl('data:text/html,x'), '');
    eq(mod.safeHttpUrl('https://x.com'), 'https://x.com/');
    eq(mod.safeHttpUrl(''), '');
  });

  test('safeWidgetId accepts widget ids and rejects junk', () => {
    eq(mod.safeWidgetId('tgw_1712345678_ab12cd'), 'tgw_1712345678_ab12cd');
    eq(mod.safeWidgetId('bad id!'), '');
    eq(mod.safeWidgetId(''), '');
    eq(mod.safeWidgetId('x'.repeat(65)), '');
  });

  test('TRANSPARENT_GIF is a small valid GIF buffer', () => {
    ok(Buffer.isBuffer(mod.TRANSPARENT_GIF), 'not a buffer');
    ok(mod.TRANSPARENT_GIF.length > 0 && mod.TRANSPARENT_GIF.length < 100, 'unexpected size');
    eq(mod.TRANSPARENT_GIF.slice(0, 6).toString('ascii'), 'GIF89a');
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
