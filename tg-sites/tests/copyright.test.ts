/**
 * The Copyright element.
 *
 * WHY IT IS NOT JUST A TEXT BLOCK: the year. A copyright typed into a paragraph
 * is right on the day somebody types it and wrong every January afterwards.
 * Across a few hundred client sites that is a few hundred footers quietly saying
 * the wrong year, and not one client notices their own.
 *
 * SO THE YEAR IS AN ARGUMENT, not something the assembler reads off the clock,
 * and that is what makes these tests worth having: they ask what the line says
 * in 2030 and at a year boundary, rather than only what it says on the day
 * somebody happens to run them.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { blockDefinition, defaultPropsFor, isKnownBlock } from '../lib/content/blocks';
import { copyrightLine, copyrightYears } from '../lib/content/copyright';

function source(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf8');
}

const parts = (over: Partial<Parameters<typeof copyrightLine>[0]> = {}) => ({
  owner: 'Travelgenix',
  symbol: 'symbol' as const,
  suffix: 'All rights reserved.',
  ...over,
});

// ---------------------------------------------------------------------------

describe('the year', () => {
  it('is whatever year it is, with no start year set', () => {
    expect(copyrightYears(2026)).toBe('2026');
    expect(copyrightYears(2030)).toBe('2030');
    expect(copyrightYears(2026, 0)).toBe('2026');
  });

  it('reads as a range when the client has been going a while', () => {
    expect(copyrightYears(2026, 2016)).toBe('2016–2026');
  });

  /*
   * A range needs a beginning BEFORE an end. A start year equal to this one
   * would give "2026–2026", and one in the future would give a range drawn
   * backwards; both are worse than the plain year.
   */
  it('refuses a range that does not make sense', () => {
    expect(copyrightYears(2026, 2026)).toBe('2026');
    expect(copyrightYears(2026, 2030)).toBe('2026');
    expect(copyrightYears(2026, 12)).toBe('2026');
    expect(copyrightYears(2026, Number.NaN)).toBe('2026');
    expect(copyrightYears(2026, undefined)).toBe('2026');
  });

  /* The point of the whole element: the same stored props say a different year
     next year, with nobody touching the site. */
  it('says a different year next year, from the same stored props', () => {
    const stored = parts({ startYear: 2016 });
    expect(copyrightLine(stored, 2026)).toContain('2016–2026');
    expect(copyrightLine(stored, 2027)).toContain('2016–2027');
  });

  it('uses an en dash for the span, not a hyphen', () => {
    expect(copyrightYears(2026, 2016)).toContain('–');
    expect(copyrightYears(2026, 2016)).not.toContain('-');
  });
});

// ---------------------------------------------------------------------------

describe('the line', () => {
  it('reads the way somebody would write it', () => {
    expect(copyrightLine(parts(), 2026)).toBe('© 2026 Travelgenix. All rights reserved.');
  });

  it('offers the symbol, the word, both or neither', () => {
    expect(copyrightLine(parts({ symbol: 'word' }), 2026)).toBe(
      'Copyright 2026 Travelgenix. All rights reserved.',
    );
    expect(copyrightLine(parts({ symbol: 'both' }), 2026)).toBe(
      '© Copyright 2026 Travelgenix. All rights reserved.',
    );
    expect(copyrightLine(parts({ symbol: 'none' }), 2026)).toBe(
      '2026 Travelgenix. All rights reserved.',
    );
  });

  /*
   * "Travelgenix Ltd.. All rights reserved." was the first version of this, and
   * a company name ending in a full stop is common enough to be worth the check.
   */
  it('does not double a full stop after a name that already has one', () => {
    expect(copyrightLine(parts({ owner: 'Travelgenix Ltd.' }), 2026)).toBe(
      '© 2026 Travelgenix Ltd. All rights reserved.',
    );
  });

  it('stays a valid line when the client has filled in almost nothing', () => {
    expect(copyrightLine(parts({ owner: '', suffix: '' }), 2026)).toBe('© 2026');
    expect(copyrightLine(parts({ owner: '', symbol: 'none', suffix: '' }), 2026)).toBe('2026');
    expect(copyrightLine(parts({ suffix: '' }), 2026)).toBe('© 2026 Travelgenix');
  });

  it('trims what a client typed rather than trusting the spacing', () => {
    expect(copyrightLine(parts({ owner: '  Travelgenix  ', suffix: '  Est. 1998  ' }), 2026)).toBe(
      '© 2026 Travelgenix. Est. 1998',
    );
  });
});

// ---------------------------------------------------------------------------

describe('the block', () => {
  const definition = blockDefinition('copyright')!;

  it('is in the library, under Text, and belongs to the client', () => {
    expect(isKnownBlock('copyright')).toBe(true);
    expect(definition.group).toBe('Text');
    expect(definition.staffOnly).toBeUndefined();
  });

  it('sets a default for every field the editor offers', () => {
    const props = defaultPropsFor('copyright');
    for (const field of definition.fields) {
      expect(props, `no default for "${field.key}"`).toHaveProperty(field.key);
    }
  });

  /* A year field would be the whole point thrown away: it would be right today
     and wrong every January, which is the thing this block exists to stop. */
  it('has no field for the current year', () => {
    expect(definition.fields.some((f) => f.key === 'year')).toBe(false);
    expect(defaultPropsFor('copyright')).not.toHaveProperty('year');
  });
});

// ---------------------------------------------------------------------------

describe('what the renderer promises', () => {
  const renderer = source('components', 'render', 'blocks.tsx');

  /*
   * NO SCRIPT WRITES THE YEAR IN. The usual version of this element sets the
   * year on load, so a visitor with JavaScript off sees a gap and a crawler
   * indexes one. A published page ships no JavaScript, so the server has to hand
   * over a finished line.
   */
  it('renders a finished line on the server', () => {
    expect(renderer).toContain('export function CopyrightBlock(');
    expect(renderer).toContain('new Date().getUTCFullYear()');
    expect(renderer).not.toMatch(/CopyrightBlock[\s\S]{0,1200}useEffect/);
  });

  /* Built from parts we control and rendered as a text node, so nothing a client
     types can become an element and no sanitiser is needed. */
  it('renders text rather than markup', () => {
    expect(renderer).toMatch(/CopyrightBlock[\s\S]{0,1200}\{line\}/);
    expect(renderer).not.toMatch(/CopyrightBlock[\s\S]{0,1200}dangerouslySetInnerHTML/);
  });

  it('is quiet by default but stays readable', () => {
    const css = source('app', 'globals.css');
    expect(css).toContain('.tgs-copyright {');
    // Tinted from the palette hue and measured, not a flat grey picked to look soft.
    expect(css).toMatch(/\.tgs-copyright \{[^}]*color: var\(--tgs-text-muted\)/);
  });
});
