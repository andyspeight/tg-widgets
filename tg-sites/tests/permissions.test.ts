/**
 * The permission vocabulary and how a stored set resolves to what a member may
 * do. Pure, so no tenant or session is needed.
 */

import { describe, expect, it } from 'vitest';

import {
  ALL_CAPABILITIES,
  PRESETS,
  can,
  effectiveCapabilities,
  parsePermissions,
} from '../lib/auth/permissions';

describe('parsePermissions', () => {
  it('keeps known keys, drops unknown ones, and de-duplicates', () => {
    expect(parsePermissions(['content', 'nope', 'content', 'theme'])).toEqual(['content', 'theme']);
  });

  it('puts the set into the canonical capability order', () => {
    // Given out of order, it comes back in ALL_CAPABILITIES order.
    expect(parsePermissions(['publish', 'content'])).toEqual(['content', 'publish']);
  });

  it('reads a non-array as unset (null), not as empty', () => {
    expect(parsePermissions(null)).toBeNull();
    expect(parsePermissions(undefined)).toBeNull();
    expect(parsePermissions('content')).toBeNull();
  });

  it('keeps a genuinely empty array as empty, not null', () => {
    expect(parsePermissions([])).toEqual([]);
  });

  it('an array of only-unknown keys is empty, not null', () => {
    expect(parsePermissions(['nope', 'gone'])).toEqual([]);
  });
});

describe('effectiveCapabilities', () => {
  it('staff get everything, whatever their stored set says', () => {
    const caps = effectiveCapabilities({ role: 'viewer', staff: true, stored: [] });
    expect(caps.size).toBe(ALL_CAPABILITIES.length);
    expect(can(caps, 'structure')).toBe(true);
  });

  it('an explicit set is the truth, even when empty', () => {
    const locked = effectiveCapabilities({ role: 'editor', staff: false, stored: [] });
    expect(locked.size).toBe(0);
    const some = effectiveCapabilities({ role: 'editor', staff: false, stored: ['content', 'publish'] });
    expect(can(some, 'content')).toBe(true);
    expect(can(some, 'publish')).toBe(true);
    expect(can(some, 'structure')).toBe(false);
  });

  it('an unset owner or editor keeps everything (no regression)', () => {
    for (const role of ['owner', 'editor'] as const) {
      const caps = effectiveCapabilities({ role, staff: false, stored: null });
      expect(caps.size).toBe(ALL_CAPABILITIES.length);
    }
  });

  it('an unset viewer can do nothing, which is what a viewer always meant', () => {
    const caps = effectiveCapabilities({ role: 'viewer', staff: false, stored: null });
    expect(caps.size).toBe(0);
  });
});

describe('presets', () => {
  it('content-only is edit-and-publish, not structure or theme', () => {
    const caps = new Set(PRESETS['content-only']);
    expect(can(caps, 'content')).toBe(true);
    expect(can(caps, 'publish')).toBe(true);
    expect(can(caps, 'structure')).toBe(false);
    expect(can(caps, 'theme')).toBe(false);
  });

  it('full-restyle is every capability', () => {
    expect([...PRESETS['full-restyle']].sort()).toEqual([...ALL_CAPABILITIES].sort());
  });
});
