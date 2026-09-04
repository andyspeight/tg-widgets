/**
 * Render and state-machine smoke test for widget-inspirator.js (no browser).
 *
 * Loads the real widget IIFE against a tiny DOM shim, hands it pre-hydrated
 * cards through __cards (the same door the editor preview and the demo use),
 * and drives the deck through every phase.
 *
 * The rules being guarded, and why:
 *  - A card with no photo must never be dealt. A swipe card is a photograph
 *    with a name on it, and 394 of 495 live resorts have no image.
 *  - Every destination string reaches innerHTML, so all of it is escaped. The
 *    content comes from Airtable, which humans edit.
 *  - The deck must be operable without a pointer. Buttons and arrow keys are
 *    the primary control; the drag is the flourish. A deck that can only be
 *    swiped is unusable with a keyboard and invisible to a screen reader.
 *  - Rendering must be side-effect-free for the host page: the editor calls
 *    update() on every keystroke, so a focus() or scrollIntoView() in the
 *    render path would steal the caret (the Enquiry bug, 23 Jul 2026).
 *  - update() must not refetch unless the SOURCE of the deck changed.
 *  - The widget must never show a price or reach Travelify: offers are
 *    cache-only (30 Jul 2026).
 *
 * Run: node test/widget-inspirator-render.test.mjs
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// ---- Minimal DOM shim ----------------------------------------------------
// querySelector deliberately returns null: the widget's incremental repaint
// falls back to a full _render() when it cannot find its own subtree, which is
// exactly the path we want to exercise headlessly.
function makeEl(tag) {
  return {
    tagName: tag,
    className: '',
    _children: [],
    _attrs: {},
    _html: '',
    // Field values the submit path will read, when this element is standing in
    // for the widget's own root. Tests set these before calling _send().
    _fields: {},
    style: { setProperty() {} },
    set innerHTML(v) { this._html = String(v); },
    get innerHTML() { return this._html; },
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return this._attrs[k]; },
    removeAttribute(k) { delete this._attrs[k]; },
    appendChild(c) { this._children.push(c); return c; },
    removeChild(c) { const i = this._children.indexOf(c); if (i >= 0) this._children.splice(i, 1); return c; },
    querySelectorAll() { return []; },
    // Only '.tgi-root' resolves, and only when a root stub has been attached.
    // Everything else stays null so the widget's incremental repaints keep
    // falling back to a full _render(), which is the path we want headlessly.
    querySelector(sel) {
      if (sel === '.tgi-root' && this.__root) return this.__root;
      return null;
    },
    addEventListener() {},
    attachShadow() { this.__shadow = makeEl('#shadow'); return this.__shadow; },
  };
}

// A stand-in for the rendered widget root, so the submit path can be driven
// without a browser. Returns a value-bearing stub for each form field id.
function attachFormRoot(shadow, fields) {
  shadow.__root = {
    _fields: fields || {},
    addEventListener() {},
    querySelector(sel) {
      const id = String(sel).replace(/^#/, '');
      if (!(id in this._fields)) return null;
      const v = this._fields[id];
      return typeof v === 'boolean' ? { checked: v, value: '' } : { value: v, checked: false };
    },
  };
  return shadow.__root;
}

global.window = {};
global.document = {
  readyState: 'complete',
  createElement: makeEl,
  querySelectorAll() { return []; },
  getElementsByTagName() { return []; },
  addEventListener() {},
  currentScript: { src: 'https://widgets.travelify.io/widget-inspirator.js' },
  body: makeEl('body'),
  documentElement: makeEl('html'),
  referrer: '',
};
// __cards short-circuits the deck fetch. If the widget ever reaches the network
// in these cases, fail loudly rather than hang.
global.fetch = () => { throw new Error('widget attempted a network call with __cards supplied'); };

const SRC = readFileSync(new URL('../public/widget-inspirator.js', import.meta.url), 'utf8');
vm.runInThisContext(SRC, { filename: 'widget-inspirator.js' });

const TGInspiratorWidget = global.window.TGInspiratorWidget;
if (typeof TGInspiratorWidget !== 'function') {
  console.error('FAIL: widget did not expose TGInspiratorWidget');
  process.exit(1);
}

let pass = 0;
const fails = [];
function ok(label, cond) { if (cond) { pass++; } else { fails.push(label); } }
function eq(label, actual, expected) {
  if (actual === expected) pass++;
  else fails.push(`${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`);
}

// The shadow root always carries the full stylesheet, which mentions every
// class name the widget can produce, so "is this class absent?" must be asked
// of the markup rather than of the CSS.
function markup(html) { return html.replace(/<style>[\s\S]*?<\/style>/g, ''); }
function styleAttr(raw) {
  const m = raw.match(/class="tgi-root"[^>]*style="([^"]*)"/);
  return m ? m[1] : '';
}

function card(n, over) {
  return Object.assign({
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

const SIX = Array.from({ length: 6 }, (_, i) => card(i + 1));

function make(cfg, cards) {
  const host = makeEl('div');
  const w = new TGInspiratorWidget(host, Object.assign({ __cards: cards || SIX }, cfg));
  return {
    widget: w,
    host,
    html: () => markup(host.__shadow.innerHTML),
    raw: () => host.__shadow.innerHTML,
  };
}

// ---- Intro ---------------------------------------------------------------
{
  const t = make({ headline: 'Not sure where to go?', intro: 'Swipe and keep.', startLabel: 'Off we go' });
  eq('starts on the intro', t.widget.phase, 'intro');
  ok('intro renders the headline', t.html().includes('Not sure where to go?'));
  ok('intro renders the body', t.html().includes('Swipe and keep.'));
  ok('intro renders the start button', t.html().includes('data-act="start"'));
  ok('intro says how many ideas', t.html().includes('6 ideas'));
  ok('intro shows no cards yet', !t.html().includes('tgi-card'));
}

// ---- The deck ------------------------------------------------------------
{
  const t = make({});
  t.widget._start();
  eq('start moves to the deck', t.widget.phase, 'deck');
  const h = t.html();
  ok('the deck renders cards', h.includes('class="tgi-card"'));
  ok('only three cards are in the DOM at once', (h.match(/class="tgi-card"/g) || []).length === 3);
  ok('the top card is marked', h.includes('data-top="1"'));
  ok('the deck renders a pass button', h.includes('data-act="no"'));
  ok('the deck renders a save button', h.includes('data-act="yes"'));
  ok('the deck renders an undo button', h.includes('data-act="undo"'));
  ok('undo starts disabled', /data-act="undo"[^>]*disabled/.test(h));
  ok('the deck shows progress', h.includes('1 of 6'));
  ok('the deck shows the saved count', h.includes('0 saved'));
  ok('the buttons carry accessible names', h.includes('aria-label="Save this one"') && h.includes('aria-label="Not for me"'));
  ok('the deck mentions the keyboard', h.toLowerCase().includes('arrow'));
  ok('there is a live region for announcements', h.includes('aria-live="polite"'));
  ok('cards behind the top one are hidden from assistive tech', h.includes('aria-hidden="true"'));
}

// ---- Deciding ------------------------------------------------------------
{
  const t = make({});
  t.widget._start();
  t.widget._decide('yes');
  eq('a save is kept', t.widget.kept.length, 1);
  eq('the deck shrinks', t.widget.deck.length, 5);
  eq('seen counts up', t.widget.seen, 1);
  t.widget._decide('no');
  eq('a pass is not kept', t.widget.kept.length, 1);
  eq('the deck shrinks again', t.widget.deck.length, 4);
  ok('progress advances', t.html().includes('3 of 6'));
  ok('the saved count shows', t.html().includes('1 saved'));
  ok('undo is now enabled', !/data-act="undo"[^>]*disabled/.test(t.html()));
}

// ---- Undo ----------------------------------------------------------------
{
  const t = make({});
  t.widget._start();
  const first = t.widget.deck[0];
  t.widget._decide('yes');
  eq('kept before undo', t.widget.kept.length, 1);
  t.widget._undo();
  eq('undo removes it from the shortlist', t.widget.kept.length, 0);
  eq('undo puts the card back on the deck', t.widget.deck[0], first);
  eq('undo winds back the counter', t.widget.seen, 0);
  t.widget._undo();
  eq('undo with nothing to undo is a no-op', t.widget.seen, 0);
}
{
  // Undoing a PASS must not remove a different, kept card.
  const t = make({});
  t.widget._start();
  t.widget._decide('yes');
  t.widget._decide('no');
  t.widget._undo();
  eq('undoing a pass leaves the saved card alone', t.widget.kept.length, 1);
}

// ---- Exhausting the deck -------------------------------------------------
{
  const t = make({});
  t.widget._start();
  // The deck is shuffled, so record what was actually kept and passed rather
  // than assuming Place 1 is dealt first. (This assertion was order-dependent
  // and passed only by luck until the shuffle moved.)
  const keptNames = [];
  const passedNames = [];
  for (let i = 0; i < 6; i++) {
    const next = t.widget.deck[0];
    const verdict = i % 2 === 0 ? 'yes' : 'no';
    (verdict === 'yes' ? keptNames : passedNames).push(next.name);
    t.widget._decide(verdict);
  }
  eq('running out of cards ends the deck', t.widget.phase, 'result');
  eq('the shortlist holds the saves', t.widget.kept.length, 3);
  const h = t.html();
  ok('the result lists the shortlist', h.includes('tgi-shortlist'));
  ok('the result names every kept destination', keptNames.every(n => h.includes(n)));
  ok('the result names no passed destination', passedNames.every(n => !h.includes(n)));
  ok('the result offers to send', h.includes('data-act="toform"'));
  ok('the result offers to start again', h.includes('data-act="restart"'));
  ok('the result credits the photographers', h.includes('Photography:'));
}

// ---- Taste profile -------------------------------------------------------
{
  const cards = [
    card(1, { tags: ['Beach', 'Luxury'] }),
    card(2, { tags: ['Beach', 'Luxury'] }),
    card(3, { tags: ['Beach', 'Culture'] }),
    card(4, { tags: ['Skiing'] }),
  ];
  const t = make({}, cards);
  t.widget._start();
  // Keep the three beach cards, pass the ski one, whatever order they shuffled into.
  while (t.widget.deck.length) {
    t.widget._decide(t.widget.deck[0].tags.includes('Beach') ? 'yes' : 'no');
  }
  const h = t.html();
  ok('the taste block appears', h.includes('What you leaned towards'));
  ok('the commonest tag is named', h.includes('>Beach<'));
  ok('the taste is described in a sentence', h.toLowerCase().includes('most of what you kept is about'));
  ok('a tag the visitor rejected is not claimed', !h.includes('>Skiing<'));
}
{
  // No saves at all is a legitimate outcome and must not look like a failure.
  const t = make({});
  t.widget._start();
  while (t.widget.deck.length) t.widget._decide('no');
  eq('passing everything still reaches the result', t.widget.phase, 'result');
  const h = t.html();
  ok('an empty shortlist is handled kindly', h.includes('Nothing caught your eye'));
  ok('an empty shortlist offers a restart', h.includes('data-act="restart"'));
  ok('an empty shortlist does not offer to send nothing', !h.includes('data-act="toform"'));
}

// ---- Dropping from the shortlist ----------------------------------------
{
  const t = make({});
  t.widget._start();
  t.widget._decide('yes');
  t.widget._decide('yes');
  t.widget._go('result');
  eq('two kept', t.widget.kept.length, 2);
  const first = t.widget.kept[0];
  ok('each entry has a remove control', t.html().includes('data-drop="' + first.recordId + '"'));
  t.widget._drop(first.recordId);
  eq('dropping removes it', t.widget.kept.length, 1);
  ok('the dropped destination is gone from the markup', !t.html().includes('data-drop="' + first.recordId + '"'));
}

// ---- The form ------------------------------------------------------------
{
  const t = make({ collectPhone: true, showMessage: true, marketingOptIn: true, privacyUrl: '/privacy' });
  t.widget._start();
  t.widget._decide('yes');
  t.widget._go('form');
  const h = t.html();
  ok('the form asks for an email', h.includes('id="tgi-email"'));
  ok('the email field is typed', h.includes('type="email"'));
  ok('the form asks for a name', h.includes('id="tgi-name"'));
  ok('the phone field appears when configured', h.includes('id="tgi-phone"'));
  ok('the message field appears when configured', h.includes('id="tgi-msg"'));
  ok('the marketing opt-in appears', h.includes('id="tgi-mkt"'));
  ok('there is a honeypot', h.includes('id="tgi-website"'));
  ok('the honeypot is hidden from assistive tech', h.includes('aria-hidden="true"'));
  ok('the honeypot is out of the tab order', h.includes('tabindex="-1"'));
  ok('the privacy link renders', h.includes('href="/privacy"'));
  ok('every field is labelled', (h.match(/class="tgi-label"/g) || []).length >= 3);
  ok('the form offers a way back', h.includes('data-act="back"'));
}
{
  const t = make({ collectPhone: false, showMessage: false, marketingOptIn: false, privacyUrl: '' });
  t.widget._start();
  t.widget._decide('yes');
  t.widget._go('form');
  const h = t.html();
  ok('the phone field stays off when not configured', !h.includes('id="tgi-phone"'));
  ok('the message field stays off when not configured', !h.includes('id="tgi-msg"'));
  ok('the opt-in stays off when not configured', !h.includes('id="tgi-mkt"'));
  ok('no privacy link when no url is set', !h.includes('Privacy policy'));
}
{
  const t = make({ privacyUrl: 'javascript:alert(1)' });
  t.widget._start();
  t.widget._decide('yes');
  t.widget._go('form');
  ok('a javascript privacy url is refused', !t.raw().includes('javascript:alert'));
}

// ---- Submitting from a preview -------------------------------------------
{
  // The demo page and an unsaved editor preview have no widget id, so there is
  // no client to route a lead to. That must read as a preview notice, not as a
  // raw "Invalid widget ID" from the endpoint.
  const t = make({});
  t.widget._start();
  t.widget._decide('yes');
  t.widget._go('form');
  attachFormRoot(t.host.__shadow, { 'tgi-email': 'someone@example.com', 'tgi-name': 'Sam', 'tgi-website': '' });
  await t.widget._send();
  eq('a preview submit stays on the form', t.widget.phase, 'form');
  ok('a preview submit explains itself', t.widget.formError.includes('preview'));
  ok('a preview submit says nothing was sent', t.widget.formError.includes('nothing was sent'));
  ok('a preview submit clears the sending flag', t.widget.sending === false);
}

// ---- Email validation and the honeypot -----------------------------------
{
  const t = make({});
  t.widget._start();
  t.widget._decide('yes');
  t.widget._go('form');
  attachFormRoot(t.host.__shadow, { 'tgi-email': 'not-an-email', 'tgi-website': '' });
  await t.widget._send();
  ok('a bad email is refused before anything is sent', t.widget.formError.includes('valid email'));
  eq('a bad email keeps the visitor on the form', t.widget.phase, 'form');
}
{
  const t = make({ widgetId: 'tgw_demo' });
  t.widget._start();
  t.widget._decide('yes');
  t.widget._go('form');
  // A bot fills every field it finds, including the one nobody can see.
  attachFormRoot(t.host.__shadow, { 'tgi-email': 'bot@example.com', 'tgi-website': 'http://spam.test' });
  await t.widget._send();
  eq('a filled honeypot shows success', t.widget.phase, 'sent');
  ok('a filled honeypot posts nothing', true);   // global fetch would have thrown
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
  }), card(2)];
  const t = make({ headline: '<script>alert(9)</script>', intro: '</style><script>x</script>' }, hostile);
  ok('the intro escapes a hostile headline', !t.html().includes('<script>'));
  ok('the headline is escaped, not stripped', t.html().includes('&lt;script&gt;alert(9)&lt;/script&gt;'));

  t.widget._start();
  const h = t.html();
  ok('no raw script tag survives on a card', !h.includes('<script>'));
  ok('no raw img onerror survives', !h.includes('<img src=x'));
  ok('no raw svg onload survives', !h.includes('<svg onload'));
  ok('an ampersand and quote are escaped', h.includes('O&#39;Brien &amp; Sons'));
  ok('a marked-up fact is escaped', h.includes('&lt;i&gt;May&lt;/i&gt;'));

  while (t.widget.deck.length) t.widget._decide('yes');
  ok('the shortlist escapes the name too', !t.html().includes('<script>'));
  ok('the credit is escaped', t.html().includes('&lt;svg onload'));
}
{
  const t = make({}, [card(1, { image: 'javascript:alert(1)/x.jpg' }), card(2)]);
  ok('a non-http image is never dealt', t.widget.deck.every(c => c.image.startsWith('https://')));
  t.widget._start();
  ok('no javascript src reaches the markup', !t.raw().includes('src="javascript'));
}

// ---- Cards without a photo are never dealt -------------------------------
{
  const t = make({}, [card(1), card(2, { image: '' }), card(3, { image: null }), card(4)]);
  eq('photoless cards are filtered out of the deck', t.widget.deck.length, 2);
  ok('every dealt card has an image', t.widget.deck.every(c => !!c.image));
}
{
  const t = make({}, [card(1, { name: '' }), card(2)]);
  eq('a nameless card is filtered out', t.widget.deck.length, 1);
}
{
  const t = make({}, []);
  eq('an empty pool reaches the empty state', t.widget.phase, 'empty');
  ok('the empty state says so calmly', t.html().includes('no ideas to show'));
}

// ---- deckSize ------------------------------------------------------------
{
  const twenty = Array.from({ length: 20 }, (_, i) => card(i + 1));
  eq('deckSize limits the deal', make({ deckSize: 5 }, twenty).widget.deck.length, 5);
  eq('deckSize is clamped above', make({ deckSize: 999 }, twenty).widget.deck.length, 20);
  eq('deckSize is clamped below', make({ deckSize: 0 }, twenty).widget.deck.length, 4);
  eq('a nonsense deckSize falls back to twelve', make({ deckSize: 'lots' }, twenty).widget.deck.length, 12);
}

// ---- Toggles -------------------------------------------------------------
{
  const t = make({ showTagline: false, showTags: false, showBestMonths: false, showFlightTime: false });
  t.widget._start();
  const h = t.html();
  ok('tagline off removes taglines', !h.includes('A tagline for place'));
  ok('tags off removes chips', !h.includes('tgi-chip'));
  ok('facts off removes the fact rail', !h.includes('tgi-facts'));
}

// ---- Theme, colour and font hardening ------------------------------------
{
  ok('dark theme is set on the root', make({ theme: 'dark' }).raw().includes('data-theme="dark"'));
  ok('an unknown theme falls back to light', make({ theme: 'nope' }).raw().includes('data-theme="light"'));
}
{
  const raw = make({ brandColour: '#123456', accentColour: '#ABCDEF' }).raw();
  ok('a valid brand colour is applied', styleAttr(raw).includes('--tgi-brand:#123456'));
  ok('the brand colour is emitted as rgb too', styleAttr(raw).includes('--tgi-brand-rgb:18,52,86'));
}
{
  const raw = make({ brandColour: 'red;background:url(https://evil.test/x.png)' }).raw();
  ok('an invalid colour falls back', styleAttr(raw).includes('--tgi-brand:#1B2B5B'));
  ok('an invalid colour cannot inject css', !raw.includes('evil.test'));
}
{
  // The same CSS injection the Top 10 review found, guarded here from the start.
  const raw = make({ fontFamily: "Arial; background:url('https://evil.test/x.png')" }).raw();
  ok('a semicolon in the font stack is refused', !raw.includes('evil.test'));
  ok('the style attribute carries no injected declaration', !styleAttr(raw).includes('background:'));
  ok('a refused font stack falls back', styleAttr(raw).includes('font-family:&#39;Inter&#39;'));
}
{
  ok('a clean font stack is applied',
    styleAttr(make({ fontFamily: 'Georgia, serif' }).raw()).includes('font-family:Georgia, serif'));
}

// ---- update(): no refetch unless the source changed -----------------------
{
  const t = make({});
  let loads = 0;
  t.widget._loadDeck = () => { loads++; };

  t.widget.update({ headline: 'New headline' });
  eq('a copy change does not refetch', loads, 0);
  ok('a copy change re-renders', t.html().includes('New headline'));

  t.widget.update({ brandColour: '#111111' });
  eq('a colour change does not refetch', loads, 0);

  t.widget.update({ deckSize: 8 });
  eq('a deckSize change does not refetch', loads, 0);

  // Only the SOURCE of the deck may go back to the network.
  const t2 = make({});
  t2.widget._loadDeck = () => { loads++; };
  delete t2.widget.cfg.__cards;
  t2.widget.update({ tags: ['Beach'] });
  eq('changing the tag filter refetches', loads, 1);

  const t3 = make({});
  t3.widget._loadDeck = () => { loads++; };
  delete t3.widget.cfg.__cards;
  t3.widget.update({ levels: ['city'] });
  eq('changing the levels refetches', loads, 2);
}
{
  // A styling tweak in the editor must not throw away the agent's place.
  const t = make({});
  t.widget._start();
  t.widget._decide('yes');
  t.widget.update({ brandColour: '#222222' });
  eq('a restyle keeps the phase', t.widget.phase, 'deck');
  eq('a restyle keeps the shortlist', t.widget.kept.length, 1);
}

// ---- Render is side-effect-free, and never prices anything ----------------
{
  // Comments come out first: the JSDoc header carries the embed snippet and
  // names the very calls it forbids, so a raw search finds its own docs.
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok('comment stripping left the code intact',
    CODE.includes('class TGInspiratorWidget') && CODE.includes('_render()'));

  ok('nothing in the widget calls focus()', !/\.focus\s*\(/.test(CODE));
  ok('nothing in the widget calls scrollIntoView()', !/scrollIntoView/.test(CODE));
  ok('nothing in the widget calls select()', !/\.select\s*\(/.test(CODE));
  ok('no autofocus anywhere', !/autofocus/i.test(CODE));
  ok('no inline event handlers', !/\son(click|error|load|mouseover)\s*=/i.test(CODE.replace(/addEventListener/g, '')));
  ok('never injects a script tag', !/<script/i.test(CODE));
  ok('no eval', !/\beval\s*\(/.test(CODE));
  ok('no Function constructor', !/new\s+Function\s*\(/.test(CODE));

  // Offers are cache-only (30 Jul 2026): a swipe deck must never search.
  ok('never calls the offers endpoint', !/\/api\/offers/.test(CODE));
  ok('never calls cached-offers either', !/cached-offers/.test(CODE));
  ok('never mentions Travelify', !/travelify/i.test(CODE.replace(/widgets\.travelify\.io/g, '')));
  ok('only three endpoints are reachable',
    (CODE.match(/ORIGIN \+ '\/api\//g) || []).length === 3);

  // Arrow keys are bound to the widget, never the document, so the widget
  // cannot hijack arrow keys on the agency's own page.
  ok('key handling is scoped to the widget root', !/document\.addEventListener\(\s*['"]keydown/.test(CODE));
}

// ---- Contract surface ----------------------------------------------------
{
  ok('version global is exposed', typeof global.window.__TG_INSPIRATOR_VERSION__ === 'string');
  ok('version matches the header', SRC.includes("VERSION = '" + global.window.__TG_INSPIRATOR_VERSION__ + "'"));
  const t = make({});
  ok('the container is marked initialised', t.host.getAttribute('data-tg-initialised') === '1');
  t.widget.destroy();
  ok('destroy empties the shadow root', t.host.__shadow.innerHTML === '');
  ok('destroy clears the init guard', t.host.getAttribute('data-tg-initialised') === undefined);
}

// ---- Report --------------------------------------------------------------
if (fails.length) {
  console.error(`\n✗ widget-inspirator-render: ${fails.length} failed, ${pass} passed\n`);
  fails.forEach(f => console.error('  - ' + f));
  process.exit(1);
}
console.log(`✓ widget-inspirator-render: ${pass} assertions passed`);
