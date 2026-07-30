/**
 * Authentication, tested where it can actually be tested.
 *
 * Three layers, and each one is checked in the only place that can prove it:
 *
 *   The POLICIES are proven against the real database by db/isolation-check.sql.
 *   A policy is a property of Postgres, and a fake cannot demonstrate one.
 *
 *   The CRYPTO is proven here, because it is pure. These tests forge tokens
 *   rather than only signing good ones: a signature check that accepts
 *   everything passes every round-trip test ever written.
 *
 *   The QUERY SEQUENCE is proven here with a fake driver, because the
 *   interesting failure is an ordering one. A query that runs before its
 *   transaction-local setting is a query with no policy applied, and you catch
 *   that by asserting on the order of statements, not by reading rows back.
 *
 * What is NOT covered: the cookie plumbing in lib/auth/session.ts, which is
 * Next's cookies() and nothing else, and the screens. Both are named in the
 * handover rather than quietly left out.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// The fake driver, same shape as tests/db.test.ts
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
}));

beforeEach(() => {
  log = [];
  responses = [];
});

/** A secret long enough to be accepted. Not one anything real uses. */
const SECRET = 'test-secret-that-is-long-enough-to-be-accepted';
const OTHER_SECRET = 'a-completely-different-secret-of-sufficient-length';

// ---------------------------------------------------------------------------
// Session tokens
// ---------------------------------------------------------------------------

describe('session tokens', () => {
  it('round trips a user id', async () => {
    const { readSession, signSession } = await import('../lib/auth/token');

    const token = signSession('user-ann', SECRET);
    expect(readSession(token, SECRET)?.userId).toBe('user-ann');
  });

  it('signs two different tokens for the same user', async () => {
    const { signSession } = await import('../lib/auth/token');

    // Same user, same second, same secret. Without the random id in the
    // payload these would be byte identical, which makes a session token look
    // like a stable identifier and invites somebody to use it as one.
    const a = signSession('user-ann', SECRET, 1_700_000_000_000);
    const b = signSession('user-ann', SECRET, 1_700_000_000_000);
    expect(a).not.toBe(b);
  });

  it('refuses a token signed with another secret', async () => {
    const { readSession, signSession } = await import('../lib/auth/token');

    const token = signSession('user-ann', OTHER_SECRET);
    expect(readSession(token, SECRET)).toBeNull();
  });

  it('refuses a payload that has been edited', async () => {
    const { readSession, signSession } = await import('../lib/auth/token');

    const token = signSession('user-ann', SECRET);
    const [version, , signature] = token.split('.');

    // Swap in a payload naming somebody else, keeping the real signature.
    const forged = Buffer.from(
      JSON.stringify({ v: 1, sub: 'user-bob', exp: 9_999_999_999, jti: 'x' }),
    ).toString('base64url');

    expect(readSession(`${version}.${forged}.${signature}`, SECRET)).toBeNull();
  });

  /*
   * The expiry deserves its own test rather than being folded into the one
   * above. It is the field an attacker most wants to change, because extending
   * it turns a token they already hold into one that never runs out, and it is
   * the field most likely to be trusted before the signature is checked by
   * someone refactoring this later.
   */
  it('refuses a token whose expiry has been extended', async () => {
    const { readSession, signSession } = await import('../lib/auth/token');

    const token = signSession('user-ann', SECRET);
    const [version, payload, signature] = token.split('.');

    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    claims.exp = 99_999_999_999;
    const extended = Buffer.from(JSON.stringify(claims)).toString('base64url');

    expect(readSession(`${version}.${extended}.${signature}`, SECRET)).toBeNull();
  });

  it('refuses a token whose signature has been edited', async () => {
    const { readSession, signSession } = await import('../lib/auth/token');

    const token = signSession('user-ann', SECRET);
    const [version, payload, signature] = token.split('.');

    // One character different, same length, so the length check is not what
    // catches it and the constant-time comparison is what runs.
    const flipped = (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1);
    expect(readSession(`${version}.${payload}.${flipped}`, SECRET)).toBeNull();
  });

  it('refuses an expired token and accepts one a second before', async () => {
    const { readSession, signSession, SESSION_MAX_AGE_SECONDS } =
      await import('../lib/auth/token');

    const issued = 1_700_000_000_000;
    const token = signSession('user-ann', SECRET, issued);

    const justBefore = issued + (SESSION_MAX_AGE_SECONDS - 2) * 1000;
    const justAfter = issued + (SESSION_MAX_AGE_SECONDS + 2) * 1000;

    expect(readSession(token, SECRET, justBefore)?.userId).toBe('user-ann');
    expect(readSession(token, SECRET, justAfter)).toBeNull();
  });

  it('refuses a token from a future format version', async () => {
    const { readSession, signSession } = await import('../lib/auth/token');

    const token = signSession('user-ann', SECRET);
    expect(readSession(token.replace(/^v1\./, 'v2.'), SECRET)).toBeNull();
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a number', 42],
    ['an object', {}],
    ['empty', ''],
    ['one part', 'nonsense'],
    ['two parts', 'v1.abc'],
    ['four parts', 'v1.a.b.c'],
    ['unbalanced base64', 'v1.!!!!.????'],
    ['very long', `v1.${'a'.repeat(5000)}.b`],
  ])('returns null rather than throwing for %s', async (_label, input) => {
    const { readSession } = await import('../lib/auth/token');
    expect(readSession(input, SECRET)).toBeNull();
  });

  it('refuses to sign or read with a weak secret', async () => {
    const { isUsableSecret, readSession, signSession } = await import('../lib/auth/token');

    expect(isUsableSecret('short')).toBe(false);
    expect(isUsableSecret(undefined)).toBe(false);
    expect(isUsableSecret('x'.repeat(32))).toBe(true);

    expect(() => signSession('user-ann', 'short')).toThrow(/SESSION_SECRET/);

    // Reading with a weak secret is null, not a throw. A missing secret is a
    // deployment problem, and the screens handle it; a request arriving at a
    // misconfigured deployment should look signed out, not crash.
    const token = signSession('user-ann', SECRET);
    expect(readSession(token, 'short')).toBeNull();
  });

  it('refuses to sign a session with no user', async () => {
    const { signSession } = await import('../lib/auth/token');
    expect(() => signSession('', SECRET)).toThrow(/no user id/);
  });
});

// ---------------------------------------------------------------------------
// Passwords
// ---------------------------------------------------------------------------

describe('passwords', () => {
  const GOOD = 'correct horse battery staple';

  it('verifies a password it has hashed', async () => {
    const { hashPassword, verifyPassword } = await import('../lib/auth/password');

    const stored = await hashPassword(GOOD);
    expect(await verifyPassword(GOOD, stored)).toBe(true);
  });

  it('refuses the wrong password', async () => {
    const { hashPassword, verifyPassword } = await import('../lib/auth/password');

    const stored = await hashPassword(GOOD);
    expect(await verifyPassword('correct horse battery stapl', stored)).toBe(false);
    expect(await verifyPassword('', stored)).toBe(false);
  });

  it('salts, so the same password hashes differently every time', async () => {
    const { hashPassword } = await import('../lib/auth/password');

    const a = await hashPassword(GOOD);
    const b = await hashPassword(GOOD);
    expect(a).not.toBe(b);
    // But both still verify, which is the point of storing the salt.
    const { verifyPassword } = await import('../lib/auth/password');
    expect(await verifyPassword(GOOD, a)).toBe(true);
    expect(await verifyPassword(GOOD, b)).toBe(true);
  });

  it('stores the cost parameters with the hash', async () => {
    const { hashPassword } = await import('../lib/auth/password');

    const stored = await hashPassword(GOOD);
    const parts = stored.split('$');

    // scrypt$N$r$p$salt$hash. The cost travels with the hash so raising it
    // later does not invalidate every existing row.
    expect(parts).toHaveLength(6);
    expect(parts[0]).toBe('scrypt');
    expect(Number(parts[1])).toBeGreaterThanOrEqual(16384);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty', ''],
    ['not a hash at all', 'hunter2'],
    ['too few fields', 'scrypt$16384$8$1$salt'],
    ['an unknown algorithm', 'bcrypt$16384$8$1$c2FsdA$aGFzaA'],
    ['a non-numeric cost', 'scrypt$abc$8$1$c2FsdA$aGFzaA'],
    ['an empty salt', 'scrypt$16384$8$1$$aGFzaA'],
    // 128 * N * r for these would be gigabytes. Refused by parsing rather
    // than handed to scrypt to fail on, or to succeed on and eat the machine.
    ['an absurd work factor', 'scrypt$1048576$32$1$c2FsdA$aGFzaA'],
  ])('returns false rather than throwing for %s', async (_label, stored) => {
    const { verifyPassword } = await import('../lib/auth/password');
    expect(await verifyPassword(GOOD, stored)).toBe(false);
  });

  it('normalises unicode, so a composed and decomposed password match', async () => {
    const { hashPassword, verifyPassword } = await import('../lib/auth/password');

    /*
     * The same word twice: once with a precomposed e-acute, once with a plain
     * e followed by a combining accent. Different bytes, same password as far
     * as anyone typing it is concerned, and which one a keyboard produces is
     * not something to lock an account over.
     *
     * Both accents are written as escapes rather than as the characters
     * themselves. The first draft used literals and the source-hygiene check
     * caught it on its first run: a literal combining mark parses fine in Node
     * and survives every test, then breaks when esbuild re-encodes the file.
     * That is how a broken safeUrl once shipped, so the rule has no exceptions.
     */
    const composed = 'caf\u00e9 in the morning';
    const decomposed = 'cafe\u0301 in the morning';
    expect(composed).not.toBe(decomposed);

    const stored = await hashPassword(composed);
    expect(await verifyPassword(decomposed, stored)).toBe(true);
  });

  it('knows when a hash was made with weaker settings', async () => {
    const { hashPassword, needsRehash } = await import('../lib/auth/password');

    expect(needsRehash(await hashPassword(GOOD))).toBe(false);
    expect(needsRehash('scrypt$4096$8$1$c2FsdA$aGFzaA')).toBe(true);
    expect(needsRehash('not a hash')).toBe(false);
  });

  it('refuses a password too short to be worth hashing', async () => {
    const { assertUsablePassword, MIN_PASSWORD_LENGTH } =
      await import('../lib/auth/password');

    expect(() => assertUsablePassword('short')).toThrow(
      new RegExp(`${MIN_PASSWORD_LENGTH} characters`),
    );
    expect(() => assertUsablePassword('')).toThrow(/Enter a password/);
    expect(() => assertUsablePassword(undefined)).toThrow(/Enter a password/);
    expect(() => assertUsablePassword('x'.repeat(2000))).toThrow(/too long/);
    expect(() => assertUsablePassword('a'.repeat(MIN_PASSWORD_LENGTH))).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// The identity provider
// ---------------------------------------------------------------------------

describe('normaliseEmail', () => {
  it.each([
    ['  Ann@Example.COM  ', 'ann@example.com'],
    ['ann+sites@example.co.uk', 'ann+sites@example.co.uk'],
  ])('tidies %s', async (input, expected) => {
    const { normaliseEmail } = await import('../lib/auth/identity');
    expect(normaliseEmail(input)).toBe(expected);
  });

  it.each([
    ['no at sign', 'ann.example.com'],
    ['two at signs', 'ann@@example.com'],
    ['nothing before the at', '@example.com'],
    ['nothing after the at', 'ann@'],
    ['a space inside', 'a nn@example.com'],
    ['no dot in the domain', 'ann@localhost'],
    ['not a string', 42],
    ['empty', ''],
    ['far too long', `${'a'.repeat(250)}@example.com`],
  ])('refuses %s', async (_label, input) => {
    const { normaliseEmail } = await import('../lib/auth/identity');
    expect(normaliseEmail(input)).toBeNull();
  });
});

describe('the password provider', () => {
  const GOOD = 'correct horse battery staple';

  async function provider(row: Record<string, unknown> | null) {
    const { passwordProvider } = await import('../lib/auth/identity');
    const { hashPassword } = await import('../lib/auth/password');

    const stored = row
      ? {
          id: 'user-ann',
          email: 'ann@example.com',
          name: 'Ann',
          status: 'active' as const,
          passwordHash: await hashPassword(GOOD),
          ...row,
        }
      : null;

    return passwordProvider(async () => stored);
  }

  it('returns the identity for the right password', async () => {
    const p = await provider({});
    expect(await p.verify('ann@example.com', GOOD)).toEqual({
      id: 'user-ann',
      email: 'ann@example.com',
      name: 'Ann',
    });
  });

  it('accepts the email in any case', async () => {
    const p = await provider({});
    expect(await p.verify('  Ann@Example.com ', GOOD)).not.toBeNull();
  });

  it('refuses the wrong password', async () => {
    const p = await provider({});
    expect(await p.verify('ann@example.com', 'wrong password entirely')).toBeNull();
  });

  it('refuses a suspended account holding the right password', async () => {
    // The point of the check. Suspending somebody has to actually stop them,
    // and it is enforced here rather than only in a screen.
    const p = await provider({ status: 'suspended' });
    expect(await p.verify('ann@example.com', GOOD)).toBeNull();
  });

  it('refuses an account with no password set', async () => {
    // An SSO-created account has no hash. Answering "no" rather than treating
    // a null hash as a wildcard is the difference between a stub and a hole.
    const p = await provider({ passwordHash: null });
    expect(await p.verify('ann@example.com', '')).toBeNull();
    expect(await p.verify('ann@example.com', GOOD)).toBeNull();
  });

  it('refuses an unknown email', async () => {
    const p = await provider(null);
    expect(await p.verify('nobody@example.com', GOOD)).toBeNull();
  });

  /*
   * A one-sided assertion, deliberately.
   *
   * Comparing the two paths' timings against each other is the obvious test
   * and it is flaky: a loaded CI box makes any ratio meaningless. What is not
   * flaky is a floor. scrypt at N=16384 moves 16MB and cannot finish in single
   * digit milliseconds on any machine this will ever run on, so if the unknown
   * email path returns in under 10ms it skipped the hashing, and the sign-in
   * form has become a "does this person have an account" oracle.
   */
  it('spends real time on an unknown email, so it is not an oracle', async () => {
    const p = await provider(null);

    const started = performance.now();
    await p.verify('nobody@example.com', GOOD);
    const elapsed = performance.now() - started;

    expect(elapsed, 'the unknown-email path returned too fast to have hashed').toBeGreaterThan(10);
  });

  it('spends real time on a malformed email too', async () => {
    const p = await provider(null);

    const started = performance.now();
    await p.verify('not-an-email', GOOD);
    const elapsed = performance.now() - started;

    expect(elapsed).toBeGreaterThan(10);
  });
});

describe('choosing a provider', () => {
  const lookup = async () => null;

  it('uses passwords when Travelify SSO is not configured', async () => {
    const { chooseProvider } = await import('../lib/auth/identity');
    const p = chooseProvider(lookup, {});
    expect(p.name).toBe('password');
    expect(p.usesPasswordForm).toBe(true);
  });

  it('uses Travelify when it is', async () => {
    const { chooseProvider } = await import('../lib/auth/identity');
    const p = chooseProvider(lookup, { TRAVELIFY_SSO_URL: 'https://id.travelify.io' });
    expect(p.name).toBe('travelify');
    expect(p.usesPasswordForm).toBe(false);
  });

  it('throws rather than denying, because it is not built', async () => {
    const { chooseProvider } = await import('../lib/auth/identity');
    const p = chooseProvider(lookup, { TRAVELIFY_SSO_URL: 'https://id.travelify.io' });

    // Returning null would read as "wrong password" and get debugged as one.
    await expect(p.verify('ann@example.com', 'anything at all')).rejects.toThrow(
      /not built/,
    );
  });
});

// ---------------------------------------------------------------------------
// The queries that run before a tenant is known
// ---------------------------------------------------------------------------

describe('withLogin and withUser', () => {
  it('sets the login email as the first statement in the transaction', async () => {
    const { findCredentials } = await import('../lib/db/users');

    respond('from public.auth_users', [
      { id: 'user-ann', email: 'ann@example.com', name: 'Ann', password_hash: 'h', status: 'active' },
    ]);

    await findCredentials('ann@example.com');

    expect(log[0].sql).toBe('BEGIN');
    expect(log[1].sql).toContain("set_config('app.login_email'");
    expect(log[1].params).toEqual(['ann@example.com']);
    // The read comes after, never before. A read before the setting is a read
    // with no policy to satisfy, which returns nothing and looks like a
    // missing row rather than a bug.
    expect(log[2].sql).toContain('from public.auth_users');
  });

  it('sets the user as the first statement in the transaction', async () => {
    const { listMemberships } = await import('../lib/db/users');

    respond('from public.tenant_users', [
      { id: 'aaa', slug: 'alpha', name: 'Alpha', role: 'owner' },
    ]);

    await listMemberships('user-ann');

    expect(log[0].sql).toBe('BEGIN');
    expect(log[1].sql).toContain("set_config('app.current_user_id'");
    expect(log[1].params).toEqual(['user-ann']);
  });

  it('scopes both settings to the transaction, not the connection', async () => {
    const { findCredentials, listMemberships } = await import('../lib/db/users');

    await findCredentials('ann@example.com');
    await listMemberships('user-ann');

    const settings = log.filter((s) => s.sql.includes('set_config'));
    expect(settings).toHaveLength(2);
    for (const statement of settings) {
      // The third argument is the local flag. Without it the value survives on
      // a pooled connection and the next request inherits it.
      expect(statement.sql).toContain('true');
      expect(statement.sql).not.toContain('false');
    }
  });

  it('never runs a query outside a transaction', async () => {
    const { findCredentials, listMemberships, touchLastSeen } =
      await import('../lib/db/users');

    await findCredentials('ann@example.com');
    await listMemberships('user-ann');
    await touchLastSeen('user-ann');

    let depth = 0;
    for (const statement of log) {
      if (statement.sql === 'BEGIN') depth += 1;
      else if (statement.sql === 'COMMIT' || statement.sql === 'ROLLBACK') depth -= 1;
      else expect(depth, `"${statement.sql}" ran outside a transaction`).toBeGreaterThan(0);
    }
  });

  it('uses the read-write role, never the renderer', async () => {
    const { findCredentials, listMemberships } = await import('../lib/db/users');

    await findCredentials('ann@example.com');
    await listMemberships('user-ann');

    expect(log.every((s) => s.role === 'app')).toBe(true);
  });

  it('maps a membership row, and does not invent a role it does not know', async () => {
    const { listMemberships } = await import('../lib/db/users');

    respond('from public.tenant_users', [
      { id: 'aaa', slug: 'alpha', name: 'Alpha', role: 'owner' },
      { id: 'bbb', slug: 'beta', name: 'Beta', role: 'viewer' },
      // A role the type does not have. Falling back to the least privileged
      // thing would be wrong too, but editor is what the column defaults to
      // and this only affects what a screen shows, never what a policy allows.
      { id: 'ccc', slug: 'gamma', name: 'Gamma', role: 'something-new' },
    ]);

    expect(await listMemberships('user-ann')).toEqual([
      { tenantId: 'aaa', slug: 'alpha', name: 'Alpha', role: 'owner' },
      { tenantId: 'bbb', slug: 'beta', name: 'Beta', role: 'viewer' },
      { tenantId: 'ccc', slug: 'gamma', name: 'Gamma', role: 'editor' },
    ]);
  });

  it('returns null for an email with no row, without inspecting anything', async () => {
    const { findCredentials } = await import('../lib/db/users');
    expect(await findCredentials('nobody@example.com')).toBeNull();
  });

  it('reads a null password hash as null, not as the string "null"', async () => {
    const { findCredentials } = await import('../lib/db/users');

    respond('from public.auth_users', [
      { id: 'user-sso', email: 'sso@example.com', name: null, password_hash: null, status: 'active' },
    ]);

    const found = await findCredentials('sso@example.com');
    // String(null) is "null", which is 4 characters and would be handed to the
    // hash parser as though it were a hash. It refuses it, but the honest
    // shape is null and the provider checks for exactly that.
    expect(found?.passwordHash).toBeNull();
    expect(found?.name).toBeNull();
  });

  it.each([
    ['empty', ''],
    ['not a string', 42],
    ['null', null],
    ['far too long', 'x'.repeat(300)],
  ])('refuses %s as a user id', async (_label, value) => {
    const { assertUserId } = await import('../lib/db/users');
    expect(() => assertUserId(value)).toThrow(/Not a user id/);
  });
});

// ---------------------------------------------------------------------------
// Where the dangerous functions are allowed to be called from
// ---------------------------------------------------------------------------

/*
 * These are greps, and a grep is a weak test. They are here anyway because what
 * they check cannot be checked any other way: the danger is not that a function
 * misbehaves, it is that somebody calls a correct function from the wrong place.
 * A reviewer catches that by knowing to look. This catches it by failing.
 */
describe('call sites', () => {
  const ROOT = join(__dirname, '..');
  const SKIP = new Set(['node_modules', '.next', '.git', 'out', 'tests']);

  function sources(dir: string, found: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      if (SKIP.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) sources(full, found);
      else if (/\.tsx?$/.test(entry)) found.push(full);
    }
    return found;
  }

  function callers(fn: string, definedIn: string): string[] {
    return sources(ROOT)
      .filter((file) => !file.endsWith(definedIn))
      .filter((file) => new RegExp(String.raw`\b${fn}\s*\(`).test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(ROOT.length + 1))
      .sort();
  }

  /*
   * startSession trusts its caller completely. It signs a cookie for whatever
   * user id it is handed, with no check of any kind, because the check belongs
   * to the identity provider that ran immediately before it. That makes a
   * second caller an authentication bypass: pass a user id, become that user.
   */
  it('only the sign-in action starts a session', () => {
    expect(callers('startSession', join('lib', 'auth', 'session.ts'))).toEqual([
      join('app', 'actions', 'auth.ts'),
    ]);
  });

  /*
   * signSession is the layer below, and the same argument applies with less
   * padding: it mints the token itself.
   */
  it('only the session module signs a token', () => {
    expect(callers('signSession', join('lib', 'auth', 'token.ts'))).toEqual([
      join('lib', 'auth', 'session.ts'),
    ]);
  });

  /*
   * withUser and withLogin open a transaction with NO tenant set, so a query
   * inside one is not scoped by tenant at all. That is correct for the two
   * questions they exist for and wrong for everything else, which is why they
   * are not exported past lib/db/users.ts.
   */
  it('nothing outside lib/db uses the unscoped user transaction', () => {
    expect(callers('withUser', join('lib', 'db', 'users.ts'))).toEqual([]);
    expect(callers('withLogin', join('lib', 'db', 'users.ts'))).toEqual([]);
  });

  /*
   * The stand-in that granted everyone access to everything, and the workspace
   * slug cookie it worked with. Both are gone; this fails if either comes back,
   * including as a stray import somebody restores from a merge.
   */
  it('the open-access stand-in is gone and stays gone', () => {
    const offenders = sources(ROOT)
      .filter((file) =>
        /auth\/temporary|AUTH_IS_NOT_BUILT_YET|OPEN_ACCESS_WARNING|from '.*lib\/session'/.test(
          readFileSync(file, 'utf8'),
        ),
      )
      .map((file) => file.slice(ROOT.length + 1));

    expect(offenders, 'auth is built now, so nothing should reach for the stand-in').toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Where sign-in is allowed to send you
// ---------------------------------------------------------------------------

describe('the return path after signing in', () => {
  it.each([
    ['/sites', '/sites'],
    ['/editor?page=abc', '/editor?page=abc'],
    ['/sites/nested/thing', '/sites/nested/thing'],
  ])('keeps a local path: %s', async (input, expected) => {
    const { safeReturnPath } = await import('../lib/auth/return-path');
    expect(safeReturnPath(input)).toBe(expected);
  });

  it.each([
    // The open redirect, in every spelling that gets past startsWith('/').
    ['protocol relative', '//evil.example/steal'],
    ['protocol relative with a backslash', '/\\evil.example'],
    ['a backslash anywhere', '/sites\\..\\evil'],
    ['an absolute url', 'https://evil.example'],
    ['a scheme with no slash', 'javascript:alert(1)'],
    // A newline in a redirect target is header injection waiting for a careless
    // caller, and there is no legitimate path containing one.
    ['a newline', '/sites\nLocation: https://evil.example'],
    ['a tab', '/sites\tthing'],
    ['a space', '/sites and more'],
    // Not a string at all.
    ['undefined', undefined],
    ['null', null],
    ['a number', 42],
    ['an object', { toString: () => '/sites' }],
    // Back to itself, which would be a loop rather than a security problem.
    ['the sign-in page', '/signin'],
    ['the sign-in page with a query', '/signin?next=%2Fsignin'],
    // Relative, so it would resolve against whatever page it is used on.
    ['a bare word', 'sites'],
    ['empty', ''],
  ])('refuses %s', async (_label, input) => {
    const { DEFAULT_DESTINATION, safeReturnPath } = await import('../lib/auth/return-path');
    expect(safeReturnPath(input)).toBe(DEFAULT_DESTINATION);
  });
});
