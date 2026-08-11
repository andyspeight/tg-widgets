/**
 * The per-breakpoint engine: desktop base, tablet and phone overrides, and the
 * generated CSS they produce. Pure logic, so it is tested here directly; the
 * schema round-trip is in content.test.ts and the live behaviour in a browser.
 */

import { describe, expect, it } from 'vitest';

import { STACK_BREAKPOINTS } from '../lib/content/schema';
import {
  TIER_MAX_WIDTH,
  hasResponsive,
  resolveAt,
  isOverridden,
  withOverride,
  clearOverride,
  responsiveVars,
} from '../lib/content/responsive';

describe('the tier widths sit one below the stacking thresholds', () => {
  it('so an override fires in the same band the layout restacks in', () => {
    expect(TIER_MAX_WIDTH.tablet).toBe(STACK_BREAKPOINTS.tablet - 1);
    expect(TIER_MAX_WIDTH.phone).toBe(STACK_BREAKPOINTS.mobile - 1);
  });
});

describe('resolveAt inherits desktop-first', () => {
  it('desktop is always the base', () => {
    expect(resolveAt(96, { phone: { paddingY: 24 } }, 'paddingY', 'desktop')).toBe(96);
  });

  it('tablet is its own override, or the base', () => {
    expect(resolveAt(96, { tablet: { paddingY: 48 } }, 'paddingY', 'tablet')).toBe(48);
    expect(resolveAt(96, { phone: { paddingY: 24 } }, 'paddingY', 'tablet')).toBe(96);
    expect(resolveAt(96, undefined, 'paddingY', 'tablet')).toBe(96);
  });

  it('phone is its own override, then tablet, then the base', () => {
    expect(resolveAt(96, { phone: { paddingY: 24 } }, 'paddingY', 'phone')).toBe(24);
    expect(resolveAt(96, { tablet: { paddingY: 48 } }, 'paddingY', 'phone')).toBe(48);
    expect(resolveAt(96, { tablet: { paddingY: 48 }, phone: { paddingY: 24 } }, 'paddingY', 'phone')).toBe(24);
    expect(resolveAt(96, undefined, 'paddingY', 'phone')).toBe(96);
  });
});

describe('overridden and set/clear track a tier holding its own value', () => {
  it('desktop is never overridden: it is the base', () => {
    expect(isOverridden({ phone: { paddingY: 24 } }, 'paddingY', 'desktop')).toBe(false);
  });

  it('a tier is overridden only when it holds the property itself', () => {
    const r = { phone: { paddingY: 24 } };
    expect(isOverridden(r, 'paddingY', 'phone')).toBe(true);
    expect(isOverridden(r, 'paddingY', 'tablet')).toBe(false);
  });

  it('withOverride sets one tier and leaves the others', () => {
    const r = withOverride({ tablet: { paddingY: 48 } }, 'paddingY', 'phone', 24);
    expect(r).toEqual({ tablet: { paddingY: 48 }, phone: { paddingY: 24 } });
  });

  it('clearOverride lets a size inherit again, and empties to undefined', () => {
    expect(clearOverride({ tablet: { paddingY: 48 }, phone: { paddingY: 24 } }, 'paddingY', 'phone')).toEqual({
      tablet: { paddingY: 48 },
    });
    expect(clearOverride({ phone: { paddingY: 24 } }, 'paddingY', 'phone')).toBeUndefined();
  });

  it('hasResponsive is false for nothing, empty, or empty tiers', () => {
    expect(hasResponsive(undefined)).toBe(false);
    expect(hasResponsive({})).toBe(false);
    expect(hasResponsive({ phone: {} })).toBe(false);
    expect(hasResponsive({ phone: { paddingY: 24 } })).toBe(true);
  });
});

describe('responsiveVars emits inline custom properties, one per overridden size', () => {
  const map = [{ property: 'paddingY', varBase: '--tgs-pad', toCss: (v: unknown) => `${v as number}px` }];

  it('names each size twin off the base property, so static CSS can fold them in', () => {
    expect(responsiveVars({ tablet: { paddingY: 48 }, phone: { paddingY: 24 } }, map)).toEqual({
      '--tgs-pad-tablet': '48px',
      '--tgs-pad-phone': '24px',
    });
  });

  it('emits nothing when nothing is overridden, or the property is not in the map', () => {
    expect(responsiveVars(undefined, map)).toEqual({});
    expect(responsiveVars({ phone: { other: 5 } }, map)).toEqual({});
  });

  it('drops a value its toCss rejects rather than emitting a broken declaration', () => {
    const guarded = [{ property: 'paddingY', varBase: '--tgs-pad', toCss: () => null }];
    expect(responsiveVars({ phone: { paddingY: 24 } }, guarded)).toEqual({});
  });
});
