-- ---------------------------------------------------------------------------
-- 0022  Comments
-- ---------------------------------------------------------------------------
--
-- A client leaves a comment on a page of their site for the Travelgenix team,
-- who read it, reply, and mark it resolved. A review conversation that lives on
-- the site being built rather than scattered across email.
--
-- WHY THIS IS NOT SHAPED LIKE site_activity (0021)
--
-- The activity log is append-only: a line, once written, never changes. A
-- comment thread is the opposite. It grows a reply after it is written, and it
-- is resolved and reopened, so the app role has UPDATE as well as SELECT and
-- INSERT. It still has no DELETE: a later slice may add one deliberately, but a
-- review record should not quietly vanish, and resolve already covers "done".
--
-- IT IS FREE CLIENT INPUT, unlike an activity summary, which is built server-side
-- from a sanitised title. The body is what a person typed. It is stored raw and
-- escaped on render; it never goes through innerHTML. The database's only job is
-- to scope it to the tenant and cap its length.
--
-- THE RENDERER IS NOT GRANTED IT. A published page never shows comments, so the
-- read-only role gets no grant and no policy: there is nothing here the public
-- side should ever see, the same call site_activity makes.
--
-- Safe to re-run.

create table if not exists public.site_comments (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  -- The page the comment is on. A deleted page takes its comments with it.
  page_id     uuid not null references public.pages(id) on delete cascade,
  -- The thread root a reply belongs to, or null for a root comment itself. One
  -- level only: a reply always points at a root, which the query layer enforces.
  parent_id   uuid references public.site_comments(id) on delete cascade,
  -- Who wrote it, a text id the same as updated_by and actor_id elsewhere. Every
  -- comment has an author, so not null.
  author_id   text not null,
  -- What they typed. Free input: stored raw, escaped on render, never innerHTML.
  -- Capped so a runaway paste cannot fill the table.
  body        text not null check (length(body) <= 4000),
  -- Which element the comment is pinned to, a stable block id, or null for a
  -- page-level comment. The column exists now so the pinning slice needs no
  -- migration; nothing writes a non-null value until then.
  anchor      text,
  -- When the thread was resolved and by whom, or null while it is open. Resolve
  -- and reopen are the only updates this table takes.
  resolved_at timestamptz,
  resolved_by text,
  created_at  timestamptz not null default now()
);

-- The list is always "this page, oldest first" (a thread reads top to bottom),
-- so index the page lookup within the tenant.
create index if not exists site_comments_page
  on public.site_comments (tenant_id, page_id, created_at);

-- Gathering a thread's replies by its root.
create index if not exists site_comments_thread
  on public.site_comments (parent_id);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.site_comments enable row level security;
alter table public.site_comments force row level security;

create policy site_comments_app on public.site_comments
  for all to tg_sites_app
  using (tenant_id = public.current_tenant())
  with check (tenant_id = public.current_tenant());

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on public.site_comments from public, anon, authenticated;

-- Select, insert and update: a comment is written, replied to, resolved and
-- reopened. No delete, and the renderer gets nothing. See the header.
grant select, insert, update on public.site_comments to tg_sites_app;
