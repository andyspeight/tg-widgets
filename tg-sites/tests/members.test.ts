/**
 * Who can edit a site, and the link that lets somebody in.
 *
 * WHAT IS ACTUALLY AT RISK HERE, and it is not the screen.
 *
 * 1. THE TOKEN IS A CREDENTIAL. Whoever holds one can join a site and edit a
 *    live travel business's website. It must never be stored, must be long
 *    enough that guessing is not a strategy, and must be usable exactly once.
 *
 * 2. AN INVITE MUST NOT BECOME A PRIVILEGE ESCALATION. The flow creates an
 *    account and starts a session, which is the one path in this product that
 *    does either. The email it creates has to come off the invite row and never
 *    off the form, and the id it signs in has to come off the insert and never
 *    off an argument, or "join a site" becomes "become anybody".
 *
 * 3. THE OWNER CHECK IS ON THE SERVER. The screen draws buttons for an owner,
 *    which stops nobody: a server action is a public endpoint whose URL is in
 *    the page's own JavaScript.
 *
 * 4. THE LAST OWNER CANNOT LEAVE. A site with no owner is one nobody can invite
 *    to, change a role on or hand over, and the only remedy is us running SQL.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  hashInviteToken,
  inviteLink,
  INVITE_MAX_AGE_DAYS,
  looksLikeInviteToken,
  newInviteToken,
  sameHash,
} from '../lib/auth/invite';
import { isMemberRole, MEMBER_ROLES } from '../lib/db/members';

function read(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf8');
}

/** Comments out, so a source assertion cannot read the prose explaining a bug. */
function code(...parts: string[]): string {
  return read(...parts).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

// ---------------------------------------------------------------------------
// The token
// ---------------------------------------------------------------------------

describe('the token in an invite link', () => {
  it('is long enough that guessing is not a strategy', () => {
    const token = newInviteToken();
    // 32 bytes as base64url is 43 characters, which is 256 bits of entropy.
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('is different every time', () => {
    const seen = new Set(Array.from({ length: 200 }, () => newInviteToken()));
    expect(seen.size).toBe(200);
  });

  it('survives being put in a URL without escaping', () => {
    // base64url, so no +, / or = to be mangled by a path or a chat client.
    for (let i = 0; i < 50; i += 1) {
      const token = newInviteToken();
      expect(encodeURIComponent(token)).toBe(token);
    }
  });

  it('hashes to hex, which nothing between here and Postgres treats as special', () => {
    expect(hashInviteToken('abc')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hashes the same input to the same value and a different one to a different value', () => {
    expect(hashInviteToken('abc')).toBe(hashInviteToken('abc'));
    expect(hashInviteToken('abc')).not.toBe(hashInviteToken('abd'));
  });

  /*
   * The cheap gate. Its only job is to keep a path of junk from reaching the
   * database at all, and a token that passes it is still worthless without a
   * matching row.
   */
  it('refuses what could not be one of ours before anything is hashed', () => {
    expect(looksLikeInviteToken(newInviteToken())).toBe(true);

    for (const bad of ['', 'short', '../../etc/passwd', 'x'.repeat(5000), null, 42, {}]) {
      expect(looksLikeInviteToken(bad), String(bad).slice(0, 20)).toBe(false);
    }
  });

  it('compares two hashes without leaking which byte differed', () => {
    const a = hashInviteToken('one');
    expect(sameHash(a, a)).toBe(true);
    expect(sameHash(a, hashInviteToken('two'))).toBe(false);
    // A length mismatch is refused rather than thrown, which timingSafeEqual
    // would do on its own.
    expect(sameHash(a, 'short')).toBe(false);
  });

  it('builds a link on the origin it was given and no other', () => {
    expect(inviteLink('https://sites.example.com', 'abc')).toBe(
      'https://sites.example.com/join/abc',
    );
    expect(inviteLink('https://sites.example.com/', 'abc')).toBe(
      'https://sites.example.com/join/abc',
    );
  });

  it('expires, because a link that works forever is a credential nobody remembers', () => {
    expect(INVITE_MAX_AGE_DAYS).toBeGreaterThan(0);
    expect(INVITE_MAX_AGE_DAYS).toBeLessThanOrEqual(30);
    // The number in the schema and the number in the module have to agree, or
    // the screen tells somebody a date the database does not honour.
    expect(read('db', 'migrations', '0019_site_invites.sql'))
      .toContain(`interval '${INVITE_MAX_AGE_DAYS} days'`);
  });

  /*
   * THE ONE THAT WOULD NOT SHOW UP ANYWHERE ELSE. Storing the token itself
   * would work perfectly, and would mean a database copy, a backup on a laptop
   * or a log line yielded working links into every client's site.
   */
  it('is never written down, only its hash', () => {
    const schema = read('db', 'migrations', '0019_site_invites.sql');
    expect(schema).toContain('token_hash  text not null unique');
    expect(schema).not.toMatch(/^\s*token\s+text/m);

    const layer = code('lib', 'db', 'members.ts');
    expect(layer).not.toContain('newInviteToken');
    expect(layer).toContain('tokenHash');
  });
});

describe('roles', () => {
  it('are exactly three, and nothing else parses as one', () => {
    expect([...MEMBER_ROLES]).toEqual(['owner', 'editor', 'viewer']);
    for (const bad of ['admin', 'OWNER', '', null, 1, {}]) {
      expect(isMemberRole(bad), String(bad)).toBe(false);
    }
  });

  it('are the same three the database will accept', () => {
    const schema = read('db', 'migrations', '0002_core_tables.sql');
    for (const role of MEMBER_ROLES) expect(schema).toContain(`'${role}'`);
    expect(read('db', 'migrations', '0019_site_invites.sql'))
      .toContain("check (role in ('owner', 'editor', 'viewer'))");
  });
});

// ---------------------------------------------------------------------------
// The query layer, read as source
// ---------------------------------------------------------------------------

describe('the last owner', () => {
  const source = code('lib', 'db', 'members.ts');

  it('cannot be removed', () => {
    const remove = source.slice(source.indexOf('export async function removeMember'));
    expect(remove).toContain("if (owners.length === 1 && owners[0] === userId) return 'last-owner';");
  });

  it('cannot be demoted either, which is the same mistake', () => {
    const set = source.slice(
      source.indexOf('export async function setMemberRole'),
      source.indexOf('export async function removeMember'),
    );
    expect(set).toContain("next !== 'owner' && owners.length === 1");
  });

  /*
   * FOR UPDATE IS THE WHOLE POINT. Two owners each demoting the other at the
   * same moment both read "there are two", both decide it is safe, and the site
   * ends up with none.
   */
  it('is counted under a row lock, not just counted', () => {
    expect(source).toContain("where role = 'owner' for update");
  });
});

describe('reading the members list', () => {
  const source = code('lib', 'db', 'members.ts');

  /*
   * NAMED COLUMNS, NEVER A STAR. 0019 widens auth_users so a teammate's row is
   * visible inside one tenant, and the grant on that table is table-wide because
   * Postgres cannot attach a column list to a policy. A star here would pull
   * every colleague's password hash into the application for no reason.
   */
  it('never selects a star from auth_users', () => {
    expect(source).not.toMatch(/select\s+[a-z]*\.?\*/);
    expect(source).not.toContain('password_hash');
    expect(source).toContain('u.email, u.name, u.last_seen_at');
  });

  it('goes through withTenant like everything else scoped to a site', () => {
    const list = source.slice(source.indexOf('export async function listMembers'));
    expect(list).toContain('withTenant(tenantId');
  });
});

describe('redeeming a link', () => {
  const source = code('lib', 'db', 'members.ts');
  const accept = source.slice(source.indexOf('export async function acceptInvite'));

  /*
   * CLAIMED BEFORE GRANTED, and the claim is the lock: the UPDATE names
   * `accepted_at is null`, so of two requests racing on one link exactly one
   * matches a row. The other order would grant membership and then discover the
   * invite was already spent.
   */
  it('spends the invite before it grants anything', () => {
    const claim = accept.indexOf('update public.site_invites');
    const grant = accept.indexOf('insert into public.tenant_users');
    expect(claim).toBeGreaterThan(-1);
    expect(grant).toBeGreaterThan(-1);
    expect(claim).toBeLessThan(grant);
    expect(accept).toContain('and accepted_at is null');
  });

  it('stops when somebody else got there first', () => {
    const claimAt = accept.indexOf('update public.site_invites');
    const guardAt = accept.indexOf('if (!claimed.length)');
    const grantAt = accept.indexOf('insert into public.tenant_users');
    expect(guardAt).toBeGreaterThan(claimAt);
    expect(guardAt).toBeLessThan(grantAt);
  });

  /*
   * A link that lets whoever holds it edit a client's live website is a link
   * somebody forwards without thinking.
   */
  it('refuses a link opened by anybody but the person it names', () => {
    expect(accept).toContain("return { ok: false, reason: 'wrong-person' };");
    expect(accept).toContain('invite.email !== user.email.trim().toLowerCase()');
  });

  /*
   * An invite is a way IN, not a way to change what somebody already has. A
   * stale one naming them a viewer must not demote an editor, and one naming
   * them an owner must certainly not promote anybody.
   */
  it('does not change the role of somebody already in the site', () => {
    expect(accept).toContain('on conflict (tenant_id, user_id) do nothing');
  });

  it('works inside the tenant the invite named, not one from the request', () => {
    expect(accept).toContain('withTenant(invite.tenantId');
  });
});

// ---------------------------------------------------------------------------
// The actions
// ---------------------------------------------------------------------------

describe('who may change what', () => {
  const source = code('app', 'actions', 'members.ts');

  /*
   * THE CHECK IS HERE, NOT ON THE SCREEN. Hiding a button is a courtesy to
   * whoever is looking at it and no obstacle at all to somebody calling the
   * action directly.
   */
  it('every action that changes anything asks requireOwner first', () => {
    for (const name of [
      'inviteMemberAction',
      'revokeInviteAction',
      'setRoleAction',
      'removeMemberAction',
    ]) {
      const body = source.slice(source.indexOf(`export async function ${name}`));
      const bounded = body.slice(0, body.indexOf('\nexport ') + 1 || undefined);
      expect(bounded, `${name} does not check`).toContain('await requireOwner()');
    }
  });

  it('asks before it reads a single argument', () => {
    const invite = source.slice(source.indexOf('export async function inviteMemberAction'));
    expect(invite.indexOf('await requireOwner()')).toBeLessThan(invite.indexOf('normaliseEmail('));
  });

  it('counts our own staff as owners, like the custom code panel does', () => {
    expect(source).toContain('isStaffEmail(user.email)');
  });

  /*
   * THE ONE ACTION WITH NO OWNER CHECK, and it must stay the only one. What
   * stands in its place is a 256-bit token and the email binding.
   */
  it('and the two join actions deliberately do not, because they cannot', () => {
    for (const name of ['acceptInviteAction', 'joinWithPasswordAction']) {
      const body = source.slice(source.indexOf(`export async function ${name}`));
      const bounded = body.slice(0, body.indexOf('\nexport ') + 1 || undefined);
      expect(bounded, name).not.toContain('requireOwner');
      expect(bounded, name).toContain('looksLikeInviteToken');
    }
  });
});

describe('issuing a link', () => {
  const source = code('app', 'actions', 'members.ts');

  /*
   * THERE IS NO "ADD AN EXISTING ACCOUNT BY EMAIL", and it is a security
   * decision rather than a missing feature: it would have to behave differently
   * for an address that has an account, and the difference is observable by any
   * customer who types an email into the box.
   */
  it('has one path, whether or not the address has an account', () => {
    expect(source).not.toMatch(/addMemberAction|addExistingAction/);
    expect(source).toContain('export async function inviteMemberAction');
  });

  /*
   * A LINK IS A CREDENTIAL WITH SOMEWHERE TO GO, and the somewhere has to be
   * us. Parsed rather than pattern-matched, so a value like
   * "https://us.example.com@evil.test" is decomposed by the URL parser.
   */
  it('builds the link on an origin it has checked is ours', () => {
    expect(source).toContain('const origin = safeOrigin(input.origin);');
    expect(source).toContain('new URL(value)');
    expect(source).toContain("url.protocol !== 'https:'");
    expect(source).toContain('url.username || url.password');
  });

  it('never reads a host header for it', () => {
    expect(source).not.toContain('headers()');
    expect(source).not.toMatch(/get\(['"]host['"]\)/i);
  });

  it('hands the token back once and never stores it', () => {
    expect(source).toContain('const token = newInviteToken();');
    expect(source).toContain('tokenHash: hashInviteToken(token)');
    expect(source).toContain('link: inviteLink(origin, token)');
  });
});

describe('creating an account from an invite', () => {
  const source = code('app', 'actions', 'members.ts');
  const users = code('lib', 'db', 'users.ts');

  /*
   * THE ESCALATION THIS FLOW WOULD BE IF IT TOOK THE EMAIL FROM THE FORM.
   * Redeeming a link into an address of your choosing is "join a site" becoming
   * "become anybody with an account here".
   */
  it('creates the account at the address the invite names, never the form', () => {
    const join_ = source.slice(source.indexOf('export async function joinWithPasswordAction'));
    expect(join_).toContain('email: invite.email,');
    expect(join_).not.toMatch(/email:\s*(String\()?input\./);
  });

  it('refuses a password shorter than the rest of the product accepts', () => {
    expect(source).toContain('password.length < MIN_PASSWORD_LENGTH');
  });

  it('makes the account, then the session, then the membership', () => {
    const join_ = source.slice(source.indexOf('export async function joinWithPasswordAction'));
    const account = join_.indexOf('createInvitedAccount(');
    const session = join_.indexOf('startSession(');
    const member = join_.indexOf('acceptInvite(');
    expect(account).toBeLessThan(session);
    expect(session).toBeLessThan(member);
  });

  /*
   * The id convention has to match db/make-user.mjs, or the Travelify SSO
   * remapping becomes two jobs with two shapes to recognise.
   */
  it('uses the same id shape as the script that made the first account', () => {
    expect(users).toContain('const id = `local:${input.email}`;');
    expect(read('db', 'make-user.mjs')).toContain('const id = `local:${email}`;');
  });

  it('gives up rather than overwriting an account that is already there', () => {
    expect(users).toContain('on conflict (email) do nothing');
  });
});

// ---------------------------------------------------------------------------
// The schema
// ---------------------------------------------------------------------------

describe('the schema', () => {
  const sql = read('db', 'migrations', '0019_site_invites.sql');

  /*
   * NO SECOND PRIVILEGED FUNCTION. 0008 argued this out for sign-in: a policy
   * can be reviewed by reading it and SECURITY DEFINER code cannot, and the
   * isolation suite asserts that exactly one function in the database sees past
   * RLS. This migration solves the same shape of problem the same way.
   */
  it('adds no SECURITY DEFINER function', () => {
    // Comments out first. This file ARGUES about SECURITY DEFINER at length and
    // the first version of this check read the argument as the thing it was
    // arguing against, which is the same trap the source-text checks elsewhere
    // in this suite already document.
    const statements = sql.replace(/^\s*--[^\n]*$/gm, '');
    expect(statements).not.toMatch(/security\s+definer/i);
    expect(sql).toContain('create or replace function public.invite_hash()');
    expect(sql).toContain("current_setting('app.invite_token_hash', true)");
  });

  it('reveals exactly the row whose hash the caller already named', () => {
    expect(sql).toContain('create policy site_invites_by_token on public.site_invites');
    expect(sql).toContain('for select to tg_sites_app');
    expect(sql).toContain('using (token_hash = public.invite_hash())');
  });

  it('keeps the ordinary tenant policy for everything else', () => {
    expect(sql).toContain('create policy site_invites_app on public.site_invites');
    expect(sql).toContain('using (tenant_id = public.current_tenant())');
  });

  it('turns row level security on and forces it', () => {
    expect(sql).toContain('alter table public.site_invites enable row level security');
    expect(sql).toContain('alter table public.site_invites force row level security');
  });

  it('takes the table back off anon and authenticated', () => {
    expect(sql).toContain('revoke all on public.site_invites from public, anon, authenticated');
    expect(sql).not.toMatch(/grant .* on public\.site_invites to tg_sites_renderer/);
  });

  /*
   * Inviting the same colleague twice is what somebody does when the first link
   * went astray, and the useful answer is a fresh link rather than an error
   * about one they cannot find. Partial, so an accepted invite stays on record.
   */
  it('allows one live invite per person per site', () => {
    expect(sql).toContain('create unique index if not exists site_invites_live');
    expect(sql).toContain('where accepted_at is null');
  });

  it('lets a colleague be seen, and only inside the site currently open', () => {
    expect(sql).toContain('create policy auth_users_teammates on public.auth_users');
    expect(sql).toContain('tu.tenant_id = public.current_tenant()');
  });

  it('is checked against a real database as well', () => {
    const isolation = read('db', 'isolation-check.sql');
    expect(isolation).toContain('public.site_invites');
    expect(isolation).toContain('auth_users_teammates');
  });
});

// ---------------------------------------------------------------------------
// The screens
// ---------------------------------------------------------------------------

describe('what the screens do', () => {
  const screen = code('components', 'members', 'MembersScreen.tsx');
  const page = code('app', 'members', 'page.tsx');
  const joinPage = code('app', 'join', '[token]', 'page.tsx');

  it('is drawn for everybody and editable by an owner', () => {
    expect(page).toContain("const canManage = site.role === 'owner' || isStaffEmail(user.email);");
    expect(screen).toContain('{canManage && (');
  });

  it('says the link is shown once, where it can be read before navigating away', () => {
    expect(screen).toContain('It is the only');
    expect(screen).toContain('we do not keep a copy');
  });

  /*
   * Somebody expecting an email will sit waiting for one. This product has no
   * email transport, and saying so is better than a silence they interpret.
   */
  it('says out loud that no email is sent', () => {
    expect(screen).toContain('We do not send the email');
  });

  it('never puts the invite link in an index', () => {
    expect(joinPage).toContain('robots: { index: false, follow: false }');
  });

  /*
   * Expired, spent, revoked, for a switched-off site or never real: one
   * sentence covers them, so a stale link tells nobody what used to be there.
   */
  it('gives one answer for every way a link can be dead', () => {
    expect(joinPage).toContain('This link has expired');
    expect(joinPage).not.toMatch(/already been used<|was revoked|no such invite/i);
  });

  it('names both addresses when the wrong person opens it', () => {
    expect(joinPage).toContain('This invite is for somebody else');
    expect(joinPage).toContain('{invite.email}');
    expect(joinPage).toContain('{user.email}');
  });

  it('associates every field with its label', () => {
    for (const id of ['mb-email', 'mb-role']) {
      expect(screen, id).toContain(`htmlFor="${id}"`);
      expect(screen, id).toContain(`id="${id}"`);
    }
    const form = code('components', 'members', 'JoinForm.tsx');
    for (const id of ['jn-name', 'jn-password']) {
      expect(form, id).toContain(`htmlFor="${id}"`);
      expect(form, id).toContain(`id="${id}"`);
    }
  });

  it('tells a password manager it is a new password, not a login', () => {
    expect(code('components', 'members', 'JoinForm.tsx')).toContain('autoComplete="new-password"');
  });

  it('is reachable from the dashboard', () => {
    expect(code('components', 'sites', 'SiteDashboard.tsx')).toContain('href="/members"');
  });
});
