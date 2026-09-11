/**
 * GET /api/calendar/connect?provider=google|microsoft|zoom&ret=<path>
 * Starts the OAuth flow for the signed-in client. Redirects the browser to
 * the chosen provider's consent screen with a signed state token carrying
 * the client's record id, the provider and the exact redirect URI.
 * Zoom rides the same flow but is a CONFERENCING connection, stored
 * alongside the calendar one rather than replacing it.
 */
import { requireAuth } from '../_lib/auth/middleware.js';
import { getProvider, isProvider } from '../_lib/calendar/providers.js';
import * as zoomProvider from '../_lib/calendar/zoom.js';
import { signState } from '../_lib/calendar/state.js';
import { resolveHost } from '../_lib/app-hosts.js';

/**
 * Send the browser back to the editor with a status flag, the same way the
 * callback does. This is a full-page navigation, not a fetch, so a JSON body
 * would be rendered at the visitor as raw text: a setup problem on our side
 * has to come back as a message the editor can show.
 */
function back(res, ret, status, param) {
  const sep = ret.indexOf('?') >= 0 ? '&' : '?';
  res.writeHead(302, { Location: ret + sep + (param || 'calendar') + '=' + status });
  res.end();
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const ctx = await requireAuth(req, res);
  if (!ctx) return;
  if (!ctx.clientRecordId) return res.status(400).json({ error: 'No client on this account' });

  const providerName = (req.query && req.query.provider) || 'google';
  const provider = providerName === 'zoom' ? zoomProvider : (isProvider(providerName) ? getProvider(providerName) : null);
  if (!provider) return res.status(400).json({ error: 'Unknown provider' });

  let ret = '/editor-appointment';
  const raw = req.query && req.query.ret;
  if (typeof raw === 'string' && raw.startsWith('/') && raw.length < 300) ret = raw;
  const param = providerName === 'zoom' ? 'zoom' : 'calendar';

  // Credentials missing, or present but wrong — most often the calendar vars
  // pointed at the sign-in OAuth client, which carries no calendar callback and
  // so earns a redirect_uri_mismatch at the provider. Either way this is our
  // setup, not the user's: return them to the editor with something readable
  // instead of sending them to the provider's own error page.
  const configError = !provider.configured()
    ? 'not_configured'
    : (typeof provider.configError === 'function' ? provider.configError() : null);
  if (configError) {
    console.error('[calendar/connect] provider not usable:', providerName, configError);
    return back(res, ret, 'notsetup', param);
  }

  // The redirect URI must be one the provider's console knows, so it comes from
  // the shared host list rather than from the raw Host header: an unrecognised
  // host (a Vercel preview, a new alias) round-trips through the primary host
  // instead of being handed to the provider as a URI it has never seen, which
  // is what produced "Error 400: redirect_uri_mismatch" for a user connecting
  // Google Calendar on id.travelify.io (11 Sep 2026).
  const host = resolveHost(req);
  const redirectUri = `https://${host}/api/calendar/callback`;

  const state = signState({ clientRecordId: ctx.clientRecordId, provider: providerName, redirectUri, ret });
  // One line per attempt: if a provider ever refuses the URI again, the exact
  // string we sent is in the log instead of only on the user's screen.
  console.log('[calendar/connect] provider=' + providerName + ' redirect_uri=' + redirectUri);
  res.writeHead(302, { Location: provider.authUrl(state, redirectUri) });
  res.end();
}
