/**
 * The deep personalisation prune (per-block audience, v2): a visitor sees only
 * the sections AND the blocks their audience rule allows, and the prune reaches a
 * block inside a container's own inner columns.
 *
 * The decision is proved in audience.test.ts; this holds the tree-shaped part:
 * sections filter, blocks within a surviving section filter, and a container's
 * inner blocks filter, all on a copy so the input is never mutated.
 */

import { describe, expect, it } from 'vitest';

import { personaliseSections } from '../lib/content/personalise';
import { DEFAULT_VISITOR_SIGNALS, type VisitorSignals } from '../lib/content/audience';
import { parsePage, type Section } from '../lib/content/schema';

const signals = (over: Partial<VisitorSignals> = {}): VisitorSignals => ({
  ...DEFAULT_VISITOR_SIGNALS,
  ...over,
});

const column = (blocks: unknown[]) => ({ id: `c${Math.random()}`, width: 100, blocks });
const row = (blocks: unknown[]) => ({ id: `r${Math.random()}`, columns: [column(blocks)] });

/** Parse a raw page down to its sections, the way a real save round-trips. */
function sections(raw: unknown[]): Section[] {
  const parsed = parsePage({ version: 1, id: 'p', title: 'T', slug: '', sections: raw });
  if (!parsed.ok) throw new Error('page did not parse');
  return parsed.page.sections;
}

const ukBlock = { id: 'b-uk', type: 'text', audience: { mode: 'show', countries: ['GB'] } };
const alwaysBlock = { id: 'b-always', type: 'text' };

describe('personaliseSections filters sections and blocks together', () => {
  const raw = [
    { id: 's1', rows: [row([alwaysBlock, ukBlock])] },
    { id: 's-uk', audience: { mode: 'show', countries: ['GB'] }, rows: [row([alwaysBlock])] },
  ];

  it('drops a targeted block and a targeted section for the wrong visitor', () => {
    const out = personaliseSections(sections(raw), signals({ country: 'US' }));
    expect(out.map((s) => s.id)).toEqual(['s1']); // the GB-only section is gone
    expect(out[0].rows[0].columns[0].blocks.map((b) => b.id)).toEqual(['b-always']); // GB block gone
  });

  it('keeps them for the visitor they target', () => {
    const out = personaliseSections(sections(raw), signals({ country: 'GB' }));
    expect(out.map((s) => s.id)).toEqual(['s1', 's-uk']);
    expect(out[0].rows[0].columns[0].blocks.map((b) => b.id)).toEqual(['b-always', 'b-uk']);
  });

  it('never mutates the input tree', () => {
    const tree = sections(raw);
    const before = tree[0].rows[0].columns[0].blocks.length;
    personaliseSections(tree, signals({ country: 'US' }));
    expect(tree[0].rows[0].columns[0].blocks.length).toBe(before);
    expect(tree.length).toBe(2);
  });
});

describe('the prune reaches inside a container', () => {
  const raw = [
    {
      id: 's2',
      rows: [
        row([
          {
            id: 'cont',
            type: 'container',
            props: {
              columns: [{ id: 'ic', width: 100, blocks: [alwaysBlock, ukBlock] }],
            },
          },
        ]),
      ],
    },
  ];

  it("drops a container's inner block the visitor fails, keeps the container", () => {
    const out = personaliseSections(sections(raw), signals({ country: 'US' }));
    const container = out[0].rows[0].columns[0].blocks[0] as unknown as {
      props: { columns: { blocks: { id: string }[] }[] };
    };
    expect(container.props.columns[0].blocks.map((b) => b.id)).toEqual(['b-always']);
  });

  it('keeps the inner block for the visitor it targets', () => {
    const out = personaliseSections(sections(raw), signals({ country: 'GB' }));
    const container = out[0].rows[0].columns[0].blocks[0] as unknown as {
      props: { columns: { blocks: { id: string }[] }[] };
    };
    expect(container.props.columns[0].blocks.map((b) => b.id)).toEqual(['b-always', 'b-uk']);
  });
});
