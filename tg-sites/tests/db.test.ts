/**
 * The database layer, tested without a database.
 *
 * The SQL half of tenant isolation is proven against the real thing by
 * db/isolation-check.sql, which is where policies belong. What that cannot
 * check is the TypeScript half: that every query really does go through a
 * transaction, that the tenant really is set before anything else runs, and
 * that nothing quietly opens a connection round the side.
 *
 * So these tests stand a fake driver in for postgres and assert on the exact
 * sequence of statements it receives. A fake is right here rather than a
 * compromise: the interesting failure is an ORDERING one, and ordering is
 * something you assert on, not something you observe by reading rows back.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

// The blob store is unreachable from here and irrelevant to the SQL these tests
// assert on, so copyIntoStore is a stand-in a test configures per case. Only
// lib/db/duplicate.ts reaches it; nothing else here imports the module.
import { copyIntoStore } from '../lib/media/blob';

// ---------------------------------------------------------------------------
// A fake driver
// ---------------------------------------------------------------------------

interface Statement {
  role: string;
  sql: string;
  params: unknown[];
}

/** Every statement any test has run, in order, across both roles. */
let log: Statement[] = [];

/**
 * Canned answers, matched on a fragment of the SQL rather than by position.
 *
 * Position looks simpler and is a trap: set_config is itself a query, and so
 * is every nested fragment, so a positional queue hands the caller's first
 * real answer to the tenant setting. Two tests here passed for that reason
 * before this was matched by content instead.
 */
let responses: Array<{ match: string; rows: Record<string, unknown>[] }> = [];

function respond(match: string, rows: Record<string, unknown>[]): void {
  responses.push({ match, rows });
}

let openTransactions = 0;
let maxConcurrentTransactions = 0;

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

  // porsager lets a tagged fragment be nested inside another query. The fake
  // only needs it to be callable and to leave a trace, which the log above
  // already does.
  const sql = query as unknown as Record<string, unknown> & typeof query;

  // The real driver wraps a value so it is sent as JSON. The fake marks it so
  // a test can tell a wrapped object from a pre-stringified one.
  sql.json = (value: unknown) => ({ __json: value });

  sql.begin = async (fn: (tx: unknown) => Promise<unknown>) => {
    openTransactions += 1;
    maxConcurrentTransactions = Math.max(maxConcurrentTransactions, openTransactions);
    log.push({ role, sql: 'BEGIN', params: [] });
    try {
      const result = await fn(sql);
      log.push({ role, sql: 'COMMIT', params: [] });
      return result;
    } catch (error) {
      log.push({ role, sql: 'ROLLBACK', params: [] });
      throw error;
    } finally {
      openTransactions -= 1;
    }
  };

  return sql;
}

vi.mock('../lib/db/client', () => ({
  db: (role: string) => fakeSql(role),
  usernameFrom: (connection: string) => {
    try {
      const user = new URL(connection).username;
      return user ? decodeURIComponent(user).split('.')[0] || null : null;
    } catch {
      return null;
    }
  },
}));

// duplicate.ts is the only db module that touches the blob store, to copy an
// image into a new tenant's own object. The store is unreachable here, so the
// copy is a stand-in each test configures.
vi.mock('../lib/media/blob', () => ({ copyIntoStore: vi.fn() }));

const ALPHA = '11111111-1111-1111-1111-111111111111';
const BETA = '22222222-2222-2222-2222-222222222222';

beforeEach(() => {
  log = [];
  responses = [];
  openTransactions = 0;
  maxConcurrentTransactions = 0;
});

// ---------------------------------------------------------------------------

describe('withTenant', () => {
  it('sets the tenant as the very first statement inside the transaction', async () => {
    const { withTenant } = await import('../lib/db/withTenant');

    await withTenant(ALPHA, async (tx) => {
      await tx`select 1 from public.pages`;
    });

    expect(log.map((s) => s.sql)).toEqual([
      'BEGIN',
      'select set_config(\'app.current_tenant_id\', ? , true)'.replace(/\s+/g, ' '),
      'select 1 from public.pages',
      'COMMIT',
    ]);
    expect(log[1].params).toEqual([ALPHA]);
  });

  it('scopes the setting to the transaction, not the connection', async () => {
    const { withTenant } = await import('../lib/db/withTenant');

    await withTenant(ALPHA, async () => {});

    // The third argument to set_config is the local flag. Without it the
    // value survives on a pooled connection and the next request inherits
    // another client's tenant, which is the worst bug this schema can have.
    expect(log[1].sql).toContain('true');
    expect(log[1].sql).not.toContain('false');
  });

  it('never runs a query outside a transaction', async () => {
    const { withTenant } = await import('../lib/db/withTenant');

    await withTenant(ALPHA, async (tx) => {
      await tx`select 1`;
    });

    let depth = 0;
    for (const statement of log) {
      if (statement.sql === 'BEGIN') depth += 1;
      else if (statement.sql === 'COMMIT' || statement.sql === 'ROLLBACK') depth -= 1;
      else expect(depth, `"${statement.sql}" ran outside a transaction`).toBeGreaterThan(0);
    }
  });

  it('uses the read-only role for public reads', async () => {
    const { withPublicTenant, withTenant } = await import('../lib/db/withTenant');

    await withTenant(ALPHA, async (tx) => { await tx`select 1`; });
    await withPublicTenant(ALPHA, async (tx) => { await tx`select 2`; });

    expect(log.find((s) => s.sql === 'select 1')?.role).toBe('app');
    expect(log.find((s) => s.sql === 'select 2')?.role).toBe('renderer');
  });

  it('refuses a nested call for a different tenant', async () => {
    const { withTenant } = await import('../lib/db/withTenant');

    await expect(
      withTenant(ALPHA, async () => {
        await withTenant(BETA, async () => 'should never run');
      }),
    ).rejects.toThrow(/cannot open 22222222/);
  });

  it('reuses the open transaction when nested for the same tenant', async () => {
    const { withTenant } = await import('../lib/db/withTenant');

    await withTenant(ALPHA, async () => {
      await withTenant(ALPHA, async (tx) => { await tx`select nested`; });
    });

    // One BEGIN, not two. A second one would ask the pool for another
    // connection while this one still holds the first, which at a pool size
    // of one is a deadlock rather than an error.
    expect(log.filter((s) => s.sql === 'BEGIN')).toHaveLength(1);
    expect(maxConcurrentTransactions).toBe(1);
    // And the tenant is not set twice.
    expect(log.filter((s) => s.sql.includes('set_config'))).toHaveLength(1);
  });

  it.each([
    ['an empty string', ''],
    ['the word undefined', 'undefined'],
    ['a number', 42],
    ['null', null],
    ['a slug', 'iso-alpha'],
    ['SQL', "' or true --"],
  ])('refuses %s as a tenant id', async (_label, value) => {
    const { withTenant } = await import('../lib/db/withTenant');

    await expect(
      withTenant(value as string, async () => 'should never run'),
    ).rejects.toThrow(/Not a tenant id/);

    // And nothing reached the database.
    expect(log).toHaveLength(0);
  });

  it('accepts a tenant id whatever its case, and normalises it', async () => {
    const { withTenant } = await import('../lib/db/withTenant');

    await withTenant(ALPHA.toUpperCase(), async () => {});
    expect(log[1].params).toEqual([ALPHA]);
  });

  it('rolls back when the callback throws', async () => {
    const { withTenant } = await import('../lib/db/withTenant');

    await expect(
      withTenant(ALPHA, async () => {
        throw new Error('something went wrong');
      }),
    ).rejects.toThrow('something went wrong');

    expect(log.map((s) => s.sql)).toContain('ROLLBACK');
    expect(log.map((s) => s.sql)).not.toContain('COMMIT');
  });

  it('reports no tenant outside a transaction', async () => {
    const { currentTenantId, withTenant } = await import('../lib/db/withTenant');

    expect(currentTenantId()).toBeNull();
    await withTenant(ALPHA, async () => {
      expect(currentTenantId()).toBe(ALPHA);
    });
    expect(currentTenantId()).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('page queries', () => {
  it('publishes and records the audit row in one transaction', async () => {
    const { publishPage } = await import('../lib/db/pages');

    respond('published_content = draft_content', [{
      id: 'aaaa', parent_id: null, slug: '', title: 'Home',
      status: 'published', published_at: '2026-07-29T00:00:00Z',
      updated_at: '2026-07-29T00:00:00Z', has_unpublished_changes: false,
    }]);

    await publishPage(ALPHA, 'aaaa', 'user-1');

    const inside = log.slice(
      log.findIndex((s) => s.sql === 'BEGIN'),
      log.findIndex((s) => s.sql === 'COMMIT'),
    );

    expect(inside.some((s) => s.sql.includes('published_content = draft_content'))).toBe(true);
    expect(inside.some((s) => s.sql.includes('insert into public.publish_events'))).toBe(true);
  });

  /*
   * The prune runs in the SAME transaction as the insert, and that is not a
   * detail. A publish that recorded its snapshot and then failed to prune would
   * leave the history one over the limit, which is harmless. A publish that
   * pruned and then failed to insert would delete the oldest version to make room
   * for one that never arrived, which is not.
   */
  it('prunes the history inside the publish transaction', async () => {
    const { publishPage, PUBLISH_HISTORY_LIMIT } = await import('../lib/db/pages');

    respond('published_content = draft_content', [{
      id: 'aaaa', parent_id: null, slug: '', title: 'Home',
      status: 'published', published_at: '2026-07-29T00:00:00Z',
      updated_at: '2026-07-29T00:00:00Z', has_unpublished_changes: false,
    }]);

    await publishPage(ALPHA, 'aaaa', 'user-1');

    const inside = log.slice(
      log.findIndex((s) => s.sql === 'BEGIN'),
      log.findIndex((s) => s.sql === 'COMMIT'),
    );

    const prune = inside.find((s) => s.sql.includes('delete from public.publish_events'));
    expect(prune, 'nothing prunes the history').toBeTruthy();

    // After the insert, or it makes room for a row that may never land.
    const insertAt = inside.findIndex((s) => s.sql.includes('insert into public.publish_events'));
    const pruneAt = inside.findIndex((s) => s.sql.includes('delete from public.publish_events'));
    expect(pruneAt).toBeGreaterThan(insertAt);

    // Scoped to this page, carrying the limit, and ordered totally. created_at
    // alone is not unique, so two publishes in one clock tick would either both
    // survive or both go.
    expect(prune!.sql).toContain('order by created_at desc, id desc');
    expect(prune!.params).toContain(PUBLISH_HISTORY_LIMIT);
    expect(prune!.params.filter((v) => v === 'aaaa')).toHaveLength(2);
  });

  it('records the title alongside the snapshot, from the row rather than JavaScript', async () => {
    const { publishPage } = await import('../lib/db/pages');

    respond('published_content = draft_content', [{
      id: 'aaaa', parent_id: null, slug: '', title: 'Home',
      status: 'published', published_at: '2026-07-29T00:00:00Z',
      updated_at: '2026-07-29T00:00:00Z', has_unpublished_changes: false,
    }]);

    await publishPage(ALPHA, 'aaaa', 'user-1');

    const insert = log.find((s) => s.sql.includes('insert into public.publish_events'))!;
    // select ... from public.pages, not a parameter: the snapshot and the title
    // are read back out of the row so they cannot drift from what was published.
    expect(insert.sql).toContain('from public.pages');
    expect(insert.sql).toContain('snapshot, title');
    expect(insert.params).not.toContain('Home');
  });

  it('the version list does not drag every snapshot across the wire', async () => {
    const { listPublishes } = await import('../lib/db/pages');

    respond('from public.publish_events', [
      { id: 'p1', user_id: 'user-1', title: 'Home', created_at: '2026-07-29T00:00:00Z' },
      { id: 'p2', user_id: null, title: null, created_at: '2026-07-28T00:00:00Z' },
    ]);

    const rows = await listPublishes(ALPHA, 'aaaa');

    const select = log.find((s) => s.sql.includes('from public.publish_events'))!;
    // The whole reason the title column exists. Selecting the snapshot here would
    // pull a page-sized blob per row to render one line of text from each.
    expect(select.sql).not.toContain('snapshot');
    expect(select.sql).toContain('order by created_at desc, id desc');

    expect(rows[0].title).toBe('Home');
    // Null rather than an invented empty string: written before 0014, title unknown.
    expect(rows[1].title).toBeNull();
    expect(rows[1].userId).toBeNull();
  });

  it('restores a version to the DRAFT and leaves the live copy alone', async () => {
    const { restorePublish } = await import('../lib/db/pages');

    respond('from public.publish_events', [{
      snapshot: { version: 1, id: 'aaaa', title: 'Tuesday', slug: '', sections: [] },
    }]);
    respond('update public.pages', [{
      id: 'aaaa', parent_id: null, slug: '', title: 'Tuesday', seo: {},
      status: 'published', published_at: '2026-07-29T00:00:00Z',
      updated_at: '2026-07-30T00:00:00Z', has_unpublished_changes: true,
      draft_content: { version: 1, id: 'aaaa', title: 'Tuesday', slug: '', sections: [] },
    }]);

    const restored = await restorePublish(ALPHA, 'aaaa', 'p1', 'user-1');

    const update = log.find((s) => s.sql.includes('update public.pages'))!;
    expect(update.sql).toContain('draft_content =');
    // The three things that must NOT be touched. Restoring is not publishing.
    expect(update.sql).not.toContain('published_content');
    expect(update.sql).not.toContain('published_at');
    expect(update.sql).not.toContain("status");

    // The title and SEO come back too, from the snapshot's own JSON.
    expect(update.sql).toContain('title');
    expect(update.sql).toContain('seo');
    expect(restored?.content.title).toBe('Tuesday');
  });

  it('will not restore a version belonging to another page', async () => {
    const { restorePublish } = await import('../lib/db/pages');

    // No canned answer: the lookup matches on publish id AND page id, so a
    // borrowed id from a sibling page finds nothing.
    const restored = await restorePublish(ALPHA, 'aaaa', 'belongs-to-bbbb');

    expect(restored).toBeNull();
    const lookup = log.find((s) => s.sql.includes('from public.publish_events'))!;
    expect(lookup.params).toEqual(expect.arrayContaining(['belongs-to-bbbb', 'aaaa']));
    // And nothing was written.
    expect(log.some((s) => s.sql.includes('update public.pages'))).toBe(false);
  });

  it('refuses a snapshot that will not parse rather than writing it back', async () => {
    const { restorePublish } = await import('../lib/db/pages');

    respond('from public.publish_events', [{ snapshot: { nonsense: true } }]);

    await expect(restorePublish(ALPHA, 'aaaa', 'p1')).rejects.toThrow(/cannot be restored/);
    expect(log.some((s) => s.sql.includes('update public.pages'))).toBe(false);
  });

  it('does not write the audit row when there was nothing to publish', async () => {
    const { publishPage } = await import('../lib/db/pages');

    // No canned answer, so the update matches no row: wrong tenant, or gone.
    const result = await publishPage(ALPHA, 'aaaa');

    expect(result).toBeNull();
    expect(log.some((s) => s.sql.includes('publish_events'))).toBe(false);
  });

  it('reads the published page as the renderer, never as the editor', async () => {
    const { getPublishedPage } = await import('../lib/db/pages');

    respond('from public.pages', [{
      id: 'aaaa', slug: '', title: 'Home', seo: {},
      published_content: { version: 1, id: 'aaaa', title: 'Home', slug: '', sections: [] },
    }]);

    const page = await getPublishedPage(ALPHA, '/');

    expect(page?.title).toBe('Home');
    expect(log.every((s) => s.role === 'renderer')).toBe(true);
    expect(log.some((s) => s.role === 'app')).toBe(false);
  });

  it('treats a page published with no content as absent', async () => {
    const { getPublishedPage } = await import('../lib/db/pages');

    respond('from public.pages', [
      { id: 'aaaa', slug: '', title: 'Home', seo: {}, published_content: null },
    ]);

    expect(await getPublishedPage(ALPHA, '/')).toBeNull();
  });

  it('walks a nested path one segment at a time', async () => {
    const { getPublishedPage } = await import('../lib/db/pages');

    respond('parent_id is null', [{ id: 'parent', slug: 'destinations', title: 'Destinations', seo: {}, published_content: {} }]);
    respond('parent_id =', [{
      id: 'child', slug: 'greece', title: 'Greece', seo: {},
      published_content: { version: 1, id: 'child', title: 'Greece', slug: 'greece', sections: [] },
    }]);

    const page = await getPublishedPage(ALPHA, 'destinations/greece');

    expect(page?.id).toBe('child');
    // The child lookup is scoped to the parent found in the first step, so a
    // page cannot be reached at a path it does not actually sit under.
    const child = log.find((s) => s.sql.includes('parent_id ='));
    expect(child?.params).toEqual(['parent', 'greece']);
  });

  it('refuses an absurdly deep path without asking the database', async () => {
    const { getPublishedPage } = await import('../lib/db/pages');

    expect(await getPublishedPage(ALPHA, 'a/b/c/d/e/f/g/h')).toBeNull();
    expect(log).toHaveLength(0);
  });

  it('refuses to save a malformed page before opening a transaction', async () => {
    const { saveDraft } = await import('../lib/db/pages');

    await expect(saveDraft(ALPHA, 'aaaa', { nonsense: true })).rejects.toThrow(
      /Refusing to save a malformed page/,
    );
    expect(log).toHaveLength(0);
  });

  /*
   * THE BUG THIS EXISTS FOR
   *
   * jsonb used to be written as `${JSON.stringify(value)}::jsonb`. The driver
   * serialised that JS string to JSON and the cast read it back, so what
   * landed in the database was a JSON *string* containing JSON. Reading `seo`
   * threw, which is how it was found. Reading `draft_content` did NOT throw:
   * the mapping layer skipped anything that was not already an object, so a
   * saved page came back empty and looked lost.
   *
   * Nothing in the unit suite caught it, because a fake driver happily
   * accepts a string. So the invariant is asserted directly: a JSON column is
   * handed an OBJECT, never a string someone stringified first.
   */
  it('sends JSON columns as objects, never pre-stringified', async () => {
    const { saveDraft } = await import('../lib/db/pages');
    const { createPage } = await import('../lib/content/factory');

    await saveDraft(ALPHA, 'aaaa', createPage('Home', ''));

    const write = log.find((s) => s.sql.includes('draft_content ='));
    expect(write, 'no draft write happened').toBeTruthy();

    // Not "no param is a string": `title` is legitimately one. The invariant
    // is narrower and exact: no parameter may be JSON that someone has
    // already serialised, because that is what gets double encoded.
    for (const param of write!.params) {
      if (typeof param !== 'string') continue;

      let isSerialisedJson = false;
      try {
        const decoded: unknown = JSON.parse(param);
        isSerialisedJson = decoded !== null && typeof decoded === 'object';
      } catch {
        // Ordinary text. Exactly what a text column should get.
      }

      expect(
        isSerialisedJson,
        `pre-stringified JSON was passed as a parameter: ${param.slice(0, 60)}`,
      ).toBe(false);
    }

    // And the content really is wrapped by the driver's helper.
    expect(write!.params.some((p) => p !== null && typeof p === 'object' && '__json' in (p as object)))
      .toBe(true);
  });

  it('reads a page whose JSON was stored double encoded', async () => {
    const { getPage } = await import('../lib/db/pages');
    const { createPage } = await import('../lib/content/factory');

    // Exactly what the old writes left behind: the whole tree as a string.
    const content = createPage('Home', '');
    respond('draft_content', [{
      id: 'aaaa', parent_id: null, slug: '', title: 'Home', status: 'draft',
      published_at: null, updated_at: '2026-07-29T00:00:00Z',
      has_unpublished_changes: true,
      seo: JSON.stringify({ noindex: false }),
      draft_content: JSON.stringify(content),
    }]);

    const page = await getPage(ALPHA, 'aaaa');

    // Not an empty page, and not a throw. The content survives.
    expect(page?.content.title).toBe('Home');
    expect(page?.content.sections).toEqual(content.sections);
  });

  it('refuses to make a page its own parent', async () => {
    const { updatePageMeta } = await import('../lib/db/pages');

    await expect(updatePageMeta(ALPHA, 'aaaa', { parentId: 'aaaa' })).rejects.toThrow(
      /own parent/,
    );
    expect(log).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

/**
 * The activity log is written from inside the change it records.
 *
 * The claim is an ORDERING one, like the publish audit above: recordActivity
 * calls withTenant again, which reuses the mutation's open transaction rather
 * than opening a second, so the line lands in the same atomic unit and rolls
 * back with the change if it fails. One BEGIN, not two, is how that shows.
 */
describe('the activity log', () => {
  const SUMMARY_ROW = {
    id: 'aaaa', parent_id: null, slug: '', title: 'Home',
    status: 'published', published_at: '2026-08-17T00:00:00Z',
    updated_at: '2026-08-17T00:00:00Z', has_unpublished_changes: false,
  };

  const inside = () =>
    log.slice(
      log.findIndex((s) => s.sql === 'BEGIN'),
      log.findIndex((s) => s.sql === 'COMMIT'),
    );

  it('writes the publish line in the publish transaction, joining not reopening', async () => {
    const { publishPage } = await import('../lib/db/pages');
    respond('published_content = draft_content', [SUMMARY_ROW]);

    await publishPage(ALPHA, 'aaaa', 'user-1');

    const line = inside().find((s) => s.sql.includes('insert into public.site_activity'));
    expect(line, 'the publish was not logged inside its transaction').toBeTruthy();
    expect(log.filter((s) => s.sql === 'BEGIN')).toHaveLength(1);
    // Actor, tag and the human line, built from the row's own title.
    expect(line!.params).toEqual(
      expect.arrayContaining(['user-1', 'page.publish', 'Published the Home page']),
    );
  });

  it('writes the create line, named from the new page', async () => {
    const { createPage } = await import('../lib/db/pages');
    respond('insert into public.pages', [{
      ...SUMMARY_ROW, status: 'draft', published_at: null, has_unpublished_changes: true,
      seo: {}, draft_content: { version: 1, id: 'aaaa', title: 'Home', slug: '', sections: [] },
    }]);

    await createPage(ALPHA, { title: 'Home', slug: '' }, 'user-1');

    const line = inside().find((s) => s.sql.includes('insert into public.site_activity'));
    expect(line?.params).toEqual(
      expect.arrayContaining(['user-1', 'page.create', 'Created the Home page']),
    );
    expect(log.filter((s) => s.sql === 'BEGIN')).toHaveLength(1);
  });

  it('reads the title before the delete, then logs it', async () => {
    const { deletePage } = await import('../lib/db/pages');
    respond('delete from public.pages', [{ id: 'aaaa', title: 'About' }]);

    await deletePage(ALPHA, 'aaaa', 'user-1');

    // The name is read on the way out, because afterwards there is nothing left
    // to work it out from.
    const del = log.find((s) => s.sql.includes('delete from public.pages'))!;
    expect(del.sql).toContain('returning id, title');
    const line = inside().find((s) => s.sql.includes('insert into public.site_activity'));
    expect(line?.params).toEqual(
      expect.arrayContaining(['user-1', 'page.delete', 'Deleted the About page']),
    );
  });

  it('logs nothing for a delete that matched no page', async () => {
    const { deletePage } = await import('../lib/db/pages');
    // No canned answer, so the delete matches nothing: wrong tenant, or gone.
    expect(await deletePage(ALPHA, 'aaaa', 'user-1')).toBe(false);
    expect(log.some((s) => s.sql.includes('insert into public.site_activity'))).toBe(false);
  });

  it('reads the log newest first and capped, through the app role', async () => {
    const { listActivity } = await import('../lib/db/activity');
    respond('from public.site_activity', [
      { id: 'e2', actor_id: 'user-1', action: 'page.publish', summary: 'Published the Home page', created_at: '2026-08-17T10:00:00Z' },
      { id: 'e1', actor_id: null, action: 'page.create', summary: 'Created the Home page', created_at: '2026-08-17T09:00:00Z' },
    ]);

    const rows = await listActivity(ALPHA, 5000);

    const select = log.find((s) => s.sql.includes('from public.site_activity'))!;
    expect(select.role).toBe('app');
    expect(select.sql).toContain('order by created_at desc, id desc');
    // The limit is capped rather than trusted: 5000 becomes 200, so a caller
    // cannot ask for the whole table.
    expect(select.params).toContain(200);

    expect(rows[0].action).toBe('page.publish');
    expect(rows[0].actorId).toBe('user-1');
    // A null actor stays null rather than becoming an empty string.
    expect(rows[1].actorId).toBeNull();
    expect(rows[0].createdAt).toBeInstanceOf(Date);
  });
});

// ---------------------------------------------------------------------------

/**
 * Renaming a page without breaking the links to it.
 *
 * THE STATEMENTS ARE THE CLAIM HERE, which is why this is in the fake-driver
 * file rather than with the rest of the redirect tests. What matters is not what
 * comes back but WHEN each query runs: the old addresses have to be read before
 * the update, because afterwards there is nothing left to work them out from,
 * and every one of them has to be inside the rename's own transaction.
 *
 * That is an ordering property, and ordering is something you assert on rather
 * than something you observe by reading rows back.
 */
describe('renaming a page keeps its old address working', () => {
  /** The one row the update returns, so updatePageMeta does not bail early. */
  const RENAMED = {
    id: 'aaaa', parent_id: null, slug: 'about-us', title: 'About us',
    status: 'published', published_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z', has_unpublished_changes: false,
  };

  /** One published page, at /about, before the rename. */
  function seedTree() {
    respond('published_content is not null as published', [
      { id: 'aaaa', parent_id: null, slug: 'about', published: true },
    ]);
  }

  it('reads the tree, updates, then reads it again and records the move', async () => {
    const { updatePageMeta } = await import('../lib/db/pages');

    seedTree();
    respond('update public.pages set', [RENAMED]);
    // The tree AFTER the update, where the page has moved.
    respond('published_content is not null as published', [
      { id: 'aaaa', parent_id: null, slug: 'about-us', published: true },
    ]);

    await updatePageMeta(ALPHA, 'aaaa', { slug: 'about-us' });

    const inside = log.slice(
      log.findIndex((s) => s.sql === 'BEGIN'),
      log.findIndex((s) => s.sql === 'COMMIT'),
    );

    const readAt = inside.findIndex((s) => s.sql.includes('as published'));
    const updateAt = inside.findIndex((s) => s.sql.includes('update public.pages set'));
    const writeAt = inside.findIndex((s) => s.sql.includes('insert into public.page_redirects'));

    expect(readAt, 'nothing read the addresses').toBeGreaterThan(-1);
    expect(writeAt, 'nothing recorded the move').toBeGreaterThan(-1);

    // The whole claim, in one line: before, then, after.
    expect(readAt).toBeLessThan(updateAt);
    expect(updateAt).toBeLessThan(writeAt);
  });

  it('records the address it used to have, not the one it has now', async () => {
    const { updatePageMeta } = await import('../lib/db/pages');

    seedTree();
    respond('update public.pages set', [RENAMED]);
    respond('published_content is not null as published', [
      { id: 'aaaa', parent_id: null, slug: 'about-us', published: true },
    ]);

    await updatePageMeta(ALPHA, 'aaaa', { slug: 'about-us' });

    const write = log.find((s) => s.sql.includes('insert into public.page_redirects'));
    expect(write?.params).toEqual([ALPHA, 'about', 'aaaa']);
  });

  /*
   * A title-only edit is the common one and moves nothing. Reading the whole
   * tree twice for it would put two queries on every typo fix, and a redirect
   * from an address to itself would be a row that says nothing.
   */
  it('reads no tree at all when only the title changes', async () => {
    const { updatePageMeta } = await import('../lib/db/pages');

    respond('update public.pages set', [RENAMED]);
    await updatePageMeta(ALPHA, 'aaaa', { title: 'About us' });

    expect(log.some((s) => s.sql.includes('as published'))).toBe(false);
    expect(log.some((s) => s.sql.includes('page_redirects'))).toBe(false);
  });

  /*
   * THE PAGE THAT WAS NEVER PUBLISHED. Nobody can have linked to an address it
   * never had, so a redirect from one would be a row pointing at nothing.
   */
  it('records nothing for a draft, which has no address to lose', async () => {
    const { updatePageMeta } = await import('../lib/db/pages');

    respond('published_content is not null as published', [
      { id: 'aaaa', parent_id: null, slug: 'about', published: false },
    ]);
    respond('update public.pages set', [{ ...RENAMED, status: 'draft', published_at: null }]);
    respond('published_content is not null as published', [
      { id: 'aaaa', parent_id: null, slug: 'about-us', published: false },
    ]);

    await updatePageMeta(ALPHA, 'aaaa', { slug: 'about-us' });

    expect(log.some((s) => s.sql.includes('insert into public.page_redirects'))).toBe(false);
  });

  /*
   * THE ONE A HUMAN WOULD FORGET. Renaming a parent changes the address of
   * every page beneath it without any of them being touched, and nothing on
   * screen would say those had moved.
   */
  it('records the children too, since a parent rename moves the whole branch', async () => {
    const { updatePageMeta } = await import('../lib/db/pages');

    respond('published_content is not null as published', [
      { id: 'top', parent_id: null, slug: 'destinations', published: true },
      { id: 'kid', parent_id: 'top', slug: 'greece', published: true },
    ]);
    respond('update public.pages set', [{ ...RENAMED, id: 'top', slug: 'where-to-go' }]);
    respond('published_content is not null as published', [
      { id: 'top', parent_id: null, slug: 'where-to-go', published: true },
      { id: 'kid', parent_id: 'top', slug: 'greece', published: true },
    ]);

    await updatePageMeta(ALPHA, 'top', { slug: 'where-to-go' });

    const written = log
      .filter((s) => s.sql.includes('insert into public.page_redirects'))
      .map((s) => s.params);

    expect(written).toEqual([
      [ALPHA, 'destinations', 'top'],
      [ALPHA, 'destinations/greece', 'kid'],
    ]);
  });

  /*
   * A rename that matched no row moved nothing. Writing a redirect here would
   * record a move that did not happen, and the address it invented would then
   * forward somewhere real.
   */
  /*
   * COUNTED, NOT JUST ABSENT. Asserting that no redirect was written would pass
   * with the guard deleted, because the second tree read would come back empty
   * and there would be nothing to compare. The honest claim is that recordMove
   * is never reached at all, and its first act is to read the tree a second
   * time, so one read means it did not run.
   */
  it('stops before recording anything when the update matched no page', async () => {
    const { updatePageMeta } = await import('../lib/db/pages');

    respond('published_content is not null as published', [
      { id: 'aaaa', parent_id: null, slug: 'about', published: true },
    ]);
    // No response for the update, so it comes back empty.

    expect(await updatePageMeta(ALPHA, 'aaaa', { slug: 'about-us' })).toBeNull();

    const reads = log.filter((s) => s.sql.includes('as published')).length;
    expect(reads, 'it went on and read the tree again').toBe(1);
    expect(log.some((s) => s.sql.includes('insert into public.page_redirects'))).toBe(false);
  });

  it('looks a redirect up as the read-only role', async () => {
    const { resolveRedirect } = await import('../lib/db/redirects');

    respond('from public.page_redirects where from_path', [{ page_id: 'aaaa' }]);
    respond('published_content is not null as published', [
      { id: 'aaaa', parent_id: null, slug: 'about-us', published: true },
    ]);

    expect(await resolveRedirect(ALPHA, '/about/')).toBe('about-us');
    expect(log.every((s) => s.role === 'renderer')).toBe(true);
  });

  it('asks nothing at all for a path that could not be an address here', async () => {
    const { resolveRedirect } = await import('../lib/db/redirects');

    expect(await resolveRedirect(ALPHA, 'a/b/c/d/e/f/g/h')).toBeNull();
    expect(log).toHaveLength(0);
  });

  /*
   * THE INVITE DOOR, and the one claim about it that is not visible anywhere
   * else: it takes a HASH, and a caller who hands it a raw token gets an
   * exception rather than a query that quietly matches nothing.
   *
   * Quietly matching nothing is the dangerous version. The policy compares
   * token_hash to the setting, so a raw token simply finds no row, every link
   * stops working, and the symptom is "invites are broken" with nothing in any
   * log to say why. Failing loudly at the door is the difference between a
   * five-minute fix and an afternoon.
   *
   * It must also touch no database at all, which is the second half: the check
   * happens before the connection is opened.
   */
  it('refuses to look an invite up by anything that is not a hash', async () => {
    const { inviteByToken } = await import('../lib/db/users');

    for (const notAHash of ['', 'a-raw-token', 'A'.repeat(64), 'abc123']) {
      await expect(inviteByToken(notAHash), notAHash).rejects.toThrow(/hash/i);
    }

    expect(log, 'it opened a connection for a value it should have refused').toHaveLength(0);
  });

  it('looks one up by a hash, as the app role, with the token set first', async () => {
    const { inviteByToken } = await import('../lib/db/users');
    const hash = 'a'.repeat(64);

    respond('from public.site_invites', [
      { id: 'inv', tenant_id: ALPHA, email: 'sam@example.com', role: 'editor' },
    ]);

    expect(await inviteByToken(hash)).toEqual({
      id: 'inv',
      tenantId: ALPHA,
      email: 'sam@example.com',
      role: 'editor',
    });

    // The setting has to be the FIRST statement, or the policy has nothing to
    // compare against when the select runs.
    expect(log[0].sql).toBe('BEGIN');
    expect(log[1].sql).toContain('app.invite_token_hash');
    expect(log[1].params).toEqual([hash]);
    expect(log.every((s) => s.role === 'app')).toBe(true);
  });

  it('gives up when the page it points at is no longer reachable', async () => {
    const { resolveRedirect } = await import('../lib/db/redirects');

    respond('from public.page_redirects where from_path', [{ page_id: 'aaaa' }]);
    respond('published_content is not null as published', [
      { id: 'aaaa', parent_id: null, slug: 'about-us', published: false },
    ]);

    expect(await resolveRedirect(ALPHA, 'about')).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('hostname handling', () => {
  it.each([
    ['strips the port', 'Example.COM:3000', 'example.com'],
    ['strips a trailing dot', 'example.com.', 'example.com'],
    ['handles a preview subdomain', 'iso-alpha.travelgenixsites.com', 'iso-alpha.travelgenixsites.com'],
    ['keeps a bare host', 'localhost', 'localhost'],
  ])('%s', async (_label, input, expected) => {
    const { normaliseHostname } = await import('../lib/db/tenants');
    expect(normaliseHostname(input)).toBe(expected);
  });

  it.each([
    ['an empty string', ''],
    ['a path', 'example.com/evil'],
    ['a scheme', 'https://example.com'],
    ['a space', 'exa mple.com'],
    ['a null byte', 'example.com\u0000.evil.com'],
    ['a leading hyphen', '-example.com'],
    ['something absurd', 'a'.repeat(300)],
    ['a non-string', 12345],
  ])('refuses %s', async (_label, input) => {
    const { normaliseHostname } = await import('../lib/db/tenants');
    expect(normaliseHostname(input)).toBeNull();
  });

  it('never queries for a hostname it has already rejected', async () => {
    const { resolveTenantByHostname } = await import('../lib/db/tenants');

    expect(await resolveTenantByHostname('https://example.com')).toBeNull();
    expect(log).toHaveLength(0);
  });

  it('resolves through the read-only role by default', async () => {
    const { forgetHostname, resolveTenantByHostname } = await import('../lib/db/tenants');

    forgetHostname(null);
    respond('resolve_tenant', [{ id: ALPHA }]);

    expect(await resolveTenantByHostname('alpha.example')).toBe(ALPHA);
    expect(log[0].role).toBe('renderer');
    expect(log[0].sql).toContain('resolve_tenant');
    // Deliberately not inside a transaction: there is no tenant to set yet,
    // and this is the query that works out what it should be.
    expect(log.some((s) => s.sql === 'BEGIN')).toBe(false);
  });

  it('caches a hit, and expires it', async () => {
    const { forgetHostname, resolveTenantByHostname } = await import('../lib/db/tenants');

    forgetHostname(null);
    respond('resolve_tenant', [{ id: ALPHA }]);
    respond('resolve_tenant', [{ id: BETA }]);

    const t0 = 1_000_000;
    expect(await resolveTenantByHostname('alpha.example', 'renderer', t0)).toBe(ALPHA);
    expect(await resolveTenantByHostname('alpha.example', 'renderer', t0 + 1_000)).toBe(ALPHA);
    expect(log).toHaveLength(1);

    // Past the TTL, it asks again.
    expect(await resolveTenantByHostname('alpha.example', 'renderer', t0 + 120_000)).toBe(BETA);
    expect(log).toHaveLength(2);
  });

  it('expires a miss sooner than a hit', async () => {
    const { forgetHostname, resolveTenantByHostname } = await import('../lib/db/tenants');

    forgetHostname(null);
    respond('resolve_tenant', [{ id: null }]);
    respond('resolve_tenant', [{ id: ALPHA }]);

    const t0 = 2_000_000;
    expect(await resolveTenantByHostname('new.example', 'renderer', t0)).toBeNull();

    // Someone has just pointed DNS at us. Ten seconds later it works, rather
    // than a minute later.
    expect(await resolveTenantByHostname('new.example', 'renderer', t0 + 10_000)).toBe(ALPHA);
    expect(log).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------

describe('createTenant', () => {
  it('makes the tenant, its owner and a home page in one transaction, tenant set first', async () => {
    const { createTenant } = await import('../lib/db/tenants');
    respond('insert into public.tenants', [
      { id: 'aaaa', slug: 'sunvil-travel', name: 'Sunvil Travel', plan: 'spark', status: 'active', theme: {}, settings: {} },
    ]);

    const tenant = await createTenant({ name: 'Sunvil Travel' }, 'local:andy@x.co');
    expect(tenant).toEqual({
      id: 'aaaa',
      slug: 'sunvil-travel',
      name: 'Sunvil Travel',
      plan: 'spark',
      status: 'active',
      theme: {},
      settings: {},
    });

    // Exactly one transaction: a site is made whole, owner and page and all, or
    // not at all.
    expect(maxConcurrentTransactions).toBe(1);
    const app = log.filter((s) => s.role === 'app');
    expect(app.filter((s) => s.sql === 'BEGIN')).toHaveLength(1);

    const at = (fragment: string) => app.findIndex((s) => s.sql.includes(fragment));
    const setTenant = at('set_config');
    const tenants = at('insert into public.tenants');
    const members = at('insert into public.tenant_users');
    const page = at('insert into public.pages');

    // The tenant is scoped before any write, then the three writes go in order.
    expect(setTenant).toBeGreaterThanOrEqual(0);
    expect(setTenant).toBeLessThan(tenants);
    expect(tenants).toBeLessThan(members);
    expect(members).toBeLessThan(page);

    // The RLS-legal trick, asserted: the id the transaction is scoped to is the
    // same id the tenants row is written with, which is what the policy's
    // with-check compares. Get that wrong and the insert is refused.
    const scopedId = app[setTenant].params[0];
    expect(app[tenants].params[0]).toBe(scopedId);
    expect(scopedId).toMatch(/^[0-9a-f-]{36}$/);

    // The membership names that person as the owner; the page is the empty-slug
    // home page titled Home.
    expect(app[members].params).toContain('local:andy@x.co');
    expect(app[members].sql).toContain("'owner'");
    expect(app[page].sql).toContain("'Home'");
  });

  it('derives a slug from the name and numbers the retries', async () => {
    const { tenantSlugCandidate } = await import('../lib/db/tenants');
    expect(tenantSlugCandidate('Sunvil Travel', 0)).toBe('sunvil-travel');
    expect(tenantSlugCandidate('Sunvil Travel', 1)).toBe('sunvil-travel-2');
    expect(tenantSlugCandidate('Sunvil Travel', 2)).toBe('sunvil-travel-3');
  });

  it('falls back to a usable slug when a name reduces to nothing', async () => {
    const { tenantSlugCandidate } = await import('../lib/db/tenants');
    // Empty, whitespace, punctuation only, and a single character are all below
    // the tenant slug's two-character minimum.
    for (const nothing of ['', '   ', '!', 'A']) {
      expect(tenantSlugCandidate(nothing, 0)).toBe('site');
    }
    expect(tenantSlugCandidate('A', 1)).toBe('site-2');
  });

  it('keeps a long name inside the sixty-three character limit, suffix and all', async () => {
    const { tenantSlugCandidate } = await import('../lib/db/tenants');
    const base = tenantSlugCandidate('x'.repeat(200), 0);
    const suffixed = tenantSlugCandidate('x'.repeat(200), 9);
    expect(base.length).toBeLessThanOrEqual(63);
    // No trailing hyphen for the numbered suffix to double up against.
    expect(base.endsWith('-')).toBe(false);
    expect(suffixed.length).toBeLessThanOrEqual(63);
    expect(suffixed.endsWith('-10')).toBe(true);
  });

  it('retries only on a taken slug, not on any other failure', async () => {
    const { isSlugTaken } = await import('../lib/db/tenants');
    expect(isSlugTaken({ code: '23505' })).toBe(true);
    expect(isSlugTaken(new Error('duplicate key value violates unique constraint "tenants_slug_key"'))).toBe(true);
    expect(isSlugTaken(new Error('SQLSTATE 23505'))).toBe(true);
    expect(isSlugTaken(new Error('connection refused'))).toBe(false);
    expect(isSlugTaken(null)).toBe(false);
  });

  it('the action gates on staff and takes the owner from the session, not the caller', () => {
    const action = readFileSync(join(__dirname, '..', 'app/actions/sites.ts'), 'utf8');
    expect(action).toContain('isStaffEmail');
    expect(action).toContain('createTenant');
    // The owner is the signed-in user's id, never something the caller passes.
    expect(action).toContain('user.id');
  });
});

// ---------------------------------------------------------------------------

describe('copyMediaToTenant', () => {
  const SOURCE = ALPHA;
  const DEST = BETA;

  const sourceRow = (n: number) => ({
    id: `id-${n}`,
    url: `https://old.example/pic-${n}.jpg`,
    storage_key: `sites/${SOURCE}/media/pic-${n}.jpg`,
    filename: `pic-${n}.jpg`,
    mime: 'image/jpeg',
    bytes: 1000 + n,
    width: 800,
    height: 600,
    alt: `picture ${n}`,
    source: 'upload',
    credit: {},
    created_at: new Date('2026-08-01T00:00:00Z'),
  });

  // A minimal valid row for insertMedia's RETURNING to map. The copy ignores the
  // value, but toItem must not choke on an empty result.
  const insertedRow = {
    id: 'x', url: 'u', storage_key: 'k', filename: 'f', mime: 'image/jpeg',
    bytes: 1, width: null, height: null, alt: '', source: 'upload', credit: {},
    created_at: new Date('2026-08-01T00:00:00Z'),
  };

  it('files each copy under the destination prefix and maps old url to new', async () => {
    const { copyMediaToTenant } = await import('../lib/db/duplicate');
    vi.mocked(copyIntoStore).mockReset();
    vi.mocked(copyIntoStore).mockImplementation(async (_sourceUrl: string, pathname: string) => ({
      url: `${pathname}#stored`,
      pathname: `${pathname}--abc`,
      size: 4242,
      contentType: 'image/jpeg' as const,
      pixels: null,
    }));

    respond('from public.media', [sourceRow(1), sourceRow(2)]);
    respond('into public.media', [insertedRow]);
    respond('into public.media', [insertedRow]);

    const map = await copyMediaToTenant(SOURCE, DEST);

    // THE ISOLATION PROPERTY: every copy is filed under the DESTINATION's own
    // prefix, never the source's, and is read from the source's own url.
    const calls = vi.mocked(copyIntoStore).mock.calls;
    expect(calls).toHaveLength(2);
    for (const [, pathname] of calls) {
      expect(pathname.startsWith(`sites/${DEST}/media/`)).toBe(true);
    }
    expect(calls[0][0]).toBe('https://old.example/pic-1.jpg');

    // The map points each source url at the new stored url the content slices
    // will repoint to.
    expect(map.get('https://old.example/pic-1.jpg')).toBe(`sites/${DEST}/media/pic-1.jpg#stored`);
    expect(map.size).toBe(2);

    // Two transactions, not three: the source read, then ONE destination write in
    // which both inserts run (insertMedia reuses the open scope). The tenant is
    // set to the source first, the destination second.
    const app = log.filter((s) => s.role === 'app');
    expect(app.filter((s) => s.sql === 'BEGIN')).toHaveLength(2);

    const configs = app.filter((s) => s.sql.includes('set_config'));
    expect(configs[0].params[0]).toBe(SOURCE);
    expect(configs[1].params[0]).toBe(DEST);

    const destScoped = app.findIndex((s) => s.sql.includes('set_config') && s.params[0] === DEST);
    const inserts = app
      .map((s, i) => (s.sql.includes('into public.media') ? i : -1))
      .filter((i) => i >= 0);
    expect(inserts).toHaveLength(2);
    expect(inserts.every((i) => i > destScoped)).toBe(true);
  });

  it('does nothing and returns an empty map when the source has no images', async () => {
    const { copyMediaToTenant } = await import('../lib/db/duplicate');
    vi.mocked(copyIntoStore).mockReset();
    respond('from public.media', []);

    const map = await copyMediaToTenant(SOURCE, DEST);

    expect(map.size).toBe(0);
    expect(vi.mocked(copyIntoStore)).not.toHaveBeenCalled();
    // Only the source read opened a transaction; no destination write.
    expect(log.filter((s) => s.role === 'app' && s.sql === 'BEGIN')).toHaveLength(1);
  });

  it('takes the type and size from the store, the rest from the source row', async () => {
    const { copiedMediaRow } = await import('../lib/db/duplicate');
    const item = {
      id: 'i',
      url: 'https://old/x.png',
      storageKey: 'old/key',
      filename: 'hero.png',
      mime: 'image/png',
      bytes: 111,
      width: 1200,
      height: 800,
      alt: 'a hero',
      source: 'pexels' as const,
      credit: { photographer: 'Sam' },
      variants: [{ url: 'https://old/y-800.webp', width: 800, height: 533, bytes: 40_000 }],
      createdAt: new Date('2026-08-01T00:00:00Z'),
    };
    const stored = { url: 'https://new/y.png', pathname: 'new/key', size: 222, contentType: 'image/png' as const };

    expect(copiedMediaRow(item, stored)).toEqual({
      storageKey: 'new/key',
      url: 'https://new/y.png',
      filename: 'hero.png',
      // Type and byte count are the stored object's facts, not the source row's.
      mime: 'image/png',
      bytes: 222,
      // Dimensions, alt and credit are metadata the store never knew.
      width: 1200,
      height: 800,
      alt: 'a hero',
      source: 'pexels',
      credit: { photographer: 'Sam' },
      /*
       * Empty, even though the source row had one. A variant's url points into
       * the SOURCE tenant's prefix, so carrying the list across would leave the
       * new site serving the old site's objects and quietly undo the isolation
       * this whole copy exists to provide.
       */
      variants: [],
    });
  });

  it('never carries a source tenant\'s variant URLs into the copy', async () => {
    const { copiedMediaRow } = await import('../lib/db/duplicate');
    const item = {
      id: 'm2',
      url: 'https://old/z.webp',
      storageKey: 'old/z',
      filename: 'z.webp',
      mime: 'image/webp',
      bytes: 900,
      width: 2400,
      height: 1600,
      alt: '',
      source: 'upload' as const,
      credit: {},
      variants: [
        { url: 'https://old/z-400.webp', width: 400, height: 267, bytes: 9_000 },
        { url: 'https://old/z-800.webp', width: 800, height: 533, bytes: 30_000 },
      ],
      createdAt: new Date('2026-08-01T00:00:00Z'),
    };
    const stored = { url: 'https://new/z.webp', pathname: 'new/z', size: 900, contentType: 'image/webp' as const };

    const copied = copiedMediaRow(item, stored);
    expect(copied.variants).toEqual([]);
    expect(JSON.stringify(copied)).not.toContain('old/');
  });
});

// ---------------------------------------------------------------------------

describe('rewriteUrls', () => {
  it('swaps a whole-string url and one embedded in a longer string', async () => {
    const { rewriteUrls } = await import('../lib/db/duplicate');
    const map = new Map([['https://old/a.jpg', 'https://new/a.jpg']]);
    expect(rewriteUrls('https://old/a.jpg', map)).toBe('https://new/a.jpg');
    // A CSS background: the url is inside a longer string and still has to move.
    expect(rewriteUrls('url(https://old/a.jpg) center', map)).toBe('url(https://new/a.jpg) center');
  });

  it('walks arrays and nested objects, leaving non-urls and non-strings alone', async () => {
    const { rewriteUrls } = await import('../lib/db/duplicate');
    const map = new Map([['https://old/a.jpg', 'https://new/a.jpg']]);
    expect(
      rewriteUrls(
        {
          title: 'Hello',
          count: 3,
          flag: true,
          empty: null,
          gallery: ['https://old/a.jpg', 'https://old/b.jpg'],
          section: { bg: 'https://old/a.jpg', note: 'no link here' },
        },
        map,
      ),
    ).toEqual({
      title: 'Hello',
      count: 3,
      flag: true,
      empty: null,
      // b.jpg is not in the map, so it is left as it was.
      gallery: ['https://new/a.jpg', 'https://old/b.jpg'],
      section: { bg: 'https://new/a.jpg', note: 'no link here' },
    });
  });

  it('replaces the longer url first, so a shorter prefix cannot corrupt it', async () => {
    const { rewriteUrls } = await import('../lib/db/duplicate');
    // The first key is a prefix of the real url. Shortest-first would fire it
    // inside the real url and leave WRONG behind; longest-first does not.
    const map = new Map([
      ['https://old/a', 'WRONG'],
      ['https://old/a.jpg', 'https://new/a.jpg'],
    ]);
    expect(rewriteUrls('https://old/a.jpg', map)).toBe('https://new/a.jpg');
  });

  it('returns the very same value when the map is empty', async () => {
    const { rewriteUrls } = await import('../lib/db/duplicate');
    const value = { a: 'https://old/a.jpg' };
    expect(rewriteUrls(value, new Map())).toBe(value);
  });
});

// ---------------------------------------------------------------------------

describe('listPagesWithContent', () => {
  it('returns pages parents-before-children for a nested tree', async () => {
    const { listPagesWithContent } = await import('../lib/db/pages');
    // Deliberately out of order: a grandchild, then its parent, then the root.
    respond('draft_content from public.pages', [
      { id: 'GC', parent_id: 'C', slug: 'deep', title: 'Deep', seo: {}, draft_content: null },
      { id: 'C', parent_id: 'ROOT', slug: 'child', title: 'Child', seo: {}, draft_content: null },
      { id: 'ROOT', parent_id: null, slug: '', title: 'Home', seo: {}, draft_content: null },
    ]);

    const order = (await listPagesWithContent(ALPHA)).map((page) => page.id);
    expect(order.indexOf('ROOT')).toBeLessThan(order.indexOf('C'));
    expect(order.indexOf('C')).toBeLessThan(order.indexOf('GC'));
  });
});

// ---------------------------------------------------------------------------

describe('copyContentToTenant', () => {
  const OLD = 'https://old.example/hero.jpg';
  const NEW = 'https://new.example/hero.jpg';

  it('remaps the tree, reuses the blank home, rewrites urls, in one destination transaction', async () => {
    const { copyContentToTenant } = await import('../lib/db/duplicate');

    // Source: a home carrying a mapped og image, and an about page beneath it.
    respond('draft_content from public.pages', [
      { id: 'SRC_HOME', parent_id: null, slug: '', title: 'Home', seo: { ogImage: OLD, noindex: false }, draft_content: null },
      { id: 'SRC_ABOUT', parent_id: 'SRC_HOME', slug: 'about', title: 'About', seo: { noindex: false }, draft_content: null },
    ]);
    // The destination already has a blank home (createTenant made it): the source
    // home upserts onto it rather than colliding.
    respond('where parent_id is null and slug', [{ id: 'DEST_HOME' }]);
    respond('update public.pages set', [{ id: 'DEST_HOME' }]);
    // The about page matches nothing, so it inserts.
    respond('insert into public.pages', [{ id: 'DEST_ABOUT' }]);

    const result = await copyContentToTenant(ALPHA, BETA, new Map([[OLD, NEW]]), 'user-1');
    expect(result.pages).toBe(2);

    // The home took the UPDATE path and carries the rewritten og image (seo is the
    // second set value: title, seo, draft_content, updated_by).
    const update = log.find((s) => s.sql.includes('update public.pages set'));
    expect((update?.params[1] as { __json: { ogImage?: string } }).__json.ogImage).toBe(NEW);

    // Exactly one page INSERT, the about page, and its parent_id is the id minted
    // for the home, NOT the source home id.
    const inserts = log.filter((s) => s.sql.includes('insert into public.pages'));
    expect(inserts).toHaveLength(1);
    expect(inserts[0].params[1]).toBe('DEST_HOME');
    expect(inserts[0].params[1]).not.toBe('SRC_HOME');

    // ONE destination transaction: theme and the two settings reuse it rather than
    // open their own, so the tenant is set for the destination exactly once.
    const destSets = log.filter(
      (s) => s.role === 'app' && s.sql.includes('set_config') && s.params[0] === BETA,
    );
    expect(destSets).toHaveLength(1);

    // Header and footer both written, and the theme and client settings saved.
    expect(log.filter((s) => s.sql.includes('insert into public.site_regions'))).toHaveLength(2);
    expect(log.some((s) => s.sql.includes('set theme'))).toBe(true);
    expect(log.some((s) => s.sql.includes('set settings'))).toBe(true);

    // The head and body custom code is DELIBERATELY not copied: raw injected HTML
    // is the wrong thing to carry into a different client, and its column keeps
    // its single gated writer. See the settings guard in settings.test.ts.
    expect(log.some((s) => s.sql.includes('staff_settings'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('copyFontsToTenant', () => {
  it('copies each family and its files verbatim in one destination transaction', async () => {
    const { copyFontsToTenant } = await import('../lib/db/duplicate');

    // Source: one uploaded family with a normal face and an italic face.
    respond('from public.fonts order by slug', [
      { id: 'F1', family: 'Brand Sans', slug: 'brand-sans', source: 'upload', fallback: 'sans' },
    ]);
    respond('from public.font_files where font_id', [
      { weight: 400, style: 'normal', format: 'woff2', subset: null, unicode_range: null, bytes: Buffer.from('regular'), byte_size: 7 },
      { weight: 400, style: 'italic', format: 'woff2', subset: 'latin', unicode_range: 'U+0-FF', bytes: Buffer.from('italic'), byte_size: 6 },
    ]);
    respond('insert into public.fonts', [{ id: 'DEST_F1' }]);

    expect(await copyFontsToTenant(ALPHA, BETA)).toEqual({ fonts: 1, files: 2 });

    // Both faces written under the new font id, with the italic PRESERVED rather
    // than flattened to normal the way a re-import would.
    // params: tenant, font_id, weight, style, format, subset, unicode_range, bytes, byte_size
    const fileInserts = log.filter((s) => s.sql.includes('insert into public.font_files'));
    expect(fileInserts).toHaveLength(2);
    expect(fileInserts.every((s) => s.params[1] === 'DEST_F1')).toBe(true);
    expect(fileInserts.map((s) => s.params[3])).toEqual(['normal', 'italic']);
    // The bytes travel as the Buffer they were read as, not a reference.
    expect(Buffer.isBuffer(fileInserts[1].params[7])).toBe(true);

    // ONE destination transaction: insertCopiedFont reused the scope rather than
    // open its own, so the tenant is set for the destination exactly once.
    const destSets = log.filter(
      (s) => s.role === 'app' && s.sql.includes('set_config') && s.params[0] === BETA,
    );
    expect(destSets).toHaveLength(1);
  });

  it('does nothing when the source has no fonts', async () => {
    const { copyFontsToTenant } = await import('../lib/db/duplicate');
    respond('from public.fonts order by slug', []);

    expect(await copyFontsToTenant(ALPHA, BETA)).toEqual({ fonts: 0, files: 0 });
    // Only the source read opened a transaction; no destination write.
    expect(log.filter((s) => s.role === 'app' && s.sql === 'BEGIN')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------

describe('duplicateSite', () => {
  // A real uuid, because withTenant refuses to scope to anything that is not one.
  const CLONE = '33333333-3333-3333-3333-333333333333';

  it('creates the clone first, then copies from the source into it', async () => {
    const { duplicateSite } = await import('../lib/db/duplicate');

    // createTenant's insert returns the clone. Everything the copies read from
    // the source is empty, so this exercises the ORDER and the scoping, not the
    // individual copies (those are covered above).
    respond('insert into public.tenants', [
      { id: CLONE, slug: 'sunvil-copy', name: 'Sunvil copy', plan: 'Spark', status: 'active', theme: {}, settings: {} },
    ]);

    const clone = await duplicateSite(ALPHA, 'owner-1', 'Sunvil copy');
    expect(clone.slug).toBe('sunvil-copy');

    // The clone is made before anything is copied into it: its scope is only ever
    // set AFTER the tenants insert that created it.
    const tenantInsert = log.findIndex((s) => s.sql.includes('insert into public.tenants'));
    const cloneScoped = log.findIndex((s) => s.sql.includes('set_config') && s.params[0] === CLONE);
    expect(tenantInsert).toBeGreaterThanOrEqual(0);
    expect(cloneScoped).toBeGreaterThan(tenantInsert);

    // And the source is read under the source's own scope for the copies.
    expect(log.some((s) => s.sql.includes('set_config') && s.params[0] === ALPHA)).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('the duplicate-site action', () => {
  it('gates on staff and takes the source from the session, not the caller', () => {
    const source = readFileSync(join(__dirname, '..', 'app/actions/sites.ts'), 'utf8');
    const start = source.indexOf('export async function duplicateSiteAction');
    expect(start).toBeGreaterThanOrEqual(0);
    const next = source.indexOf('\nfunction explain', start);
    const body = source.slice(start, next === -1 ? undefined : next);

    // The same staff gate as createSite.
    expect(body).toContain('requireStaff');
    // The source is the active site, resolved from the session, never an id the
    // caller passes in the request body.
    expect(body).toContain('requireTenantId');
    expect(body).toContain('duplicateSite');
    // The owner is the session user.
    expect(body).toContain('user.id');
  });
});

// ---------------------------------------------------------------------------

describe('comments', () => {
  const commentRow = (over: Record<string, unknown> = {}) => ({
    id: 'c1',
    page_id: 'p1',
    parent_id: null,
    author_id: 'u1',
    body: 'Make this bigger',
    anchor: null,
    resolved_at: null,
    resolved_by: null,
    created_at: new Date('2026-08-18T00:00:00Z'),
    ...over,
  });

  it('leaves a comment through an insert-select over pages, so it fails closed', async () => {
    const { createComment } = await import('../lib/db/comments');
    respond('insert into public.site_comments', [commentRow()]);

    const ok = await createComment(ALPHA, { pageId: 'p1', authorId: 'u1', body: 'Make this bigger' });
    expect(ok?.body).toBe('Make this bigger');

    // THE SECURITY PROPERTY: it is INSERT ... SELECT FROM pages, not VALUES, so a
    // page id belonging to another tenant selects nothing and writes nothing.
    const insert = log.find((s) => s.sql.includes('insert into public.site_comments'));
    expect(insert?.sql).toContain('from public.pages');
    expect(insert?.sql).not.toContain('values');
  });

  it('returns null when the page is not this tenant, the select finding nothing', async () => {
    const { createComment } = await import('../lib/db/comments');
    // No respond, so the insert-select matches no page and returns nothing.
    expect(await createComment(ALPHA, { pageId: 'p1', authorId: 'u1', body: 'hi' })).toBeNull();
  });

  it('replies only to a root, through the same guard', async () => {
    const { addReply } = await import('../lib/db/comments');
    respond('insert into public.site_comments', [commentRow({ id: 'r1', parent_id: 'c1' })]);

    const reply = await addReply(ALPHA, { parentId: 'c1', authorId: 'u2', body: 'On it' });
    expect(reply?.parentId).toBe('c1');

    const insert = log.find((s) => s.sql.includes('insert into public.site_comments'));
    // Selects the parent from site_comments and requires it to be a root, which
    // is what keeps threads one level deep.
    expect(insert?.sql).toContain('from public.site_comments c');
    expect(insert?.sql).toContain('parent_id is null');
  });

  it('groups a page into threads, each root with its replies oldest first', async () => {
    const { listPageComments } = await import('../lib/db/comments');
    respond('from public.site_comments', [
      commentRow({ id: 'c1', parent_id: null, body: 'root A' }),
      commentRow({ id: 'r1', parent_id: 'c1', body: 'reply to A' }),
      commentRow({ id: 'c2', parent_id: null, body: 'root B' }),
    ]);

    const threads = await listPageComments(ALPHA, 'p1');
    expect(threads.map((t) => t.comment.id)).toEqual(['c1', 'c2']);
    expect(threads[0].replies.map((r) => r.id)).toEqual(['r1']);
    expect(threads[1].replies).toEqual([]);
  });

  it('resolves and reopens roots only', async () => {
    const { resolveComment, reopenComment } = await import('../lib/db/comments');

    respond('update public.site_comments', [
      commentRow({ resolved_at: new Date('2026-08-18T01:00:00Z'), resolved_by: 'u2' }),
    ]);
    const resolved = await resolveComment(ALPHA, 'c1', 'u2');
    expect(resolved?.resolvedBy).toBe('u2');
    expect(log.find((s) => s.sql.includes('update public.site_comments'))?.sql).toContain(
      'parent_id is null',
    );

    respond('update public.site_comments', [commentRow({ resolved_at: null, resolved_by: null })]);
    expect((await reopenComment(ALPHA, 'c1'))?.resolvedAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('cleanCommentBody', () => {
  const chr = (code: number) => String.fromCharCode(code);

  it('drops control characters, keeps prose whitespace, trims and caps', async () => {
    const { cleanCommentBody, MAX_COMMENT_LENGTH } = await import('../lib/db/comments');

    // Tab (9), newline (10) and carriage return (13) survive; NUL and bell do not.
    const prose = 'a' + chr(9) + 'b' + chr(10) + 'c';
    expect(cleanCommentBody(prose)).toBe(prose);
    expect(cleanCommentBody('a' + chr(0) + chr(7) + 'b')).toBe('ab');

    expect(cleanCommentBody('  hi  ')).toBe('hi');
    expect(cleanCommentBody('   ')).toBeNull();
    expect(cleanCommentBody(42)).toBeNull();
    expect(cleanCommentBody('x'.repeat(MAX_COMMENT_LENGTH + 100))?.length).toBe(MAX_COMMENT_LENGTH);
  });
});

// ---------------------------------------------------------------------------

describe('the connection string guard', () => {
  it.each([
    ['postgresql://postgres:pw@host:5432/postgres', 'postgres'],
    ['postgresql://tg_sites_app.abc123:pw@pooler:6543/postgres', 'tg_sites_app'],
    ['postgresql://tg_sites_renderer:pw@host:5432/postgres', 'tg_sites_renderer'],
  ])('reads the role out of %s', async (connection, expected) => {
    const { usernameFrom } = await import('../lib/db/client');
    expect(usernameFrom(connection)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------

describe('nothing queries round the side', () => {
  const ROOT = join(__dirname, '..');
  const SKIP = new Set(['node_modules', '.next', '.git', 'standalone', 'tests']);

  function walk(dir: string, found: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      if (SKIP.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, found);
      else if (/\.tsx?$/.test(entry)) found.push(full);
    }
    return found;
  }

  it('only lib/db imports the raw client', () => {
    const offenders = walk(ROOT)
      .filter((file) => !file.includes(join('lib', 'db')))
      .filter((file) => /from ['"].*db\/client['"]/.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(ROOT.length + 1));

    // Importing the pool directly is how a query ends up outside withTenant,
    // and a query outside withTenant sees no rows at all. Better to fail here
    // than to spend an afternoon wondering why a page is empty.
    expect(offenders, 'these import the pool directly instead of using withTenant').toEqual([]);
  });

  /*
   * This was an allow-list keyed on filename, and the allowance was unlimited:
   * once a file was named, it could open as many unscoped connections as it
   * liked. That got the wrong answer twice. It flagged lib/db/users.ts, which
   * legitimately opens two doors of its own for the questions that HAVE no
   * tenant, and it would have said nothing had tenants.ts grown a second
   * unscoped query.
   *
   * So it now checks the property rather than the file: a connection is opened
   * inside a transaction whose first statement sets a scope. The set of files
   * allowed to open one at all is still pinned, because a fourth door is a
   * decision worth making on purpose rather than by writing a line of code.
   */
  /*
   * A source, not a RegExp, and a fresh one built at each use.
   *
   * A shared /g regex advances lastIndex on every .test(), so calling it once
   * per file in a filter checks the first file, skips the second, checks the
   * third. The first version of this test did exactly that and quietly dropped
   * withTenant.ts from the list of doors, which is the one file the whole rule
   * is about.
   */
  const DOOR_PATTERN = String.raw`\bdb\((?:'app'|'renderer'|role)\)`;

  it('only the documented doors open a connection', () => {
    const opens = walk(join(ROOT, 'lib', 'db'))
      .filter((file) => !file.endsWith('client.ts')) // client.ts IS the pool
      .filter((file) => new RegExp(DOOR_PATTERN).test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(ROOT.length + 1))
      .sort();

    expect(opens, 'a new file opens its own connection, which needs a look').toEqual([
      join('lib', 'db', 'tenants.ts'), // resolve_tenant, before a tenant is known
      join('lib', 'db', 'users.ts'), // withLogin and withUser, likewise
      join('lib', 'db', 'withTenant.ts'), // withTenant and withPublicTenant
    ]);
  });

  it('every connection is opened inside a transaction', () => {
    const offenders: string[] = [];

    for (const file of walk(join(ROOT, 'lib', 'db'))) {
      const name = file.slice(ROOT.length + 1);
      if (name.endsWith('client.ts')) continue;

      const source = readFileSync(file, 'utf8');

      for (const match of source.matchAll(new RegExp(DOOR_PATTERN, 'g'))) {
        const after = source.slice(match.index!, match.index! + 240);

        // .begin() is the only way to get a transaction, and every begin body
        // in this codebase sets its scope as the first statement. That last
        // part is asserted behaviourally, per door, further up this file.
        if (after.includes('.begin(')) continue;

        // The one documented exception. resolve_tenant takes the hostname as an
        // argument rather than reading a setting, so there is nothing for a
        // transaction to scope, and it is SECURITY DEFINER precisely so that it
        // needs no scope. See db/migrations/0006_resolve_tenant.sql.
        if (after.includes('resolve_tenant')) continue;

        const line = source.slice(0, match.index!).split('\n').length;
        offenders.push(`${name}:${line}`);
      }
    }

    expect(offenders, 'these query a pool with no transaction and so no scope').toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('source hygiene', () => {
  const ROOT = join(__dirname, '..');
  const SKIP = new Set(['node_modules', '.next', '.git', 'out']);

  function sources(dir: string, found: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      if (SKIP.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) sources(full, found);
      else if (/\.(ts|tsx|mjs|js)$/.test(entry)) found.push(full);
    }
    return found;
  }

  /**
   * This has cost real time twice in one day.
   *
   * A regex written with LITERAL control bytes or combining marks parses
   * perfectly in Node, so every unit test and the whole build pass. esbuild
   * then re-encodes the file and the character class becomes invalid at
   * runtime. The sanitiser shipped a broken safeUrl exactly that way, and
   * safeUrl guards every href, image src and iframe src in the product.
   *
   * The rule is simple and the fix is always the same: write the escape,
   * never the byte. Tab, newline and carriage return are the only exceptions.
   *
   * Built with new RegExp from a string of escapes rather than a literal,
   * because a literal here would have to contain the very characters it is
   * banning.
   */
  /*
   * An undefined custom property is invisible until somebody looks at the screen.
   *
   * var(--ed-7) with no fallback makes the whole declaration invalid at computed
   * value time, so `gap: var(--ed-7)` silently becomes no gap and
   * `border-radius: var(--ed-r)` silently becomes square. No console warning, no
   * build error, nothing in any test. The spacing scale here runs 4 8 12 16 20
   * 24 32 with NO 7, and the radii are --ed-r-sm/md/lg/xl with no bare --ed-r,
   * so both are easy to write by analogy and wrong.
   *
   * They shipped that way: the sign-in form and the account bar both went out
   * with zero spacing and square corners, and it took a screenshot of a third
   * screen to notice. This is the check that would have caught it.
   */
  it('every custom property used in CSS is defined somewhere', () => {
    const css = sources(ROOT).filter((f) => f.endsWith('.css'));

    const defined = new Set<string>();
    for (const file of css) {
      for (const match of readFileSync(file, 'utf8').matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)) {
        defined.add(match[1]);
      }
    }

    const offenders: string[] = [];
    for (const file of css) {
      const source = readFileSync(file, 'utf8');
      // The second group is a comma: var(--x, fallback) is fine even if --x is
      // undefined, because the fallback is what makes it defined enough.
      for (const match of source.matchAll(/var\(\s*(--[a-z0-9-]+)\s*(,)?/g)) {
        if (defined.has(match[1]) || match[2]) continue;
        const line = source.slice(0, match.index!).split('\n').length;
        offenders.push(`${file.slice(ROOT.length + 1)}:${line} uses ${match[1]}`);
      }
    }

    expect(offenders, 'these resolve to nothing, so the declaration is dropped').toEqual([]);
  });

  it('no literal control characters or combining marks in source', () => {
    const forbidden = new RegExp(
      '[' +
        '\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F' + // C0 controls, minus tab/LF/CR
        '\\u0300-\\u036F' + // combining diacritical marks
        '\\u200B-\\u200D\\uFEFF' + // zero width spaces and the byte order mark
        ']',
    );

    const offenders: string[] = [];

    for (const file of sources(ROOT)) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          const match = forbidden.exec(line);
          if (!match) return;
          const code = match[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0');
          offenders.push(`${file.slice(ROOT.length + 1)}:${index + 1} has U+${code}`);
        });
    }

    expect(offenders, 'write these as \\uXXXX escapes, not as the raw byte').toEqual([]);
  });
});
