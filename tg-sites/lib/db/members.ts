/**
 * Who can edit this site, and who has been asked to.
 *
 * WHAT WAS MISSING. tenant_users has held owner, editor and viewer since the
 * first migration, and until 1 Aug 2026 nothing in the application ever wrote a
 * row: the only way in was db/make-user.mjs printing SQL for somebody to paste.
 * Every site had exactly one user, so an agency with three staff could not use
 * the product at all.
 *
 * A MEMBER AND A PENDING INVITE ARE TWO STATES OF ONE THING as far as the screen
 * is concerned, so they live in one file. The lifecycles are different enough
 * that they are separate tables, and close enough that the rules about the last
 * owner have to see both.
 *
 * EVERY READ AND WRITE HERE IS TENANT SCOPED except the one that cannot be:
 * redeeming a link, where the person holding it is not yet a member. That one
 * goes through inviteByToken in lib/db/users.ts, which is the door for questions
 * that come before a tenant is known, and it hands back a tenant id that the
 * rest of accept() then works inside.
 *
 * THE LAST OWNER CANNOT BE REMOVED OR DEMOTED. A site with no owner is a site
 * nobody can invite anybody to, change a role on or hand over, and the only
 * remedy is us running SQL. The check holds a row lock while it counts, because
 * two owners demoting each other at the same moment is exactly the race that
 * produces one.
 */

import 'server-only';

import { isMemberRole, type MemberRole } from '../auth/roles';
import { parsePermissions, type PermissionSet } from '../auth/permissions';
import { withTenant, type Tx } from './withTenant';
import { inviteByToken } from './users';

/** Write a JS value into a jsonb column, the same helper the starters use. */
function json(tx: Tx, value: unknown) {
  return tx.json(value as Parameters<Tx['json']>[0]);
}

/*
 * The vocabulary lives in lib/auth/roles.ts, which has no imports at all. It has
 * to: this module is `server-only` because it holds queries, and the members
 * screen is a client component that needs the same three words. Re-exported here
 * so a caller that already has this module does not need both.
 */
export { MEMBER_ROLES, isMemberRole, ROLE_NOTES, type MemberRole } from '../auth/roles';

export interface Member {
  userId: string;
  email: string;
  name: string | null;
  role: MemberRole;
  /** The capabilities granted to this member, or null when never set. */
  permissions: PermissionSet | null;
  joinedAt: Date | null;
  lastSeenAt: Date | null;
}

export interface PendingInvite {
  id: string;
  email: string;
  role: MemberRole;
  /** The capabilities this person lands with, or null for the site default. */
  permissions: PermissionSet | null;
  createdAt: Date;
  expiresAt: Date;
}

function role(value: unknown): MemberRole {
  return isMemberRole(value) ? value : 'editor';
}

function date(value: unknown): Date | null {
  return value ? new Date(String(value)) : null;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * Everybody in this site, owners first.
 *
 * THE JOIN TO auth_users ONLY WORKS BECAUSE OF A POLICY ADDED IN 0019.
 * auth_users_self limits the app role to its own row, which is right everywhere
 * else and would make this list a column of blanks. auth_users_teammates widens
 * it to people in the tenant currently open, and to nothing else.
 *
 * Named columns, never `select u.*`. The grant on auth_users is table-wide, so
 * a star here would pull every teammate's password hash into the application
 * for no reason. 0019 says out loud that Postgres cannot attach a column list
 * to a policy; this is the other half of that, and it is the half that is easy
 * to undo by accident.
 */
export async function listMembers(tenantId: string): Promise<Member[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      select tu.user_id, tu.role, tu.permissions, tu.created_at, u.email, u.name, u.last_seen_at
      from public.tenant_users tu
      join public.auth_users u on u.id = tu.user_id
      order by (tu.role <> 'owner'), u.email
    `;

    return rows.map((raw) => {
      const row = raw as Record<string, unknown>;
      return {
        userId: String(row.user_id),
        email: String(row.email ?? ''),
        name: row.name == null ? null : String(row.name),
        role: role(row.role),
        permissions: parsePermissions(row.permissions),
        joinedAt: date(row.created_at),
        lastSeenAt: date(row.last_seen_at),
      };
    });
  });
}

/** Invites that have not been used and have not run out. */
export async function listInvites(tenantId: string): Promise<PendingInvite[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      select id, email, role, permissions, created_at, expires_at
      from public.site_invites
      where accepted_at is null and expires_at > now()
      order by created_at desc
    `;

    return rows.map((raw) => {
      const row = raw as Record<string, unknown>;
      return {
        id: String(row.id),
        email: String(row.email),
        role: role(row.role),
        permissions: parsePermissions(row.permissions),
        createdAt: new Date(String(row.created_at)),
        expiresAt: new Date(String(row.expires_at)),
      };
    });
  });
}

// ---------------------------------------------------------------------------
// The last owner
// ---------------------------------------------------------------------------

/**
 * The owners of this site, locked for the rest of the transaction.
 *
 * FOR UPDATE IS THE WHOLE POINT. Two owners each demoting the other at the same
 * moment both read "there are two owners", both decide it is safe, and the site
 * ends up with none. The lock makes the second one wait and read the answer the
 * first one produced.
 */
async function lockOwners(tx: Tx): Promise<string[]> {
  const rows = await tx`
    select user_id from public.tenant_users where role = 'owner' for update
  `;
  return rows.map((row) => String((row as Record<string, unknown>).user_id));
}

/** Why a change was refused, or null when it was not. */
export type MemberRefusal = 'last-owner' | 'not-a-member' | null;

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/** Change somebody's role. Refuses to leave the site without an owner. */
export async function setMemberRole(
  tenantId: string,
  userId: string,
  next: MemberRole,
): Promise<MemberRefusal> {
  return withTenant(tenantId, async (tx) => {
    const owners = await lockOwners(tx);

    // Taking the last owner's badge off is the same mistake as removing them.
    if (next !== 'owner' && owners.length === 1 && owners[0] === userId) return 'last-owner';

    const rows = await tx`
      update public.tenant_users set role = ${next}
      where user_id = ${userId}
      returning user_id
    `;

    return rows.length ? null : 'not-a-member';
  });
}

/**
 * Set a member's capabilities. Passing null clears the set back to unset, which
 * the resolver reads as the legacy full grant, so this is how staff hand full
 * access back. An empty array is a genuinely locked-down member and is kept.
 */
export async function setMemberPermissions(
  tenantId: string,
  userId: string,
  perms: PermissionSet | null,
): Promise<MemberRefusal> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      update public.tenant_users
      set permissions = ${perms === null ? null : json(tx, perms)}
      where user_id = ${userId}
      returning user_id
    `;
    return rows.length ? null : 'not-a-member';
  });
}

/** One member's stored capability set, for resolving what they may do. */
export async function memberPermissions(
  tenantId: string,
  userId: string,
): Promise<PermissionSet | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      select permissions from public.tenant_users where user_id = ${userId} limit 1
    `;
    return rows.length ? parsePermissions((rows[0] as Record<string, unknown>).permissions) : null;
  });
}

/** The site's default capabilities for a new member, or null when none is set. */
export async function siteDefaultPermissions(tenantId: string): Promise<PermissionSet | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`select default_permissions from public.tenants limit 1`;
    return rows.length
      ? parsePermissions((rows[0] as Record<string, unknown>).default_permissions)
      : null;
  });
}

/** Set (or clear, with null) the site's default capabilities for new members. */
export async function setSiteDefaultPermissions(
  tenantId: string,
  perms: PermissionSet | null,
): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    await tx`
      update public.tenants set default_permissions = ${perms === null ? null : json(tx, perms)}
    `;
  });
}

/** Take somebody out of the site. Refuses to remove the last owner. */
export async function removeMember(
  tenantId: string,
  userId: string,
): Promise<MemberRefusal> {
  return withTenant(tenantId, async (tx) => {
    const owners = await lockOwners(tx);
    if (owners.length === 1 && owners[0] === userId) return 'last-owner';

    const rows = await tx`
      delete from public.tenant_users where user_id = ${userId} returning user_id
    `;

    return rows.length ? null : 'not-a-member';
  });
}

// ---------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------

/**
 * Issue an invite, replacing any live one for the same person.
 *
 * REPLACING RATHER THAN REFUSING. Inviting the same colleague twice is what
 * somebody does when the first link went astray, and the useful answer is a new
 * link that works rather than an error about one they cannot find. The old
 * token stops working the moment its hash is overwritten, which is the right
 * way round: a link that went astray is exactly the one to kill.
 *
 * The unique index is partial, on unaccepted rows only, so this never disturbs
 * the record of an invite somebody already used.
 */
export async function createInvite(
  tenantId: string,
  input: {
    email: string;
    role: MemberRole;
    tokenHash: string;
    createdBy?: string;
    permissions?: PermissionSet | null;
  },
): Promise<PendingInvite | null> {
  return withTenant(tenantId, async (tx) => {
    // Already in the site. Issuing a link that grants what they have would be a
    // link that does nothing, and the screen should say so instead.
    const already = await tx`
      select 1 from public.tenant_users tu
      join public.auth_users u on u.id = tu.user_id
      where u.email = ${input.email}
      limit 1
    `;
    if (already.length) return null;

    const perms = input.permissions == null ? null : json(tx, input.permissions);
    const rows = await tx`
      insert into public.site_invites (tenant_id, email, role, permissions, token_hash, created_by)
      values (
        ${tenantId}::uuid,
        ${input.email},
        ${input.role},
        ${perms},
        ${input.tokenHash},
        ${input.createdBy ?? null}::text
      )
      on conflict (tenant_id, email) where accepted_at is null
        do update set
          role        = excluded.role,
          permissions = excluded.permissions,
          token_hash  = excluded.token_hash,
          created_by  = excluded.created_by,
          created_at  = now(),
          expires_at  = now() + interval '14 days'
      returning id, email, role, permissions, created_at, expires_at
    `;

    const row = rows[0] as Record<string, unknown>;
    return {
      id: String(row.id),
      email: String(row.email),
      role: role(row.role),
      permissions: parsePermissions(row.permissions),
      createdAt: new Date(String(row.created_at)),
      expiresAt: new Date(String(row.expires_at)),
    };
  });
}

/** Cancel an invite that has not been used. */
export async function revokeInvite(tenantId: string, inviteId: string): Promise<boolean> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      delete from public.site_invites
      where id = ${inviteId}::uuid and accepted_at is null
      returning id
    `;
    return rows.length > 0;
  });
}

/** What an accept attempt did, so the screen can say the right sentence. */
export type AcceptOutcome =
  | { ok: true; tenantId: string; slug: string; siteName: string; role: MemberRole }
  | { ok: false; reason: 'gone' | 'wrong-person' };

/**
 * Redeem a link.
 *
 * TWO TRANSACTIONS, AND THE SPLIT IS FORCED. The first has no tenant, because
 * the person holding the link is not in one; it answers "which site does this
 * lead to" and nothing else. The second works inside the tenant that answer
 * named, under the ordinary policies, exactly as every other write does. The
 * tenant id crossing between them came from the database rather than from the
 * request, which is the rule the whole session layer rests on.
 *
 * THE INVITE IS CLAIMED BEFORE THE MEMBERSHIP IS GRANTED, and the claim is the
 * lock: the UPDATE names `accepted_at is null`, so of two requests racing on
 * one link exactly one matches a row. Doing it the other way round would grant
 * membership and then discover the invite was already spent. Same reasoning as
 * the AI meter taking its slot before the model is called.
 *
 * BOUND TO THE EMAIL IT WAS SENT TO. A link that lets whoever holds it edit a
 * client's live website is a link somebody forwards without thinking.
 */
export async function acceptInvite(
  tokenHash: string,
  user: { id: string; email: string },
): Promise<AcceptOutcome> {
  const invite = await inviteByToken(tokenHash);
  if (!invite) return { ok: false, reason: 'gone' };

  // Compared lower-cased on both sides. Both have been through normaliseEmail,
  // and comparing them any other way is how "Sam@" fails to match "sam@".
  if (invite.email !== user.email.trim().toLowerCase()) {
    return { ok: false, reason: 'wrong-person' };
  }

  return withTenant(invite.tenantId, async (tx) => {
    const claimed = await tx`
      update public.site_invites
      set accepted_at = now(), accepted_by = ${user.id}
      where id = ${invite.id}::uuid and accepted_at is null
      returning id, permissions
    `;

    // Somebody got there first, on another tab or another device.
    if (!claimed.length) return { ok: false, reason: 'gone' } as AcceptOutcome;

    // The capabilities the invite named, or the site default when it named none,
    // so "use as default for future clients" reaches somebody who joins by link.
    let perms = parsePermissions((claimed[0] as Record<string, unknown>).permissions);
    if (perms === null) {
      const def = await tx`select default_permissions from public.tenants limit 1`;
      perms = def.length
        ? parsePermissions((def[0] as Record<string, unknown>).default_permissions)
        : null;
    }

    /*
     * DO NOTHING on a conflict rather than updating the role. An invite is a way
     * in, not a way to change what somebody already has: if they are already an
     * editor here, a stale invite naming them a viewer must not quietly demote
     * them, and one naming them an owner must certainly not promote them.
     */
    await tx`
      insert into public.tenant_users (tenant_id, user_id, role, permissions)
      values (
        ${invite.tenantId}::uuid,
        ${user.id},
        ${invite.role},
        ${perms === null ? null : json(tx, perms)}
      )
      on conflict (tenant_id, user_id) do nothing
    `;

    const rows = await tx`select slug, name from public.tenants limit 1`;
    const row = (rows[0] ?? {}) as Record<string, unknown>;

    return {
      ok: true,
      tenantId: invite.tenantId,
      slug: String(row.slug ?? ''),
      siteName: String(row.name ?? 'your site'),
      role: invite.role,
    } as AcceptOutcome;
  });
}
