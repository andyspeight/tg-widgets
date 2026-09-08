/**
 * Quote PDF — replies go to the client, and the email is sent from the
 * client's own address where their domain is authenticated with SendGrid.
 *
 * Before 8 Sep 2026 the covering email went out from noreply@travelify.io in
 * the client's name and set NO Reply-To, so a customer who hit Reply wrote to
 * our noreply address. Clients asked for the "from address" to be theirs.
 * Sending from a domain we have not authenticated fails the client's own DMARC
 * and lands in spam, so the rule (Andy's call for the Enquiry widget, 20 Jul
 * 2026) is now shared: Reply-To is always the client; the From ADDRESS is the
 * client's only when canSendFrom() says their domain is authenticated.
 *
 * Drives the REAL shared check with a captured SendGrid fetch, the REAL
 * template normaliser, the REAL reply-to resolver lifted from api/quote-pdf.js,
 * and the REAL status endpoint, then guards the sources.
 *
 * Run: node test/quote-sender-smoke.mjs   (npm run test:quote-sender)
 */
import { readFileSync } from 'node:fs';

const R = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };

process.env.SENDGRID_API_KEY = 'SG.test.key';
process.env.SENDGRID_FROM_EMAIL = 'noreply@travelify.io';
delete process.env.TG_AUTHENTICATED_SENDER_DOMAINS;

// SendGrid's authenticated-domain list, as the shared check fetches it.
let authDomains = ['freefromtravel.com'];
let domainLookups = 0;
global.fetch = async (url) => {
  const u = String(url);
  if (u.includes('/v3/whitelabel/domains')) {
    domainLookups++;
    return { ok: true, status: 200, json: async () => authDomains.map(d => ({ domain: d, valid: true })) };
  }
  throw new Error('unexpected fetch ' + u);
};

const sg = await import('../api/_lib/sendgrid.js');
const tpl = await import('../public/_quote-email-template.js');

console.log('The shared check: canSendFrom');
{
  ok('no address → false', (await sg.canSendFrom('')) === false && (await sg.canSendFrom('not-an-email')) === false);
  process.env.TG_AUTHENTICATED_SENDER_DOMAINS = 'dreamhols.example, other.example';
  ok('env allowlist → true, without asking SendGrid', (await sg.canSendFrom('sales@dreamhols.example')) === true && domainLookups === 0);
  ok('a subdomain of an allowlisted domain → true', (await sg.canSendFrom('bookings@mail.dreamhols.example')) === true);
  delete process.env.TG_AUTHENTICATED_SENDER_DOMAINS;
  ok("SendGrid's own list → true for an authenticated domain", (await sg.canSendFrom('george@freefromtravel.com')) === true);
  ok('a personal address on gmail → false', (await sg.canSendFrom('owner@gmail.com')) === false);
  const before = domainLookups;
  await sg.canSendFrom('again@freefromtravel.com');
  ok('the domain list is cached, not fetched per send', domainLookups === before);
  ok('platformSenderEmail() is the verified sender', sg.platformSenderEmail() === 'noreply@travelify.io');
  const own = await sg.resolveSender('Free From Travel', 'george@freefromtravel.com');
  ok("resolveSender uses the client's address when authenticated", own.email === 'george@freefromtravel.com' && own.name === 'Free From Travel');
  const plat = await sg.resolveSender('Sunny Breaks', 'owner@gmail.com');
  ok('resolveSender falls back to the platform sender otherwise', plat.email === 'noreply@travelify.io' && plat.name === 'Sunny Breaks');
}

console.log('\nThe template carries the reply-to rule for editor and sender alike');
{
  ok('isEmailAddress accepts a plain address', tpl.isEmailAddress('hello@justsardinia.co.uk'));
  ok('isEmailAddress rejects angle brackets, spaces and blanks',
    !tpl.isEmailAddress('<hello@justsardinia.co.uk>') && !tpl.isEmailAddress('hello @x.co') && !tpl.isEmailAddress('') && !tpl.isEmailAddress(null));
  ok('isEmailAddress caps at 120 characters', tpl.isEmailAddress('a'.repeat(115) + '@x.co') && !tpl.isEmailAddress('a'.repeat(116) + '@x.co'));
  const n = tpl.normaliseQuoteEmail({ subject: '', body: '', replyTo: '  Sales@JustSardinia.co.uk ' });
  ok('normaliseQuoteEmail keeps a valid replyTo, trimmed and lower-cased', n.replyTo === 'sales@justsardinia.co.uk');
  ok('and does not turn a blank wording into custom wording', !('subject' in n) && !('body' in n));
  ok('a junk replyTo is dropped', !('replyTo' in tpl.normaliseQuoteEmail({ replyTo: 'not an email' })));
  ok('old configs with no replyTo still normalise to {}', Object.keys(tpl.normaliseQuoteEmail({ subject: '', body: '' })).length === 0);
}

console.log('\nThe quote sender: where replies go and who it is from');
const SENDER = R('api/quote-pdf.js');
{
  // Lift the real resolver out of the endpoint (its imports pull in the PDF
  // engine, which this test does not need).
  const start = SENDER.indexOf('function resolveQuoteReplyTo(opts) {');
  const end = SENDER.indexOf('\nasync function emailQuotePdf(');
  ok('resolveQuoteReplyTo exists in the endpoint', start > 0 && end > start);
  const src = SENDER.slice(start, end);
  const resolveQuoteReplyTo = new Function('normaliseQuoteEmail', 'isEmailAddress', src + '\nreturn resolveQuoteReplyTo;')(tpl.normaliseQuoteEmail, tpl.isEmailAddress);

  const full = { email: { replyTo: 'Quotes@JustSardinia.co.uk' }, brand: { supportEmail: 'hello@justsardinia.co.uk' }, replyToFallbacks: ['owner@justsardinia.co.uk', 'account@agendas.group'] };
  ok("the client's own Replies-go-to wins", resolveQuoteReplyTo(full) === 'quotes@justsardinia.co.uk');
  ok('then the support email on the PDF', resolveQuoteReplyTo({ ...full, email: {} }) === 'hello@justsardinia.co.uk');
  ok('then the record-level FromEmail', resolveQuoteReplyTo({ ...full, email: {}, brand: {} }) === 'owner@justsardinia.co.uk');
  ok('then the account email', resolveQuoteReplyTo({ email: {}, brand: {}, replyToFallbacks: ['', 'account@agendas.group'] }) === 'account@agendas.group');
  ok('a junk entry is skipped, not used', resolveQuoteReplyTo({ email: { replyTo: 'junk' }, brand: { supportEmail: 'hello@justsardinia.co.uk' } }) === 'hello@justsardinia.co.uk');
  ok('the demo (no widget) has no Reply-To', resolveQuoteReplyTo(undefined) === null && resolveQuoteReplyTo({}) === null);

  ok('the endpoint imports the shared check and the shared address rule',
    /import \{ canSendFrom \} from '\.\/_lib\/sendgrid\.js'/.test(SENDER) && /isEmailAddress \} from '\.\.\/public\/_quote-email-template\.js'/.test(SENDER));
  ok('resolveContext passes FromEmail then ClientEmail as fallbacks',
    /opts\.replyToFallbacks = \[widget\.fields\?\.FromEmail, widget\.fields\?\.ClientEmail\]/.test(SENDER));
  ok('the send sets Reply-To to the client', /message\.replyTo = \{ email: replyTo, name: fromName \}/.test(SENDER));
  ok("the From address is the client's only when canSendFrom says so",
    /const sendFromOwn = !!\(replyTo && await canSendFrom\(replyTo\)\)/.test(SENDER) && /email: sendFromOwn \? replyTo : fromEmail/.test(SENDER));
  ok('the result reports from and replyTo for the log', /from: message\.from\.email, replyTo: replyTo \|\| null/.test(SENDER));
}

console.log('\nOne check, shared with the Enquiry widget');
{
  const ENQ = R('api/enquiry/_lib/routing/sendgrid.js');
  ok('the enquiry sender imports canSendFrom from the shared wrapper', /import \{ canSendFrom \} from '\.\.\/\.\.\/\.\.\/_lib\/sendgrid\.js'/.test(ENQ));
  ok('and no longer keeps its own copy of the domain lookup', !/function fetchAuthenticatedDomains/.test(ENQ) && !/whitelabel\/domains/.test(ENQ));
  ok('resolveFromIdentity keeps its signature for email.js and auto-reply.js', /export async function resolveFromIdentity\(displayName, preferredEmail\)/.test(ENQ));
}

console.log('\nThe status endpoint the editor asks');
const EP = R('api/sender-identity.js');
{
  ok('GET only, signed-in only', /req\.method !== 'GET'/.test(EP) && /requireAuth\(req\)/.test(EP) && /auth\.error/.test(EP));
  ok('rate limited per user', /applyRateLimit\(res, `sender-identity:\$\{who\}`/.test(EP));
  ok('answers with the same shared check', /canSendFrom\(email\)/.test(EP));
  ok('never lists domains', !/whitelabel/.test(EP) && !/fetchAuthenticatedDomains/.test(EP));
  // api/_auth.js needs jsonwebtoken. Where a sandbox has not installed it the
  // functional checks are skipped with a note rather than failed, since the
  // source guards above already pin the endpoint's shape.
  let handler = null, importError = null;
  try { handler = (await import('../api/sender-identity.js')).default; } catch (e) { importError = e; }
  if (importError && /Cannot find package/.test(importError.message)) {
    console.log('  - endpoint functional checks skipped (' + importError.message.split('\n')[0] + ')');
  } else {
    ok('the endpoint module loads', typeof handler === 'function');
  }
  if (handler) {
    const call = async (method, query, headers = {}) => {
      const out = { status: 0, body: null, headers: {} };
      const res = { setHeader: (k, v) => { out.headers[k] = v; }, status: (c) => { out.status = c; return res; }, json: (b) => { out.body = b; return res; }, end: () => res };
      await handler({ method, query, headers, socket: {} }, res);
      return out;
    };
    const anon = await call('GET', { email: 'george@freefromtravel.com' });
    ok('an anonymous call is refused, not answered', anon.status === 401 && !anon.body?.ownDomain);
    const post = await call('POST', { email: 'george@freefromtravel.com' });
    ok('POST is refused', post.status === 405);
  }
}

console.log('\nThe editor: the field, the hint and the popup envelope');
const EDITOR = R('public/editor-quote-pdf.html');
{
  ok('the config carries a replyTo slot', /email:\{ subject:'', body:'', replyTo:'' \}/.test(EDITOR));
  ok('a "Replies go to" field sits in the Covering email section', /<label class="tgse-field-label" for="replyTo">Replies go to<\/label>/.test(EDITOR) && /<input type="email" id="replyTo" maxlength="120"/.test(EDITOR));
  ok('a hint under it says how the email will be sent', /id="sender-hint"/.test(EDITOR) && /Your quotes will be sent from/.test(EDITOR));
  ok('the hint asks the status endpoint for the effective reply-to', /fetch\('\/api\/sender-identity\?email=' \+ encodeURIComponent\(addr\)/.test(EDITOR));
  ok('the effective reply-to falls back to the support email, like the sender', /return String\(quoteEmailCfg\(\)\.replyTo \|\| C\.supportEmail \|\| ''\)\.trim\(\)/.test(EDITOR));
  ok('the popup From line shows the real sending address', /from: senderFromLine,/.test(EDITOR) && /name \+ ' <' \+ senderInfo\.from \+ '>'/.test(EDITOR));
  ok('typing marks the editor dirty and re-checks', /quoteEmailCfg\(\)\.replyTo = e\.target\.value\.trim\(\); shell\.markDirty\(\); refreshSenderStatus\(\);/.test(EDITOR));
  ok('editing the support email re-checks too', /\$\('supportEmail'\)\.addEventListener\('input', refreshSenderStatus\)/.test(EDITOR));
  ok('loading a saved widget fills the field', /\$\('replyTo'\)\.value = quoteEmailCfg\(\)\.replyTo \|\| '';/.test(EDITOR));
  ok('resetting the wording keeps the reply-to address', /C\.email = \{ subject: '', body: '', replyTo: quoteEmailCfg\(\)\.replyTo \|\| '' \}; shell\.markDirty\(\);/.test(EDITOR));
  ok('the wording of the three states is plain and honest',
    /replies will go to ' \+ addr/.test(EDITOR) && /ask us to authenticate your domain/.test(EDITOR) && /Your domain is authenticated with us/.test(EDITOR));
  ok('no em dashes in the new copy', !/Your quotes will be sent[^\n]*—/.test(EDITOR));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
