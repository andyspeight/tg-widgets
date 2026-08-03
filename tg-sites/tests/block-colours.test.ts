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

/** The kinds of a repeater's per-item fields, e.g. the buttons in a group. */
const repeaterItemKinds = (type: string, key: string) => {
  const field = (blockDefinition(type)?.fields ?? []).find((f) => f.key === key);
  return field && field.kind === 'repeater'
    ? field.fields.map((f) => `${f.key}:${f.kind}`)
    : [];
};

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

  it('gives a button a colour, a label colour and a size', () => {
    expect(fieldKinds('button')).toEqual(
      expect.arrayContaining(['colour:colour', 'textColour:colour', 'size:select']),
    );
  });

  it('gives a button INSIDE a group the same colour and size, not just the lone one', () => {
    // The hero uses a button group, so a per-button size and colour there is the
    // whole point of Andy's report: the group's buttons could be neither.
    expect(repeaterItemKinds('button-group', 'buttons')).toEqual(
      expect.arrayContaining(['size:select', 'colour:colour', 'textColour:colour']),
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

  it('validates a button colour, lone and inside a group', () => {
    const lone = sanitiseBlock({ id: 'b', type: 'button', props: { label: 'x', colour: 'url(javascript:1)' } } as Block);
    expect(lone.props.colour).toBe('');

    const grouped = sanitiseBlock({
      id: 'g',
      type: 'button-group',
      props: { buttons: [{ label: 'x', colour: 'var(--tgs-accent)' }, { label: 'y', colour: 'url(bad)' }] },
    } as Block);
    const buttons = grouped.props.buttons as Array<Record<string, unknown>>;
    expect(buttons[0].colour).toBe('var(--tgs-accent)');
    expect(buttons[1].colour).toBe('');
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

  it('fills a button and matches its edge, and colours its label', () => {
    expect(blocks).toMatch(/safeColour\(button\.colour\)/);
    expect(blocks).toMatch(/safeColour\(button\.textColour\)/);
    // The fill sets both the background and the border, so an outlined style is
    // not left with an edge of the wrong colour.
    expect(blocks).toMatch(/style\.background = fill/);
    expect(blocks).toMatch(/style\.borderColor = fill/);
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
