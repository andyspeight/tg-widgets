// =============================================================================
//  /api/_lib/emailsig.js
// =============================================================================
//
//  Shared helpers for the Email Signature widget's hosted endpoints
//  (emailsig-banner, emailsig-click, emailsig-pixel). These endpoints are
//  loaded from inside someone's inbox, where scripts and most CSS are gone —
//  so they must stay tiny, public and fail-open.
//
// =============================================================================

// A 43-byte fully transparent 1x1 GIF. Returned whenever there is nothing to
// show so the email never renders a broken-image icon.
export const TRANSPARENT_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

// Widget public IDs look like tgw_1712345678_ab12cd. Be permissive but bounded.
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function safeWidgetId(raw) {
  const s = typeof raw === 'string' ? raw.trim() : '';
  return ID_RE.test(s) ? s : '';
}

// Only ever redirect to an http(s) URL. The destination comes from the widget
// owner's own saved (and server-sanitised) config, never from the request, so
// there is no open-redirect surface — this is belt and braces.
export function safeHttpUrl(raw) {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s || s.length > 1000) return '';
  try {
    const u = new URL(s);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.href;
  } catch (e) { /* invalid */ }
  return '';
}

export function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

// Resolve this deployment's own origin from the incoming request headers so we
// can call the public config endpoint without hardcoding a host.
export function selfOrigin(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim() || 'https';
  return host ? proto + '://' + host : '';
}

// Fetch a widget's public config via the CDN-cached config endpoint. Returns
// the config object, or null on any failure (fail-open).
export async function fetchWidgetConfig(req, id) {
  const origin = selfOrigin(req);
  if (!origin) return null;
  try {
    const r = await fetch(origin + '/api/widget-config?id=' + encodeURIComponent(id));
    if (!r.ok) return null;
    const d = await r.json();
    return d && d.config && typeof d.config === 'object' ? d.config : null;
  } catch (e) {
    return null;
  }
}
