/**
 * Describing the pictures on a page that nobody described.
 *
 * The second half of the done-for-you SEO (#239 wrote the search listing). Alt
 * text is read aloud to somebody who cannot see the picture and read by search
 * engines to know what it shows, and it is the single commonest thing missing
 * from a site somebody built themselves.
 *
 * ALT BELONGS TO THE PICTURE, NOT THE PLACE IT IS USED, which lib/media/types.ts
 * settled when the image bank was built: set once when a picture goes into the
 * bank, inherited everywhere it is placed. A block with a src and no alt is
 * therefore an inheritance that did not happen, usually because the picture was
 * placed before anybody described it.
 *
 * SO THE FIRST ANSWER IS FREE. If the bank already knows what the picture is,
 * the block copies it and no model is asked anything. Only a picture nobody has
 * ever described costs a call, and the answer to that is written back to the
 * BANK as well as the block, so the next page that uses it inherits properly and
 * the same picture is never described twice.
 *
 * THE SAME RULE THE AUDIT USES for what counts as a picture: any props object
 * carrying a `src`, including a repeater's rows, rather than a list of block
 * types. A list would go stale the next time a block gains a picture, which is
 * exactly the failure that leaves a report saying everything is fine. What the
 * audit reports and what this fills have to be the same set.
 */

import type { Page } from '../content/schema';

/*
 * THE CAP COMES FROM THE PROMPT that asks for the description, not from a second
 * number here. lib/ai/prompt.ts tells the model "under 125 characters", and a
 * boundary that let through 160 would be quietly admitting the answers that
 * prompt forbids. One constant, so the ask and the check cannot drift.
 */
export { MAX_ALT } from '../ai/prompt';
import { MAX_ALT } from '../ai/prompt';

/**
 * Every distinct picture on a page that has no description.
 *
 * DEDUPED BY URL, which is the whole reason this returns addresses rather than
 * positions. One picture used in a hero and again in a card is one thing to
 * describe and two places to write the answer.
 */
export function imagesNeedingAlt(page: Page): string[] {
  const found = new Set<string>();

  const look = (props: Record<string, unknown> | undefined) => {
    if (!props || typeof props !== 'object') return;
    const src = typeof props.src === 'string' ? props.src.trim() : '';
    if (src === '') return;
    const alt = typeof props.alt === 'string' ? props.alt.trim() : '';
    if (alt === '') found.add(src);
  };

  eachProps(page, look);
  return [...found];
}

/**
 * The page with those descriptions written in, and how many places changed.
 *
 * Returns the SAME page when nothing matched, so the caller can skip the save
 * rather than store a page identical to the one it had.
 *
 * BLANKS ONLY, exactly as the search listing fill does. A block that already
 * carries a description keeps it, whatever the bank says: somebody wrote that
 * for this use of the picture and may have had a reason.
 */
export function applyAlts(page: Page, alts: ReadonlyMap<string, string>): { page: Page; filled: number } {
  if (alts.size === 0) return { page, filled: 0 };

  let filled = 0;

  const fix = (props: Record<string, unknown>): Record<string, unknown> => {
    const src = typeof props.src === 'string' ? props.src.trim() : '';
    if (src === '') return props;
    const alt = typeof props.alt === 'string' ? props.alt.trim() : '';
    if (alt !== '') return props;

    const written = alts.get(src);
    if (!written) return props;

    filled += 1;
    return { ...props, alt: written.slice(0, MAX_ALT) };
  };

  const next = mapProps(page, fix);
  return filled > 0 ? { page: next, filled } : { page, filled: 0 };
}

// ---------------------------------------------------------------------------
// The walk, in one place, so reading and writing cannot disagree about what a
// picture is or where one can be.
// ---------------------------------------------------------------------------

/** Visit every props object that could carry a picture. */
function eachProps(page: Page, visit: (props: Record<string, unknown>) => void): void {
  const walkBlocks = (blocks: readonly unknown[] | undefined, depth: number): void => {
    if (!Array.isArray(blocks) || depth > 6) return;

    for (const raw of blocks) {
      if (!raw || typeof raw !== 'object') continue;
      const block = raw as { type?: string; props?: Record<string, unknown> };
      const props = block.props ?? {};
      visit(props);

      // A repeater's rows carry the same kinds of key, so the same rule applies
      // to each. This is also where an inner container's blocks live, so the
      // recursion and the row visit are the same loop.
      for (const value of Object.values(props)) {
        if (!Array.isArray(value)) continue;
        for (const row of value) {
          if (!row || typeof row !== 'object') continue;
          const item = row as Record<string, unknown>;
          visit(item);
          if (Array.isArray(item.blocks)) walkBlocks(item.blocks, depth + 1);
        }
      }
    }
  };

  for (const section of page.sections ?? []) {
    for (const row of section?.rows ?? []) {
      for (const column of row?.columns ?? []) walkBlocks(column?.blocks, 0);
    }
  }
}

/** The same walk, rebuilding as it goes. */
function mapProps(page: Page, fix: (props: Record<string, unknown>) => Record<string, unknown>): Page {
  const mapBlocks = (blocks: unknown, depth: number): unknown => {
    if (!Array.isArray(blocks) || depth > 6) return blocks;

    return blocks.map((raw) => {
      if (!raw || typeof raw !== 'object') return raw;
      const block = raw as { props?: Record<string, unknown> };
      const props = fix(block.props ?? {});

      const nested: Record<string, unknown> = { ...props };
      for (const [key, value] of Object.entries(props)) {
        if (!Array.isArray(value)) continue;
        nested[key] = value.map((row) => {
          if (!row || typeof row !== 'object') return row;
          const item = fix(row as Record<string, unknown>);
          return Array.isArray((item as { blocks?: unknown }).blocks)
            ? { ...item, blocks: mapBlocks((item as { blocks?: unknown }).blocks, depth + 1) }
            : item;
        });
      }

      return { ...block, props: nested };
    });
  };

  return {
    ...page,
    sections: (page.sections ?? []).map((section) => ({
      ...section,
      rows: (section?.rows ?? []).map((row) => ({
        ...row,
        columns: (row?.columns ?? []).map((column) => ({
          ...column,
          blocks: mapBlocks(column?.blocks, 0) as typeof column.blocks,
        })),
      })),
    })),
  };
}
