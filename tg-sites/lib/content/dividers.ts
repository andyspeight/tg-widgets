/**
 * The shaped edge where one section meets the next.
 *
 * WHAT THESE ARE. A section normally ends in a straight horizontal line, which
 * is what makes a page of tinted bands look like a stack of bands. A divider
 * takes the section's own background and extends it into the neighbour in a
 * shape, so the join reads as one design rather than two rectangles touching.
 * Every modern template has them and this had none.
 *
 * A CLOSED LIST OF PATHS, WRITTEN HERE, and the same reason the social icons
 * are: this is SVG, SVG carries script, and the only safe arrangement is that
 * the markup is entirely ours and the client picks from a list. The client
 * chooses a name and a height; they never supply geometry.
 *
 * EVERY PATH IS DRAWN FILLED AT THE BOTTOM of a 1200 by 100 box, which is the
 * shape a TOP divider wants: the section's colour reaching up out of it. The
 * bottom edge uses the same path flipped, in CSS, rather than a second set of
 * coordinates that could drift out of step with the first.
 *
 * preserveAspectRatio="none" on the svg, so the shape stretches to whatever
 * width the section is and keeps the height it was given. That is the whole
 * reason the viewBox is a fixed 1200 wide and nothing here does arithmetic.
 */

export interface DividerShape {
  id: string;
  label: string;
  /** Filled region at the BOTTOM of a 0 0 1200 100 box. */
  path: string;
}

export const DIVIDER_SHAPES: readonly DividerShape[] = [
  {
    id: 'angle',
    label: 'Angle',
    // A straight diagonal, low on the left and high on the right.
    path: 'M0 100 L1200 0 L1200 100 Z',
  },
  {
    id: 'curve',
    label: 'Curve',
    // A shallow arc, dipping upward through the middle.
    path: 'M0 100 C400 18 800 18 1200 100 Z',
  },
  {
    id: 'round',
    label: 'Round',
    // A single deep bulge, near enough a half circle at the default height.
    path: 'M0 100 C260 -12 940 -12 1200 100 Z',
  },
  {
    id: 'wave',
    label: 'Wave',
    // Two soft crests, the second shallower, so it reads as a wave rather
    // than as a repeating pattern.
    path: 'M0 100 C180 20 380 20 600 58 C820 96 1000 88 1200 46 L1200 100 Z',
  },
  {
    id: 'point',
    label: 'Point',
    // A single centred peak. The one that reads as deliberate rather than soft.
    path: 'M0 100 L600 8 L1200 100 Z',
  },
];

/** The names a section may store, plus the one that means no divider at all. */
export const DIVIDER_OPTIONS = [
  { value: 'none', label: 'Straight' },
  ...DIVIDER_SHAPES.map((shape) => ({ value: shape.id, label: shape.label })),
];

/** The shape with this id, or undefined. The only way an id is resolved. */
export function dividerShape(id: unknown): DividerShape | undefined {
  return typeof id === 'string' ? DIVIDER_SHAPES.find((shape) => shape.id === id) : undefined;
}

/** How tall a divider may be, in pixels. */
export const MIN_DIVIDER_HEIGHT = 8;
export const MAX_DIVIDER_HEIGHT = 200;
export const DEFAULT_DIVIDER_HEIGHT = 56;

/**
 * Any input, coerced to a legal divider height. Never throws.
 *
 * Same shape as normaliseSectionPadding and for the same reason: this arrives
 * from stored JSON and from a number input, and min and max on a number input
 * are advisory.
 */
export function normaliseDividerHeight(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_DIVIDER_HEIGHT;
  return Math.min(MAX_DIVIDER_HEIGHT, Math.max(MIN_DIVIDER_HEIGHT, Math.round(n)));
}

/** A stored divider name, reduced to one this can draw or to 'none'. */
export function safeDivider(value: unknown): string {
  return dividerShape(value) ? (value as string) : 'none';
}

/**
 * The CSS colour a section is painted in.
 *
 * WHAT THIS IS FOR. A shaped edge is not a decoration on one section, it is the
 * BOUNDARY between two, so drawing it needs both colours. The shape is drawn
 * inside the section that owns it, in the colour of the section on the other
 * side, so the neighbour's colour appears to reach across the join. Drawn the
 * other way round, reaching out of its own section into the next one, it covers
 * whatever is near the top of that section: on 1 Aug 2026 a 56px divider ate
 * the entire 48px default padding of the section below and sat on its heading.
 *
 * A colour of its own wins over the tone, exactly as the background does.
 * Anything else is the tone's own surface variable, so a divider follows the
 * theme rather than freezing today's hex into a page.
 */
export function sectionFill(
  section: { tone?: string; box?: { background?: string } } | null | undefined,
): string {
  // No neighbour means the page itself, which is the plain surface.
  if (!section) return 'var(--tgs-surface)';

  const own = section.box?.background;
  if (own && own !== 'transparent') return own;

  switch (section.tone) {
    case 'subtle': return 'var(--tgs-surface-alt)';
    case 'dark': return 'var(--tgs-surface-dark)';
    case 'accent': return 'var(--tgs-primary)';
    default: return 'var(--tgs-surface)';
  }
}
