/**
 * Tidying an email address. One definition, used by everything that handles one.
 *
 * Its own file, with no imports at all, for two reasons. It is a pure string
 * function and has no business living beside the identity providers, which are
 * server-only and reach the database. And db/make-user.mjs needs it: that script
 * writes the email a person will later sign in with, so if it normalised
 * differently from the sign-in path the account would be created and then be
 * impossible to use, with nothing anywhere saying why.
 */

/**
 * An email, tidied, or null.
 *
 * Lowercased and trimmed so that Ann@example.com and ann@example.com are the
 * same account, which is what everyone expects even though the local part is
 * technically case sensitive.
 *
 * Deliberately not a strict RFC check. Those either reject real addresses or run
 * to a page of regex; the database has a unique constraint and a check that
 * there is an @ in a sensible place, and the real validation is that a person
 * knows the password that goes with it.
 */
export function normaliseEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const email = value.trim().toLowerCase();
  if (email.length < 3 || email.length > 254) return null;
  // Exactly one @, with something either side, and no whitespace anywhere.
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) return null;
  // A domain with no dot is legal on an intranet and never right here.
  if (!email.split('@')[1].includes('.')) return null;

  return email;
}
