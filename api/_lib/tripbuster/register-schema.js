/**
 * What a sign-up is allowed to contain.
 *
 * Same shape as validateDeal and validateLead: whitelist the fields, coerce and
 * clamp them, and return field-level messages a form can put next to the right
 * input. Anything not named here never reaches the database.
 *
 * The messages are written for the person typing, not for a developer. "Enter
 * your agency name" beats "name: required".
 */
import { isValidEmail } from '../sendgrid.js';

// bcrypt only ever looks at the first 72 BYTES of a password. Above that, two
// different passwords can hash identically, and the person who carefully typed a
// 90-character passphrase would find a shorter prefix of it also signs them in.
// Capping here means we never quietly ignore what somebody typed.
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 72;

function text(v, max) {
  if (typeof v !== 'string') return '';
  return v.trim().slice(0, max);
}

/** Only absolute http(s). A website field is a link we will show travellers. */
function website(raw) {
  const s = text(raw, 200);
  if (!s) return { ok: true, value: null };
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return { ok: false, message: 'That website address does not look right' };
    }
    if (!u.hostname.includes('.')) {
      return { ok: false, message: 'That website address does not look right' };
    }
    return { ok: true, value: u.toString() };
  } catch {
    return { ok: false, message: 'That website address does not look right' };
  }
}

export function validateRegistration(body = {}) {
  const errors = [];
  const push = (field, message) => errors.push({ field, message });

  const name = text(body.name, 120);
  if (name.length < 2) push('name', 'Enter your agency name');

  const email = text(body.email, 200).toLowerCase();
  if (!email) push('email', 'Enter your email address');
  else if (!isValidEmail(email)) push('email', 'That email address does not look right');

  const password = typeof body.password === 'string' ? body.password : '';
  if (!password) {
    push('password', 'Choose a password');
  } else if (password.length < PASSWORD_MIN) {
    push('password', `Use at least ${PASSWORD_MIN} characters`);
  } else if (password.length > PASSWORD_MAX) {
    push('password', `Use ${PASSWORD_MAX} characters or fewer`);
  } else if (email && password.toLowerCase() === email) {
    push('password', 'Your password cannot be your email address');
  }

  const phone = text(body.phone, 40);
  // Not validated as a real number on purpose: agencies write them every way
  // imaginable and we never dial it ourselves. Only obvious nonsense is refused.
  if (phone && phone.replace(/[^\d]/g, '').length < 7) {
    push('phone', 'That phone number looks too short');
  }

  const site = website(body.website);
  if (!site.ok) push('website', site.message);

  const town = text(body.town, 80);

  // A positive act, not a pre-ticked box. Recorded as a decision the person made
  // rather than assumed from the fact they pressed a button.
  if (body.agreed !== true) {
    push('agreed', 'Please confirm you have read how Tripbuster works');
  }

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    agent: {
      name,
      email,
      password,
      phone: phone || null,
      website: site.value,
      town: town || null,
    },
  };
}
