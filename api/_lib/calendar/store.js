/**
 * Persistence for the Appointment Scheduler's calendar suite.
 *
 * Backed by Upstash Redis (api/_redis.js). Refresh tokens are encrypted at
 * rest with the shared AES helper (api/_crypto.js, key TG_ENCRYPTION_KEY).
 *
 * Keys:
 *   apt:cal:<clientRecordId>      → connection { provider, email, calendarId, refreshTokenEnc, scope, connectedAt }
 *   apt:booking:<ref>            → booking record
 *   apt:manage:<manageToken>     → ref (string)
 *   apt:hold:<clientRecordId>:<startISO> → ref (double-booking guard, even without a connected calendar)
 *
 * If Redis is not configured every read returns null and every write returns
 * false, so callers degrade gracefully (the widget falls back to its
 * client-side, no-backend path).
 */

import { setJson, getJson, setString, getString, configured as redisConfigured } from '../../_redis.js';
import { encrypt, decrypt } from '../../_crypto.js';
import * as google from './google.js';

export function storageReady() { return redisConfigured(); }

const connKey = (clientId) => 'apt:cal:' + clientId;
const bookingKey = (ref) => 'apt:booking:' + ref;
const manageKey = (token) => 'apt:manage:' + token;
const holdKey = (clientId, startISO) => 'apt:hold:' + clientId + ':' + startISO;

// ── Connections ────────────────────────────────────────────
export async function saveConnection(clientId, conn) {
  if (!clientId) return false;
  const rec = {
    provider: conn.provider || google.PROVIDER,
    email: conn.email || '',
    calendarId: conn.calendarId || 'primary',
    refreshTokenEnc: conn.refreshToken ? encrypt(conn.refreshToken) : (conn.refreshTokenEnc || ''),
    scope: conn.scope || '',
    connectedAt: conn.connectedAt || new Date().toISOString(),
  };
  return setJson(connKey(clientId), rec);
}

export async function getConnection(clientId) {
  if (!clientId) return null;
  const rec = await getJson(connKey(clientId));
  if (!rec || rec.revoked || !rec.refreshTokenEnc) return null;
  return rec;
}

export async function deleteConnection(clientId) {
  if (!clientId) return false;
  return setJson(connKey(clientId), { revoked: true, revokedAt: new Date().toISOString() });
}

export async function isConnected(clientId) {
  const c = await getConnection(clientId);
  return !!c;
}

/**
 * Resolve a usable access token for a client's connected calendar.
 * Returns { accessToken, calendarId, email, provider } or null.
 */
export async function getAccessToken(clientId) {
  const conn = await getConnection(clientId);
  if (!conn) return null;
  let refreshToken;
  try { refreshToken = decrypt(conn.refreshTokenEnc); } catch (e) { return null; }
  try {
    const tok = await google.refresh(refreshToken);
    if (!tok || !tok.access_token) return null;
    return { accessToken: tok.access_token, calendarId: conn.calendarId, email: conn.email, provider: conn.provider };
  } catch (e) { return null; }
}

// ── Bookings ───────────────────────────────────────────────
export async function saveBooking(b) {
  if (!b || !b.ref) return false;
  const ok = await setJson(bookingKey(b.ref), b);
  if (b.manageToken) await setString(manageKey(b.manageToken), b.ref);
  return ok;
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
// Returns true if the hold was placed, false if the slot is already held.
export async function placeHold(clientId, startISO, ref) {
  if (!clientId || !startISO) return true;   // no client scope → nothing to guard
  const key = holdKey(clientId, startISO);
  const existing = await getString(key);
  if (existing && existing !== ref) return false;
  await setString(key, ref);
  return true;
}

export async function releaseHold(clientId, startISO) {
  if (!clientId || !startISO) return false;
  // No DEL helper exposed; blank the hold so a future booking can take it.
  return setString(holdKey(clientId, startISO), '');
}

export async function isHeld(clientId, startISO, exceptRef) {
  if (!clientId || !startISO) return false;
  const v = await getString(holdKey(clientId, startISO));
  return !!(v && v !== exceptRef);
}
