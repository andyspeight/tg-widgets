/**
 * Building the confirmation email out of blocks, in the editor (16 Sep 2026).
 *
 * Andy: "I want the email set up / editor to be very flexible so that the user
 * can create their own email layout, and just add the data blocks with the
 * booking information."
 *
 * The layout builder is a new field type on the SHARED email popup
 * (public/editor-email-popup.js), so every editor gets it rather than My
 * Booking growing a private one — the same reason the popup itself was made
 * shared after four copies of it had drifted.
 *
 * This suite drives the REAL popup in jsdom with the REAL block palette and
 * the REAL renderer behind the preview, because the thing being claimed is
 * that a client can arrange their own email and see what they will send. The
 * editor page itself boots through cookie SSO inside an inline module, so the
 * checks on editor-mybooking.html are source guards.
 *
 * The tag check is deliberately functional rather than a list comparison: we
 * render a block containing every chip the editor offers and assert none of
 * them survives unfilled. A chip the renderer does not know would otherwise
 * reach a customer printed as "{whatever}".
 *
 * Run: node test/confirmation-layout-editor-smoke.mjs  (npm run test:confirmation-layout)
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { renderBookingEmail, EMAIL_BLOCKS, EMAIL_STYLES, DEFAULT_EMAIL_LAYOUT } from '../public/_booking-email-template.js';

const POPUP = readFileSync(new URL('../public/editor-email-popup.js', import.meta.url), 'utf8');
const EDITOR = readFileSync(new URL('../public/editor-mybooking.html', import.meta.url), 'utf8');

let passed = 0, failed = 0;
const ok = (label, cond, detail) => {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.error('  ✗ ' + label + (detail ? '\n      ' + detail : '')); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ORDER = {
  id: 24189, status: 'Confirmed', bookingReference: 'ST-24189',
  customerTitle: 'Ms', customerFirstname: 'Sarah', customerSurname: 'Nolan',
  customerEmail: 'sarah@example.com', created: '2026-05-02T00:00:00', currency: 'GBP',
  summary: { totalPrice: 2050, hasAccommodation: true, earliestStart: '2027-02-03T00:00:00',
    travellers: [{ type: 'Lead', title: 'Ms', firstname: 'Sarah', surname: 'Nolan' }] },
  payments: [{ amount: 850, date: '2026-05-02T00:00:00', status: 'Success' }],
  items: [
    { id: 1, status: 'Confirmed', product: 'Accommodation', bookingReference: 'ST-24189',
      price: 1400, currency: 'GBP', startDate: '2027-02-03T00:00:00', duration: 7,
      accommodation: { name: 'Jumeirah Beach Hotel', propertyType: 'Hotel', rating: 5,
        location: { address1: 'Jumeirah St', city: 'Dubai', country: 'UAE' },
        units: [{ name: 'Ocean Room', roomType: 'Ocean Room', checkin: '2027-02-03T00:00:00',
          nights: 7, rates: [{ board: 'BedAndBreakfast' }], sleepsAdults: 2, sleepsChildren: 0 }],
        pricing: { price: 1400, currency: 'GBP', isRefundable: true },
        guests: [{ type: 'Lead', title: 'Ms', firstname: 'Sarah', surname: 'Nolan' }],
        media: [{ type: 'GenericImage', url: 'https://static.travelify.io/hotels/jumeirah-1.jpg', caption: 'Ocean room' }] } },
    { id: 2, status: 'Confirmed', product: 'Flights', bookingReference: 'EK7781',
      price: 650, currency: 'GBP', startDate: '2027-02-03T00:00:00',
      flights: { routes: [{ direction: 'Outbound', segments: [{
        depart: '2027-02-03T10:15:00', arrive: '2027-02-03T20:40:00',
        origin: { iataCode: 'LGW' }, destination: { iataCode: 'DXB' },
        carrier: { name: 'Emirates' }, flightNumber: 'EK16' }] }] } },
  ],
};

/** The editor page, with the real popup script on it. */
function page() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>',
    { runScripts: 'outside-only', url: 'https://widgets.travelify.io/editor-mybooking', pretendToBeVisual: true });
  const { window } = dom;
  window.requestAnimationFrame = (cb) => window.setTimeout(() => cb(0), 0);
  window.eval(POPUP);
  return window;
}

/** Open the popup on a confirmation email whose layout starts as `layout`. */
function openBuilder(window, layout = []) {
  const store = { layout: layout.map((b) => ({ ...b })) };
  const confirmedWith = [];
  let changes = 0;
  const handle = window.TGEmailPopup.open({
    startKey: 'confirmation',
    onChange: () => { changes++; },
    emails: [{
      key: 'confirmation', label: 'Booking confirmation', tabLabel: 'Confirmation',
      from: () => 'Sunrise Travel', to: 'sarah@example.com (sample booking)',
      tags: TAGS,
      fields: [{ key: 'layout', type: 'blocks', label: 'What goes in the email, in order',
        palette: EMAIL_BLOCKS,
        styles: EMAIL_STYLES,
        // The real editor hands the picker its own modal; here we accept
        // immediately so the test drives the apply path rather than a dialog.
        confirmStyle: (style, apply) => { confirmedWith.push(style.id); apply(); },
        reset: { label: 'Copy our standard layout in, so I can change it',
          run: (applied) => { store.layout = DEFAULT_EMAIL_LAYOUT.map((b) => ({ type: b.type })); applied(store.layout); } } }],
      read: () => ({ layout: store.layout }),
      write: (key, value) => { if (key === 'layout') store.layout = value; },
      render: (v) => {
        const out = renderBookingEmail({
          order: ORDER, brand: { name: 'Sunrise Travel' }, colors: {},
          supportEmail: 'hi@sunrise.example', supportPhone: '01202 111222',
          layout: (v.layout && v.layout.length) ? v.layout : undefined,
        });
        return { subject: out.subject, html: out.html, note: '' };
      },
    }],
  });
  return { store, handle, changes: () => changes, confirmedWith };
}

// The chips the My Booking editor really offers, read out of the editor source
// so this cannot drift from what a client sees.
const TAGS = (() => {
  const src = EDITOR.slice(EDITOR.indexOf('const CONF_TAGS = ['));
  const body = src.slice(0, src.indexOf('];') + 2);
  return [...body.matchAll(/tag:\s*'(\{[a-zA-Z]+\})',\s*label:\s*'([^']+)'/g)]
    .map((m) => ({ tag: m[1], label: m[2] }));
})();

const rows = (window) => [...window.document.querySelectorAll('.tgep-block')]
  .filter((r) => !r.classList.contains('is-empty'));
const names = (window) => rows(window).map((r) => r.querySelector('.tgep-block-name').textContent);
const preview = (window) => {
  const f = window.document.querySelector('.tgep-modal iframe');
  return f ? (f.getAttribute('srcdoc') || f.srcdoc || '') : '';
};
const btn = (window, i, label) => [...rows(window)[i].querySelectorAll('.tgep-bbtn')]
  .find((b) => b.textContent === label);
const click = async (el) => { el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true })); await sleep(20); };

console.log('The editor offers the blocks the renderer can actually draw');
{
  ok('the chips were found in the editor source', TAGS.length >= 10, String(TAGS.length));
  const every = TAGS.map((t) => t.tag).join(' | ');
  const html = renderBookingEmail({
    order: ORDER, brand: { name: 'Sunrise Travel' },
    supportEmail: 'hi@sunrise.example', supportPhone: '01202 111222',
    layout: [{ type: 'text', text: every }],
  }).html;
  const unfilled = TAGS.map((t) => t.tag).filter((tag) => html.includes(tag));
  ok('every chip the editor offers is one the renderer fills', unfilled.length === 0, unfilled.join(', '));
  ok('the editor takes its palette and its styles from the renderer, not a list of its own',
    /import \{[^}]*\bEMAIL_BLOCKS\b[^}]*\} from '\/_booking-email-template\.js'/.test(EDITOR)
    && /import \{[^}]*\bEMAIL_STYLES\b[^}]*\} from '\/_booking-email-template\.js'/.test(EDITOR)
    && /palette: EMAIL_BLOCKS/.test(EDITOR)
    && /styles: EMAIL_STYLES/.test(EDITOR)
    && !/EMAIL_BLOCKS\s*=\s*\[/.test(EDITOR));
  ok('the confirmation sits with the other customer emails',
    /const REM_ORDER = \['confirmation', 'interim', 'final', 'cancellation'\]/.test(EDITOR)
    && /rem-status-confirmation/.test(EDITOR));
  ok('and the Email tab preview honours the same layout',
    /layout: state\.config\.confirmationEmail\?\.layout,/.test(EDITOR));
}

console.log('An empty layout opens on our standard one');
{
  const window = page();
  const { store } = openBuilder(window, []);
  await sleep(30);
  ok('the list starts empty', rows(window).length === 0);
  ok('and says so rather than looking broken',
    /No blocks yet/.test(window.document.querySelector('.tgep-block.is-empty').textContent));
  ok('the preview is our standard email', /Have a wonderful trip/.test(preview(window))
    && /Jumeirah Beach Hotel/.test(preview(window)));
  ok('nothing was written to the config just by opening it', store.layout.length === 0);
}

console.log('Adding a block puts it in the email');
{
  const window = page();
  const { store } = openBuilder(window, []);
  await sleep(30);
  const sel = window.document.querySelector('.tgep-add select');
  const add = window.document.querySelector('.tgep-add button');
  ok('the palette is grouped into booking information and your own content',
    [...sel.querySelectorAll('optgroup')].map((g) => g.label).join(' / ')
      === 'Booking information / Your own content');
  ok('every palette entry is offered', sel.querySelectorAll('option').length === EMAIL_BLOCKS.length);

  sel.value = 'greeting'; await click(add);
  sel.value = 'flights'; await click(add);
  ok('both blocks are in the list', names(window).join(', ') === 'Greeting, Flights', names(window).join(', '));
  ok('they were saved', store.layout.map((b) => b.type).join(',') === 'greeting,flights');
  ok('a block that fills itself says so',
    rows(window)[1].querySelector('.tgep-block-kind').textContent === 'From the booking');
  ok('the preview is now just those two', /Hi Sarah,/.test(preview(window))
    && /LGW 10:15/.test(preview(window)) && !/Have a wonderful trip/.test(preview(window)));
}

console.log('Up, down and remove rearrange the email');
{
  const window = page();
  const { store } = openBuilder(window, [{ type: 'greeting' }, { type: 'flights' }, { type: 'signoff' }]);
  await sleep(30);
  ok('it opened on the saved layout', names(window).join(', ') === 'Greeting, Flights, Sign off');
  ok('the first block cannot move up', btn(window, 0, '↑').disabled);
  ok('the last cannot move down', btn(window, 2, '↓').disabled);

  await click(btn(window, 2, '↑'));
  ok('the sign off moved above the flights', names(window).join(', ') === 'Greeting, Sign off, Flights');
  ok('and the email followed',
    preview(window).indexOf('Have a wonderful trip') < preview(window).indexOf('LGW 10:15'));

  await click(btn(window, 0, '↓'));
  ok('moving down works too', names(window).join(', ') === 'Sign off, Greeting, Flights');

  await click(btn(window, 2, '✕'));
  ok('removing takes it out of the list', names(window).join(', ') === 'Sign off, Greeting');
  ok('and out of the email', !/LGW 10:15/.test(preview(window)));
  ok('the config matches what is on screen', store.layout.map((b) => b.type).join(',') === 'signoff,greeting');
}

console.log('A block the client writes carries its own words');
{
  const window = page();
  const { store, changes } = openBuilder(window, [{ type: 'text' }]);
  await sleep(30);
  const field = rows(window)[0].querySelector('textarea');
  ok('a text block gets a message box', !!field);
  field.value = 'Hello {firstName}, your {nights} nights in {destination} are booked.';
  field.dispatchEvent(new window.Event('input', { bubbles: true }));
  await sleep(30);
  ok('what was typed is saved on the block', store.layout[0].text.startsWith('Hello {firstName}'));
  ok('the editor was told something changed', changes() > 0);
  ok('and the preview shows it filled in',
    /Hello Sarah, your 7 nights in Dubai, UAE are booked\./.test(preview(window)));

  const sel = window.document.querySelector('.tgep-add select');
  sel.value = 'button';
  await click(window.document.querySelector('.tgep-add button'));
  const inputs = rows(window)[1].querySelectorAll('input');
  ok('a button block asks for the words and the link', inputs.length === 2);
  inputs[0].value = 'View my booking';
  inputs[0].dispatchEvent(new window.Event('input', { bubbles: true }));
  inputs[1].value = 'https://sunrise.example/my-booking';
  inputs[1].dispatchEvent(new window.Event('input', { bubbles: true }));
  await sleep(30);
  ok('the button is in the email', /href="https:\/\/sunrise\.example\/my-booking"/.test(preview(window)));
  ok('a data block gets no fields to fill in',
    rows(window)[0].querySelectorAll('textarea').length === 1
    && !EMAIL_BLOCKS.find((b) => b.type === 'greeting').fields);
}

console.log('The merge-tag chips reach the blocks the client writes');
{
  // Found in a real browser: the chips are declared on the email but were only
  // drawn under a field that asked for them, and the layout builder has no such
  // field — so a client could not click a tag in at all. Then, drawn BELOW the
  // list, they were painted over by it.
  const window = page();
  const { store } = openBuilder(window, [{ type: 'text', text: 'Hello ' }]);
  await sleep(30);
  const chips = [...window.document.querySelectorAll('.tgep-tag')];
  ok('the chips are on screen', chips.length === TAGS.length, String(chips.length));
  const wrap = window.document.querySelector('.tgep-field');
  const chipRow = wrap.querySelector('.tgep-tags');
  const list = wrap.querySelector('.tgep-blocks');
  ok('above the list, not under it',
    !!chipRow && !!list && (chipRow.compareDocumentPosition(list) & window.Node.DOCUMENT_POSITION_FOLLOWING) !== 0);
  ok('the list does not claim the whole pane, which is what painted over them',
    !wrap.classList.contains('is-grow'));

  const field = rows(window)[0].querySelector('textarea');
  field.focus();
  field.dispatchEvent(new window.Event('focus', { bubbles: true }));
  field.selectionStart = field.selectionEnd = field.value.length;
  const ref = chips.find((c) => c.getAttribute('data-tag') === '{bookingRef}');
  await click(ref);
  ok('clicking one drops it in where the client was writing',
    field.value === 'Hello {bookingRef}', field.value);
  ok('and it is saved', String(store.layout[0].text) === 'Hello {bookingRef}');
  ok('and the preview shows it filled in', /Hello ST-24189/.test(preview(window)));
}

console.log('Starting from our layout gives an editable copy');
{
  const window = page();
  const { store } = openBuilder(window, [{ type: 'divider' }]);
  await sleep(30);
  const back = window.document.querySelector('.tgep-blocks-reset');
  ok('the link is offered', !!back && /Copy our standard layout in/.test(back.textContent));
  await click(back);
  ok('the list is now our standard layout',
    store.layout.map((b) => b.type).join(',') === DEFAULT_EMAIL_LAYOUT.map((b) => b.type).join(','));
  ok('and it is shown as blocks they can move', rows(window).length === DEFAULT_EMAIL_LAYOUT.length);
  ok('the email it produces is our standard email',
    /Hi Sarah,/.test(preview(window)) && /Have a wonderful trip/.test(preview(window)));
  ok('the builder link does not restyle the other emails\' reset link',
    !/\.tgep-reset \{ background:none/.test(readFileSync(new URL('../public/editor-email-popup.js', import.meta.url), 'utf8')));
}

console.log('Starting from one of the four styles');
{
  const window = page();
  const { store, confirmedWith } = openBuilder(window, []);
  await sleep(30);
  const buttons = [...window.document.querySelectorAll('.tgep-style')];
  ok('all four are offered, by name',
    buttons.map((b) => b.textContent).join(',') === EMAIL_STYLES.map((s) => s.label).join(','),
    buttons.map((b) => b.textContent).join(','));
  ok('the picker sits above the list, not below it',
    !!window.document.querySelector('.tgep-styles')
    && window.document.querySelector('.tgep-styles').compareDocumentPosition(
      window.document.querySelector('.tgep-blocks')) & 4);

  // Nothing to lose yet, so picking just happens.
  const postcard = buttons[EMAIL_STYLES.findIndex((s) => s.id === 'postcard')];
  await click(postcard);
  ok('picking one with an empty list does not stop to ask', confirmedWith.length === 0);
  ok('the list is now that style',
    store.layout.map((b) => b.type).join(',')
      === EMAIL_STYLES.find((s) => s.id === 'postcard').layout.map((b) => b.type).join(','));
  ok('and it is shown as blocks they can move',
    rows(window).length === EMAIL_STYLES.find((s) => s.id === 'postcard').layout.length);
  ok('the email it produces opens on the picture',
    /You are going to/.test(preview(window)));

  // Now there IS something to lose, so it asks first.
  const magazine = buttons[EMAIL_STYLES.findIndex((s) => s.id === 'magazine')];
  await click(magazine);
  ok('picking another asks before replacing what they have',
    confirmedWith.join(',') === 'magazine', confirmedWith.join(','));
  ok('and having been told yes, it replaces it',
    store.layout.map((b) => b.type).join(',')
      === EMAIL_STYLES.find((s) => s.id === 'magazine').layout.map((b) => b.type).join(','));

  // A style is a starting point, not a mode: it must stay editable afterwards.
  const firstRemove = window.document.querySelector('.tgep-block .tgep-bbtn.is-del');
  ok('the blocks a style put in can be removed like any other', !!firstRemove);
  if (firstRemove) {
    const before = store.layout.length;
    await click(firstRemove);
    ok('and removing one really removes it', store.layout.length === before - 1);
  }
}

console.log('Declining leaves the layout alone');
{
  const window = page();
  const store = { layout: [{ type: 'divider' }] };
  window.TGEmailPopup.open({
    startKey: 'confirmation',
    emails: [{
      key: 'confirmation', label: 'Booking confirmation', tabLabel: 'Confirmation',
      from: () => 'Sunrise Travel', to: 'sarah@example.com', tags: TAGS,
      fields: [{ key: 'layout', type: 'blocks', label: 'What goes in the email, in order',
        palette: EMAIL_BLOCKS, styles: EMAIL_STYLES,
        // The client said no.
        confirmStyle: () => {} }],
      read: () => ({ layout: store.layout }),
      write: (key, value) => { if (key === 'layout') store.layout = value; },
      render: () => ({ subject: '', html: '', note: '' }),
    }],
  });
  await sleep(30);
  await click(window.document.querySelectorAll('.tgep-style')[1]);
  ok('a style they did not confirm is not applied',
    store.layout.map((b) => b.type).join(',') === 'divider');
}

console.log('The editor page wires the picker to its own modal');
{
  ok('it passes the styles through', /styles: EMAIL_STYLES/.test(EDITOR));
  ok('and confirms with its own dialog rather than the browser\'s',
    /confirmStyle: \(style, apply\) =>/.test(EDITOR) && /showConfirm\('Start from '/.test(EDITOR));
  ok('the popup falls back to a plain confirm when a caller offers no modal',
    /window\.confirm\(/.test(POPUP));
  ok('picking a style marks the editor dirty, so Save lights up',
    /confirmStyle:[\s\S]{0,300}remMarkDirty\(\)/.test(EDITOR));
  // Standard IS the built-in layout, so a second "copy ours in" link beside the
  // picker would be two ways to the same place.
  ok('the standard layout is offered once, as the Standard style',
    !/Copy our standard layout in/.test(EDITOR));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
