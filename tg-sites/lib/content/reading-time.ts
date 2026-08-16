/**
 * How long a post takes to read, worked out from its body.
 *
 * A DERIVED NUMBER, NEVER STORED. Reading time is words divided by a rate, and
 * the words are already in the sections, so storing it would be a second copy of
 * something that can only ever be recomputed from the first. It is worked out at
 * render, on the post and on its card, from the same body both draw.
 *
 * SELF-CONTAINED IN THE CONTENT LAYER on purpose. lib/seo/audit.ts walks the same
 * text for the SEO word count, but content importing from seo would point the
 * dependency the wrong way round (seo reads content, not the reverse). The list
 * of text-bearing props is small and stable, so a second copy here is cheaper
 * than the tangle, and it is the same one-level walk the audit does, so the two
 * agree on what counts as words.
 */

import type { Block, Section } from './schema';

/** The pace most reading-time widgets settle on. */
const WORDS_PER_MINUTE = 200;

/** The props that hold words a reader actually reads. Matches lib/seo/audit.ts. */
const TEXT_KEYS = ['html', 'text', 'title', 'body', 'caption', 'label', 'quote', 'attribution', 'summary'];

/**
 * The words in one string, with any markup taken out first.
 *
 * A richtext prop holds HTML, so the tags and entities are stripped before the
 * count, or a paragraph wrapped in `<strong>` would read as more words than it
 * has. Anything that is not a string is no words at all.
 */
function countWords(value: unknown): number {
  if (typeof value !== 'string') return 0;
  const text = value.replace(/<[^>]*>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ');
  const matches = text.match(/\S+/g);
  return matches ? matches.length : 0;
}

/** Every word a block carries, its own props and any repeater items inside it. */
function wordsInBlock(block: Block): number {
  const props = block.props as Record<string, unknown>;
  let total = 0;
  for (const key of TEXT_KEYS) total += countWords(props[key]);

  // A repeater (cards, list items, steps) keeps its text on the items inside it.
  for (const value of Object.values(props)) {
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      for (const key of TEXT_KEYS) total += countWords(record[key]);
    }
  }

  return total;
}

/**
 * The whole-minute reading time of a body of sections.
 *
 * Rounded up, and never below one when there ARE words, because "0 min read" and
 * a half minute both read as broken. An empty body gets zero, which the render
 * takes as "do not show it": a "1 min read" on a post with nothing in it is a
 * small lie, and worse than saying nothing.
 */
export function readingTime(sections: readonly Section[]): number {
  let words = 0;
  for (const section of sections) {
    for (const row of section.rows) {
      for (const column of row.columns) {
        for (const block of column.blocks) {
          words += wordsInBlock(block);
        }
      }
    }
  }
  return words > 0 ? Math.max(1, Math.ceil(words / WORDS_PER_MINUTE)) : 0;
}
