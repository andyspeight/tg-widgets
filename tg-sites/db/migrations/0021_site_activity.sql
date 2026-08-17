-- ---------------------------------------------------------------------------
-- 0021  The activity log
-- ---------------------------------------------------------------------------
--
-- A record of what happened to a site and who did it: a page created, renamed,
-- deleted or published, and in later slices a header published, a member
-- invited, the settings changed. An agency running sites for many clients, and
-- a client and an agency sharing one site, both need to see the history without
-- asking each other.
--
-- WHY THIS IS NOT publish_events
--
-- publish_events (0014) keeps the published BYTES of each page so a publish can
-- be rolled back. It answers "what was live then". This answers a different
-- question, "who did what, when", in one human-readable line and no content, so
-- it can hold every kind of event and not just a publish. A publish is written
-- to both: the snapshot for restore, the line for the timeline.
--
-- WHY IT IS APPEND-ONLY
--
-- A log you can edit is not a log. The app role is granted select and insert and
-- nothing else, so a row cannot be changed or removed once written. Tenant
-- deletion still clears it, through the on delete cascade, because a log is
-- about a site and has no meaning once the site is gone.
--
-- WHY THE RENDERER IS NOT GRANTED IT AT ALL
--
-- The public website never shows history, and a compromised renderer reading
-- who-did-what across a tenant is a leak with no upside. Unlike site_regions,
-- which the renderer needs for its published columns, this table has nothing the
-- public side should ever see, so it gets no grant and no policy for that role.
--
-- Safe to re-run.

create table if not exists public.site_activity (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  -- The user who did it, as a text id the same as updated_by elsewhere. Null for
  -- a system or automated event that no person triggered.
  actor_id   text,
  -- A stable machine tag, e.g. 'page.publish'. The screen groups and icons off
  -- this; the summary is for reading.
  action     text not null,
  -- One human line, built server-side from trusted data (a page title, itself
  -- sanitised on save) and shown escaped. Never free client input.
  summary    text not null,
  created_at timestamptz not null default now()
);

-- The list is always "this tenant, newest first", so index exactly that.
create index if not exists site_activity_recent
  on public.site_activity (tenant_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.site_activity enable row level security;
alter table public.site_activity force row level security;

create policy site_activity_app on public.site_activity
  for all to tg_sites_app
  using (tenant_id = public.current_tenant())
  with check (tenant_id = public.current_tenant());

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on public.site_activity from public, anon, authenticated;

-- Select and insert only. No update or delete: the log is append-only, and the
-- cascade above is the one thing that clears it. The renderer gets nothing.
grant select, insert on public.site_activity to tg_sites_app;
