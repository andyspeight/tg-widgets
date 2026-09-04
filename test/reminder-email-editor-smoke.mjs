/**
 * My Booking editor — the customer-email POPUP editor (Andy, Sep 2026:
 * "the area to add your own text / edit is way too small - it needs to be
 * rendered as a full pop-up where you can edit the content and see it as it
 * would appear in the email that is sent").
 *
 * Clients write their balance reminder wording per stage (interim / final) in
 * a full-screen popup: subject + merge-tag chips + a big message area on the
 * left, and a live preview of the REAL email on the right. The preview is
 * faithful by construction: the renderer moved to
 * public/_reminder-email-template.js so the editor imports the exact module
 * the send worker uses (api/_lib/payment-reminder-email.js is now a re-export
 * shim — the same pattern as booking-pdf.js ↔ _pdf-template.js).
 *
 * The same popup now also carries the CANCELLATION confirmation email (Sep
 * 2026). That was the second customer-facing email in this widget with
 * client-editable copy, and it shipped with the identical cramped-textarea
 * problem — a rows="4" box with no preview — about 400 lines above the popup
 * built to fix it, in the same file. Its renderer moved to
 * public/_cancellation-email-template.js behind the same kind of shim, and one
 * REM_EMAILS descriptor map now drives all three emails so their editing
 * experience cannot diverge.
 *
 * The editor page boots through the shell's cookie SSO inside an inline
 * module, so it has no cheap DOM unit test — the editor checks are source
 * guards. The renderer checks are FUNCTIONAL: we import both module paths and
 * assert they are the same object, and render a template containing every
 * offered chip to prove each one merges.
 *
 * Run: node test/reminder-email-editor-smoke.mjs   (npm run test:reminder-email-editor)
 */
import { readFileSync } from 'node:fs';

const EDITOR = readFileSync(new URL('../public/editor-mybooking.html', import.meta.url), 'utf8');
const RENDERER = readFileSync(new URL('../public/_reminder-email-template.js', import.meta.url), 'utf8');
const SHIM = readFileSync(new URL('../api/_lib/payment-reminder-email.js', import.meta.url), 'utf8');
const CANCEL = readFileSync(new URL('../public/_cancellation-email-template.js', import.meta.url), 'utf8');
const CANCEL_SHIM = readFileSync(new URL('../api/_lib/cancellation-email-template.js', import.meta.url), 'utf8');

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };

console.log('One renderer, shared by the send worker and the editor preview');
{
  ok('the renderer lives in public/ (importable by the editor page)', /export function renderReminderEmail\(/.test(RENDERER));
  ok('api/_lib/payment-reminder-email.js is a re-export shim of it', /export \* from '\.\.\/\.\.\/public\/_reminder-email-template\.js';/.test(SHIM));
  ok('the cron worker still imports through the stable api/_lib path',
    /from '\.\.\/_lib\/payment-reminder-email\.js'/.test(readFileSync(new URL('../api/cron/payment-reminders.js', import.meta.url), 'utf8')));
  ok('the renderer stays runtime-neutral (no Node/DOM imports, previewable in the browser)',
    !/^import /m.test(RENDERER) && !/require\(/.test(RENDERER) && !/\bdocument\./.test(RENDERER));
  const shimMod = await import('../api/_lib/payment-reminder-email.js');
  const pubMod = await import('../public/_reminder-email-template.js');
  ok('FUNCTIONAL: both import paths resolve to the same function (zero drift possible)',
    shimMod.renderReminderEmail === pubMod.renderReminderEmail && typeof pubMod.renderReminderEmail === 'function');
}

console.log('The sidebar section is now stage cards that open the popup');
{
  ok('the Reminder emails accordion section is still there', /data-section="reminder-emails"/.test(EDITOR) && /Reminder emails<\/h3>/.test(EDITOR));
  ok('each stage has a card with an Edit email button',
    /class="rem-edit-btn" data-stage="interim"/.test(EDITOR) && /class="rem-edit-btn" data-stage="final"/.test(EDITOR));
  ok('each card shows whether the client wording is in use',
    /id="rem-status-interim"/.test(EDITOR) && /id="rem-status-final"/.test(EDITOR) && /Your own wording/.test(EDITOR) && /Using our standard wording/.test(EDITOR));
  ok('the old cramped inline fields are gone', !/id="re-interim-subject"/.test(EDITOR) && !/id="re-final-body"/.test(EDITOR));
  ok('load repopulates the cards from the saved config (remRenderStatus on load)',
    /reEnsure\(\);\s*\n\s*remRenderStatus\(\);/.test(EDITOR));
}

// ── The cancellation email (Sep 2026) ────────────────────────────────────────
// The SECOND customer-facing email in this widget with client-editable copy. It
// shipped with the same cramped-textarea problem the popup was built to fix —
// a rows="4" box with no preview — about 400 lines above the popup, in this very
// file. It now uses the same popup, previewed through the same shared renderer.
console.log('The cancellation confirmation email is on the same popup, not a lone textarea');
{
  ok('the renderer moved to public/ (importable by the editor page)', /export function renderCancellationEmail\(/.test(CANCEL));
  ok('api/_lib/cancellation-email-template.js is a re-export shim of it',
    /export \* from '\.\.\/\.\.\/public\/_cancellation-email-template\.js';/.test(CANCEL_SHIM));
  ok('the sender still imports through the stable api/_lib path',
    /from '\.\/_lib\/cancellation-email-template\.js'/.test(readFileSync(new URL('../api/cancel-product.js', import.meta.url), 'utf8')));
  ok('the renderer stays runtime-neutral (no Node/DOM, previewable in the browser)',
    !/^import /m.test(CANCEL) && !/require\(/.test(CANCEL) && !/\bdocument\./.test(CANCEL) && !/\bBuffer\b/.test(CANCEL) && !/process\.env/.test(CANCEL));
  ok('the cramped rows="4" cancellation textarea is GONE', !/id="copy-cancel-email-msg"/.test(EDITOR));
  ok('...and nothing still tries to read or write that dead element (would throw on load)',
    !/copy-cancel-email-msg/.test(EDITOR));
  ok('it has its own sidebar card and its own tab in the popup',
    /class="rem-edit-btn" data-stage="cancellation"/.test(EDITOR)
    && /id="rem-status-cancellation"/.test(EDITOR)
    && /const REM_ORDER = \['interim', 'final', 'cancellation'\]/.test(EDITOR));
  ok('the editor imports the shared cancellation renderer',
    /import \{ renderCancellationEmail \} from '\/_cancellation-email-template\.js';/.test(EDITOR));
  ok('its copy still reads and writes state.config.cancelEmailMessage (config shape unchanged)',
    /body: String\(state\.config\.cancelEmailMessage \|\| ''\)/.test(EDITOR)
    && /else if \(key === 'body'\) state\.config\.cancelEmailMessage = value;/.test(EDITOR));
  ok('it offers NO subject and NO tags (the renderer writes the subject and fills no tags)',
    /tags: reminder \? REM_TAGS : \[\]/.test(EDITOR)
    && /fields: reminder \? \[/.test(EDITOR));
  ok('the preview warns when the client has the email switched off',
    /display\.cancelEmail === false/.test(EDITOR) && /This email is switched off/.test(EDITOR));
  ok('the preview mirrors what the server resolves (brand name, primary colour, support details)',
    /primary: \(state\.config\.colors && state\.config\.colors\.primary\) \|\| ''/.test(EDITOR));
}

// The popup CHROME (layout, tabs, sandboxed preview, envelope bar, every close
// path) now lives in public/editor-email-popup.js and is covered by
// test/editor-email-popup-smoke.mjs. What matters here is that this editor
// hands that shared component the right emails.
console.log('The editor hands the shared popup its three emails');
{
  ok('it loads the shared popup component', /<script src="\/editor-email-popup\.js"><\/script>/.test(EDITOR));
  ok('...and carries no popup chrome of its own any more',
    !/rem-modal/.test(EDITOR) && !/rem-env-row/.test(EDITOR) && !/id="rem-frame"/.test(EDITOR));
  ok('opening passes all three emails, with the clicked one as the start tab',
    /window\.TGEmailPopup\.open\(\{/.test(EDITOR)
    && /startKey: stage/.test(EDITOR)
    && /emails: REM_ORDER\.map\(remEmail\)/.test(EDITOR));
  ok('closing refreshes the sidebar cards', /onClose: remRenderStatus/.test(EDITOR));
  ok('one descriptor builder serves all three emails', /function remEmail\(stage\)/.test(EDITOR));
  ok('the subject is capped at 200 to match the server', /maxlength: 200/.test(EDITOR));
  ok('the message field is the one that grows to fill the popup',
    /key: 'body', type: 'textarea', label: 'Message', grow: true/.test(EDITOR));
  ok('the preview calls the REAL renderers',
    /renderReminderEmail\(\{/.test(EDITOR) && /renderCancellationEmail\(\{/.test(EDITOR));
  ok('a blank message previews the standard wording (template: null → built-in email)',
    /template: body\.trim\(\) \? \{ subject: subject, body: body \} : null/.test(EDITOR));
  ok('the sample due date is computed in the future (never the overdue variant)',
    /Date\.now\(\) \+ 42 \* 86400000/.test(EDITOR));
  ok('the pay button only previews when a valid https booking page is set (matches the send path)',
    /payUrl: hasPage \? pageUrl\.replace\(\/#\.\*\$\/, ''\) \+ '#tg-pay=ST-24189' : null/.test(EDITOR));
}

console.log('Edits persist into the config and mark the editor dirty');
{
  ok('reminderEmails default has interim + final subject/body',
    /reminderEmails:\s*\{\s*interim:\s*\{\s*subject:\s*''\s*,\s*body:\s*''\s*\}\s*,\s*final:\s*\{\s*subject:\s*''\s*,\s*body:\s*''\s*\}\s*\}/.test(EDITOR));
  ok('reEnsure() backfills a missing reminderEmails object',
    /function reEnsure\(\)/.test(EDITOR) && /state\.config\.reminderEmails\s*=\s*\{\}/.test(EDITOR));
  ok('a reminder write lands in state.config.reminderEmails[stage][field]',
    /if \(reminder\) \{ reEnsure\(\); state\.config\.reminderEmails\[stage\]\[key\] = value; \}/.test(EDITOR));
  ok('editing marks the editor dirty', /window\.tgse\.markDirty\(\)/.test(EDITOR));
  ok('"Use our standard wording" asks before wiping the client copy',
    /reset: \{/.test(EDITOR) && /showConfirm\('Use our standard wording\?'/.test(EDITOR));
  ok('...and only offers itself when something has been written', /isSet: \(\) => \{ const t = read\(\);/.test(EDITOR));
}


console.log('Every tag the popup offers is one the renderer fills');
{
  const mv = RENDERER.slice(RENDERER.indexOf('const mergeVars = {'));
  const block = mv.slice(0, mv.indexOf('};') + 1);
  const supported = new Set((block.match(/([a-zA-Z]+)\s*:/g) || []).map(s => s.replace(/\s*:$/, '').toLowerCase()));
  ok('renderer exposes the core tags', ['firstname', 'amount', 'duedate', 'balance', 'bookingref', 'agencyname', 'agencyphone', 'instalmentnumber', 'instalmenttotal'].every(k => supported.has(k)));

  // Chips are declared in the REM_TAGS descriptor now, not in editor markup.
  const offered = [...EDITOR.matchAll(/\{ tag: '\{([a-zA-Z]+)\}', label:/g)].map(m => m[1]);
  ok('the popup offers a set of chips', offered.length >= 8);
  const orphan = offered.filter(t => !supported.has(t.toLowerCase()));
  ok('no offered chip is unknown to the renderer (offered ⊆ supported)' + (orphan.length ? ' — orphan: ' + orphan.join(', ') : ''), orphan.length === 0);

  const { renderReminderEmail } = await import('../public/_reminder-email-template.js');
  const body = offered.map(t => `${t}: {${t}}`).join('\n');
  const out = renderReminderEmail({
    agency: { name: 'Lapland Travel', supportPhone: '01202 000000', supportEmail: 'help@example.com' },
    customerFirstName: 'Sarah', orderRef: 'ST-24189',
    charge: { amount: 350, currency: 'GBP', total: 2050, paid: 850, outstanding: 1200, isInstalment: true, remainingAmount: 850 },
    dueDateIso: '2099-11-15', payUrl: 'https://example.com/my-booking#tg-pay=ST-24189',
    template: { subject: 'Hi {firstName}', body }, instalment: { number: 1, total: 3 }, chase: false,
  });
  const unmerged = offered.filter(t => new RegExp('\\{' + t + '\\}').test(out.html));
  ok('FUNCTIONAL: every chip merges to a value in the rendered email' + (unmerged.length ? ' — literal: ' + unmerged.join(', ') : ''), unmerged.length === 0);
  ok('FUNCTIONAL: the subject merges too and the shell adds the pay button', /Hi Sarah/.test(out.subject) && /Pay my balance/.test(out.html));
}

console.log('Functional — the cancellation renderer behaves as the popup promises');
{
  const shimMod = await import('../api/_lib/cancellation-email-template.js');
  const pubMod = await import('../public/_cancellation-email-template.js');
  ok('both import paths resolve to the same function (zero drift possible)',
    shimMod.renderCancellationEmail === pubMod.renderCancellationEmail);

  const args = {
    brand: { name: 'MT Holidays', primary: '#1B2B5B' }, customerName: 'Sarah',
    productLabel: 'Accommodation', bookingReference: 'ST-24189', cancellationReference: 'CXL-90412',
    supportEmail: 'help@example.com', supportPhone: '01202 000000',
  };
  const blank = pubMod.renderCancellationEmail({ ...args, message: '' });
  ok('a blank message renders OUR standard wording (what the popup previews as the fallback)',
    /has been cancelled as requested/.test(blank.html));
  ok('the renderer writes the subject itself, so the popup is right to hide that field',
    blank.subject === 'Cancellation confirmed — Accommodation (ST-24189)');

  const custom = pubMod.renderCancellationEmail({ ...args, message: 'Sorry to see you go.\n\nRefunds take 5 days.' });
  ok('client prose replaces the default and blank lines become paragraphs',
    !/has been cancelled as requested/.test(custom.html)
    && /Sorry to see you go\./.test(custom.html) && /Refunds take 5 days\./.test(custom.html));
  ok('client prose is escaped — no client HTML reaches a customer inbox',
    !pubMod.renderCancellationEmail({ ...args, message: '<script>alert(1)</script>' }).html.includes('<script>alert(1)'));
  ok('the client brand and support details reach the email',
    /MT Holidays/.test(custom.html) && /help@example\.com/.test(custom.html) && /01202 000000/.test(custom.html));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
