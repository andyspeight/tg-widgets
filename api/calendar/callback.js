/**
 * GET /api/calendar/callback
 * Google redirects here after consent. Verifies the signed state, exchanges
 * the code for tokens, stores the encrypted refresh token against the client,
 * then bounces the user back to the editor with a status flag.
 */
import * as google from '../_lib/calendar/google.js';
import { verifyState } from '../_lib/calendar/state.js';
import { saveConnection, storageReady } from '../_lib/calendar/store.js';

function back(res, ret, status) {
  const sep = ret.indexOf('?') >= 0 ? '&' : '?';
  res.writeHead(302, { Location: ret + sep + 'calendar=' + status });
  res.end();
}

export default async function handler(req, res) {
  const q = req.query || {};
  const st = verifyState(q.state);
  const ret = (st && typeof st.ret === 'string' && st.ret.startsWith('/')) ? st.ret : '/editor-appointment';

  if (q.error) return back(res, ret, 'denied');
  if (!st || !q.code) return back(res, ret, 'error');
  if (!storageReady()) { console.error('[calendar/callback] storage (Redis) not configured'); return back(res, ret, 'nostore'); }

  try {
    const tok = await google.exchangeCode(q.code, st.redirectUri);
    if (!tok || !tok.refresh_token) {
      // Google only returns a refresh token on first consent. prompt=consent
      // forces it, but if it is still missing the user must remove the app's
      // access and reconnect.
      return back(res, ret, 'norefresh');
    }
    const email = await google.userEmail(tok.access_token);
    const ok = await saveConnection(st.clientRecordId, {
      provider: 'google', email, calendarId: 'primary',
      refreshToken: tok.refresh_token, scope: tok.scope || '',
    });
    return back(res, ret, ok ? 'connected' : 'error');
  } catch (e) {
    console.error('[calendar/callback]', e.message);
    return back(res, ret, 'error');
  }
}
