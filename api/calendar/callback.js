/**
 * GET /api/calendar/callback
 * The OAuth provider (Google / Microsoft / Zoom) redirects here after
 * consent. Verifies the signed state, exchanges the code for tokens, stores
 * the encrypted refresh token against the client, then bounces the user back
 * to the editor with a status flag (?calendar=… or ?zoom=…).
 */
import { getProvider } from '../_lib/calendar/providers.js';
import * as zoomProvider from '../_lib/calendar/zoom.js';
import { verifyState } from '../_lib/calendar/state.js';
import { saveConnection, saveZoomConnection, storageReady } from '../_lib/calendar/store.js';

function back(res, ret, status, param) {
  const sep = ret.indexOf('?') >= 0 ? '&' : '?';
  res.writeHead(302, { Location: ret + sep + (param || 'calendar') + '=' + status });
  res.end();
}

export default async function handler(req, res) {
  const q = req.query || {};
  const st = verifyState(q.state);
  const ret = (st && typeof st.ret === 'string' && st.ret.startsWith('/')) ? st.ret : '/editor-appointment';
  const isZoom = !!(st && st.provider === 'zoom');
  const param = isZoom ? 'zoom' : 'calendar';

  if (q.error) return back(res, ret, 'denied', param);
  if (!st || !q.code) return back(res, ret, 'error', param);
  if (!storageReady()) { console.error('[calendar/callback] storage (Redis) not configured'); return back(res, ret, 'nostore', param); }

  try {
    const provider = isZoom ? zoomProvider : getProvider(st.provider);
    const tok = await provider.exchangeCode(q.code, st.redirectUri);
    if (!tok || !tok.refresh_token) {
      // A refresh token is only issued with offline access on first consent.
      // If it is missing the user must remove the app's access and reconnect.
      return back(res, ret, 'norefresh', param);
    }
    const email = await provider.userEmail(tok.access_token);
    const ok = isZoom
      ? await saveZoomConnection(st.clientRecordId, { email, refreshToken: tok.refresh_token })
      : await saveConnection(st.clientRecordId, {
        provider: st.provider || 'google', email, calendarId: 'primary',
        refreshToken: tok.refresh_token, scope: tok.scope || '',
      });
    return back(res, ret, ok ? 'connected' : 'error', param);
  } catch (e) {
    console.error('[calendar/callback]', e.message);
    return back(res, ret, 'error', param);
  }
}
