-- ---------------------------------------------------------------------------
-- 0019  Invites, so a site can have more than one person in it
-- ---------------------------------------------------------------------------
--
-- WHAT WAS WRONG. tenant_users has held owner, editor and viewer since 0002 and
-- the policies have enforced them since 0008, and nothing in the application
-- has ever written a row. The only way to add somebody was db/make-user.mjs,
-- which prints SQL for a human to paste. So every site on this platform has
-- exactly one user, and an agency with three staff cannot use it.
--
-- AN INVITE IS NOT SELF-SERVICE SIGN-UP, though it creates accounts. The note at
-- the top of db/make-user.mjs says this product should not have sign-up, and it
-- still should not: an account exists here because somebody who already owns a
-- site decided it should. That is what an invite is. There is no reachable
-- endpoint that creates an account without one.
--
-- THE TOKEN IS STORED AS A HASH AND NEVER AS ITSELF. The row is worth as much
-- as a password row: whoever holds the token can join a site and edit a live
-- travel business's website. A database copy, a backup on a laptop or a log
-- line must not yield a working link, which is the same reason
-- auth_users.password_hash is a hash.
--
-- IT IS BOUND TO AN EMAIL. A link that lets whoever holds it into a client's
-- website is a link somebody forwards without thinking. Naming the person means
-- a forwarded one is refused, and it means the members screen can say who is
-- still outstanding.
--
-- Safe to re-run.

create table if not exists public.site_invites (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,

  -- Who it is for. Lower-cased by lib/auth/email.ts before it gets here, so the
  -- uniqueness below is on the value as stored.
  email       text not null check (position('@' in email) > 1),

  role        text not null default 'editor' check (role in ('owner', 'editor', 'viewer')),

  -- SHA-256 of the token in the link. See the note above about why.
  token_hash  text not null unique,

  -- The subject who issued it, and the one who used it. Text, matching
  -- tenant_users.user_id: the identity provider owns users, this database only
  -- records who may edit what.
  created_by  text,
  accepted_by text,

  created_at  timestamptz not null default now(),
  -- A link that works forever is a credential nobody remembers issuing.
  expires_at  timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz
);

-- ONE LIVE INVITE PER PERSON PER SITE. Inviting the same colleague twice should
-- replace the first link rather than leave two working ones, and a partial
-- index is what makes that the database's rule rather than the application's.
-- Accepted rows are excluded so the history survives.
create unique index if not exists site_invites_live
  on public.site_invites (tenant_id, email)
  where accepted_at is null;

create index if not exists site_invites_tenant
  on public.site_invites (tenant_id);

-- ---------------------------------------------------------------------------
-- Reading an invite before anybody knows which site it is for
-- ---------------------------------------------------------------------------
--
-- THE CHICKEN AND EGG, AND IT HAS BEEN SOLVED HERE TWICE ALREADY. Every read in
-- this database is scoped to a tenant, and the whole point of an invite is that
-- the person holding it is not in that tenant yet and cannot name it. The token
-- is the only thing they have.
--
-- The obvious answer is a second SECURITY DEFINER function, and it is wrong for
-- exactly the reason 0008 gives about sign-in: the isolation suite asserts that
-- ONE function in this database sees past row level security, and privileged
-- code is the thing you cannot review by reading a policy.
--
-- So this is the same shape as login_email(): a transaction-local setting
-- holding the token hash being looked up, and a policy revealing precisely the
-- row that matches it. Nothing privileged, and the row it exposes is one the
-- caller already named. It cannot enumerate: one hash in, at most one row out.
create or replace function public.invite_hash()
returns text
language sql
stable
set search_path = ''
as $$
  select nullif(current_setting('app.invite_token_hash', true), '')
$$;

comment on function public.invite_hash() is
  'The invite token hash being redeemed in this transaction, or NULL. '
  'Set by withInvite in lib/db/members.ts.';

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.site_invites enable row level security;
alter table public.site_invites force row level security;

drop policy if exists site_invites_app on public.site_invites;
drop policy if exists site_invites_by_token on public.site_invites;

-- Tenant-scoped, like everything else: this is how an owner lists, issues and
-- revokes the invites on their own site.
create policy site_invites_app on public.site_invites
  for all to tg_sites_app
  using (tenant_id = public.current_tenant())
  with check (tenant_id = public.current_tenant());

-- And the one row somebody redeeming a link already named. SELECT only: joining
-- is a write to tenant_users, which happens afterwards inside the tenant the
-- invite pointed at, under the ordinary policies.
create policy site_invites_by_token on public.site_invites
  for select to tg_sites_app
  using (token_hash = public.invite_hash());

-- ---------------------------------------------------------------------------
-- Seeing who else is in your site
-- ---------------------------------------------------------------------------
--
-- auth_users_self limits the app role to its own row, which is right everywhere
-- until there is a members screen: a list of who can edit this site with no
-- names or email addresses on it is not a list.
--
-- A THIRD POLICY, keyed on the tenant, ORed with the other two exactly as
-- tenant_users_own_memberships is. It reveals the row of somebody who is in the
-- site currently open, and nothing else. With no tenant set, current_tenant()
-- is NULL, the EXISTS finds nothing and this policy contributes nothing, so
-- every other path through auth_users is unchanged.
--
-- WHAT IT DOES NOT NARROW, said plainly rather than left to be discovered: the
-- grant on auth_users is table-wide, so within this policy's rows a query that
-- asked for password_hash would get it. That was already true of
-- auth_users_login, which is how sign-in reads a hash at all, and Postgres has
-- no way to attach a column list to a policy. What matters is that this cannot
-- reach OUTSIDE the tenant, and the isolation suite checks precisely that.
drop policy if exists auth_users_teammates on public.auth_users;

create policy auth_users_teammates on public.auth_users
  for select to tg_sites_app
  using (
    exists (
      select 1 from public.tenant_users tu
      where tu.user_id = public.auth_users.id
        and tu.tenant_id = public.current_tenant()
    )
  );

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on public.site_invites from public, anon, authenticated;
revoke all on function public.invite_hash() from public, anon, authenticated;

grant select, insert, update, delete on public.site_invites to tg_sites_app;

-- The app role only. A visitor's request has no business reading an invite, and
-- the renderer is what a visitor's request runs as.
grant execute on function public.invite_hash() to tg_sites_app;
