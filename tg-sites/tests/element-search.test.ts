/**
 * The element groups, re-cut 21 Aug 2026, and the search that finds them.
 *
 * WHY BOTH IN ONE FILE: they are the same job. Andy asked for sensible
 * categories and a free-text search in the same breath, because the problem was
 * never where an element lived, it was that a client could not find it.
 *
 * THE SEARCH BOX ALREADY EXISTED in both pickers. It matched the label and the
 * description only, so it found nothing for the words people actually use.
 * Typing "carousel" missed the Slider. "faq" missed the Accordion. "menu"
 * missed the Nav. Every case below is one of those.
 */

import { describe, expect, it } from 'vitest';

import {
  BLOCKS,
  BLOCK_GROUPS,
  blockDefinition,
  blockMatches,
  blocksByGroup,
} from '../lib/content/blocks';

const find = (query: string) => BLOCKS.filter((b) => blockMatches(b, query)).map((b) => b.type);

describe('the nine groups', () => {
  it('has a home for every block, and no group nobody lives in', () => {
    for (const block of BLOCKS) {
      expect(BLOCK_GROUPS, `${block.type} is in "${block.group}"`).toContain(block.group);
    }
    const used = new Set(BLOCKS.map((b) => b.group));
    for (const group of BLOCK_GROUPS) expect(used, `nothing is in "${group}"`).toContain(group);
  });

  /*
   * THE SIZE IS THE POINT. The five groups this replaced had one holding
   * eighteen blocks, which is a list a client scrolls rather than reads. Any
   * group creeping past about nine is the signal to cut again, not to let it
   * grow the way Media did.
   */
  it('keeps every group scannable', () => {
    for (const { group, blocks } of blocksByGroup(true)) {
      expect(blocks.length, `"${group}" has ${blocks.length}`).toBeGreaterThanOrEqual(3);
      expect(blocks.length, `"${group}" has ${blocks.length}`).toBeLessThanOrEqual(9);
    }
  });

  it('reads in a deliberate order, most reached for first', () => {
    expect(BLOCK_GROUPS[0]).toBe('Text');
    expect(BLOCK_GROUPS[BLOCK_GROUPS.length - 1]).toBe('Advanced');
  });

  it('gives every block words to be found by', () => {
    for (const block of BLOCKS) {
      expect(block.keywords.trim(), `${block.type} has no keywords`).not.toBe('');
    }
  });
});

describe('the search finds what a client would type', () => {
  /*
   * Each of these returned NOTHING before the keywords landed. They are the
   * whole reason the field exists, so they are named one by one rather than
   * rolled into a loop: a regression here is a client not finding an element.
   */
  it.each([
    ['carousel', 'slider'],
    ['faq', 'accordion'],
    ['menu', 'nav'],
    ['hamburger', 'nav'],
    ['photo', 'image'],
    ['stars', 'rating'],
    ['youtube', 'video'],
    ['pdf', 'file'],
    ['voucher', 'coupon'],
    ['timeline', 'steps'],
    ['counters', 'stats'],
    ['dark mode', 'theme-toggle'],
    ['lightbox', 'gallery'],
    ['masonry', 'gallery'],
    ['partners', 'logos'],
    ['directions', 'map'],
    ['branches', 'locations'],
    ['cta', 'button'],
    ['wave', 'shape'],
    ['spreadsheet', 'table'],
  ])('"%s" finds %s', (query, type) => {
    expect(find(query)).toContain(type);
  });

  it('takes several words in any order', () => {
    // "flip card" and "card flip" are the same intent typed two ways.
    expect(find('flip card')).toContain('flip-cards');
    expect(find('card flip')).toContain('flip-cards');
  });

  it('narrows as a client types rather than widening', () => {
    // Every term must match, so a second word is a filter and not an "or".
    const one = find('cards');
    const two = find('cards stack');
    expect(two.length).toBeLessThan(one.length);
    expect(two).toContain('stacked-cards');
  });

  it('finds a block by the group it now sits in', () => {
    expect(find('showcase')).toContain('flip-cards');
    expect(find('navigation')).toContain('breadcrumbs');
  });

  it('finds a block by its internal name, hyphens and all', () => {
    // So an agent who knows what it is called in the JSON can still reach it.
    expect(find('read more')).toContain('read-more');
    expect(find('half overlay')).toContain('half-overlay');
  });

  it('shows everything when nothing is typed', () => {
    expect(find('')).toHaveLength(BLOCKS.length);
    expect(find('   ')).toHaveLength(BLOCKS.length);
  });

  it('finds nothing rather than guessing, when nothing matches', () => {
    /*
     * Substring, not fuzzy. A client typing three letters wants a short list
     * they can trust; a wrong-but-confident match is worse here than none.
     */
    expect(find('zzzzz')).toHaveLength(0);
  });

  it('does not care about case', () => {
    expect(find('CAROUSEL')).toContain('slider');
  });

  it('still matches the label and the description it always did', () => {
    expect(find('accordion')).toContain('accordion');
    expect(find(blockDefinition('stats')!.label.toLowerCase())).toContain('stats');
  });
});
