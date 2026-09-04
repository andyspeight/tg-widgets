/**
 * Newsletter Signup + Popup — the welcome email, written in the shared popup.
 *
 * The audit's smallest remaining job and its clearest one: both widgets send a
 * welcome email to the person who signs up, the client authors five copy fields
 * for it (from name, subject, headline, message, button), and until now they
 * filled every one of them BLIND in a modal capped at 520px wide. No preview,
 * no way to know what the defaults were, and no warning that a button needs
 * both a label and a valid https link or it silently vanishes.
 *
 * The renderer moved to public/_welcome-email-template.js — with every default
 * moved with it, so "leave it blank" previews the real fallback rather than the
 * editor's guess — and api/_lib/destinations/auto-reply.js now composes through
 * it. Both editors open the SAME popup as My Booking and Enquiry.
 *
 * Run: node test/welcome-email-editor-smoke.mjs   (npm run test:welcome-email-editor)
 */
import { readFileSync } from 'node:fs';

const R = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const TPL = R('public/_welcome-email-template.js');
const SENDER = R('api/_lib/destinations/auto-reply.js');
const NEWS = R('public/editor-newsletter.html');
const POP = R('public/editor-popup.html');

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };

console.log('One renderer, shared by the sender and both editors');
{
  ok('the renderer lives in public/', /export function renderWelcomeEmail\(/.test(TPL));
  ok('the sender composes through it', /import \{ renderWelcomeEmail \} from '\.\.\/\.\.\/\.\.\/public\/_welcome-email-template\.js';/.test(SENDER)
    && /const \{ subject, html, fromName \} = renderWelcomeEmail\(job\.config \|\| \{\}, lead\);/.test(SENDER));
  ok('the sender no longer carries its own copy of the template',
    !/function welcomeTemplate\(/.test(SENDER) && !/function defaultBody\(/.test(SENDER));
  ok('it keeps its hard safety gate: only ever the subscriber\'s own address',
    /const to = lead\?\.contact\?\.email;/.test(SENDER) && /if \(!isValidEmail\(to\)\)/.test(SENDER));
  ok('the renderer stays runtime-neutral (no Node/DOM, previewable in the browser)',
    !/^import /m.test(TPL) && !/require\(/.test(TPL) && !/\bdocument\./.test(TPL) && !/process\.env/.test(TPL));
}

console.log('Functional — every default lives in the renderer, so blank previews the truth');
{
  const { renderWelcomeEmail, welcomeCtaIsUsable } = await import('../public/_welcome-email-template.js');
  const lead = { contact: { firstName: 'Sarah' } };

  const d = renderWelcomeEmail({}, lead);
  ok('a blank config renders OUR default subject', d.subject === 'You are in. Welcome to Travelgenix.');
  ok('...our default headline and body', /You are on the list/.test(d.html) && /Thanks for signing up/.test(d.html));
  ok('...personalised with the subscriber\'s first name', /Hi Sarah,/.test(d.html));
  ok('...and from Travelgenix when no from name is set', d.fromName === 'Travelgenix');

  const c = renderWelcomeEmail({
    fromName: 'Travelaire', subject: 'Welcome aboard, {firstName}', headline: 'Great to have you',
    body: 'Hi {firstName}\nThe {fromName} team is glad you signed up.',
  }, lead);
  ok('a client subject is used and its tokens fill', c.subject === 'Welcome aboard, Sarah');
  ok('a client message replaces ours entirely', /The Travelaire team is glad you signed up\./.test(c.html) && !/Thanks for signing up/.test(c.html));
  ok('the headline and from name follow too', /Great to have you/.test(c.html) && c.fromName === 'Travelaire');
  ok('client copy is escaped — no HTML reaches a subscriber',
    !renderWelcomeEmail({ body: '<script>alert(1)</script>' }, lead).html.includes('<script>alert(1)'));

  ok('a button needs BOTH a label and a valid https link',
    welcomeCtaIsUsable('Browse', 'https://example.com') === true
    && welcomeCtaIsUsable('Browse', '') === false
    && welcomeCtaIsUsable('', 'https://example.com') === false
    && welcomeCtaIsUsable('Browse', 'javascript:alert(1)') === false);
  ok('a usable button renders', /Browse trips/.test(renderWelcomeEmail({ ctaLabel: 'Browse trips', ctaUrl: 'https://example.com' }, lead).html));
  ok('an unusable button is silently left out (which the popup now WARNS about)',
    !/Browse trips/.test(renderWelcomeEmail({ ctaLabel: 'Browse trips', ctaUrl: 'not-a-url' }, lead).html));
  ok('a missing first name degrades to "there", never to a blank greeting',
    /Hi there,/.test(renderWelcomeEmail({}, { contact: {} }).html));
  ok('subject and headline are length-capped like the sender always did',
    renderWelcomeEmail({ subject: 'x'.repeat(400) }, lead).subject.length === 200);
}

console.log('Both editors open the SAME popup as My Booking and Enquiry');
{
  [['Newsletter', NEWS], ['Popup', POP]].forEach(([name, src]) => {
    ok(name + ': loads the shared popup component', /<script src="\/editor-email-popup\.js"><\/script>/.test(src));
    ok(name + ': hands the classic script the REAL renderer',
      /import \{ renderWelcomeEmail, welcomeCtaIsUsable \} from '\/_welcome-email-template\.js';/.test(src)
      && /window\.TGWelcomeEmail = \{ renderWelcomeEmail, welcomeCtaIsUsable \};/.test(src));
    ok(name + ': shows a card that opens the popup',
      /window\.TGEmailPopup\.card\(\{/.test(src) && /onEdit: openWelcomeEmailPopup/.test(src));
    ok(name + ': the popup previews through the shared renderer',
      /window\.TGWelcomeEmail\.renderWelcomeEmail\(v, \{ contact: \{ firstName: 'Sarah' \} \}\)/.test(src));
    ok(name + ': offers all five copy fields plus the from name',
      ["key: 'fromName'", "key: 'subject'", "key: 'headline'", "key: 'body'", "key: 'ctaLabel'", "key: 'ctaUrl'"]
        .every(k => src.includes(k)));
    ok(name + ': warns when a button is half-filled and would vanish',
      /The button needs BOTH text and a link starting with https:\/\/ — until then it is left out, as shown\./.test(src));
    ok(name + ': offers the two tags the renderer actually fills',
      /\{ tag: '\{firstName\}', label: 'First name' \}/.test(src) && /\{ tag: '\{fromName\}', label: 'Your company' \}/.test(src));
    // The popup writes into the very inputs collectConfigModal() reads, so
    // saving is untouched. If the raw fields were ever removed from the DOM,
    // every keystroke in the popup would be dropped on save.
    ok(name + ': the popup drives the real config inputs, so saving is unchanged',
      /document\.querySelector\('#dest-config-body \[data-config-key="' \+ key \+ '"\]'\)/.test(src)
      && /el\.dispatchEvent\(new Event\('input', \{ bubbles: true \}\)\)/.test(src));
    ok(name + ': ...and those inputs are still rendered, just folded into a disclosure',
      /<details class="welcome-raw">/.test(src) && /Edit the fields individually/.test(src)
      && /if \(dest\.emailPopup\) parts\.push\('<\/details>'\)/.test(src));
    ok(name + ': the card refreshes when the popup closes', /if \(mount && mount\._refresh\) mount\._refresh\(\)/.test(src));
  });
}

// ── CROSS GUARD ──────────────────────────────────────────────────────────────
// A tag offered in an editor that the renderer does not fill would reach a real
// subscriber as literal braces — the exact bug fixed in the Enquiry editor.
console.log('Every tag the popup offers is one the renderer fills');
{
  const supported = new Set(
    (TPL.slice(TPL.indexOf('function buildTokens')).slice(0, TPL.slice(TPL.indexOf('function buildTokens')).indexOf('\n}'))
      .match(/^\s{4}(\w+):/gm) || []).map(x => x.trim().replace(':', '')));
  ok('the renderer fills firstName and fromName', supported.has('firstName') && supported.has('fromName'));
  [['Newsletter', NEWS], ['Popup', POP]].forEach(([name, src]) => {
    const block = src.slice(src.indexOf('const WELCOME_TAGS'));
    const offered = [...block.slice(0, block.indexOf('];')).matchAll(/\{ tag: '\{(\w+)\}'/g)].map(m => m[1]);
    const orphan = offered.filter(t => !supported.has(t));
    ok(name + ': no offered tag is unknown to the renderer' + (orphan.length ? ' — orphan: ' + orphan.join(', ') : ''),
      offered.length >= 2 && orphan.length === 0);
  });
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
