/**
 * Collections: the blog, and the Cards block fed from it.
 *
 * WHAT IS WORTH TESTING HERE. An entry's body is sections, rows, columns and
 * blocks exactly as a page is, and the page suite already covers all of that.
 * So this file covers the parts that are NOT a page:
 *
 *   1. The two reductions an address and a date go through, because both are
 *      about refusing input rather than accepting it, and safeDate has a bug in
 *      it the moment somebody reaches for `new Date`.
 *   2. The wrapper the editor sees, which has to round-trip and has to throw
 *      away exactly what it says it throws away.
 *   3. Resolving a listing block, which is the whole feature: one read per
 *      collection however many blocks ask, and a typed-in grid left alone.
 *   4. The query layer, and above all that the PUBLIC read has no status
 *      filter. lib/db/collections.ts says at the top that the absence is
 *      deliberate and that migration 0004 enforces it. Both halves of that
 *      claim are checked here, so neither can drift without a failure.
 *
 * The markup is checked in the browser harness rather than here: this runner
 * has no JSX, by the deliberate choice in vitest.config.ts.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  emptyItem,
  parseItem,
  safeDate,
  safeFutureTimestamp,
  safeSlug,
  safeTags,
  tagArchivePath,
  type CollectionItem,
} from '../lib/content/collection';
import { itemAsPage, itemMeta, pageAsItem } from '../lib/content/collection-page';
import { readingTime } from '../lib/content/reading-time';
import {
  LISTING_ORDERS,
  fillListings,
  fillPageListings,
  itemAsCard,
  listingIn,
  listingsIn,
  listingKey,
} from '../lib/content/listings';
import { defaultPropsFor } from '../lib/content/blocks';
import { createSection } from '../lib/content/factory';
import { sanitiseItem } from '../lib/content/sanitise-page';
import { CONTENT_VERSION, type Page, type Section } from '../lib/content/schema';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * A one-column section holding whatever blocks a test wants in it.
 *
 * Built from the real factory rather than written out by hand, so a field added
 * to a Section shows up here on the next typecheck instead of leaving a literal
 * that quietly stops matching what the parser expects.
 */
function section(blocks: Array<Record<string, unknown>>): Section {
  const base = createSection('1');
  return {
    ...base,
    rows: [
      {
        ...base.rows[0],
        columns: [{ ...base.rows[0].columns[0], blocks: blocks as never }],
      },
    ],
  };
}

function listingBlock(props: Record<string, unknown>) {
  return { id: 'b1', type: 'cards', props: { ...defaultPropsFor('cards'), ...props } };
}

function item(overrides: Partial<CollectionItem> = {}): CollectionItem {
  return { ...emptyItem(), title: 'Ten things in Crete', ...overrides };
}

// ---------------------------------------------------------------------------
// The address
// ---------------------------------------------------------------------------

describe('safeSlug', () => {
  it('lowercases and joins words with a single hyphen', () => {
    expect(safeSlug('Ten Things To Do In Crete')).toBe('ten-things-to-do-in-crete');
  });

  it('collapses a run of punctuation rather than leaving a row of hyphens', () => {
    expect(safeSlug('Crete: sun, sea &  sand!!')).toBe('crete-sun-sea-sand');
  });

  it('has no hyphen at either end', () => {
    expect(safeSlug('  ...Crete...  ')).toBe('crete');
  });

  it('keeps digits, because a year in a title is part of the address', () => {
    expect(safeSlug('Best of 2026')).toBe('best-of-2026');
  });

  /*
   * The column is `text` with no length limit, so this is not the database
   * protecting itself. It is an address: 120 characters is already far past
   * anything anybody would type, and a title pasted from a document should not
   * become a URL nothing can display.
   */
  it('stops at 120 characters', () => {
    expect(safeSlug('a'.repeat(400))).toHaveLength(120);
  });

  it('answers with nothing for anything that is not a string', () => {
    for (const value of [null, undefined, 42, {}, []]) {
      expect(safeSlug(value)).toBe('');
    }
  });

  it('answers with nothing when there was nothing usable in it', () => {
    expect(safeSlug('。。。')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// The date
// ---------------------------------------------------------------------------

describe('safeDate', () => {
  it('keeps a plain date exactly as it was typed', () => {
    expect(safeDate('2026-08-03')).toBe('2026-08-03');
  });

  /*
   * THE ONE THAT MATTERS. A post dated the 3rd of August is dated the 3rd of
   * August everywhere. Parsing it into a Date is what turns it into UTC
   * midnight, which formats as the 2nd anywhere west of Greenwich. This asserts
   * the string survives untouched rather than being round-tripped through an
   * instant, which is the only way it can be wrong.
   */
  it('is a date rather than an instant, so nowhere sees the day before', () => {
    expect(safeDate('2026-01-01')).toBe('2026-01-01');
    expect(safeDate('2026-12-31')).toBe('2026-12-31');
  });

  it('drops a time somebody pasted in with it', () => {
    expect(safeDate('2026-08-03T14:30:00.000Z')).toBe('2026-08-03');
  });

  it('refuses a month or a day that cannot exist', () => {
    expect(safeDate('2026-13-01')).toBe('');
    expect(safeDate('2026-00-01')).toBe('');
    expect(safeDate('2026-08-32')).toBe('');
    expect(safeDate('2026-08-00')).toBe('');
  });

  it('refuses a year outside the range a travel company writes in', () => {
    expect(safeDate('1899-08-03')).toBe('');
    expect(safeDate('2201-08-03')).toBe('');
    expect(safeDate('1900-01-01')).toBe('1900-01-01');
    expect(safeDate('2200-12-31')).toBe('2200-12-31');
  });

  it('refuses a different order, rather than guessing which is the day', () => {
    expect(safeDate('03/08/2026')).toBe('');
    expect(safeDate('3 August 2026')).toBe('');
  });

  it('answers with nothing for anything that is not a string', () => {
    for (const value of [null, undefined, 20260803, new Date(), {}]) {
      expect(safeDate(value)).toBe('');
    }
  });
});

// ---------------------------------------------------------------------------
// The scheduled go-live time
// ---------------------------------------------------------------------------

describe('safeFutureTimestamp', () => {
  it('keeps an instant that is still ahead, as a normalised ISO string', () => {
    const soon = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    expect(safeFutureTimestamp(soon)).toBe(soon);
  });

  /*
   * The opposite of safeDate, on purpose. This is a full instant the browser has
   * already resolved to UTC, so it goes through Date and comes back canonical: a
   * +00:00 offset returns as its Z form, which is the same moment written the one
   * way the column will hold it.
   */
  it('resolves an offset to UTC, so the stored instant is unambiguous', () => {
    const ahead = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const asOffset = ahead.toISOString().replace('Z', '+00:00');
    expect(safeFutureTimestamp(asOffset)).toBe(ahead.toISOString());
  });

  it('refuses a moment already gone, because that is a publish not a schedule', () => {
    const past = new Date(Date.now() - 60 * 1000).toISOString();
    expect(safeFutureTimestamp(past)).toBeNull();
  });

  it('refuses now itself, so the gate is strictly in the future', () => {
    expect(safeFutureTimestamp(new Date(Date.now() - 1).toISOString())).toBeNull();
  });

  it('refuses anything that will not parse', () => {
    expect(safeFutureTimestamp('next Friday')).toBeNull();
    expect(safeFutureTimestamp('')).toBeNull();
  });

  it('answers with null for anything that is not a string', () => {
    for (const value of [null, undefined, 20260803, new Date(), {}]) {
      expect(safeFutureTimestamp(value)).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// The tags
// ---------------------------------------------------------------------------

describe('safeTags', () => {
  it('keeps a plain list of labels, their spelling and spaces intact', () => {
    expect(safeTags(['Crete', 'Family holidays'])).toEqual(['Crete', 'Family holidays']);
  });

  it('trims each label and collapses the whitespace inside it', () => {
    expect(safeTags(['  Crete  ', 'Family   holidays'])).toEqual(['Crete', 'Family holidays']);
  });

  it('drops the blanks rather than filing an empty tag', () => {
    expect(safeTags(['Crete', '', '   ', 'Rhodes'])).toEqual(['Crete', 'Rhodes']);
  });

  it('is a set, deduped without regard to case, keeping the first spelling', () => {
    expect(safeTags(['Crete', 'crete', 'CRETE', 'Rhodes'])).toEqual(['Crete', 'Rhodes']);
  });

  it('caps each label, so a paragraph pasted in becomes a label not an essay', () => {
    const [only] = safeTags(['a'.repeat(200)]);
    expect(only).toHaveLength(40);
  });

  it('caps the count, so a post cannot carry a filing cabinet', () => {
    const many = Array.from({ length: 30 }, (_, index) => `tag ${index}`);
    expect(safeTags(many)).toHaveLength(12);
  });

  it('skips anything in the list that is not a string', () => {
    expect(safeTags(['Crete', 42, null, {}, 'Rhodes'] as unknown[])).toEqual(['Crete', 'Rhodes']);
  });

  it('answers with an empty list for anything that is not an array', () => {
    for (const value of [null, undefined, 'Crete', 42, {}]) {
      expect(safeTags(value)).toEqual([]);
    }
  });
});

describe('tagArchivePath', () => {
  it('is the collection key, then tag, then the tag reduced to a slug', () => {
    expect(tagArchivePath('blog', 'Crete')).toBe('/blog/tag/crete');
    expect(tagArchivePath('blog', 'Family holidays')).toBe('/blog/tag/family-holidays');
  });

  it('agrees with the address a listing filter resolves, so the link never 404s', () => {
    // Whatever spelling a post uses, the link and the archive slug come from the
    // same safeSlug, so a tag and its archive can never disagree.
    expect(tagArchivePath('guides', 'Sun, Sea & Sand')).toBe('/guides/tag/sun-sea-sand');
  });
});

describe('readingTime', () => {
  const words = (count: number) => Array.from({ length: count }, (_, i) => `word${i}`).join(' ');
  const body = (html: string) => [section([{ id: 'b1', type: 'text', props: { html } }])];

  it('is zero for an empty body, which the render takes as "show nothing"', () => {
    expect(readingTime([])).toBe(0);
  });

  it('is never below one when there are words, however few', () => {
    expect(readingTime(body(`<p>${words(10)}</p>`))).toBe(1);
  });

  it('is words over 200 a minute, rounded up', () => {
    // 450 words is 2.25 minutes, which rounds to 3.
    expect(readingTime(body(`<p>${words(450)}</p>`))).toBe(3);
  });

  it('strips the markup before counting, so a bold word is still one word', () => {
    expect(readingTime(body('<p><strong>Crete</strong> is <em>lovely</em></p>'))).toBe(1);
  });

  it('counts the words inside a repeater, not only the block props', () => {
    const cards = section([
      { id: 'b1', type: 'cards', props: { items: [{ title: words(300) }, { title: words(300) }] } },
    ]);
    // 600 words across the two card titles is exactly three minutes.
    expect(readingTime([cards])).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Parsing an item
// ---------------------------------------------------------------------------

describe('parseItem', () => {
  it('fills in everything a half-written record is missing', () => {
    const parsed = parseItem({ title: 'Crete' });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.item).toEqual({
      version: 1,
      title: 'Crete',
      summary: '',
      image: '',
      alt: '',
      author: '',
      date: '',
      tags: [],
      fields: {},
      sections: [],
    });
  });

  it('reduces a bad date to nothing rather than refusing the whole item', () => {
    const parsed = parseItem({ title: 'Crete', date: 'sometime in August' });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.item.date).toBe('');
  });

  it('cleans the tags on the way in, the same as everywhere else they arrive', () => {
    const parsed = parseItem({ title: 'Crete', tags: ['  Crete  ', 'crete', 'Beaches'] });
    expect(parsed.ok).toBe(true);
    // Trimmed, then deduped without regard to case, so the second Crete is gone.
    if (parsed.ok) expect(parsed.item.tags).toEqual(['Crete', 'Beaches']);
  });

  it('makes tags an empty list when a stored row has none', () => {
    const parsed = parseItem({ title: 'Crete' });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.item.tags).toEqual([]);
  });

  it('carries the author through, and defaults it to nothing', () => {
    const withAuthor = parseItem({ title: 'Crete', author: 'Jane Doe' });
    expect(withAuthor.ok && withAuthor.item.author).toBe('Jane Doe');
    const without = parseItem({ title: 'Crete' });
    expect(without.ok && without.item.author).toBe('');
  });

  /*
   * The seam worth checking. An item's body is repaired and upgraded by the
   * SAME code a page's is, because preNormalise keys off the `sections` array
   * rather than off anything page-shaped. Column widths that do not add up to
   * twelve are the visible symptom of that shared code running.
   */
  it('repairs an item body with the same normalising a page gets', () => {
    const parsed = parseItem({
      title: 'Crete',
      sections: [
        {
          id: 's1',
          rows: [
            {
              id: 'r1',
              columns: [
                { id: 'c1', width: 99, blocks: [] },
                { id: 'c2', width: 99, blocks: [] },
              ],
            },
          ],
        },
      ],
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    // Percentages of the row, so a repaired pair adds up to 100 and neither
    // of the two 99s survives.
    const widths = parsed.item.sections[0].rows[0].columns.map((column) => column.width);
    expect(widths.reduce((total, width) => total + width, 0)).toBe(100);
    expect(widths).toEqual([50, 50]);
  });

  it('refuses nothing at all, and says why', () => {
    const parsed = parseItem({ title: 'x'.repeat(500) });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors.join(' ')).toContain('title');
  });

  it('starts empty at version 1 with no body', () => {
    expect(emptyItem()).toEqual({
      version: 1,
      title: '',
      summary: '',
      image: '',
      alt: '',
      author: '',
      date: '',
      tags: [],
      fields: {},
      sections: [],
    });
  });
});

// ---------------------------------------------------------------------------
// The wrapper the editor sees
// ---------------------------------------------------------------------------

describe('an item as the editor sees it', () => {
  it('carries the body through as the page sections', () => {
    const body = [section([{ id: 'b1', type: 'text', props: { html: '<p>Hi</p>' } }])];
    const page = itemAsPage(item({ sections: body }), 'item-1', 'ten-things-in-crete');

    expect(page.version).toBe(CONTENT_VERSION);
    expect(page.sections).toEqual(body);
    expect(page.title).toBe('Ten things in Crete');
    expect(page.slug).toBe('ten-things-in-crete');
  });

  /*
   * PageSchema wants a title of at least one character, so an entry saved with
   * an empty one would make a Page the editor could not then save back. The
   * fallback is not cosmetic.
   */
  it('never hands the editor a page with no title', () => {
    expect(itemAsPage(item({ title: '' }), 'item-1', 'untitled').title).toBe('Untitled');
  });

  it('is the real item id, because the save needs it', () => {
    expect(itemAsPage(item(), 'item-1', 'x').id).toBe('item-1');
  });

  it('separates the fields that are not sections', () => {
    const meta = itemMeta(
      item({ summary: 'A week of it', image: 'media-1', alt: 'A beach', date: '2026-08-03' }),
      'ten-things-in-crete',
    );

    expect(meta).toEqual({
      title: 'Ten things in Crete',
      summary: 'A week of it',
      image: 'media-1',
      alt: 'A beach',
      author: '',
      date: '2026-08-03',
      tags: [],
      fields: {},
      slug: 'ten-things-in-crete',
    });
  });

  it('takes the title from the page, because that is the box somebody types in', () => {
    const meta = itemMeta(item(), 'x');
    const page = { ...itemAsPage(item(), 'item-1', 'x'), title: 'Renamed in the top bar' };

    expect(pageAsItem(page as Page, meta).title).toBe('Renamed in the top bar');
  });

  it('takes everything else from the meta, because a page has nowhere to put it', () => {
    const meta = itemMeta(
      item({ summary: 'A week of it', image: 'media-1', alt: 'A beach', date: '2026-08-03' }),
      'x',
    );
    const back = pageAsItem(itemAsPage(item(), 'item-1', 'x'), meta);

    expect(back.summary).toBe('A week of it');
    expect(back.image).toBe('media-1');
    expect(back.date).toBe('2026-08-03');
  });

  it('carries the tags out to the meta and back, since a page cannot hold them', () => {
    const original = item({ tags: ['Crete', 'Beaches'] });
    const meta = itemMeta(original, 'x');
    expect(meta.tags).toEqual(['Crete', 'Beaches']);

    const back = pageAsItem(itemAsPage(original, 'item-1', 'x'), meta);
    expect(back.tags).toEqual(['Crete', 'Beaches']);
  });

  it('carries the author out to the meta and back, beside the tags', () => {
    const original = item({ author: 'Jane Doe' });
    expect(itemMeta(original, 'x').author).toBe('Jane Doe');
    expect(pageAsItem(itemAsPage(original, 'item-1', 'x'), itemMeta(original, 'x')).author).toBe(
      'Jane Doe',
    );
  });

  it('round-trips an item through the editor without changing it', () => {
    const original = item({
      summary: 'A week of it',
      image: 'media-1',
      alt: 'A beach',
      date: '2026-08-03',
      sections: [section([{ id: 'b1', type: 'text', props: { html: '<p>Hi</p>' } }])],
    });

    const page = itemAsPage(original, 'item-1', 'ten-things-in-crete');
    expect(pageAsItem(page, itemMeta(original, 'ten-things-in-crete'))).toEqual(original);
  });

  /*
   * A Page has SEO and a slug. An item has neither: its summary IS the search
   * description and its address is a column. If either started coming back
   * through this seam it would be stored in the jsonb and then silently ignored,
   * which is worse than not being stored at all.
   */
  it('throws away the page fields an item has no room for', () => {
    const page = {
      ...itemAsPage(item(), 'item-1', 'x'),
      seo: { title: 'Ignored', description: 'Ignored', noindex: true },
      slug: 'ignored',
    };

    const back = pageAsItem(page as Page, itemMeta(item(), 'x')) as Record<string, unknown>;
    expect(back.seo).toBeUndefined();
    expect(back.slug).toBeUndefined();
    expect(Object.keys(back).sort()).toEqual(
      ['alt', 'author', 'date', 'fields', 'image', 'sections', 'summary', 'tags', 'title', 'version'],
    );
  });
});

// ---------------------------------------------------------------------------
// Resolving a listing
// ---------------------------------------------------------------------------

describe('which blocks want a collection', () => {
  it('leaves a grid somebody typed into alone', () => {
    expect(listingIn(listingBlock({}))).toBeNull();
    expect(listingIn(listingBlock({ source: 'typed', collection: 'blog' }))).toBeNull();
  });

  it('is not a listing until a collection is actually named', () => {
    expect(listingIn(listingBlock({ source: 'collection' }))).toBeNull();
    expect(listingIn(listingBlock({ source: 'collection', collection: '   ' }))).toBeNull();
  });

  it('ignores every other kind of block', () => {
    expect(listingIn({ type: 'text', props: { source: 'collection', collection: 'blog' } })).toBeNull();
  });

  it('reads the collection and how many were asked for', () => {
    expect(listingIn(listingBlock({ source: 'collection', collection: 'blog', count: 3 })))
      // Two facts unless the block says otherwise: see DEFAULT_FACTS.
      .toEqual({ collection: 'blog', count: 3, facts: 2, order: 'newest' as const, filter: null, sort: null });
  });

  /*
   * min and max on a number input are advisory: the browser marks the field
   * invalid and hands the value over anyway. So the clamp has to be here as
   * well, on the road between a saved block and a query with a LIMIT in it.
   */
  it('clamps a count that came in out of range', () => {
    expect(listingIn(listingBlock({ source: 'collection', collection: 'blog', count: 5000 })!)!.count)
      .toBe(60);
    expect(listingIn(listingBlock({ source: 'collection', collection: 'blog', count: 0 })!)!.count)
      .toBe(1);
    expect(listingIn(listingBlock({ source: 'collection', collection: 'blog', count: -8 })!)!.count)
      .toBe(1);
  });

  it('rounds a fractional count rather than passing it to a LIMIT', () => {
    expect(listingIn(listingBlock({ source: 'collection', collection: 'blog', count: 3.7 })!)!.count)
      .toBe(4);
  });

  it('falls back to six when the count is not a number at all', () => {
    expect(listingIn(listingBlock({ source: 'collection', collection: 'blog', count: 'lots' })!)!.count)
      .toBe(6);
  });

  it('trims the collection name, because a trailing space is invisible', () => {
    expect(listingIn(listingBlock({ source: 'collection', collection: ' blog ' })!)!.collection)
      .toBe('blog');
  });
});

describe('what a whole set of trees wants', () => {
  const tree = (blocks: Array<Record<string, unknown>>) => ({ sections: [section(blocks)] });

  it('asks for nothing when nothing is fed from a collection', () => {
    expect(listingsIn([tree([listingBlock({})])])).toEqual([]);
  });

  it('walks the header, the page and the footer', () => {
    const wanted = listingsIn([
      tree([listingBlock({ source: 'collection', collection: 'news', count: 2 })]),
      tree([listingBlock({ source: 'collection', collection: 'blog', count: 3 })]),
      tree([listingBlock({ source: 'collection', collection: 'jobs', count: 4 })]),
    ]);

    expect(wanted.map((request) => request.collection).sort()).toEqual(['blog', 'jobs', 'news']);
  });

  it('survives a site with no header or footer published', () => {
    expect(listingsIn([null, tree([listingBlock({ source: 'collection', collection: 'blog' })]), undefined]))
      .toEqual([{ collection: 'blog', count: 6, facts: 2, order: 'newest' as const, filter: null, sort: null }]);
  });

  /*
   * The point of collecting them first. Three blocks showing the same posts is
   * ONE query for the largest of the three, not three queries a visitor waits
   * on in turn.
   */
  it('asks once per collection, for the most anybody wanted', () => {
    const wanted = listingsIn([
      tree([
        listingBlock({ source: 'collection', collection: 'blog', count: 3 }),
        listingBlock({ source: 'collection', collection: 'blog', count: 9 }),
        listingBlock({ source: 'collection', collection: 'blog', count: 6 }),
      ]),
    ]);

    expect(wanted).toEqual([{ collection: 'blog', count: 9, facts: 2, order: 'newest' as const, filter: null, sort: null }]);
  });
});

describe('an item as a card', () => {
  const card = itemAsCard(
    item({ summary: 'A week of it', image: 'media-1', alt: 'A beach', date: '2026-08-03' }),
    'blog',
    'ten-things-in-crete',
  );

  it('puts the date in the small label above the title', () => {
    expect(card.label).toBe('2026-08-03');
    expect(card.title).toBe('Ten things in Crete');
    expect(card.body).toBe('A week of it');
  });

  it('carries the picture and its description together', () => {
    expect(card.src).toBe('media-1');
    expect(card.alt).toBe('A beach');
  });

  it('links to the entry at the collection key and its own address', () => {
    expect(card.linkHref).toBe('/blog/ten-things-in-crete');
  });

  it('has no label at all when the entry carries no date', () => {
    expect(itemAsCard(item(), 'blog', 'x').label).toBe('');
  });

  it('carries the post tags for the card to show', () => {
    expect(itemAsCard(item({ tags: ['Crete', 'Beaches'] }), 'blog', 'x').tags).toEqual([
      'Crete',
      'Beaches',
    ]);
  });

  it('carries an empty tag list when the post has none', () => {
    expect(itemAsCard(item(), 'blog', 'x').tags).toEqual([]);
  });

  it('carries the author for the card byline', () => {
    expect(itemAsCard(item({ author: 'Jane Doe' }), 'blog', 'x').author).toBe('Jane Doe');
  });

  it('works out the card reading time from the body', () => {
    const withBody = item({
      sections: [section([{ id: 'b1', type: 'text', props: { html: `<p>${'word '.repeat(450)}</p>` } }])],
    });
    // 450 words is 2.25 minutes, rounded up to 3.
    expect(itemAsCard(withBody, 'blog', 'x').readingMinutes).toBe(3);
  });
});

describe('filling the listings in', () => {
  /*
   * KEYED BY THE WHOLE REQUEST, not by the collection's name. Two blocks
   * narrowing one collection differently are two different answers, so the key
   * carries the filter and the sort as well (#238, listingKey).
   */
  const plain = (collection: string) =>
    listingKey({ collection, count: 0, facts: 0, order: 'newest', filter: null, sort: null });

  const data = new Map([
    [plain('blog'), [{ title: 'One' }, { title: 'Two' }, { title: 'Three' }]],
  ]);

  it('hands back the very same tree when there is nothing to fill', () => {
    const tree = { sections: [section([listingBlock({})])] };
    expect(fillListings(tree, new Map())).toBe(tree);
  });

  it('hands back the very same tree when no block wants what was read', () => {
    const tree = { sections: [section([listingBlock({ source: 'collection', collection: 'jobs' })])] };
    expect(fillListings(tree, data)).toBe(tree);
  });

  it('puts the items where the grid already knows how to draw them', () => {
    const tree = {
      sections: [section([listingBlock({ source: 'collection', collection: 'blog', count: 6 })])],
    };
    const filled = fillListings(tree, data);

    const props = filled.sections[0].rows[0].columns[0].blocks[0].props as Record<string, unknown>;
    expect(props.items).toEqual([{ title: 'One' }, { title: 'Two' }, { title: 'Three' }]);
  });

  /*
   * One read serves every block that asked, for the largest count. A block that
   * asked for two must still show two, not the nine the block beside it wanted.
   */
  it('gives each block only as many as it asked for', () => {
    const tree = {
      sections: [
        section([
          listingBlock({ source: 'collection', collection: 'blog', count: 2 }),
          listingBlock({ source: 'collection', collection: 'blog', count: 9 }),
        ]),
      ],
    };
    const filled = fillListings(tree, data);
    const blocks = filled.sections[0].rows[0].columns[0].blocks;

    expect((blocks[0].props as Record<string, unknown>).items).toHaveLength(2);
    expect((blocks[1].props as Record<string, unknown>).items).toHaveLength(3);
  });

  it('does not touch the cards somebody typed in beside it', () => {
    const typed = listingBlock({});
    const tree = {
      sections: [
        section([typed, listingBlock({ source: 'collection', collection: 'blog' })]),
      ],
    };
    const filled = fillListings(tree, data);
    const blocks = filled.sections[0].rows[0].columns[0].blocks;

    expect((blocks[0].props as Record<string, unknown>).items)
      .toEqual((typed.props as Record<string, unknown>).items);
  });

  it('leaves the original tree alone rather than filling it in place', () => {
    const tree = {
      sections: [section([listingBlock({ source: 'collection', collection: 'blog' })])],
    };
    const before = JSON.stringify(tree);
    fillListings(tree, data);
    expect(JSON.stringify(tree)).toBe(before);
  });

  it('empties a grid whose collection has nothing published in it', () => {
    const tree = {
      sections: [section([listingBlock({ source: 'collection', collection: 'blog' })])],
    };
    const filled = fillListings(tree, new Map([[plain('blog'), []]]));

    expect((filled.sections[0].rows[0].columns[0].blocks[0].props as Record<string, unknown>).items)
      .toEqual([]);
  });

  it('keeps a page a page', () => {
    const page = {
      version: CONTENT_VERSION,
      id: 'p1',
      title: 'Home',
      slug: '',
      seo: { noindex: false },
      sections: [section([listingBlock({ source: 'collection', collection: 'blog' })])],
    } as Page;

    const filled = fillPageListings(page, data);
    expect(filled.title).toBe('Home');
    expect(filled.slug).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Sanitising
// ---------------------------------------------------------------------------

describe('sanitising an item', () => {
  it('drops a javascript: URL from the picture at the top', () => {
    // eslint-disable-next-line no-script-url
    expect(sanitiseItem(item({ image: 'javascript:alert(1)' })).image).toBe('');
  });

  it('reaches into the body, which is the bigger surface', () => {
    const clean = sanitiseItem(
      item({
        sections: [
          section([
            { id: 'b1', type: 'text', props: { html: '<p onclick="steal()">Hi</p><script>x</script>' } },
          ]),
        ],
      }),
    );

    const html = String(
      (clean.sections[0].rows[0].columns[0].blocks[0].props as Record<string, unknown>).html,
    );
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('<script');
  });

  it('keeps a real image URL', () => {
    expect(sanitiseItem(item({ image: 'https://example.com/beach.jpg' })).image)
      .toBe('https://example.com/beach.jpg');
  });
});

// ---------------------------------------------------------------------------
// The query layer, against a fake driver. Same shape as tests/db.test.ts.
// ---------------------------------------------------------------------------

interface Statement {
  role: string;
  sql: string;
  params: unknown[];
}

let log: Statement[] = [];
let responses: Array<{ match: string; rows: Record<string, unknown>[] }> = [];

function respond(match: string, rows: Record<string, unknown>[]): void {
  responses.push({ match, rows });
}

function fakeSql(role: string) {
  function query(
    strings: TemplateStringsArray | string,
    ...args: unknown[]
  ): Promise<Record<string, unknown>[]> {
    const text = typeof strings === 'string'
      ? strings
      : strings.raw.join(' ? ').replace(/\s+/g, ' ').trim();

    log.push({ role, sql: text, params: args });

    const index = responses.findIndex((r) => text.includes(r.match));
    if (index === -1) return Promise.resolve([]);
    return Promise.resolve(responses.splice(index, 1)[0].rows);
  }

  const sql = query as unknown as Record<string, unknown> & typeof query;
  sql.json = (value: unknown) => ({ __json: value });
  sql.begin = async (fn: (tx: unknown) => Promise<unknown>) => {
    log.push({ role, sql: 'BEGIN', params: [] });
    try {
      const result = await fn(sql);
      log.push({ role, sql: 'COMMIT', params: [] });
      return result;
    } catch (error) {
      log.push({ role, sql: 'ROLLBACK', params: [] });
      throw error;
    }
  };

  return sql;
}

vi.mock('../lib/db/client', () => ({
  db: (role: string) => fakeSql(role),
  usernameFrom: () => null,
}));

const ALPHA = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  log = [];
  responses = [];
});

/** The JSON a write handed the driver, unwrapped from the fake's marker. */
function writtenJson(statement: Statement): unknown {
  const wrapped = statement.params.find(
    (param): param is { __json: unknown } =>
      !!param && typeof param === 'object' && '__json' in param,
  );
  return wrapped?.__json;
}

/** The statement that actually touched the table, not the column fragment. */
function itemQuery(): Statement {
  return log.find((s) => s.sql.includes('public.collection_items') && s.sql.includes('?'))!;
}

describe('reading published entries', () => {
  /*
   * THE ONE THAT MATTERS MOST, and the reason this file exists at all.
   *
   * lib/db/collections.ts has no `where status = 'published'` in its public
   * queries, on the grounds that migration 0004 already enforces it in a policy
   * and a WHERE clause here would make that guarantee harder to see. That is a
   * real claim about two files at once, so both halves are asserted: the query
   * has no filter, and the policy has one.
   */
  it('never filters on status itself', async () => {
    const { listPublished } = await import('../lib/db/collections');

    respond('from public.collection_items', []);
    await listPublished(ALPHA, 'blog', 6);

    const read = itemQuery();
    expect(read.sql).not.toContain('status');
  });

  it('and the policy that makes that safe is still in the migration', () => {
    const sql = readFileSync(
      join(__dirname, '..', 'db', 'migrations', '0004_future_tables.sql'),
      'utf8',
    );

    const policy = sql.slice(sql.indexOf('create policy collection_items_renderer'));
    expect(policy).toContain('to tg_sites_renderer');
    expect(policy.slice(0, policy.indexOf(';'))).toContain("status = 'published'");
  });

  it('reads as the READ-ONLY role, never as the app role', async () => {
    const { listPublished, getPublishedItem } = await import('../lib/db/collections');

    await listPublished(ALPHA, 'blog', 6);
    await getPublishedItem(ALPHA, 'blog', 'ten-things');

    for (const statement of log.filter((s) => s.sql.includes('public.collection_items'))) {
      expect(statement.role).toBe('renderer');
    }
  });

  it('caps the limit however large a saved block asked for', async () => {
    const { listPublished } = await import('../lib/db/collections');

    await listPublished(ALPHA, 'blog', 100_000);
    expect(itemQuery().params).toContain(60);
  });

  it('asks for at least one, whatever arrives', async () => {
    const { listPublished } = await import('../lib/db/collections');

    await listPublished(ALPHA, 'blog', 0);
    expect(itemQuery().params).toContain(1);

    log = [];
    await listPublished(ALPHA, 'blog', Number.NaN);
    expect(itemQuery().params).toContain(1);
  });

  it('newest first, because that is what a blog listing means', async () => {
    const { listPublished } = await import('../lib/db/collections');

    await listPublished(ALPHA, 'blog', 6);
    expect(itemQuery().sql).toContain('order by i.published_at desc');
  });

  it('finds the collection by its short name rather than by an id', async () => {
    const { listPublished } = await import('../lib/db/collections');

    await listPublished(ALPHA, 'blog', 6);
    expect(itemQuery().params).toContain('blog');
  });

  it('parses what came back, so a bad row is an error rather than a broken page', async () => {
    const { listPublished } = await import('../lib/db/collections');

    respond('from public.collection_items', [
      { slug: 'ten-things', data: { version: 1, title: 'x'.repeat(500) }, published_at: null },
    ]);

    await expect(listPublished(ALPHA, 'blog', 6)).rejects.toThrow(/will not parse/);
  });

  it('unwraps a row that was stored as a string of JSON', async () => {
    const { listPublished } = await import('../lib/db/collections');

    respond('from public.collection_items', [
      {
        slug: 'ten-things',
        data: JSON.stringify({ version: 1, title: 'Ten things' }),
        published_at: '2026-08-03T09:00:00Z',
      },
    ]);

    const { items } = await listPublished(ALPHA, 'blog', 6);
    expect(items[0].item.title).toBe('Ten things');
    expect(items[0].slug).toBe('ten-things');
  });

  /*
   * NARROWING A LISTING (#238). The engine is proved in
   * tests/collection-filter.test.ts; these prove the query layer actually asks
   * it, and that the cost control holds.
   */
  const TOURS = [
    { key: 'board', label: 'Board basis', kind: 'choice', choices: ['Half board', 'Full board'] },
    { key: 'price', label: 'Price from', kind: 'price' },
  ];

  const tourRow = (slug: string, title: string, fields: Record<string, unknown>) => ({
    slug,
    data: { version: 1, title, fields },
    published_at: '2026-08-03T09:00:00Z',
    fields: TOURS,
  });

  it('narrows a listing to the items that answer the filter', async () => {
    const { listPublished } = await import('../lib/db/collections');

    respond('from public.collection_items', [
      tourRow('a', 'Half board tour', { board: 'Half board', price: 1299 }),
      tourRow('b', 'Full board tour', { board: 'Full board', price: 1899 }),
      tourRow('c', 'Another half', { board: 'Half board', price: 999 }),
    ]);

    const { items } = await listPublished(ALPHA, 'tours', 6, {
      filter: { field: 'board', op: 'is', value: 'Half board' },
    });

    expect(items.map((row) => row.slug)).toEqual(['a', 'c']);
  });

  it('orders a listing by a declared field', async () => {
    const { listPublished } = await import('../lib/db/collections');

    respond('from public.collection_items', [
      tourRow('a', 'Dearest', { price: 1899 }),
      tourRow('b', 'Cheapest', { price: 999 }),
      tourRow('c', 'Middle', { price: 1299 }),
    ]);

    const { items } = await listPublished(ALPHA, 'tours', 6, {
      sort: { field: 'price', dir: 'asc' },
    });

    expect(items.map((row) => row.slug)).toEqual(['b', 'c', 'a']);
  });

  it('reads a filter naming a field the collection dropped as NO filter', async () => {
    /*
     * What a rename leaves behind. A page showing everything is a far better
     * failure than a page showing nothing with no clue why.
     */
    const { listPublished } = await import('../lib/db/collections');

    respond('from public.collection_items', [
      tourRow('a', 'One', { board: 'Half board' }),
      tourRow('b', 'Two', { board: 'Full board' }),
    ]);

    const { items } = await listPublished(ALPHA, 'tours', 6, {
      filter: { field: 'gone', op: 'is', value: 'x' },
    });

    expect(items).toHaveLength(2);
  });

  it('keeps its LIMIT when nothing is narrowed, and drops it only when something is', async () => {
    /*
     * THE COST CONTROL. Narrowing must happen before the cap or the answer is
     * wrong, so a narrowed listing reads the collection. A plain one must not:
     * the overwhelming majority of listings are plain, and this is what stops
     * every blog grid on every site turning into a full table read.
     */
    const { listPublished } = await import('../lib/db/collections');

    respond('from public.collection_items', [tourRow('a', 'One', {})]);
    await listPublished(ALPHA, 'tours', 6);
    expect(itemQuery().sql).toContain('limit');

    log = [];
    respond('from public.collection_items', [tourRow('a', 'One', { board: 'Half board' })]);
    await listPublished(ALPHA, 'tours', 6, {
      filter: { field: 'board', op: 'is', value: 'Half board' },
    });
    expect(itemQuery().sql).not.toContain('limit');
  });

  it('answers with nothing for an entry that is not there', async () => {
    const { getPublishedItem } = await import('../lib/db/collections');
    expect(await getPublishedItem(ALPHA, 'blog', 'never-written')).toBeNull();
  });

  it('needs both the collection and the address to match', async () => {
    const { getPublishedItem } = await import('../lib/db/collections');

    await getPublishedItem(ALPHA, 'blog', 'ten-things');
    expect(itemQuery().params).toEqual(expect.arrayContaining(['blog', 'ten-things']));
  });
});

describe('reading a tag archive', () => {
  const post = (title: string, tags: string[]) => ({
    slug: safeSlug(title),
    data: { version: 1, title, tags },
    published_at: '2026-08-03T09:00:00Z',
  });

  it('keeps only the posts carrying the tag, matched by its slug', async () => {
    const { listPublishedByTag } = await import('../lib/db/collections');

    respond('from public.collection_items', [
      post('Crete in autumn', ['Crete', 'Autumn']),
      post('A week in Rhodes', ['Rhodes']),
      // A different spelling of the same tag still matches, because the slug is
      // what the URL carries.
      post('Family time in Crete', ['Family holidays', 'crete']),
    ]);

    const archive = await listPublishedByTag(ALPHA, 'blog', 'crete', 20);
    expect(archive?.items.map((row) => row.item.title)).toEqual([
      'Crete in autumn',
      'Family time in Crete',
    ]);
  });

  it('titles the archive with the client spelling, from the first match', async () => {
    const { listPublishedByTag } = await import('../lib/db/collections');

    respond('from public.collection_items', [
      post('Crete in autumn', ['Crete']),
      post('More Crete', ['crete']),
    ]);

    expect((await listPublishedByTag(ALPHA, 'blog', 'crete', 20))?.label).toBe('Crete');
  });

  it('is null when nothing carries the tag, which the route turns into a 404', async () => {
    const { listPublishedByTag } = await import('../lib/db/collections');

    respond('from public.collection_items', [post('A week in Rhodes', ['Rhodes'])]);
    expect(await listPublishedByTag(ALPHA, 'blog', 'crete', 20)).toBeNull();
  });

  it('reads as the renderer role and never filters on status itself', async () => {
    const { listPublishedByTag } = await import('../lib/db/collections');

    respond('from public.collection_items', [post('Crete', ['Crete'])]);
    await listPublishedByTag(ALPHA, 'blog', 'crete', 20);

    const read = itemQuery();
    expect(read.role).toBe('renderer');
    expect(read.sql).not.toContain('status');
  });
});

describe('writing entries', () => {
  it('sanitises before the bytes reach the database, not after', async () => {
    const { saveItem } = await import('../lib/db/collections');

    respond('update public.collection_items', [
      { id: 'i1', collection_id: 'c1', slug: 'ten-things', status: 'draft', updated_at: '2026-08-03T09:00:00Z' },
    ]);

    await saveItem(
      ALPHA,
      'i1',
      {
        version: 1,
        title: 'Ten things',
        // eslint-disable-next-line no-script-url
        image: 'javascript:alert(1)',
        sections: [
          section([{ id: 'b1', type: 'text', props: { html: '<p onclick="steal()">Hi</p>' } }]),
        ],
      },
      'ten-things',
    );

    const write = log.find((s) => s.sql.includes('update public.collection_items'))!;
    const stored = JSON.stringify(writtenJson(write));
    expect(stored).not.toContain('javascript:');
    expect(stored).not.toContain('onclick');
  });

  it('refuses to store something that will not parse', async () => {
    const { saveItem } = await import('../lib/db/collections');

    await expect(saveItem(ALPHA, 'i1', { version: 1, title: 'x'.repeat(500) }, 'x'))
      .rejects.toThrow(/Refusing to save/);

    expect(log.some((s) => s.sql.includes('update public.collection_items'))).toBe(false);
  });

  it('reduces the address on the way in, so the column only ever holds a slug', async () => {
    const { saveItem } = await import('../lib/db/collections');

    respond('update public.collection_items', [
      { id: 'i1', collection_id: 'c1', slug: 'ten-things-in-crete', status: 'draft', updated_at: '2026-08-03T09:00:00Z' },
    ]);

    await saveItem(ALPHA, 'i1', { version: 1, title: 'Ten things' }, 'Ten Things In Crete!');

    const write = log.find((s) => s.sql.includes('update public.collection_items'))!;
    expect(write.params).toContain('ten-things-in-crete');
  });

  it('falls back to the title when the address was emptied', async () => {
    const { saveItem } = await import('../lib/db/collections');

    respond('update public.collection_items', [
      { id: 'i1', collection_id: 'c1', slug: 'ten-things', status: 'draft', updated_at: '2026-08-03T09:00:00Z' },
    ]);

    await saveItem(ALPHA, 'i1', { version: 1, title: 'Ten things' }, '');

    const write = log.find((s) => s.sql.includes('update public.collection_items'))!;
    expect(write.params).toContain('ten-things');
  });

  it('falls back again to untitled, because the column cannot be empty', async () => {
    const { saveItem } = await import('../lib/db/collections');

    respond('update public.collection_items', [
      { id: 'i1', collection_id: 'c1', slug: 'untitled', status: 'draft', updated_at: '2026-08-03T09:00:00Z' },
    ]);

    await saveItem(ALPHA, 'i1', { version: 1, title: '' }, '');

    const write = log.find((s) => s.sql.includes('update public.collection_items'))!;
    expect(write.params).toContain('untitled');
  });

  it('writes as the app role, inside a transaction', async () => {
    const { saveItem } = await import('../lib/db/collections');

    respond('update public.collection_items', [
      { id: 'i1', collection_id: 'c1', slug: 'x', status: 'draft', updated_at: '2026-08-03T09:00:00Z' },
    ]);

    await saveItem(ALPHA, 'i1', { version: 1, title: 'Ten things' }, 'x');

    const write = log.find((s) => s.sql.includes('update public.collection_items'))!;
    expect(write.role).toBe('app');
    expect(log.findIndex((s) => s.sql === 'BEGIN')).toBeLessThan(log.indexOf(write));
    // No tenant in the WHERE. The policy does the scoping, as everywhere else.
    expect(write.sql).not.toContain('tenant_id =');
  });

  it('answers with nothing when the id was somebody elses', async () => {
    const { saveItem, publishItem, deleteItem } = await import('../lib/db/collections');

    // No respond() call, so the fake returns no rows, which is what RLS does
    // to a row belonging to another tenant.
    expect(await saveItem(ALPHA, 'i1', { version: 1, title: 'Ten things' }, 'x')).toBeNull();
    expect(await publishItem(ALPHA, 'i1')).toBeNull();
    expect(await deleteItem(ALPHA, 'i1')).toBe(false);
  });

  it('publishes by setting the status and the moment together', async () => {
    const { publishItem } = await import('../lib/db/collections');

    respond('update public.collection_items', [
      {
        id: 'i1', collection_id: 'c1', slug: 'x', status: 'published',
        published_at: '2026-08-03T09:00:00Z', updated_at: '2026-08-03T09:00:00Z',
      },
    ]);

    const summary = await publishItem(ALPHA, 'i1');

    const write = log.find((s) => s.sql.includes('update public.collection_items'))!;
    expect(write.sql).toContain("status = 'published'");
    expect(write.sql).toContain('published_at = now()');
    expect(summary?.status).toBe('published');
  });

  /*
   * Scheduling is a publish with the moment set ahead instead of to now(). The
   * row goes to 'published' so the renderer policy is the only thing hiding it,
   * and published_at carries the chosen instant, which is what that policy then
   * compares against.
   */
  it('schedules by publishing with the moment set ahead, not now()', async () => {
    const { scheduleItem } = await import('../lib/db/collections');
    const when = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    respond('update public.collection_items', [
      {
        id: 'i1', collection_id: 'c1', slug: 'x', status: 'published',
        published_at: when, updated_at: '2026-08-03T09:00:00Z', scheduled: true,
      },
    ]);

    const summary = await scheduleItem(ALPHA, 'i1', when);

    const write = log.find((s) => s.sql.includes('update public.collection_items'))!;
    expect(write.sql).toContain("status = 'published'");
    expect(write.sql).toContain('published_at = ');
    expect(write.sql).not.toContain('published_at = now()');
    expect(write.params).toContain(when);
    expect(summary?.scheduled).toBe(true);
  });

  it('refuses a time in the past and writes nothing when it does', async () => {
    const { scheduleItem } = await import('../lib/db/collections');
    const past = new Date(Date.now() - 60 * 1000).toISOString();

    await expect(scheduleItem(ALPHA, 'i1', past)).rejects.toThrow(/future/);
    expect(log.some((s) => s.sql.includes('update public.collection_items'))).toBe(false);
  });

  /*
   * Unpublishing leaves published_at alone on purpose. It is the record of when
   * the button was last pressed, and the listing orders by it. Clearing it would
   * send a re-published post to the bottom of the blog.
   */
  it('unpublishes without forgetting when it went out', async () => {
    const { unpublishItem } = await import('../lib/db/collections');

    respond('update public.collection_items', [
      {
        id: 'i1', collection_id: 'c1', slug: 'x', status: 'draft',
        published_at: '2026-08-03T09:00:00Z', updated_at: '2026-08-04T09:00:00Z',
      },
    ]);

    await unpublishItem(ALPHA, 'i1');

    const write = log.find((s) => s.sql.includes('update public.collection_items'))!;
    expect(write.sql).toContain("status = 'draft'");
    expect(write.sql).not.toContain('published_at =');
  });

  it('starts a new entry with the shape everything else expects', async () => {
    const { createItem } = await import('../lib/db/collections');

    respond('insert into public.collection_items', [
      {
        id: 'i1', collection_id: 'c1', slug: 'ten-things', status: 'draft',
        updated_at: '2026-08-03T09:00:00Z',
        data: { version: 1, title: 'Ten things', summary: '', image: '', alt: '', date: '', sections: [] },
      },
    ]);
    respond('select key, fields from public.collections', [{ key: 'blog', fields: [] }]);

    const created = await createItem(ALPHA, 'c1', 'Ten things');

    const write = log.find((s) => s.sql.includes('insert into public.collection_items'))!;
    expect(write.params).toContain('ten-things');
    expect(writtenJson(write)).toMatchObject({ version: 1, title: 'Ten things', sections: [] });
    expect(created?.collectionKey).toBe('blog');
  });

  /*
   * The collection id comes from the browser and is a guess like any other. With
   * a plain VALUES insert the WITH CHECK policy would wave it through, because
   * the tenant_id on the new row IS ours: the row would be written pointing at
   * somebody else's collection. Selecting the id out of `collections` puts it
   * through that table's own policy first, so another client's collection is
   * simply not there to select and nothing is inserted.
   */
  /*
   * A collection's own fields, from migration 0004's dormant column.
   *
   * The rule these hold to: the DEFINITIONS come from the database, and the
   * VALUES come from the browser. A definition arriving with the save would let
   * whoever sent the answer decide what counts as a valid one.
   */
  it('cleans an entry against its own collections definitions, read at save', async () => {
    const { saveItem } = await import('../lib/db/collections');

    respond('select c.fields', [
      {
        fields: [
          { key: 'nights', label: 'Nights', kind: 'number', required: true, choices: [] },
          { key: 'board', label: 'Board', kind: 'choice', required: false, choices: ['Half board'] },
        ],
      },
    ]);
    respond('update public.collection_items', [
      { id: 'i1', collection_id: 'c1', slug: 'x', status: 'draft', updated_at: '2026-08-03T09:00:00Z' },
    ]);

    await saveItem(
      ALPHA,
      'i1',
      { version: 1, title: 'Western Isles', fields: { nights: '7 nights', board: 'Whatever I like' } },
      'x',
    );

    const write = log.find((s) => s.sql.includes('update public.collection_items'))!;
    expect(writtenJson(write)).toMatchObject({ fields: { nights: 7 } });
    // Off the list, so it is not stored at all.
    expect((writtenJson(write) as { fields: Record<string, unknown> }).fields.board).toBeUndefined();
  });

  it('reads the definitions from the row, not from what the browser sent', async () => {
    const { saveItem } = await import('../lib/db/collections');

    respond('update public.collection_items', [
      { id: 'i1', collection_id: 'c1', slug: 'x', status: 'draft', updated_at: '2026-08-03T09:00:00Z' },
    ]);

    await saveItem(ALPHA, 'i1', { version: 1, title: 'Western Isles' }, 'x');

    const read = log.find((s) => s.sql.includes('select c.fields'))!;
    expect(read.sql).toContain('join public.collections c');
    expect(read.role).toBe('app');
    // Inside the same transaction as the write, so a schema edit landing
    // between the two cannot clean a save against a schema that has gone.
    expect(log.findIndex((s) => s.sql === 'BEGIN')).toBeLessThan(log.indexOf(read));
  });

  it('keeps an answer whose definition has been deleted', async () => {
    const { saveItem } = await import('../lib/db/collections');

    // The collection declares nights and nothing else any more.
    respond('select c.fields', [
      { fields: [{ key: 'nights', label: 'Nights', kind: 'number', required: false, choices: [] }] },
    ]);
    respond('update public.collection_items', [
      { id: 'i1', collection_id: 'c1', slug: 'x', status: 'draft', updated_at: '2026-08-03T09:00:00Z' },
    ]);

    await saveItem(
      ALPHA,
      'i1',
      { version: 1, title: 'Western Isles', fields: { nights: 7, board: 'Half board' } },
      'x',
    );

    const write = log.find((s) => s.sql.includes('update public.collection_items'))!;
    expect(writtenJson(write)).toMatchObject({ fields: { nights: 7, board: 'Half board' } });
  });

  it('reads a collection back with its declared fields', async () => {
    const { listCollections } = await import('../lib/db/collections');

    respond('select id, key, name, fields, layout from public.collections', [
      {
        id: 'c1',
        key: 'tours',
        name: 'Tours',
        fields: [{ key: 'nights', label: 'Nights', kind: 'number', required: true, choices: [] }],
      },
      { id: 'c2', key: 'blog', name: 'Blog', fields: null },
    ]);

    const [tours, blog] = await listCollections(ALPHA);
    expect(tours.fields).toHaveLength(1);
    expect(tours.fields[0].label).toBe('Nights');
    // A collection made before any of this existed reads as no fields.
    expect(blog.fields).toEqual([]);
  });

  it('changes a schema with one update and touches no entry', async () => {
    const { updateCollectionFields } = await import('../lib/db/collections');

    respond('update public.collections set fields', [
      {
        id: 'c1',
        key: 'tours',
        name: 'Tours',
        fields: [{ key: 'nights', label: 'Nights aboard', kind: 'number', required: false, choices: [] }],
      },
    ]);

    const updated = await updateCollectionFields(ALPHA, 'c1', [
      { key: 'nights', label: 'Nights aboard', kind: 'number', required: false, choices: [] },
    ]);

    expect(updated?.fields[0].label).toBe('Nights aboard');
    // Renaming is a label change on one row. Nothing rewrites the entries.
    expect(log.some((s) => s.sql.includes('update public.collection_items'))).toBe(false);
  });

  it('puts a schema from the browser through the same parser as a read', async () => {
    const { updateCollectionFields } = await import('../lib/db/collections');

    respond('update public.collections set fields', [
      { id: 'c1', key: 'tours', name: 'Tours', fields: [] },
    ]);

    await updateCollectionFields(ALPHA, 'c1', [
      { key: 'nights', label: 'Nights', kind: 'number', required: false, choices: [] },
      { nonsense: true },
      { key: '', label: 'No key' },
    ]);

    const write = log.find((s) => s.sql.includes('update public.collections set fields'))!;
    expect(writtenJson(write)).toEqual([
      { key: 'nights', label: 'Nights', kind: 'number', required: false, choices: [], prefix: '', suffix: '' },
    ]);
  });

  it('cannot start an entry inside somebody elses collection', async () => {
    const { createItem } = await import('../lib/db/collections');

    // No respond() call, which is what the policy does to a collection id
    // belonging to another tenant: the select finds nothing.
    expect(await createItem(ALPHA, 'not-mine', 'Ten things')).toBeNull();

    const write = log.find((s) => s.sql.includes('insert into public.collection_items'))!;
    expect(write.sql).toContain('from public.collections c');
    expect(write.sql).not.toContain('values (');
  });

  it('has an address even for an entry nobody named', async () => {
    const { createItem } = await import('../lib/db/collections');

    respond('insert into public.collection_items', [
      {
        id: 'i1', collection_id: 'c1', slug: 'untitled', status: 'draft',
        updated_at: '2026-08-03T09:00:00Z',
        data: { version: 1, title: 'Untitled' },
      },
    ]);

    await createItem(ALPHA, 'c1', '   ');

    const write = log.find((s) => s.sql.includes('insert into public.collection_items'))!;
    expect(write.params).toContain('untitled');
  });
});

describe('collections themselves', () => {
  it('reduces the short name, because the column has a check constraint on it', async () => {
    const { createCollection } = await import('../lib/db/collections');

    respond('insert into public.collections', [{ id: 'c1', key: 'travel-diary', name: 'Travel Diary' }]);
    await createCollection(ALPHA, { name: 'Travel Diary' });

    const write = log.find((s) => s.sql.includes('insert into public.collections'))!;
    expect(write.params).toContain('travel-diary');
  });

  it('and the constraint the reduction has to satisfy is still there', () => {
    const sql = readFileSync(
      join(__dirname, '..', 'db', 'migrations', '0004_future_tables.sql'),
      'utf8',
    );
    expect(sql).toContain("key        text not null check (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$')");
  });

  it('takes a short name of its own when one was given', async () => {
    const { createCollection } = await import('../lib/db/collections');

    respond('insert into public.collections', [{ id: 'c1', key: 'news', name: 'Travel Diary' }]);
    await createCollection(ALPHA, { name: 'Travel Diary', key: 'News!' });

    const write = log.find((s) => s.sql.includes('insert into public.collections'))!;
    expect(write.params).toContain('news');
  });

  it('has something to call a collection nobody named', async () => {
    const { createCollection } = await import('../lib/db/collections');

    respond('insert into public.collections', [{ id: 'c1', key: 'untitled', name: 'Untitled' }]);
    await createCollection(ALPHA, { name: '   ' });

    const write = log.find((s) => s.sql.includes('insert into public.collections'))!;
    expect(write.params).toContain('Untitled');
    expect(write.params).toContain('untitled');
  });

  /*
   * The last resort. A name with nothing a URL can carry reduces to an empty
   * short name, and the column has a check constraint that would refuse it, so
   * there has to be something to fall back to.
   */
  it('still has an address when the name reduces to nothing at all', async () => {
    const { createCollection } = await import('../lib/db/collections');

    respond('insert into public.collections', [{ id: 'c1', key: 'list', name: '。。。' }]);
    await createCollection(ALPHA, { name: '。。。' });

    const write = log.find((s) => s.sql.includes('insert into public.collections'))!;
    expect(write.params).toContain('list');
  });

  it('reads and writes as the app role', async () => {
    const { listCollections, listItems } = await import('../lib/db/collections');

    await listCollections(ALPHA);
    await listItems(ALPHA, 'c1');

    for (const statement of log.filter((s) => s.sql.includes('public.collection'))) {
      expect(statement.role).toBe('app');
    }
  });
});

// ---------------------------------------------------------------------------
// The seams the routes make, read as text
// ---------------------------------------------------------------------------

function read(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf8');
}

describe('an entry on a live site', () => {
  const route = read('app', 'site', '[host]', '[[...path]]', 'page.tsx');

  /*
   * A REAL PAGE ALWAYS WINS. A client who makes a page at /blog/something must
   * not find it quietly shadowed by an entry of the same name, so the entry
   * lookup only happens after the pages have said no. Order in the file is the
   * whole rule, which is why it is asserted rather than assumed.
   */
  it('looks for an entry only after the pages have said no', () => {
    expect(route).toContain('if (!page) {');
    expect(route.indexOf('getPublishedPage')).toBeLessThan(route.indexOf('getPublishedItem'));
  });

  it('is two segments exactly, because an entry has no children', () => {
    expect(route).toContain('if (segments.length !== 2) return null;');
  });

  it('shows the entry title as a real h1 rather than hiding it', () => {
    expect(route).toContain('className="tgs-entry__title"');
  });

  it('gives the date a machine-readable attribute', () => {
    expect(route).toContain('<time dateTime={item.date}>');
  });

  it('lists the tags under the title as plain labels', () => {
    expect(route).toContain('className="tgs-entry__tags"');
    expect(route).toContain('item.tags.map((tag)');
  });

  it('shows a byline of author and reading time under the title', () => {
    expect(route).toContain('className="tgs-entry__byline"');
    // Worked out from the body, not read from a stored field.
    expect(route).toContain('readingTime(item.sections)');
  });

  /*
   * new Date('2026-08-03') is UTC midnight, which formats as the 2nd anywhere
   * west of Greenwich. The date on an article is a date, so it is built from
   * its own parts. This asserts the route never reaches for Date at all.
   */
  it('formats the date without going through a Date', () => {
    const formatter = route.slice(route.indexOf('function formatDate'));
    expect(formatter).not.toContain('new Date');
    expect(formatter).toContain("value.split('-')");
  });

  it('sanitises the picture at the top before rendering it', () => {
    expect(route).toContain('const image = safeUrl(item.image);');
  });

  it('renders the header and footer round an entry as well as a page', () => {
    const body = route.slice(route.indexOf('export default async function SitePage'));
    // Drawn through fillNavRegion, which fills a Menu link that points at a folder
    // with the pages inside it before the region renders.
    expect(body).toContain('fillNavRegion(found.regions.header');
    expect(body).toContain('fillNavRegion(found.regions.footer');
  });
});

describe('the listing blocks on a page', () => {
  it('are resolved on the server, before anything renders', () => {
    const route = read('app', 'site', '[host]', '[[...path]]', 'page.tsx');
    expect(route).toContain('fillPageListings');
    expect(route).toContain('resolveListings(tenantId, [regions.header, page.content, regions.footer])');
  });

  it('reads them through the one shared reader, on all three surfaces', () => {
    /*
     * There were three copies: the published route, the preview and nothing at
     * all in the editor, which is why a collection grid drew real cards on the
     * site and a grey box on the canvas. The preview's copy had also already
     * drifted, dropping the filter and the sort, so a narrowed listing previewed
     * as the whole collection.
     */
    for (const where of [
      ['app', 'site', '[host]', '[[...path]]', 'page.tsx'],
      ['app', 'preview', '[[...path]]', 'page.tsx'],
      ['app', 'editor', 'page.tsx'],
    ]) {
      const file = read(...where);
      expect(file, where.join('/')).toContain('resolveListings(');
      // Nobody rolls their own any more.
      expect(file, where.join('/')).not.toContain('listingsIn(');
    }
  });

  it('are resolved on the preview too, or the two would disagree', () => {
    const preview = read('app', 'preview', '[[...path]]', 'page.tsx');
    expect(preview).toContain('fillPageListings');
  });

  /*
   * The block itself must stay a plain component with no server-only code: the
   * same one draws the published page and the editor canvas, and that is what
   * stops the two drifting. A database import in there would end it.
   */
  it('leave the block itself with nothing to read', () => {
    const blocks = read('components', 'render', 'blocks.tsx');
    expect(blocks).not.toContain('lib/db/');
    expect(blocks).not.toContain('listPublished');
  });

  it('draws the post tags on a card, filtered to plain strings', () => {
    const blocks = read('components', 'render', 'blocks.tsx');
    expect(blocks).toContain('className="tgs-card__tags"');
    expect(blocks).toContain('className="tgs-card__tag"');
    // Only strings reach the page, so a stray tags prop on a manual card cannot
    // put an object through React.
    expect(blocks).toContain("typeof tag === 'string'");
  });

  it('draws the byline and reading time on a card', () => {
    const blocks = read('components', 'render', 'blocks.tsx');
    expect(blocks).toContain('className="tgs-card__meta"');
    expect(blocks).toContain('min read');
  });
});

describe('the editor', () => {
  const editor = read('app', 'editor', 'page.tsx');

  it('edits an entry with the same shell a page uses', () => {
    expect(editor).toContain('itemAsPage(found.item, found.id, found.slug)');
    expect(editor).toContain('initialItemMeta={itemMeta(found.item, found.slug)}');
  });

  it('bounces an entry that is not this site to the collections screen', () => {
    expect(editor).toContain("if (!found) redirect('/collections');");
  });

  it('checks who is asking before it looks the entry up', () => {
    expect(editor.indexOf('currentUserId()')).toBeLessThan(editor.indexOf('getItem('));
  });
});

describe('the collections screen', () => {
  const screen = read('app', 'collections', 'page.tsx');

  it('sends an anonymous request to sign in and back again', () => {
    expect(screen).toContain("redirect('/signin?next=%2Fcollections')");
  });

  /*
   * The id in the URL is a guess like any other. It is checked against the list
   * already read rather than with another query, so an id belonging to somebody
   * else falls through to the first collection exactly as a made-up one does.
   */
  it('only opens a collection that is in this site own list', () => {
    expect(screen).toContain('collections.find((entry) => entry.id === requested)');
  });

  it('reads the entries on the server, so the first paint is the real list', () => {
    expect(screen).toContain('await listItems(site.tenantId, open.id)');
  });
});

describe('the migration that keeps a publish state honest', () => {
  const sql = readFileSync(
    join(__dirname, '..', 'db', 'migrations', '0017_collection_items_touch.sql'),
    'utf8',
  );

  /*
   * collection_items has had an updated_at column since 0004 and no trigger to
   * write it, because until 31 Jul 2026 nothing used the table. The summary asks
   * `updated_at > published_at`, so without this an entry edited after being
   * published would still read as clean and the agent would never see the state
   * they most need to see.
   */
  it('adds the touch trigger the summary depends on', () => {
    expect(sql).toContain('create trigger collection_items_touch');
    expect(sql).toContain('before update on public.collection_items');
    expect(sql).toContain('execute function public.touch_updated_at()');
  });

  it('can be run twice', () => {
    expect(sql).toContain('drop trigger if exists collection_items_touch');
  });

  it('is the question the summary actually asks', async () => {
    const layer = read('lib', 'db', 'collections.ts');
    expect(layer).toContain('(published_at is null or updated_at > published_at) as has_unpublished_changes');
  });
});

describe('the stylesheet', () => {
  const css = read('app', 'globals.css');

  it('styles an entry, which is not a page', () => {
    for (const rule of ['.tgs-entry__title', '.tgs-entry__date', '.tgs-entry__summary', '.tgs-entry__image', '.tgs-entry__tag']) {
      expect(css).toContain(rule);
    }
  });

  it('styles the tags on a blog card', () => {
    for (const rule of ['.tgs-card__tags', '.tgs-card__tag']) {
      expect(css).toContain(rule);
    }
  });

  it('styles the byline on a post and the meta line on a card', () => {
    for (const rule of ['.tgs-entry__byline', '.tgs-card__meta']) {
      expect(css).toContain(rule);
    }
  });
});

describe('the tags field in the post editor', () => {
  const props = read('components', 'editor', 'Properties.tsx');

  it('is wired into the post fields, sharing the schema helper', () => {
    expect(props).toContain('<TagsField tags={meta.tags}');
    expect(props).toContain('safeTags([...tags');
  });

  it('draws a removable chip per tag', () => {
    expect(props).toContain('className="ed-tags__chip"');
    expect(props).toContain('className="ed-tags__x"');
  });

  it('offers an author field beside the date', () => {
    expect(props).toContain('>Author<');
    expect(props).toContain('set({ author: event.target.value })');
  });
});

describe('the tag archive', () => {
  const route = read('app', 'site', '[host]', '[[...path]]', 'page.tsx');
  const css = read('app', 'globals.css');

  it('resolves /collection/tag/slug, and only after the pages have said no', () => {
    // Inside the `if (!page)` block, so a real page at that address always wins.
    expect(route).toContain("segments.length === 3 && segments[1] === 'tag'");
    expect(route).toContain('listPublishedByTag(');
  });

  it('is noindex with follow left on, a way to find posts not a page to rank', () => {
    const branch = route.slice(route.indexOf('if (found.archive)'), route.indexOf('if (found.archive)') + 400);
    expect(branch).toContain('index: false');
    expect(branch).toContain('follow: true');
  });

  it('draws the posts as a card grid under a heading naming the tag', () => {
    expect(route).toContain('<ArchiveRenderer');
    expect(route).toContain('className="tgs-archive__title"');
    expect(route).toContain('<CardsBlock props={{ items: archive.cards');
  });

  it('makes a post tag a link to its archive', () => {
    expect(route).toContain('tagArchivePath(entry.collectionKey, tag)');
  });

  it('is styled, and the post tag pills gained a hover now they go somewhere', () => {
    expect(css).toContain('.tgs-archive');
    expect(css).toContain('.tgs-archive__title');
    expect(css).toContain('.tgs-entry__tag:hover');
  });
});

describe('scheduling a post to go live later', () => {
  const sql = readFileSync(
    join(__dirname, '..', 'db', 'migrations', '0020_schedule_publishing.sql'),
    'utf8',
  );

  /*
   * The gate lives in the renderer policy, not a WHERE clause, exactly as the
   * draft gate does. A scheduled post is a published row whose published_at is
   * still ahead of now, and this policy is the one place that fact keeps it out
   * of every public read at once: the listing, the single post, the tag archive
   * and the sitemap. Tightening only, so no post already out can disappear.
   */
  it('tightens the renderer policy so a future published_at stays hidden', () => {
    const policy = sql.slice(sql.indexOf('create policy collection_items_renderer'));
    expect(policy).toContain('to tg_sites_renderer');
    expect(policy).toContain("status = 'published'");
    expect(policy).toContain('published_at is not null');
    expect(policy).toContain('published_at <= now()');
  });

  it('drops the old policy first, so it can be run twice', () => {
    expect(sql).toContain('drop policy if exists collection_items_renderer');
  });

  /*
   * The writing screen has to show a scheduled post as scheduled, so the summary
   * projection computes the same thing the policy does, flipped: published, with
   * published_at still ahead. If these two drift a post could read as Live on the
   * screen while the public still cannot see it, or the other way about.
   */
  it('is the same question the summary projection answers', () => {
    const layer = read('lib', 'db', 'collections.ts');
    expect(layer).toContain(
      "(status = 'published' and published_at is not null and published_at > now()) as scheduled",
    );
  });
});

describe('the schedule control on the writing screen', () => {
  const dash = read('components', 'collections', 'CollectionsDashboard.tsx');

  it('offers Schedule on a draft, routed through the future-checked action', () => {
    expect(dash).toContain("setDialog({ kind: 'schedule', item })");
    expect(dash).toContain('scheduleItemAction(item.id, whenIso)');
  });

  /*
   * datetime-local hands back a naive wall-clock time. toISOString resolves it in
   * the browser's own zone to the UTC instant the server stores and the policy
   * compares against, so nine o'clock means nine where the client is.
   */
  it('sends the picked wall-clock time as a UTC instant', () => {
    expect(dash).toContain('type="datetime-local"');
    expect(dash).toContain('new Date(when).toISOString()');
  });

  it('shows a scheduled post as scheduled, not plainly live', () => {
    expect(dash).toContain('item.scheduled');
    expect(dash).toContain('data-state="scheduled"');
  });

  it('has a pill colour for the scheduled state, apart from live and changed', () => {
    const css = read('components', 'sites', 'sites.css');
    expect(css).toContain("data-state='scheduled'");
  });
});

// ---------------------------------------------------------------------------

/**
 * WHICH ORDER A COLLECTION LISTING COMES BACK IN.
 *
 * Andy, 26 Aug 2026: "in the cards i can't see a way to reorder them". Typed
 * cards have had up and down arrows all along. Collection cards are a live
 * query, so there was nothing to drag, and no control either: they came back
 * newest first and that was the only order there was.
 *
 * The field sort already plumbed through here did not help. It can only sort by
 * a field the collection DECLARES, and the guides collection this was reported
 * against declares none, so there was provably no order a client could pick.
 * These four are intrinsic, so they work on any collection at all.
 */
describe('the order a listing comes back in', () => {
  const ROWS = [
    { slug: 'c', data: { title: 'Cephalonia' }, published_at: '2026-08-03', fields: [] },
    { slug: 'a', data: { title: 'ålesund' },    published_at: '2026-08-02', fields: [] },
    { slug: 'b', data: { title: 'Brac' },       published_at: '2026-08-01', fields: [] },
  ];

  async function titles(order?: string): Promise<string[]> {
    const { listPublished } = await import('../lib/db/collections');
    respond('from public.collection_items', ROWS);
    const listing = await listPublished(ALPHA, 'guides', 6, order ? { order } as never : {});
    return listing.items.map((row) => String(row.item.title));
  }

  it('is newest first when nothing is chosen, exactly as before', async () => {
    // The SQL already orders by published_at desc, so this is the rows as read.
    expect(await titles()).toEqual(['Cephalonia', 'ålesund', 'Brac']);
    expect(await titles('newest')).toEqual(['Cephalonia', 'ålesund', 'Brac']);
  });

  it('turns round for oldest first', async () => {
    expect(await titles('oldest')).toEqual(['Brac', 'ålesund', 'Cephalonia']);
  });

  it('sorts by title, ignoring case and accents', async () => {
    // "ålesund" sorts with the As rather than after Z, which is where a plain
    // code-point comparison would put it, and its lower-case initial does not
    // send it to the end either.
    expect(await titles('title')).toEqual(['ålesund', 'Brac', 'Cephalonia']);
    expect(await titles('title-desc')).toEqual(['Cephalonia', 'Brac', 'ålesund']);
  });

  it('reads the whole collection before cutting, or the answer is wrong', async () => {
    /*
     * The subtle one. Taking the newest six and THEN sorting them A to Z gives
     * six newest alphabetised, not the first six alphabetically. So an order
     * other than newest has to drop the LIMIT, the same way a filter does.
     */
    const { listPublished } = await import('../lib/db/collections');

    log.length = 0;
    respond('from public.collection_items', ROWS);
    await listPublished(ALPHA, 'guides', 2, { order: 'title' } as never);
    expect(itemQuery().sql).not.toContain('limit');

    log.length = 0;
    respond('from public.collection_items', ROWS);
    await listPublished(ALPHA, 'guides', 2, {});
    // And the common case still reads no more rows than it ever did.
    expect(itemQuery().sql).toContain('limit');
  });

  it('still cuts to the count once it has ordered', async () => {
    const { listPublished } = await import('../lib/db/collections');
    respond('from public.collection_items', ROWS);
    const listing = await listPublished(ALPHA, 'guides', 2, { order: 'title' } as never);
    expect(listing.items.map((row) => String(row.item.title))).toEqual(['ålesund', 'Brac']);
  });
});

// ---------------------------------------------------------------------------

/**
 * THE CANVAS KEEPS ITS CARDS WHEN THE ORDER CHANGES.
 *
 * The regression the Order control caused on its first outing. Andy clicked it
 * and every card on the page vanished, 26 Aug 2026.
 *
 * The editor builds its listing map on the SERVER, once, from the tree as it
 * was at page load. The canvas then fills a copy of the tree on every keystroke
 * and looks each block up by listingKey, and that key carries the order. Pick a
 * different order and the key matches nothing, fillListings finds no cards, and
 * the grid falls back to its empty state until a reload.
 *
 * So the editor asks for every order up front. This is the test that the map it
 * gets back can answer all four, and it fails against a map built the way the
 * published route builds one, which is exactly what the editor was doing.
 */
describe('changing the order does not empty the canvas', () => {
  const REQUEST = { collection: 'guides', count: 6, facts: 0, filter: null, sort: null };

  it('a map built for one order cannot answer another, which is the bug', () => {
    const forNewest = new Map([
      [listingKey({ ...REQUEST, order: 'newest' }), [{ title: 'Hvar' }]],
    ]);
    const tree = {
      sections: [section([listingBlock({ source: 'collection', collection: 'guides', order: 'title' })])],
    };
    // Untouched: no cards, which on the canvas is the grid going empty.
    expect(fillListings(tree, forNewest)).toBe(tree);
  });

  it('and a map holding every order answers whichever one is picked', () => {
    const everyOrder = new Map(
      LISTING_ORDERS.map((order) => [
        listingKey({ ...REQUEST, order }),
        [{ title: `first by ${order}` }],
      ]),
    );

    for (const order of LISTING_ORDERS) {
      const tree = {
        sections: [section([listingBlock({ source: 'collection', collection: 'guides', order })])],
      };
      const filled = fillListings(tree, everyOrder) as typeof tree;
      const items = filled.sections[0].rows[0].columns[0].blocks[0].props.items as Array<{ title: string }>;
      expect(items, `nothing filled for "${order}"`).toHaveLength(1);
      expect(items[0].title).toBe(`first by ${order}`);
    }
  });

  it('hands back the props beside each request, which is what gets sent', async () => {
    /*
     * The server validates the ask by running listingIn over the SAME props the
     * tree holds, rather than trusting a request assembled on the client. That
     * only works if the walker carries them, and rebuilding a props bag from a
     * ListingRequest would be a second copy of the mapping to keep in step.
     */
    const { listingBlocksIn } = await import('../lib/content/listings');

    const tree = {
      sections: [
        section([
          listingBlock({ source: 'collection', collection: 'guides', order: 'title', count: 4 }),
          listingBlock({ source: 'typed' }),
        ]),
      ],
    };

    const found = listingBlocksIn([tree]);
    // The typed one is not a listing at all, so it is not in here.
    expect(found).toHaveLength(1);
    expect(found[0].request.collection).toBe('guides');
    expect(found[0].request.order).toBe('title');
    expect(found[0].props.collection).toBe('guides');
    expect(found[0].props.order).toBe('title');
  });

  it('keeps every block, not one per request, so each can be asked for', async () => {
    /*
     * listingsIn DEDUPES by request because two grids showing the same thing are
     * one read. This one must not: the editor looks each block up by its own key
     * and needs the props for whichever ones are missing, and two blocks that
     * happen to match today may not after the next keystroke.
     */
    const { listingBlocksIn, listingsIn } = await import('../lib/content/listings');
    const same = () => listingBlock({ source: 'collection', collection: 'guides' });
    const tree = { sections: [section([same(), same()])] };

    expect(listingsIn([tree])).toHaveLength(1);
    expect(listingBlocksIn([tree])).toHaveLength(2);
  });

  it('the canvas asks for a listing it does not have, rather than pre-guessing', () => {
    /*
     * REPLACED THE PRE-FETCH. The first fix read all four orders when the editor
     * loaded, which answered the order control and nothing else: the collection
     * name and the filter are in the key too, and there is no finite set of
     * collection names to read ahead of time. So the canvas asks for what it
     * turns out to need and the pre-fetch is gone, which is both more correct
     * and fewer reads.
     */
    const shell = readFileSync(join(__dirname, '..', 'components', 'editor', 'EditorShell.tsx'), 'utf8');
    expect(shell).toContain('listingCardsAction');
    // Debounced, or typing a collection name is one request per letter.
    expect(shell).toContain('LISTING_DEBOUNCE_MS');
    // Asked once per key, or a collection with nothing published is re-requested
    // for ever: an empty list is a real answer and has to be cached as one.
    expect(shell).toContain('askedFor.current.has(key)');
    expect(shell).toContain('askedFor.current.add(key)');

    const editor = readFileSync(join(__dirname, '..', 'app', 'editor', 'page.tsx'), 'utf8');
    expect(editor, 'the pre-fetch should be gone').not.toContain('everyOrder');
  });
});

// ---------------------------------------------------------------------------

/**
 * THE ORDER THE CLIENT SET BY HAND.
 *
 * The half of Andy's "i can't see a way to reorder them" that no rule can
 * answer. An agency featuring a destination wants Hvar first because they
 * decided so, and neither a date nor a title expresses that. Stored per item as
 * a position (migration 0031), arranged with the arrows on the collections
 * screen, and read back by the 'manual' order.
 */
describe('the hand-set order', () => {
  const ROWS = [
    { slug: 'c', data: { title: 'Cephalonia' }, published_at: '2026-08-03', position: 3, fields: [] },
    { slug: 'a', data: { title: 'Hvar' },       published_at: '2026-08-02', position: 1, fields: [] },
    { slug: 'b', data: { title: 'Brac' },       published_at: '2026-08-01', position: 2, fields: [] },
  ];

  async function titles(rows: Record<string, unknown>[]): Promise<string[]> {
    const { listPublished } = await import('../lib/db/collections');
    respond('from public.collection_items', rows);
    const listing = await listPublished(ALPHA, 'guides', 6, { order: 'manual' } as never);
    return listing.items.map((row) => String(row.item.title));
  }

  it('follows the positions, not the dates', async () => {
    // Newest first would be Cephalonia, Hvar, Brac. The client said otherwise.
    expect(await titles(ROWS)).toEqual(['Hvar', 'Brac', 'Cephalonia']);
  });

  it('puts entries nobody has placed last, in the order they already had', async () => {
    /*
     * Null is a real state meaning "never arranged", not a missing value. A new
     * entry appearing at the top of a hand-set grid would silently displace
     * whatever the client had chosen to lead with.
     */
    const withNew = [
      { slug: 'd', data: { title: 'Korcula' }, published_at: '2026-08-09', position: null, fields: [] },
      ...ROWS,
    ];
    expect(await titles(withNew)).toEqual(['Hvar', 'Brac', 'Cephalonia', 'Korcula']);
  });

  it('degrades to the date order when nothing has been arranged at all', async () => {
    const none = ROWS.map((row) => ({ ...row, position: null }));
    // Which is the order they were read in, so a collection nobody has touched
    // behaves exactly as it did before positions existed.
    expect(await titles(none)).toEqual(['Cephalonia', 'Hvar', 'Brac']);
  });

  it('reads the whole collection first, like every order but newest', async () => {
    const { listPublished } = await import('../lib/db/collections');
    log.length = 0;
    respond('from public.collection_items', ROWS);
    await listPublished(ALPHA, 'guides', 2, { order: 'manual' } as never);
    expect(itemQuery().sql).not.toContain('limit');
  });
});

describe('saving a hand-set order', () => {
  it('writes the whole list in one statement, scoped to the collection', async () => {
    const { reorderItems } = await import('../lib/db/collections');

    log.length = 0;
    respond('update public.collection_items', [{ id: 'i1' }, { id: 'i2' }]);
    const moved = await reorderItems(ALPHA, 'COLL', ['i2', 'i1']);

    expect(moved).toBe(2);
    const write = log.find((s) => s.sql.includes('update public.collection_items'))!;
    expect(write.sql).toContain('with ordinality');
    /*
     * The collection scope is the part that matters. reorderItems is reachable
     * from a browser, and tenant scoping alone would still have let somebody
     * renumber a DIFFERENT collection of their own by sending its ids.
     */
    expect(write.sql).toContain('collection_id');
    expect(write.params).toContain('COLL');
    expect(write.params).toContainEqual(['i2', 'i1']);
  });

  it('does nothing at all for an empty list rather than writing', async () => {
    const { reorderItems } = await import('../lib/db/collections');
    log.length = 0;
    expect(await reorderItems(ALPHA, 'COLL', [])).toBe(0);
    expect(log.filter((s) => s.sql.includes('update public.collection_items'))).toHaveLength(0);
  });

  it('writes as the app role, never the renderer', async () => {
    const { reorderItems } = await import('../lib/db/collections');
    log.length = 0;
    respond('update public.collection_items', []);
    await reorderItems(ALPHA, 'COLL', ['i1']);
    for (const statement of log.filter((s) => s.sql.includes('collection_items'))) {
      expect(statement.role).toBe('app');
    }
  });
});

// ---------------------------------------------------------------------------

/**
 * THE ARROWS ARE ACTUALLY VISIBLE, which is not the same as being rendered.
 *
 * Andy, twice in a row: "i can't see the arrows to manually move them". They
 * were there. Correct markup, correct icons, deployed, and drawn at opacity 0.
 *
 * sites.css hides every .sv-btn inside a row until the row is hovered, so the
 * list of pages is not a wall of controls. That is right for Edit, Publish and
 * Delete, which you go looking for on a row you have already picked, and wrong
 * for reordering, which is a property of the LIST: you cannot go looking for it
 * without first knowing it is there.
 *
 * I had checked the markup, the class, the build and the deployment, and never
 * once looked at the screen. Rendering it in Chromium reported the button at
 * 44x44, visible, with a 16px icon inside it, and opacity 0. So this test
 * checks the one property none of those checks covered: that the exemption
 * exists, comes after the rule it is exempting itself from, and is not zero.
 */
describe('the reorder arrows are not hidden by the row-action reveal', () => {
  const css = readFileSync(join(__dirname, '..', 'components', 'sites', 'sites.css'), 'utf8');

  it('still hides the row ACTIONS until the row is hovered', () => {
    // The behaviour being worked around is deliberate and stays.
    expect(css).toContain('.sv-item .sv-btn { opacity: 0; transition: opacity 120ms ease-out; }');
  });

  it('exempts the move column, after that rule so it wins', () => {
    const hides = css.indexOf('.sv-item .sv-btn { opacity: 0;');
    const exempt = css.indexOf('.sv-item .sv-item__move .sv-btn { opacity:');
    expect(hides, 'the hide rule has moved or gone').toBeGreaterThan(-1);
    expect(exempt, 'nothing exempts the arrows from it').toBeGreaterThan(-1);
    // Same specificity would be a coin toss; later in the file is the mechanism.
    expect(exempt).toBeGreaterThan(hides);
  });

  it('and the exemption leaves them actually painted', () => {
    const rule = /\.sv-item \.sv-item__move \.sv-btn \{ opacity: ([0-9.]+); \}/.exec(css);
    expect(rule, 'the exemption is not the shape this test can read').toBeTruthy();
    const resting = Number(rule![1]);
    /*
     * Faint enough not to compete with the titles, which is what the hide rule
     * is protecting, and nowhere near invisible. Zero is the bug.
     */
    expect(resting).toBeGreaterThan(0.3);
    expect(resting).toBeLessThanOrEqual(1);
  });

  it('keeps a full-size touch target where there is no cursor', () => {
    /*
     * The arrows are 24px on a pointer so two stacked buttons fit inside the
     * height the row already had: at 44 each they pushed every row from about
     * 80px to 123px. Touch still gets 44, where the target is the whole point.
     */
    expect(css).toContain('@media (hover: hover) and (pointer: fine)');
    const fine = css.slice(css.indexOf('@media (hover: hover) and (pointer: fine)'));
    expect(fine.slice(0, 300)).toContain('min-height: 24px');
    expect(css).toContain(".sv-btn[data-icon='true']");
  });
});

// ---------------------------------------------------------------------------

/**
 * ARRANGING THE ENTRIES FROM THE BLOCK THAT DRAWS THEM.
 *
 * Andy picked "The order I set" on the cards block, looked at his two cards and
 * said "There are no arrows". They existed, on the collections screen, which is
 * a different page. A setting whose effect you cannot reach from where you set
 * it reads as broken however clear the help line is, so on his instruction they
 * are now in both places.
 *
 * That needed three things to be true at once, and each is checked here because
 * any one of them silently disables the control rather than breaking it.
 */
describe('a collection grid can be arranged from its own block', () => {
  it('a card carries the id of the row it came from', async () => {
    const { itemAsCard } = await import('../lib/content/listings');
    const card = itemAsCard(
      { title: 'Hvar', sections: [] } as never,
      'guides',
      'hvar',
      [],
      'ITEM-1',
    );
    // Without this the pane has titles and nothing to reorder BY.
    expect(card.id).toBe('ITEM-1');
  });

  it('and a card built without one simply has none, rather than a wrong one', async () => {
    const { itemAsCard } = await import('../lib/content/listings');
    const card = itemAsCard({ title: 'Hvar', sections: [] } as never, 'guides', 'hvar', []);
    expect(card.id).toBeUndefined();
  });

  it('the writer is keyed on the collection SHORT NAME, which is all the block has', async () => {
    /*
     * The block knows 'guides' because that is what somebody typed into it; it
     * has never seen a uuid. Keying the writer on the key is what lets the pane
     * and the collections screen call one action.
     */
    const { reorderItems } = await import('../lib/db/collections');
    log.length = 0;
    respond('update public.collection_items', [{ id: 'i1' }]);
    await reorderItems(ALPHA, 'guides', ['i1']);

    const write = log.find((s) => s.sql.includes('update public.collection_items'))!;
    expect(write.params).toContain('guides');
    // Joined to collections rather than filtered in JS, so an id from another
    // collection updates no rows at all.
    expect(write.sql).toContain('public.collections c');
    expect(write.sql).toContain('c.key =');
  });

  it('the pane shows the arrows only when the order is actually hand-set', () => {
    const pane = readFileSync(join(__dirname, '..', 'components', 'editor', 'Properties.tsx'), 'utf8');
    /*
     * Under any of the other four orders the position is not what decides the
     * sequence, so arrows there would move a number nothing reads and appear to
     * do nothing at all, which is the complaint this whole thread began with.
     */
    expect(pane).toContain("block.props.order === 'manual'");
    expect(pane).toContain('<ListingOrderArrows');
    // It is handed the cards the canvas is drawing, so it needs no read of its own.
    expect(pane).toContain('listings?.get(key)');
  });

  it('and the canvas is told about the move, so it redraws without a reload', () => {
    const shell = readFileSync(join(__dirname, '..', 'components', 'editor', 'EditorShell.tsx'), 'utf8');
    /*
     * Writing to the database alone would leave the grid showing the old order
     * until a reload, which reads as the arrows not working: exactly the report
     * that started this.
     */
    expect(shell).toContain('const reorderCards = useCallback(');
    expect(shell).toContain('onListingOrder={reorderCards}');
    expect(shell).toContain('listings={cards}');
  });
});
