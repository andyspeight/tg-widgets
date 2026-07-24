/**
 * Editors must not hand-roll a Bearer auth header (audit finding #16).
 *
 * The shell owns auth: tgse.authHeaders() sets a Bearer only for a legacy token
 * session, and the shell's fetch interceptor adds credentials:'include' to
 * same-origin /api/* calls so a cookie session authenticates automatically. An
 * editor that reads a token out of local storage and attaches its own
 * "Bearer <token>" can send a STALE token and 401 a save even when the cookie
 * session is valid — exactly the bug reported in several editors.
 *
 * This guard scans every editor page and fails if any reconstructs a Bearer
 * header in code, so the pattern cannot creep back. (CLAUDE.md: "Never set
 * manual auth headers.")
 *
 * Run: node test/editor-auth-no-bearer-smoke.mjs
 */
import { readdirSync, readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

const dir = new URL('../public/', import.meta.url);
const editors = readdirSync(dir).filter((f) => /^editor-.*\.html$/.test(f)).sort();
ok(editors.length >= 20, `found the editor pages to scan (${editors.length})`);

// Actual code shapes that build a Bearer from a variable — NOT the word "Bearer"
// in prose/comments, which is fine.
const BAD = [
  /['"]Bearer ['"]\s*\+/,                     // 'Bearer ' + token
  /`Bearer \$\{/,                             // `Bearer ${token}`
  /['"]Authorization['"]\s*\]\s*=\s*['"]Bearer/, // h['Authorization'] = 'Bearer...'
];

for (const f of editors) {
  const src = readFileSync(new URL(f, dir), 'utf8');
  const hit = BAD.find((re) => re.test(src));
  ok(!hit, `${f} does not hand-roll a Bearer header${hit ? ' (matched ' + hit + ')' : ''}`);
}

// The eight editors named in the finding (plus enquiry, found in the sweep) must
// delegate to the shell's helper.
const DELEGATES = ['editor-weather.html', 'editor-textfx.html', 'editor-mybooking.html',
  'editor-countdown.html', 'editor-logos.html', 'editor-spotlight.html', 'editor-faq.html',
  'editor-testimonials.html', 'editor-enquiry.html'];
for (const f of DELEGATES) {
  const src = readFileSync(new URL(f, dir), 'utf8');
  ok(/tgse\.authHeaders/.test(src), `${f} delegates auth to tgse.authHeaders()`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
