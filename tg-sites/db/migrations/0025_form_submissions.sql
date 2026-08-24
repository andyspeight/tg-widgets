-- ---------------------------------------------------------------------------
-- 0025  Form submissions
-- ---------------------------------------------------------------------------
--
-- A visitor fills in a form on a published site and the answers land here for
-- the site's team to read. The first thing a public visitor has ever been able
-- to WRITE, which is why most of this file is about how narrow that door is.
--
-- THE RENDERER ROLE STAYS READ-ONLY. withPublicTenant exists so that a
-- compromised public site cannot write anything, and this table does not
-- weaken that: the renderer gets NO table privileges at all, not even insert.
-- The single write door is public.submit_form below, a SECURITY DEFINER
-- function the renderer may only EXECUTE. The function enforces the tenant
-- from current_tenant(), caps the payload, and applies a per-tenant rate cap
-- that would otherwise need a SELECT the renderer must not have. A bug in the
-- public site can therefore, at worst, file enquiries at a bounded rate; it
-- still cannot read one back, touch another table, or see another tenant.
--
-- WHAT IS DELIBERATELY NOT STORED: the visitor's IP address. The rate cap is
-- per tenant, not per visitor, precisely so nothing identifying has to be
-- kept. The meta column carries the page path and a truncated user agent,
-- which is enough to answer "which form and roughly what device".
--
-- NO DELETE for the app role, the same call site_comments makes: an enquiry
-- from a customer should not quietly vanish. Reading and marking read are
-- updates; a later slice may add deliberate deletion.
--
-- Safe to re-run.

create table if not exists public.form_submissions (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  -- The page the form sat on. Kept even if the page is later deleted: the
  -- enquiry is about the business, not the page.
  page_id       uuid references public.pages(id) on delete set null,
  -- The form block's stable id, so a page with two forms keeps them apart.
  form_block_id text not null check (length(form_block_id) <= 64),
  -- The form's human name at submit time ("Enquiry", "Charter"), denormalised
  -- because the block can be renamed or deleted after the fact.
  form_name     text not null default '' check (length(form_name) <= 120),
  -- The answers, label -> value, exactly as validated by the submit function.
  data          jsonb not null check (pg_column_size(data) <= 16384),
  -- Page path and truncated user agent. Never an IP.
  meta          jsonb not null default '{}'::jsonb check (pg_column_size(meta) <= 2048),
  -- When somebody on the team opened it, or null while it is new.
  read_at       timestamptz,
  created_at    timestamptz not null default now()
);

-- The list is always "this site, newest first".
create index if not exists form_submissions_recent
  on public.form_submissions (tenant_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.form_submissions enable row level security;
alter table public.form_submissions force row level security;

drop policy if exists form_submissions_app on public.form_submissions;
create policy form_submissions_app on public.form_submissions
  for all to tg_sites_app
  using (tenant_id = public.current_tenant())
  with check (tenant_id = public.current_tenant());

-- Read, insert and mark-read. Deliberately no DELETE grant: see the header.
grant select, insert, update on public.form_submissions to tg_sites_app;

-- ---------------------------------------------------------------------------
-- The one write door for the public site
-- ---------------------------------------------------------------------------

create or replace function public.submit_form(
  p_page_id    uuid,
  p_block_id   text,
  p_form_name  text,
  p_data       jsonb,
  p_meta       jsonb
) returns boolean
language plpgsql
security definer
-- Definer functions must pin their search path or a hostile schema shadows
-- every unqualified name in the body.
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid;
  v_recent integer;
begin
  -- The tenant comes from the transaction's setting, exactly as RLS reads it.
  -- No tenant set means no write, whoever is calling.
  v_tenant := public.current_tenant();
  if v_tenant is null then
    return false;
  end if;

  -- Shape caps, enforced here as well as by the table's checks so the caller
  -- gets a calm false rather than an exception to swallow.
  if p_block_id is null or length(p_block_id) = 0 or length(p_block_id) > 64 then
    return false;
  end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object'
     or pg_column_size(p_data) > 16384 then
    return false;
  end if;

  -- The rate cap the renderer could not otherwise have: at most 20 stored
  -- submissions per tenant per 10 minutes. Definer rights do the counting so
  -- the renderer role itself still cannot SELECT a thing. Per tenant rather
  -- than per visitor so no IP ever needs storing; a real site drowning in
  -- spam gets a calmer cap, not a leak.
  select count(*) into v_recent
    from public.form_submissions
   where tenant_id = v_tenant
     and created_at > now() - interval '10 minutes';
  if v_recent >= 20 then
    return false;
  end if;

  insert into public.form_submissions
    (tenant_id, page_id, form_block_id, form_name, data, meta)
  values
    (v_tenant, p_page_id, left(coalesce(p_block_id, ''), 64),
     left(coalesce(p_form_name, ''), 120), p_data,
     coalesce(p_meta, '{}'::jsonb));
  return true;
end;
$$;

-- Execute only. The renderer role holds no privilege on the table itself.
revoke all on function public.submit_form(uuid, text, text, jsonb, jsonb) from public;
grant execute on function public.submit_form(uuid, text, text, jsonb, jsonb)
  to tg_sites_renderer, tg_sites_app;
