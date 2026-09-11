/**
 * The hosts this app is served on, in ONE place.
 *
 * Every OAuth flow we run (Google sign-in, Google / Microsoft calendar, Zoom)
 * has to hand the provider a redirect URI, and the provider refuses anything
 * that is not registered against the OAuth client. So the redirect URI can
 * never be "whatever host the browser happened to use": a Vercel preview
 * deployment, a new alias or a typo'd host all produce a URI the provider has
 * never heard of, and the user is stopped at the provider's own error page
 * with nothing we can catch or explain.
 *
 * Why this file exists (11 Sep 2026): the calendar connect endpoint built its
 * redirect URI straight from `req.headers.host` while the sign-in flow kept a
 * private allow-list. The two drifted, and a user setting up the Appointment
 * Scheduler on id.travelify.io was sent to Google with a callback URI that was
 * not on the calendar OAuth client. Google answered "Error 400:
 * redirect_uri_mismatch" and the connection could not be made.
 *
 * KEEP IN STEP WITH THE PROVIDER CONSOLES. Adding a host here is only half the
 * job — the matching callback URI has to be registered too:
 *   Google sign-in client  → https://<host>/api/auth/google/callback
 *   Google calendar client → https://<host>/api/calendar/callback
 *   Microsoft / Zoom       → https://<host>/api/calendar/callback
 * Guarded by `npm run test:calendar-oauth-host`.
 */

/** Hosts we serve the dashboard and editors on. Order is not significant. */
export const APP_HOSTS = [
  'id.travelify.io',
  'widgets.travelify.io',
  'tg-widgets.vercel.app',
];

/**
 * Where an unrecognised host is sent instead. A preview deployment or a new
 * alias round-trips through the primary rather than through a URI no provider
 * console knows, so the flow completes instead of dying at the provider.
 */
export const PRIMARY_HOST = 'id.travelify.io';

/** True when `host` is one of ours (case and port insensitive). */
export function isAppHost(host) {
  return APP_HOSTS.includes(normaliseHost(host));
}

/** Lowercase, de-listed, de-ported. '' when there is nothing usable. */
export function normaliseHost(raw) {
  const first = String(raw == null ? '' : raw).split(',')[0].trim().toLowerCase();
  // Strip a port: Google matches the redirect URI as a literal string, and our
  // production hosts never carry one.
  return first.replace(/:\d+$/, '');
}

/**
 * The host to build an OAuth redirect URI from, for this request. Prefers the
 * proxy's x-forwarded-host (Vercel sets it; `host` can be the internal one),
 * and falls back to PRIMARY_HOST for anything not on the list.
 */
export function resolveHost(req) {
  const headers = (req && req.headers) || {};
  const h = normaliseHost(headers['x-forwarded-host'] || headers.host);
  return APP_HOSTS.includes(h) ? h : PRIMARY_HOST;
}

/** `https://<resolved host><path>` — always https; every app host is TLS. */
export function appUrl(req, path) {
  return 'https://' + resolveHost(req) + (path || '');
}
