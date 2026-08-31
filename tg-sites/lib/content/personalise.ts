/**
 * Personalise a page tree for a visitor: drop the sections AND the blocks whose
 * audience rule the visitor fails, before the tree is rendered.
 *
 * WHY NOT IN THE PURE audience MODULE. The decision (sectionVisibleFor) is pure
 * and lives there. This walks the content SHAPE (sections, rows, columns, and a
 * container's own inner columns), so it needs the schema types and the container
 * helper, which would make audience.ts import the schema that imports it. Kept
 * here instead: it imports audience and the schema types, and nothing imports it
 * back, so there is no cycle.
 *
 * ONE PASS, BEFORE EVERYTHING. The site route and the editor's Preview-as call
 * this once on the tree they are about to draw, so the hero, the image preload,
 * the JSON-LD scan and the markup all see only what this visitor sees, and the
 * initial HTML carries exactly that. A block a visitor fails is GONE from the
 * tree, not hidden with CSS. Everything is a shallow copy, never a mutation, so
 * the cached load() result the metadata pass shares is untouched.
 */

import { sectionVisibleFor, type VisitorSignals } from './audience';
import type { Block, Section } from './schema';
import { containerColumns } from './tree';

/**
 * Keep the blocks this visitor should see, recursing into a container's own
 * inner columns so a personalised block inside a grid is pruned too.
 */
function visibleBlocks(blocks: readonly Block[], signals: VisitorSignals): Block[] {
  const out: Block[] = [];
  for (const block of blocks) {
    if (!sectionVisibleFor(block.audience, signals)) continue;
    const inner = containerColumns(block);
    if (inner.length > 0) {
      out.push({
        ...block,
        props: {
          ...block.props,
          columns: inner.map((column) => ({
            ...column,
            blocks: visibleBlocks(column.blocks, signals),
          })),
        },
      });
    } else {
      out.push(block);
    }
  }
  return out;
}

/**
 * A tree's sections filtered for a visitor, and within each surviving section
 * its blocks filtered too. Sections without a rule, and blocks without a rule,
 * are kept exactly as they are (sectionVisibleFor is true for no audience).
 */
export function personaliseSections<S extends Section>(
  sections: readonly S[],
  signals: VisitorSignals,
): S[] {
  return sections
    .filter((section) => sectionVisibleFor(section.audience, signals))
    .map((section) => ({
      ...section,
      rows: section.rows.map((row) => ({
        ...row,
        columns: row.columns.map((column) => ({
          ...column,
          blocks: visibleBlocks(column.blocks, signals),
        })),
      })),
    }));
}
