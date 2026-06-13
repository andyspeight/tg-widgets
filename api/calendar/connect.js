/**
 * GET /api/calendar/connect?provider=google|microsoft&ret=<path>
 * Starts the calendar OAuth flow for the signed-in client. Redirects the
 * browser to the chosen provider's consent screen with a signed state token
 * carrying the client's record id, the provider and the exact redirect URI.
 */
import { requireAuth } from '../_lib/auth/middleware.js';
import { getProvider, isProvider } from '../_lib/calendar/providers.js';
import { signState } from '../_lib/calendar/state.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const ctx = await requireAuth(req, res);
  if (!ctx) return;
  if (!ctx.clientRecordId) return res.status(400).json({ error: 'No client on this account' });

  const providerName = (req.query && req.query.provider) || 'google';
  if (!isProvider(providerName)) return res.status(400).json({ error: 'Unknown calendar provider' });
  const provider = getProvider(providerName);
  if (!provider.configured()) return res.status(500).json({ error: 'That calendar provider is not configured on the server' });

  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const host = req.headers.host;
  const redirectUri = `${proto}://${host}/api/calendar/callback`;

  let ret = '/editor-appointment';
  const raw = req.query && req.query.ret;
  if (typeof raw === 'string' && raw.startsWith('/') && raw.length < 300) ret = raw;

  const state = signState({ clientRecordId: ctx.clientRecordId, provider: providerName, redirectUri, ret });
  res.writeHead(302, { Location: provider.authUrl(state, redirectUri) });
  res.end();
}
