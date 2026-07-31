-- ---------------------------------------------------------------------------
-- 0015  A spend limit that survives a cold start
-- ---------------------------------------------------------------------------
--
-- WHY THIS IS A TABLE AND NOT A MAP IN MEMORY
--
-- The writing assistant calls a metered API on Travelgenix's account. Every
-- request costs Andy money, and the people who can make one are everybody with a
-- login to any site on the platform. That is the whole risk in one sentence: a
-- feature where somebody else's mistake or malice appears on our bill.
--
-- The obvious limiter is a Map keyed by tenant, and on Vercel it is close to
-- decorative. Each serverless instance gets its own module scope, instances are
-- created and destroyed under load, and a burst of traffic is exactly when the
-- platform makes more of them. So a "twenty an hour" limit in memory is twenty
-- an hour PER INSTANCE, and the number of instances is chosen by the load the
-- limit is supposed to be protecting against. It reads like a control and
-- behaves like a suggestion.
--
-- One row per call in Postgres is shared by every instance, and counting rows in
-- a window is one indexed query. That is the cost of making the number true.
--
-- WHAT IS COUNTED, AND WHAT IS NOT
--
-- A row per REQUEST, written before the call to Anthropic rather than after.
-- Written after, a request that times out or errors costs money and leaves no
-- trace, which is the wrong way round: a failing model call is exactly the thing
-- somebody would hammer. So the row is the intent to spend, and the token counts
-- are filled in afterwards when there is an answer to fill them in with.
--
-- No prompts and no answers. Storing them would make this table a copy of every
-- client's marketing copy plus whatever they typed into a box, held for a
-- purpose that is satisfied by a count. If a debugging need for that ever
-- appears, it is a different table with a retention rule, not more columns here.
--
-- Safe to re-run.

create table if not exists public.ai_usage (
  id uuid primary key default gen_random_uuid(),

  -- The tenant carrying the cost. The whole point of the row.
  tenant_id uuid not null references public.tenants(id) on delete cascade,

  -- Who asked, so a runaway can be traced to a person rather than a company.
  --
  -- TEXT AND NO FOREIGN KEY, the same as tenant_users.user_id and
  -- publish_events.user_id, and for the reason 0008 gives: this column holds
  -- whatever subject the active identity provider issues, and Travelify issues
  -- its own. A key into auth_users would be right today and wrong the moment
  -- somebody signs in through Travelify.
  --
  -- Nullable as well. The usage history of a site outlives any one member of it,
  -- and losing the count because somebody left would be the wrong trade.
  user_id text,

  -- write, title, improve, shorter, longer. Text rather than an enum, because a
  -- sixth intent should be an application change and not a migration.
  intent text not null default '',

  -- Filled in after the answer arrives, so both are null on a call that failed.
  -- That is useful rather than untidy: null means "we paid for nothing".
  input_tokens integer,
  output_tokens integer,

  created_at timestamptz not null default now()
);

-- The only query this table has: how many rows for this tenant since a moment.
-- Tenant first because it is the equality, time second because it is the range.
create index if not exists ai_usage_tenant_time
  on public.ai_usage (tenant_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
--
-- Same shape as every other table here, with one difference worth naming: there
-- is NO renderer policy. A published page is rendered from its content, and the
-- renderer role has no business knowing how many times anybody asked for help
-- writing it. A role with no policy sees no rows.

alter table public.ai_usage enable row level security;
alter table public.ai_usage force row level security;

create policy ai_usage_app on public.ai_usage
  for all to tg_sites_app
  using (tenant_id = public.current_tenant())
  with check (tenant_id = public.current_tenant());

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on public.ai_usage from public, anon, authenticated;

grant select, insert on public.ai_usage to tg_sites_app;

/*
 * NO DELETE, AND UPDATE ON TWO COLUMNS ONLY.
 *
 * A limit whose rows can be removed by the thing being limited is not a limit,
 * so there is no delete grant. Old rows are a housekeeping job for whoever holds
 * the admin connection.
 *
 * The update grant is narrowed for the same reason one step further along, and
 * this is the part worth reading twice. recordTokens needs to write the two token
 * counts after an answer arrives, and a table-wide UPDATE would come with
 * created_at, which is the column the whole limit is counted from. One statement
 * setting every created_at back two days would empty the window and reset the
 * allowance. Naming the columns costs nothing and closes it.
 *
 * Same reasoning as publish_events further up the schema, which has no UPDATE
 * grant at all because a snapshot that can be edited afterwards is not a
 * snapshot.
 */
grant update (input_tokens, output_tokens) on public.ai_usage to tg_sites_app;

comment on table public.ai_usage is
  'One row per writing-assistant request, written before the model is called so a '
  'failed call still counts against the limit. Holds no prompts and no answers.';
