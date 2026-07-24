/**
 * Quote PDF — email is send-by-reference only (audit finding #8).
 *
 * The "email me this quote" action must resolve the quote server-side from its
 * id+key (the per-quote secret from the viewer URL) and email that quote's own
 * recipient. It must NEVER take the recipient from a browser-supplied
 * quoteDocument — otherwise a caller could pass any client's public widgetId
 * (for that client's branding) plus an attacker-authored doc addressed to
 * anyone, and the platform would email a client-branded PDF to that address.
 *
 * Download is deliberately NOT gated: it returns the PDF only to the caller.
 *
 * Drives the REAL validate() + emailAllowed() and asserts the handler wiring.
 * Run: node test/quote-pdf-email-guard-smoke.mjs
 */
import { readFileSync } from 'node:fs';
import { validate, emailAllowed } from '../api/quote-pdf.js';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

// A minimal doc that passes looksLikeQuoteDoc (raw shape: item has a product).
const DOC = { items: [{ product: { name: 'Hotel' } }] };
const KEY = '2F0752A0-2AF4-46B4-922C-5B490DE7FEA3';

// ── The attack shape: email with a page-supplied doc but no id+key ───────────
// validate() still passes it on shape (a doc is a valid download body), but the
// email guard must refuse it.
const attack = validate({ action: 'email', quoteDocument: DOC, widgetId: 'tgw_victimclient' });
ok(attack.ok === true, 'page-data email passes basic shape validation (it is a valid download body)');
ok(emailAllowed(attack) === false, 'page-data email WITHOUT id+key is refused (brand-impersonation guard)');

// Even a page doc that also smuggles a recipient is refused without id+key.
const attack2 = validate({ action: 'email', quoteDocument: { items: [{ product: {}, setup: { leadEmail: 'attacker@evil.test' } }] }, widgetId: 'tgw_victimclient' });
ok(emailAllowed(attack2) === false, 'page doc carrying a recipient is still refused without id+key');

// ── The real viewer flow: email with id+key ──────────────────────────────────
const real = validate({ action: 'email', quoteId: '17820', key: KEY, widgetId: 'tgw_realclient' });
ok(real.ok === true && emailAllowed(real) === true, 'viewer email with id+key is allowed');

// id+key present but a doc is ALSO sent → still allowed, and the handler ignores
// the doc (it re-fetches server-side — proven by the wiring guard below).
const both = validate({ action: 'email', quoteId: '17820', key: KEY, quoteDocument: DOC });
ok(emailAllowed(both) === true, 'id+key present → allowed even if a doc tags along');

// Partial references are refused.
ok(emailAllowed({ quoteId: '17820', key: null }) === false, 'id without key → refused');
ok(emailAllowed({ quoteId: null, key: KEY }) === false, 'key without id → refused');
ok(emailAllowed({}) === false, 'nothing → refused');
ok(emailAllowed(null) === false, 'null → refused (never throws)');

// ── Download is NOT gated by the reference ───────────────────────────────────
const dl = validate({ action: 'download', quoteDocument: DOC, widgetId: 'tgw_x' });
ok(dl.ok === true && dl.hasDoc === true, 'page-data download stays valid (PDF returns only to the caller)');

// ── Handler wiring guard: the email branch server-fetches and never emails the
// browser doc. Source-scan, matching this suite's convention. ────────────────
const api = readFileSync(new URL('../api/quote-pdf.js', import.meta.url), 'utf8');
const emailBranch = api.slice(api.indexOf("if (v.action === 'email')"), api.indexOf('// DOWNLOAD'));
ok(/emailAllowed\(v\)/.test(emailBranch), 'email branch calls emailAllowed(v)');
ok(/email_requires_quote_ref/.test(emailBranch), 'email branch refuses with email_requires_quote_ref');
ok(/const emailDoc = scrubCosts\(await fetchQuoteDocument\(/.test(emailBranch), 'email branch fetches the quote server-side by id+key');
ok(/emailQuotePdf\(emailDoc,/.test(emailBranch), 'email branch emails the SERVER-FETCHED doc, not the browser doc');
ok(!/emailQuotePdf\(\s*doc\b/.test(emailBranch) && !/emailQuotePdf\(v\.quoteDocument/.test(emailBranch), 'email branch never passes the browser doc to emailQuotePdf');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
