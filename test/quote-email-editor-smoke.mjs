/**
 * Quote PDF — the covering email gets branding, and a client can write it.
 *
 * The last item on the Sep 2026 email audit, and the one the adversarial
 * verifier described most sharply: "three <p> tags that carry an attachment".
 * The customer's quote — the best-designed document we produce, carrying the
 * client's logo, tagline, six brand colours and contact details — arrived in
 * the plainest email in the suite: three unstyled paragraphs hardcoded in
 * api/quote-pdf.js, with no branding, no colour and nothing a client could
 * change or even see.
 *
 * It now renders from public/_quote-email-template.js using the SAME brand kit
 * as the PDF, and the client can write their own subject and message in the
 * shared popup with a live preview.
 *
 * Run: node test/quote-email-editor-smoke.mjs   (npm run test:quote-email-editor)
 */
import { readFileSync } from 'node:fs';

const R = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const TPL = R('public/_quote-email-template.js');
const SENDER = R('api/quote-pdf.js');
const EDITOR = R('public/editor-quote-pdf.html');

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };

console.log('One renderer, shared by the sender and the editor preview');
{
  ok('the renderer lives in public/', /export function renderQuoteEmail\(/.test(TPL));
  ok('the sender composes through it',
    /import \{ renderQuoteEmail, normaliseQuoteEmail \} from '\.\.\/public\/_quote-email-template\.js';/.test(SENDER)
    && /const \{ subject, html, text \} = renderQuoteEmail\(\{/.test(SENDER));
  ok('the three hardcoded <p> tags are GONE',
    !/<p>Hi \$\{escapeHtml\(lead\)\},<\/p>/.test(SENDER)
    && !/Please find your quote &ldquo;/.test(SENDER)
    && !/Kind regards,<br>/.test(SENDER));
  ok('the send still carries the attachments it always did',
    /attachments,\n  \}\);/.test(SENDER) && /disposition: 'attachment'/.test(SENDER));
  // Strip comments first: the header explains that there is no Buffer here, and
  // a naive word match would flag that prose as if it were code.
  const CODE = TPL.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok('the renderer is runtime-neutral so the editor can preview it',
    !/^import /m.test(CODE) && !/require\(/.test(CODE) && !/\bdocument\./.test(CODE)
    && !/process\.env/.test(CODE) && !/\bBuffer\b/.test(CODE));
  ok('the client\'s wording is forwarded from the saved config', /email: c\.email,/.test(SENDER)
    && /template: normaliseQuoteEmail\(opts && opts\.email\)/.test(SENDER));
}

console.log('Functional — branded from the same kit as the PDF it carries');
{
  const { renderQuoteEmail, normaliseQuoteEmail, QUOTE_EMAIL_TAGS } = await import('../public/_quote-email-template.js');
  const brand = {
    name: 'MT Holidays', tagline: 'Your personalised holiday quote',
    logoUrl: 'https://cdn.example.com/logo.png',
    supportEmail: 'help@mth.co.uk', supportPhone: '01202 000000',
    colors: { topBar: '#111D3E', hero: '#1B2B5B', accent: '#00B4D8', text: '#0F172A' },
  };
  const args = { brand, quoteTitle: 'Maldives, 10 nights', leadName: 'Sarah Jones', filename: 'quote-maldives.pdf', extraCount: 2 };
  const d = renderQuoteEmail(args);

  ok('our default subject still reads as it always did', d.subject === 'Your quote: Maldives, 10 nights');
  ok('the client brand name and tagline are in the email', /MT Holidays/.test(d.html) && /Your personalised holiday quote/.test(d.html));
  ok('their logo is used when it is a valid https URL', /cdn\.example\.com\/logo\.png/.test(d.html));
  ok('their brand colours theme it (top bar, accent, heading)',
    /#111D3E/.test(d.html) && /#00B4D8/.test(d.html) && /#1B2B5B/.test(d.html));
  ok('an attachment card names the quote, the file and the extras',
    /Maldives, 10 nights/.test(d.html) && /quote-maldives\.pdf/.test(d.html) && /plus 2 more documents/.test(d.html));
  ok('"1 more document" is singular', /plus 1 more document[^s]/.test(renderQuoteEmail({ ...args, extraCount: 1 }).html));
  ok('no extras means no extras line', !/more document/.test(renderQuoteEmail({ ...args, extraCount: 0 }).html));
  ok('their contact details are offered', /01202 000000/.test(d.html) && /help@mth\.co\.uk/.test(d.html));
  ok('there is a real plain-text part, not just HTML', /Attached: Maldives, 10 nights/.test(d.text) && d.text.length > 100);

  // The PDF hides contact details when showContact is off; the covering email
  // must not leak what the document deliberately withholds.
  const hidden = renderQuoteEmail({ ...args, brand: { ...brand, showContact: false } });
  ok('showContact:false hides the phone and email, exactly as it does on the PDF',
    !/01202 000000/.test(hidden.html) && !/help@mth\.co\.uk/.test(hidden.html));

  ok('a non-https logo is refused rather than rendering a broken image',
    !/logo\.png/.test(renderQuoteEmail({ ...args, brand: { ...brand, logoUrl: 'http://cdn.example.com/logo.png' } }).html));
  ok('a junk colour falls back to the default rather than breaking the email',
    /#111D3E/.test(renderQuoteEmail({ ...args, brand: { ...brand, colors: { topBar: 'javascript:alert(1)' } } }).html));
  ok('a missing brand degrades to a sensible name', /Your travel team/.test(renderQuoteEmail({ quoteTitle: 'X' }).html));
  ok('a missing customer name degrades to "there"', /Hi there,/.test(renderQuoteEmail({ brand, quoteTitle: 'X' }).html));

  const c = renderQuoteEmail({ ...args, template: { subject: 'Your {quoteTitle} quote, {firstName}', body: 'Hi {firstName}\n\nHere is the quote from {company}.' } });
  ok('a client subject is used and its tags fill', c.subject === 'Your Maldives, 10 nights quote, Sarah');
  ok('client prose replaces ours entirely', /Here is the quote from MT Holidays\./.test(c.html) && !/Have a read through/.test(c.html));
  ok('...and reaches the plain-text part too', /Here is the quote from MT Holidays\./.test(c.text));
  ok('...while the branding and attachment card survive', /MT Holidays/.test(c.html) && /quote-maldives\.pdf/.test(c.html));
  ok('client prose is escaped — no HTML reaches a customer',
    !renderQuoteEmail({ ...args, template: { body: '<script>alert(1)</script>' } }).html.includes('<script>alert(1)'));
  ok('a whitespace-only message falls back to ours',
    renderQuoteEmail({ ...args, template: { subject: '  ', body: ' \n ' } }).html === d.html);
  ok('normalise keeps only subject and body, bounded',
    JSON.stringify(normaliseQuoteEmail({ subject: 'a', body: 'b', evil: 1 })) === '{"subject":"a","body":"b"}'
    && normaliseQuoteEmail({ subject: 'x'.repeat(400) }).subject.length === 200
    && Object.keys(normaliseQuoteEmail({ subject: '', body: '  ' })).length === 0);

  // CROSS GUARD: an offered tag the renderer cannot fill would reach a customer
  // as literal braces.
  const filled = renderQuoteEmail({ ...args, template: { body: QUOTE_EMAIL_TAGS.map(t => t.tag).join(' | ') } }).html;
  const literal = QUOTE_EMAIL_TAGS.filter(t => filled.includes(t.tag));
  ok('every offered tag merges to a value' + (literal.length ? ' — literal: ' + literal.map(t => t.tag).join(', ') : ''), literal.length === 0);
}

console.log('The editor writes it, previewed through the same module');
{
  ok('a Covering email section exists in Settings',
    /<span class="tgse-section-label">Covering email<\/span>/.test(EDITOR) && /id="quote-email-card"/.test(EDITOR));
  ok('the config carries an email slot', /email:\{ subject:'', body:'' \}/.test(EDITOR));
  ok('the editor loads the shared popup and the real renderer',
    /<script src="\/editor-email-popup\.js"><\/script>/.test(EDITOR)
    && /window\.TGQuoteEmail = \{ renderQuoteEmail, QUOTE_EMAIL_TAGS \};/.test(EDITOR));
  ok('a card opens the popup', /window\.TGEmailPopup\.card\(\{/.test(EDITOR) && /onEdit: openQuoteEmailPopup/.test(EDITOR));
  ok('the preview goes through the shared renderer', /T\.renderQuoteEmail\(\{/.test(EDITOR));
  ok('it previews with the SAME brand shape the server forwards',
    /function quoteEmailBrand\(\)/.test(EDITOR)
    && /showContact: C\.showContact !== false,/.test(EDITOR)
    && /colors: C\.colors \|\| \{\},/.test(EDITOR));
  ok('the extras count in the preview reflects the real attached documents',
    /extraCount: \(C\.attachments \|\| \[\]\)\.length,/.test(EDITOR));
  ok('editing marks the editor dirty', /quoteEmailCfg\(\)\[field\] = value; shell\.markDirty\(\);/.test(EDITOR));
  ok('the card refreshes on close and when config loads',
    /onClose: renderQuoteEmailCard/.test(EDITOR) && /function applyToUI\(\) \{\s*\n\s*renderQuoteEmailCard\(\);/.test(EDITOR));
  ok('reset clears back to our wording', /C\.email = \{ subject: '', body: '' \}; shell\.markDirty\(\);/.test(EDITOR));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
