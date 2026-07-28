-- ============================================================================
-- Tripbuster 015 — free access, and what the free activity was worth
-- ============================================================================
-- Early advertisers get in for nothing. That is a property of the ACCOUNT and
-- not of the rate card: an agency is free until a date, and then it is not.
--
-- Doing it with zero-pence rate overrides would have worked and would have been
-- worse. Three rows per agency, no expiry, and nothing anywhere that says "this
-- agency is on a free run until January" — only a rate that happens to be zero
-- and that somebody has to remember to delete.
--
-- ── THE PART THAT MATTERS COMMERCIALLY ──────────────────────────────────────
--
-- A free period that shows an agency "£0" teaches them the platform is worth
-- nothing. So every event now records TWO numbers:
--
--   list_pence     what the event was worth at their rate
--   charged_pence  what we actually charged, which is 0 while they are free
--
-- The dashboard can then say "142 enquiries this month, worth £186, free during
-- your launch period". That sentence is the whole argument for staying when
-- billing starts, and it cannot be reconstructed later if we did not keep the
-- number at the time.
--
-- list_pence is also filled in when an event is not billable for the ordinary
-- reasons — a bot, a repeat within the window, a call under the minimum. Same
-- principle: "this was worth £2 and we did not charge for it" is a fact worth
-- keeping, and it is the one an agency rings up about.
-- ============================================================================

begin;

-- ── 1. free until when ──────────────────────────────────────────────────────
-- Null means charge normally. A date means everything up to and including that
-- day is free, and the day after it is not — no switch to remember to flip, and
-- no way to leave an agency accidentally free forever.
alter table public.agents add column if not exists free_until date;

comment on column public.agents.free_until is
  'Inclusive last day of this agency free period. Null means charge normally.';

create index if not exists agents_free_until_idx on public.agents (free_until)
  where free_until is not null;

-- ── 2. what an event was worth, alongside what it cost ──────────────────────
alter table public.click_events add column if not exists list_pence integer not null default 0;
-- Recorded on the row rather than worked out later from the agency free_until,
-- because free periods get extended. An agency whose trial was lengthened in
-- March must not have February's charges retrospectively wiped, and an auditor
-- asking "why was this one free" deserves an answer from the row itself.
alter table public.click_events add column if not exists free_period boolean not null default false;

-- Existing rows were priced by the 014 backfill before any of this existed, so
-- what they were worth is exactly what they were charged.
update public.click_events set list_pence = charged_pence where list_pence = 0 and charged_pence > 0;

-- ── 3. the rate knows about the free period ─────────────────────────────────
-- Returns the LIST price either way, plus a flag. The caller decides what to
-- charge; this decides what it is worth and whether it is chargeable. Keeping
-- those two apart is what lets an event record both numbers.
create or replace function public.tb_resolve_rate(
  p_agent_id     uuid,
  p_holiday_type text,
  p_event_type   text
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_tier text;
  v_free date;
  v_is_free boolean;
  r      record;
begin
  select rate_tier, free_until into v_tier, v_free from agents where id = p_agent_id;
  if v_tier is null then v_tier := 'standard'; end if;

  -- Inclusive: an agency free until the 31st is free all day on the 31st.
  v_is_free := v_free is not null and current_date <= v_free;

  select rc.amount_pence,
         (case when rc.agent_id is not null then 2 else 0 end)
       + (case when rc.holiday_type is not null then 1 else 0 end) as specificity
    into r
    from rate_card rc
   where rc.event_type = p_event_type
     and rc.tier = v_tier
     and (rc.agent_id is null or rc.agent_id = p_agent_id)
     and (rc.holiday_type is null or rc.holiday_type = p_holiday_type)
   order by specificity desc
   limit 1;

  if not found then
    return jsonb_build_object('tier', v_tier, 'pence', 0, 'source', 'unrated',
                              'free', v_is_free, 'freeUntil', v_free);
  end if;

  return jsonb_build_object(
    'tier',  v_tier,
    -- Always the list price. Never zeroed here.
    'pence', r.amount_pence,
    'source', case r.specificity
                when 3 then 'client_product'
                when 2 then 'client'
                when 1 then 'product'
                else 'default'
              end,
    'free', v_is_free,
    'freeUntil', v_free
  );
end;
$$;

revoke all on function public.tb_resolve_rate from anon, authenticated;

commit;

-- ── verify it actually landed ───────────────────────────────────────────────
--   update agents set free_until = current_date + 30 where slug = 'jetaway-travel';
--   select tb_resolve_rate((select id from agents where slug='jetaway-travel'),
--                          'Package holiday', 'call');
--     -- pence 100, free true  → worth £1, charged £0
--   update agents set free_until = current_date - 1 where slug = 'jetaway-travel';
--     -- free false → charged again, with no other change needed
--   select count(*) from click_events where list_pence <> charged_pence;
