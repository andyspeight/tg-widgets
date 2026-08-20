/**
 * Building a WhatsApp click-to-chat link.
 *
 * WHY THIS IS A MODULE AND NOT TWO LINES IN THE RENDERER: the number. wa.me
 * wants digits and nothing else — no plus, no spaces, no brackets, no leading
 * zero — and it wants the country code. Everything a client will actually type
 * breaks at least one of those rules, and the failure is not visible from our
 * side: the link builds, the page publishes, and WhatsApp shows the visitor
 * "phone number shared via url is invalid". So the normalising is the value this
 * element adds over a Button with a wa.me address pasted into it, and it is
 * tested rather than trusted.
 *
 * PURE, so the awkward numbers are asked about directly rather than through a
 * rendered page.
 */

/**
 * A number wa.me will accept, or null.
 *
 * A LEADING ZERO IS REFUSED RATHER THAN GUESSED AT. "01204 123456" is a real UK
 * number and "1204123456" is not the international form of it: that needs the
 * country code, 44, and we have no way to know a client is in the UK. Silently
 * dropping the zero would produce a link that looks right and reaches nobody.
 * Refusing means the block shows its empty state and the editor says why, which
 * a client can act on.
 */
export function whatsappNumber(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;

  /*
   * THE BRACKETED TRUNK ZERO GOES FIRST, and it has to be its own step.
   *
   * "+44 (0)1204 123456" is the standard way a UK business writes its number on
   * a letterhead: the zero in brackets is the national prefix, used when
   * dialling from inside the country and dropped when dialling in from outside.
   * Stripping non-digits alone keeps it, giving 4401204123456 — a number that is
   * one digit too long and reaches nobody, from an input a client would swear
   * was correct. Caught by its own test rather than by anybody's eye.
   *
   * Only a zero IN BRACKETS is removed. Brackets around anything else are just
   * punctuation and go with the rest of it below.
   */
  const withoutTrunk = raw.replace(/\(\s*0\s*\)/g, '');

  // Everything else that is not a digit, including the leading +, which wa.me
  // does not want.
  const digits = withoutTrunk.replace(/\D/g, '');

  /*
   * A NATIONAL NUMBER, NOT AN INTERNATIONAL ONE. Somebody has typed their own
   * number the way they say it out loud. See the note above on why this is
   * refused rather than repaired.
   */
  if (digits.startsWith('0')) return null;

  /*
   * The shortest real international number is about 7 digits and the longest
   * the E.164 standard allows is 15. Outside that it is a typo, and a typo that
   * builds a link is worse than one that does not.
   */
  if (digits.length < 7 || digits.length > 15) return null;

  return digits;
}

/** A cap on the pre-filled message, so a pathological value cannot make a giant URL. */
export const WHATSAPP_MESSAGE_MAX = 300;

/**
 * The whole link, or null when the number is not usable.
 *
 * The host is a literal here, exactly as the map embed's is, so nothing a client
 * types can become a different origin, and the message is percent-encoded so it
 * cannot break out of the query into another parameter.
 */
export function whatsappHref(phone: unknown, message: unknown): string | null {
  const number = whatsappNumber(phone);
  if (!number) return null;

  const text = String(message ?? '').trim().slice(0, WHATSAPP_MESSAGE_MAX);
  return text
    ? `https://wa.me/${number}?text=${encodeURIComponent(text)}`
    : `https://wa.me/${number}`;
}
