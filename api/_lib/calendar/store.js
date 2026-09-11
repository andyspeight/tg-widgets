/**
 * Persistence for the Appointment Scheduler's calendar suite.
 *
 * Backed by Upstash Redis (api/_redis.js). Refresh tokens are encrypted at
 * rest with the shared AES helper (api/_crypto.js, key TG_ENCRYPTION_KEY).
 *
 * Keys:
 *   apt:cal:u:<ownerEmail>       → that PERSON's connection (the one that matters)
 *   apt:cal:<clientRecordId>     → the agency default, set by whoever connected first
 *   apt:booking:<ref>            → booking record
 *   apt:manage:<manageToken>     → ref (string)
 *   apt:hold:<clientRecordId>:<startISO> → ref (double-booking guard, even without a connected calendar)
 *
 * WHO A CALENDAR BELONGS TO (11 Sep 2026). There used to be one connection per
 * CLIENT, so every person in an agency shared it. Andy connected his Google
 * Calendar and Jess, a second admin on the same client, opened the extension
 * and was shown his diary. Worse was waiting: had she connected hers, it would
 * have replaced his, and his own bookings would have started landing in her
 * calendar.
 *
 * A calendar belongs to a PERSON, so it is now keyed by their email. The client
 * key stays as the agency default for a widget whose owner has not connected
 * one of their own, and a second person connecting no longer overwrites it.
 *
 * Pass ownerEmail on every read that has a person in hand: the signed-in user
 * for their own diary, the widget's ClientEmail for a booking. With an
 * ownerEmail the agency default is only ever returned to the person it belongs
 * to, so nobody is shown a calendar that is not theirs.
 *
 * If Redis is not configured every read returns null and every write returns
 * false, so callers degrade gracefully (the widget falls back to its
 * client-side, no-backend path).
 */

import { setJson, getJson, setString, getString, zadd, zrangebyscore, incr, decr, configured as redisConfigured } from '../../_redis.js';
import { encrypt, decrypt } from '../../_crypto.js';
import * as zoom from './zoom.js';
import { getProvider } from './providers.js';

export function storageReady() { return redisConfigured(); }

const normEmail = (v) => String(v == null ? '' : v).toLowerCase().trim();
const connKey = (clientId) => 'apt:cal:' + clientId;
const userConnKey = (email) => 'apt:cal:u:' + normEmail(email);

/**
 * Is this connection this person's? The recorded owner decides it. A
 * connection saved before owners were recorded has none, so fall back to the
 * address of the Google or Microsoft account itself: someone who connected the
 * calendar of the account they sign in with keeps working without reconnecting,
 * and nobody else is handed it.
 */
function ownsConnection(conn, ownerEmail) {
  const who = normEmail(ownerEmail);
  if (!conn || !who) return false;
  const recorded = normEmail(conn.ownerEmail);
  if (recorded) return recorded === who;
  return normEmail(conn.email) === who;
}

function liveConn(rec) {
  if (!rec || rec.revoked || !rec.refreshTokenEnc) return null;
  return rec;
}
const bookingKey = (ref) => 'apt:booking:' + ref;
const manageKey = (token) => 'apt:manage:' + token;
const holdKey = (clientId, startISO) => 'apt:hold:' + clientId + ':' + startISO;
const indexKey = (clientId) => 'apt:index:' + clientId;
const ALL_INDEX = 'apt:index:all';
const dayCountKey = (clientId, dayKey) => 'apt:count:' + clientId + ':' + dayKey;

// ── Connections ────────────────────────────────────────────
export async function saveConnection(clientId, conn, ownerEmail) {
  const owner = normEmail(ownerEmail || conn.ownerEmail);
  if (!clientId && !owner) return false;
  const rec = {
    provider: conn.provider || 'google',
    email: conn.email || '',
    ownerEmail: owner,
    calendarId: conn.calendarId || 'primary',
    refreshTokenEnc: conn.refreshToken ? encrypt(conn.refreshToken) : (conn.refreshTokenEnc || ''),
    scope: conn.scope || '',
    connectedAt: conn.connectedAt || new Date().toISOString(),
  };

  // The person's own connection is the one that matters.
  let ok = true;
  if (owner) ok = await setJson(userConnKey(owner), rec);

  // The agency default is claimed by the first person to connect and is never
  // taken from them by the next. Without this, the second person in an agency
  // would silently redirect the first person's bookings into their calendar.
  if (clientId) {
    const existing = liveConn(await getJson(connKey(clientId)));
    if (!existing || !owner || ownsConnection(existing, owner)) {
      const okClient = await setJson(connKey(clientId), rec);
      if (!owner) ok = okClient;
    }
  }
  return ok;
}

/**
 * The calendar to use for this person. With an ownerEmail: their own
 * connection, or the agency default when it is theirs, and otherwise nothing.
 * Without one, the agency default, which is what the older callers expect.
 */
export async function getConnection(clientId, ownerEmail) {
  const owner = normEmail(ownerEmail);
  if (owner) {
    const mine = liveConn(await getJson(userConnKey(owner)));
    if (mine) return mine;
  }
  if (!clientId) return null;
  const shared = liveConn(await getJson(connKey(clientId)));
  if (!shared) return null;
  if (owner && !ownsConnection(shared, owner)) return null;
  return shared;
}

export async function deleteConnection(clientId, ownerEmail) {
  const owner = normEmail(ownerEmail);
  const gone = { revoked: true, revokedAt: new Date().toISOString() };
  let ok = true;
  if (owner) ok = await setJson(userConnKey(owner), gone);
  // Only clear the agency default if it is this person's to clear.
  if (clientId) {
    const shared = liveConn(await getJson(connKey(clientId)));
    if (shared && (!owner || ownsConnection(shared, owner))) {
      const okClient = await setJson(connKey(clientId), gone);
      if (!owner) ok = okClient;
    }
  }
  return ok;
}

export async function isConnected(clientId, ownerEmail) {
  const c = await getConnection(clientId, ownerEmail);
  return !!c;
}

/**
 * Resolve a usable access token for a connected calendar. Pass ownerEmail so
 * the token can only ever be the right person's: the signed-in user for their
 * own diary, the widget's ClientEmail for availability and bookings.
 * Returns { accessToken, calendarId, email, ownerEmail, provider } or null.
 */
export async function getAccessToken(clientId, ownerEmail) {
  const conn = await getConnection(clientId, ownerEmail);
  if (!conn) return null;
  let refreshToken;
  try { refreshToken = decrypt(conn.refreshTokenEnc); } catch (e) { return null; }
  try {
    const provider = getProvider(conn.provider);
    const tok = await provider.refresh(refreshToken);
    if (!tok || !tok.access_token) return null;
    return { accessToken: tok.access_token, calendarId: conn.calendarId, email: conn.email, ownerEmail: conn.ownerEmail || '', provider: conn.provider || 'google' };
  } catch (e) { return null; }
}

// ── Zoom connection (separate from the calendar one) ───────
// A client can hold BOTH: the calendar drives availability and invites, Zoom
// drives per-booking video meetings. Key: apt:zoom:<clientRecordId>.
const zoomKey = (clientId) => 'apt:zoom:' + clientId;

export async function saveZoomConnection(clientId, conn) {
  if (!clientId) return false;
  return setJson(zoomKey(clientId), {
    email: conn.email || '',
    refreshTokenEnc: conn.refreshToken ? encrypt(conn.refreshToken) : (conn.refreshTokenEnc || ''),
    connectedAt: conn.connectedAt || new Date().toISOString(),
  });
}

export async function getZoomConnection(clientId) {
  if (!clientId) return null;
  const rec = await getJson(zoomKey(clientId));
  if (!rec || rec.revoked || !rec.refreshTokenEnc) return null;
  return rec;
}

export async function deleteZoomConnection(clientId) {
  if (!clientId) return false;
  return setJson(zoomKey(clientId), { revoked: true, revokedAt: new Date().toISOString() });
}

/**
 * Resolve a usable Zoom access token. Zoom ROTATES the refresh token on
 * every refresh, so the replacement is persisted immediately — losing it
 * would kill the connection on the next use.
 */
export async function getZoomAccessToken(clientId) {
  const conn = await getZoomConnection(clientId);
  if (!conn) return null;
  let refreshToken;
  try { refreshToken = decrypt(conn.refreshTokenEnc); } catch (e) { return null; }
  try {
    const tok = await zoom.refresh(refreshToken);
    if (!tok || !tok.access_token) return null;
    if (tok.refresh_token && tok.refresh_token !== refreshToken) {
      await saveZoomConnection(clientId, { email: conn.email, refreshToken: tok.refresh_token, connectedAt: conn.connectedAt });
    }
    return { accessToken: tok.access_token, email: conn.email };
  } catch (e) { return null; }
}

// ── Bookings ───────────────────────────────────────────────
export async function saveBooking(b) {
  if (!b || !b.ref) return false;
  const ok = await setJson(bookingKey(b.ref), b);
  if (b.manageToken) await setString(manageKey(b.manageToken), b.ref);
  // Keep the time indexes in sync (zadd updates the score on reschedule).
  if (b.startISO) {
    const ms = Date.parse(b.startISO);
    if (Number.isFinite(ms)) {
      if (b.clientRecordId) await zadd(indexKey(b.clientRecordId), ms, b.ref);
      await zadd(ALL_INDEX, ms, b.ref);
    }
  }
  return ok;
}

/** Confirmed bookings across all clients between two epoch-ms bounds. */
export async function listAllBookings(fromMs, toMs) {
  const refs = await zrangebyscore(ALL_INDEX, fromMs, toMs);
  const out = [];
  for (const ref of refs) { const b = await getBooking(ref); if (b) out.push(b); }
  return out;
}

/** Confirmed bookings for a client between two epoch-ms bounds (inclusive). */
export async function listBookings(clientId, fromMs, toMs) {
  if (!clientId) return [];
  const refs = await zrangebyscore(indexKey(clientId), fromMs, toMs);
  const out = [];
  for (const ref of refs) {
    const b = await getBooking(ref);
    if (b) out.push(b);
  }
  return out;
}

// ── Daily booking cap counters ─────────────────────────────
export async function incDayCount(clientId, dayKey) { if (!clientId || !dayKey) return null; return incr(dayCountKey(clientId, dayKey)); }
export async function decDayCount(clientId, dayKey) { if (!clientId || !dayKey) return null; return decr(dayCountKey(clientId, dayKey)); }
export async function getDayCount(clientId, dayKey) {
  if (!clientId || !dayKey) return 0;
  const v = await getString(dayCountKey(clientId, dayKey));
  return Number.isFinite(+v) ? +v : 0;
}

export async function getBooking(ref) {
  if (!ref) return null;
  return getJson(bookingKey(ref));
}

export async function getBookingByToken(token) {
  if (!token) return null;
  const ref = await getString(manageKey(token));
  if (!ref) return null;
  return getBooking(ref);
}

// ── Double-booking hold ────────────────────────────────────
// A hold guards a slot between "start booking" and "booking saved", and (with
// no connected calendar) is the only double-booking guard. Holds carry no TTL,
// so the value is "<ref>|<placedAtMs>": a hold is only respected while it is
// FRESH (a booking genuinely in flight) or still backed by a live booking. An
// older hold with no live booking behind it is an orphan — a failed save or an
// abandoned attempt — and is reclaimed, so a slot can never wedge permanently
// as "taken" with no way to clear it.
const HOLD_FRESH_MS = 5 * 60 * 1000;

function parseHold(v) {
  if (!v) return { ref: '', placedAt: 0 };
  const i = String(v).indexOf('|');
  if (i === -1) return { ref: v, placedAt: 0 };            // legacy hold (no timestamp) → treat as old
  return { ref: v.slice(0, i), placedAt: Number(v.slice(i + 1)) || 0 };
}

// Returns true if the hold was placed, false if the slot is genuinely taken.
export async function placeHold(clientId, startISO, ref) {
  if (!clientId || !startISO) return true;   // no client scope → nothing to guard
  const key = holdKey(clientId, startISO);
  const { ref: existRef, placedAt } = parseHold(await getString(key));
  if (existRef && existRef !== ref) {
    const fresh = (Date.now() - placedAt) < HOLD_FRESH_MS;
    let liveBooking = false;
    if (!fresh) {
      // Only reclaim once we are sure no live booking stands behind the hold.
      try { const b = await getBooking(existRef); liveBooking = !!(b && b.status !== 'cancelled'); }
      catch (e) { liveBooking = true; }   // cannot verify → keep the slot guarded
    }
    if (fresh || liveBooking) return false;
  }
  await setString(key, ref + '|' + Date.now());
  return true;
}

export async function releaseHold(clientId, startISO) {
  if (!clientId || !startISO) return false;
  // No DEL helper exposed; blank the hold so a future booking can take it.
  return setString(holdKey(clientId, startISO), '');
}

export async function isHeld(clientId, startISO, exceptRef) {
  if (!clientId || !startISO) return false;
  const { ref } = parseHold(await getString(holdKey(clientId, startISO)));
  return !!(ref && ref !== exceptRef);
}
