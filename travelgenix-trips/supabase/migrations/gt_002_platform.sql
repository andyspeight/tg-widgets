-- =============================================================================
--  gt_002_platform.sql  ·  Travelgenix Trips
--  Turns the widget schema (gt_001) into a platform schema.
-- =============================================================================
--
--  gt_001 gave us three tables built around a widget: a booking pointed at a
--  tgw_ widget id, and the trip itself lived in an Airtable config blob. That is
--  the thing this migration undoes. A trip becomes a row, a trip has departures,
--  a departure has capacity, and a booking points at a departure.
--
--  RLS is on for every table with NO policies, exactly as gt_001 does it. The
--  service role is the only way in and the browser never connects. Traveller PII
--  lives in gt_bookings and gt_travellers and nowhere else.
--
--  Money is always integer pence, never float. A zero price means "not priced
--  yet" and is hidden rather than rendered as free (locked 10 Aug 2026), so a
--  price column that is null means "inherit" and zero means "unpriced".
--
--  Safe to re-run: every statement is guarded.
-- =============================================================================


-- -----------------------------------------------------------------------------
--  1. Operators, the selling business
-- -----------------------------------------------------------------------------

create table if not exists gt_operators (
  id                      uuid primary key default gen_random_uuid(),

  -- The Airtable client record id, so an existing Travelgenix agent is never
  -- re-onboarded. Null for a self-serve operator with no agency account
  -- (phase 8), hence unique-but-nullable rather than required.
  client_record_id        text unique,

  name                    text not null,
  slug                    text not null unique,
  contact_email           text not null,

  -- Connect STANDARD. The operator is the merchant of record. We keep the
  -- account id so we can open a Checkout Session on their behalf, and the
  -- capability flag so the console can refuse to publish a trip that cannot
  -- actually take money yet.
  stripe_account_id       text unique,
  stripe_charges_enabled  boolean not null default false,

  -- Logo, palette, typeface, reply-to. Operator-branded surfaces read this.
  brand                   jsonb not null default '{}'::jsonb,

  -- What we bill them on. Volume banding, locked 25 Aug 2026: trailing 12-month
  -- volume decides the band, reviewed annually, never stepped mid-term without
  -- notice. The band is STORED because billing acts on it. The volume it came
  -- from is computed from gt_payments at review time rather than denormalised
  -- here, so it cannot drift out of date.
  plan_band               text not null default 'trial'
                            check (plan_band in ('trial','start','grow','scale','enterprise')),
  plan_band_reviewed_on   date,

  custom_domain           text unique,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

comment on table gt_operators is
  'The selling business. One row per operator, keyed to the Airtable client record where one exists. Connect Standard: the operator is merchant of record and Travelgenix never holds traveller funds.';


-- -----------------------------------------------------------------------------
--  2. Trips. A trip is a row, not a widget config blob
-- -----------------------------------------------------------------------------

create table if not exists gt_trips (
  id                uuid primary key default gen_random_uuid(),
  operator_id       uuid not null references gt_operators(id) on delete cascade,

  slug              text not null,
  title             text not null,
  summary           text,

  -- 'group' is the compact Group Trips product, 'tour' the long-form Escorted
  -- Tour. Same table deliberately: they differ in how much content they carry,
  -- not in what a booking means.
  kind              text not null default 'group' check (kind in ('group','tour')),
  status            text not null default 'draft' check (status in ('draft','published','archived')),

  hero_image_url    text,
  location          text,
  currency          text not null default 'gbp',

  -- The long-form body: day-by-day itinerary, highlights, included and excluded,
  -- packing list, gallery. jsonb because the two kinds carry different sections
  -- and the Tour Builder already emits this shape.
  content           jsonb not null default '{}'::jsonb,

  -- Set while a trip is migrating off its tgw_ embed, so the old embed keeps
  -- answering from the platform. Cleared once the widget retires.
  legacy_widget_id  text unique,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (operator_id, slug)
);

comment on table gt_trips is
  'A trip as a first-class row. This is the change that turns the Group Trips widget into a platform: the trip stops living in an Airtable widget config.';


-- -----------------------------------------------------------------------------
--  3. Departures. One trip, many dates
-- -----------------------------------------------------------------------------

create table if not exists gt_departures (
  id               uuid primary key default gen_random_uuid(),
  trip_id          uuid not null references gt_trips(id) on delete cascade,

  starts_on        date not null,
  ends_on          date not null,

  capacity         integer not null default 0 check (capacity >= 0),

  -- A departure carries its own price: the same trip in August is not the same
  -- price as in November. Zero means "not priced yet" and the UI hides it.
  price_pence      integer check (price_pence >= 0),
  deposit_pence    integer check (deposit_pence >= 0),
  balance_due_date date,

  -- How long a pending booking holds its places before the sweep expires it.
  hold_minutes     integer not null default 30 check (hold_minutes > 0),

  status           text not null default 'open' check (status in ('open','closed','cancelled')),

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  check (ends_on >= starts_on)
);

comment on table gt_departures is
  'A dated instance of a trip, and the unit capacity is counted against. The gt_001 capacity rule is unchanged, it simply counts per departure rather than per widget id.';


-- -----------------------------------------------------------------------------
--  4. Packages. Room types and tiers, with photos and links
-- -----------------------------------------------------------------------------

create table if not exists gt_packages (
  id            uuid primary key default gen_random_uuid(),
  trip_id       uuid not null references gt_trips(id) on delete cascade,

  name          text not null,
  description   text,
  price_pence   integer check (price_pence >= 0),
  occupancy     integer not null default 1 check (occupancy between 1 and 20),

  -- Null means this package draws on the departure's capacity rather than
  -- holding an allocation of its own.
  capacity      integer check (capacity >= 0),

  -- A named WeTravel gap: their rooming options carry no photo and no link.
  image_url     text,
  info_url      text,

  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table gt_packages is
  'Room types and fare tiers. image_url and info_url exist deliberately: reviewers name the absence of rooming photos and links as a WeTravel gap.';


-- -----------------------------------------------------------------------------
--  5. Options. Priced add-ons and extras
-- -----------------------------------------------------------------------------

create table if not exists gt_options (
  id            uuid primary key default gen_random_uuid(),
  trip_id       uuid not null references gt_trips(id) on delete cascade,

  name          text not null,
  description   text,
  price_pence   integer check (price_pence >= 0),

  -- Charged once per booking, or once per traveller on it.
  per           text not null default 'traveller' check (per in ('traveller','booking')),
  is_required   boolean not null default false,
  capacity      integer check (capacity >= 0),

  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table gt_options is
  'Priced extras. Display-only in the widget era; selectable and billable from phase 5.';


-- -----------------------------------------------------------------------------
--  6. Payment plans and instalments
-- -----------------------------------------------------------------------------

create table if not exists gt_payment_plans (
  id                    uuid primary key default gen_random_uuid(),
  trip_id               uuid not null references gt_trips(id) on delete cascade,

  name                  text not null,

  -- Either a fixed deposit or a percentage of the total, never both.
  deposit_pence         integer check (deposit_pence >= 0),
  deposit_percent       numeric(5,2) check (deposit_percent > 0 and deposit_percent <= 100),

  -- WeTravel's headline is up to 18. Match it exactly so the comparison is dull.
  instalment_count      integer not null default 1 check (instalment_count between 1 and 18),
  cadence               text not null default 'monthly'
                          check (cadence in ('weekly','fortnightly','monthly')),

  -- The balance must clear before the operator's own supplier deadline.
  final_due_days_before integer not null default 42 check (final_due_days_before >= 0),

  auto_charge           boolean not null default true,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  check (deposit_pence is null or deposit_percent is null)
);

comment on table gt_payment_plans is
  'The schedule template attached to a trip. Up to 18 instalments, matching WeTravels headline feature.';

create table if not exists gt_instalments (
  id            uuid primary key default gen_random_uuid(),
  booking_id    uuid not null references gt_bookings(id) on delete cascade,

  seq           integer not null check (seq >= 1),
  due_on        date not null,
  amount_pence  integer not null check (amount_pence > 0),

  status        text not null default 'scheduled'
                  check (status in ('scheduled','paid','failed','cancelled')),

  -- Set once the charge succeeds, so an instalment and its payment agree.
  payment_id    uuid references gt_payments(id),

  attempts      integer not null default 0 check (attempts >= 0),
  last_error    text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (booking_id, seq)
);

comment on table gt_instalments is
  'One row per due amount on a booking. unique(booking_id,seq) is what makes an auto-charge run idempotent.';


-- -----------------------------------------------------------------------------
--  7. Travellers. A party of six is six rows
-- -----------------------------------------------------------------------------

create table if not exists gt_travellers (
  id            uuid primary key default gen_random_uuid(),
  booking_id    uuid not null references gt_bookings(id) on delete cascade,

  full_name     text,
  email         text,
  phone         text,
  date_of_birth date,

  -- The lead traveller is who we email. Exactly one per booking, enforced by
  -- the partial unique index below rather than a check, because a check cannot
  -- see sibling rows.
  is_lead       boolean not null default false,

  package_id    uuid references gt_packages(id) on delete set null,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table gt_travellers is
  'A person on a booking. Traveller PII lives here and in gt_bookings, nowhere else, and never leaves through a public endpoint.';

create unique index if not exists gt_travellers_one_lead
  on gt_travellers (booking_id) where is_lead;


-- -----------------------------------------------------------------------------
--  8. Forms. The operator's own questions
-- -----------------------------------------------------------------------------

create table if not exists gt_forms (
  id           uuid primary key default gen_random_uuid(),
  trip_id      uuid not null references gt_trips(id) on delete cascade,

  name         text not null,

  -- An ordered list of question objects. Rendered server side and validated
  -- against this same schema on submit, so the browser is never the authority.
  schema       jsonb not null default '[]'::jsonb,

  -- 'booking' gates checkout on it, 'after' collects it later from the
  -- traveller's own dashboard.
  required_at  text not null default 'after' check (required_at in ('booking','after')),
  per          text not null default 'traveller' check (per in ('traveller','booking')),

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table gt_forms is
  'Custom questions per trip. required_at = booking is the mandatory gate.';

create table if not exists gt_form_responses (
  id            uuid primary key default gen_random_uuid(),
  form_id       uuid not null references gt_forms(id) on delete cascade,
  booking_id    uuid not null references gt_bookings(id) on delete cascade,
  traveller_id  uuid references gt_travellers(id) on delete cascade,

  answers       jsonb not null default '{}'::jsonb,
  submitted_at  timestamptz,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table gt_form_responses is
  'One submission of one form, by a traveller or for the booking as a whole.';


-- -----------------------------------------------------------------------------
--  9. Waivers and signatures
-- -----------------------------------------------------------------------------

create table if not exists gt_waivers (
  id           uuid primary key default gen_random_uuid(),
  operator_id  uuid not null references gt_operators(id) on delete cascade,

  -- Null means the waiver applies to every trip this operator runs.
  trip_id      uuid references gt_trips(id) on delete cascade,

  title        text not null,
  body         text not null,

  -- A waiver is never edited in place once signed. Editing mints a new version,
  -- so an old signature keeps pointing at the text it actually agreed to.
  version      integer not null default 1 check (version >= 1),

  -- The named WeTravel gap: theirs cannot be made mandatory at registration.
  is_mandatory boolean not null default true,

  created_at   timestamptz not null default now(),

  unique (operator_id, title, version)
);

comment on table gt_waivers is
  'Versioned waiver text. is_mandatory gates checkout, which WeTravel cannot do and reviewers ask for by name.';

create table if not exists gt_signatures (
  id            uuid primary key default gen_random_uuid(),
  waiver_id     uuid not null references gt_waivers(id),
  booking_id    uuid not null references gt_bookings(id) on delete cascade,
  traveller_id  uuid references gt_travellers(id) on delete cascade,

  signed_name   text not null,
  signed_at     timestamptz not null default now(),

  -- The whole point. A signature must prove WHICH text was agreed, so we store
  -- the hash of the exact body at signing time. If a waiver is ever edited
  -- without a version bump, this is what catches it.
  body_sha256   text not null,

  ip            inet,
  user_agent    text,

  unique (waiver_id, booking_id, traveller_id)
);

comment on table gt_signatures is
  'Evidence a specific person agreed to a specific version of a specific text. body_sha256 pins the exact wording signed.';


-- -----------------------------------------------------------------------------
--  10. Documents. Passports, insurance, visas
-- -----------------------------------------------------------------------------

create table if not exists gt_documents (
  id            uuid primary key default gen_random_uuid(),
  booking_id    uuid not null references gt_bookings(id) on delete cascade,
  traveller_id  uuid references gt_travellers(id) on delete cascade,

  kind          text not null default 'other'
                  check (kind in ('passport','insurance','visa','waiver','other')),

  -- Only ever the https URL from the blob store, never the bytes and never a
  -- base64 blob (locked 10 Aug 2026).
  file_url      text not null,
  file_name     text,
  content_type  text,
  size_bytes    integer check (size_bytes >= 0),

  uploaded_at   timestamptz not null default now()
);

comment on table gt_documents is
  'Traveller uploads. Stores the blob URL only, never the file bytes.';


-- =============================================================================
--  11. Extend the three gt_001 tables
-- =============================================================================

alter table gt_bookings
  add column if not exists operator_id      uuid references gt_operators(id),
  add column if not exists departure_id     uuid references gt_departures(id),
  add column if not exists package_id       uuid references gt_packages(id),
  add column if not exists payment_plan_id  uuid references gt_payment_plans(id),
  add column if not exists balance_pence    integer,
  add column if not exists reference        text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'gt_bookings_balance_pence_check') then
    alter table gt_bookings add constraint gt_bookings_balance_pence_check check (balance_pence >= 0);
  end if;
end $$;

-- The traveller-facing booking reference. It is how someone enters the Luna
-- Travel app (phase 7) and what they quote on the phone, so it must be unique
-- across every operator, not merely within one.
create unique index if not exists gt_bookings_reference_key
  on gt_bookings (reference) where reference is not null;

-- widget_id stays for now: the live tgw_ embeds still answer through it while
-- phase 1 migrates them. Droppable once no trip carries a legacy_widget_id.
comment on column gt_bookings.widget_id is
  'Legacy. The tgw_ embed a booking arrived through. Kept until every trip has migrated off its widget config; departure_id is the real link.';

-- A payment can now be an instalment, not only a deposit or a balance.
alter table gt_payments drop constraint if exists gt_payments_kind_check;
alter table gt_payments add constraint gt_payments_kind_check
  check (kind in ('deposit','balance','instalment'));

-- And a reminder can chase one.
alter table gt_reminders drop constraint if exists gt_reminders_kind_check;
alter table gt_reminders add constraint gt_reminders_kind_check
  check (kind in ('balance_due','balance_final','instalment_due','instalment_failed'));


-- =============================================================================
--  12. Indexes on the paths we actually query
-- =============================================================================

create index if not exists gt_trips_operator_idx       on gt_trips (operator_id);
create index if not exists gt_trips_published_idx      on gt_trips (operator_id, status) where status = 'published';
create index if not exists gt_departures_trip_idx      on gt_departures (trip_id, starts_on);
create index if not exists gt_packages_trip_idx        on gt_packages (trip_id, sort_order);
create index if not exists gt_options_trip_idx         on gt_options (trip_id, sort_order);
create index if not exists gt_payment_plans_trip_idx   on gt_payment_plans (trip_id);
create index if not exists gt_travellers_booking_idx   on gt_travellers (booking_id);
create index if not exists gt_forms_trip_idx           on gt_forms (trip_id);
create index if not exists gt_form_responses_bkg_idx   on gt_form_responses (booking_id);
create index if not exists gt_waivers_operator_idx     on gt_waivers (operator_id);
create index if not exists gt_signatures_booking_idx   on gt_signatures (booking_id);
create index if not exists gt_documents_booking_idx    on gt_documents (booking_id);
create index if not exists gt_instalments_due_idx      on gt_instalments (due_on) where status = 'scheduled';
create index if not exists gt_bookings_operator_idx    on gt_bookings (operator_id);

-- The hot path: availability for one departure. Mirrors the gt_001 query shape,
-- which filters on the counting statuses and reads party_size + hold_expires_at.
create index if not exists gt_bookings_departure_status_idx
  on gt_bookings (departure_id, status);


-- =============================================================================
--  13. RLS on, no policies. Service role only, same as gt_001.
-- =============================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'gt_operators','gt_trips','gt_departures','gt_packages','gt_options',
    'gt_payment_plans','gt_instalments','gt_travellers','gt_forms',
    'gt_form_responses','gt_waivers','gt_signatures','gt_documents'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;
