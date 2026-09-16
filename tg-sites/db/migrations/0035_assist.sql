-- ---------------------------------------------------------------------------
-- 0035  Luna Assist: the ledger and the log
-- ---------------------------------------------------------------------------
-- The assistant panel (docs/tg-sites-copilot-review.md, 16 Sep 2026) talks to a
-- metered API on Travelgenix's account, on behalf of anybody with a login to any
-- site, staff and client alike. Two tables, both in the shape of 0015_ai_usage,
-- whose argument for a table over a map in memory applies unchanged: a limit
-- counted per serverless instance is a suggestion, a limit counted in Postgres
-- is a limit.
--
-- assist_usage is ONE ROW PER TURN, written before the model is called as the
-- intent to spend, with the tokens and the cost filled in afterwards. It carries
-- what 0015 did not need to: who asked (so a per-user limit can be counted), the
-- model, the cached tokens (prompt caching makes them most of the input) and the
-- cost in pence from the price table pinned in lib/assist/pricing.ts. The month's
-- spend is a sum over this table, which is how an allowance is enforced when
-- Andy sets one; unlimited to start (16 Sep 2026), so nothing here caps it yet.
--
-- assist_log is WHAT HAPPENED, one row per event: a question asked, a tool
-- called, an answer given, a refusal, a failure, and later a change set proposed,
-- applied or undone. Its detail column holds tool names, page ids, operation
-- summaries and counts. It holds NO PROMPTS, NO ANSWERS AND NO ENQUIRY CONTENT:
-- the log says an enquiry was read, never what it said. The same rule as 0015,
-- for the same reason: a table that copies every client's words, held for a
-- purpose a count satisfies, is a liability and not a feature.
--
-- Safe to re-run.

create table if not exists public.assist_usage (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- Text and no foreign key, exactly as ai_usage.user_id: whatever subject the
  -- active identity provider issued. Nullable so the history outlives a member.
  user_id text,
  -- plan or build. Text rather than an enum: a third mode is an application
  -- change, not a migration.
  mode text not null default 'plan',
  model text not null default '',
  -- Filled in after the answer. Null on a call that failed: "we paid for nothing".
  input_tokens integer,
  output_tokens integer,
  cache_read_tokens integer,
  cache_write_tokens integer,
  -- Pence with four decimals: a Haiku turn is a fraction of a penny and a month
  -- of them should still add up to the right number.
  cost_pence numeric(12, 4),
  created_at timestamptz not null default now()
);

create index if not exists assist_usage_tenant_time
  on public.assist_usage (tenant_id, created_at desc);

create index if not exists assist_usage_user_time
  on public.assist_usage (tenant_id, user_id, created_at desc);

alter table public.assist_usage enable row level security;
alter table public.assist_usage force row level security;

drop policy if exists assist_usage_app on public.assist_usage;
create policy assist_usage_app on public.assist_usage
  for all to tg_sites_app
  using (tenant_id = public.current_tenant())
  with check (tenant_id = public.current_tenant());

revoke all on public.assist_usage from public, anon, authenticated;
grant select, insert on public.assist_usage to tg_sites_app;

-- No delete, and update on the columns the answer fills in only. created_at is
-- what every limit is counted from, and a row that can move its own timestamp
-- is a limit that can reset itself. See 0015 for the longer version.
grant update (input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_pence)
  on public.assist_usage to tg_sites_app;

comment on table public.assist_usage is
  'One row per Luna Assist turn, written before the model is called so a failed '
  'call still counts. Tokens and cost in pence filled in after. No prompts, no answers.';

create table if not exists public.assist_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id text,
  -- The turn this event belongs to, when it belongs to one. Set null on delete
  -- rather than cascade: the log is the record and outlives the ledger row.
  usage_id uuid references public.assist_usage(id) on delete set null,
  -- No foreign key: a page can be deleted and the log should still say what was
  -- done to it.
  page_id uuid,
  mode text not null default 'plan',
  -- asked, tool, answered, question, refused, failed; later proposed, applied,
  -- undone. Text for the same reason as mode.
  kind text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists assist_log_tenant_time
  on public.assist_log (tenant_id, created_at desc);

alter table public.assist_log enable row level security;
alter table public.assist_log force row level security;

drop policy if exists assist_log_app on public.assist_log;
create policy assist_log_app on public.assist_log
  for all to tg_sites_app
  using (tenant_id = public.current_tenant())
  with check (tenant_id = public.current_tenant());

revoke all on public.assist_log from public, anon, authenticated;
-- Insert and read only. A log that can be edited afterwards is not a log.
grant select, insert on public.assist_log to tg_sites_app;

comment on table public.assist_log is
  'What Luna Assist did, one row per event: tool names, page ids, operation '
  'summaries and counts. Never prompts, answers or enquiry content.';
