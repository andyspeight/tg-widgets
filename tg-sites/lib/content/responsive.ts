/**
 * Per-breakpoint style overrides: one style, set differently per screen size.
 *
 * WHAT ANDY ASKED FOR, 11 Aug 2026: "allow styling changes per breakpoint so you
 * can get it looking exactly as required on each screen size". The site already
 * reflows by real screen size (the page is a CSS container named `tgs-page`, and
 * globals.css stacks rows at `@container tgs-page (max-width: 1023px)` and again
 * at `767px`). This is the layer that lets a chosen style follow the same
 * boundaries: DESKTOP IS THE BASE, tablet and phone override it, and a size that
 * is not set inherits from the next size up.
 *
 * TWO PARTS, AND THIS FILE IS THE PURE HALF.
 *
 *   1. The DATA lives on the element as `responsive`, a small map of the sizes
 *      that override the base and the properties they override (see the Zod
 *      `ResponsiveSchema` in schema.ts, which validates each property exactly as
 *      its base field does). A plain element has no `responsive` at all, so this
 *      is purely additive: nothing saved before it changes shape.
 *
 *   2. The RENDER is generated CSS, not an inline style, because an inline style
 *      cannot carry a media or container query (styles.ts spells out why). For a
 *      style already expressed as a custom property, the base stays inline and
 *      the override sets a SHADOW property the CSS falls back through: padding is
 *      `var(--tgs-pad-r, var(--tgs-pad, 48px))`, and an override only ever sets
 *      `--tgs-pad-r`, inside the container query for its size. So the base never
 *      moves, nothing needs `!important`, and the cascade does the inheriting:
 *      the tablet rule (max-width 1023) still matches at a phone width, so a phone
 *      that set nothing keeps the tablet value, and a phone that set its own wins
 *      because its rule comes later.
 *
 * The editor drives which size a control edits off the device switcher's current
 * tier, so switching to Phone and changing a value writes the phone override and
 * shows it live, because the canvas is the same container these queries read.
 */

import { STACK_BREAKPOINTS } from './schema';

/** The editor's three screen tiers. Desktop is the base, not stored. */
export type Tier = 'desktop' | 'tablet' | 'phone';

/** The two tiers that are stored as overrides. Desktop is the base field. */
export const OVERRIDE_TIERS = ['tablet', 'phone'] as const;
export type OverrideTier = (typeof OVERRIDE_TIERS)[number];

/** Title-case names for the editor, matching the device switcher's labels. */
export const TIER_LABEL: Record<Tier, string> = {
  desktop: 'Desktop',
  tablet: 'Tablet',
  phone: 'Phone',
};

/**
 * Where a size takes its value from when it holds no override of its own: tablet
 * falls back to desktop, phone to tablet. Desktop is the base and inherits from
 * nothing. Used only for the editor's "inherited from" note.
 */
export const INHERITS_FROM: Record<OverrideTier, Tier> = {
  tablet: 'desktop',
  phone: 'tablet',
};

/**
 * The container-query max-width for each override tier: one pixel below the
 * stacking threshold, so an override fires in the SAME band the layout restacks
 * in rather than a boundary of its own. Derived from STACK_BREAKPOINTS so the two
 * cannot drift: tablet stacks below 1024, phone below 768.
 */
export const TIER_MAX_WIDTH: Record<OverrideTier, number> = {
  tablet: STACK_BREAKPOINTS.tablet - 1,
  phone: STACK_BREAKPOINTS.mobile - 1,
};

/** One size's overrides: a partial set of the properties that support it. */
export type Overrides = Record<string, unknown>;

/** The map an element carries. Absent when nothing is overridden. */
export interface Responsive {
  tablet?: Overrides;
  phone?: Overrides;
}

/** True when the element overrides anything on any size. */
export function hasResponsive(responsive: Responsive | undefined | null): boolean {
  if (!responsive) return false;
  return OVERRIDE_TIERS.some((tier) => {
    const set = responsive[tier];
    return set != null && Object.keys(set).length > 0;
  });
}

/**
 * The effective value of one property at one tier, desktop-first.
 *
 * Desktop is the base. Tablet is its own override or the base. Phone is its own
 * override, or the tablet one, or the base. This is the same inheritance the
 * generated CSS produces through the cascade; it lives here too so the editor can
 * SHOW the value a size will actually take before anything is typed.
 */
export function resolveAt<T>(
  base: T,
  responsive: Responsive | undefined,
  property: string,
  tier: Tier,
): T {
  if (tier === 'desktop') return base;
  if (tier === 'tablet') {
    const t = responsive?.tablet?.[property];
    return t === undefined ? base : (t as T);
  }
  const p = responsive?.phone?.[property];
  if (p !== undefined) return p as T;
  const t = responsive?.tablet?.[property];
  return t === undefined ? base : (t as T);
}

/**
 * Whether a tier holds its OWN override of a property (rather than inheriting).
 *
 * What the editor reads to show a size as overridden and to offer a reset. A
 * desktop is never "overridden": it is the base.
 */
export function isOverridden(
  responsive: Responsive | undefined,
  property: string,
  tier: Tier,
): boolean {
  if (tier === 'desktop') return false;
  return responsive?.[tier]?.[property] !== undefined;
}

/**
 * Set an override for a property at a tier, returning the new `responsive` map.
 *
 * Pure: the caller commits it as a patch. Desktop is refused here because it is
 * the base field, not an override, and setting it belongs to the base setter.
 */
export function withOverride(
  responsive: Responsive | undefined,
  property: string,
  tier: OverrideTier,
  value: unknown,
): Responsive {
  const next: Responsive = {
    tablet: { ...(responsive?.tablet ?? {}) },
    phone: { ...(responsive?.phone ?? {}) },
  };
  next[tier] = { ...next[tier], [property]: value };
  return prune(next);
}

/**
 * Clear a property's override at a tier, so it inherits again. Returns the new
 * map, or undefined when nothing is left overridden anywhere.
 */
export function clearOverride(
  responsive: Responsive | undefined,
  property: string,
  tier: OverrideTier,
): Responsive | undefined {
  if (!responsive?.[tier]) return prune({ ...responsive });
  const set = { ...responsive[tier] };
  delete set[property];
  const next: Responsive = { ...responsive, [tier]: set };
  const pruned = prune(next);
  return hasResponsive(pruned) ? pruned : undefined;
}

/** Drop empty tier sets, so an emptied override does not linger as `{}`. */
function prune(responsive: Responsive): Responsive {
  const next: Responsive = {};
  for (const tier of OVERRIDE_TIERS) {
    const set = responsive[tier];
    if (set && Object.keys(set).length > 0) next[tier] = set;
  }
  return next;
}

// ---------------------------------------------------------------------------
// Render: inline custom properties, NO generated stylesheet
// ---------------------------------------------------------------------------

/**
 * The overrides as inline custom properties, e.g. `--tgs-pad-tablet: 48px`.
 *
 * THERE IS NO GENERATED <style> TAG, on purpose. An override cannot be a plain
 * inline style because a style attribute holds no query, but it does not have to
 * be generated CSS either: the element carries the override VALUES as inline
 * custom properties, and STATIC container queries in globals.css do the choosing.
 * One pair of rules there reads `--tgs-pad-tablet`/`--tgs-pad-phone` off whatever
 * section is in the band and folds them into `--tgs-pad-r` with a fallback chain,
 * so a size that set nothing keeps the larger size's value. So this stays as
 * CSP-clean as the theme and the column widths, which are inline the same way and
 * for the same reason (see the note on PageRenderer's `theme`).
 *
 * `map` names each overridable property, the base custom property whose per-size
 * twins it sets (`--tgs-pad` -> `--tgs-pad-tablet`), and how to turn the stored
 * value into a CSS value. A value its `toCss` rejects is left out rather than
 * emitted broken.
 */
export function responsiveVars(
  responsive: Responsive | undefined,
  map: ReadonlyArray<{ property: string; varBase: string; toCss: (value: unknown) => string | null }>,
): Record<string, string> {
  const vars: Record<string, string> = {};
  if (!responsive) return vars;
  for (const tier of OVERRIDE_TIERS) {
    const set = responsive[tier];
    if (!set) continue;
    for (const { property, varBase, toCss } of map) {
      if (!(property in set)) continue;
      const css = toCss(set[property]);
      if (css != null) vars[`${varBase}-${tier}`] = css;
    }
  }
  return vars;
}
