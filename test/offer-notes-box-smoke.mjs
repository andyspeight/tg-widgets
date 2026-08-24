/**
 * Special Offers — a free-text "Good to know" box at the bottom of the offer
 * page (Andrea, Aug 2026).
 *
 * The builder gains an "Anything else" box (section 10, appended after the
 * type-aware write-ups, no AI button). Whatever the author types renders as a
 * "Good to know" box at the very BOTTOM of the offer page — and the box is
 * hidden entirely when left blank. The existing "About this holiday" box (the
 * Overview / description field, near the top) is untouched.
 *
 * Exercises the real builder (field present, no AI button, collect + prefill),
 * the real offer page (box shows with text / hidden without, separate from
 * About this holiday) and the save-API sanitiser.
 *
 * Run: node test/offer-notes-box-smoke.mjs   (npm run test:offer-notes-box)
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { _test } from '../api/saved-offers.js';

const BUILDER = readFileSync(new URL('../public/widget-offer-builder.js', import.meta.url), 'utf8');
const PAGE = readFileSync(new URL('../public/widget-offer-page.js', import.meta.url), 'utf8');

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };

console.log('The save API keeps the notes field');
{
  const cleaned = _test.cleanOffer({ fields: { title: 'X', notes: 'Prices are per person. Full terms apply.' } });
  ok('offer.fields.notes survives the sanitiser', cleaned.fields.notes === 'Prices are per person. Full terms apply.');
}

console.log('The builder shows an "Anything else" box, appended and AI-free');
{
  ok('a notes content section is defined', /notes:\s*\{ label: 'Anything else'[\s\S]*?noAi: true \}/.test(BUILDER));
  ok('it is appended to every offer type', /return \(TYPE_CONTENT\[type\] \|\| TYPE_CONTENT\._default\)\.concat\(\['notes'\]\)/.test(BUILDER));
  ok('sections flagged noAi get no Write-with-AI button', /ai && !s\.noAi \?/.test(BUILDER));

  const { window } = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'dangerously', pretendToBeVisual: true });
  const s = window.document.createElement('script'); s.textContent = BUILDER; window.document.body.appendChild(s);
  const d = window.document.createElement('div'); window.document.body.appendChild(d);
  const b = new window.TGOfferBuilderWidget(d, { currency: 'GBP', aiEnabled: true, aiMock: true });

  const notesTa = b.root.querySelector('.ob-content-sec[data-field="notes"] textarea[data-key="notes"]');
  ok('the notes textarea is rendered', !!notesTa);
  ok('the notes box has no Write-with-AI button', !b.root.querySelector('.ob-content-sec[data-field="notes"] .ob-ai-write'));
  ok('a normal write-up section still has the AI button', !!b.root.querySelector('.ob-content-sec[data-field="description"] .ob-ai-write'));

  // Type into it, collect, and reopen.
  notesTa.value = 'Deposits are non-refundable.';
  notesTa.dispatchEvent(new window.Event('input'));
  ok('notes is collected onto the offer fields', b._collect().fields.notes === 'Deposits are non-refundable.');

  const d2 = window.document.createElement('div'); window.document.body.appendChild(d2);
  const b2 = new window.TGOfferBuilderWidget(d2, { currency: 'GBP', offer: { fields: { title: 'Y', notes: 'Saved small print.' } } });
  ok('a saved note reopens in the box', b2.root.querySelector('textarea[data-key="notes"]').value === 'Saved small print.');
}

console.log('The offer page shows the box at the bottom, only when filled');
{
  const { window } = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'dangerously', pretendToBeVisual: true });
  const s = window.document.createElement('script'); s.textContent = PAGE; window.document.body.appendChild(s);
  const render = (fields) => { const el = window.document.createElement('div'); window.document.body.appendChild(el); new window.TGOfferPageWidget(el, { offer: { currency: 'EUR', fields }, offerId: 'x' }); return el.shadowRoot.innerHTML; };

  const withNotes = render({ title: 'Greek Isles', description: 'A wonderful cruise overview.', notes: 'Prices per person.\nT&Cs apply.' });
  ok('the "Good to know" box shows', /Good to know/.test(withNotes));
  ok('the note text renders (both lines)', withNotes.includes('Prices per person.') && withNotes.includes('T&amp;Cs apply.'));
  ok('the existing About this holiday box is untouched', /About this holiday/.test(withNotes) && withNotes.includes('A wonderful cruise overview.'));
  ok('the notes box comes AFTER About this holiday', withNotes.indexOf('Good to know') > withNotes.indexOf('About this holiday'));

  const noNotes = render({ title: 'Greek Isles', description: 'Overview only.' });
  ok('with no note, the box is hidden entirely', !/Good to know/.test(noNotes));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
