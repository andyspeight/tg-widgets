-- ---------------------------------------------------------------------------
-- 0032  A client can save a section as a reusable template
-- ---------------------------------------------------------------------------
--
-- WHY. The editor is a section composer, and a section a client has got right -
-- their villa hero, their "how we plan a trip" - is worth keeping to drop onto
-- the next page rather than rebuilding. This stores one saved section per row,
-- keyed to the tenant, and the editor offers them back in the "Add a section"
-- picker under the client's own library.
--
-- ONE SANITISED SECTION PER ROW, as jsonb. The content is a Section, the same
-- shape a page stores in its draft_content.sections array, and it is sanitised
-- on the way in exactly as a page save is, so a saved template can never carry
-- markup a stored page could not.
--
-- APP ONLY, NO RENDERER. A template is an editor convenience; it is never
-- rendered on a published page (the page stores its own copy of the section
-- once inserted). So, unlike pages or regions, the renderer role has no policy
-- and no grant here at all.

create table if not exists public.section_templates (
  id uuid primary key default gen_random_uuid(),

  tenant_id uuid not null references public.tenants(id) on delete cascade,

  -- The name shown in the picker. Free text, the client's own words.
  name text not null default '',

  -- The saved section, one Section as jsonb, sanitised before it is written.
  content jsonb not null,

  -- Who saved it, text and no foreign key, the same reasoning as ai_usage.user_id.
  created_by text,

  created_at timestamptz not null default now()
);

-- The only query: this tenant's templates, newest first.
create index if not exists section_templates_tenant_time
  on public.section_templates (tenant_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.section_templates enable row level security;
alter table public.section_templates force row level security;

create policy section_templates_app on public.section_templates
  for all to tg_sites_app
  using (tenant_id = public.current_tenant())
  with check (tenant_id = public.current_tenant());

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on public.section_templates from public, anon, authenticated;

grant select, insert, update, delete on public.section_templates to tg_sites_app;

-- No renderer grant on purpose: templates never reach a published page.
