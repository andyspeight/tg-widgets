/**
 * Render smoke test for widget-top10.js (no browser).
 *
 * Loads the real widget IIFE against a tiny DOM shim, hands it pre-hydrated
 * cards through __items (the same door the editor preview uses), and inspects
 * the HTML it produces.
 *
 * The rules being guarded, and why:
 *  - Every destination string reaches innerHTML, so all of it is escaped. The
 *    content comes from Airtable, which humans edit.
 *  - The per-item link is built from an agent-supplied pattern. Both the
 *    pattern and the substituted values are attacker-reachable, so the result
 *    goes through a protocol allowlist before it is emitted.
 *  - Rendering must be side-effect-free for the host page: the editor calls
 *    update() on every keystroke, so a focus() or scrollIntoView() in the render
 *    path would steal the caret out of the field being typed into (the Enquiry
 *    bug, 23 Jul 2026).
 *  - update() must not refetch unless the SOURCE of the list changed, for the
 *    same reason.
 *
 * Run: node test/widget-top10-render.test.mjs
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// ---- Minimal DOM shim ----------------------------------------------------
function makeEl(tag) {
  return {
    tagName: tag,
    className: '',
    _children: [],
    _attrs: {},
    _html: '',
    style: { setProperty() {} },
    set innerHTML(v) { this._html = String(v); },
    get innerHTML() { return this._html; },
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return this._attrs[k]; },
    removeAttribute(k) { delete this._attrs[k]; },
    appendChild(c) { this._children.push(c); return c; },
    removeChild(c) { const i = this._children.indexOf(c); if (i >= 0) this._children.splice(i, 1); return c; },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    addEventListener() {},
    attachShadow() { this.__shadow = makeEl('#shadow'); return this.__shadow; },
  };
}

global.window = {};
global.document = {
  readyState: 'complete',
  createElement: makeEl,
  querySelectorAll() { return []; },
  getElementsByTagName() { return []; },
  addEventListener() {},
  currentScript: { src: 'https://widgets.travelify.io/widget-top10.js' },
  body: makeEl('body'),
  documentElement: makeEl('html'),
};
// The widget must never reach the network in these cases: __items short-circuits
// the fetch. If it ever does, fail loudly rather than hang.
global.fetch = () => { throw new Error('widget attempted a network call with __items supplied'); };

const SRC = readFileSync(new URL('../public/widget-top10.js', import.meta.url), 'utf8');
vm.runInThisContext(SRC, { filename: 'widget-top10.js' });

const TGTop10Widget = global.window.TGTop10Widget;
if (typeof TGTop10Widget !== 'function') {
  console.error('FAIL: widget did not expose TGTop10Widget');
  process.exit(1);
}

let pass = 0;
const fails = [];
function ok(label, cond) { if (cond) { pass++; } else { fails.push(label); } }

// ---- Fixtures ------------------------------------------------------------
function card(n, over) {
  return Object.assign({
    rank: n,
    level: 'resort',
    recordId: 'rec' + String(n).padStart(14, '0'),
    slug: 'place-' + n,
    name: 'Place ' + n,
    region: 'Region ' + n,
    tagline: 'A tagline for place ' + n + '.',
    image: 'https://img.test/' + n + '.jpg',
    attribution: 'Photographer ' + n,
    tags: ['Beach', 'Luxury'],
    flightTime: '4h 15m',
    bestMonths: 'May to Sep',
  }, over || {});
}

const TEN = Array.from({ length: 10 }, (_, i) => card(i + 1));

// The shadow root always carries the full stylesheet, which mentions every
// class name the widget can produce. Assertions about what is RENDERED must
// therefore look at the markup with the <style> block removed, or "is this
// class absent?" is answered by the CSS and always false.
function markup(html) {
  return html.replace(/<style>[\s\S]*?<\/style>/g, '');
}

// The themeable values land in the root element's style attribute. The
// stylesheet also contains `font-family:`, so an assertion about what was
// APPLIED has to read the attribute, not the whole shadow root. Note esc()
// encodes the quotes in a font stack, so 'Inter' appears as &#39;Inter&#39;.
function styleAttr(raw) {
  const m = raw.match(/class="tg10-root"[^>]*style="([^"]*)"/);
  return m ? m[1] : '';
}

function render(cfg, items) {
  const host = makeEl('div');
  const w = new TGTop10Widget(host, Object.assign({ __items: items || TEN }, cfg));
  const raw = host.__shadow.innerHTML;
  return { html: markup(raw), raw, widget: w, host };
}

// ---- Layout: list --------------------------------------------------------
{
  const { html } = render({ title: 'Top 10 Beach Escapes', subtitle: 'Ten stretches of sand.' });
  ok('list renders an ordered list', html.includes('<ol class="tg10-list"'));
  ok('list renders the title', html.includes('Top 10 Beach Escapes'));
  ok('list renders the subtitle', html.includes('Ten stretches of sand.'));
  ok('list renders all ten rows', (html.match(/class="tg10-row"/g) || []).length === 10);
  ok('list renders rank one', html.includes('class="tg10-rank" aria-hidden="true">1<'));
  ok('list renders rank ten', html.includes('class="tg10-rank" aria-hidden="true">10<'));
  ok('list renders a name', html.includes('Place 1'));
  ok('list renders a tagline', html.includes('A tagline for place 1.'));
  ok('list renders the region', html.includes('Region 1'));
  ok('list renders best months', html.includes('May to Sep'));
  ok('list renders flight time with its qualifier', html.includes('4h 15m from the UK'));
  ok('list renders chips', html.includes('class="tg10-chip">Beach<'));
  ok('list renders the photo credit', html.includes('Photography: Photographer 1'));
  ok('list images are lazy', html.includes('loading="lazy"'));
  ok('rank is hidden from the accessibility tree', html.includes('aria-hidden="true">1<'));
}

// ---- Layout: grid --------------------------------------------------------
{
  const { html } = render({ layout: 'grid' });
  ok('grid renders the grid list', html.includes('tg10-grid'));
  ok('grid renders ten cards', (html.match(/class="tg10-card"/g) || []).length === 10);
  ok('grid renders a rank badge', html.includes('class="tg10-badge">1<'));
  ok('grid does not render list rows', !html.includes('class="tg10-row"'));
}

// ---- Layout: feature -----------------------------------------------------
{
  const { html } = render({ layout: 'feature' });
  ok('feature renders the lead card', html.includes('tg10-feature'));
  ok('feature labels the top pick', html.includes('Our number one'));
  ok('feature renders the other nine as rows', (html.match(/class="tg10-row"/g) || []).length === 9);
  ok('feature ranks the rows from two', html.includes('class="tg10-rank" aria-hidden="true">2<'));
}

// ---- Escaping ------------------------------------------------------------
{
  const hostile = [card(1, {
    name: '<script>alert(1)</script>',
    tagline: '"><img src=x onerror=alert(2)>',
    region: "O'Brien & Sons <b>",
    attribution: '<svg onload=alert(3)>',
    tags: ['Beach'],
    bestMonths: '<i>May</i>',
    flightTime: '<b>4h</b>',
  })];
  const { html } = render({ title: '<script>alert(9)</script>', subtitle: '</style><script>x</script>' }, hostile);
  ok('no raw script tag survives', !html.includes('<script>'));
  ok('no raw img onerror survives', !html.includes('<img src=x'));
  ok('no raw svg onload survives', !html.includes('<svg onload'));
  ok('the name is escaped', html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  ok('the tagline is escaped', html.includes('&quot;&gt;&lt;img'));
  ok('an ampersand and quote are escaped', html.includes('O&#39;Brien &amp; Sons'));
  ok('the title is escaped', html.includes('&lt;script&gt;alert(9)&lt;/script&gt;'));
  ok('the credit is escaped', html.includes('&lt;svg onload'));
  ok('a marked-up fact is escaped', html.includes('&lt;i&gt;May&lt;/i&gt;'));
}

// ---- Per-item links ------------------------------------------------------
{
  const { html } = render({ linkPattern: '/destinations/{{slug}}' });
  ok('a relative link pattern renders', html.includes('href="/destinations/place-1"'));
  ok('same-tab links carry no target', !html.includes('target="_blank"'));
}
{
  const { html } = render({ linkPattern: 'https://x.test/{{slug}}', linkTarget: 'new' });
  ok('an absolute link pattern renders', html.includes('href="https://x.test/place-1"'));
  ok('new-tab links open safely', html.includes('rel="noopener noreferrer"'));
}
{
  const { html } = render({ linkPattern: 'javascript:alert(1)//{{slug}}' });
  ok('a javascript: pattern produces no href', !html.includes('href="javascript'));
  ok('names still render without a link', html.includes('Place 1'));
}
{
  const { html } = render({ linkPattern: 'data:text/html,{{slug}}' });
  ok('a data: pattern produces no href', !html.includes('href="data:'));
}
{
  const { html } = render({ linkPattern: '//evil.test/{{slug}}' });
  ok('a protocol-relative pattern is rejected', !html.includes('href="//evil.test'));
}
{
  // A hostile slug must not break out of the href attribute.
  const { html } = render({ linkPattern: '/d/{{slug}}' }, [card(1, { slug: '" onmouseover="alert(1)' })]);
  ok('a hostile slug is percent-encoded', !html.includes('onmouseover='));
}
{
  const { html } = render({ linkPattern: '' });
  ok('a blank pattern renders no anchors around names', !html.includes('<a href='));
}
{
  const { html } = render({ linkPattern: '/d/{{name}}/{{level}}' });
  ok('name and level substitute too', html.includes('href="/d/Place%201/resort"'));
}
{
  const { html } = render({ linkPattern: '/d/{{unknown}}' });
  ok('an unknown token is left alone', html.includes('href="/d/{{unknown}}"'));
}

// ---- Toggles -------------------------------------------------------------
{
  const { html } = render({ showRank: false });
  ok('rank off removes the numerals', !html.includes('class="tg10-rank"'));
  ok('rank off marks the list', html.includes('data-norank="1"'));
}
{
  const { html } = render({ showPhoto: false });
  ok('photo off removes thumbnails', !html.includes('tg10-thumb'));
  ok('photo off removes the credit line', !html.includes('Photography:'));
  ok('photo off marks the list', html.includes('data-nophoto="1"'));
}
{
  const { html } = render({ showTagline: false });
  ok('tagline off removes taglines', !html.includes('A tagline for place 1.'));
}
{
  const { html } = render({ showTags: false });
  ok('tags off removes chips', !html.includes('tg10-chip'));
}
{
  const { html } = render({ showBestMonths: false, showFlightTime: false });
  ok('facts off removes the meta rail', !html.includes('tg10-meta'));
}

// ---- No photo ------------------------------------------------------------
{
  const { html } = render({}, [card(1, { image: '' }), card(2)]);
  ok('a missing photo gets the brand fallback', html.includes('tg10-nophoto'));
  ok('a missing photo emits no img tag for it', (html.match(/<img /g) || []).length === 1);
  ok('a missing photo is not credited', !html.includes('Photographer 1'));
  ok('the photo that exists is still credited', html.includes('Photographer 2'));
}
{
  const { html } = render({}, [card(1, { image: 'javascript:alert(1)' })]);
  ok('a non-http image is refused and falls back', html.includes('tg10-nophoto'));
  ok('a non-http image never becomes a src', !html.includes('src="javascript'));
}

// ---- maxItems ------------------------------------------------------------
{
  const { html } = render({ maxItems: 3 });
  ok('maxItems truncates', (html.match(/class="tg10-row"/g) || []).length === 3);
}
{
  const { html } = render({ maxItems: 99 });
  ok('maxItems is clamped above', (html.match(/class="tg10-row"/g) || []).length === 10);
}
{
  const { html } = render({ maxItems: 0 });
  ok('maxItems is clamped below', (html.match(/class="tg10-row"/g) || []).length >= 1);
}
{
  const { html } = render({ maxItems: 'nonsense' });
  ok('a nonsense maxItems falls back to ten', (html.match(/class="tg10-row"/g) || []).length === 10);
}

// ---- Empty and heading-less ---------------------------------------------
{
  const { html } = render({}, []);
  ok('an empty list says so calmly', html.includes('No destinations have been added'));
  ok('an empty list renders no rows', !html.includes('class="tg10-row"'));
}
{
  const { html } = render({ title: '', subtitle: '' });
  ok('no heading means no header element', !html.includes('tg10-head'));
}

// ---- CTA -----------------------------------------------------------------
{
  const { html } = render({ ctaEnabled: true, ctaText: 'Need a hand?', ctaLabel: 'Talk to us', ctaUrl: '/contact' });
  ok('the CTA renders its copy', html.includes('Need a hand?'));
  ok('the CTA renders its button', html.includes('href="/contact"'));
}
{
  const { html } = render({ ctaEnabled: false, ctaText: 'Need a hand?' });
  ok('the CTA stays off when disabled', !html.includes('Need a hand?'));
}
{
  const { html } = render({ ctaEnabled: true, ctaLabel: 'Go', ctaUrl: 'javascript:alert(1)' });
  ok('a javascript CTA url is refused', !html.includes('javascript:alert'));
}
{
  const { html } = render({ ctaEnabled: true, ctaLabel: 'Call', ctaUrl: 'tel:+441234567890' });
  ok('tel: is allowed on the CTA', html.includes('href="tel:+441234567890"'));
}
{
  const { html } = render({ ctaEnabled: true, ctaText: '', ctaLabel: '', ctaUrl: '' });
  ok('an empty CTA renders nothing', !html.includes('tg10-cta'));
}

// ---- Theme and colours ---------------------------------------------------
{
  const { html } = render({ theme: 'dark' });
  ok('dark theme is set on the root', html.includes('data-theme="dark"'));
}
{
  const { html } = render({ theme: 'nonsense' });
  ok('an unknown theme falls back to light', html.includes('data-theme="light"'));
}
{
  const { raw } = render({ brandColour: '#123456', accentColour: '#ABCDEF' });
  ok('a valid brand colour is applied', styleAttr(raw).includes('--tg10-brand:#123456'));
  ok('the brand colour is also emitted as rgb', styleAttr(raw).includes('--tg10-brand-rgb:18,52,86'));
}
{
  const { raw } = render({ brandColour: 'red; background:url(javascript:alert(1))' });
  ok('an invalid colour falls back to the default', styleAttr(raw).includes('--tg10-brand:#1B2B5B'));
  ok('an invalid colour cannot inject css', !raw.includes('javascript:alert'));
  ok('an invalid colour injects no extra declaration', !styleAttr(raw).includes('background'));
}
{
  const { raw } = render({ fontFamily: 'Georgia, serif' });
  ok('a font family is applied', styleAttr(raw).includes('font-family:Georgia, serif'));
}
{
  const { raw } = render({ fontFamily: "'Inter', -apple-system, sans-serif" });
  ok('a quoted font stack survives', styleAttr(raw).includes('&#39;Inter&#39;, -apple-system, sans-serif'));
}
{
  // The font stack lands in the root element's style attribute, so a semicolon
  // would close the declaration and let the next one through. Found in the
  // 4 Sep 2026 pre-deploy review: stripping angle brackets was not enough, and
  // "Arial; background:url(...)" beaconed every visitor's IP to a third party.
  const { raw } = render({ fontFamily: "Arial; background:url('https://evil.test/x.png')" });
  ok('a semicolon in the font stack is refused', !raw.includes('evil.test'));
  ok('the style attribute carries no injected declaration', !styleAttr(raw).includes('background:'));
  ok('a refused font stack falls back to the default', styleAttr(raw).includes('font-family:&#39;Inter&#39;'));
}
{
  const { raw } = render({ fontFamily: 'Arial}</style><script>alert(1)</script>' });
  ok('a style-breaking font stack is refused', !raw.includes('alert(1)'));
}
{
  const { raw } = render({ fontFamily: 'A'.repeat(400) });
  ok('an absurdly long font stack is refused', !styleAttr(raw).includes('A'.repeat(300)));
}
{
  const { raw } = render({ fontFamily: '' });
  ok('a blank font stack falls back', styleAttr(raw).includes('font-family:&#39;Inter&#39;'));
}
{
  const { raw } = render({ fontFamily: 42 });
  ok('a non-string font stack falls back', styleAttr(raw).includes('font-family:&#39;Inter&#39;'));
}

// ---- update(): no refetch unless the source changed -----------------------
{
  const { widget, host } = render({ layout: 'list' });
  let loads = 0;
  widget._load = () => { loads++; };

  widget.update({ layout: 'grid' });
  ok('a layout change does not refetch', loads === 0);
  ok('a layout change re-renders', host.__shadow.innerHTML.includes('tg10-grid'));

  widget.update({ title: 'New title' });
  ok('a title change does not refetch', loads === 0);
  ok('a title change re-renders', host.__shadow.innerHTML.includes('New title'));

  widget.update({ showTags: false });
  ok('a toggle change does not refetch', loads === 0);

  // Changing the source is the one case that must go back to the network.
  const fresh = render({ layout: 'list' });
  fresh.widget._load = function () { loads++; };
  delete fresh.widget.cfg.__items;
  fresh.widget.update({ listId: 'winter-sun' });
  ok('changing the list does refetch', loads === 1);
}

// ---- Render is side-effect-free for the host page -------------------------
{
  // The editor calls the render path on every keystroke, so nothing in it may
  // grab the page. Assert on the source rather than the output, because the
  // failure mode is a call that never shows up in HTML.
  // Comments must come out first: the JSDoc header carries the embed snippet
  // (which contains a <script> tag) and the render-path comment names the exact
  // calls it forbids, so a raw search finds its own documentation.
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok('comment stripping left the code intact', CODE.includes('class TGTop10Widget') && CODE.includes('_render()'));

  const renderPath = CODE.slice(CODE.indexOf('_render()'), CODE.indexOf('update(newConfig)'));
  ok('render path is non-trivial', renderPath.length > 1500);
  ok('render path never calls focus()', !/\.focus\s*\(/.test(renderPath));
  ok('render path never calls scrollIntoView()', !/scrollIntoView/.test(renderPath));
  ok('render path never calls select()', !/\.select\s*\(/.test(renderPath));
  ok('widget markup carries no autofocus', !/autofocus/i.test(CODE));
  ok('widget has no inline event handlers', !/\son(click|error|load|mouseover)\s*=/i.test(CODE.replace(/addEventListener/g, '')));
  ok('widget never injects a script tag', !/<script/i.test(CODE));
  ok('widget uses no eval', !/\beval\s*\(/.test(CODE));
  ok('widget uses no Function constructor', !/new\s+Function\s*\(/.test(CODE));
  ok('widget never uses innerHTML on the host page', !/document\.body\.innerHTML/.test(CODE));
}

// ---- Contract surface ----------------------------------------------------
{
  ok('version global is exposed', typeof global.window.__TG_TOP10_VERSION__ === 'string');
  ok('version matches the header', SRC.includes("VERSION = '" + global.window.__TG_TOP10_VERSION__ + "'"));
  const { widget, host } = render({});
  ok('the container is marked initialised', host.getAttribute('data-tg-initialised') === '1');
  widget.destroy();
  ok('destroy empties the shadow root', host.__shadow.innerHTML === '');
  ok('destroy clears the init guard', host.getAttribute('data-tg-initialised') === undefined);
}

// ---- Report --------------------------------------------------------------
if (fails.length) {
  console.error(`\n✗ widget-top10-render: ${fails.length} failed, ${pass} passed\n`);
  fails.forEach(f => console.error('  - ' + f));
  process.exit(1);
}
console.log(`✓ widget-top10-render: ${pass} assertions passed`);
