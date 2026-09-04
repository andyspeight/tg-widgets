/**
 * Enquiry / Enquiry Pro — the customer + team email POPUP editor (Andy, Sep
 * 2026: "upgrade them to the same email set up / edit as we have done for my
 * booking", after an audit found this the strongest remaining case).
 *
 * Before: every enquiry submission sent two emails, one of them to the
 * visitor, and the only way to change either was to hand-write raw HTML into
 * a four-row textarea with no preview, no subject control, and a hint that
 * documented {{fieldName}} placeholders neither sender has ever matched (both
 * substitute single braces), so a client following our own instructions
 * shipped literal braces to their customer.
 *
 * Now: both renderers live in public/ behind re-export shims, so the editor
 * previews the exact module the server sends; a client writes plain PROSE for
 * the customer email plus their own subject; and raw HTML survives as an
 * advanced override so no existing client breaks.
 *
 * Source guards for the editor (a 8,500-line page booted behind SSO), and
 * FUNCTIONAL checks against the real renderers and the real token plumbing.
 *
 * Run: node test/enquiry-email-editor-smoke.mjs   (npm run test:enquiry-email-editor)
 */
import { readFileSync } from 'node:fs';

const R = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const EDITOR = R('public/editor-enquiry.html');
const AUTOREPLY = R('public/_enquiry-autoreply-email.js');
const AGENT = R('public/_enquiry-agent-email.js');
const AUTOREPLY_SHIM = R('api/enquiry/_lib/routing/_templates/auto-reply-email.js');
const AGENT_SHIM = R('api/enquiry/_lib/routing/_templates/agent-email.js');
const SENDER = R('api/enquiry/_lib/routing/auto-reply.js');
const AGENT_SENDER = R('api/enquiry/_lib/routing/email.js');
const CONFIG_API = R('api/enquiry-form-config.js');
const COPY_API = R('api/enquiry-form-copy.js');

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };

console.log('One renderer each, shared by the sender and the editor preview');
{
  ok('both renderers live in public/', /export function renderDefaultAutoReplyEmail\(/.test(AUTOREPLY) && /export function renderDefaultAgentEmail\(/.test(AGENT));
  ok('the old _templates paths are re-export shims',
    /export \* from '\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/public\/_enquiry-autoreply-email\.js';/.test(AUTOREPLY_SHIM)
    && /export \* from '\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/public\/_enquiry-agent-email\.js';/.test(AGENT_SHIM));
  ok('the senders still import through the stable _templates path',
    /from '\.\/_templates\/auto-reply-email\.js'/.test(SENDER) && /from '\.\/_templates\/agent-email\.js'/.test(AGENT_SENDER));
  ok('both stay runtime-neutral (no Node/DOM, previewable in the browser)',
    [AUTOREPLY, AGENT].every(src => !/^import /m.test(src) && !/require\(/.test(src) && !/\bdocument\./.test(src) && !/process\.env/.test(src) && !/\bBuffer\b/.test(src)));

  const shimA = await import('../api/enquiry/_lib/routing/_templates/auto-reply-email.js');
  const pubA = await import('../public/_enquiry-autoreply-email.js');
  const shimB = await import('../api/enquiry/_lib/routing/_templates/agent-email.js');
  const pubB = await import('../public/_enquiry-agent-email.js');
  ok('FUNCTIONAL: each import path resolves to the same function (zero drift possible)',
    shimA.renderDefaultAutoReplyEmail === pubA.renderDefaultAutoReplyEmail
    && shimB.renderDefaultAgentEmail === pubB.renderDefaultAgentEmail);
}

console.log('The customer email takes plain prose, not hand-written HTML');
{
  const { renderDefaultAutoReplyEmail: render } = await import('../public/_enquiry-autoreply-email.js');
  const base = { reference: 'EF-1042', clientName: 'Travelaire', firstName: 'Sarah', destinations: 'Crete', travellers: '2 adults' };
  const std = render(base);
  ok('with no message we send our standard "what happens next" steps',
    /What happens next/.test(std) && /match it against our trusted supplier network/.test(std));

  const custom = render({ ...base, customMessage: 'We have your enquiry.\n\nOur Crete specialist will call you today.' });
  ok('a client message replaces those steps', !/What happens next/.test(custom) && /Our Crete specialist will call you today\./.test(custom));
  ok('blank lines become separate paragraphs', (custom.match(/<p style="margin:0 0 14px;color:#475569/g) || []).length === 2);
  ok('their branding, the recap and the sign-off all survive',
    /Here's what you told us/.test(custom) && /The team at Travelaire/.test(custom) && /Reference EF-1042/.test(custom));
  ok('prose is escaped — no client HTML reaches a customer inbox by this route',
    !render({ ...base, customMessage: '<script>alert(1)</script>' }).includes('<script>alert(1)'));
  ok('a whitespace-only message is treated as blank', render({ ...base, customMessage: '   \n  ' }) === std);
}

console.log('The sender reads the new wording, and the subject is editable at last');
{
  ok('the sender maps both new Airtable fields',
    /autoReplyMessage:\s*'fld1mtgr6TXZj192p'/.test(SENDER) && /autoReplySubject:\s*'fldN5C4L7TyUAWjxI'/.test(SENDER));
  ok('the prose reaches the renderer as customMessage', /customMessage: \(form\.fields\[F\.autoReplyMessage\] \|\| ''\)/.test(SENDER));
  ok('the subject is the client\'s when set, ours when not',
    /const customSubject = \(form\.fields\[F\.autoReplySubject\] \|\| ''\)\.trim\(\);/.test(SENDER)
    && /Your enquiry \$\{reference\} — we've got it/.test(SENDER));
  ok('subject tokens go in RAW (escaping would put &#39; in the inbox)',
    /Subject\s*\n\s*\/\/ lines are plain text, so tokens go in RAW/.test(SENDER) || /tokens go in RAW/.test(SENDER));
  ok('a subject that merges to nothing still falls back to ours',
    /\.slice\(0, 200\)\.trim\(\) \|\| `Your enquiry \$\{reference\}/.test(SENDER));
  ok('the raw-HTML override still wins, so no existing client breaks',
    /const customHtml = form\.fields\[F\.autoReplyHTML\];/.test(SENDER) && /customHtml && customHtml\.trim\(\)/.test(SENDER));
}

console.log('The config API and the duplicate-form path both carry the new wording');
{
  ok('field map has both new fields',
    /autoReplyMessage:\s*'fld1mtgr6TXZj192p'/.test(CONFIG_API) && /autoReplySubject:\s*'fldN5C4L7TyUAWjxI'/.test(CONFIG_API));
  ok('write path persists them, capped', /fields\[EF\.autoReplyMessage\] = safeStr\(r\.email\.autoReplyMessage, 8000\)/.test(CONFIG_API)
    && /fields\[EF\.autoReplySubject\] = safeStr\(r\.email\.autoReplySubject, 200\)/.test(CONFIG_API));
  ok('read path returns them to the editor', /autoReplyMessage: f\[EF\.autoReplyMessage\] \|\| ''/.test(CONFIG_API)
    && /autoReplySubject: f\[EF\.autoReplySubject\] \|\| ''/.test(CONFIG_API));
  // enquiry-form-copy copies field-by-field from its OWN map, so a field missing
  // there is silently dropped when a client duplicates a form.
  ok('duplicating a form carries the wording across (copy map updated too)',
    /autoReplyMessage:\s*'fld1mtgr6TXZj192p'/.test(COPY_API) && /autoReplySubject:\s*'fldN5C4L7TyUAWjxI'/.test(COPY_API));
  ok('the editor default config declares both keys',
    /autoReplyMessage: '', autoReplySubject: ''/.test(EDITOR));
}

console.log('The editor: cards and a popup, not two four-row boxes');
{
  ok('the cramped custom-template textareas are gone',
    !/Agent notification HTML \(optional\)/.test(EDITOR) && !/Auto-reply HTML \(optional\)/.test(EDITOR));
  ok('the wrong {{fieldName}} hint is gone from the UI',
    !/Use \{\{fieldName\}\} placeholders/.test(EDITOR) && !/Same \{\{fieldName\}\} placeholders/.test(EDITOR));
  ok('an "Email wording" section with a card per email opens the popup',
    /section\('Email wording'/.test(EDITOR)
    && /openEmailPopup\(cfg, save, 'customer'\)/.test(EDITOR)
    && /openEmailPopup\(cfg, save, 'agent'\)/.test(EDITOR));
  ok('each card says whether the client wording is in use',
    /Using our standard wording/.test(EDITOR) && /Your own wording/.test(EDITOR) && /Your own HTML/.test(EDITOR));
  // The popup CHROME (sandboxed preview, envelope bar, tabs, every close path)
  // now lives in public/editor-email-popup.js and is covered by
  // test/editor-email-popup-smoke.mjs — one component, one place to test it.
  ok('it loads the shared popup component and opens it',
    /<script src="\/editor-email-popup\.js"><\/script>/.test(EDITOR) && /window\.TGEmailPopup\.open\(\{/.test(EDITOR));
  ok('...and carries no popup chrome of its own any more',
    !/eml-overlay/.test(EDITOR) && !/eml-modal/.test(EDITOR) && !/data-env-from/.test(EDITOR));
  ok('its sidebar cards come from the shared component too',
    /window\.TGEmailPopup\.card\(\{ title: title, status: statusText, isCustom: isCustom, onEdit: onEdit \}\)/.test(EDITOR));
  ok('both emails are handed over, with the clicked one as the start tab',
    /\['customer', 'agent'\]\.map\(/.test(EDITOR) && /startKey: defs\[startTab\] \? startTab : 'customer'/.test(EDITOR));
  ok('closing refreshes the sidebar cards', /onClose: renderInspector/.test(EDITOR));
  ok('the team notification is given no prose or subject field (its body is a generated readout)',
    /prose: false/.test(EDITOR) && /fields: def\.prose \? \[/.test(EDITOR));
  ok('raw HTML survives as an advanced override',
    /type: 'advanced', label: def\.advLabel/.test(EDITOR) && /Advanced: replace the whole email with your own HTML/.test(EDITOR));
  ok('the customer email keeps its subject, tags and growing message box',
    /key: 'subject', type: 'text', label: 'Subject', maxlength: 200/.test(EDITOR)
    && /tags: def\.prose \? EML_TAGS : \[\]/.test(EDITOR)
    && /grow: true/.test(EDITOR));
  ok('saving is debounced so a keystroke does not repaint the palette',
    /emlDefs\(cfg, debounce\(save, 250\)\)/.test(EDITOR));
  ok('the preview warns when the customer email is switched off',
    /This email is switched off/.test(EDITOR));
}

// ── CROSS GUARD ──────────────────────────────────────────────────────────────
// Every tag the popup offers must be one BOTH the sample previewer and the real
// sender fill, or a client is handed a tag that renders literally in a real
// customer's inbox — which is exactly the {{fieldName}} bug being fixed here.
console.log('Every tag the popup offers is one the real sender fills');
{
  const offered = [...EDITOR.matchAll(/\{ tag: '\{(\w+)\}',\s*label:/g)].map(m => m[1]);
  ok('the popup offers a set of tags', offered.length >= 6);

  // The sender's token map: everything returned by buildTokens in auto-reply.js.
  const bt = SENDER.slice(SENDER.indexOf('  return {', SENDER.indexOf('function buildTokens')));
  // Match both `clientName: value` and ES shorthand `reference,` entries —
  // missing the shorthand ones would report real tokens as orphans.
  const senderTokens = new Set(
    (bt.slice(0, bt.indexOf('\n  };')).match(/^\s{4}(\w+)\s*[:,]/gm) || [])
      .map(x => x.trim().replace(/[:,]$/, '').trim()));
  const orphan = offered.filter(t => !senderTokens.has(t));
  ok('no offered tag is unknown to the sender (offered ⊆ sent)' + (orphan.length ? ' — orphan: ' + orphan.join(', ') : ''), orphan.length === 0);

  // ...and the editor's own sample map must fill each one, so the preview never
  // shows an unmerged {tag}.
  const sv = EDITOR.slice(EDITOR.indexOf('function emlSampleTokens'));
  const sampled = new Set((sv.slice(0, sv.indexOf('\n    }')).match(/(\w+):/g) || []).map(x => x.replace(':', '')));
  const unsampled = offered.filter(t => !sampled.has(t));
  ok('every offered tag has a preview sample value' + (unsampled.length ? ' — missing: ' + unsampled.join(', ') : ''), unsampled.length === 0);

  ok('the popup substitutes SINGLE braces, exactly like both senders',
    /\/\\\{\(\\w\+\)\\\}\/g/.test(EDITOR)
    && /html\.replace\(\/\\\{\(\\w\+\)\\\}\/g/.test(SENDER + AGENT_SENDER));
}


// ── END TO END ───────────────────────────────────────────────────────────────
// Source guards prove the wiring is present; this proves it WORKS. Drives the
// REAL sendAutoReply with a captured SendGrid fetch, exactly as
// enquiry-email-fields-smoke.mjs drives the agent sender, and asserts the new
// Airtable fields actually change the email that leaves the building.
console.log('End to end — the real sender, with the real fields, over a captured SendGrid');
{
  process.env.SENDGRID_API_KEY = 'SG.test.key';
  process.env.SENDGRID_FROM_EMAIL = 'noreply@travelify.io';
  const { default: sendAutoReply } = await import('../api/enquiry/_lib/routing/auto-reply.js');

  const F = {
    clientName: 'fldrw1eTFYCFIo0pp', routingEmailTo: 'fldlu1HcErBfp2wh2',
    autoReplyHTML: 'fldTocc7Yd5IurXVl', autoReplyMessage: 'fld1mtgr6TXZj192p',
    autoReplySubject: 'fldN5C4L7TyUAWjxI', thankYouMessage: 'fldiB3PkfcsHRKEWd',
  };
  let captured = [];
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('/v3/whitelabel/domains')) return { ok: false, status: 403, json: async () => ({}) };
    captured.push(JSON.parse(opts.body));
    return { ok: true, status: 202, headers: { get: () => 'msg-1' }, text: async () => '' };
  };
  const send = async (extraFields) => {
    captured = [];
    await sendAutoReply({
      form: { id: 'recFORM', fields: Object.assign({
        [F.clientName]: 'Travelaire', [F.routingEmailTo]: 'agent@example.com',
      }, extraFields) },
      payload: { fields: {
        email: 'sarah@example.com', first_name: 'Sarah', last_name: 'Jones',
        destinations: [{ name: 'Hersonissos', parentCountry: 'Greece' }],
      }, sourceUrl: 'https://client.example/enquire' },
      reference: 'EF-1042', submissionId: 'recSUB1',
    });
    return captured[0];
  };

  const plain = await send({});
  ok('with nothing set: our subject and our standard steps',
    plain.subject === "Your enquiry EF-1042 — we've got it"
    && /What happens next/.test(plain.content[0].value));

  const prose = await send({ [F.autoReplyMessage]: 'Hi {firstName}, your Greece expert is on it.\n\nExpect a call today.' });
  const proseHtml = prose.content[0].value;
  ok('a client message reaches the real email and replaces our steps',
    /your Greece expert is on it\./.test(proseHtml) && !/What happens next/.test(proseHtml));
  ok('{firstName} in the message is filled at send time', /Hi Sarah, your Greece expert/.test(proseHtml));
  ok('their branding and the sign-off still ship', /The team at Travelaire/.test(proseHtml));

  const subj = await send({ [F.autoReplySubject]: 'We have your {destinations} enquiry, {firstName}' });
  ok('a client subject is used and its tokens are filled',
    subj.subject === 'We have your Hersonissos (Greece) enquiry, Sarah');
  ok("...and it is NOT html-escaped (an apostrophe must not become &#39;)",
    !/&#39;|&amp;/.test((await send({ [F.autoReplySubject]: "Sarah's trip — {reference}" })).subject));

  const legacy = await send({ [F.autoReplyHTML]: '<p>Legacy {firstName}</p>', [F.autoReplyMessage]: 'ignored prose' });
  ok('an existing client\'s raw HTML still wins over the new prose field',
    /<p>Legacy Sarah<\/p>/.test(legacy.content[0].value) && !/ignored prose/.test(legacy.content[0].value));

  const blank = await send({ [F.autoReplyMessage]: '   ', [F.autoReplySubject]: '   ' });
  ok('whitespace-only settings fall back to ours, not to an empty email',
    blank.subject === "Your enquiry EF-1042 — we've got it" && /What happens next/.test(blank.content[0].value));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
