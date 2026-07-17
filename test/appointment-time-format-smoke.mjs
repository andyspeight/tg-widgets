/**
 * Appointment / calendar — noon & midnight format correctly (not "0:00pm").
 *
 * A client's confirmation email showed "Friday, 17 July 2026 at 0:00pm" for a
 * noon booking. Cause: Intl.DateTimeFormat('en-GB', { hour12: true }) resolves
 * to the h11 hour cycle on some ICU builds (Vercel's Lambda runtime), which
 * numbers a 12-hour clock 0–11, so noon → "0:00pm" and midnight → "0:00am".
 * The fix pins hourCycle:'h12' (1–12 clock) everywhere the booking flow prints
 * a time: the email, the picker widget, the share/manage/bookings/book pages.
 *
 * Two layers:
 *   1. Behavioural — drive the REAL whenString() from mail.js and check noon /
 *      midnight read "12:00". (In this Node's ICU en-GB+hour12 already gives
 *      h12, so this confirms correctness and catches an accidental h11.)
 *   2. Source guard — assert every formatter in the suite uses hourCycle and no
 *      longer uses the fragile hour12 option. This is what actually catches a
 *      revert to the buggy pattern, since this env can't reproduce h11.
 *
 * Run: node test/appointment-time-format-smoke.mjs
 */
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

function sliceBalanced(src, fromIdx) {
  let i = src.indexOf('{', fromIdx); const open = i;
  let d = 0, str = null, line = false, block = false;
  for (; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (line) { if (c === '\n') line = false; continue; }
    if (block) { if (c === '*' && n === '/') { block = false; i++; } continue; }
    if (str) { if (c === '\\') { i++; continue; } if (c === str) str = null; continue; }
    if (c === '/' && n === '/') { line = true; i++; continue; }
    if (c === '/' && n === '*') { block = true; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { str = c; continue; }
    if (c === '{') d++; else if (c === '}') { d--; if (d === 0) return src.slice(open, i + 1); }
  }
  throw new Error('unbalanced');
}
function ex(src, sig) { const at = src.indexOf(sig); if (at < 0) throw new Error('not found: ' + sig); return sig + sliceBalanced(src, at + sig.length); }

const url = (p) => new URL('../' + p, import.meta.url);
const mail = readFileSync(url('api/_lib/calendar/mail.js'), 'utf8');

// ── Behavioural: the real whenString ─────────────────────────────────────────
// eslint-disable-next-line no-eval
const whenString = eval('(' + ex(mail, 'export function whenString(iso, tz)').replace('export function', 'function') + ')');

const TZ = 'Europe/London';
ok(whenString('2026-07-17T12:00:00+01:00', TZ) === 'Friday, 17 July 2026 at 12:00pm', 'noon (BST) → 12:00pm (not 0:00pm)');
ok(whenString('2026-07-17T00:00:00+01:00', TZ) === 'Friday, 17 July 2026 at 12:00am', 'midnight (BST) → 12:00am (not 0:00am)');
ok(whenString('2026-07-17T13:00:00+01:00', TZ) === 'Friday, 17 July 2026 at 1:00pm', 'afternoon → 1:00pm');
ok(whenString('2026-07-17T11:00:00+01:00', TZ) === 'Friday, 17 July 2026 at 11:00am', 'late morning → 11:00am');
// A winter (GMT) noon, to make sure the fix isn't DST-specific.
ok(/at 12:00pm$/.test(whenString('2026-01-17T12:00:00+00:00', TZ)), 'noon (GMT) → 12:00pm');
// A non-London timezone still resolves against its own local noon.
ok(/at 12:00pm$/.test(whenString('2026-07-17T12:00:00+02:00', 'Europe/Paris')), 'noon in Paris tz → 12:00pm');

// ── Source guard: no formatter in the suite still uses the fragile hour12 ─────
// The buggy signature was `minute: '2-digit', hour12: true` (any spacing/quotes).
const FILES = {
  'api/_lib/calendar/mail.js': 2,
  'public/widget-appointment.js': 1,
  'public/book-appointment.html': 1,
  'public/appointment-share.html': 2,
  'public/manage-booking.html': 1,
  'public/bookings.html': 1,
};
const buggy = /minute:\s*'2-digit'\s*,\s*hour12\s*:/;      // formatter using hour12
const fixed = /minute:\s*'2-digit'\s*,\s*hourCycle\s*:/;   // formatter using hourCycle
for (const [f, count] of Object.entries(FILES)) {
  const src = readFileSync(url(f), 'utf8');
  ok(!buggy.test(src), `${f}: no formatter uses hour12`);
  const hits = (src.match(new RegExp(fixed, 'g')) || []).length;
  ok(hits === count, `${f}: ${count} formatter(s) use hourCycle (found ${hits})`);
}

// The picker keeps its 12/24 toggle: h12 for 12-hour, h23 for 24-hour.
const widget = readFileSync(url('public/widget-appointment.js'), 'utf8');
ok(/hourCycle:\s*hour12\s*\?\s*'h12'\s*:\s*'h23'/.test(widget), 'picker switches h12 (12-hour) vs h23 (24-hour)');

// Sibling widget: the World Clock carried the identical hour12 pattern (same
// h11 "00:00 PM" bug class). Guard it too — its live time must use hourCycle.
const clock = readFileSync(url('public/widget-worldclock.js'), 'utf8');
ok(/hourCycle:\s*c\.use24h\s*\?\s*'h23'\s*:\s*'h12'/.test(clock), 'world clock live time uses hourCycle (h23/h12)');
ok(!/hour12:\s*!c\.use24h/.test(clock), 'world clock no longer uses hour12:!c.use24h');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
