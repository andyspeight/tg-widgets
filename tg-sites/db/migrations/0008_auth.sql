-- Sign in, and the policies that let a person find their own sites.
--
-- THE PROBLEM THIS SOLVES
--
-- Every policy so far keys off current_tenant(). That is right for reading a
-- tenant's data and useless for the question a session has to answer first:
-- "which tenants does this person belong to". You cannot scope that by tenant,
-- because the tenant is the answer.
--
-- The stand-in until now was a workspace slug in a cookie, resolved through
-- resolve_tenant. That let anyone with the link type any slug, which is why
-- the editor has been carrying a banner admitting it.
--
-- The fix is a SECOND transaction-local setting for the user, and policies on
-- tenant_users and tenants keyed on the user rather than on the tenant. No new
-- privileged function, and nothing gains BYPASSRLS: the isolation suite still
-- asserts that resolve_tenant is the only thing in this database that can see
-- past row level security.
--
-- DO NOT MERGE THESE POLICIES INTO THE ONES THEY SIT BESIDE
--
-- This migration leaves three tables with two permissive SELECT policies each,
-- and Supabase's performance linter will tell you to combine them: every query
-- now evaluates both. That advice is right in general and wrong here.
--
-- Each new policy is deliberately FOR SELECT, while the one beside it is FOR
-- ALL. Folding the wider condition into the FOR ALL policy would hand its
-- WITH CHECK the same reach, which means a signed-in person could write their
-- own membership row, which means joining any site by asking. The isolation
-- suite has a check named exactly that. The second policy is SELECT-only
-- because reading a thing and writing it are different permissions, and
-- keeping them in separate policies is what makes that visible.
--
-- The cost is one extra policy evaluation on tables holding one row per person
-- per site. The saving is a security property. Leave it.

-- ---------------------------------------------------------------------------
-- The user of the current transaction
-- ---------------------------------------------------------------------------

-- Named current_user_id, not current_user, which is a Postgres built-in
-- meaning the database role. Two different questions.
create or replace function public.current_user_id()
returns text
language sql
stable
set search_path = ''
as $$
  select nullif(current_setting('app.current_user_id', true), '')
$$;

comment on function public.current_user_id() is
  'The signed-in person for this transaction, or NULL. Set by withUser/withTenant.';

grant execute on function public.current_user_id() to tg_sites_app, tg_sites_renderer;

-- ---------------------------------------------------------------------------
-- Credentials
-- ---------------------------------------------------------------------------

-- NOT the canonical user store. id.travelify.io owns identity, and
-- tenant_users.user_id holds whatever subject the active provider issues.
--
-- This table exists because that integration needs endpoint details nobody has
-- handed over yet, and an auth layer that cannot actually sign anyone in is
-- not an auth layer. It gives the password provider somewhere to keep a hash
-- so the whole path works today. When Travelify SSO lands, this stops being
-- read and can be dropped without touching anything else.
create table if not exists public.auth_users (
  -- The subject. Deliberately text and deliberately not a uuid default: when
  -- Travelify issues the subject, its ids go here unchanged.
  id            text primary key,
  email         text not null unique check (position('@' in email) > 1),
  -- scrypt, salted, from node:crypto. Format and cost live in lib/auth.
  password_hash text,
  name          text,
  status        text not null default 'active'
                check (status in ('active', 'suspended')),
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz
);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.auth_users enable row level security;
alter table public.auth_users force row level security;

-- A person can see their own row and nobody else's. Sign-in does not come
-- through this policy; it cannot, because it runs before there is a user to
-- compare against. See the login policy further down.
create policy auth_users_self on public.auth_users
  for all to tg_sites_app
  using (id = public.current_user_id())
  with check (id = public.current_user_id());

-- ---------------------------------------------------------------------------
-- Which tenants am I in
-- ---------------------------------------------------------------------------

-- A SECOND policy on tenant_users, keyed on the user instead of the tenant.
--
-- Postgres ORs policies of the same command together, so this widens what
-- tg_sites_app can see rather than replacing tenant_users_app. Both are
-- narrow: one needs a tenant set, the other needs a user set, and with
-- neither set both return nothing.
create policy tenant_users_own_memberships on public.tenant_users
  for select to tg_sites_app
  using (user_id = public.current_user_id());

-- And the tenants those memberships point at, so the site picker is an
-- ordinary join rather than a privileged read.
create policy tenants_mine on public.tenants
  for select to tg_sites_app
  using (
    status = 'active'
    and exists (
      select 1 from public.tenant_users tu
      where tu.tenant_id = public.tenants.id
        and tu.user_id = public.current_user_id()
    )
  );

-- ---------------------------------------------------------------------------
-- Signing in
-- ---------------------------------------------------------------------------

-- Sign-in is the same chicken and egg as hostname resolution: it has to read a
-- row to work out who you are, before there is a "who you are" to key a policy
-- on.
--
-- The obvious answer is another SECURITY DEFINER function, and that answer is
-- wrong. The isolation suite asserts that exactly ONE function in this
-- database can see past row level security, and a second one costs more than
-- it saves: privileged code is the thing you cannot review by reading a policy.
--
-- Instead there is a THIRD transaction-local setting holding the email being
-- checked, and a policy that reveals exactly the row matching it. Nothing
-- privileged, and the row it exposes is one the caller already named.
--
-- It cannot enumerate. One email in, at most one row out, and the application
-- gives the same answer either way, so a wrong email is indistinguishable from
-- a right one with a wrong password.
create or replace function public.login_email()
returns text
language sql
stable
set search_path = ''
as $$
  select nullif(current_setting('app.login_email', true), '')
$$;

comment on function public.login_email() is
  'The email being verified in this transaction, or NULL. Set by withLogin.';

grant execute on function public.login_email() to tg_sites_app;

create policy auth_users_login on public.auth_users
  for select to tg_sites_app
  using (email = public.login_email());

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on public.auth_users from public, anon, authenticated;
grant select, insert, update on public.auth_users to tg_sites_app;
