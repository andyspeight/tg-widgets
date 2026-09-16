/**
 * Taking people out of the enquiries before the assistant reads them.
 *
 * WHY THIS EXISTS. "What did people ask about last week?" is a question a
 * client will ask, and a useful one. Answering it means the model reads the
 * enquiries, and an enquiry is a person: a name, an email, a phone number, an
 * address, and sometimes a paragraph that mentions a child or a health
 * condition. None of that is needed to say "six people asked about Norway in
 * May". So the assistant sees the QUESTIONS, and the people stay in the
 * enquiries screen where the client can read them.
 *
 * Two layers. Fields whose NAME says they hold a person (name, email, phone,
 * address and the like) are dropped whole. The fields that remain have their
 * VALUES scrubbed for anything that looks like an email address, a phone number
 * or a long run of digits, because a message box is where people type their
 * number "in case it is easier to call".
 *
 * A mitigation, not a guarantee: a name typed into the message box stays a
 * name. Which is why the log (0035) never stores what was read either, and why
 * the tool's description tells the model these are summaries for counting and
 * theming, not records to repeat.
 *
 * PURE, so every rule here is tested with a string.
 */

/** Field names that hold a person rather than a question. Matched as a whole word or fragment. */
const PERSONAL_KEYS = /(^|[^a-z])(name|first|last|surname|email|e-mail|mail|phone|telephone|tel|mobile|cell|whatsapp|address|street|postcode|post code|zip|city|town|dob|birth|passport|company)([^a-z]|$)/i;

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
/** Seven or more digits with the spaces, dashes, dots and brackets people put in numbers. */
const PHONE = /(?:\+?\d[\d\s().-]{6,}\d)/g;
/** Six or more digits together: a postcode fragment, a booking reference, a card. */
const DIGITS = /\d{6,}/g;

export function redactText(value: string): string {
  return value
    .replace(EMAIL, '[email]')
    .replace(PHONE, '[number]')
    .replace(DIGITS, '[number]');
}

export function isPersonalKey(key: string): boolean {
  return PERSONAL_KEYS.test(key.replace(/[_-]+/g, ' '));
}

/**
 * An enquiry's fields with the person removed: personal fields gone, every
 * other value scrubbed and capped. Returns the fields that survive, which for
 * a typical form is the message, the destination and the dates.
 */
export function maskEnquiry(data: Record<string, unknown>, maxValue = 400): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(data)) {
    if (isPersonalKey(key)) continue;
    if (typeof raw !== 'string' && typeof raw !== 'number' && typeof raw !== 'boolean') continue;
    const value = redactText(String(raw)).replace(/\s+/g, ' ').trim();
    if (!value) continue;
    out[key] = value.length > maxValue ? `${value.slice(0, maxValue)}…` : value;
  }
  return out;
}
