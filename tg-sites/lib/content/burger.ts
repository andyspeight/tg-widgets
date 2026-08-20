/**
 * When a Menu turns into a burger.
 *
 * WHY THIS IS A MODULE AND NOT A LINE IN THE RENDERER: it reads two shapes of
 * stored value and has to keep doing so. Until 20 Aug 2026 `collapse` was a
 * toggle, so every menu saved before that holds `true` or `false`. Andy asked
 * that day for a burger that can be on at EVERY width, which is a third answer
 * a toggle cannot hold, so the field became a choice of three.
 *
 * A MIGRATION WAS DELIBERATELY NOT WRITTEN. lib/content/schema.ts has
 * upgradeBlock for exactly this, and it would work, but rewriting every stored
 * menu costs the property that function's own comment prizes: a rollback to the
 * previous release must still find something it can render. A page rewritten to
 * `'always'` and then rolled back would read as `collapse !== true` and lose its
 * phone menu — the one thing this field exists to provide. Reading both shapes
 * costs a function and breaks nothing in either direction.
 *
 * OUR OWN FILES USE THE NEW SPELLING. The header and footer presets in
 * lib/content/presets-region.ts were changed to the strings on the same day,
 * because two spellings in source we control is the drift these comments keep
 * warning about. The booleans below are for CLIENT DATA already saved, which is
 * not ours to rewrite.
 *
 * PURE, so the awkward values are asked about directly rather than through a
 * rendered page.
 */

/** The three answers, in the order the field offers them. */
export const BURGER_MODES = ['never', 'phone', 'always'] as const;

export type BurgerMode = (typeof BURGER_MODES)[number];

/**
 * How a stored `collapse` value should be read.
 *
 * DEFAULTS TO 'phone', which is what the old default `true` meant and still the
 * right answer for a block that exists mostly to be a header: seven links across
 * a phone do not fit. Anything unrecognised lands here too, so a value written
 * by a future release that this one has not heard of degrades to a working
 * menu rather than to no menu.
 */
export function burgerMode(value: unknown): BurgerMode {
  // Today's shape.
  if (typeof value === 'string' && (BURGER_MODES as readonly string[]).includes(value)) {
    return value as BurgerMode;
  }

  /*
   * Yesterday's shape, and the reason this function exists. `false` was a real
   * choice a client made — every footer preset sets it, because a footer column
   * that hid its links behind a tap would hide the ones people go looking for —
   * so it has to survive as 'never' rather than falling through to the default.
   */
  if (value === false) return 'never';
  if (value === true) return 'phone';

  return 'phone';
}

/** Is there a burger to draw at all? */
export function hasBurger(mode: BurgerMode): boolean {
  return mode !== 'never';
}

/**
 * Is the plain row of links ever shown?
 *
 * False only for 'always', which is the whole point of that mode: the links are
 * behind the button at every width, by choice rather than for want of room.
 */
export function showsRow(mode: BurgerMode): boolean {
  return mode !== 'always';
}
