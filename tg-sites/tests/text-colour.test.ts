/**
 * Text colour, fanned out (7 Aug 2026).
 *
 * Andy's rule: any element we build with text should let a client colour it.
 * The quote, steps and stats blocks already did; this pins the same control on
 * the rest of the text-bearing blocks, so a future edit that drops one shows up
 * here rather than as a client with no way to colour their words.
 *
 * The application is the same safeColour idiom every one of these renders with
 * (a validated token or hex on the block, inherited by its words); the render
 * itself is exercised in the standalone harness.
 */

import { describe, expect, it } from 'vitest';

import { blockDefinition } from '../lib/content/blocks';

const RECOLOURABLE = ['cards', 'accordion', 'tabs', 'table', 'testimonials', 'audio'];

describe('every text-bearing block can recolour its words', () => {
  it.each(RECOLOURABLE)('%s carries a text colour field with a blank default', (type) => {
    const def = blockDefinition(type);
    const field = def?.fields.find((f) => f.key === 'textColour');
    expect(field?.kind).toBe('colour');
    // Blank means "follow the section", the honest default for a colour nobody
    // has overridden, and the invariant the per-block default tests check.
    expect(def?.defaults).toHaveProperty('textColour', '');
  });
});
