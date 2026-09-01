/**
 * Shaping the words that go to an image model, kept pure so it is testable.
 *
 * TWO CALLERS, ONE VOICE. The media picker sends a person's own words ("a quiet
 * villa terrace at dusk"); the section builder sends a subject it worked out
 * from the copy it just wrote. Both want the SAME thing out the far end: a
 * photograph, not an illustration, with no text baked into it and nothing that
 * reads as a stock-photo cliche. So both go through here, which trims the words,
 * caps them, and wraps them in the one instruction that keeps a travel site
 * looking like a travel site rather than an AI demo.
 *
 * WHY THE GUARD RAILS MATTER. An image model left to itself will happily write a
 * fake headline across a hero, drop a garbled logo in a corner, or render a
 * plastic, over-saturated "travel" look that is the exact tell Andy does not
 * want on a client's page. The suffix is not decoration: it is the difference
 * between a picture you can publish and one you have to throw away.
 */

/** The longest prompt we will send. A brief, not an essay. */
export const MAX_IMAGE_PROMPT = 1000;

/** The shapes an image can take, and the pixel size each maps to for gpt-image-1. */
export type ImageOrientation = 'landscape' | 'portrait' | 'square';

/**
 * The one instruction that keeps generated pictures publishable: a real
 * photograph, no text, no logos, no uncanny AI sheen. Appended to every prompt.
 */
const PHOTO_RULES =
  'Render this as a real, high quality editorial travel photograph: natural light, '
  + 'true-to-life colour, realistic depth of field. No text, no words, no captions, '
  + 'no logos, no watermarks, no borders, no frame, no collage. Not an illustration, '
  + 'not a 3D render, not over-saturated stock imagery.';

/** Strip ASCII control characters (including newlines and tabs) from a string. */
function stripControl(value: string): string {
  let out = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    // Space and above, minus DEL. Newlines and tabs become nothing here; the
    // whitespace collapse in cleanImagePrompt turns the gaps back into spaces.
    out += code >= 0x20 && code !== 0x7f ? char : ' ';
  }
  return out;
}

/**
 * Trim and cap a person's own prompt, and drop the characters an API has no use
 * for. Empty when there is nothing usable left.
 */
export function cleanImagePrompt(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return stripControl(raw)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_IMAGE_PROMPT);
}

/**
 * A person's prompt from the picker, with the photo rules on the end.
 *
 * Returns empty when there is nothing to work with, so the caller can refuse
 * before it spends anything.
 */
export function pickerImagePrompt(raw: unknown): string {
  const wanted = cleanImagePrompt(raw);
  if (!wanted) return '';
  return `${wanted}. ${PHOTO_RULES}`;
}

/**
 * A hero prompt for the section builder, from the subject it derived for the
 * section. Leans wide and cinematic, because this becomes a full-bleed
 * background behind a heading, and a busy centre fights the words on it.
 */
export function heroImagePrompt(subject: unknown): string {
  const wanted = cleanImagePrompt(subject);
  if (!wanted) return '';
  return (
    `A wide, cinematic travel photograph of ${wanted}, composed as a website hero `
    + `banner with calm, uncluttered space where a headline could sit. ${PHOTO_RULES}`
  );
}
