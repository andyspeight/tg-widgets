/**
 * GET /api/auth/google/start[?next=/dashboard.html]
 *
 * Kicks off "Continue with Google": stores a one-shot state in Redis and
 * bounces the browser to Google's consent screen. The callback endpoint
 * does the account matching — strictly sign-in to an EXISTING account,
 * never account creation (locked rule, 3 Jul 2026).
 */

import { generateSecureToken } from '../../_lib/auth/crypto.js';
import { configured as redisConfigured } from '../../_redis.js';
import {
  GOOGLE_AUTH_URL, googleConfig, redirectUri, redirectToSignin, safeNext, saveState,
} from './_shared.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    return res.end('GET only');
  }
  const { clientId, configured } = googleConfig();

  // Booleans-only health probe (no secret values, safe to expose). Tells us
  // which of the two "bounce back to sign-in" causes is in play — a missing
  // Google client, or a failing one-shot state store — since the redirect
  // hides that from the outside.
  if (req.query && req.query.probe === '1') {
    let stateStoreOk = false, stateErr = null;
    try {
      stateStoreOk = !!(await saveState(generateSecureToken(), '/dashboard.html'));
    } catch (e) { stateErr = String(e && e.message || e).slice(0, 120); }
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      googleConfigured: configured,
      redisConfigured: redisConfigured(),
      stateStoreOk,
      ...(stateErr ? { stateErr } : {}),
      redirectUri: redirectUri(req),
    });
  }

  if (!configured) {
    return redirectToSignin(res, 'google_not_configured');
  }

  const state = generateSecureToken();
  const stored = await saveState(state, safeNext(req.query && req.query.next));
  if (!stored) {
    // Redis down or state collision — refuse rather than run an unbound flow.
    return redirectToSignin(res, 'google_failed', 'state store unavailable');
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(req),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    // Always show the account picker: agency staff often juggle several
    // Google accounts and silently reusing the last one causes mismatches.
    prompt: 'select_account',
  });
  res.statusCode = 302;
  res.setHeader('Location', `${GOOGLE_AUTH_URL}?${params.toString()}`);
  res.setHeader('Cache-Control', 'no-store');
  res.end();
}
