/**
 * Appointment Scheduler — backend logic smoke test.
 *
 * Exercises the pure, dependency-free calendar libraries (no Google, no Redis).
 * The live OAuth round-trip and real free/busy are a separate manual pass.
 *
 * Run:  TG_ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") node test/appointment-smoke.mjs
 * (the script sets a throwaway key itself if one is not provided)
 */
import crypto from 'node:crypto';
if (!process.env.TG_ENCRYPTION_KEY) process.env.TG_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');

const { generateSlots, subtractBusy, isValidSlot, hostDateKey } = await import('../api/_lib/calendar/slots.js');
const { signState, verifyState, manageToken, bookingRef, pickEvent } = await import('../api/_lib/calendar/state.js');
const { buildICS, whenString } = await import('../api/_lib/calendar/mail.js');
const { encrypt, decrypt } = await import('../api/_crypto.js');
const { getConnection, storageReady, listBookings } = await import('../api/_lib/calendar/store.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('  FAIL:', m); } };
const tzShort = (iso, tz, opt) => new Intl.DateTimeFormat('en-US', Object.assign({ timeZone: tz }, opt)).format(new Date(iso));

const cfg = {
  timezone: 'Europe/London',
  availability: { 1: [['09:00', '12:00'], ['14:00', '17:00']], 2: [['09:00', '17:00']], 4: [['09:00', '17:00']] },
  dateRangeDays: 21, minNoticeHours: 0, slotInterval: 0, blackoutDates: [],
};
const ev = { id: 'consult', label: 'Consultation', mins: 30, mode: 'callback' };

// ── slots ──
const slots = generateSlots(cfg, ev, {});
ok(slots.length > 0, 'generateSlots produces slots');
ok(slots.every(s => Date.parse(s.endISO) - Date.parse(s.startISO) === 30 * 60000), 'every slot is the event duration');
ok(slots.every(s => Date.parse(s.startISO) >= Date.now()), 'no past slots');
ok(!slots.some(s => ['Wed', 'Sat', 'Sun'].includes(tzShort(s.startISO, 'Europe/London', { weekday: 'short' }))), 'closed weekdays excluded');
ok(!slots.some(s => { const h = tzShort(s.startISO, 'Europe/London', { hour: '2-digit', hour12: false }); const wd = tzShort(s.startISO, 'Europe/London', { weekday: 'short' }); return wd === 'Mon' && (h === '12' || h === '13'); }), 'split-day lunch gap excluded');

// blackout
const firstDay = hostDateKey(slots[0].startISO, 'Europe/London');
const bo = generateSlots(Object.assign({}, cfg, { blackoutDates: [firstDay] }), ev, {});
ok(!bo.some(s => hostDateKey(s.startISO, 'Europe/London') === firstDay), 'blackout date removed');

// minNotice
const noticed = generateSlots(Object.assign({}, cfg, { minNoticeHours: 48 }), ev, {});
ok(noticed.every(s => Date.parse(s.startISO) >= Date.now() + 47.9 * 3600000), 'minNotice respected');

// isValidSlot
ok(isValidSlot(cfg, ev, slots[3].startISO), 'isValidSlot true for a generated slot');
ok(!isValidSlot(cfg, ev, new Date(Date.parse(slots[3].startISO) + 7 * 60000).toISOString()), 'isValidSlot false off-grid');

// buffers
const busy = [{ start: slots[4].startISO, end: slots[4].endISO }];
ok(subtractBusy(slots, busy).length === slots.length - 1, 'busy removes exactly one slot');
ok(subtractBusy(slots, busy, { before: 30, after: 30 }).length < slots.length - 1, 'buffers remove neighbours too');
ok(subtractBusy(slots, [], { before: 30, after: 30 }).length === slots.length, 'no busy means no removal');

// host date keys across midnight
ok(hostDateKey('2026-07-15T23:30:00Z', 'Australia/Sydney') === '2026-07-16', 'host date crosses midnight forward');
ok(hostDateKey('2026-01-01T00:30:00Z', 'America/Los_Angeles') === '2025-12-31', 'host date crosses midnight back');

// pickEvent
ok(pickEvent({ eventTypes: [ev, { id: 'x', label: 'X', mins: 15 }] }, 'x').id === 'x', 'pickEvent by id');
ok(pickEvent({}, 'nope').mins === 30, 'pickEvent falls back to a default');

// ── state ──
const st = signState({ clientRecordId: 'recABC', ret: '/editor-appointment?id=1' });
const v = verifyState(st);
ok(v && v.clientRecordId === 'recABC' && v.ret === '/editor-appointment?id=1', 'state round trip');
ok(verifyState(st.slice(0, -3) + 'zzz') === null, 'tampered state rejected');
ok(verifyState(signState({ a: 1 }, -1000)) === null, 'expired state rejected');
ok(/^[0-9a-f]{48}$/.test(manageToken()), 'manageToken is 24 bytes hex');
ok(bookingRef(Date.now()).startsWith('apt_'), 'bookingRef shape');

// ── crypto ──
const token = 'ya29.a-refresh-token';
ok(decrypt(encrypt(token)) === token, 'encrypt/decrypt round trip');
ok(encrypt(token) !== encrypt(token), 'encryption uses a fresh IV each time');

// ── ics + mail formatting ──
const booking = { ref: 'apt_z', eventLabel: 'Consultation', durationMins: 30, startISO: slots[0].startISO, endISO: slots[0].endISO, hostTimezone: 'Europe/London', visitorTimezone: 'America/New_York', invitee: { name: 'Jo Bloggs', email: 'jo@example.com' }, clientEmail: 'agent@agency.com', location: 'Phone call' };
const ics = buildICS(booking, 'REQUEST');
ok(/BEGIN:VCALENDAR/.test(ics) && /METHOD:REQUEST/.test(ics), 'ics envelope');
ok(/SUMMARY:Consultation/.test(ics) && /LOCATION:Phone call/.test(ics), 'ics summary + location');
ok(/ATTENDEE[^\n]*jo@example.com/.test(ics) && /ORGANIZER[^\n]*agent@agency.com/.test(ics), 'ics attendee + organiser');
ok(/DTSTART:\d{8}T\d{6}Z/.test(ics) && /DTEND:\d{8}T\d{6}Z/.test(ics), 'ics UTC stamps');
ok(/METHOD:CANCEL/.test(buildICS(booking, 'CANCEL')), 'cancel ics method');
ok(/ at /.test(whenString(slots[0].startISO, 'America/New_York')), 'whenString format');

// ── provider registry + Microsoft translation ──
const { getProvider, configuredProviders, isProvider } = await import('../api/_lib/calendar/providers.js');
const ms = await import('../api/_lib/calendar/microsoft.js');
ok(getProvider('google').PROVIDER === 'google', 'registry resolves google');
ok(getProvider('microsoft').PROVIDER === 'microsoft', 'registry resolves microsoft');
ok(getProvider('nope').PROVIDER === 'google', 'registry defaults to google');
ok(isProvider('microsoft') === true && isProvider('nope') === false, 'isProvider');
ok(Array.isArray(configuredProviders()), 'configuredProviders returns a list');
const gdt = ms.toGraphDateTime('2026-07-15T13:00:00.000Z');
ok(gdt.dateTime === '2026-07-15T13:00:00' && gdt.timeZone === 'UTC', 'toGraphDateTime is zone-less UTC');
const ge = ms.toGraphEvent({ summary: 'Consult', description: 'hi', start: { dateTime: '2026-07-15T13:00:00Z' }, end: { dateTime: '2026-07-15T13:30:00Z' }, location: 'Phone call', attendees: [{ email: 'a@b.com', displayName: 'A B' }] });
ok(ge.subject === 'Consult' && ge.body.content === 'hi', 'toGraphEvent subject + body');
ok(ge.location.displayName === 'Phone call', 'toGraphEvent location');
ok(ge.attendees[0].emailAddress.address === 'a@b.com' && ge.attendees[0].type === 'required', 'toGraphEvent attendee');
ok(ge.start.dateTime === '2026-07-15T13:00:00' && ge.end.dateTime === '2026-07-15T13:30:00', 'toGraphEvent start/end');
ok(getProvider('microsoft').SCOPES.includes('Calendars.ReadWrite'), 'microsoft scope present');

// ── store graceful without redis ──
ok(storageReady() === false, 'storageReady false without redis');
ok((await getConnection('recX')) === null, 'getConnection null without redis');
ok((await listBookings('recX', 0, Date.now())).length === 0, 'listBookings empty without redis');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
