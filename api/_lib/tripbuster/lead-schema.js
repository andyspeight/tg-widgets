/**
 * Validation for a callback request.
 *
 * A traveller fills this in to be rung back about a holiday, so unlike the rest
 * of Tripbuster it carries real personal data. That raises the bar rather than
 * lowering it: only these fields survive, everything is length-capped, and the
 * one structural rule is that a request nobody can reply to is not a request.
 *
 * Pure and dependency-free so it unit tests without a database.
 */

/** Strip control characters, collapse whitespace, trim and cap. */
function clean(value, max) {
  if (typeof value !== 'string') return null;
  const s = value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return s ? s.slice(0, max) : null;
}

/**
 * A phone number as a person would write it.
 *
 * Spacing is preserved on purpose: the agency reads this off a screen and rings
 * it, and "07700 900 123" is easier to read back than "07700900123".
 */
export function cleanPhone(value) {
  const s = clean(value, 40);
  if (!s) return null;
  const digits = s.replace(/\D/g, '');
  // Long enough to be a real number, short enough to not be a paragraph. UK
  // mobiles are 11 digits, international with a country code can reach 15.
  if (digits.length < 7 || digits.length > 15) return undefined;
  return /^[+(\d][\d\s()+.-]*$/.test(s) ? s : undefined;
}

/**
 * An email address, checked just enough to catch a typo rather than to prove
 * deliverability. Anything stricter rejects valid addresses, and the only real
 * test is sending to it.
 */
export function cleanEmail(value) {
  const s = clean(value, 160);
  if (!s) return null;
  const lower = s.toLowerCase();
  if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(lower)) return undefined;
  return lower;
}

/**
 * Validate a callback request.
 *
 * @returns {{ok: boolean, lead: object, errors: Array<{field, message}>}}
 */
export function validateLead(input) {
  const errors = [];
  const lead = {};
  const src = (input && typeof input === 'object' && !Array.isArray(input)) ? input : {};

  const name = clean(src.name, 120);
  if (!name) {
    errors.push({ field: 'name', message: 'Please tell us your name' });
  } else if (name.length < 2) {
    errors.push({ field: 'name', message: 'Please give us your full name' });
  } else {
    lead.name = name;
  }

  const phone = cleanPhone(src.phone);
  if (phone === undefined) {
    errors.push({ field: 'phone', message: 'That does not look like a phone number' });
  } else if (phone) {
    lead.phone = phone;
  }

  const email = cleanEmail(src.email);
  if (email === undefined) {
    errors.push({ field: 'email', message: 'That does not look like an email address' });
  } else if (email) {
    lead.email = email;
  }

  // The one structural rule. Mirrors the CHECK constraint in migration 008: a
  // callback request with no way to call back is not a lead, and the agency
  // would rightly refuse to pay for it.
  if (!lead.phone && !lead.email && !errors.some((e) => e.field === 'phone' || e.field === 'email')) {
    errors.push({
      field: 'phone',
      message: 'Leave a phone number or an email address so the agency can reply',
    });
  }

  const message = clean(src.message, 1000);
  if (message) lead.message = message;

  // Free text rather than a dropdown, because "after 6pm" and "weekends only"
  // are both things people say and neither fits a fixed list.
  const when = clean(src.preferredTime, 80);
  if (when) lead.preferred_time = when;

  return { ok: errors.length === 0, lead, errors };
}

export const LEAD_STATUSES = ['new', 'contacted', 'booked', 'not_interested', 'junk'];
