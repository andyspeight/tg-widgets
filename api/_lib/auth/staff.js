/**
 * Travelgenix staff identification — single source of truth.
 *
 * A "Travelgenix staff member" is anyone signed in under a Travelgenix-family
 * email domain, OR explicitly listed in the TG_STAFF_EMAILS env allowlist.
 *
 * Staff gain the "act as client" capability: they can switch their active
 * session into any live client account to set up and support that client's
 * widgets. That is a privilege-escalation surface, so the definition lives in
 * ONE place and is reused by every endpoint that grants the capability
 * (the staff client picker and the switch-client bypass). Never re-implement
 * this check inline — import it from here so the rule can never drift.
 *
 * This mirrors the STAFF_DOMAINS gate already used by the widget catalogue, so
 * the act-as power matches the existing staff-only dashboard capability exactly.
 *
 * To make someone a staff member: give them an @agendas.group or
 * @travelgenix.io email, OR add their address to the TG_STAFF_EMAILS env var
 * in Vercel (comma-separated, e.g. "pat@example.com,sam@example.com").
 */

export const STAFF_DOMAINS = ['travelgenix.io', 'travelgenix.com', 'agendas.group'];

function staffEmailAllowlist() {
  const raw = process.env.TG_STAFF_EMAILS;
  if (!raw || !raw.trim()) return [];
  return raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

/**
 * Returns true if the given email belongs to Travelgenix staff.
 * Fails closed: anything non-string or malformed returns false.
 */
export function isStaffEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const clean = email.trim().toLowerCase();
  const at = clean.lastIndexOf('@');
  if (at === -1) return false;
  const domain = clean.slice(at + 1);
  if (STAFF_DOMAINS.includes(domain)) return true;
  return staffEmailAllowlist().includes(clean);
}

/**
 * Convenience wrapper for the new auth-middleware context (carries ctx.email).
 */
export function isTravelgenixStaff(ctx) {
  return isStaffEmail(ctx && ctx.email);
}
