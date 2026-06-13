/**
 * GET /api/calendar/connect
 * Starts the Google Calendar OAuth flow for the signed-in client. Redirects
 * the browser to Google's consent screen with a signed state token that
 * carries the client's record id and the exact redirect URI.
 *
 * Query: ?ret=<url to return to after connecting> (optional)
 */
import { requireAuth } from '../_lib/auth/middleware.js';
import * as google from '../_lib/calendar/google.js';
import { signState } from '../_lib/calendar/state.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const ctx = await requireAuth(req, res);
  if (!ctx) return;                       // requireAuth already responded
  if (!ctx.clientRecordId) return res.status(400).json({ error: 'No client on this account' });
  if (!google.configured()) return res.status(500).json({ error: 'Calendar OAuth is not configured on the server' });

  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const host = req.headers.host;
  const redirectUri = `${proto}://${host}/api/calendar/callback`;

  let ret = '/editor-appointment';
  const raw = req.query && req.query.ret;
  if (typeof raw === 'string' && raw.startsWith('/') && raw.length < 300) ret = raw;

  const state = signState({ clientRecordId: ctx.clientRecordId, provider: 'google', redirectUri, ret });
  res.writeHead(302, { Location: google.authUrl(state, redirectUri) });
  res.end();
}
