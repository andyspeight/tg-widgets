-- ============================================================================
-- Tripbuster 004 — agent sign-in
-- ============================================================================
-- Tripbuster has its own login, separate from the Travelgenix client dashboard,
-- because it is a separate product. Passwords are bcrypt hashes written by the
-- API; the hash is never returned in any response.
-- ============================================================================

alter table public.agents
  add column if not exists password_hash text,
  add column if not exists last_login_at timestamptz;

comment on column public.agents.password_hash is
  'bcrypt hash. Never returned by any API response.';

-- Counts an agent's deals by status. Backs two things: the per-plan live-deal
-- limit enforced in the API, and the dashboard overview tiles. A function rather
-- than a client-side count so the limit check is one round trip instead of
-- fetching every row to count them.
create or replace function public.tb_agent_deal_counts(p_agent_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'live',    count(*) filter (where status = 'live'),
    'draft',   count(*) filter (where status = 'draft'),
    'paused',  count(*) filter (where status = 'paused'),
    'expired', count(*) filter (where status = 'expired'),
    'total',   count(*)
  )
  from deals
  where agent_id = p_agent_id;
$$;

revoke all on function public.tb_agent_deal_counts from anon, authenticated;
