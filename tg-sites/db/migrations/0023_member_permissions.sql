-- ---------------------------------------------------------------------------
-- 0023  Member permissions
-- ---------------------------------------------------------------------------
--
-- Granular per-member capabilities, so a client can be limited to editing copy
-- and swapping photos (content only) without being able to restructure the
-- design (full restyle), and anything in between, set person by person. See
-- lib/auth/permissions.ts for the capability vocabulary and how a stored set
-- resolves.
--
-- WHY A JSONB ARRAY, NOT A WIDENED role CHECK. The role stays owner/editor/viewer
-- (0002); this is a second, finer dimension over the top of it. A set of granted
-- capability keys is stored as a JSON array on the member's row. JSON rather than
-- a column per capability, or a join table, because the set is small, read whole
-- every time, and WILL gain and lose a capability as the product grows; a column
-- or a table would be a migration each time, an array is not.
--
-- NULL MEANS UNSET, NOT EMPTY. A member whose row predates this feature has null
-- here, and the resolver reads that as "keep what an owner or editor could always
-- do", so nothing regresses. A new member is stamped with a real array at invite
-- time. An empty array [] is a genuinely locked-down member and is NOT null.
--
-- THE INVITE CARRIES IT, so the permissions chosen when somebody is invited are
-- the permissions they land with. The tenant keeps a default so "use as default
-- for future clients" has somewhere to live.
--
-- No RLS or grant change: the existing tenant_users / site_invites / tenants
-- policies are `for all` and the grants are table-wide, so a new column is
-- already covered. Safe to re-run.

alter table public.tenant_users
  add column if not exists permissions jsonb;

alter table public.site_invites
  add column if not exists permissions jsonb;

-- The site's default permissions for a new member, set by "use as default for
-- future clients" on the members screen.
alter table public.tenants
  add column if not exists default_permissions jsonb;
