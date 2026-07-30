/**
 * Who counts as Travelgenix staff.
 *
 * WHY THIS EXISTS AND WHAT IT REPLACES
 *
 * Nothing in this application knew what staff meant. The editor passes
 * `isStaff={site.role === 'owner'}`, and its own comment admits that is a
 * stand-in: "owner is the closest thing the membership table has to that today".
 * Every client's own owner is an owner, so anything gated on that is not gated on
 * staff at all, it is gated on being a customer.
 *
 * That mattered on 30 Jul 2026 for the head and body HTML, which was specified
 * staff-only. Andy reversed that later the same day and opened it to site owners,
 * which makes the raw HTML field a poor illustration now: owner OR staff passes, so
 * the stand-in would have given the right answer there by luck. This is still the
 * only honest answer to "is this person one of us", the embed block still uses the
 * stand-in and should move onto this, and anything genuinely internal that comes
 * later needs it. Keep it.
 *
 * THE DEFINITION IS NOT NEW, IT IS MIRRORED
 *
 * api/_lib/auth/staff.js in the widget suite already answers this question, and
 * its header says: "Never re-implement this check inline, import it from here so
 * the rule can never drift." That is the right instruction and it cannot be
 * followed literally across these two projects, because that file is JavaScript
 * in the repository root with its own imports and this is a TypeScript app in a
 * subdirectory with its own build.
 *
 * So the rule is mirrored deliberately rather than reinvented, and
 * tests/settings.test.ts READS that file and asserts the two lists still agree.
 * A drift-catching test is the closest thing to a shared import that two runtimes
 * can have, and it is the same pattern used for the generated tokens in
 * globals.css and the image mime whitelist against its migration.
 *
 * FAILS CLOSED, everywhere. Anything not a string, a malformed address, a missing
 * session: not staff.
 */

/**
 * The Travelgenix email domains.
 *
 * MUST match STAFF_DOMAINS in api/_lib/auth/staff.js. There is a test.
 */
export const STAFF_DOMAINS = ['travelgenix.io', 'travelgenix.com', 'agendas.group'] as const;

/**
 * Extra addresses, comma separated, for somebody who needs the access without a
 * Travelgenix address. Same variable name as the widget suite on purpose: one
 * value in Vercel, one meaning, both products.
 */
function allowlist(): string[] {
  const raw = process.env.TG_STAFF_EMAILS;
  if (!raw || !raw.trim()) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Whether an email address belongs to Travelgenix staff.
 *
 * lastIndexOf rather than split, because an address may legally contain more than
 * one @ inside a quoted local part, and the domain is always after the last one.
 * Splitting on the first would read "a@b"@travelgenix.io as the domain "b".
 */
export function isStaffEmail(email: unknown): boolean {
  if (typeof email !== 'string') return false;

  const clean = email.trim().toLowerCase();
  const at = clean.lastIndexOf('@');
  if (at === -1) return false;

  /*
   * A NON-EMPTY LOCAL PART, which is one place this is deliberately stricter than
   * the widget suite's version.
   *
   * "@agendas.group" has no local part, is not an address, and passed the domain
   * check because lastIndexOf returns 0 and the slice after it is the whole
   * domain. api/_lib/auth/staff.js has the same hole and is worth the same
   * one-line fix; it is noted in the handover rather than reached across for.
   *
   * It cannot arise from our own data, because auth_users.email carries
   * check (position('@' in email) > 1), which refuses an @ in first position. That
   * is a reason to be relaxed about the severity, not a reason to depend on a
   * constraint in another file for a security answer. This fails closed on its own.
   */
  if (at === 0) return false;

  const domain = clean.slice(at + 1);
  if ((STAFF_DOMAINS as readonly string[]).includes(domain)) return true;

  return allowlist().includes(clean);
}
