/**
 * Blog posts in the site's own search.
 *
 * WHY THIS FILE EXISTS. Site search read `public.pages` and nothing else, so a
 * visitor searching a travel site for "Crete" was never shown the post about
 * Crete. Found on 20 Aug 2026 while checking Duda's "Search Posts" element
 * against what we already had. The fault is not that search was missing, it is
 * that search ANSWERED and left half the site out of the answer, which is the
 * sort of thing a client discovers eighteen months later.
 *
 * So the tests below are not really about a new function. They are about the
 * three ways this can silently go wrong again:
 *
 *   1. The corpus loses a source. The route has to ask for pages AND posts, and
 *      the last assertion in this file reads the route to check it still does.
 *   2. The live rule drifts. A search must never surface a draft, and must never
 *      surface a post scheduled for next Tuesday. Both are enforced by the
 *      renderer POLICY rather than by a WHERE clause, so both halves of that
 *      claim are asserted: the query has no filter, and the migration has one.
 *   3. The address stops matching. A result that 404s is worse than no result.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createSection } from '../lib/content/factory';
import { searchDocs } from '../lib/content/search';
import type { Section } from '../lib/content/schema';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A one-column section holding whatever blocks a test wants, from the real factory. */
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

/** A stored post row, as the driver would hand it back. */
function row(overrides: Record<string, unknown> = {}) {
  return {
    key: 'blog',
    slug: 'ten-things-in-crete',
    data: {
      version: 1,
      title: 'Ten things to do in Crete',
      summary: 'Our pick of the island, from Chania to the Samaria Gorge.',
      author: 'Sarah Jenkins',
      tags: ['Greece', 'Family holidays'],
      sections: [
        section([
          { id: 'b1', type: 'text', props: { html: '<p>The Samaria Gorge walk takes a full day.</p>' } },
        ]),
      ],
      ...(overrides.data as Record<string, unknown> | undefined),
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// The fake driver. Same shape as tests/collections.test.ts and tests/db.test.ts.
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
    const result = await fn(sql);
    return result;
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

/** The statement that actually touched the table, not the column fragment. */
function itemQuery(): Statement {
  return log.find((s) => s.sql.includes('public.collection_items') && s.sql.includes('?'))!;
}

// ---------------------------------------------------------------------------
// The read
// ---------------------------------------------------------------------------

describe('listPublishedItemsForSearch', () => {
  it('reads as the READ-ONLY role, never as the app role', async () => {
    const { listPublishedItemsForSearch } = await import('../lib/db/collections');

    await listPublishedItemsForSearch(ALPHA);

    for (const statement of log.filter((s) => s.sql.includes('public.collection_items'))) {
      expect(statement.role).toBe('renderer');
    }
  });

  /*
   * THE ONE THAT MATTERS MOST. A draft post and a post scheduled for next
   * Tuesday are the same shape of secret, and neither is kept out by anything in
   * this query. The policy does it, so the query must not grow a filter that
   * makes the policy look optional.
   */
  it('never filters on status or published_at itself', async () => {
    const { listPublishedItemsForSearch } = await import('../lib/db/collections');

    respond('from public.collection_items', []);
    await listPublishedItemsForSearch(ALPHA);

    const read = itemQuery();
    expect(read.sql).not.toContain('status');
    expect(read.sql).not.toContain('now()');
  });

  it('and the policy that hides a draft AND a scheduled post is still in the migration', () => {
    const sql = readFileSync(
      join(__dirname, '..', 'db', 'migrations', '0020_schedule_publishing.sql'),
      'utf8',
    );

    const policy = sql.slice(sql.indexOf('create policy collection_items_renderer'));
    const clause = policy.slice(0, policy.indexOf(';'));

    expect(clause).toContain('to tg_sites_renderer');
    expect(clause).toContain("status = 'published'");
    // The scheduled gate. Without this a post dated next Tuesday is searchable
    // today, and the result opens a 404.
    expect(clause).toContain('published_at <= now()');
  });

  it('caps how many posts a search reads, newest first', async () => {
    const { listPublishedItemsForSearch, MAX_SEARCH_ITEMS } = await import('../lib/db/collections');

    await listPublishedItemsForSearch(ALPHA);

    const read = itemQuery();
    expect(read.params).toContain(MAX_SEARCH_ITEMS);
    expect(read.sql).toContain('order by i.published_at desc');
  });

  /*
   * The cap is a real limit, not a formality, so it is named and asserted rather
   * than left as a literal somebody can raise to 50,000 without noticing what
   * that means for a request that reads every body.
   */
  it('has a cap a real client will not reach', async () => {
    const { MAX_SEARCH_ITEMS } = await import('../lib/db/collections');
    expect(MAX_SEARCH_ITEMS).toBeGreaterThanOrEqual(250);
    expect(MAX_SEARCH_ITEMS).toBeLessThanOrEqual(2000);
  });

  it('addresses a post exactly as the published route resolves it', async () => {
    const { listPublishedItemsForSearch } = await import('../lib/db/collections');

    respond('from public.collection_items', [row()]);
    const [doc] = await listPublishedItemsForSearch(ALPHA);

    // No leading slash: the SearchDoc convention, which SearchResults turns
    // into `/${hit.path}` and the route splits back into key and slug.
    expect(doc.path).toBe('blog/ten-things-in-crete');
    expect(doc.title).toBe('Ten things to do in Crete');
  });

  it('reads the article itself, not just the fields around it', async () => {
    const { listPublishedItemsForSearch } = await import('../lib/db/collections');

    respond('from public.collection_items', [row()]);
    const [doc] = await listPublishedItemsForSearch(ALPHA);

    expect(doc.text).toContain('Samaria Gorge walk takes a full day');
    // As words, not as the JSON around them. pageText strips the markup.
    expect(doc.text).not.toContain('<p>');
  });

  it('puts the summary first, so a snippet reads as a sentence', async () => {
    const { listPublishedItemsForSearch } = await import('../lib/db/collections');

    respond('from public.collection_items', [row()]);
    const [doc] = await listPublishedItemsForSearch(ALPHA);

    expect(doc.text.indexOf('Our pick of the island')).toBeGreaterThanOrEqual(0);
    expect(doc.text.indexOf('Our pick of the island'))
      .toBeLessThan(doc.text.indexOf('Samaria Gorge'));
  });

  it('finds a post by its tag even when the words are nowhere in it', async () => {
    const { listPublishedItemsForSearch } = await import('../lib/db/collections');

    respond('from public.collection_items', [row()]);
    const [doc] = await listPublishedItemsForSearch(ALPHA);

    expect(doc.text).toContain('Family holidays');
  });

  it('finds a post by its byline, because "posts by Sarah" is a real search', async () => {
    const { listPublishedItemsForSearch } = await import('../lib/db/collections');

    respond('from public.collection_items', [row()]);
    const [doc] = await listPublishedItemsForSearch(ALPHA);

    expect(doc.text).toContain('Sarah Jenkins');
  });

  it('parses what came back, so a bad row is an error rather than a broken result', async () => {
    const { listPublishedItemsForSearch } = await import('../lib/db/collections');

    respond('from public.collection_items', [
      { key: 'blog', slug: 'ten-things', data: { version: 1, title: 'x'.repeat(500) } },
    ]);

    await expect(listPublishedItemsForSearch(ALPHA)).rejects.toThrow(/will not parse/);
  });

  it('copes with a post that is a title and nothing else', async () => {
    const { listPublishedItemsForSearch } = await import('../lib/db/collections');

    respond('from public.collection_items', [
      { key: 'blog', slug: 'coming-soon', data: { version: 1, title: 'Coming soon' } },
    ]);
    const [doc] = await listPublishedItemsForSearch(ALPHA);

    expect(doc.path).toBe('blog/coming-soon');
    expect(doc.title).toBe('Coming soon');
    expect(doc.text).toBe('');
  });
});

// ---------------------------------------------------------------------------
// End to end, through the ranker the route actually uses
// ---------------------------------------------------------------------------

describe('searching a corpus of pages and posts', () => {
  it('finds the post about Crete when only the post mentions Crete', async () => {
    const { listPublishedItemsForSearch } = await import('../lib/db/collections');

    respond('from public.collection_items', [row()]);
    const posts = await listPublishedItemsForSearch(ALPHA);

    const pages = [
      { path: '', title: 'Home', text: 'Tailor made holidays from Bolton.' },
      { path: 'about', title: 'About us', text: 'Forty years of arranging trips.' },
    ];

    const hits = searchDocs([...pages, ...posts], 'Samaria Gorge');

    expect(hits).toHaveLength(1);
    expect(hits[0].path).toBe('blog/ten-things-in-crete');
  });

  it('ranks a page and a post together, with no thumb on the scale', async () => {
    const { listPublishedItemsForSearch } = await import('../lib/db/collections');

    respond('from public.collection_items', [row()]);
    const posts = await listPublishedItemsForSearch(ALPHA);

    const pages = [{ path: 'greece', title: 'Greece', text: 'Holidays in Crete and beyond.' }];
    const hits = searchDocs([...pages, ...posts], 'Crete');

    // Both are answers. Which one wins is the score's business; that both are
    // present at all is this test's.
    expect(hits.map((hit) => hit.path).sort()).toEqual(['blog/ten-things-in-crete', 'greece']);
  });
});

// ---------------------------------------------------------------------------
// The route still asks for both. This is the assertion that would have caught
// the original fault, so it is written to keep catching it.
// ---------------------------------------------------------------------------

describe('the search route reads the whole corpus', () => {
  const route = readFileSync(
    join(__dirname, '..', 'app', 'site', '[host]', '[[...path]]', 'page.tsx'),
    'utf8',
  );

  it('asks for pages and for posts', () => {
    expect(route).toContain('listPublishedForSearch(tenantId)');
    expect(route).toContain('listPublishedItemsForSearch(tenantId)');
  });

  it('ranks them as one corpus rather than searching only one of them', () => {
    expect(route).toContain('searchDocs([...pageDocs, ...postDocs], query)');
  });
});
