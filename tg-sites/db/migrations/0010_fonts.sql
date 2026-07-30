-- A per-tenant font library, with the font files themselves.
--
-- WHY THE BYTES ARE IN POSTGRES AND NOT IN OBJECT STORAGE
--
-- This is the decision in this migration and it is worth being explicit about,
-- because putting binaries in the primary database is normally wrong.
--
-- Supabase Storage would be the conventional home. Reaching it from the server
-- means the Supabase HTTP API and a service_role key, and that key is exactly
-- the thing lib/db/client.ts refuses to let near this database, because it
-- bypasses row level security. Adding it to the environment to hold some font
-- files would put a credential with that much reach into the deployment for a
-- feature that does not need it.
--
-- The sizes make the choice easy. A Google family at four weights and two Latin
-- subsets is about 230KB, and a site uses one or two families. So a tenant costs
-- well under a megabyte, and the whole thing stays inside the isolation model
-- that db/isolation-check.sql already proves, with no new subsystem, no new
-- secret and no signed URLs.
--
-- THE THRESHOLD FOR CHANGING THIS: images. The media library is next and images
-- are bigger and far more numerous, so that is the feature that should bring
-- Storage in. When it does, fonts can move too, and the only thing that changes
-- is the body of the route that serves them.
--
-- WHY TWO TABLES
--
-- A family is one thing a person chose. A file is one weight of one subset of
-- it, and there are eight of those per family. Keeping them apart means the
-- theme references a family, deleting a family takes its files with it, and the
-- route that serves a file does not read a row with eight blobs in it to answer
-- for one.

-- ---------------------------------------------------------------------------
-- Families
-- ---------------------------------------------------------------------------

create table if not exists public.fonts (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,

  -- The CSS font-family name, spelled the way the foundry spells it. For a
  -- Google import this is Google's own spelling rather than what was typed.
  family     text not null check (length(family) between 1 and 60),

  -- The url-safe id. What the theme stores and what appears in a font URL, so
  -- renaming a family would be a new row rather than an edit.
  slug       text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),

  -- Where it came from. Shown in the UI, because "you uploaded this" and
  -- "this came from Google" have different licensing consequences and the
  -- person who picked it is not always the person looking at it later.
  source     text not null check (source in ('google', 'upload')),

  /*
   * What to fall back to if the font file never arrives.
   *
   * Set at import time from the catalogue, because that is the only moment the
   * classification is to hand. It matters more than it sounds: a serif brand
   * font falling back to the system SANS reflows the whole page and looks like a
   * different site for the second before the woff2 lands. Stored rather than
   * derived so the theme editor can resolve a stack in the browser without
   * shipping the 1941-entry catalogue to it.
   */
  fallback   text not null default 'sans'
             check (fallback in ('sans', 'serif', 'slab', 'script', 'mono', 'display')),

  created_at timestamptz not null default now(),

  -- One family per name per tenant. Re-importing replaces rather than
  -- duplicating, which is what the ON CONFLICT in lib/db/fonts.ts relies on.
  unique (tenant_id, slug)
);

create index if not exists fonts_tenant_idx on public.fonts (tenant_id);

-- ---------------------------------------------------------------------------
-- Files
-- ---------------------------------------------------------------------------

create table if not exists public.font_files (
  id            uuid primary key default gen_random_uuid(),

  -- Denormalised from fonts, deliberately. Every policy in this schema is
  -- `tenant_id = current_tenant()`, and keeping that true here means this table
  -- needs no join to be scoped, so a policy on it can be read on its own.
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  font_id       uuid not null references public.fonts(id) on delete cascade,

  weight        int  not null check (weight between 100 and 900),
  style         text not null default 'normal' check (style in ('normal', 'italic')),
  format        text not null check (format in ('woff2', 'woff', 'truetype', 'opentype')),

  -- Which Latin subset, for a Google import. Null for an upload, where the file
  -- covers whatever it covers and there is nothing to split on.
  subset        text check (subset is null or subset in ('latin', 'latin-ext')),

  -- The unicode-range from Google's stylesheet, so a browser fetches only the
  -- file it needs for the characters on the page. Null means "no restriction".
  unicode_range text,

  -- The font itself. See the note at the top of this file.
  bytes         bytea not null,

  -- Kept alongside rather than computed, so a listing can show what a family
  -- costs without reading a single blob.
  byte_size     int   not null check (byte_size > 0 and byte_size <= 1500000),

  created_at    timestamptz not null default now(),

  unique (font_id, weight, style, subset)
);

create index if not exists font_files_font_idx   on public.font_files (font_id);
create index if not exists font_files_tenant_idx on public.font_files (tenant_id);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.fonts       enable row level security;
alter table public.fonts       force  row level security;
alter table public.font_files  enable row level security;
alter table public.font_files  force  row level security;

-- The editor: its own tenant, read and write.
create policy fonts_app on public.fonts
  for all to tg_sites_app
  using (tenant_id = public.current_tenant())
  with check (tenant_id = public.current_tenant());

create policy font_files_app on public.font_files
  for all to tg_sites_app
  using (tenant_id = public.current_tenant())
  with check (tenant_id = public.current_tenant());

/*
 * The public renderer: read only, and it genuinely needs to read.
 *
 * Unlike a draft page, a font file IS public. It is served to every visitor by
 * a route that has no session, so the read-only role has to be able to see it.
 * What that role still cannot do is write one, see another tenant's, or reach
 * the draft content or the publish log, which is the whole point of it being a
 * separate role.
 */
create policy fonts_renderer on public.fonts
  for select to tg_sites_renderer
  using (tenant_id = public.current_tenant());

create policy font_files_renderer on public.font_files
  for select to tg_sites_renderer
  using (tenant_id = public.current_tenant());

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on public.fonts      from public, anon, authenticated;
revoke all on public.font_files from public, anon, authenticated;

grant select, insert, update, delete on public.fonts      to tg_sites_app;
grant select, insert, update, delete on public.font_files to tg_sites_app;
grant select                         on public.fonts      to tg_sites_renderer;
grant select                         on public.font_files to tg_sites_renderer;
