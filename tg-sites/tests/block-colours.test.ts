/**
 * Colour on the blocks that carry an icon, a marker or a figure.
 *
 * Andy, 3 Aug 2026: the icon and the words in a block could not be coloured,
 * and every element of every block should be editable. This guards the answer.
 * The pure halves run here for real: the field is offered, and the save keeps a
 * good colour while refusing one that is not a colour. The renderer half cannot
 * be imported into this runner (the components are TSX and vitest is set to
 * leave JSX alone), so the wiring that puts the colour on the right element is
 * read from source, the same way the other renderer tests in this suite are. It
 * was also rendered for real in a browser and headlessly before shipping.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { blockDefinition } from '../lib/content/blocks';
import { sanitiseBlock } from '../lib/content/sanitise-page';
import type { Block } from '../lib/content/schema';

function read(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf8');
}

const fieldKinds = (type: string) =>
  (blockDefinition(type)?.fields ?? []).map((field) => `${field.key}:${field.kind}`);

describe('the colour-bearing blocks offer the colours', () => {
  it('gives Icon and text both an icon and a text colour', () => {
    expect(fieldKinds('icon-item')).toEqual(
      expect.arrayContaining(['iconColour:colour', 'textColour:colour']),
    );
  });

  it('gives the quote a text colour', () => {
    expect(fieldKinds('quote')).toContain('textColour:colour');
  });

  it('gives the steps a marker colour and a text colour', () => {
    expect(fieldKinds('steps')).toEqual(
      expect.arrayContaining(['markerColour:colour', 'textColour:colour']),
    );
  });

  it('gives the key numbers a figure colour and a label colour', () => {
    expect(fieldKinds('stats')).toEqual(
      expect.arrayContaining(['figureColour:colour', 'textColour:colour']),
    );
  });
});

describe('a colour is validated on the way into the store', () => {
  const block = (props: Record<string, unknown>): Block =>
    ({ id: 'b1', type: 'icon-item', props } as Block);

  it('keeps a theme token and a hex', () => {
    const out = sanitiseBlock(block({ icon: 'star', iconColour: 'var(--tgs-accent)', textColour: '#112233' }));
    expect(out.props.iconColour).toBe('var(--tgs-accent)');
    expect(out.props.textColour).toBe('#112233');
  });

  it('drops anything that is not a colour, rather than storing it', () => {
    const out = sanitiseBlock(block({ icon: 'star', iconColour: 'red;background:url(javascript:alert(1))' }));
    // safeColour refused it, so what is stored is empty, which reads as "follow
    // the section". Nothing an attacker typed survives to a future render.
    expect(out.props.iconColour).toBe('');
  });

  it('refuses a token that is not on the colour list', () => {
    const out = sanitiseBlock(block({ icon: 'star', iconColour: 'var(--tgs-radius-lg)' }));
    expect(out.props.iconColour).toBe('');
  });
});

describe('the renderer puts each colour on the right element', () => {
  const blocks = read('components', 'render', 'blocks.tsx');

  it('reads every block colour through safeColour, never raw', () => {
    for (const prop of ['iconColour', 'textColour', 'markerColour', 'figureColour']) {
      expect(blocks, prop).toMatch(new RegExp(`safeColour\\(props\\.${prop}\\)`));
    }
  });

  it('colours the icon glyph and the words beside it', () => {
    expect(blocks).toMatch(/tgs-icon-item__icon[\s\S]*?style=\{iconColour \?/);
    expect(blocks).toMatch(/<div style=\{textColour \?/);
  });

  it('fills a dot marker as well as bordering it', () => {
    expect(blocks).toMatch(/background: marker === 'dot' \? markerColour/);
  });
});

describe('the field and its safety are wired in', () => {
  it('has a colour field kind and a renderer for it', () => {
    expect(read('lib', 'content', 'blocks.ts')).toMatch(/kind: 'colour'/);
    expect(read('components', 'editor', 'Fields.tsx')).toContain("case 'colour':");
    // The save path validates it rather than trusting the field.
    expect(read('lib', 'content', 'sanitise-page.ts')).toMatch(/case 'colour':\s*\n\s*return safeColour/);
  });
});
