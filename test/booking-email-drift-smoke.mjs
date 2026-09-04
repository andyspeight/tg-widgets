/**
 * The booking confirmation email: ONE renderer, no drift.
 *
 * Found by the adversarial pass of the Sep 2026 email audit, and the audit's
 * own blind spot: the My Booking editor previewed this email with a SECOND,
 * preview-only implementation (public/_email-template.js, 672 lines) while
 * api/booking-email.js sent a completely different one
 * (api/_lib/booking-email-template.js, 998 lines).
 *
 * They had already diverged materially:
 *   preview subject  "Your Dubai booking is confirmed — 3 Feb 2027"
 *   sent subject     "Your Dubai booking confirmation (DEMO81376)"
 * and the bodies differed in structure, headings and length (15.7KB vs 10.2KB
 * on the same order). A client checking their branding in the editor was being
 * shown an email we do not send.
 *
 * The fix: the SENT renderer moved to public/_booking-email-template.js behind
 * the usual api/_lib shim, the editor previews that, and the preview-only
 * duplicate is deleted. This suite exists to stop a second implementation
 * reappearing.
 *
 * Run: node test/booking-email-drift-smoke.mjs   (npm run test:booking-email-drift)
 */
import { readFileSync, existsSync } from 'node:fs';

const url = (p) => new URL('../' + p, import.meta.url);
const R = (p) => readFileSync(url(p), 'utf8');
const TPL = R('public/_booking-email-template.js');
const SHIM = R('api/_lib/booking-email-template.js');
const EDITOR = R('public/editor-mybooking.html');
const SENDER = R('api/booking-email.js');

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };

console.log('There is exactly one booking-confirmation renderer');
{
  ok('the duplicate preview-only template is DELETED', !existsSync(url('public/_email-template.js')));
  ok('nothing imports it any more', !/from '\/_email-template\.js'/.test(EDITOR) && !/renderEmailHtml/.test(EDITOR));
  ok('the real renderer now lives in public/', /export function renderBookingEmail\(/.test(TPL));
  ok('api/_lib/booking-email-template.js is a re-export shim of it',
    /export \* from '\.\.\/\.\.\/public\/_booking-email-template\.js';/.test(SHIM));
  ok('the sender still imports through the stable api/_lib path',
    /import \{ renderBookingEmail \} from '\.\/_lib\/booking-email-template\.js';/.test(SENDER));
  ok('the renderer is runtime-neutral, which is why the editor can preview it',
    !/^import /m.test(TPL) && !/require\(/.test(TPL) && !/\bdocument\./.test(TPL)
    && !/process\.env/.test(TPL) && !/\bBuffer\b/.test(TPL));

  const shimMod = await import('../api/_lib/booking-email-template.js');
  const pubMod = await import('../public/_booking-email-template.js');
  ok('FUNCTIONAL: both import paths resolve to the same function (drift impossible)',
    shimMod.renderBookingEmail === pubMod.renderBookingEmail);
}

console.log('The editor previews THAT renderer, with the same inputs the server uses');
{
  ok('the editor imports the shared module', /import \{ renderBookingEmail \} from '\/_booking-email-template\.js';/.test(EDITOR));
  ok('the email preview calls it', /const \{ html \} = renderBookingEmail\(\{/.test(EDITOR));
  ok('it passes the order, brand, colours and support details the server passes',
    /order: MOCK_ORDER,/.test(EDITOR) && /brand: \{/.test(EDITOR)
    && /colors: state\.config\.colors \|\| \{\},/.test(EDITOR)
    && /supportEmail: state\.config\.support\?\.email \|\| '',/.test(EDITOR)
    && /supportPhone: state\.config\.support\?\.phone \|\| '',/.test(EDITOR));
}

// ── The regression guard ─────────────────────────────────────────────────────
// Render the SAME order through the sender's import path and the editor's, and
// require byte-identical output. If anyone reintroduces a second template, or
// the shim stops pointing at the real one, this fails immediately.
console.log('FUNCTIONAL: the preview and the send produce byte-identical email');
{
  const { renderBookingEmail: viaServer } = await import('../api/_lib/booking-email-template.js');
  const { renderBookingEmail: viaEditor } = await import('../public/_booking-email-template.js');

  // The editor's own sample order, read straight out of the editor so this
  // exercises the very data a client sees rather than a copy that could rot.
  const at = EDITOR.indexOf('const MOCK_ORDER =');
  let depth = 0, start = EDITOR.indexOf('{', at), end = -1;
  for (let i = start; i < EDITOR.length; i++) {
    if (EDITOR[i] === '{') depth++;
    else if (EDITOR[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  const MOCK_ORDER = (0, eval)('(' + EDITOR.slice(start, end) + ')');
  ok('the editor still ships a sample order to preview with', !!MOCK_ORDER && Array.isArray(MOCK_ORDER.items));

  const args = {
    order: MOCK_ORDER,
    brand: { name: 'MT Holidays', logoUrl: '', footerLine: '' },
    colors: { primary: '#1B2B5B', accent: '#00B4D8' },
    supportEmail: 'help@mth.co.uk', supportPhone: '01202 000000',
    orderRef: '', baseUrl: 'https://widgets.travelify.io',
  };
  const a = viaServer(args);
  const b = viaEditor(args);
  ok('same subject', a.subject === b.subject);
  ok('same HTML, byte for byte', a.html === b.html);
  ok('same plain-text part', a.text === b.text);

  // And the sent subject is the real one, not the deleted duplicate's wording.
  ok('the subject is the SENT one ("booking confirmation (REF)"), not the old preview wording',
    /^Your .* booking confirmation \(.+\)$/.test(a.subject) && !/booking is confirmed —/.test(a.subject));
  ok('the client brand, colours and support line all reach the preview',
    /MT Holidays/.test(a.html) && /#00B4D8/i.test(a.html)
    && /Questions\?/.test(a.html) && /01202 000000/.test(a.html));
  ok('nothing renders as undefined', !/undefined/.test(a.html));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
