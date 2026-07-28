-- ============================================================================
-- Tripbuster 013 — agents can sign themselves up, and hear when someone asks
-- ============================================================================
-- TWO THINGS, ONE MIGRATION, BECAUSE THEY SHARE THE SAME PLUMBING: both need
-- Tripbuster to send an email, and neither existed.
--
-- 1. REGISTRATION. Every agency on the platform was created by hand, in SQL. A
--    self-serve advertising platform that needs a developer to add a customer is
--    not self-serve.
--
-- 2. ENQUIRY NOTIFICATIONS. A callback request has been landing in the database
--    and waiting for somebody to log in and find it. That is worst for exactly
--    the enquiries that matter most: out of hours, when the shop is shut, the
--    callback form IS the call to action, so the enquiries most likely to go
--    stale overnight are the ones we deliberately steer people towards.
--
-- ── THE APPROVAL QUESTION ───────────────────────────────────────────────────
--
-- A verified email address is proof of a mailbox, not of a travel agency. This
-- schema supports both answers and does not pick one:
--
--   verified_at   the agent proved they own the address
--   approved_at   a human at Tripbuster said yes
--
-- They are separate columns because they are separate facts, and status only
-- becomes 'active' when the configured policy is satisfied. The API decides
-- which policy is in force; the database records what actually happened, so
-- "who let this agency on, and when" has an answer either way.
--
-- ── WHY THESE ARE FUNCTIONS AND NOT PostgREST WRITES ────────────────────────
--
-- Registration has to check the email is free, mint a unique slug and insert the
-- row as one indivisible step, or two people signing up at once can produce two
-- agencies with the same slug. Notification claiming has the same shape for the
-- opposite reason: two concurrent sends must not both decide they are the one
-- sending the email.
-- ============================================================================

begin;

-- ── 1. what we know about a new agency ──────────────────────────────────────

-- The token itself is NEVER stored. Only its SHA-256, exactly as with a
-- password: our database is not a place a working sign-up link should exist.
alter table public.agents add column if not exists verify_token_hash text;
alter table public.agents add column if not exists verify_expires_at timestamptz;
alter table public.agents add column if not exists verified_at        timestamptz;
alter table public.agents add column if not exists approved_at        timestamptz;
-- Salted and truncated like every other IP in this schema. Kept so a burst of
-- sign-ups from one connection is visible after the fact.
alter table public.agents add column if not exists signup_ip_hash     text;

create unique index if not exists agents_verify_token_idx
  on public.agents (verify_token_hash) where verify_token_hash is not null;

-- ── 2. where an enquiry should land ─────────────────────────────────────────
-- notify_email is an OVERRIDE, not a copy. Null means "use the sign-in address",
-- so an agency that changes who logs in does not silently keep emailing the old
-- person. It exists because the person who signs in is often not the person who
-- rings customers back — a shared bookings@ inbox is the common case.
alter table public.agents add column if not exists notify_leads boolean not null default true;
alter table public.agents add column if not exists notify_email text;

-- ── 3. an enquiry is emailed once ───────────────────────────────────────────
-- Stamped on the row rather than inferred, because the alternative is a retry
-- after a timeout sending a second copy of an email that already arrived, and an
-- agency ringing the same person twice.
alter table public.leads add column if not exists notified_at timestamptz;

-- ── 4. a readable, unique handle for a new agency ───────────────────────────
-- Two agencies genuinely can be called Sunseeker Travel, so a name cannot be a
-- key. The suffix is appended only when it has to be, so the first Sunseeker
-- gets the clean slug and later ones are numbered rather than everyone carrying
-- a random string.
create or replace function public.tb_unique_agent_slug(p_name text)
returns text
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_base text;
  v_try  text;
  n      int := 1;
begin
  v_base := left(coalesce(tb_slugify(p_name), 'agency'), 40);
  if v_base is null or v_base = '' then v_base := 'agency'; end if;
  v_try := v_base;
  -- Bounded rather than a bare loop: 200 agencies with the same name means
  -- something is wrong that a 201st row will not fix.
  while exists (select 1 from agents where slug = v_try) loop
    n := n + 1;
    if n > 200 then
      -- Falls back to something guaranteed free rather than failing the sign-up.
      return left(v_base, 30) || '-' || left(replace(gen_random_uuid()::text, '-', ''), 8);
    end if;
    v_try := v_base || '-' || n;
  end loop;
  return v_try;
end;
$$;

revoke all on function public.tb_unique_agent_slug from anon, authenticated;

-- ── 5. signing up ───────────────────────────────────────────────────────────
-- Returns { created: true, ... } or { created: false, reason: 'taken' | 'resent' }.
--
-- 'resent' IS NOT A FAILURE. Somebody who signed up, lost the email and tried
-- again gets a fresh link rather than a dead end, and that is by far the most
-- common way a sign-up goes wrong. It is only offered while the account is still
-- unverified: once verified, a repeat sign-up is 'taken'.
--
-- THE CALLER MUST ANSWER THE SAME WAY WHATEVER COMES BACK. All three outcomes
-- mean "check your email", or this endpoint becomes a way to ask whether a given
-- agency has an account here.
create or replace function public.tb_register_agent(
  p_name          text,
  p_email         text,
  p_password_hash text,
  p_token_hash    text,
  p_expires_at    timestamptz,
  p_phone         text default null,
  p_website       text default null,
  p_town          text default null,
  p_ip_hash       text default null,
  p_plan          text default 'Spark'
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_email    text := lower(btrim(p_email));
  v_existing agents%rowtype;
  v_slug     text;
  v_id       uuid;
begin
  select * into v_existing from agents where email = v_email;

  if found then
    -- Already verified, or already trading: nothing to do, and we say nothing.
    if v_existing.verified_at is not null or v_existing.password_hash is null then
      return jsonb_build_object('created', false, 'reason', 'taken');
    end if;
    -- Unverified: replace the link and let them try again. The password is
    -- updated too, because "I signed up but never got the email" and "I have
    -- forgotten what I typed" are the same person.
    update agents
       set password_hash     = p_password_hash,
           verify_token_hash = p_token_hash,
           verify_expires_at = p_expires_at,
           name              = coalesce(nullif(btrim(p_name), ''), name)
     where id = v_existing.id;
    return jsonb_build_object('created', false, 'reason', 'resent',
                              'agentId', v_existing.id, 'name', v_existing.name);
  end if;

  v_slug := tb_unique_agent_slug(p_name);

  insert into agents (slug, name, email, phone, website, town, plan, status,
                      password_hash, verify_token_hash, verify_expires_at, signup_ip_hash)
  values (v_slug, btrim(p_name), v_email,
          nullif(btrim(coalesce(p_phone, '')), ''),
          nullif(btrim(coalesce(p_website, '')), ''),
          nullif(btrim(coalesce(p_town, '')), ''),
          p_plan, 'pending',
          p_password_hash, p_token_hash, p_expires_at, p_ip_hash)
  returning id into v_id;

  return jsonb_build_object('created', true, 'agentId', v_id, 'slug', v_slug,
                            'name', btrim(p_name));
end;
$$;

revoke all on function public.tb_register_agent from anon, authenticated;

-- ── 6. proving the address ──────────────────────────────────────────────────
-- The token is consumed whatever happens, so a link works exactly once.
--
-- p_auto_activate carries the policy from the API. True and the agency is
-- trading the moment they click; false and they wait for a human. Either way
-- verified_at is stamped, because owning the mailbox is a fact independent of
-- whether we let them advertise.
create or replace function public.tb_verify_agent(
  p_token_hash    text,
  p_auto_activate boolean default false
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  a agents%rowtype;
begin
  select * into a from agents where verify_token_hash = p_token_hash;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;

  if a.verify_expires_at is not null and a.verify_expires_at < now() then
    -- Left on the row so the page can offer to send a new one rather than just
    -- refusing. Clearing it here would lose the only handle we have on who it was.
    return jsonb_build_object('ok', false, 'reason', 'expired',
                              'agentId', a.id, 'email', a.email);
  end if;

  update agents
     set verified_at       = coalesce(a.verified_at, now()),
         approved_at       = case when p_auto_activate then coalesce(a.approved_at, now())
                                  else a.approved_at end,
         status            = case when p_auto_activate and a.status = 'pending' then 'active'
                                  else a.status end,
         verify_token_hash = null,
         verify_expires_at = null
   where id = a.id;

  return jsonb_build_object(
    'ok', true,
    'agentId',  a.id,
    'name',     a.name,
    'email',    a.email,
    'slug',     a.slug,
    -- What the page tells them next: trading, or waiting on us.
    'active',   p_auto_activate or a.status = 'active'
  );
end;
$$;

revoke all on function public.tb_verify_agent from anon, authenticated;

-- ── 7. a human says yes ─────────────────────────────────────────────────────
-- Refuses to activate an agency that has not proved its address, so an approval
-- link cannot be used to skip verification entirely. Idempotent: approving twice
-- is not an error, because the second click of a mislaid email is not a mistake
-- worth an error page.
create or replace function public.tb_approve_agent(p_agent_id uuid)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  a agents%rowtype;
begin
  select * into a from agents where id = p_agent_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;
  if a.verified_at is null then
    return jsonb_build_object('ok', false, 'reason', 'unverified',
                              'name', a.name, 'email', a.email);
  end if;
  if a.status = 'active' then
    return jsonb_build_object('ok', true, 'already', true,
                              'name', a.name, 'email', a.email, 'agentId', a.id);
  end if;
  if a.status <> 'pending' then
    -- Paused or suspended is a decision somebody made deliberately. An approval
    -- link from an old email must not quietly undo it.
    return jsonb_build_object('ok', false, 'reason', 'not_pending',
                              'status', a.status, 'name', a.name);
  end if;

  update agents
     set status = 'active', approved_at = coalesce(a.approved_at, now())
   where id = a.id;

  return jsonb_build_object('ok', true, 'already', false,
                            'name', a.name, 'email', a.email, 'agentId', a.id);
end;
$$;

revoke all on function public.tb_approve_agent from anon, authenticated;

-- ── 8. claiming an enquiry to email about ───────────────────────────────────
-- Sets notified_at and hands back everything the email needs, IN ONE STATEMENT.
-- The `notified_at is null` in the WHERE clause is the whole mechanism: two
-- concurrent callers race, one updates a row and the other updates none, so
-- exactly one of them gets a result and sends.
--
-- Returns null when there is nothing to send: already notified, the agency has
-- notifications off, or there is no address to send to.
create or replace function public.tb_claim_lead_notification(p_lead_id uuid)
returns jsonb
language sql
volatile
security invoker
set search_path = public
as $$
  with claimed as (
    update leads l
       set notified_at = now()
      from agents a
     where l.id = p_lead_id
       and l.agent_id = a.id
       and l.notified_at is null
       and a.notify_leads
       and coalesce(nullif(btrim(a.notify_email), ''), a.email) is not null
    returning l.*, a.name as agent_name, a.slug as agent_slug,
              coalesce(nullif(btrim(a.notify_email), ''), a.email) as send_to
  )
  select jsonb_build_object(
    'leadId',        c.id,
    'sendTo',        c.send_to,
    'agentName',     c.agent_name,
    'dealTitle',     c.deal_title,
    'name',          c.name,
    'phone',         c.phone,
    'email',         c.email,
    'message',       c.message,
    'preferredTime', c.preferred_time,
    'createdAt',     c.created_at
  ) from claimed c;
$$;

revoke all on function public.tb_claim_lead_notification from anon, authenticated;

-- Undo a claim when the send actually failed, so the enquiry is still owed an
-- email rather than silently marked as handled. Called only on a hard failure.
create or replace function public.tb_release_lead_notification(p_lead_id uuid)
returns void
language sql
volatile
security invoker
set search_path = public
as $$
  update leads set notified_at = null where id = p_lead_id;
$$;

revoke all on function public.tb_release_lead_notification from anon, authenticated;

-- ── 9. the seeded agencies are already trading ──────────────────────────────
-- They were created by hand before any of this existed, so they have no
-- verified_at and would read as "never proved their address". Backfilled from
-- created_at so the demo does not look like three accounts stuck in limbo.
update public.agents
   set verified_at = coalesce(verified_at, created_at),
       approved_at = coalesce(approved_at, created_at)
 where status = 'active';

-- And every enquiry that predates notifications counts as already handled.
-- Nothing sweeps unnotified leads today, but the moment something does — a
-- retry job, a daily digest — it would find a hundred invented enquiries from
-- the demo seed and email them all out at once. Closing that off now costs one
-- statement; discovering it later costs an agency's trust.
update public.leads set notified_at = created_at where notified_at is null;

commit;

-- ── verify it actually landed ───────────────────────────────────────────────
--   select tb_unique_agent_slug('Sunseeker Travel');   -- sunseeker-travel-2
--   select count(*) from agents where verified_at is null and status = 'active';  -- 0
--   select tb_claim_lead_notification((select id from leads limit 1));
--   select notified_at from leads order by created_at desc limit 3;
