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

describe('hostname handling', () => {
  it.each([
    ['strips the port', 'Example.COM:3000', 'example.com'],
    ['strips a trailing dot', 'example.com.', 'example.com'],
    ['handles a staging subdomain', 'iso-alpha.tgsites.io', 'iso-alpha.tgsites.io'],
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

  it('every query in lib/db goes through a tenant scope', () => {
    const files = walk(join(ROOT, 'lib', 'db'));

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const name = file.slice(ROOT.length + 1);

      // client.ts creates the pools. tenants.ts holds the single documented
      // exception, the hostname lookup that runs before a tenant is known.
      if (name.endsWith('client.ts')) continue;

      const raw = source.match(/\bdb\((?:'app'|'renderer'|role)\)/g) ?? [];
      const allowed = name.endsWith('tenants.ts') || name.endsWith('withTenant.ts') ? raw.length : 0;

      expect(raw.length, `${name} reaches for a pool directly`).toBeLessThanOrEqual(allowed);
    }
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
