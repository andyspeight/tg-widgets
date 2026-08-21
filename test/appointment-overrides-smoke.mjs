/**
 * Appointment availability fine-control smoke test.
 * Proves date-specific overrides replace the weekly hours on one date (and can
 * open an otherwise-closed day), blackouts still win, half-hour boundaries
 * generate correctly, slotInterval steps starts, and booking validation
 * (isValidSlot) agrees with generation. Pure logic — no network.
 * Run: node test/appointment-overrides-smoke.mjs
 */
import assert from 'node:assert';
import { generateSlots, isValidSlot, hostDateKey } from '../api/_lib/calendar/slots.js';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) passed++; else { failed++; console.error('  FAIL:', label); } };

const TZ = 'Europe/London';
// Wall-clock HH:MM of an instant in the host timezone.
const hm = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
// Host-timezone date key N days ahead.
const keyAhead = (days) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + days * 86400000));
const weekdayOfKey = (key) => new Date(key + 'T12:00:00Z').getUTCDay();

// Deterministic targets whatever day the test runs: the next weekday and the
// next Saturday, both at least 3 days out (clear of min-notice edge cases).
let weekdayKey = '', satKey = '';
for (let i = 3; i <= 16; i++) {
  const k = keyAhead(i), wd = weekdayOfKey(k);
  if (!weekdayKey && wd >= 1 && wd <= 5) weekdayKey = k;
  if (!satKey && wd === 6) satKey = k;
}
ok(weekdayKey && satKey, 'found target dates (' + weekdayKey + ', ' + satKey + ')');

const base = {
  timezone: TZ,
  availability: { 1: [['09:00', '17:00']], 2: [['09:00', '17:00']], 3: [['09:00', '17:00']], 4: [['09:00', '17:00']], 5: [['09:00', '17:00']] },
  dateRangeDays: 30, minNoticeHours: 0, blackoutDates: [],
};
const ev = { id: 'consult', label: 'Consultation', mins: 30 };
const onDate = (slots, key) => slots.filter(s => hostDateKey(s.startISO, TZ) === key);

// ── Override replaces the weekly hours on that one date ──
const cfgA = Object.assign({}, base, { dateOverrides: { [weekdayKey]: [['19:00', '21:00']] } });
const slotsA = generateSlots(cfgA, ev, {});
const dayA = onDate(slotsA, weekdayKey);
ok(dayA.length === 4, 'override day gets exactly the override slots (19:00-21:00 / 30min = 4, got ' + dayA.length + ')');
ok(dayA.every(s => hm(s.startISO) >= '19:00'), 'no weekly 9-5 slots leak onto the overridden date');
ok(dayA.some(s => hm(s.startISO) === '19:00'), 'override starts at its own first time');
const otherWeekday = onDate(slotsA, slotsA.map(s => hostDateKey(s.startISO, TZ)).find(k => k !== weekdayKey && weekdayOfKey(k) >= 1 && weekdayOfKey(k) <= 5));
ok(otherWeekday.some(s => hm(s.startISO) === '09:00'), 'every other weekday still follows the weekly pattern');

// ── Override opens an otherwise-closed day (Saturday) ──
const cfgB = Object.assign({}, base, { dateOverrides: { [satKey]: [['10:00', '12:00']] } });
const dayB = onDate(generateSlots(cfgB, ev, {}), satKey);
ok(dayB.length === 4, 'override opens a closed Saturday (got ' + dayB.length + ' slots)');
ok(onDate(generateSlots(base, ev, {}), satKey).length === 0, 'negative control: without the override that Saturday has no slots');

// ── Blackout beats override ──
const cfgC = Object.assign({}, cfgB, { blackoutDates: [satKey] });
ok(onDate(generateSlots(cfgC, ev, {}), satKey).length === 0, 'a blackout closes the day even when an override exists');

// ── An empty-array override closes the day ──
const cfgD = Object.assign({}, base, { dateOverrides: { [weekdayKey]: [] } });
ok(onDate(generateSlots(cfgD, ev, {}), weekdayKey).length === 0, 'an empty override closes that date');

// ── Half-hour boundaries ──
const cfgE = Object.assign({}, base, { availability: { [String(weekdayOfKey(weekdayKey))]: [['09:30', '11:00']] } });
const dayE = onDate(generateSlots(cfgE, ev, {}), weekdayKey);
ok(dayE.length && hm(dayE[0].startISO) === '09:30', 'ranges can start on the half hour (first slot ' + (dayE.length ? hm(dayE[0].startISO) : 'none') + ')');

// ── slotInterval steps the start times ──
const cfgF = Object.assign({}, base, { slotInterval: 15, dateOverrides: { [weekdayKey]: [['09:00', '10:00']] } });
const dayF = onDate(generateSlots(cfgF, ev, {}), weekdayKey).map(s => hm(s.startISO));
ok(JSON.stringify(dayF) === JSON.stringify(['09:00', '09:15', '09:30']), '30min meeting every 15min in a 1h window = 09:00/09:15/09:30 (got ' + dayF.join(',') + ')');

// ── Booking validation agrees with generation ──
ok(isValidSlot(cfgA, ev, dayA[0].startISO), 'isValidSlot accepts a real override slot');
const nineAm = generateSlots(base, ev, {}).find(s => hostDateKey(s.startISO, TZ) === weekdayKey && hm(s.startISO) === '09:00');
ok(nineAm && !isValidSlot(cfgA, ev, nineAm.startISO), 'isValidSlot rejects a weekly-hours time on the overridden date');

// ── Junk overrides are inert ──
const cfgG = Object.assign({}, base, { dateOverrides: 'garbage' });
ok(onDate(generateSlots(cfgG, ev, {}), weekdayKey).length > 0, 'junk dateOverrides config is ignored, weekly hours still apply');

console.log(`\n${passed} passed, ${failed} failed`);
assert.strictEqual(failed, 0, 'availability fine-control smoke failures');
