/**
 * Cookie utilities for cross-subdomain auth.
 *
 * The cookie is set on the .travelify.io parent domain so every
 * product subdomain (id.travelify.io, marketing.travelify.io,
 * chat.travelify.io, widgets.travelify.io, trends.travelify.io)
 * can read it without any token-passing dance.
 *
 * Properties:
 *   - HttpOnly:  cannot be read by JavaScript. Defends against XSS
 *                token theft. Front-end code reads the user/permission
 *                claims via /api/auth/me, never the raw token.
 *   - Secure:    only sent over HTTPS.
 *   - SameSite=Lax: sent on top-level cross-site navigations so the
 *                signin redirect flow works, but blocked on third-party
 *                iframes/POSTs (defends CSRF).
 *   - Domain=.travelify.io: shared across all subdomains.
 *   - Path=/:    available everywhere on the domain.
 *   - Expires:   matches the JWT expiry exactly so the cookie can never
 *                outlive the underlying token.
 */

const COOKIE_NAME = 'tg_session';

// In production we always set on the parent domain. In preview/dev (where
// the request hostname is something like luna-marketing.vercel.app or
// localhost), we omit the Domain attribute and let the browser scope the
// cookie to the exact host. The latter mode means cookie SSO doesn't work
// across preview deploys — that's fine, that's why the localStorage
// fallback also exists in the front-end code.
const PROD_DOMAIN = '.travelify.io';

function isProductionHost(hostHeader) {
  if (!hostHeader) return false;
  const host = String(hostHeader).split(':')[0].toLowerCase();
  return host === 'travelify.io' || host.endsWith('.travelify.io');
}

/**
 * Write the session cookie on the response.
 *
 * @param {object} res — Vercel/Node response object
 * @param {string} token — the signed JWT
 * @param {Date}   expiresAt — when the JWT expires
 * @param {object} [opts]
 * @param {object} [opts.req] — optional request, used to detect if we're
 *                              on a *.travelify.io host vs a preview URL
 */
export function setSessionCookie(res, token, expiresAt, { req } = {}) {
  const useProdDomain = !req || isProductionHost(req.headers && req.headers.host);
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    `Path=/`,
    `Expires=${expiresAt.toUTCString()}`,
    `Max-Age=${Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000))}`,
    `HttpOnly`,
    `Secure`,
    `SameSite=Lax`
  ];
  if (useProdDomain) parts.push(`Domain=${PROD_DOMAIN}`);
  appendSetCookie(res, parts.join('; '));
}

/**
 * Clear the session cookie. Used on /api/auth/signout.
 */
export function clearSessionCookie(res, { req } = {}) {
  const useProdDomain = !req || isProductionHost(req.headers && req.headers.host);
  const parts = [
    `${COOKIE_NAME}=`,
    `Path=/`,
    `Expires=Thu, 01 Jan 1970 00:00:00 GMT`,
    `Max-Age=0`,
    `HttpOnly`,
    `Secure`,
    `SameSite=Lax`
  ];
  if (useProdDomain) parts.push(`Domain=${PROD_DOMAIN}`);
  appendSetCookie(res, parts.join('; '));
}

/**
 * Read the session cookie value from a request.
 * Returns null if not present.
 */
export function readSessionCookie(req) {
  const header = req.headers && (req.headers.cookie || '');
  if (!header) return null;
  const match = header.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Append a Set-Cookie header without clobbering any others already set
 * (e.g. the rate-limiter or another middleware).
 */
function appendSetCookie(res, value) {
  const existing = res.getHeader('Set-Cookie');
  if (!existing) {
    res.setHeader('Set-Cookie', value);
  } else if (Array.isArray(existing)) {
    res.setHeader('Set-Cookie', [...existing, value]);
  } else {
    res.setHeader('Set-Cookie', [existing, value]);
  }
}

export { COOKIE_NAME };
