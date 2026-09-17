/**
 * A booking that never reached a calendar (17 Sep 2026).
 *
 * What happened. Calendars became per-person on 11 Sep, and a connection made
 * before that carries no recorded owner. Andy's stopped resolving, so his
 * scheduler kept taking bookings and sending both confirmation emails while
 * silently skipping the calendar write. He found out days later by looking at
 * his diary. Live proof at the time: /api/appointment/availability for his own
 * scheduler answered connected:false while his colleague's answered true, on
 * the same client record.
 *
 * Three things are held here:
 *
 *   1. ONE calendar write. The live booking and the backfill share
 *      syncBookingToCalendar, so the event a backfill creates is the event a
 *      booking would have created.
 *   2. It is never silent. Every outcome is named on the booking
 *      (created / not-connected / clash / failed) and the failure paths return
 *      rather than throw, so a calendar problem can never lose a booking.
 *   3. The backfill cannot reach anybody else's diary, and cannot double-book.
 *
 * Run: node test/appointment-calendar-sync-smoke.mjs  (npm run test:appointment-calendar-sync)
 */
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const ok = (label, cond, detail) => {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.error('  ✗ ' + label + (detail ? '\n      ' + detail : '')); }
};

const R = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const ACTIONS = R('api/_lib/calendar/actions.js');
const BOOK = R('api/appointment/book.js');
const SYNC = R('api/appointment/sync-calendar.js');
const LIST = R('api/appointment/list.js');
const PAGE = R('public/bookings.html');
const EDITOR = R('public/editor-appointment.html');
const STORE = R('api/_lib/calendar/store.js');

// ---------------------------------------------------------------------------
// The sync itself, driven for real against stub providers.
// ---------------------------------------------------------------------------
const BOOKING = () => ({
  ref: 'AP-1234', status: 'confirmed', clientRecordId: 'recClient', clientEmail: 'andy@example.com',
  widgetId: 'tgw_1', eventId: 'consult', eventLabel: 'Consultation', durationMins: 30, mode: 'video',
  startISO: '2026-09-21T09:00:00.000Z', endISO: '2026-09-21T09:30:00.000Z', hostTimezone: 'Europe/London',
  invitee: { name: 'Sarah Nolan', email: 'sarah@example.com', phone: '07700 900123', answers: { 'Where are you going': 'Dubai' } },
  meetingUrl: '', providerEventId: '', calendarLink: '',
});

let loadSeq = 0;
/**
 * Load actions.js with its collaborators stubbed, so no network is touched.
 *
 * ESM cannot be monkey patched, so the module is compiled against a shim that
 * replaces its imports with globals. Each load gets a unique tail: the module
 * destructures those globals ONCE at evaluation, and an identical data: URL is
 * cached, so without this every case after the first would silently run against
 * the first case's stubs.
 */
async function loadActions(stubs) {
  const src = '// instance ' + (++loadSeq) + '\n' + ACTIONS
    .replace(/import \{ getAccessToken[^}]*\} from '\.\/store\.js';/, 'const { getAccessToken, getZoomAccessToken, saveBooking, placeHold, releaseHold, getDayCount, incDayCount, decDayCount } = globalThis.__STUB_STORE;')
    .replace(/import \{ getProvider \} from '\.\/providers\.js';/, 'const { getProvider } = globalThis.__STUB_PROVIDERS;')
    .replace(/import \* as zoom from '\.\/zoom\.js';/, 'const zoom = globalThis.__STUB_ZOOM;')
    .replace(/import \{ sendCancelled, sendRescheduled \} from '\.\/mail\.js';/, 'const { sendCancelled, sendRescheduled } = globalThis.__STUB_MAIL;')
    .replace(/import \{ resolveWidget, pickEvent \} from '\.\/state\.js';/, 'const { resolveWidget, pickEvent } = globalThis.__STUB_STATE;')
    .replace(/import \{ isValidSlot, hostDateKey \} from '\.\/slots\.js';/, 'const { isValidSlot, hostDateKey } = globalThis.__STUB_SLOTS;');
  globalThis.__STUB_STORE = Object.assign({
    getAccessToken: async () => null, getZoomAccessToken: async () => null, saveBooking: async () => true,
    placeHold: async () => true, releaseHold: async () => true,
    getDayCount: async () => 0, incDayCount: async () => true, decDayCount: async () => true,
  }, stubs.store || {});
  globalThis.__STUB_PROVIDERS = { getProvider: stubs.getProvider || (() => ({})) };
  globalThis.__STUB_ZOOM = { deleteMeeting: async () => true, createMeeting: async () => null };
  globalThis.__STUB_MAIL = { sendCancelled: async () => true, sendRescheduled: async () => true };
  globalThis.__STUB_STATE = { resolveWidget: async () => null, pickEvent: () => null };
  globalThis.__STUB_SLOTS = { isValidSlot: () => true, hostDateKey: () => '2026-09-21' };
  const url = 'data:text/javascript;base64,' + Buffer.from(src).toString('base64');
  return import(url);
}

console.log('The calendar write says what happened, every time');
{
  // 1. Nothing connected.
  {
    const m = await loadActions({ store: { getAccessToken: async () => null } });
    const r = await m.syncBookingToCalendar(BOOKING(), {});
    ok('no connected calendar is reported, not thrown', r.status === 'not-connected');
    const b = m.applyCalendarResult(BOOKING(), r);
    ok('and it is recorded on the booking', b.calendarStatus === 'not-connected' && !b.providerEventId);
    ok('with the time it was checked', !!b.calendarCheckedAt);
  }

  // 2. Connected, event created.
  {
    let sent = null;
    const m = await loadActions({
      store: { getAccessToken: async () => ({ accessToken: 'tok', calendarId: 'primary', provider: 'google' }) },
      getProvider: () => ({
        freeBusy: async () => [],
        insertEvent: async (_t, _c, ev) => { sent = ev; return { id: 'evt_1', htmlLink: 'https://calendar.google.com/evt_1', meetingUrl: 'https://meet.google.com/abc' }; },
      }),
    });
    const r = await m.syncBookingToCalendar(BOOKING(), { checkClash: true });
    ok('a connected calendar gets the event', r.status === 'created' && r.providerEventId === 'evt_1');
    ok('the visitor is invited', JSON.stringify(sent.attendees) === JSON.stringify([{ email: 'sarah@example.com', displayName: 'Sarah Nolan' }]));
    ok('the summary names the event and the visitor', sent.summary === 'Consultation with Sarah Nolan');
    ok('their answers travel with it', /Where are you going: Dubai/.test(sent.description));
    ok('and their phone number', /07700 900123/.test(sent.description));
    ok('a video booking with no link asks the calendar for one', sent._conference === true);
    ok('the times are the booking\'s own, in the host timezone',
      sent.start.dateTime === '2026-09-21T09:00:00.000Z' && sent.start.timeZone === 'Europe/London');
    const b = m.applyCalendarResult(BOOKING(), r);
    ok('the link and the minted meeting come back on the booking',
      b.calendarLink === 'https://calendar.google.com/evt_1' && b.meetingUrl === 'https://meet.google.com/abc');
    ok('and the status says created', b.calendarStatus === 'created');
  }

  // 3. Connected, but the time is taken.
  {
    const m = await loadActions({
      store: { getAccessToken: async () => ({ accessToken: 'tok', calendarId: 'primary', provider: 'google' }) },
      getProvider: () => ({
        freeBusy: async () => [{ start: '2026-09-21T09:15:00.000Z', end: '2026-09-21T10:00:00.000Z' }],
        insertEvent: async () => { throw new Error('should not be called'); },
      }),
    });
    const r = await m.syncBookingToCalendar(BOOKING(), { checkClash: true });
    ok('a clash is reported and nothing is written', r.status === 'clash' && !r.providerEventId);
    // The backfill does not check: the booking is already made and the visitor
    // already has a confirmation, so a busy diary is news, not a veto.
    const m2 = await loadActions({
      store: { getAccessToken: async () => ({ accessToken: 'tok', calendarId: 'primary', provider: 'google' }) },
      getProvider: () => ({
        freeBusy: async () => { throw new Error('should not be called'); },
        insertEvent: async () => ({ id: 'evt_2', htmlLink: 'https://x/2' }),
      }),
    });
    const r2 = await m2.syncBookingToCalendar(BOOKING(), { checkClash: false });
    ok('without the clash check it goes in regardless', r2.status === 'created' && r2.providerEventId === 'evt_2');
  }

  // 4. The provider falls over.
  {
    const m = await loadActions({
      store: { getAccessToken: async () => ({ accessToken: 'tok', calendarId: 'primary', provider: 'google' }) },
      getProvider: () => ({ freeBusy: async () => [], insertEvent: async () => { throw new Error('Google said 503'); } }),
    });
    const r = await m.syncBookingToCalendar(BOOKING(), {});
    ok('a provider error is caught, not thrown at the caller', r.status === 'failed');
    ok('and the reason is kept', /503/.test(r.error));
    const b = m.applyCalendarResult(BOOKING(), r);
    ok('the booking records why there is no event', b.calendarStatus === 'failed' && /503/.test(b.calendarError));
  }

  // 5. A token lookup that blows up must not take the booking with it.
  {
    const m = await loadActions({ store: { getAccessToken: async () => { throw new Error('redis down'); } } });
    const r = await m.syncBookingToCalendar(BOOKING(), {});
    ok('a storage failure is caught too', r.status === 'failed' && /redis down/.test(r.error));
  }

  // 6. A booking with no invitee email still gets an event.
  {
    const m = await loadActions({
      store: { getAccessToken: async () => ({ accessToken: 'tok', calendarId: 'primary', provider: 'google' }) },
      getProvider: () => ({ freeBusy: async () => [], insertEvent: async (_t, _c, ev) => ({ id: 'e', htmlLink: '', _ev: ev }) }),
    });
    const b = BOOKING(); b.invitee = { name: 'No Email' };
    const r = await m.syncBookingToCalendar(b, {});
    ok('no attendee rather than an invalid one', r.status === 'created');
  }

  // 7. Re-running clears a stale error rather than leaving it to mislead.
  {
    const m = await loadActions({
      store: { getAccessToken: async () => ({ accessToken: 'tok', calendarId: 'primary', provider: 'google' }) },
      getProvider: () => ({ freeBusy: async () => [], insertEvent: async () => ({ id: 'evt_9', htmlLink: 'https://x/9' }) }),
    });
    const b = BOOKING();
    b.calendarStatus = 'failed'; b.calendarError = 'Google said 503';
    m.applyCalendarResult(b, await m.syncBookingToCalendar(b, {}));
    ok('a booking that now succeeds carries no leftover error',
      b.calendarStatus === 'created' && b.calendarError === undefined);
  }
}

console.log('One calendar write, shared by the booking and the backfill');
{
  ok('the live booking calls the shared one',
    /import \{ syncBookingToCalendar, applyCalendarResult \} from '\.\.\/_lib\/calendar\/actions\.js'/.test(BOOK)
    && /await syncBookingToCalendar\(/.test(BOOK));
  ok('the backfill calls the same one',
    /import \{ syncBookingToCalendar, applyCalendarResult \} from '\.\.\/_lib\/calendar\/actions\.js'/.test(SYNC)
    && /await syncBookingToCalendar\(/.test(SYNC));
  ok('neither keeps its own copy of the event shape',
    !/insertEvent\(/.test(BOOK) && !/insertEvent\(/.test(SYNC));
  ok('the live booking still refuses a clash', /calResult\.status === 'clash'/.test(BOOK));
  ok('and releases the hold when it does',
    /calResult\.status === 'clash'[\s\S]{0,140}releaseHold/.test(BOOK));
  ok('the backfill deliberately does not clash check',
    /checkClash: false/.test(SYNC));
  ok('the booking records the outcome before it is saved',
    /applyCalendarResult\(booking, calResult\);[\s\S]{0,120}await saveBooking\(booking\)/.test(BOOK));
}

console.log('The backfill cannot reach anyone else\'s diary');
{
  ok('it needs a signed-in caller', /requireAuth\(req, res\)/.test(SYNC));
  ok('and fails closed when it cannot tell who that is',
    /if \(!me\) return res\.status\(403\)/.test(SYNC));
  ok('it only touches bookings whose scheduler is the caller\'s',
    /String\(b\.clientEmail \|\| ''\)\.toLowerCase\(\)\.trim\(\) !== me/.test(SYNC));
  ok('and writes only to the caller\'s own calendar',
    /getAccessToken\(ctx\.clientRecordId, me\)/.test(SYNC));
  ok('a booking that already has an event is left alone, so running twice is safe',
    /filter\(\(b\) => !b\.providerEventId\)/.test(SYNC));
  ok('cancelled bookings are skipped', /b\.status === 'cancelled'/.test(SYNC));
  ok('there is a ceiling on one run, and it says how many are left',
    /MAX_PER_RUN/.test(SYNC) && /remaining:/.test(SYNC));
  ok('it says to connect a calendar first rather than reporting fifty failures',
    /connected: false[\s\S]{0,260}Connect one in the scheduler editor/.test(SYNC));
  ok('a dry run changes nothing', /if \(dryRun\)[\s\S]{0,120}would-create/.test(SYNC));
  ok('it is a POST, so it cannot be triggered by a link',
    /req\.method !== 'POST'/.test(SYNC));
}

console.log('The failure is visible now, in all three places it was not');
{
  ok('the bookings API reports whether each booking reached a calendar',
    /calendarStatus: b\.calendarStatus/.test(LIST) && /calendarError: b\.calendarError/.test(LIST));
  ok('an older booking with an event is treated as created, not as a failure',
    /b\.providerEventId \? 'created' : ''/.test(LIST));
  ok('the bookings page marks the ones that are missing',
    /function calWarning\(/.test(PAGE) && /Not in your calendar/.test(PAGE));
  ok('but says nothing when we never recorded a status, rather than crying wolf',
    /if\(st==='created'\|\|!st\) return null;/.test(PAGE));
  ok('and nothing about a cancelled booking',
    /if\(b\.status==='cancelled'\) return null;/.test(PAGE));
  ok('the page offers the button that puts them right',
    /btn-sync-cal/.test(PAGE) && /api\/appointment\/sync-calendar/.test(PAGE));
  ok('it warns the visitors will not be emailed again, because they already were',
    /will not be emailed again/.test(PAGE));
  ok('the editor names the CONSEQUENCE of no calendar, not just the option',
    /No calendar connected/.test(EDITOR)
    && /will NOT appear in your diary/.test(EDITOR)
    && /times you are already busy will still be offered/.test(EDITOR));
}

console.log('The rule that caused it is still the rule');
{
  // The per-person scoping is CORRECT and stays. Andy's fix was to reconnect,
  // not to hand him a colleague's calendar, which is what a naive "fall back to
  // the agency default" would have done.
  ok('a calendar still belongs to a person', /apt:cal:u:<ownerEmail>/.test(STORE));
  ok('and the agency default is only ever returned to its owner',
    /if \(owner && !ownsConnection\(shared, owner\)\) return null;/.test(STORE));
  ok('the backfill does not quietly widen that',
    !/ownsConnection/.test(SYNC) && !/connKey/.test(SYNC));
  ok('connecting records whose calendar it is, so this cannot recur',
    /ownerEmail: ctx\.email/.test(R('api/calendar/connect.js')));
}

console.log('The backfill endpoint, driven as a real request');
{
  // Source greps prove the rules are written down. This drives the handler, so
  // they are also true. Four bookings on one client record: one of the
  // caller's missing from the diary, one of the caller's already there, one
  // belonging to a COLLEAGUE'S scheduler, and one cancelled.
  const BOOKINGS = [
    { ref: 'AP-001', status: 'confirmed', clientRecordId: 'recTG', clientEmail: 'andy@x.com', widgetId: 'w1',
      eventLabel: 'Consultation', mode: 'video', startISO: '2026-09-21T09:00:00.000Z', endISO: '2026-09-21T09:30:00.000Z',
      hostTimezone: 'Europe/London', invitee: { name: 'Sarah', email: 's@x.com' }, providerEventId: '', calendarStatus: 'not-connected' },
    { ref: 'AP-002', status: 'confirmed', clientRecordId: 'recTG', clientEmail: 'andy@x.com', widgetId: 'w1',
      eventLabel: 'Consultation', mode: 'phone', startISO: '2026-09-22T09:00:00.000Z', endISO: '2026-09-22T09:30:00.000Z',
      hostTimezone: 'Europe/London', invitee: { name: 'Tom', email: 't@x.com' }, providerEventId: 'evt_existing' },
    { ref: 'AP-003', status: 'confirmed', clientRecordId: 'recTG', clientEmail: 'jess@x.com', widgetId: 'w2',
      eventLabel: 'Consultation', mode: 'video', startISO: '2026-09-23T09:00:00.000Z', endISO: '2026-09-23T09:30:00.000Z',
      hostTimezone: 'Europe/London', invitee: { name: 'Ann', email: 'a@x.com' }, providerEventId: '' },
    { ref: 'AP-004', status: 'cancelled', clientRecordId: 'recTG', clientEmail: 'andy@x.com', widgetId: 'w1',
      eventLabel: 'Consultation', mode: 'video', startISO: '2026-09-24T09:00:00.000Z', endISO: '2026-09-24T09:30:00.000Z',
      hostTimezone: 'Europe/London', invitee: { name: 'Zoe', email: 'z@x.com' }, providerEventId: '' },
  ];
  let savedRows = [], insertedEvents = [];

  // Late bound on purpose. The handler destructures its imports once at module
  // evaluation, so a stub swapped in afterwards would never be seen, and the
  // fail-closed cases below would quietly pass against the wrong caller.
  globalThis.__STORE = {
    storageReady: () => true,
    listBookings: async () => BOOKINGS.map((b) => JSON.parse(JSON.stringify(b))),
    saveBooking: async (b) => { savedRows.push(b); return true; },
    getAccessToken: async (_cid, who) => (who === 'andy@x.com' ? { accessToken: 't', calendarId: 'primary', provider: 'google' } : null),
  };
  globalThis.__PROVIDERS = { getProvider: () => ({
    freeBusy: async () => { throw new Error('a backfill must not clash check'); },
    insertEvent: async (_t, _c, ev) => { insertedEvents.push(ev); return { id: 'evt_new_' + insertedEvents.length, htmlLink: 'https://cal/' + insertedEvents.length }; },
  }) };
  globalThis.__AUTH = { requireAuth: async () => ({ clientRecordId: 'recTG', email: 'andy@x.com' }) };

  const actionsSrc = '// endpoint harness\n' + ACTIONS
    .replace(/import \{ getAccessToken[^}]*\} from '\.\/store\.js';/, 'const getAccessToken = (...a) => globalThis.__STORE.getAccessToken(...a); const saveBooking = (...a) => globalThis.__STORE.saveBooking(...a); const getZoomAccessToken=async()=>null, placeHold=async()=>1, releaseHold=async()=>1, getDayCount=async()=>0, incDayCount=async()=>1, decDayCount=async()=>1;')
    .replace(/import \{ getProvider \} from '\.\/providers\.js';/, 'const getProvider = (...a) => globalThis.__PROVIDERS.getProvider(...a);')
    .replace(/import \* as zoom from '\.\/zoom\.js';/, 'const zoom = {};')
    .replace(/import \{ sendCancelled, sendRescheduled \} from '\.\/mail\.js';/, 'const sendCancelled=async()=>1, sendRescheduled=async()=>1;')
    .replace(/import \{ resolveWidget, pickEvent \} from '\.\/state\.js';/, 'const resolveWidget=async()=>null, pickEvent=()=>null;')
    .replace(/import \{ isValidSlot, hostDateKey \} from '\.\/slots\.js';/, 'const isValidSlot=()=>true, hostDateKey=()=>"d";');
  const actionsUrl = 'data:text/javascript;base64,' + Buffer.from(actionsSrc).toString('base64');
  const syncSrc = SYNC
    .replace(/import \{ requireAuth \} from '\.\.\/_lib\/auth\/middleware\.js';/, 'const requireAuth = (...a) => globalThis.__AUTH.requireAuth(...a);')
    .replace(/import \{ listBookings[^}]*\} from '\.\.\/_lib\/calendar\/store\.js';/, 'const listBookings = (...a) => globalThis.__STORE.listBookings(...a); const saveBooking = (...a) => globalThis.__STORE.saveBooking(...a); const getAccessToken = (...a) => globalThis.__STORE.getAccessToken(...a); const storageReady = () => globalThis.__STORE.storageReady();')
    .replace(/import \{ syncBookingToCalendar, applyCalendarResult \} from '\.\.\/_lib\/calendar\/actions\.js';/,
      'const { syncBookingToCalendar, applyCalendarResult } = await import(' + JSON.stringify(actionsUrl) + ');');
  const endpoint = (await import('data:text/javascript;base64,' + Buffer.from(syncSrc).toString('base64'))).default;

  const mkRes = () => {
    const r = { code: 0, body: null, headers: {} };
    r.setHeader = (k, v) => { r.headers[k] = v; };
    r.status = (c) => { r.code = c; return r; };
    r.json = (b) => { r.body = b; return r; };
    return r;
  };
  const call = async (req) => { const res = mkRes(); await endpoint(req, res); return res; };

  // A dry run.
  let res = await call({ method: 'POST', body: { dryRun: true, days: 365 } });
  ok('a dry run reports what it would do', res.code === 200 && res.body.counts.considered === 2
    && res.body.results.length === 1 && res.body.results[0].outcome === 'would-create');
  ok('and writes absolutely nothing', savedRows.length === 0 && insertedEvents.length === 0);

  // The real run.
  savedRows = []; insertedEvents = [];
  res = await call({ method: 'POST', body: { days: 365 } });
  ok('the real run creates the missing event', res.code === 200 && res.body.counts.created === 1);
  ok('it is the booking that was missing', res.body.results.map((r) => r.ref).join(',') === 'AP-001');
  ok('the event carries the booking on it', insertedEvents.length === 1 && insertedEvents[0].summary === 'Consultation with Sarah');
  ok('a colleague\'s booking is never touched', !savedRows.some((b) => b.clientEmail === 'jess@x.com'));
  ok('a cancelled booking is skipped', !savedRows.some((b) => b.ref === 'AP-004'));
  ok('one already in the diary is left alone', !savedRows.some((b) => b.ref === 'AP-002')
    && res.body.counts.alreadyThere === 1);
  ok('and the booking now records that it got there', savedRows[0] && savedRows[0].calendarStatus === 'created');

  // Running it twice.
  BOOKINGS[0].providerEventId = 'evt_new_1';
  savedRows = []; insertedEvents = [];
  res = await call({ method: 'POST', body: { days: 365 } });
  ok('running it again creates no duplicate', res.code === 200
    && res.body.counts.created === 0 && insertedEvents.length === 0);

  // Fail closed.
  globalThis.__AUTH.requireAuth = async () => ({ clientRecordId: 'recTG', email: '' });
  res = await call({ method: 'POST', body: {} });
  ok('a caller we cannot identify is refused, not served', res.code === 403);

  globalThis.__AUTH.requireAuth = async () => ({ clientRecordId: 'recTG', email: 'nobody@x.com' });
  res = await call({ method: 'POST', body: {} });
  ok('someone with no calendar is told to connect one first',
    res.code === 200 && res.body.connected === false && /Connect one/.test(res.body.error));

  res = await call({ method: 'GET' });
  ok('a GET cannot trigger it', res.code === 405);
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
