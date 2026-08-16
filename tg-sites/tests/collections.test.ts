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
  safeSlug,
  safeTags,
  type CollectionItem,
} from '../lib/content/collection';
import { itemAsPage, itemMeta, pageAsItem } from '../lib/content/collection-page';
import {
  fillListings,
  fillPageListings,
  itemAsCard,
  listingIn,
  listingsIn,
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
      date: '',
      tags: [],
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
      date: '',
      tags: [],
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
      date: '2026-08-03',
      tags: [],
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
      ['alt', 'date', 'image', 'sections', 'summary', 'tags', 'title', 'version'],
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
      .toEqual({ collection: 'blog', count: 3 });
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
      .toEqual([{ collection: 'blog', count: 6 }]);
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

    expect(wanted).toEqual([{ collection: 'blog', count: 9 }]);
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
});

describe('filling the listings in', () => {
  const data = new Map([
    ['blog', [{ title: 'One' }, { title: 'Two' }, { title: 'Three' }]],
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
    const filled = fillListings(tree, new Map([['blog', []]]));

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

    const [found] = await listPublished(ALPHA, 'blog', 6);
    expect(found.item.title).toBe('Ten things');
    expect(found.slug).toBe('ten-things');
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
    respond('select key from public.collections', [{ key: 'blog' }]);

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
    expect(route).toContain('listingsIn([regions.header, page.content, regions.footer])');
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
});
