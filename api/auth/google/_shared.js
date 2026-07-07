/**
 * Shared pieces of the "Continue with Google" flow (start + callback).
 *
 * Design rules (locked with Andy, 3 Jul 2026 — same rules as the password
 * route):
 *   - Google is an ADDITIVE sign-in method for accounts that already exist.
 *     It can NEVER create an account: the Google email must match a User row
 *     that Travelify's SSO (or a staff invite) already created.
 *   - Travelify SSO stays the preferred route and is untouched by this flow.
 *
 * OAuth shape: standard server-side authorization-code flow. The state value
 * is stored one-shot in Redis (10 min TTL) to bind start → callback and to
 * carry the post-login destination.
 */

import { setNxEx, getString, del } from '../../_redis.js';

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

export const SIGNIN_PATH = '/signin.html';
export const DEFAULT_REDIRECT = '/dashboard.html';
const SAFE_NEXT_PREFIXES = ['/home.html', '/admin', '/dashboard.html'];

// Hosts we serve sign-in on. The OAuth redirect URI is rebuilt from the
// request host so each host round-trips to itself; every one of these must
// also be registered as an authorised redirect URI in the Google console.
const ALLOWED_HOSTS = ['id.travelify.io', 'widgets.travelify.io', 'tg-widgets.vercel.app'];
const PRIMARY_HOST = 'id.travelify.io';

// Sign-in uses its OWN OAuth client, deliberately separate from the calendar
// integration's GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET (api/_lib/calendar/
// google.js). Reasons: (1) the calendar client requests sensitive Calendar
// scopes and carries the calendar callback's redirect URIs — reusing it would
// entangle sign-in with the calendar consent screen's verification state and
// require our redirect URIs on that client; (2) least privilege — the sign-in
// client can only ever see name + email, never anyone's calendar. So keep the
// two clients fully independent; no fallback to the calendar vars.
export function googleConfig() {
  const clientId = process.env.GOOGLE_SIGNIN_CLIENT_ID || '';
  const clientSecret = process.env.GOOGLE_SIGNIN_CLIENT_SECRET || '';
  return { clientId, clientSecret, configured: !!(clientId && clientSecret) };
}

export function requestHost(req) {
  const h = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim().toLowerCase();
  return ALLOWED_HOSTS.includes(h) ? h : PRIMARY_HOST;
}

export function redirectUri(req) {
  return `https://${requestHost(req)}/api/auth/google/callback`;
}

export function redirectToSignin(res, code, detail) {
  const params = new URLSearchParams();
  params.set('error', code || 'google_failed');
  if (detail) params.set('detail', String(detail).slice(0, 200));
  res.statusCode = 302;
  res.setHeader('Location', `${SIGNIN_PATH}?${params.toString()}`);
  res.setHeader('Cache-Control', 'no-store');
  res.end();
}

export function redirectTo(res, path) {
  res.statusCode = 302;
  res.setHeader('Location', path);
  res.setHeader('Cache-Control', 'no-store');
  res.end();
}

export function safeNext(rawNext) {
  if (!rawNext || typeof rawNext !== 'string') return DEFAULT_REDIRECT;
  if (!rawNext.startsWith('/') || rawNext.startsWith('//')) return DEFAULT_REDIRECT;
  const ok = SAFE_NEXT_PREFIXES.some((p) => rawNext === p || rawNext.startsWith(p + '/') || rawNext.startsWith(p + '?'));
  return ok ? rawNext : DEFAULT_REDIRECT;
}

const stateKey = (state) => 'auth:gstate:' + state;

/** Store the state one-shot with the post-login destination. */
export async function saveState(state, next) {
  return setNxEx(stateKey(state), JSON.stringify({ next, at: Date.now() }), 600);
}

/** Redeem the state exactly once. Returns { next } or null. */
export async function takeState(state) {
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(String(state || ''))) return null;
  const raw = await getString(stateKey(state));
  if (!raw) return null;
  await del(stateKey(state)).catch(() => {});
  try { return JSON.parse(raw); } catch { return null; }
}
