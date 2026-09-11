/**
 * A calendar belongs to a person, not to an agency (11 Sep 2026).
 *
 * Jess opened the scheduler extension and was shown Andy's whole diary. They
 * are two admins on one client, and a calendar connection was stored once per
 * CLIENT (apt:cal:<clientRecordId>), so whoever connected first became
 * everybody's calendar. Andy had connected his, so Jess got his meetings.
 *
 * A worse failure was one click away. Had Jess connected hers, it would have
 * REPLACED the shared record, and from then on Andy's own bookings would have
 * been written into her calendar and his availability computed from her diary.
 *
 * Connections are now keyed by the person's email. The client key stays as the
 * agency default for a scheduler whose owner has connected nothing, and is
 * never taken from the person who set it.
 *
 * This exercises the real store against a stand-in for Redis, so it tests the
 * ownership rules rather than a restatement of them, and then checks that every
 * endpoint that resolves a calendar actually passes an owner.
 *
 * Run: node test/appointment-calendar-owner-smoke.mjs
 *      (npm run test:appointment-calendar-owner)
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

let passed = 0, failed = 0;
const ok = (label, cond, detail) => {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.error('  ✗ ' + label + (detail ? '\n      ' + detail : '')); }
};

// ── A stand-in for Redis and for the crypto, so the store's real logic runs ──
const mem = new Map();
const redisStub = `
export function configured() { return true; }
const M = globalThis.__TG_TEST_REDIS__;
export async function setJson(k, v) { M.set(k, JSON.parse(JSON.stringify(v))); return true; }
export async function getJson(k) { const v = M.get(k); return v === undefined ? null : JSON.parse(JSON.stringify(v)); }
export async function setString(k, v) { M.set(k, String(v)); return true; }
export async function getString(k) { const v = M.get(k); return v === undefined ? null : String(v); }
export async function zadd() { return true; }
export async function zrangebyscore() { return []; }
export async function incr() { return 1; }
export async function decr() { return 0; }
`;
globalThis.__TG_TEST_REDIS__ = mem;

// Load the REAL store with the two leaf modules swapped for stand-ins. Import
// maps are not available to a plain script, so rewrite the two import
// specifiers to data: URLs and evaluate the store's own source unchanged.
const cryptoStub = `
export function encrypt(v) { return 'enc:' + v; }
export function decrypt(v) { return String(v).replace(/^enc:/, ''); }
`;
const providersStub = `
export function getProvider() {
  return { refresh: async () => ({ access_token: 'at' }) };
}
`;
const zoomStub = `export async function refresh() { return { access_token: 'z' }; }`;

const dataUrl = (src) => 'data:text/javascript;base64,' + Buffer.from(src, 'utf8').toString('base64');
const storeSrc = readFileSync(new URL('../api/_lib/calendar/store.js', import.meta.url), 'utf8')
  .replace("from '../../_redis.js'", `from '${dataUrl(redisStub)}'`)
  .replace("from '../../_crypto.js'", `from '${dataUrl(cryptoStub)}'`)
  .replace("from './providers.js'", `from '${dataUrl(providersStub)}'`)
  .replace("from './zoom.js'", `from '${dataUrl(zoomStub)}'`);
const store = await import(dataUrl(storeSrc));

const CLIENT = 'recClientAgendas';
const ANDY = 'andy.speight@agendas.group';
const JESS = 'jessica.speight@agendas.group';
const conn = (email) => ({ provider: 'google', email, calendarId: 'primary', refreshToken: 'rt-' + email });

console.log('Andy connects his calendar');
await store.saveConnection(CLIENT, conn(ANDY), ANDY);
{
  const his = await store.getConnection(CLIENT, ANDY);
  ok('Andy gets his own calendar back', !!his && his.email === ANDY, JSON.stringify(his && his.email));
  ok('it records that it is his', !!his && his.ownerEmail === ANDY, his && his.ownerEmail);
}

console.log('Jess, on the same client, is not given his (the bug)');
{
  const hers = await store.getConnection(CLIENT, JESS);
  ok('Jess gets NOTHING, not Andy\'s calendar', hers === null,
    'she was handed ' + JSON.stringify(hers && hers.email) + ' — that is the diary she reported seeing');
  ok('and she reads as not connected', (await store.isConnected(CLIENT, JESS)) === false);
  ok('while Andy still reads as connected', (await store.isConnected(CLIENT, ANDY)) === true);
}

console.log('Jess connects her own');
await store.saveConnection(CLIENT, conn(JESS), JESS);
{
  const hers = await store.getConnection(CLIENT, JESS);
  const his = await store.getConnection(CLIENT, ANDY);
  ok('Jess now gets hers', !!hers && hers.email === JESS, hers && hers.email);
  ok('Andy still gets his, not hers', !!his && his.email === ANDY,
    (his && his.email) + ' — hers replacing his would divert his bookings into her calendar');
}

console.log('The agency default is not stolen by the second person');
{
  const shared = await store.getConnection(CLIENT);
  ok('it is still Andy\'s, who set it', !!shared && shared.email === ANDY, shared && shared.email);
  const tok = await store.getAccessToken(CLIENT, JESS);
  ok('a token for Jess is hers', !!tok && tok.email === JESS, tok && tok.email);
  const tokA = await store.getAccessToken(CLIENT, ANDY);
  ok('a token for Andy is his', !!tokA && tokA.email === ANDY, tokA && tokA.email);
}

console.log('Disconnecting takes only your own');
{
  await store.deleteConnection(CLIENT, JESS);
  ok('Jess is disconnected', (await store.getConnection(CLIENT, JESS)) === null);
  ok('Andy is untouched', !!(await store.getConnection(CLIENT, ANDY)));
  ok('and the agency default survives', !!(await store.getConnection(CLIENT)));
}

console.log('A connection made before owners were recorded still works for its owner');
{
  const C2 = 'recClientLegacy';
  const LUKE = 'luke.livsey@agendas.group';
  // Exactly what the old code wrote: no ownerEmail anywhere.
  mem.set('apt:cal:' + C2, { provider: 'google', email: LUKE, calendarId: 'primary', refreshTokenEnc: 'enc:rt', connectedAt: '2026-06-01T00:00:00.000Z' });
  const mine = await store.getConnection(C2, LUKE);
  ok('the person whose account it is keeps working, no reconnect', !!mine && mine.email === LUKE, JSON.stringify(mine && mine.email));
  const other = await store.getConnection(C2, JESS);
  ok('anyone else still gets nothing', other === null, JSON.stringify(other && other.email));
}

console.log('A revoked connection stays revoked');
{
  const C3 = 'recClientRevoked';
  await store.saveConnection(C3, conn(ANDY), ANDY);
  await store.deleteConnection(C3, ANDY);
  ok('no calendar comes back for Andy', (await store.getConnection(C3, ANDY)) === null);
  ok('and none for the client either', (await store.getConnection(C3)) === null);
}

console.log('Every endpoint that resolves a calendar names whose it is');
{
  const src = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
  const calls = (s) => [...s.matchAll(/getAccessToken\(([^)]*)\)/g)].map((m) => m[1].trim());

  // The diary is the SIGNED-IN person's.
  ok('agenda.js asks for the caller\'s own calendar',
    calls(src('api/appointment/agenda.js')).every((a) => /ctx\.email/.test(a)), calls(src('api/appointment/agenda.js')).join(' | '));
  ok('calendar/status.js reports the caller\'s own',
    /getConnection\(ctx\.clientRecordId,\s*ctx\.email\)/.test(src('api/calendar/status.js')));
  ok('calendar/disconnect.js drops only the caller\'s own',
    /deleteConnection\(ctx\.clientRecordId,\s*ctx\.email\)/.test(src('api/calendar/disconnect.js')));

  // Availability and booking belong to the SCHEDULER'S OWNER.
  for (const f of ['api/appointment/availability.js', 'api/appointment/book.js']) {
    ok(f.split('/').pop() + ' uses the scheduler owner\'s calendar',
      calls(src(f)).length > 0 && calls(src(f)).every((a) => /w\.clientEmail/.test(a)), calls(src(f)).join(' | '));
  }
  ok('actions.js reschedules and cancels in the calendar the booking went into',
    calls(src('api/_lib/calendar/actions.js')).length === 2
    && calls(src('api/_lib/calendar/actions.js')).every((a) => /booking\.clientEmail/.test(a)),
    calls(src('api/_lib/calendar/actions.js')).join(' | '));

  // Nothing may quietly go back to the client-only form.
  const all = ['api/appointment/agenda.js', 'api/appointment/availability.js', 'api/appointment/book.js', 'api/_lib/calendar/actions.js']
    .flatMap((f) => calls(src(f)));
  ok('no calendar is resolved without saying whose it is', all.every((a) => a.includes(',')), all.join(' | '));

  // The booking carries the owner, or none of the above can work.
  ok('a booking records the scheduler owner\'s email', /clientEmail:\s*w\.clientEmail/.test(src('api/appointment/book.js')));

  // The personal panel asks for its own bookings.
  const panel = src('extension/scheduler-companion/panel.js');
  ok('the extension asks for its own bookings only', /appointment\/list\?days=14&scope=self/.test(panel));
  ok('the booking list honours scope=self against the caller\'s email',
    /scope[^\n]*===\s*'self'/.test(src('api/appointment/list.js'))
    && /b\.clientEmail[^\n]*===\s*me/.test(src('api/appointment/list.js')));
  ok('and shows nothing rather than everything when the caller is unknown',
    /self\s*\)\s*bookings\s*=\s*me\s*\?/.test(src('api/appointment/list.js')));

  // The OAuth round trip has to carry the person, or nothing above gets an owner.
  ok('connect.js puts the connecting person into the signed state',
    /ownerEmail:\s*ctx\.email/.test(src('api/calendar/connect.js')));
  ok('callback.js records them on the connection',
    /saveConnection\([\s\S]*?st\.ownerEmail/.test(src('api/calendar/callback.js')));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
