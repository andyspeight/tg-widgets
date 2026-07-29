/**
 * Turning a page name into a URL address.
 *
 * Shared by the editor and the server action on purpose. When the dialog
 * derived its own slug and the server derived a different one, the address an
 * agent was shown was not always the address they got, and the difference
 * only surfaced as a confusing duplicate error later.
 */

/**
 * An empty result is legal and meaningful: it is the home page.
 *
 * The database has the final say either way, this exists so someone typing
 * "About Us" gets "about-us" rather than a validation error.
 */
export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    // Combining marks, so "Málaga" becomes "malaga" rather than "m-laga".
    // Escape sequences, never literal marks: a raw combining character in a
    // source file survives Node and gets mangled by a bundler.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}
