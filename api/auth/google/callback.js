/**
 * GET /api/auth/google/callback?code=...&state=...
 *
 * Completes "Continue with Google". Exchanges the code server-side, reads
 * the verified email off Google's ID token, and signs the user in ONLY if
 * a User row with that email already exists.
 *
 * Locked rules (3 Jul 2026, same as the add-a-password route):
 *   - NEVER creates an account. The email must match one Travelify's SSO
 *     (or a staff invite) already created. Unknown email → friendly error.
 *   - Purely additive: Travelify SSO and password sign-in are untouched.
 *     'google' is appended to the account's auth methods for the record.
 *
 * Session minting mirrors sso.js/signin.js exactly (same JWT payload, same
 * SESSIONS row, same cookie), so a Google session is indistinguishable
 * from any other downstream.
 *
 * The ID token is accepted without a JWKS signature check because it is
 * received directly from Google's token endpoint over TLS in a
 * confidential-client exchange (per OIDC Core §3.1.3.7.6 the TLS channel
 * validation suffices in that case); iss/aud/exp/email_verified are all
 * still checked.
 */

import { findOneByField, createRecord, updateRecord } from '../../_lib/auth/airtable.js';
import { USERS, SESSIONS, AUTH_EVENTS } from '../../_lib/auth/schema.js';
import { signSessionToken, uuid } from '../../_lib/auth/crypto.js';
import { setSessionCookie, clearSessionCookie } from '../../_lib/auth/cookie.js';
import { revokeAllUserSessions } from '../../_lib/auth/sessions.js';
import { resolveUserPermissions } from '../../_lib/auth/permissions.js';
import { logAuthEvent } from '../../_lib/auth/audit.js';
import { getRequestIp, getUserAgent } from '../../_lib/auth/http.js';
import { limiters } from '../../_lib/auth/ratelimit.js';
import {
  GOOGLE_TOKEN_URL, googleConfig, redirectUri, redirectToSignin, redirectTo,
  DEFAULT_REDIRECT, takeState,
} from './_shared.js';

/** Decode a JWT payload segment without verifying the signature (see the
 *  header comment for why that is acceptable here). */
function decodeJwtPayload(jwt) {
  try {
    const seg = String(jwt).split('.')[1];
    return JSON.parse(Buffer.from(seg, 'base64url').toString('utf8'));
  } catch { return null; }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    return res.end('GET only');
  }
  const q = req.query || {};
  const ip = getRequestIp(req);
  const ua = getUserAgent(req);

  // User pressed cancel on Google's screen.
  if (q.error) {
    return redirectToSignin(res, 'google_cancelled');
  }

  const { clientId, clientSecret, configured } = googleConfig();
  if (!configured) return redirectToSignin(res, 'google_not_configured');

  const rl = await limiters.signin({ key: `google|${ip}` });
  if (!rl.allowed) return redirectToSignin(res, 'google_failed', 'rate limited');

  // One-shot state: binds this callback to a start we issued (CSRF) and
  // carries the post-login destination.
  const st = await takeState(q.state);
  if (!st) return redirectToSignin(res, 'google_state', 'state missing or already used');
  const next = st.next || DEFAULT_REDIRECT;

  if (!q.code || typeof q.code !== 'string') {
    return redirectToSignin(res, 'google_failed', 'no code');
  }

  try {
    // ── Exchange the code for tokens, server to server ─────────────────
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: q.code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri(req),
        grant_type: 'authorization_code',
      }),
      signal: AbortSignal.timeout(10000),
    });
    const tokens = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !tokens.id_token) {
      console.error('[google] token exchange failed:', tokenRes.status, tokens.error || '');
      return redirectToSignin(res, 'google_failed', 'token exchange ' + tokenRes.status);
    }

    const claims = decodeJwtPayload(tokens.id_token);
    const issOk = claims && (claims.iss === 'https://accounts.google.com' || claims.iss === 'accounts.google.com');
    const audOk = claims && claims.aud === clientId;
    const freshOk = claims && Number(claims.exp) * 1000 > Date.now();
    if (!issOk || !audOk || !freshOk) {
      return redirectToSignin(res, 'google_failed', 'id token rejected');
    }
    // A Google account with an unverified email must not vouch for that
    // address — that would let anyone claim a client's email.
    if (claims.email_verified !== true || !claims.email) {
      return redirectToSignin(res, 'google_failed', 'email not verified');
    }
    const email = String(claims.email).trim().toLowerCase();

    // ── Strictly sign-in, never sign-up ─────────────────────────────────
    const userRec = await findOneByField(USERS.tableId, USERS.fields.email, email);
    if (!userRec) {
      logAuthEvent({
        type: AUTH_EVENTS.types.SIGNIN_FAIL, success: false,
        emailAttempted: email, ip, userAgent: ua,
        detail: { source: 'google', reason: 'no_account' },
      }).catch(() => {});
      return redirectToSignin(res, 'google_no_account');
    }
    const userFields = userRec.fields;
    if (userFields[USERS.fields.status] === USERS.statuses.SUSPENDED) {
      logAuthEvent({
        type: AUTH_EVENTS.types.SIGNIN_FAIL, success: false,
        userRecordId: userRec.id, emailAttempted: email, ip, userAgent: ua,
        detail: { source: 'google', reason: 'suspended' },
      }).catch(() => {});
      return redirectToSignin(res, 'google_suspended');
    }

    // ── Mint the session exactly as signin.js/sso.js do ────────────────
    const clientRecordId = (userFields[USERS.fields.client] || [])[0];
    const role = userFields[USERS.fields.role] || USERS.roles.MEMBER;
    const permissions = await resolveUserPermissions(userRec.id, email, { bypassCache: true });

    try {
      await revokeAllUserSessions(userRec.id, 'google_new_session');
    } catch (err) {
      console.error('[google] revoke previous sessions failed:', err.message);
    }

    const sessionId = uuid();
    const { token, jti, expiresAt } = signSessionToken({
      userId: userRec.id,
      clientId: clientRecordId,
      role,
      sessionId,
      permissions: permissions.map((p) => ({ product: p.product, role: p.role })),
    });

    const nowIso = new Date().toISOString();
    await createRecord(SESSIONS.tableId, {
      [SESSIONS.fields.sessionId]: sessionId,
      [SESSIONS.fields.user]:      [userRec.id],
      [SESSIONS.fields.jwtJti]:    jti,
      [SESSIONS.fields.userAgent]: ua,
      [SESSIONS.fields.ipAddress]: ip,
      [SESSIONS.fields.created]:   nowIso,
      [SESSIONS.fields.expiresAt]: expiresAt.toISOString(),
      [SESSIONS.fields.lastUsed]:  nowIso,
    });

    // Additive method record + last-login, best effort. Password and SSO
    // routes are untouched — this only APPENDS 'google'.
    const existingMethods = userFields[USERS.fields.authMethods] || [];
    const methods = existingMethods.includes(USERS.authMethodValues.GOOGLE)
      ? existingMethods
      : [...existingMethods, USERS.authMethodValues.GOOGLE];
    updateRecord(USERS.tableId, userRec.id, {
      [USERS.fields.authMethods]: methods,
      [USERS.fields.lastLogin]:   nowIso,
      [USERS.fields.lastLoginIp]: ip,
    }).catch((err) => console.warn('[google] user update failed (ignored):', err.message));

    clearSessionCookie(res, { req });
    setSessionCookie(res, token, expiresAt, { req });

    logAuthEvent({
      type: AUTH_EVENTS.types.SIGNIN_SUCCESS, success: true,
      userRecordId: userRec.id,
      clientRecordId,
      emailAttempted: email,
      ip, userAgent: ua,
      detail: { source: 'google' },
    }).catch(() => {});

    return redirectTo(res, next);
  } catch (err) {
    console.error('[google] unexpected error:', err);
    logAuthEvent({
      type: AUTH_EVENTS.types.SIGNIN_FAIL, success: false,
      ip, userAgent: ua,
      detail: { source: 'google', reason: 'unexpected_error', error: String(err?.message || err).slice(0, 200) },
    }).catch(() => {});
    return redirectToSignin(res, 'google_failed', 'unexpected error');
  }
}
