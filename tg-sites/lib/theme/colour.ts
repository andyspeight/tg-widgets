/**
 * Colour arithmetic. Pure functions, no imports, fully testable.
 *
 * WHY THIS EXISTS RATHER THAN color-mix()
 *
 * CSS can blend two colours now, so most of the mixing below could be a
 * one-liner in a stylesheet. Two reasons it is here instead.
 *
 * The first is contrast. A client picks a brand colour and something has to
 * decide whether the text on a button in that colour is white or nearly black.
 * CSS cannot answer that yet, and getting it wrong means a client ships a page
 * whose main call to action is unreadable. Deciding it by measured contrast
 * ratio is the whole point, and that needs real arithmetic.
 *
 * The second is that computing it here makes it inspectable. The emitted values
 * are plain hex in an attribute, so a failure is visible in dev tools and
 * provable in a test, rather than being a browser's opinion.
 *
 * ON MIXING IN sRGB
 *
 * mix() below blends in plain sRGB, which is perceptually uneven: a 50% mix of
 * black and white lands lighter than the midpoint a person would pick. That is
 * a real limitation and it is accepted, because everything mixed here is UI
 * furniture at small ratios, hairlines and faint alternating bands, where the
 * unevenness is invisible. Nothing mixed here is a brand colour a client would
 * recognise as wrong. Contrast, where it matters, is measured properly.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * A hex colour, or null.
 *
 * Accepts 3 and 6 digits, with or without the hash, in any case. Rejects
 * everything else including rgb(), named colours and the 4 and 8 digit forms.
 *
 * Narrower than safeColour in lib/content/schema.ts, on purpose. That one
 * guards a value going straight back out as CSS, so it only has to be
 * harmless. These values are ARITHMETIC INPUT, and a theme's brand colour
 * being half transparent would make every derived token wrong in a way nobody
 * would trace back. One notation in, one notation out.
 */
export function parseHex(value: unknown): Rgb | null {
  if (typeof value !== 'string') return null;

  const hex = value.trim().replace(/^#/, '').toLowerCase();
  if (!/^([0-9a-f]{3}|[0-9a-f]{6})$/.test(hex)) return null;

  const full = hex.length === 3 ? hex.replace(/./g, (c) => c + c) : hex;

  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

/** Back to a six digit hex string. Always six, never three, always lowercase. */
export function toHex({ r, g, b }: Rgb): string {
  const byte = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${byte(r)}${byte(g)}${byte(b)}`;
}

/**
 * Normalise a hex colour to the one form everything downstream expects.
 *
 * Returns null for anything that is not a hex colour, so a caller has to decide
 * what to do about it rather than being handed a silent default.
 */
export function normaliseHex(value: unknown): string | null {
  const rgb = parseHex(value);
  return rgb ? toHex(rgb) : null;
}

/**
 * Blend two colours. `amount` is how much of `b` ends up in the result.
 *
 * mix(white, black, 0.5) is a mid grey. mix(brand, white, 0) is brand.
 */
export function mix(a: string, b: string, amount: number): string {
  const from = parseHex(a);
  const to = parseHex(b);
  if (!from || !to) return a;

  const t = Math.max(0, Math.min(1, amount));
  return toHex({
    r: from.r + (to.r - from.r) * t,
    g: from.g + (to.g - from.g) * t,
    b: from.b + (to.b - from.b) * t,
  });
}

// ---------------------------------------------------------------------------
// Contrast
// ---------------------------------------------------------------------------

/**
 * WCAG relative luminance.
 *
 * The 0.03928 threshold and the 2.4 exponent are from the WCAG 2.1 definition
 * rather than from the sRGB spec, which uses 0.04045. The difference is far
 * below one least significant bit of an 8 bit channel, and matching the
 * accessibility standard is what matters when the number is used to claim a
 * ratio passes.
 */
export function luminance(colour: string): number {
  const rgb = parseHex(colour);
  if (!rgb) return 0;

  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };

  return (
    0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b)
  );
}

/**
 * WCAG contrast ratio between two colours. 1 to 21, order does not matter.
 *
 * The thresholds worth knowing:
 *   4.5  normal body text
 *   3.0  text at 24px, or 19px bold, and the boundary of a UI control
 */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Rounded to one decimal, which is how a ratio is quoted. */
export function contrastRatio(a: string, b: string): number {
  return Math.round(contrast(a, b) * 10) / 10;
}

/**
 * Readable text for a given background: the light option or the dark one.
 *
 * THIS IS THE FUNCTION THE WHOLE FILE IS FOR.
 *
 * A client picks a brand colour and puts a button in it. Whether the label on
 * that button should be white or nearly black depends on the colour they
 * picked, and no default gets it right for both a navy and a pale gold. Picking
 * by measured contrast means a client cannot produce an unreadable button by
 * choosing an unusual brand colour, which they will.
 *
 * Not a luminance threshold. A cutoff at 0.5 looks equivalent and gets the
 * awkward middle wrong: mid greens and cyans sit either side of it while both
 * genuinely read better with dark text. Comparing the two actual ratios cannot
 * be wrong, because the ratio is the thing being optimised.
 */
export function readableOn(
  background: string,
  light = '#ffffff',
  dark = '#0f172a',
): string {
  return contrast(background, light) >= contrast(background, dark) ? light : dark;
}

/**
 * Push a colour until it reads against a background, or give up and say so.
 *
 * TRIES BOTH DIRECTIONS, and that is not belt and braces.
 *
 * The obvious version picks the direction from the background: a light
 * background wants darker text, so walk towards black. That is right at the
 * ends and WRONG IN THE MIDDLE, which is where it matters. A bright cyan has a
 * luminance of about 0.37, so "dark background, walk towards white" and white
 * on cyan tops out at 2.5:1. It could never reach 4.5:1 no matter how many
 * steps it took, while walking the other way reaches 12:1 immediately.
 *
 * That heuristic shipped in the first version of this file and the theme tests
 * caught it on four different brand colours. Measuring both and taking the
 * better one cannot be wrong, for the same reason readableOn measures rather
 * than thresholds.
 */
export function nudgeUntilReadable(
  colour: string,
  background: string,
  target: number,
): { colour: string; reached: boolean } {
  if (contrast(colour, background) >= target) return { colour, reached: true };

  /*
   * Interpolated from the original towards the endpoint, NOT compounded.
   *
   * The first version did `current = mix(current, towards, 0.05)` in a loop,
   * which is a geometric walk: after 24 steps it has covered 1 - 0.95^24, about
   * 71%, and it can never actually arrive. So a case that needed nearly-white
   * to pass stopped short at 3.6:1 and reported failure on a target that was
   * reachable. Stepping t from 0 to 1 over the same range ends AT the endpoint,
   * so if white or black works at all, it is found.
   */
  const walk = (towards: string) => {
    for (let t = 0.05; t <= 1.0001; t += 0.05) {
      const candidate = mix(colour, towards, Math.min(t, 1));
      if (contrast(candidate, background) >= target) {
        return { colour: candidate, reached: true };
      }
    }
    return { colour: mix(colour, towards, 1), reached: false };
  };

  const darker = walk('#000000');
  if (darker.reached) {
    const lighter = walk('#ffffff');
    // Both work: keep the one that moved less, so a colour is changed as little
    // as the requirement allows.
    if (!lighter.reached) return darker;
    return contrast(colour, darker.colour) <= contrast(colour, lighter.colour)
      ? darker
      : lighter;
  }

  const lighter = walk('#ffffff');
  if (lighter.reached) return lighter;

  // Neither reaches it. Hand back whichever got closest rather than a direction
  // chosen in advance, and say it did not make it.
  return contrast(darker.colour, background) >= contrast(lighter.colour, background)
    ? darker
    : lighter;
}

/**
 * Fade some ink towards its background, without letting it stop reading.
 *
 * This is how every piece of secondary text in the product is made: caption
 * grey is body text moved a third of the way towards the page. Doing that by a
 * fixed percentage alone is how a theme ends up with 3:1 captions, because how
 * far a third of the way lands depends entirely on how far apart the two
 * colours were.
 *
 * Walks BACK TOWARDS THE INK rather than towards black or white, which is what
 * makes it always work: the ink is already the colour chosen to read on this
 * background, so the worst case is returning the ink itself. Nudging towards a
 * corner of the colour space instead can fail, and can also change the hue,
 * which turns a warm grey caption cold on a themed site.
 */
export function fadeButKeepReadable(
  ink: string,
  background: string,
  amount: number,
  target: number,
): string {
  const faded = mix(ink, background, amount);
  if (contrast(faded, background) >= target) return faded;

  // Back off in small steps. Ends at the ink, which is as readable as it gets.
  for (let t = amount; t > 0; t -= 0.02) {
    const candidate = mix(ink, background, t);
    if (contrast(candidate, background) >= target) return candidate;
  }

  return ink;
}

/**
 * Darken a colour until light text will sit on it.
 *
 * For the dark band a section can use. Mixing the brand with black by a fixed
 * amount does not make a band that is actually dark: a white brand darkened by
 * 55% is a mid grey, which is the one place in the whole colour space where
 * NOTHING reads well, so the band ends up with 4:1 text on it.
 *
 * Walking towards black always converges, because black takes white to 21:1.
 */
export function deepenUntilTextFits(colour: string, target: number): string {
  let current = colour;
  for (let step = 0; step < 40; step += 1) {
    if (contrast(current, readableOn(current)) >= target) return current;
    current = mix(current, '#000000', 0.06);
  }
  return current;
}
