/**
 * The Coming up diary is YOUR appointments, not your whole calendar
 * (11 Sep 2026, second report).
 *
 * Andy, first time: "On Jess's calendar, you are showing all of my meetings;
 * it should only show the ones that relate to the users who are using the app."
 * Andy, after the ownership fix shipped: "It is still showing my meetings."
 *
 * Two separate faults sat behind one sentence, and only the first was fixed.
 *
 *   WHOSE.  A calendar connection was held once per CLIENT, so a second admin
 *           on an agency account was served the first one's calendar. Fixed by
 *           keying connections to a person (see store.js).
 *   WHAT.   The diary returned EVERY event in that calendar. Once it was
 *           correctly Jess's own calendar, it still listed every meeting Andy
 *           had invited her to, because those really are in her diary. A
 *           booking tool has no business listing a person's private
 *           commitments, which is what Andy asked for in the first place.
 *
 * So the calendar is now filtered to the events that ARE this person's
 * Travelgenix bookings, matched on the provider event id recorded when each
 * booking was made. Reading the calendar still does its real job in
 * /api/appointment/availability, keeping offered times clear of the host's
 * genuine commitments; it is just not a reason to LIST them.
 *
 * Run: node test/appointment-agenda-scope-smoke.mjs
 *      (npm run test:appointment-agenda-scope)
 */
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const ok = (label, cond, detail) => {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.error('  ✗ ' + label + (detail ? '\n      ' + detail : '')); }
};

const ANDY = 'andy.speight@agendas.group';
const JESS = 'jessica.speight@agendas.group';
const CLIENT = 'recClientAgendas';
const iso = (h) => new Date(Date.now() + h * 3600000).toISOString();

// What is really in Jess's own Google calendar: two Travelgenix bookings, and
// four things that are nobody's business but hers, including two that Andy
// put there by inviting her.
const HER_CALENDAR = [
  { id: 'gcal_tg_1', title: 'Training with Rita Okafor', startISO: iso(20), endISO: iso(21), allDay: false },
  { id: 'gcal_andy_1', title: 'Board review', startISO: iso(26), endISO: iso(28), allDay: false },
  { id: 'gcal_private_1', title: 'Dentist', startISO: iso(30), endISO: iso(31), allDay: false },
  { id: 'gcal_tg_2', title: 'Consultation with Tom Byrne', startISO: iso(44), endISO: iso(45), allDay: false },
  { id: 'gcal_andy_2', title: 'Supplier call, Andy + Luke', startISO: iso(50), endISO: iso(51), allDay: false },
  { id: 'gcal_private_2', title: 'School pickup', startISO: iso(54), endISO: iso(55), allDay: false },
];

// The bookings the platform holds for that client. Two are hers, one is Andy's,
// one of hers predates her connecting a calendar, one is cancelled.
const BOOKINGS = [
  { ref: 'apt_h1', status: 'confirmed', clientEmail: JESS, providerEventId: 'gcal_tg_1', startISO: iso(20), endISO: iso(21), eventLabel: 'Training', invitee: { name: 'Rita Okafor' } },
  { ref: 'apt_h2', status: 'confirmed', clientEmail: JESS, providerEventId: 'gcal_tg_2', startISO: iso(44), endISO: iso(45), eventLabel: 'Consultation', invitee: { name: 'Tom Byrne' } },
  { ref: 'apt_h3', status: 'confirmed', clientEmail: JESS, providerEventId: '', startISO: iso(60), endISO: iso(61), eventLabel: 'Discovery call', invitee: { name: 'Priya Shah' } },
  { ref: 'apt_a1', status: 'confirmed', clientEmail: ANDY, providerEventId: 'gcal_andy_x', startISO: iso(22), endISO: iso(23), eventLabel: 'Demo', invitee: { name: 'A Client' } },
  { ref: 'apt_h4', status: 'cancelled', clientEmail: JESS, providerEventId: 'gcal_tg_cancelled', startISO: iso(24), endISO: iso(25), eventLabel: 'Training', invitee: { name: 'Cancelled Person' } },
];

// ── Load the REAL handler with its three leaf modules stubbed ───────────────
const dataUrl = (src) => 'data:text/javascript;base64,' + Buffer.from(src, 'utf8').toString('base64');
globalThis.__TG_AGENDA_TEST__ = { calendar: HER_CALENDAR, bookings: BOOKINGS, connected: true, throwOnList: false };

const middlewareStub = `
export async function requireAuth(req) { return globalThis.__TG_AGENDA_TEST__.ctx; }
`;
const storeStub = `
const T = globalThis.__TG_AGENDA_TEST__;
export function storageReady() { return true; }
export async function listBookings() { return T.bookings; }
export async function getAccessToken(clientId, ownerEmail) {
  // Mirrors the real rule: a calendar is only ever returned to its owner.
  if (!ownerEmail) return null;
  if (!T.connected) return null;
  return T.ownerWithCalendar === ownerEmail ? { provider: 'google', accessToken: 'at', calendarId: 'primary', email: ownerEmail } : null;
}
`;
const providersStub = `
const T = globalThis.__TG_AGENDA_TEST__;
export function getProvider() {
  return { listEvents: async () => { if (T.throwOnList) throw new Error('google_events_503'); return T.calendar; } };
}
`;
const src = readFileSync(new URL('../api/appointment/agenda.js', import.meta.url), 'utf8')
  .replace("from '../_lib/auth/middleware.js'", `from '${dataUrl(middlewareStub)}'`)
  .replace("from '../_lib/calendar/store.js'", `from '${dataUrl(storeStub)}'`)
  .replace("from '../_lib/calendar/providers.js'", `from '${dataUrl(providersStub)}'`);
const { default: handler } = await import(dataUrl(src));

function makeRes() {
  const r = { statusCode: 0, headers: {}, body: null };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
async function agenda(email, query) {
  globalThis.__TG_AGENDA_TEST__.ctx = { email, clientRecordId: CLIENT, userRecordId: 'recU' };
  const res = makeRes();
  await handler({ method: 'GET', query: query || {} }, res);
  return res;
}
const titles = (res) => (res.body.events || []).map((e) => e.title);

console.log('Jess opens Coming up, with her own calendar connected');
globalThis.__TG_AGENDA_TEST__.ownerWithCalendar = JESS;
{
  const res = await agenda(JESS);
  const t = titles(res);
  ok('her two booked appointments are listed',
    t.includes('Training with Rita Okafor') && t.includes('Consultation with Tom Byrne'), t.join(' | '));
  ok('the meetings Andy invited her to are NOT listed',
    !t.includes('Board review') && !t.includes('Supplier call, Andy + Luke'),
    t.join(' | ') + ' — these are genuinely in her calendar, and are exactly what was reported');
  ok('her private commitments are NOT listed',
    !t.includes('Dentist') && !t.includes('School pickup'), t.join(' | '));
  ok('an appointment booked before she connected a calendar still shows',
    t.some((x) => x.indexOf('Discovery call') === 0), t.join(' | '));
  ok('a cancelled appointment does not show', !t.some((x) => x.indexOf('Cancelled') >= 0), t.join(' | '));
  ok("Andy's own booking is not in her list", !t.includes('Demo with A Client'), t.join(' | '));
  ok('it says what it filtered out rather than hiding it', res.body.otherCount === 4, String(res.body.otherCount));
  ok('soonest first', (res.body.events || []).every((e, i, a) => i === 0 || Date.parse(a[i - 1].startISO) <= Date.parse(e.startISO)));
  ok('the diary is never cached', /no-store/.test(res.headers['cache-control'] || ''), res.headers['cache-control']);
}

console.log('Jess has not connected a calendar');
globalThis.__TG_AGENDA_TEST__.ownerWithCalendar = ANDY;   // only Andy has one
{
  const res = await agenda(JESS);
  const t = titles(res);
  ok('she is told she is not connected', res.body.connected === false);
  ok("and shown NOTHING from Andy's calendar",
    !t.includes('Board review') && !t.includes('Dentist'), t.join(' | '));
  ok('her own appointments still show, from our own records', t.length === 3, t.join(' | '));
}

console.log('Andy opens his own');
{
  const res = await agenda(ANDY);
  const t = titles(res);
  ok('he sees his own booking', t.includes('Demo with A Client'), t.join(' | '));
  ok("and not Jess's", !t.some((x) => /Rita Okafor|Tom Byrne|Priya Shah/.test(x)), t.join(' | '));
}

console.log('A session with no identity');
globalThis.__TG_AGENDA_TEST__.ownerWithCalendar = ANDY;
{
  const res = await agenda('');
  ok('fails closed, showing nothing at all', res.body.connected === false && (res.body.events || []).length === 0,
    JSON.stringify(res.body));
}

console.log('Someone who genuinely wants the whole diary can ask');
globalThis.__TG_AGENDA_TEST__.ownerWithCalendar = JESS;
{
  const res = await agenda(JESS, { scope: 'all' });
  ok('?scope=all returns every event', (res.body.events || []).length === HER_CALENDAR.length, String((res.body.events || []).length));
  ok('and says so', res.body.scope === 'all', res.body.scope);
}

console.log('The calendar is unreadable right now');
globalThis.__TG_AGENDA_TEST__.throwOnList = true;
{
  const res = await agenda(JESS);
  ok('it degrades to her own appointments rather than an error wall',
    res.body.degraded === true && (res.body.events || []).length === 3, JSON.stringify(titles(res)));
}
globalThis.__TG_AGENDA_TEST__.throwOnList = false;

console.log('The reasons are written down');
{
  const raw = readFileSync(new URL('../api/appointment/agenda.js', import.meta.url), 'utf8');
  ok('the handler says whose diary it is and why', /never the client's/.test(raw) || /caller's own/.test(raw));
  ok('and why it is not the whole calendar', /only show the ones that relate to the users/.test(raw));
  ok('and that availability still reads the real calendar', /appointment\/availability/.test(raw));
  const list = readFileSync(new URL('../api/appointment/list.js', import.meta.url), 'utf8');
  ok('the sibling bookings list is uncacheable too', /private, no-store/.test(list));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
