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
  ok('it has its own sidebar card and popup tab',
    /class="rem-edit-btn" data-stage="cancellation"/.test(EDITOR)
    && /class="rem-stage" role="tab" data-stage="cancellation"/.test(EDITOR)
    && /id="rem-status-cancellation"/.test(EDITOR));
  ok('the editor imports the shared cancellation renderer',
    /import \{ renderCancellationEmail \} from '\/_cancellation-email-template\.js';/.test(EDITOR));
  ok('its copy still reads and writes state.config.cancelEmailMessage (config shape unchanged)',
    /body: String\(state\.config\.cancelEmailMessage \|\| ''\)/.test(EDITOR)
    && /if \(part === 'body'\) state\.config\.cancelEmailMessage = v;/.test(EDITOR));
  ok('subject + merge-tag controls are HIDDEN for it (the renderer writes the subject and fills no tags)',
    /hasSubject: false, hasTags: false/.test(EDITOR)
    && /getElementById\('rem-subject-field'\)\.hidden = !def\.hasSubject/.test(EDITOR)
    && /getElementById\('rem-tags'\)\.hidden = !def\.hasTags/.test(EDITOR));
  ok('the preview warns when the client has the email switched off',
    /display\.cancelEmail === false/.test(EDITOR) && /This email is switched off/.test(EDITOR));
  ok('the preview mirrors what the server resolves (brand name, primary colour, support details)',
    /primary: \(state\.config\.colors && state\.config\.colors\.primary\) \|\| ''/.test(EDITOR));
}

console.log('One popup drives every editable email, so they cannot diverge in UX');
{
  ok('a descriptor map declares each email', /const REM_EMAILS = \{/.test(EDITOR) && /const REM_ORDER = \['interim', 'final', 'cancellation'\]/.test(EDITOR));
  ok('the popup title, tabs and status cards are all driven from it',
    /getElementById\('rem-modal-title'\)\.textContent = def\.label/.test(EDITOR)
    && /REM_ORDER\.forEach/.test(EDITOR));
  ok('typing routes through the descriptor rather than a hardcoded config path',
    /REM_EMAILS\[remStage\]\.write\(part, el\.value\)/.test(EDITOR));
  ok('reset routes through the descriptor too', /const def = REM_EMAILS\[remStage\];\s*\n\s*const t = def\.read\(\);/.test(EDITOR));
  ok('an unknown stage cannot open a broken popup', /const def = REM_EMAILS\[stage\];\s*\n\s*if \(!def\) return;/.test(EDITOR));
}

console.log('The popup: full editor on the left, the real email on the right');
{
  ok('a full-size popup exists and is a labelled dialog',
    /id="rem-modal"/.test(EDITOR) && /role="dialog" aria-modal="true" aria-labelledby="rem-modal-title"/.test(EDITOR));
  ok('it has interim/final stage tabs', /class="rem-stage is-active" role="tab" data-stage="interim"/.test(EDITOR) && /data-stage="final"/.test(EDITOR));
  ok('subject input is length-capped to match the server (200)', /id="rem-subject" maxlength="200"/.test(EDITOR));
  ok('the message area grows to fill the popup (no more 8-row box)', /class="field rem-msg"/.test(EDITOR) && /\.rem-edit-pane \.rem-msg textarea \{ flex: 1;/.test(EDITOR));
  ok('the preview renders in a SANDBOXED iframe via srcdoc (no scripts, no CSS bleed)',
    /<iframe id="rem-frame" title="Email preview" sandbox="">/.test(EDITOR) && /getElementById\('rem-frame'\)\.srcdoc = out\.html/.test(EDITOR));
  ok('an envelope bar shows the live From + Subject', /id="rem-env-from"/.test(EDITOR) && /id="rem-env-subject"/.test(EDITOR) && /\.textContent = out\.subject/.test(EDITOR));
  ok('the editor imports the shared renderer module', /import \{ renderReminderEmail \} from '\/_reminder-email-template\.js';/.test(EDITOR));
  ok('the preview calls the REAL renderer', /const out = renderReminderEmail\(\{/.test(EDITOR));
  ok('a blank message previews the standard wording (template: null → built-in email)',
    /template: body\.trim\(\) \? \{ subject: subject, body: body \} : null/.test(EDITOR));
  ok('the sample due date is computed in the future (never the overdue variant)', /Date\.now\(\) \+ 42 \* 86400000/.test(EDITOR));
  ok('the pay button only previews when a valid https booking page is set (matches the send path)',
    /payUrl: hasPage \? pageUrl\.replace\(\/#\.\*\$\/, ''\) \+ '#tg-pay=ST-24189' : null/.test(EDITOR));
  ok('the popup closes on Done, the X, the backdrop and Escape',
    /getElementById\('rem-done'\)\.addEventListener\('click', remClose\)/.test(EDITOR)
    && /getElementById\('rem-close'\)\.addEventListener\('click', remClose\)/.test(EDITOR)
    && /if \(e\.target === e\.currentTarget\) remClose\(\)/.test(EDITOR)
    && /e\.key !== 'Escape'/.test(EDITOR));
}

console.log('Edits persist into state.config.reminderEmails and mark the editor dirty');
{
  ok('reminderEmails default has interim + final subject/body',
    /reminderEmails:\s*\{\s*interim:\s*\{\s*subject:\s*''\s*,\s*body:\s*''\s*\}\s*,\s*final:\s*\{\s*subject:\s*''\s*,\s*body:\s*''\s*\}\s*\}/.test(EDITOR));
  ok('reEnsure() backfills a missing reminderEmails object', /function reEnsure\(\)/.test(EDITOR) && /state\.config\.reminderEmails\s*=\s*\{\}/.test(EDITOR));
  ok('typing lands in state.config.reminderEmails[stage][part] via the descriptor',
    /REM_EMAILS\[remStage\]\.write\(part, el\.value\)/.test(EDITOR)
    && /write: function \(part, v\) \{ reEnsure\(\); state\.config\.reminderEmails\.interim\[part\] = v; \}/.test(EDITOR)
    && /write: function \(part, v\) \{ reEnsure\(\); state\.config\.reminderEmails\.final\[part\] = v; \}/.test(EDITOR));
  ok('editing marks the editor dirty', /window\.tgse\.markDirty\(\)/.test(EDITOR));
  ok('chips splice the tag into the focused field and re-fire input',
    /querySelectorAll\('\.re-tag'\)\.forEach/.test(EDITOR)
    && /el\.value\.slice\(0,\s*s\)\s*\+\s*tag\s*\+\s*el\.value\.slice\(e\)/.test(EDITOR)
    && /el\.dispatchEvent\(new Event\('input'\)\)/.test(EDITOR));
  ok('"Use our standard wording" asks before wiping the client copy',
    /getElementById\('rem-reset'\)/.test(EDITOR) && /showConfirm\('Use our standard wording\?'/.test(EDITOR));
}

// ── CROSS GUARD ──────────────────────────────────────────────────────────────
// Every tag the popup offers must be one the renderer fills. Derive the
// renderer's supported set from its mergeVars object and the editor's offered
// set from the chip data-tag attributes, then assert offered ⊆ supported —
// and prove it FUNCTIONALLY by rendering a body containing every chip.
console.log('Every tag the popup offers is one the renderer fills');
{
  const mv = RENDERER.slice(RENDERER.indexOf('const mergeVars = {'));
  const block = mv.slice(0, mv.indexOf('};') + 1);
  const supported = new Set((block.match(/([a-zA-Z]+)\s*:/g) || []).map(s => s.replace(/\s*:$/, '').toLowerCase()));
  ok('renderer exposes the core tags', ['firstname', 'amount', 'duedate', 'balance', 'bookingref', 'agencyname', 'agencyphone', 'instalmentnumber', 'instalmenttotal'].every(k => supported.has(k)));

  const offered = [...EDITOR.matchAll(/class="re-tag"\s+data-tag="\{([a-zA-Z]+)\}"/g)].map(m => m[1]);
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
