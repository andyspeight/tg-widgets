/**
 * Where to send somebody after they sign in.
 *
 * THE ATTACK THIS EXISTS TO STOP
 *
 * The open redirect. A link to our own sign-in page, on our own domain, with a
 * ?next= that lands somewhere else afterwards. It is convincing because the
 * part that matters, the bit where a password is typed, genuinely is us. What
 * follows is a page under somebody else's control that a person arrived at by
 * signing in to Travelgenix.
 *
 * So this is a whitelist, not a clean-up. Anything not obviously a local path
 * comes back as the dashboard.
 *
 * A LEADING SLASH IS NOT ENOUGH, WHICH IS THE WHOLE TRAP
 *
 * "//evil.example" starts with a slash and is protocol relative: a browser
 * reads it as another host and the scheme is inherited. "/\\evil.example" is
 * the same trick with a backslash, which several browsers normalise to a slash
 * before the request goes out. Both pass a naive startsWith('/') check.
 *
 * Its own leaf module rather than living in the page, because Next allows only
 * a fixed set of exports from a page file, and because an open redirect check
 * is exactly the kind of thing that should have tests next to it.
 */

/** Where anyone ends up when the requested destination is not trustworthy. */
export const DEFAULT_DESTINATION = '/sites';

export function safeReturnPath(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_DESTINATION;
  if (!value.startsWith('/')) return DEFAULT_DESTINATION;

  // Protocol relative, in both spellings.
  if (value.startsWith('//') || value.startsWith('/\\')) return DEFAULT_DESTINATION;

  // A backslash anywhere, and any whitespace including the control characters a
  // header can smuggle in. Neither belongs in a path we generated.
  if (/[\\\s]/.test(value)) return DEFAULT_DESTINATION;

  // Not back to the sign-in page, or signing in would land on signing in.
  if (value === '/signin' || value.startsWith('/signin?')) return DEFAULT_DESTINATION;

  return value;
}
