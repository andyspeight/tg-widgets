/**
 * Custom domains: the Vercel boundary and the database writes behind adding one.
 *
 * TWO HALVES, TESTED TWO WAYS. The Vercel client is the one file that reaches
 * api.vercel.com, so it is tested against a stand-in fetch: the request it makes
 * and the answer it gives back, with no network. The database helpers are tested
 * against the same fake-SQL harness the rest of lib/db uses, so the role, the
 * transaction and the exact statement are checked with no live connection.
 *
 * The render half needs no test here: middleware already rewrites any unknown
 * host to /site/[host] and resolve_tenant already checks the domains table first,
 * both covered in tests/settings.test.ts and tests/db.test.ts. This slice is the
 * write path those two were waiting for.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  isApexDomain,
  partnerHostname,
  pointingRecord,
  VERCEL_A_RECORD,
  VERCEL_CNAME_TARGET,
} from '../lib/domains/dns';

// ---------------------------------------------------------------------------
// The fake database client (same shape as tests/db.test.ts and collections)
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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function domainRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    hostname: 'demotravel.co.uk',
    is_primary: false,
    ssl_status: 'pending',
    kind: 'custom',
    provider: null,
    verification: [],
    verified_at: null,
    ...over,
  };
}

function read(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf8');
}

// ---------------------------------------------------------------------------
// The Vercel boundary
// ---------------------------------------------------------------------------

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function mockFetch(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  const fn = vi.fn((url: unknown, init?: RequestInit) => handler(String(url), init));
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('the Vercel domain client', () => {
  beforeEach(() => vi.stubEnv('VERCEL_API_TOKEN', 'tok_test'));

  it('reports it is not configured when the token is missing', async () => {
    vi.stubEnv('VERCEL_API_TOKEN', undefined as unknown as string);
    const { vercelConfigured } = await import('../lib/domains/vercel');
    expect(vercelConfigured()).toBe(false);
  });

  it('reports it is configured once the token is set', async () => {
    const { vercelConfigured } = await import('../lib/domains/vercel');
    expect(vercelConfigured()).toBe(true);
  });

  it('attaches a domain with a POST carrying the name and the bearer token', async () => {
    const fetchMock = mockFetch(async () => jsonResponse(200, { verified: true, verification: [] }));
    const { attachDomain } = await import('../lib/domains/vercel');

    const result = await attachDomain('www.demotravel.co.uk');

    expect(result).toEqual({ verified: true, verification: [] });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/v10/projects/');
    expect(url).toContain('/domains');
    expect(url).toContain('teamId=');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok_test');
    expect(JSON.parse(String(init.body))).toEqual({ name: 'www.demotravel.co.uk' });
  });

  it('treats a 409 as already attached and reports its current state instead', async () => {
    const fetchMock = mockFetch(async (_url, init) =>
      init?.method === 'POST'
        ? jsonResponse(409, { error: { message: 'domain exists' } })
        : jsonResponse(200, { verified: false, verification: [{ type: 'TXT', domain: 'x', value: 'y' }] }),
    );
    const { attachDomain } = await import('../lib/domains/vercel');

    const result = await attachDomain('demotravel.co.uk');

    expect(result.verified).toBe(false);
    expect(result.verification).toHaveLength(1);
    // The POST, then a GET of the project domain to read where it stands.
    expect(String(fetchMock.mock.calls[1][0])).toContain('/v9/projects/');
  });

  it('is active only when the domain is verified and its DNS is not misconfigured', async () => {
    mockFetch(async (url) =>
      url.includes('/config')
        ? jsonResponse(200, { misconfigured: false })
        : jsonResponse(200, { verified: true, verification: [] }),
    );
    const { domainState } = await import('../lib/domains/vercel');
    expect((await domainState('demotravel.co.uk')).sslStatus).toBe('active');
  });

  it('stays pending while the DNS is still misconfigured', async () => {
    mockFetch(async (url) =>
      url.includes('/config')
        ? jsonResponse(200, { misconfigured: true })
        : jsonResponse(200, { verified: true, verification: [] }),
    );
    const { domainState } = await import('../lib/domains/vercel');
    const state = await domainState('demotravel.co.uk');
    expect(state.sslStatus).toBe('pending');
    expect(state.misconfigured).toBe(true);
  });

  it('does not throw when detaching a domain that is already gone', async () => {
    mockFetch(async () => new Response(null, { status: 404 }));
    const { detachDomain } = await import('../lib/domains/vercel');
    await expect(detachDomain('demotravel.co.uk')).resolves.toBeUndefined();
  });

  it('turns a real Vercel error into a readable sentence', async () => {
    mockFetch(async () => jsonResponse(403, { error: { message: 'Not allowed' } }));
    const { detachDomain } = await import('../lib/domains/vercel');
    await expect(detachDomain('demotravel.co.uk')).rejects.toThrow(/Not allowed \(Vercel 403\)/);
  });

  it('refuses to call out at all without a token, with something to act on', async () => {
    vi.stubEnv('VERCEL_API_TOKEN', undefined as unknown as string);
    const fetchMock = mockFetch(async () => jsonResponse(200, {}));
    const { attachDomain } = await import('../lib/domains/vercel');

    await expect(attachDomain('demotravel.co.uk')).rejects.toThrow(/not connected yet/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The database writes
// ---------------------------------------------------------------------------

describe('adding a custom domain', () => {
  it('inserts a custom row as the app role, with no tenant in the where', async () => {
    const { addDomain } = await import('../lib/db/tenants');
    respond('insert into public.domains', [domainRow({ hostname: 'demotravel.co.uk' })]);

    const domain = await addDomain(ALPHA, 'demotravel.co.uk');

    const write = log.find((s) => s.sql.includes('insert into public.domains'))!;
    expect(write.role).toBe('app');
    expect(write.sql).toContain("'custom'");
    expect(write.params).toContain('demotravel.co.uk');
    expect(domain.kind).toBe('custom');
    expect(domain.sslStatus).toBe('pending');
  });

  it('makes the first custom domain the canonical one, computed under RLS', async () => {
    const { addDomain } = await import('../lib/db/tenants');
    respond('insert into public.domains', [domainRow({ is_primary: true })]);

    await addDomain(ALPHA, 'demotravel.co.uk');

    const write = log.find((s) => s.sql.includes('insert into public.domains'))!;
    // The insert asks the database whether this tenant already has a primary, so a
    // site's first domain leads and later ones come in secondary.
    expect(write.sql).toContain('not exists (select 1 from public.domains where is_primary)');
  });

  it('lowercases and refuses one of our own preview hostnames before the database', async () => {
    const { addDomain } = await import('../lib/db/tenants');
    await expect(addDomain(ALPHA, 'Foo.travelgenixsites.com')).rejects.toThrow(/preview domain/);
    expect(log.some((s) => s.sql.includes('insert into public.domains'))).toBe(false);
  });

  it('refuses something that is not a web address at all', async () => {
    const { addDomain } = await import('../lib/db/tenants');
    await expect(addDomain(ALPHA, 'https://demotravel.co.uk/path')).rejects.toThrow(/web address/);
    expect(log.some((s) => s.sql.includes('insert into public.domains'))).toBe(false);
  });
});

describe('recording what the provider said', () => {
  it('writes the provider, challenge and status in one update, scoped to a custom row', async () => {
    const { recordDomainProvisioning } = await import('../lib/db/tenants');
    respond('update public.domains', [domainRow({ ssl_status: 'active', provider: 'vercel' })]);

    const domain = await recordDomainProvisioning(ALPHA, 'demotravel.co.uk', {
      provider: 'vercel',
      verification: [{ type: 'TXT', domain: '_vercel.demotravel.co.uk', value: 'abc' }],
      sslStatus: 'active',
    });

    const write = log.find((s) => s.sql.includes('update public.domains'))!;
    expect(write.role).toBe('app');
    expect(write.sql).toContain("kind = 'custom'");
    expect(write.params).toContain('active');
    expect(domain?.sslStatus).toBe('active');
    expect(domain?.provider).toBe('vercel');
  });

  it('stamps verified_at only when the domain is active, and never clears it', async () => {
    const { recordDomainProvisioning } = await import('../lib/db/tenants');
    respond('update public.domains', [domainRow()]);
    await recordDomainProvisioning(ALPHA, 'demotravel.co.uk', { sslStatus: 'pending' });
    const write = log.find((s) => s.sql.includes('update public.domains'))!;
    // The moment is set inside a CASE guarded on the status, not on every write.
    expect(write.sql).toContain('coalesce(verified_at, now())');
  });
});

describe('removing and choosing domains', () => {
  it('deletes only a custom row, never a preview one', async () => {
    const { removeDomain } = await import('../lib/db/tenants');
    respond('delete from public.domains', [{ hostname: 'demotravel.co.uk' }]);

    const removed = await removeDomain(ALPHA, 'demotravel.co.uk');

    const write = log.find((s) => s.sql.includes('delete from public.domains'))!;
    expect(write.sql).toContain("kind = 'custom'");
    expect(removed).toBe(true);
  });

  it('clears the old primary before setting the new one, in one transaction', async () => {
    const { setPrimaryDomain } = await import('../lib/db/tenants');
    respond('is_primary = true', [{ hostname: 'demotravel.co.uk' }]);

    await setPrimaryDomain(ALPHA, 'demotravel.co.uk');

    const clear = log.findIndex((s) => s.sql.includes('is_primary = false'));
    const set = log.findIndex((s) => s.sql.includes('is_primary = true'));
    expect(clear).toBeGreaterThanOrEqual(0);
    expect(set).toBeGreaterThan(clear);
    expect(log[clear].role).toBe('app');
  });
});

describe('reading the domains', () => {
  it('returns the widened shape, custom and preview told apart, primary first', async () => {
    const { listDomains } = await import('../lib/db/tenants');
    respond('from public.domains', [
      domainRow({ hostname: 'demotravel.co.uk', is_primary: true, ssl_status: 'active', provider: 'vercel' }),
      domainRow({ hostname: 'demo.travelgenixsites.com', kind: 'preview' }),
    ]);

    const rows = await listDomains(ALPHA);

    expect(rows[0]).toMatchObject({
      hostname: 'demotravel.co.uk',
      isPrimary: true,
      sslStatus: 'active',
      kind: 'custom',
      provider: 'vercel',
    });
    expect(rows[1].kind).toBe('preview');
    expect(log.find((s) => s.sql.includes('from public.domains'))!.role).toBe('app');
  });

  it('keeps only well-formed verification challenges, dropping junk', async () => {
    const { listDomains } = await import('../lib/db/tenants');
    respond('from public.domains', [
      domainRow({
        verification: [
          { type: 'TXT', domain: '_vercel.demotravel.co.uk', value: 'abc' },
          { missing: 'the value' },
          'garbage',
        ],
      }),
    ]);

    const [row] = await listDomains(ALPHA);
    expect(row.verification).toHaveLength(1);
    expect(row.verification[0].type).toBe('TXT');
  });
});

// ---------------------------------------------------------------------------
// The boundaries, read from source
// ---------------------------------------------------------------------------

describe('the domain actions', () => {
  const src = read('app', 'actions', 'domains.ts');

  it('gate every action on owner or staff, in the action not the UI', () => {
    expect(src).toContain('requireDomainAccess');
    expect(src).toContain("site.role !== 'owner' && !staff");
  });

  it('reach Vercel only through the one boundary file', () => {
    // The action may name the host in prose, but must not call the endpoint itself.
    expect(src).not.toContain('https://api.vercel.com');
    expect(src).toContain("from '../../lib/domains/vercel'");
  });

  it('keep the row when the provider add fails rather than losing it', () => {
    expect(src).toContain('Keep the pending row');
  });
});

describe('the Vercel boundary file', () => {
  const src = read('lib', 'domains', 'vercel.ts');

  it('is the only place the Vercel API host is named', () => {
    expect(src).toContain('api.vercel.com');
  });

  it('never touches the database, so it cannot cross tenants', () => {
    expect(src).not.toContain('withTenant');
    expect(src).not.toContain("from '../db");
  });
});

// ---------------------------------------------------------------------------
// The DNS record a client is told to set
// ---------------------------------------------------------------------------

describe('the pointing record', () => {
  it('treats a two-label domain as an apex, pointed with an A record', () => {
    expect(isApexDomain('demotravel.com')).toBe(true);
    expect(pointingRecord('demotravel.com')).toEqual({ type: 'A', host: '@', value: VERCEL_A_RECORD });
  });

  it('treats a co.uk domain as an apex too, which is the market case', () => {
    // The one that a naive two-labels rule gets wrong, and a CNAME on a zone apex
    // is invalid DNS, so this is the assertion that earns the suffix list.
    expect(isApexDomain('demotravel.co.uk')).toBe(true);
    expect(pointingRecord('demotravel.co.uk')).toEqual({ type: 'A', host: '@', value: VERCEL_A_RECORD });
  });

  it('points a www subdomain with a CNAME on its own label', () => {
    expect(isApexDomain('www.demotravel.com')).toBe(false);
    expect(pointingRecord('www.demotravel.com')).toEqual({
      type: 'CNAME',
      host: 'www',
      value: VERCEL_CNAME_TARGET,
    });
  });

  it('points a deeper subdomain, including one under co.uk, with a CNAME', () => {
    expect(isApexDomain('book.demotravel.co.uk')).toBe(false);
    expect(pointingRecord('book.demotravel.co.uk')).toEqual({
      type: 'CNAME',
      host: 'book',
      value: VERCEL_CNAME_TARGET,
    });
  });

  it('ignores case and a trailing dot', () => {
    expect(pointingRecord('WWW.DemoTravel.com.')).toEqual({
      type: 'CNAME',
      host: 'www',
      value: VERCEL_CNAME_TARGET,
    });
  });
});

describe('the apex and www partner', () => {
  it('offers www for an apex, and the apex for a www, including under co.uk', () => {
    expect(partnerHostname('demotravel.com')).toBe('www.demotravel.com');
    expect(partnerHostname('www.demotravel.com')).toBe('demotravel.com');
    expect(partnerHostname('demotravel.co.uk')).toBe('www.demotravel.co.uk');
    expect(partnerHostname('www.demotravel.co.uk')).toBe('demotravel.co.uk');
  });

  it('offers nothing for a deeper subdomain, rather than guessing', () => {
    expect(partnerHostname('book.demotravel.com')).toBeNull();
    expect(partnerHostname('www.book.demotravel.com')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The screen, read from source
// ---------------------------------------------------------------------------

describe('the domains screen', () => {
  const panel = read('components', 'settings', 'DomainsPanel.tsx');
  const editor = read('components', 'settings', 'SettingsEditor.tsx');

  it('is drawn in settings only for owner or staff, the same gate as custom code', () => {
    expect(editor).toContain("tab === 'domains' && canEditCode && <DomainsPanel");
    expect(editor).toContain("id: 'domains' as Tab");
  });

  it('drives every change through the domain actions rather than its own fetch', () => {
    for (const action of [
      'addDomainAction',
      'refreshDomainAction',
      'removeDomainAction',
      'setPrimaryDomainAction',
      'listDomainsAction',
    ]) {
      expect(panel).toContain(action);
    }
    expect(panel).not.toContain('fetch(');
  });

  it('shows the pointing record from the shared helper, so co.uk is right', () => {
    expect(panel).toContain('pointingRecord(domain.hostname)');
  });

  it('says plainly when hosting is not connected yet, rather than a dead Check', () => {
    expect(panel).toContain('being switched on');
  });

  it('offers the apex-or-www partner in one press, when it is not already added', () => {
    expect(panel).toContain('partnerHostname(domain.hostname)');
    expect(panel).toContain('Also add');
  });
});

describe('the live isolation check', () => {
  const sql = read('db', 'isolation-check.sql');

  it('proves the new domain write path cannot cross a tenant', () => {
    // A migration was not needed for the write path, but the table went from
    // read-only to written, so the live proof grows a check for it.
    expect(sql).toContain('a domain for another tenant is refused');
    expect(sql).toContain("the app role cannot read another tenant''s domains");
  });
});
