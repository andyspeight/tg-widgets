/**
 * The shared editor email popup — public/editor-email-popup.js
 *
 * Andy, Sep 2026: "please confirm you are using the same style pop-up for this
 * editing so there is consistency across all the widgets... the one we built
 * for My Booking".
 *
 * It had been built twice by then — rem-* in the My Booking editor and eml-* in
 * Enquiry — and the two copies had already drifted (message box 220px vs
 * 200px). Newsletter and Popup would have made four. So the popup is now ONE
 * component every editor calls, and consistency is structural rather than
 * remembered.
 *
 * This suite owns the chrome: the component is mounted for real in jsdom and
 * driven like a user would. The per-editor suites only assert that their editor
 * hands it the right emails.
 *
 * Run: node test/editor-email-popup-smoke.mjs   (npm run test:editor-email-popup)
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const SRC = readFileSync(new URL('../public/editor-email-popup.js', import.meta.url), 'utf8');
const MYBOOKING = readFileSync(new URL('../public/editor-mybooking.html', import.meta.url), 'utf8');

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };

console.log('It keeps the My Booking popup\'s exact look, because that is the one Andy picked');
{
  // Values lifted from the original rem-* implementation. If someone restyles
  // the shared popup, these say plainly which look is being changed.
  ok('same 1240px x 860px modal', /max-width:1240px/.test(SRC) && /height:min\(860px, calc\(100vh - 48px\)\)/.test(SRC));
  ok('same 400px writing pane', /width:400px/.test(SRC) && /flex:0 0 400px/.test(SRC));
  ok('same 220px minimum message box (Enquiry had drifted to 200px)', /min-height:220px/.test(SRC));
  ok('same navy Done button and dimmed backdrop', /#1B2B5B/.test(SRC) && /rgba\(15,23,42,\.6\)/.test(SRC));
  ok('same underlined reset link', /text-underline-offset:3px/.test(SRC));
  ok('same tab padding', /padding:7px 14px/.test(SRC));
  ok('it honours prefers-reduced-motion', /@media \(prefers-reduced-motion: reduce\)/.test(SRC));
  ok('the preview iframe is sandboxed with NO allow- tokens', /setAttribute\('sandbox', ''\)/.test(SRC) && !/allow-scripts/.test(SRC));
  ok('the editors no longer carry popup chrome of their own',
    !/rem-modal|rem-env-row|\.rem-preview-pane/.test(MYBOOKING));
}

console.log('Functional — the real component, mounted and driven in jsdom');
{
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom;
  const s = window.document.createElement('script');
  s.textContent = SRC;
  window.document.body.appendChild(s);
  ok('it exposes TGEmailPopup with open() and card()',
    !!window.TGEmailPopup && typeof window.TGEmailPopup.open === 'function' && typeof window.TGEmailPopup.card === 'function');

  // A two-email config in the shape every editor uses.
  const store = { a: { subject: '', body: '' }, b: { adv: '' } };
  let changes = 0, closed = 0, resetRan = 0;
  const emails = [
    {
      key: 'a', label: 'Customer confirmation', tabLabel: 'Customer',
      from: () => 'Travelaire', to: 'sarah@example.com',
      tags: [{ tag: '{firstName}', label: 'First name' }, { tag: '{reference}', label: 'Reference' }],
      fields: [
        { key: 'subject', type: 'text', label: 'Subject', maxlength: 200, tagsAfter: true },
        { key: 'body', type: 'textarea', label: 'Message', grow: true, hint: 'Blank means our wording.' },
      ],
      read: () => store.a,
      write: (k, v) => { store.a[k] = v; },
      render: (v) => ({
        subject: v.subject ? 'S:' + v.subject : 'Our default subject',
        html: '<p>' + (v.body || 'our standard wording') + '</p>',
        note: v.body ? 'Your own wording.' : 'Previewing our standard wording.',
      }),
      reset: {
        label: 'Use our standard wording',
        isSet: () => !!(store.a.subject || store.a.body),
        run: (applied) => { resetRan++; store.a = { subject: '', body: '' }; applied(); },
      },
    },
    {
      key: 'b', label: 'Team notification', tabLabel: 'Team',
      from: 'Travelaire', to: 'team@example.com',
      tags: [],
      fields: [{ key: 'adv', type: 'advanced', label: 'Advanced: your own HTML' }],
      read: () => store.b,
      write: (k, v) => { store.b[k] = v; },
      render: () => ({ subject: 'New enquiry', html: '<p>readout</p>', note: 'Not editable.' }),
    },
  ];
  const handle = window.TGEmailPopup.open({
    startKey: 'a', emails, onChange: () => { changes++; }, onClose: () => { closed++; },
  });

  const doc = window.document;
  const overlay = doc.querySelector('.tgep-overlay');
  ok('the overlay mounts with a labelled dialog',
    !!overlay && overlay.querySelector('.tgep-modal').getAttribute('role') === 'dialog'
    && overlay.querySelector('.tgep-modal').getAttribute('aria-modal') === 'true');
  ok('its styles are injected once', doc.querySelectorAll('#tgep-styles').length === 1);
  ok('one tab per email, the start tab selected',
    doc.querySelectorAll('.tgep-tab').length === 2
    && doc.querySelector('.tgep-tab[data-tab="a"]').getAttribute('aria-selected') === 'true');
  ok('the title follows the selected email', doc.querySelector('#tgep-title').textContent === 'Customer confirmation');
  ok('the envelope shows From, To and the rendered Subject',
    /Travelaire/.test(doc.querySelector('.tgep-env').textContent)
    && /sarah@example\.com/.test(doc.querySelector('.tgep-env').textContent)
    && /Our default subject/.test(doc.querySelector('.tgep-env').textContent));
  ok('the preview iframe carries the rendered email', /our standard wording/.test(doc.querySelector('.tgep-preview iframe').getAttribute('srcdoc')));
  ok('the note comes from the renderer', /Previewing our standard wording\./.test(doc.querySelector('.tgep-note').textContent));
  ok('the message field grows and shows its hint',
    !!doc.querySelector('.tgep-field.is-grow textarea') && /Blank means our wording\./.test(doc.querySelector('.tgep-pane').textContent));

  // Typing persists through write(), fires onChange and redraws the preview.
  const bodyEl = doc.querySelector('.tgep-field.is-grow textarea');
  bodyEl.value = 'Hello there';
  bodyEl.dispatchEvent(new window.Event('input'));
  ok('typing persists via write()', store.a.body === 'Hello there');
  ok('typing notifies the editor so it can save', changes === 1);
  ok('typing redraws the preview immediately', /Hello there/.test(doc.querySelector('.tgep-preview iframe').getAttribute('srcdoc')));
  ok('the note updates too', /Your own wording\./.test(doc.querySelector('.tgep-note').textContent));

  // Merge-tag chips insert at the cursor of the last focused field.
  const subjectEl = doc.querySelector('input[type=text]');
  subjectEl.dispatchEvent(new window.Event('focus'));
  doc.querySelector('.tgep-tag[data-tag="{firstName}"]').dispatchEvent(new window.Event('click'));
  ok('a chip inserts into the field the client was last in', store.a.subject === '{firstName}');
  ok('...and that shows in the envelope subject at once', /S:\{firstName\}/.test(doc.querySelector('.tgep-env').textContent));
  ok('chips render one per declared tag', doc.querySelectorAll('.tgep-tag').length === 2);

  // Switching tabs rebuilds the pane for the other email.
  doc.querySelector('.tgep-tab[data-tab="b"]').dispatchEvent(new window.Event('click'));
  ok('switching tab retitles the popup', doc.querySelector('#tgep-title').textContent === 'Team notification');
  ok('an email with no tags shows no chips', doc.querySelectorAll('.tgep-tag').length === 0);
  ok('an advanced-only email renders its disclosure, not a bare textarea',
    !!doc.querySelector('details.tgep-adv') && /Advanced: your own HTML/.test(doc.querySelector('details.tgep-adv summary').textContent));
  ok('it previews that email instead', /readout/.test(doc.querySelector('.tgep-preview iframe').getAttribute('srcdoc')));

  // The reset link is the editor's to confirm; the pane repopulates after.
  doc.querySelector('.tgep-tab[data-tab="a"]').dispatchEvent(new window.Event('click'));
  ok('the reset link is offered when the client has written something', !!doc.querySelector('.tgep-reset'));
  doc.querySelector('.tgep-reset').dispatchEvent(new window.Event('click'));
  ok('reset runs through the editor (which owns the confirm step)', resetRan === 1);
  ok('...clears the stored copy', store.a.body === '' && store.a.subject === '');
  ok('...and the pane repopulates from the real config, not optimistically',
    doc.querySelector('.tgep-field.is-grow textarea').value === '');
  ok('...and the preview falls back to our wording', /our standard wording/.test(doc.querySelector('.tgep-preview iframe').getAttribute('srcdoc')));

  // A reset with nothing written must not prompt the client for nothing.
  const before = resetRan;
  doc.querySelector('.tgep-reset').dispatchEvent(new window.Event('click'));
  ok('reset no-ops when there is nothing to reset', resetRan === before);

  // Every close path.
  doc.querySelector('.tgep-close').dispatchEvent(new window.Event('click'));
  ok('the X closes and tells the editor', closed === 1);
  doc.querySelector('.tgep-close').dispatchEvent(new window.Event('click'));
  ok('closing twice does not fire onClose twice', closed === 1);

  // A closing overlay lingers ~200ms for its fade and jsdom never advances that
  // timer, so always address the NEWEST overlay rather than the first in the DOM.
  const live = () => doc.querySelectorAll('.tgep-overlay:not([data-closing])');
  const newest = (sel) => { const o = live()[live().length - 1]; return o.querySelector(sel); };

  window.TGEmailPopup.open({ emails, onClose: () => { closed++; } });
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  ok('Escape closes', closed === 2);

  window.TGEmailPopup.open({ emails, onClose: () => { closed++; } });
  const ov = live()[live().length - 1];
  const click = new window.Event('click');
  Object.defineProperty(click, 'target', { value: ov });
  ov.dispatchEvent(click);
  ok('a backdrop click closes', closed === 3);

  // A closed popup must stop listening, or Escape in the editor keeps firing
  // onClose for a popup that is no longer on screen.
  const after = closed;
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  ok('a closed popup stops listening for Escape', closed === after);

  ok('open() hands back a handle the editor can close', typeof handle.close === 'function');

  // A single email needs no tab strip.
  window.TGEmailPopup.open({ emails: [emails[0]] });
  ok('one email means no tab strip at all', live()[live().length - 1].querySelectorAll('.tgep-tabs').length === 0);
  newest('.tgep-close').dispatchEvent(new window.Event('click'));

  // Sidebar cards come from here too, so every editor's entry point matches.
  let carded = 0;
  const c = window.TGEmailPopup.card({ title: 'Customer confirmation', status: 'Your own wording', isCustom: true, onEdit: () => { carded++; } });
  ok('card() builds the same sidebar row for every editor', /Customer confirmation/.test(c.textContent) && /Your own wording/.test(c.textContent));
  c.querySelector('button').dispatchEvent(new window.Event('click'));
  ok('its button opens the editor\'s popup', carded === 1);
}

console.log('Every editor that writes an email loads the shared popup');
{
  const editors = ['public/editor-mybooking.html', 'public/editor-enquiry.html'];
  editors.forEach((f) => {
    const src = readFileSync(new URL('../' + f, import.meta.url), 'utf8');
    ok(f.replace('public/editor-', '').replace('.html', '') + ' loads /editor-email-popup.js and calls TGEmailPopup.open',
      /<script src="\/editor-email-popup\.js"><\/script>/.test(src) && /TGEmailPopup\.open\(/.test(src));
  });
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
