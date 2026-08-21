/**
 * Appointment reminder cadence smoke test.
 * Proves the configurable plan (config.reminders → stamped per booking) fires
 * each offset once, respects legacy bookings, and re-arms on reschedule-style
 * resets. Pure logic — no Redis, no SendGrid.
 * Run: node test/appointment-reminder-cadence-smoke.mjs
 */
import assert from 'node:assert';
import { normaliseReminders, dueReminders, DEFAULT_REMINDERS } from '../api/_lib/calendar/reminders.js';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) passed++; else { failed++; console.error('  FAIL:', label); } };
const eq = (a, b, label) => ok(JSON.stringify(a) === JSON.stringify(b), label + ' (got ' + JSON.stringify(a) + ')');

// ── normaliseReminders ──
eq(normaliseReminders(undefined), [24], 'absent key keeps the original one-24h-reminder behaviour');
eq(DEFAULT_REMINDERS, [24], 'default plan is a single 24h reminder');
eq(normaliseReminders('junk'), [24], 'junk config falls back to the default plan');
eq(normaliseReminders([]), [], 'an explicit empty array means reminders OFF');
eq(normaliseReminders([2, 24]), [24, 2], 'plan is sorted furthest-first');
eq(normaliseReminders([24, 24, 2]), [24, 2], 'duplicates collapse');
eq(normaliseReminders(['48', 2]), [48, 2], 'numeric strings are accepted');
eq(normaliseReminders([999]), [72], 'offsets clamp to the 72h ceiling (the cron scan window)');
eq(normaliseReminders([0, -5, 2]), [2], 'zero and negatives are dropped, not clamped up');
eq(normaliseReminders([1, 2, 3, 6, 12]), [3, 2, 1], 'plan caps at three offsets');

// ── dueReminders ──
const H = 3600000;
const start = Date.now() + 26 * H;
const mk = (extra) => Object.assign({ ref: 'apt_x', status: 'confirmed', startISO: new Date(start).toISOString(), reminders: [24, 2], remindersSent: [] }, extra);

eq(dueReminders(mk(), start - 25 * H), [], 'nothing due before the first window opens');
eq(dueReminders(mk(), start - 23 * H), [0], 'first reminder due once inside its 24h window');
eq(dueReminders(mk({ remindersSent: [0] }), start - 23 * H), [], 'a sent reminder never re-fires');
eq(dueReminders(mk({ remindersSent: [0] }), start - 1 * H), [1], 'second reminder due inside its 2h window');
eq(dueReminders(mk(), start - 1 * H), [0, 1], 'missed cron runs: both come due together (one email, both marked)');
eq(dueReminders(mk(), start + 1), [], 'nothing fires after the meeting has started');
eq(dueReminders(mk({ reminders: [] }), start - 1 * H), [], 'reminders switched off = nothing due, ever');

// Legacy bookings stamped before plans existed.
const legacy = { ref: 'apt_old', status: 'confirmed', startISO: new Date(start).toISOString() };
eq(dueReminders(Object.assign({}, legacy), start - 23 * H), [0], 'legacy booking runs the default 24h plan');
eq(dueReminders(Object.assign({}, legacy, { reminded: true }), start - 23 * H), [], 'legacy reminded flag counts as sent');

// A new-style booking keeps firing later offsets even after reminded=true is
// set for back-compat display.
eq(dueReminders(mk({ remindersSent: [0], reminded: true }), start - 1 * H), [1], 'back-compat reminded flag does not block the second reminder');

// Reschedule re-arm: actions.js clears remindersSent + reminded.
const moved = mk({ remindersSent: [0, 1], reminded: true });
moved.remindersSent = []; moved.reminded = false;
eq(dueReminders(moved, start - 23 * H), [0], 'a reschedule-style reset re-arms the plan for the new time');

// Bad data never throws.
eq(dueReminders({}, Date.now()), [], 'missing startISO is inert');
eq(dueReminders({ startISO: 'garbage', reminders: [24] }, Date.now()), [], 'garbage startISO is inert');

console.log(`\n${passed} passed, ${failed} failed`);
assert.strictEqual(failed, 0, 'reminder cadence smoke failures');
