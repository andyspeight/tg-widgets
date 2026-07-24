/**
 * Enquiry submit — never lose a lead on an ambiguous write (24 Jul 2026 incident).
 *
 * When the master-record write times out or the connection drops, the record MAY
 * or may not have committed. The old code returned a hard 500 and dropped the
 * lead. Now writeMasterRecord reads the record back by reference + email:
 *   - committed  → return its id (success, no duplicate)
 *   - not found  → throw a RETRYABLE error → handler 503 → the widget re-sends
 *                  once (a fresh request), which is safe because we verified
 *                  nothing landed.
 *
 * This drives the REAL read-back with a mocked fetch, and source-scans the
 * recovery wiring in submit.js and the one-retry in both enquiry widgets.
 * Run: node test/enquiry-write-recovery-smoke.mjs
 */
import { readFileSync } from 'node:fs';
import { _test } from '../api/enquiry/submit.js';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };
const { findSubmissionByReference } = _test;

const realFetch = global.fetch;
let lastUrl = null;
const mock = (impl) => { global.fetch = async (url, opts) => { lastUrl = String(url); return impl(String(url), opts); }; };

// ── committed: read-back finds the record → returns its id ────────────────────
mock(() => ({ ok: true, json: async () => ({ records: [{ id: 'recFOUND12345678' }] }) }));
let id = await findSubmissionByReference('TG-2026-04823', 'jo@example.com');
ok(id === 'recFOUND12345678', 'read-back returns the record id when the write DID land');
ok(/filterByFormula=/.test(lastUrl), 'read-back queries by filterByFormula');
const decoded = decodeURIComponent(lastUrl);
ok(/\{Reference\}="TG-2026-04823"/.test(decoded), 'formula matches on the exact reference');
ok(/LOWER\(\{Email\}\)="jo@example\.com"/.test(decoded), 'formula also pins the email (guards the rare reference collision)');

// ── not committed: no record → null (caller will ask for a safe retry) ────────
mock(() => ({ ok: true, json: async () => ({ records: [] }) }));
id = await findSubmissionByReference('TG-2026-04824', 'jo@example.com');
ok(id === null, 'read-back returns null when the write did NOT land');

// ── fail-safe: any error → null, never throws (blinding the caller is worse) ──
mock(() => ({ ok: false, status: 500, json: async () => ({}) }));
id = await findSubmissionByReference('TG-2026-04825', 'jo@example.com');
ok(id === null, 'read-back HTTP error → null');

mock(() => { throw new Error('network down'); });
id = await findSubmissionByReference('TG-2026-04826', 'jo@example.com');
ok(id === null, 'read-back network throw → null (never throws)');

// ── no email → reference-only formula (still works) ──────────────────────────
mock(() => ({ ok: true, json: async () => ({ records: [{ id: 'recX' }] }) }));
id = await findSubmissionByReference('TG-2026-04827', '');
ok(id === 'recX' && !/Email/.test(decodeURIComponent(lastUrl)), 'no email → reference-only formula');

global.fetch = realFetch;

// ── Wiring guard: submit.js recovers instead of dropping the lead ────────────
const submit = readFileSync(new URL('../api/enquiry/submit.js', import.meta.url), 'utf8');
ok(/if \(err\.httpError\) throw err;/.test(submit), 'submit: a definitive HTTP error is not treated as ambiguous');
ok(/const landedId = await findSubmissionByReference\(reference, email\);/.test(submit), 'submit: ambiguous failure verifies via read-back');
ok(/if \(landedId\) return landedId;/.test(submit), 'submit: a committed write returns success (no duplicate)');
ok(/retryErr\.retryable = true;/.test(submit), 'submit: a verified-not-committed write is retryable (503, not a hard 500)');

// ── Wiring guard: both enquiry widgets retry once on a retryable 503 ─────────
for (const w of ['../public/widget-enquirypro.js', '../public/widget-enquiry.js']) {
  const src = readFileSync(new URL(w, import.meta.url), 'utf8');
  const name = w.split('/').pop();
  // Both widgets use a one-retry guard; the response var is `res` (pro) or
  // `result` (standard). Match either.
  ok(/attemptNo === 1 && (\w+)\.status === 503 && \1\.body && \1\.body\.retryable/.test(src),
    `${name}: retries once on a retryable 503`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
