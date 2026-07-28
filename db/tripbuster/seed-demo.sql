-- Tripbuster demo seed — three agencies, their deals, and 30 days of traffic.
--
-- Purpose: give the consumer site something real to search, compare and click,
-- and give each advertiser dashboard real figures to show. This is DEMO DATA on
-- the development database. It is not customer data and none of these agencies
-- exist.
--
-- SAFE TO RE-RUN. It clears and rebuilds everything belonging to the three demo
-- agents and touches nothing else, so it doubles as a "reset the demo" button.
--
-- It deliberately does NOT set passwords. Sign-in credentials are set separately
-- so no working credential ever lives in the repo.
--
-- What it builds:
--   3 agencies, 34 deals (26 live, 6 draft, 2 paused)
--   4 properties advertised by more than one agency, which is what makes the
--     multi-agent price compare visible on the consumer site
--   one agency on each billing mode: clicks, calls, and both
--   callback requests, some with a phone number, some an email, some both
--   opening hours on the two agencies that take calls, one of them shut on Sundays
--   more than one number, labelled, including an out-of-hours mobile
--   30 days of impressions, clicks and phone enquiries, generated so they reconcile:
--     click_events are EXPANDED FROM deal_daily_stats rather than invented
--     alongside them, because tb_agent_stats reads impressions and clicks from
--     the daily table and billable clicks from the events table. Generating them
--     independently is what produced a 350% click-through rate the first time.
--
-- Randomness is derived from hashes of the agency's own deal REFERENCE rather
-- than from random() or the row id, so running this twice gives exactly the same
-- demo and a screenshot stays true. Deal ids are regenerated on every run, so
-- keying on them would have quietly broken that promise.

begin;

-- ── the three agencies ──────────────────────────────────────────────────────
-- Plans are set deliberately for the demo: two unlimited, and Jetaway on Boost
-- with exactly its 5 live deals used, so the plan limit and the upgrade prompt
-- can be shown honestly rather than described.
insert into public.agents (slug, name, email, phone, website, town, region,
                           protection_type, atol_number, default_clickout_url, plan, status)
values
  ('sunseeker-travel', 'Sunseeker Travel', 'hello@sunseekertravel.co.uk', '01204 555 118',
   'https://sunseekertravel.co.uk', 'Bolton', 'Greater Manchester',
   'ATOL', '11542', 'https://sunseekertravel.co.uk', 'Ignite', 'active'),
  ('coastline-holidays', 'Coastline Holidays', 'team@coastlineholidays.co.uk', '01273 555 240',
   'https://coastlineholidays.co.uk', 'Brighton', 'East Sussex',
   'ATOL + ABTA', '9840', 'https://coastlineholidays.co.uk', 'Ignite', 'active'),
  -- (Coastline's ABTA number is set just below, so deals inherit it rather than
  -- having it written into each row.)
  ('jetaway-travel', 'Jetaway Travel', 'bookings@jetawaytravel.co.uk', '0141 555 907',
   'https://jetawaytravel.co.uk', 'Glasgow', 'Lanarkshire',
   'ATOL', '12203', 'https://jetawaytravel.co.uk', 'Boost', 'active')
on conflict (slug) do update set
  name = excluded.name,
  -- Email is the sign-in identity, so it is refreshed too. Without this an
  -- agency seeded by an earlier run keeps its old address and the credentials
  -- written down for the demo stop matching what is actually in the table.
  email = excluded.email,
  phone = excluded.phone,
  website = excluded.website,
  town = excluded.town,
  region = excluded.region,
  protection_type = excluded.protection_type,
  atol_number = excluded.atol_number,
  default_clickout_url = excluded.default_clickout_url,
  plan = excluded.plan,
  status = excluded.status;

-- Coastline is also a Travelgenix client, which unlocks the live-feed import
-- route for them. The other two see the upsell panel instead, so both states are
-- demonstrable from the same database.
update public.agents
   set tg_client_email = 'coastline@travelgenix.io',
       abta_number = 'Y1842'
 where slug = 'coastline-holidays';
update public.agents set tg_client_email = null
 where slug in ('sunseeker-travel', 'jetaway-travel');

-- One agency on each billing mode, so all three are visible in the demo:
--   Sunseeker sells online, Jetaway sells on the phone, Coastline does both.
-- The qualifying lengths differ between the two that take calls, but neither
-- changes a figure: no tracked number is feeding durations in, and the demo does
-- not pretend one is.
update public.agents set billing_mode = 'click' where slug = 'sunseeker-travel';
update public.agents set billing_mode = 'call',  call_min_seconds = 60 where slug = 'jetaway-travel';
update public.agents set billing_mode = 'both',  call_min_seconds = 90 where slug = 'coastline-holidays';

-- ── opening hours ───────────────────────────────────────────────────────────
-- Two different shapes, because the interesting part of this feature is the
-- difference between them:
--
--   JETAWAY keeps shop hours and shuts on Sundays, on the default "leave us a
--   message" setting. Their deal pages swap the call button for a call-back form
--   in the evenings, so out-of-hours demand reaches them as ENQUIRIES rather than
--   as calls nobody answers. That is the setting doing its job.
--   COASTLINE is open seven days and late, so nearly everything they take is
--   inside hours. Same feature, almost no effect, which is the honest comparison.
--   SUNSEEKER is left on 'always'. They sell on clicks, so hours would be noise.
delete from public.agent_hours where agent_id in (select id from public.agents where slug in ('sunseeker-travel','coastline-holidays','jetaway-travel'));
delete from public.agent_special_days where agent_id in (select id from public.agents where slug in ('sunseeker-travel','coastline-holidays','jetaway-travel'));
delete from public.agent_phones where agent_id in (select id from public.agents where slug in ('sunseeker-travel','coastline-holidays','jetaway-travel'));

update public.agents
   set hours_mode = 'scheduled', time_zone = 'Europe/London'
 where slug in ('jetaway-travel', 'coastline-holidays');

-- The two closed behaviours, one each, so both are demonstrable:
--   Jetaway asks for a message. No call button out of hours, nothing charged.
--   Coastline takes the calls anyway (they divert to a mobile), so their few
--   out-of-hours calls ARE charged for, exactly like any other call.
update public.agents set closed_behaviour = 'callback' where slug = 'jetaway-travel';
update public.agents set closed_behaviour = 'show'     where slug = 'coastline-holidays';

-- Jetaway: weekdays nine to half five, Saturday morning only, Sunday shut.
insert into public.agent_hours (agent_id, day_of_week, opens, closes)
select a.id, d.dow, d.o, d.c
from public.agents a, (values
  (1::smallint, '09:00'::time, '17:30'::time),
  (2::smallint, '09:00'::time, '17:30'::time),
  (3::smallint, '09:00'::time, '17:30'::time),
  (4::smallint, '09:00'::time, '17:30'::time),
  (5::smallint, '09:00'::time, '17:30'::time),
  (6::smallint, '09:30'::time, '13:00'::time)
) as d(dow, o, c)
where a.slug = 'jetaway-travel';

-- Coastline: open every day, and late on a Thursday, which is when people who
-- have been thinking about a holiday all week finally ring.
insert into public.agent_hours (agent_id, day_of_week, opens, closes)
select a.id, d.dow, d.o, d.c
from public.agents a, (values
  (1::smallint, '09:00'::time, '18:00'::time),
  (2::smallint, '09:00'::time, '18:00'::time),
  (3::smallint, '09:00'::time, '18:00'::time),
  (4::smallint, '09:00'::time, '20:00'::time),
  (5::smallint, '09:00'::time, '18:00'::time),
  (6::smallint, '09:00'::time, '17:00'::time),
  (0::smallint, '10:00'::time, '16:00'::time)
) as d(dow, o, c)
where a.slug = 'coastline-holidays';

-- The August bank holiday and Christmas, so the exceptions have something to
-- show. Jetaway shuts outright; Coastline runs a short day, which exercises both
-- shapes a special day can take.
insert into public.agent_special_days (agent_id, on_date, opens, closes, note)
select a.id, d.on_date, d.o, d.c, d.note
from public.agents a, (values
  ('jetaway-travel',     date '2026-08-31', null::time, null::time, 'August bank holiday'),
  ('jetaway-travel',     date '2026-12-25', null::time, null::time, 'Christmas Day'),
  ('jetaway-travel',     date '2026-12-26', null::time, null::time, 'Boxing Day'),
  ('coastline-holidays', date '2026-08-31', '11:00'::time, '15:00'::time, 'August bank holiday'),
  ('coastline-holidays', date '2026-12-25', null::time, null::time, 'Christmas Day')
) as d(slug, on_date, o, c, note)
where a.slug = d.slug;

-- ── more than one number ────────────────────────────────────────────────────
-- agents.phone stays the main number. These are the extras, and each one only
-- makes sense with its label: an out-of-hours mobile shown at ten in the morning
-- would be the wrong number, which is what when_shown is for.
--
-- Every number is in Ofcom's reserved drama range, so nothing here can ring a
-- real person.
insert into public.agent_phones (agent_id, label, phone, when_shown, sort_order)
select a.id, d.label, d.phone, d.when_shown, d.sort_order
from public.agents a, (values
  ('jetaway-travel',     'Out of hours',  '07700 900461', 'closed', 0),
  ('coastline-holidays', 'Brighton shop', '01273 555 240', 'open',   0),
  ('coastline-holidays', 'Cruise desk',   '01273 555 288', 'always', 1),
  ('coastline-holidays', 'Evenings and weekends', '07700 900782', 'closed', 2)
) as d(slug, label, phone, when_shown, sort_order)
where a.slug = d.slug;

-- ── clear what this seed owns ───────────────────────────────────────────────
-- Scoped to the demo agents. click_events and deal_daily_stats cascade from
-- deals, but they are cleared explicitly so the intent is obvious.
delete from public.click_events     where agent_id in (select id from public.agents where slug in ('sunseeker-travel','coastline-holidays','jetaway-travel'));
delete from public.deal_daily_stats where agent_id in (select id from public.agents where slug in ('sunseeker-travel','coastline-holidays','jetaway-travel'));
delete from public.leads            where agent_id in (select id from public.agents where slug in ('sunseeker-travel','coastline-holidays','jetaway-travel'));
delete from public.import_runs      where agent_id in (select id from public.agents where slug in ('sunseeker-travel','coastline-holidays','jetaway-travel'));
delete from public.deals            where agent_id in (select id from public.agents where slug in ('sunseeker-travel','coastline-holidays','jetaway-travel'));

-- ── the deals ───────────────────────────────────────────────────────────────
-- Four properties are advertised by more than one agency, on purpose:
--   Sol Pelicanos Ocean, Benidorm   — all three, the headline compare
--   Balaia Golf Village, Albufeira  — Sunseeker + Coastline
--   Louis Phaethon Beach, Paphos    — Coastline + Jetaway
--   Melia Costa del Sol, Torremolinos — Sunseeker + Coastline
-- The generated property_key column groups them, so the compare works without
-- anyone matching a central property record.
--
-- Everything the "a live deal needs a price and a link" constraint checks is set
-- HERE, in the insert. Writing the booking link in a later update would trip
-- that constraint the moment a live row landed without one.
--
-- The agency's own booking link, protection and phone are read across from the
-- agents table rather than repeated per row, which is the same inheritance
-- applyAgentDefaults performs on the API write path: the traveller books with
-- the agency, so the deal must carry the agency's cover, not anyone else's.
insert into public.deals (
  agent_id, status, holiday_type, reference, title, strapline,
  country, region, resort, accommodation_name, star_rating, guest_score,
  distance_to_beach, board_basis, room_type, nights, departure_airports, airline,
  travel_from, travel_until, price_from, was_price, price_basis, currency,
  selling_points, offer_badges, facilities, source,
  clickout_url, protection_type, atol_number, abta_number, booking_phone,
  external_ref, synced_at
)
select a.id, v.status, v.holiday_type, v.reference, v.title, v.strapline,
       v.country, v.region, v.resort, v.hotel, v.stars, v.score,
       v.beach, v.board, v.room, v.nights, v.airports, v.airline,
       v.travel_from::date, v.travel_until::date, v.price, v.was, 'pp', 'GBP',
       v.points, v.badges, v.facilities, v.source,
       a.default_clickout_url || '/deals/' || lower(v.reference),
       a.protection_type, a.atol_number, a.abta_number, a.phone,
       -- Provenance exactly as the two importers would have written it: a
       -- spreadsheet row keyed by the agency's own reference, a live-feed deal
       -- by the offer id.
       case v.source
         when 'spreadsheet' then 'sheet:' || v.reference
         when 'live_cache'  then 'cache:' || v.reference || '|LGW|Packages'
         else null end,
       case when v.source = 'live_cache' then now() - interval '6 hours' else null end
from (values
  -- ── Sunseeker Travel ──────────────────────────────────────────────────────
  ('sunseeker-travel','live','Package holiday','SUN-1001',
   'Sol Pelicanos Ocean, Benidorm, 7 nights all inclusive',
   'Steps from Levante beach, with a rooftop pool',
   'Spain','Costa Blanca','Benidorm','Sol Pelicanos Ocean',3,7.9,'200m',
   'All inclusive','Twin room, side sea view',7,
   array['Manchester','Birmingham'],'Jet2','2026-10-04','2027-03-28',329,459,
   array['Two minutes from Levante beach','Rooftop pool and sun terrace','All drinks included until 11pm'],
   array['Best seller'],array['Outdoor pool','Rooftop terrace','Entertainment','Wi-Fi'],'spreadsheet'),

  ('sunseeker-travel','live','Package holiday','SUN-1002',
   'Balaia Golf Village, Albufeira, 7 nights half board',
   'Family apartments with golf on the doorstep',
   'Portugal','Algarve','Albufeira','Balaia Golf Village',4,8.6,'900m',
   'Half board','One bedroom apartment',7,
   array['Manchester'],'TUI','2026-09-12','2027-04-18',489,599,
   array['Golf course on site','Spacious family apartments','Free kids club in school holidays'],
   array['Family favourite'],array['Golf','Kids club','Two pools','Tennis'],'spreadsheet'),

  ('sunseeker-travel','live','Package holiday','SUN-1003',
   'Melia Costa del Sol, Torremolinos, 7 nights half board',
   'Seafront, a short stroll from the old town',
   'Spain','Costa del Sol','Torremolinos','Melia Costa del Sol',4,8.2,'Beachfront',
   'Half board','Double room with balcony',7,
   array['Manchester','Birmingham'],'Jet2','2026-10-11','2027-03-14',419,529,
   array['Directly on the seafront','Walk to Torremolinos old town','Adults-only pool area'],
   array[]::text[],array['Seafront','Two pools','Spa','Wi-Fi'],'spreadsheet'),

  ('sunseeker-travel','live','Package holiday','SUN-1004',
   'Servigroup Diplomatic, Benidorm, 4 nights full board',
   'A short break that costs less than a weekend away',
   'Spain','Costa Blanca','Benidorm','Servigroup Diplomatic',4,8.0,'400m',
   'Full board','Standard double',4,
   array['Birmingham'],'Ryanair','2026-11-02','2027-02-26',199,269,
   array['Full board for under £200','Indoor and outdoor pools','Quiet end of Levante'],
   array['Short break'],array['Indoor pool','Outdoor pool','Spa','Lift'],'manual'),

  ('sunseeker-travel','live','Package holiday','SUN-1005',
   'Iberostar Las Dalias, Costa Adeje, 10 nights all inclusive',
   'Ten nights in the Tenerife winter sun',
   'Spain','Tenerife','Costa Adeje','Iberostar Las Dalias',4,8.7,'350m',
   'All inclusive','Double room, pool view',10,
   array['Manchester'],'Jet2','2026-11-08','2027-03-21',749,899,
   array['Ten nights, not seven','Winter sun at 22 degrees','Three pools and a spa'],
   array['Long stay'],array['Three pools','Spa','Gym','Entertainment'],'spreadsheet'),

  ('sunseeker-travel','live','Package holiday','SUN-1006',
   'Aparthotel Bahia, Salou, 7 nights self catering',
   'Self catering a few minutes from Salou beach',
   'Spain','Costa Dorada','Salou','Aparthotel Bahia',3,7.6,'450m',
   'Self catering','Studio apartment',7,
   array['Manchester'],'Jet2','2026-09-20','2027-04-11',269,null,
   array['Cook for yourself and save','Close to PortAventura','Balcony in every apartment'],
   array[]::text[],array['Pool','Balcony','Wi-Fi'],'spreadsheet'),

  ('sunseeker-travel','live','Package holiday','SUN-1007',
   'Blue Sea Beach, Rethymno, 7 nights all inclusive',
   'Crete on a long sandy beach',
   'Greece','Crete','Rethymno','Blue Sea Beach Resort',4,8.4,'Beachfront',
   'All inclusive','Bungalow, garden view',7,
   array['Manchester'],'TUI','2027-04-25','2027-06-27',529,649,
   array['Right on the sand','Water park for the children','Greek taverna on site'],
   array['New for 2027'],array['Water park','Beachfront','Kids club','Taverna'],'spreadsheet'),

  ('sunseeker-travel','live','City break','SUN-1008',
   'Riad Anaya, Marrakech, 4 nights bed and breakfast',
   'A courtyard riad inside the medina walls',
   'Morocco','Marrakech-Safi','Marrakech','Riad Anaya',4,9.1,'Inland',
   'Bed & breakfast','Courtyard room',4,
   array['Manchester'],'easyJet','2026-10-18','2027-03-07',259,319,
   array['Inside the medina walls','Rooftop breakfast over the souks','Airport transfer included'],
   array['Top rated'],array['Rooftop terrace','Plunge pool','Airport transfer'],'manual'),

  ('sunseeker-travel','live','Package holiday','SUN-1009',
   'Sunset Beach Club, Benalmadena, 7 nights self catering',
   'Apartments above the marina',
   'Spain','Costa del Sol','Benalmadena','Sunset Beach Club',4,8.3,'250m',
   'Self catering','One bedroom apartment',7,
   array['Birmingham'],'Ryanair','2026-09-27','2027-04-04',359,439,
   array['Overlooking Benalmadena marina','Kitchen in every apartment','Four pools'],
   array[]::text[],array['Four pools','Kitchen','Gym','Marina views'],'spreadsheet'),

  ('sunseeker-travel','live','Package holiday','SUN-1010',
   'Riu Palace, Hurghada, 7 nights all inclusive',
   'Red Sea sun when Britain is grey',
   'Egypt','Red Sea','Hurghada','Riu Palace Hurghada',5,8.8,'Beachfront',
   'All inclusive','Double room, sea view',7,
   array['Manchester'],'TUI','2026-12-06','2027-03-28',599,749,
   array['Five star all inclusive','Snorkelling straight off the beach','24 hour all inclusive'],
   array['Five star'],array['Private beach','Diving centre','Four restaurants','Spa'],'manual'),

  ('sunseeker-travel','live','Package holiday','SUN-1011',
   'Corfu Palma, Sidari, 7 nights all inclusive',
   'The quiet end of Sidari',
   'Greece','Corfu','Sidari','Corfu Palma Hotel',3,7.8,'600m',
   'All inclusive','Twin room',7,
   array['Manchester'],'Jet2','2027-05-09','2027-06-20',449,559,
   array['Away from the strip but walkable','Canal d''Amour nearby','Pool bar included'],
   array[]::text[],array['Pool','Pool bar','Wi-Fi'],'spreadsheet'),

  ('sunseeker-travel','draft','Package holiday','SUN-1012',
   'Zante Palms, Laganas, 7 nights all inclusive', null,
   'Greece','Zante','Laganas','Zante Palms',3,7.4,'700m',
   'All inclusive','Twin room',7,
   array['Manchester'],'Jet2','2027-05-16','2027-06-27',419,null,
   array[]::text[],array[]::text[],array['Pool','Bar'],'spreadsheet'),

  ('sunseeker-travel','draft','Package holiday','SUN-1013',
   'Alcudia Garden, Majorca, 7 nights self catering', null,
   'Spain','Majorca','Alcudia','Alcudia Garden Aparthotel',3,7.7,'500m',
   'Self catering','Studio',7,
   array['Manchester'],'Jet2','2027-05-02','2027-06-13',299,null,
   array[]::text[],array[]::text[],array['Pool','Kitchen'],'spreadsheet'),

  ('sunseeker-travel','paused','Package holiday','SUN-1014',
   'Benidorm late deal, 3 nights bed and breakfast', null,
   'Spain','Costa Blanca','Benidorm','Hotel Perla',3,7.1,'300m',
   'Bed & breakfast','Twin room',3,
   array['Birmingham'],'Ryanair','2026-09-06','2026-09-27',149,199,
   array[]::text[],array[]::text[],array['Pool'],'manual'),

  -- ── Coastline Holidays ────────────────────────────────────────────────────
  ('coastline-holidays','live','Package holiday','CST-2001',
   'Sol Pelicanos Ocean, Benidorm, 7 nights all inclusive',
   'The Benidorm favourite, from the south coast',
   'Spain','Costa Blanca','Benidorm','Sol Pelicanos Ocean',3,7.9,'200m',
   'All inclusive','Twin room',7,
   array['Gatwick','Bristol'],'easyJet','2026-10-04','2027-03-28',342,459,
   array['Two minutes from Levante beach','Rooftop pool','ABTA and ATOL protected'],
   array[]::text[],array['Outdoor pool','Rooftop terrace','Entertainment'],'manual'),

  ('coastline-holidays','live','Package holiday','CST-2002',
   'Balaia Golf Village, Albufeira, 7 nights half board',
   'Our best price on the Algarve this autumn',
   'Portugal','Algarve','Albufeira','Balaia Golf Village',4,8.6,'900m',
   'Half board','Two bedroom apartment',7,
   array['Gatwick'],'TUI','2026-09-12','2027-04-18',465,599,
   array['Two bedroom apartments at the same price','Golf on site','Free shuttle to the old town'],
   array['Lowest price'],array['Golf','Kids club','Two pools','Shuttle bus'],'live_cache'),

  ('coastline-holidays','live','Package holiday','CST-2003',
   'Louis Phaethon Beach, Paphos, 7 nights all inclusive',
   'Cyprus with the beach at the end of the garden',
   'Cyprus','Paphos','Paphos','Louis Phaethon Beach',4,8.5,'Beachfront',
   'All inclusive','Double room, garden view',7,
   array['Gatwick'],'TUI','2026-10-25','2027-04-25',559,689,
   array['Directly on the beach','Four pools including an adults-only','Cyprus stays warm into November'],
   array[]::text[],array['Four pools','Private beach','Tennis','Spa'],'live_cache'),

  ('coastline-holidays','live','Package holiday','CST-2004',
   'Melia Costa del Sol, Torremolinos, 7 nights half board',
   'Seafront half board with a sea view balcony',
   'Spain','Costa del Sol','Torremolinos','Melia Costa del Sol',4,8.2,'Beachfront',
   'Half board','Double room, sea view',7,
   array['Bristol'],'easyJet','2026-10-11','2027-03-14',399,529,
   array['Sea view balcony included','On the seafront promenade','Walk to the old town'],
   array['Lowest price'],array['Seafront','Two pools','Spa'],'live_cache'),

  ('coastline-holidays','live','Package holiday','CST-2005',
   'Adeje Palm Resort and Spa, Costa Adeje, 10 nights half board',
   'Ten nights in Tenerife with a spa on site',
   'Spain','Tenerife','Costa Adeje','Adeje Palm Resort & Spa',4,8.5,'400m',
   'Half board','Double room, pool view',10,
   array['Gatwick'],'TUI','2026-11-15','2027-03-21',549,699,
   array['Ten nights for the price most charge for seven','Thalasso spa on site','Adults-only sun terrace'],
   array['Long stay'],array['Spa','Three pools','Gym','Adults area'],'live_cache'),

  ('coastline-holidays','live','Package holiday','CST-2006',
   'Marmaris Beach Resort, 14 nights all inclusive',
   'A fortnight in Turkey, all in',
   'Turkey','Mugla','Marmaris','Marmaris Beach Resort',4,8.1,'150m',
   'All inclusive','Double room',14,
   array['Gatwick'],'Jet2','2027-05-02','2027-06-27',629,799,
   array['Fourteen nights all inclusive','Local drinks and snacks all day','Free sun loungers on the beach'],
   array['Two weeks'],array['Beach','Two pools','Water slides','Entertainment'],'manual'),

  ('coastline-holidays','live','Package holiday','CST-2007',
   'Family Life Kerkyra, Corfu, 7 nights all inclusive',
   'Built around families, without the crowds',
   'Greece','Corfu','Gouvia','Family Life Kerkyra Beach',4,8.4,'Beachfront',
   'All inclusive','Family room',7,
   array['Bristol'],'TUI','2027-05-09','2027-06-20',519,629,
   array['Kids club from age three','Family rooms as standard','Beach on the doorstep'],
   array['Family favourite'],array['Kids club','Beach','Two pools','Family rooms'],'manual'),

  ('coastline-holidays','live','Package holiday','CST-2008',
   'Hotel Don Pedro, Cala Millor, 7 nights half board',
   'Majorca on a long sandy bay',
   'Spain','Majorca','Cala Millor','Hotel Don Pedro',4,8.0,'100m',
   'Half board','Double room, side sea view',7,
   array['Gatwick'],'easyJet','2027-04-18','2027-06-13',389,479,
   array['A minute from the sand','Long flat promenade','Evening entertainment included'],
   array[]::text[],array['Pool','Entertainment','Promenade'],'live_cache'),

  ('coastline-holidays','live','Package holiday','CST-2009',
   'Sandos Playacar, Playa del Carmen, 10 nights all inclusive',
   'The Riviera Maya, all inclusive',
   'Mexico','Quintana Roo','Playa del Carmen','Sandos Playacar Beach Resort',5,8.6,'Beachfront',
   'All inclusive','Deluxe room',10,
   array['Gatwick'],'TUI','2027-01-10','2027-03-28',1199,1449,
   array['Ten nights on the Riviera Maya','Five restaurants included','Cenotes and Tulum within reach'],
   array['Five star','Long haul'],array['Private beach','Five restaurants','Spa','Dive centre'],'manual'),

  ('coastline-holidays','live','City break','CST-2010',
   'Krakow, 3 nights bed and breakfast',
   'A long weekend in the old town',
   'Poland','Lesser Poland','Krakow','Hotel Wawel Old Town',4,8.9,'Inland',
   'Bed & breakfast','Double room',3,
   array['Bristol'],'Ryanair','2026-11-14','2027-03-14',179,229,
   array['Two minutes from the market square','Christmas markets in December','Breakfast included'],
   array['City break'],array['Old town','Breakfast','Wi-Fi'],'manual'),

  ('coastline-holidays','draft','City break','CST-2011',
   'Rome, 3 nights bed and breakfast', null,
   'Italy','Lazio','Rome','Hotel Trastevere',3,8.4,'Inland',
   'Bed & breakfast','Double room',3,
   array['Gatwick'],'easyJet','2027-03-07','2027-05-30',219,null,
   array[]::text[],array[]::text[],array['Breakfast','Wi-Fi'],'manual'),

  ('coastline-holidays','paused','Package holiday','CST-2012',
   'Algarve early booker, 7 nights self catering', null,
   'Portugal','Algarve','Albufeira','Albufeira Sol Apartments',3,7.5,'800m',
   'Self catering','One bedroom apartment',7,
   array['Gatwick'],'Ryanair','2027-04-11','2027-06-06',329,399,
   array[]::text[],array[]::text[],array['Pool','Kitchen'],'live_cache'),

  -- ── Jetaway Travel (Boost: exactly its 5 live deals used) ─────────────────
  ('jetaway-travel','live','Package holiday','JET-3001',
   'Sol Pelicanos Ocean, Benidorm, 7 nights all inclusive',
   'Benidorm direct from Glasgow',
   'Spain','Costa Blanca','Benidorm','Sol Pelicanos Ocean',3,7.9,'200m',
   'All inclusive','Twin room',7,
   array['Glasgow'],'Jet2','2026-10-04','2027-03-28',355,459,
   array['Direct from Glasgow','Two minutes from Levante beach','Scottish school holidays covered'],
   array[]::text[],array['Outdoor pool','Rooftop terrace','Entertainment'],'manual'),

  ('jetaway-travel','live','Package holiday','JET-3002',
   'Louis Phaethon Beach, Paphos, 7 nights all inclusive',
   'Cyprus from Scotland, no changing planes',
   'Cyprus','Paphos','Paphos','Louis Phaethon Beach',4,8.5,'Beachfront',
   'All inclusive','Double room',7,
   array['Glasgow'],'TUI','2026-10-25','2027-04-25',575,689,
   array['Direct from Glasgow','On the beach','Warm into November'],
   array[]::text[],array['Four pools','Private beach','Tennis'],'manual'),

  ('jetaway-travel','live','Package holiday','JET-3003',
   'Atlantis The Palm, Dubai, 5 nights bed and breakfast',
   'Five nights on the Palm',
   'United Arab Emirates','Dubai','Dubai','Atlantis The Palm',5,9.0,'Beachfront',
   'Bed & breakfast','Ocean deluxe room',5,
   array['Glasgow'],'Emirates','2026-11-22','2027-03-14',1299,1599,
   array['Aquaventure water park included','On the Palm Jumeirah','Emirates from Glasgow'],
   array['Five star','Long haul'],array['Water park','Aquarium','Private beach','Eleven restaurants'],'manual'),

  ('jetaway-travel','live','Package holiday','JET-3004',
   'Riu Costa Lago, Torremolinos, 7 nights all inclusive',
   'All inclusive on the Costa del Sol, from Edinburgh',
   'Spain','Costa del Sol','Torremolinos','Hotel Riu Costa Lago',4,8.1,'150m',
   'All inclusive','Double room',7,
   array['Edinburgh'],'Jet2','2026-10-11','2027-03-21',429,null,
   array['24 hour all inclusive','Two minutes from the beach','Direct from Edinburgh'],
   array[]::text[],array['Two pools','Entertainment','Gym'],'manual'),

  ('jetaway-travel','live','City break','JET-3005',
   'Reykjavik and the northern lights, 3 nights',
   'Three nights chasing the aurora',
   'Iceland','Capital Region','Reykjavik','Hotel Borealis',3,8.7,'Inland',
   'Bed & breakfast','Double room',3,
   array['Glasgow'],'easyJet','2026-11-01','2027-02-28',399,489,
   array['Northern lights excursion included','Blue Lagoon transfers available','Direct from Glasgow'],
   array['City break'],array['Aurora tour','Breakfast','Wi-Fi'],'manual'),

  ('jetaway-travel','draft','Package holiday','JET-3006',
   'Bangkok and Phuket, 14 nights', null,
   'Thailand','Phuket','Patong','Twin centre, 3 and 11 nights',4,8.8,'200m',
   'Bed & breakfast','Deluxe room',14,
   array['Glasgow'],'Emirates','2027-01-17','2027-03-28',1099,null,
   array[]::text[],array[]::text[],array['Two centres','Pool','Breakfast'],'manual'),

  ('jetaway-travel','draft','City break','JET-3007',
   'New York shopping break, 4 nights', null,
   'United States','New York','Manhattan','Midtown Central Hotel',4,8.3,'Inland',
   'Room only','Standard queen',4,
   array['Glasgow'],'Virgin Atlantic','2026-11-28','2027-02-14',649,null,
   array[]::text[],array[]::text[],array['Midtown','Wi-Fi'],'manual'),

  ('jetaway-travel','draft','City break','JET-3008',
   'Prague, 3 nights bed and breakfast', null,
   'Czech Republic','Prague','Prague','Hotel Karlova',3,8.2,'Inland',
   'Bed & breakfast','Double room',3,
   array['Edinburgh'],'Ryanair','2027-02-06','2027-05-15',199,null,
   array[]::text[],array[]::text[],array['Old town','Breakfast'],'manual'),

  -- ── the other five product types ──────────────────────────────────────────
  -- Until now every seeded deal was a package or a city break, so five of the
  -- seven types the schema allows had never once been rendered. A product type
  -- with no rows is a product type nobody can see is broken.
  --
  -- Each one is given to the agency it actually suits: Coastline grew out of a
  -- cruise desk and says so on its profile, Jetaway would rather you rang them
  -- and sells the flight-only and tailor-made end, Sunseeker does the beach.

  -- CRUISE. No airports and no board in the package sense: full board is what a
  -- cruise fare means, and the "resort" is where it sails from.
  ('coastline-holidays','live','Cruise','CST-4001',
   'Western Mediterranean, 7 nights full board from Southampton',
   'Barcelona, Palma, Marseille and Genoa, no flying',
   -- The resort is a PORT OF CALL, not Southampton. Departure port belongs in
   -- the strapline: "Southampton, Spain" as a destination line is nonsense.
   'Spain','Western Mediterranean','Barcelona','MSC Virtuosa',4,8.1,'Onboard',
   'Full board','Inside cabin, twin',7,
   array[]::text[],null,'2027-04-10','2027-09-25',649,829,
   array['Sails from Southampton, no flights needed','Four ports in seven nights','All meals and entertainment included'],
   array['No fly'],array['Pools','Theatre','Kids club','Wi-Fi'],'manual'),

  ('coastline-holidays','live','Cruise','CST-4002',
   'Norwegian Fjords, 7 nights full board from Southampton',
   'Stavanger, Olden and Bergen, balcony cabins available',
   'Norway','Fjords','Bergen','Bolette',4,8.6,'Onboard',
   'Full board','Ocean view twin',7,
   array[]::text[],null,'2027-05-15','2027-08-28',899,1099,
   array['Three fjord ports','Smaller ship, no queues','All meals included'],
   array['Adults only'],array['Observation lounge','Spa','Wi-Fi'],'manual'),

  ('coastline-holidays','live','Cruise','CST-4003',
   'Caribbean fly-cruise, 14 nights full board',
   'Barbados return, with a night either side in a beach hotel',
   'Barbados','Caribbean','Bridgetown','Britannia',4,8.4,'Onboard',
   'Full board','Balcony cabin',14,
   array['Gatwick','Manchester'],'TUI Airways','2027-01-09','2027-03-20',1849,2199,
   array['Flights and transfers included','Balcony cabin as standard','Hotel night either side'],
   array['Five star'],array['Balcony','Pools','Speciality dining'],'manual'),

  -- ESCORTED TOUR. A guide, a coach and a fixed itinerary. Nights matter, board
  -- matters, there is no single hotel.
  ('coastline-holidays','live','Escorted tour','CST-4004',
   'Highlights of Italy, 10 nights half board escorted',
   'Rome, Florence, Venice and Lake Garda with a tour manager',
   'Italy','Northern Italy','Rome',null,4,8.7,'Inland',
   'Half board','Twin, hotels throughout',10,
   array['Gatwick'],'British Airways','2027-04-03','2027-10-16',1249,1499,
   array['Four cities, one unpacking','English speaking tour manager','All coach travel included'],
   array['Small group'],array['Guided tours','Half board','Wi-Fi'],'manual'),

  ('jetaway-travel','live','Escorted tour','JET-4005',
   'Vietnam and Cambodia, 14 nights escorted',
   'Hanoi to Angkor Wat, with Halong Bay overnight',
   'Vietnam','South East Asia','Hanoi',null,4,9.1,'Inland',
   'Half board','Twin, hotels throughout',14,
   array['Glasgow','Heathrow'],'Emirates','2027-01-16','2027-11-20',2395,null,
   array['Halong Bay overnight cruise','Small group, maximum 18','Internal flights included'],
   array['Once in a lifetime'],array['Guided','Internal flights','Half board'],'manual'),

  -- FLIGHT ONLY. No hotel, no nights, no board. This is the shape that broke the
  -- offer-cache title builder, so the seed carries it deliberately.
  ('jetaway-travel','live','Flight only','JET-4006',
   'Flights to Malaga from Glasgow, direct',
   'Return, hand luggage included',
   'Spain','Costa del Sol','Malaga',null,null,null,null,
   null,null,null,
   array['Glasgow'],'Jet2','2027-02-01','2027-06-30',89,null,
   array['Direct, no changes','Hand luggage included','Return fare'],
   array[]::text[],array[]::text[],'manual'),

  ('jetaway-travel','live','Flight only','JET-4007',
   'Flights to Alicante from Edinburgh, direct',
   'Return, morning outbound',
   'Spain','Costa Blanca','Alicante',null,null,null,null,
   null,null,null,
   array['Edinburgh'],'easyJet','2027-03-06','2027-07-24',74,109,
   array['Direct, no changes','Morning departure','Return fare'],
   array[]::text[],array[]::text[],'manual'),

  ('sunseeker-travel','live','Flight only','SUN-4008',
   'Flights to Dalaman from Manchester, direct',
   'Return, 20kg bag included',
   'Turkey','Turkish Riviera','Dalaman',null,null,null,null,
   null,null,null,
   array['Manchester'],'Jet2','2027-05-01','2027-09-30',179,null,
   array['Direct, no changes','20kg hold bag included','Return fare'],
   array[]::text[],array[]::text[],'manual'),

  -- HOTEL ONLY. Nights and board, but the traveller sorts their own flights, so
  -- no airports and no airline.
  ('sunseeker-travel','live','Hotel only','SUN-4009',
   'Sol Pelicanos Ocean, Benidorm, 7 nights all inclusive, room only booking',
   'Room only booking, arrange your own flights',
   'Spain','Costa Blanca','Benidorm','Sol Pelicanos Ocean',3,7.9,'200m',
   'All inclusive','Twin room, side sea view',7,
   array[]::text[],null,'2026-11-01','2027-03-28',219,289,
   array['Book the room, sort your own flights','Two minutes from Levante beach','All inclusive board'],
   array[]::text[],array['Outdoor pool','Rooftop terrace','Wi-Fi'],'manual'),

  ('coastline-holidays','live','Hotel only','CST-4010',
   'Riad Anaya, Marrakech, 4 nights bed and breakfast, room only booking',
   'Rooftop plunge pool, ten minutes from the Medina',
   'Morocco','Marrakech','Marrakech','Riad Anaya',4,9.2,'Inland',
   'Bed & breakfast','Courtyard double',4,
   array[]::text[],null,'2026-10-10','2027-04-30',185,null,
   array['Book the room, sort your own flights','Rooftop plunge pool','Airport transfer included'],
   array['Highly rated'],array['Plunge pool','Courtyard','Breakfast'],'manual'),

  -- FLIGHT + HOTEL. What a dynamic package is. Priced together, sold together,
  -- but it is not an operator package holiday and the schema says so.
  ('sunseeker-travel','live','Flight + hotel','SUN-4011',
   'Melia Costa del Sol, Torremolinos, 7 nights half board with flights',
   'Put together for you, flights and hotel booked as one',
   'Spain','Costa del Sol','Torremolinos','Melia Costa del Sol',4,8.2,'Beachfront',
   'Half board','Double, sea view',7,
   array['Birmingham','Manchester'],'Ryanair','2026-10-17','2027-04-24',379,479,
   array['Flights and hotel booked together','Beachfront, right on the promenade','Half board included'],
   array[]::text[],array['Beachfront','Pool','Wi-Fi'],'live_cache'),

  ('jetaway-travel','live','Flight + hotel','JET-4012',
   'Hotel Borealis, Reykjavik, 3 nights bed and breakfast with flights',
   'Northern lights season, small hotel near the harbour',
   'Iceland','Reykjanes','Reykjavik','Hotel Borealis',3,8.8,'Inland',
   'Bed & breakfast','Double room',3,
   array['Glasgow','Edinburgh'],'easyJet','2026-11-07','2027-03-14',449,null,
   array['Flights and hotel booked together','Northern lights season','Ten minutes from the harbour'],
   array['Northern lights'],array['Breakfast','Wi-Fi'],'live_cache')
) as v(slug, status, holiday_type, reference, title, strapline,
       country, region, resort, hotel, stars, score,
       beach, board, room, nights, airports, airline,
       travel_from, travel_until, price, was,
       points, badges, facilities, source)
join public.agents a on a.slug = v.slug;

-- ── the remaining detail ────────────────────────────────────────────────────
-- None of this affects the live-deal constraint, so it is applied in one pass
-- rather than repeated across thirty-odd rows above.
update public.deals d
   set availability_type   = 'range',
       -- A discounted deal reads as selling, which is the honest signal here.
       availability_status = case when d.status = 'live' and d.was_price is not null
                                  then 'Limited' else 'Available' end,
       deposit_from     = case when d.price_from >= 500 then 99 else 49 end,
       price_includes   = array['Return flights', 'Hold luggage', 'Airport transfers', 'ATOL protection'],
       transfers        = 'Return airport transfers included',
       -- Always in the future, and never after the holiday it applies to.
       booking_deadline = least(d.travel_from - 14, current_date + 60),
       published_at     = case when d.status = 'live'
                               then now() - (interval '1 day' * (5 + (abs(hashtext(d.reference)) % 40)))
                               else null end
 where d.agent_id in (select id from public.agents where slug in ('sunseeker-travel','coastline-holidays','jetaway-travel'));

-- Two deals that deliberately disagree with their agency, so the per-deal
-- override is something you can point at rather than describe. A long-haul trip
-- is the sort people ring about; a cheap city break is pure click-through.
update public.deals set billing_mode = 'both'  where reference = 'SUN-1010';
update public.deals set billing_mode = 'click' where reference = 'CST-2010';

-- ── 30 days of traffic ──────────────────────────────────────────────────────
-- Only live deals earn impressions: a draft is not on the site to be seen.
--
-- Each deal gets a popularity and a click-through rate derived from a hash of
-- its own id, so the spread looks organic but the same seed always produces the
-- same demo. Weekends run hotter, which is when people browse holidays.
insert into public.deal_daily_stats (deal_id, agent_id, stat_date, impressions, clicks)
select p.deal_id, p.agent_id, d.day::date, v.imp,
       -- Clicks are DERIVED from impressions, never chosen independently, so the
       -- click-through rate is always a real ratio.
       greatest(0, round(v.imp * p.ctr_bp / 10000.0))::int
  from (
    select dl.id as deal_id, dl.agent_id, dl.reference,
           -- SIZED AGAINST A REAL EXPECTATION, not against what looks impressive.
           -- The figure at launch is no more than 100 CHARGEABLE events per
           -- agency per week, mixed across clicks, calls and enquiries. This was
           -- four times that, so the demo dashboard showed a bill four times too
           -- big, which oversells the cost of the platform to an agency.
           --
           -- Everything downstream is derived from impressions, so this range is
           -- the only dial: change it and clicks, calls, enquiries and the bill
           -- all move together and stay in proportion.
           12 + (abs(hashtext(dl.reference || 'pop')) % 45) as base_imp,
           160 + (abs(hashtext(dl.reference || 'ctr')) % 290) as ctr_bp  -- 1.60% to 4.49%
      from public.deals dl
     where dl.status = 'live'
       and dl.agent_id in (select id from public.agents where slug in ('sunseeker-travel','coastline-holidays','jetaway-travel'))
  ) p
  cross join generate_series(current_date - 29, current_date, interval '1 day') as d(day)
  cross join lateral (
    select greatest(6, round(
             p.base_imp
             * (70 + (abs(hashtext(p.reference || d.day::text)) % 61)) / 100.0   -- 0.70 to 1.30
             * (case when extract(dow from d.day) in (0, 6) then 1.28 else 1.0 end)
           ))::int as imp
  ) v;

-- ── the click events behind those numbers ───────────────────────────────────
-- EXPANDED FROM the daily table, one row per counted click, so the two never
-- disagree. tb_agent_stats reads clicks from deal_daily_stats and billable
-- clicks from here, and inventing them separately is what produced an
-- impossible click-through rate the first time this was seeded.
--
-- Roughly one click in eight is not billable: a repeat from the same visitor
-- inside the 30 minute window, or something that looked automated. The agency
-- still sees it, they are simply not charged twice.
--
-- Every per-event value is keyed on the DATE as well as the deal and the index.
-- Without the date a deal with one click a day gets the same hour, the same
-- browser and the same billable answer on all thirty days, which shows up as
-- whole deals earning nothing rather than the odd repeat visitor.
insert into public.click_events
  (deal_id, agent_id, occurred_at, surface, ip_hash, ua_family, referrer_host, country_code, is_billable)
select s.deal_id, s.agent_id,
       s.stat_date
         + (interval '1 hour'   * (7 + (abs(hashtext(d.reference || s.stat_date::text || g::text || 'h')) % 15)))
         + (interval '1 minute' * (abs(hashtext(d.reference || s.stat_date::text || g::text || 'm')) % 60)),
       case when (abs(hashtext(d.reference || s.stat_date::text || g::text || 's')) % 5) = 0 then 'widget' else 'site' end,
       -- The shape the real recorder writes: a salted hash truncated to 40 chars,
       -- never an IP address.
       substr(encode(sha256(convert_to('demo-seed' || d.reference || s.stat_date::text || g::text, 'UTF8')), 'hex'), 1, 40),
       (array['chrome','chrome','chrome','safari','safari','edge','firefox','samsung'])
         [1 + (abs(hashtext(d.reference || s.stat_date::text || g::text || 'ua')) % 8)],
       (array['google.com','google.com','facebook.com',null,'bing.com','sunseekertravel.co.uk'])
         [1 + (abs(hashtext(d.reference || s.stat_date::text || g::text || 'r')) % 6)],
       'GB',
       (abs(hashtext(d.reference || s.stat_date::text || g::text || 'b')) % 8) <> 0
  from public.deal_daily_stats s
  join public.deals d on d.id = s.deal_id
  cross join generate_series(1, s.clicks) as g
 where s.clicks > 0
   and s.agent_id in (select id from public.agents where slug in ('sunseeker-travel','coastline-holidays','jetaway-travel'));

-- ── phone enquiries ─────────────────────────────────────────────────────────
-- A call-first agency's cards show a number rather than a booking link, so they
-- should not be accruing click-throughs at all. Clearing them is what makes the
-- dashboard read honestly for Jetaway.
delete from public.click_events
 where event_type = 'click'
   and agent_id in (select id from public.agents where billing_mode = 'call');

update public.deal_daily_stats s set clicks = 0
  from public.agents a
 where a.id = s.agent_id and a.billing_mode = 'call';

-- Calls run at a much lower rate than clicks, because ringing someone is a
-- bigger step than clicking. Only deals whose RESOLVED mode includes calls earn
-- any, which is what makes the per-deal override visible in the figures.
update public.deal_daily_stats s
   set calls = greatest(0, round(s.impressions
         * (30 + (abs(hashtext(d.reference || 'callrate')) % 70)) / 10000.0))::int
  from public.deals d
  join public.agents a on a.id = d.agent_id
 where d.id = s.deal_id
   and coalesce(d.billing_mode, a.billing_mode) in ('call', 'both');

-- An agency that sells on the phone converts phone enquiries better than one
-- that merely accepts them.
update public.deal_daily_stats s
   set calls = greatest(1, round(s.calls * 2.4))::int
  from public.deals d
  join public.agents a on a.id = d.agent_id
 where d.id = s.deal_id and coalesce(d.billing_mode, a.billing_mode) = 'call';

-- Expanded from the daily counts for the same reason clicks are: the two must
-- never disagree.
--
-- BILLABLE MEANS DELIBERATE, NOT ANSWERED. We do not own the agency's phone
-- number, so we never learn whether the call connected or how long it lasted.
-- What we can see is that somebody pressed the button, which is the charge.
-- call_seconds and call_connected stay NULL for exactly that reason: seeding
-- them would imply a capability the platform does not have.
--
-- Roughly one call in eight is the same person coming back for a number they
-- lost. Recorded so the agency sees it, charged once. Keyed on the date as well
-- as the deal, for the same reason the clicks above are.
--
-- WHEN a call happens matters now, so the hour is drawn from a WEIGHTED spread
-- rather than a flat one. Most people ring a travel agent during the working
-- day, with a tail into the evening. A flat 8am-to-10pm spread put 62% of
-- Jetaway's calls outside their own opening hours, which is not a number any real
-- agency would recognise and would have undersold the product on a demo.
--
-- OUT OF HOURS IS ASKED OF tb_agent_is_open, not worked out here. The seed uses
-- the same function the live code uses, so the demo cannot show a pattern the real
-- billing rule would not produce.
--
-- AND MOST OUT-OF-HOURS CALLS ARE DROPPED, because of what the site does. Under
-- the default "leave us a message" setting a closed shop shows NO call button at
-- all, so those people leave their details instead. Jetaway is on that setting,
-- so the few out-of-hours calls it does take are the ones that came through the
-- widget on somebody else's site, or from a page left open. Keeping one in three
-- is the honest shape.
--
-- WHEN THEY DO HAPPEN THEY ARE CHARGED FOR, whatever the hour. Andy's rule: the
-- agency decides whether a call can happen, by setting hours and choosing what to
-- show; we do not decide afterwards what the call was worth.
with raw as (
  select s.deal_id, s.agent_id, s.stat_date, d.reference, g,
         abs(hashtext(d.reference || s.stat_date::text || g::text || 'ch')) as h,
         s.stat_date
           + (interval '1 hour' *
               (array[9,10,10,11,11,12,12,13,14,14,15,15,16,16,17,18,19,20])
                 [1 + (abs(hashtext(d.reference || s.stat_date::text || g::text || 'ch')) % 18)])
           + (interval '1 minute' * (abs(hashtext(d.reference || s.stat_date::text || g::text || 'cm')) % 60))
           as occurred_at
    from public.deal_daily_stats s
    join public.deals d on d.id = s.deal_id
    cross join generate_series(1, s.calls) as g
   where s.calls > 0
),
stamped as (
  select r.*, not public.tb_agent_is_open(r.agent_id, r.occurred_at) as shut from raw r
),
kept as (
  select * from stamped where not shut or (h % 3) = 0
)
insert into public.click_events
  (deal_id, agent_id, occurred_at, surface, ip_hash, ua_family, referrer_host, country_code,
   is_billable, event_type, call_seconds, call_connected, caller_hash, out_of_hours)
select deal_id, agent_id, occurred_at,
       case when (abs(hashtext(reference || stat_date::text || g::text || 'cs')) % 6) = 0 then 'widget' else 'site' end,
       substr(encode(sha256(convert_to('demo-call' || reference || stat_date::text || g::text, 'UTF8')), 'hex'), 1, 40),
       (array['chrome','chrome','safari','safari','safari','edge'])
         [1 + (abs(hashtext(reference || stat_date::text || g::text || 'cua')) % 6)],
       (array['google.com','google.com','facebook.com',null])
         [1 + (abs(hashtext(reference || stat_date::text || g::text || 'cr')) % 4)],
       'GB',
       -- Deliberate is the whole test. A repeat visitor is not charged for; the
       -- hour of the day has nothing to do with it.
       (abs(hashtext(reference || stat_date::text || g::text || 'cb')) % 8) <> 0,
       'call', null, null,
       substr(encode(sha256(convert_to('caller' || reference || stat_date::text || g::text, 'UTF8')), 'hex'), 1, 40),
       shut
  from kept;

-- THE DAILY COUNTER IS NOW RECOMPUTED FROM THE EVENTS, not the other way round.
-- Dropping out-of-hours calls above means the count the events add up to is no
-- longer the count the counter was seeded with, and the two disagreeing is the
-- exact bug that produced a 350% click-through rate the first time this was
-- written. Deriving one from the other makes them equal by construction rather
-- than by care.
update public.deal_daily_stats s
   set calls = coalesce((
         select count(*) from public.click_events e
          where e.deal_id = s.deal_id and e.event_type = 'call'
            and e.occurred_at::date = s.stat_date
       ), 0)
 where s.agent_id in (select id from public.agents where slug in ('sunseeker-travel','coastline-holidays','jetaway-travel'));

-- ── callback requests ───────────────────────────────────────────────────────
-- A bigger ask of the traveller than tapping a number, and a better lead for the
-- agency, so they run at roughly a fifth of the rate.
update public.deal_daily_stats s
   set leads = case when (abs(hashtext(d.reference || s.stat_date::text || 'ld')) % 5) = 0
                    then greatest(1, round(s.calls * 0.3))::int else 0 end
  from public.deals d join public.agents a on a.id = d.agent_id
 where d.id = s.deal_id
   and coalesce(d.billing_mode, a.billing_mode) in ('call', 'both')
   and s.calls > 0;

-- Some leave a phone number, some an email, some both. That mix is the point:
-- refusing the ones who would rather be emailed loses the enquiry.
--
-- Phone numbers come from Ofcom's reserved drama range (07700 900xxx) and emails
-- are on example.co.uk, so nothing in this demo can ever ring or email a real
-- person.
with gen as (
  select s.deal_id, s.agent_id, s.stat_date, d.title, d.reference, g,
         abs(hashtext(d.reference || s.stat_date::text || g::text || 'lead')) as h
    from public.deal_daily_stats s
    join public.deals d on d.id = s.deal_id
    cross join generate_series(1, s.leads) as g
   where s.leads > 0
)
insert into public.leads
  (agent_id, deal_id, deal_title, name, phone, email, message, preferred_time,
   status, contacted_at, ip_hash, ua_family, referrer_host, country_code, created_at)
select agent_id, deal_id, title,
       (array['Sarah Whitfield','Tom Ashby','Priya Nair','Gareth Lloyd','Denise Okafor',
              'Michael Brennan','Aisha Rahman','Colin Fraser','Hannah Piper','Raj Chandra'])[1 + (h % 10)],
       case when h % 4 = 0 then null
            else '07700 900' || lpad(((h / 7) % 1000)::text, 3, '0') end,
       case when h % 3 = 0 or h % 4 = 0
            then lower(replace((array['sarah.w','t.ashby','p.nair','g.lloyd','d.okafor',
                                      'm.brennan','a.rahman','c.fraser','h.piper','r.chandra'])[1 + (h % 10)], ' ', ''))
                 || '@example.co.uk'
            else null end,
       (array['Is late July still available for four of us?',
              'Could you do a room with a sea view?',
              'We have a toddler, is there a cot?',
              null, null,
              'What is the deposit and when is the balance due?'])[1 + (h % 6)],
       (array['Evenings after 6', 'Weekends', null, null, 'Any time', 'Mornings'])[1 + ((h / 3) % 6)],
       (array['new','new','contacted','contacted','booked','not_interested','junk','contacted'])[1 + ((h / 11) % 8)],
       case when ((h / 11) % 8) > 1 then stat_date + interval '4 hours' else null end,
       substr(encode(sha256(convert_to('leadip' || reference || stat_date::text || g::text, 'UTF8')), 'hex'), 1, 40),
       'chrome', 'google.com', 'GB',
       -- Spread across the day and into the evening, because that is when
       -- somebody who cannot ring leaves their details instead.
       stat_date + (interval '1 hour' * (9 + (h % 13)))
                 + (interval '1 minute' * ((h / 5) % 60))
  from gen;

-- The billable event behind each enquiry, so the inbox and the meter agree.
--
-- ALWAYS BILLABLE, INCLUDING OUT OF HOURS, and that is the point of the whole
-- feature rather than an oversight. A callback left at nine at night is the
-- enquiry that would otherwise have been lost: it arrives with a name and a way
-- to reply, and it is worth more to the agency than a ring into an empty shop.
-- out_of_hours is still recorded, because "most of my enquiries come in the
-- evening" is worth an agency knowing.
insert into public.click_events
  (deal_id, agent_id, occurred_at, surface, ip_hash, ua_family, referrer_host, country_code,
   is_billable, event_type, caller_hash, out_of_hours)
select l.deal_id, l.agent_id, l.created_at, 'site', l.ip_hash, l.ua_family, l.referrer_host, 'GB',
       true, 'lead',
       substr(encode(sha256(convert_to('contact' || coalesce(l.phone, l.email), 'UTF8')), 'hex'), 1, 40),
       not public.tb_agent_is_open(l.agent_id, l.created_at)
  from public.leads l;

-- ── what each event was worth, and what it cost ─────────────────────────────
-- The events above are inserted DIRECTLY rather than through tb_record_click, so
-- nothing has priced them. Without this a freshly seeded demo shows a cost panel
-- full of zeroes, which reads as "the platform earns nothing".
--
-- One premium agency and one on a free run first, so the demo shows both tiers
-- and both billing states rather than three identical accounts.
update public.agents set rate_tier  = 'premium'        where slug = 'coastline-holidays';
update public.agents set free_until = current_date + 60 where slug = 'jetaway-travel';
update public.agents set free_until = null              where slug in ('sunseeker-travel','coastline-holidays');

-- INVENTED DATA ON A DEVELOPMENT DATABASE. No agency has been billed for any of
-- it. Live events price themselves as they happen and are never rewritten.
update public.click_events c
   set list_pence    = (public.tb_resolve_rate(c.agent_id, d.holiday_type, c.event_type)->>'pence')::int,
       charged_pence = case
         when not c.is_billable then 0
         when coalesce((public.tb_resolve_rate(c.agent_id, d.holiday_type, c.event_type)->>'free')::boolean, false) then 0
         else (public.tb_resolve_rate(c.agent_id, d.holiday_type, c.event_type)->>'pence')::int
       end,
       free_period = coalesce((public.tb_resolve_rate(c.agent_id, d.holiday_type, c.event_type)->>'free')::boolean, false),
       rate_tier   = public.tb_resolve_rate(c.agent_id, d.holiday_type, c.event_type)->>'tier',
       rate_source = public.tb_resolve_rate(c.agent_id, d.holiday_type, c.event_type)->>'source'
  from public.deals d
 where d.id = c.deal_id
   and c.agent_id in (select id from public.agents where slug in ('sunseeker-travel','coastline-holidays','jetaway-travel'));

-- ── a little import history ─────────────────────────────────────────────────
-- So the "Recent imports" panel has something to show, matching how the deals
-- above were actually sourced.
insert into public.import_runs
  (agent_id, source, filename, rows_total, created_count, updated_count, skipped_count, failed_count, problems, created_at)
select a.id, r.source, r.filename, r.total, r.created, r.updated, r.skipped, r.failed,
       r.problems::jsonb, now() - (interval '1 day' * r.days_ago)
from (values
  ('sunseeker-travel','spreadsheet','autumn-winter-deals.csv',   9, 9, 0, 0, 0, '[]', 12),
  ('sunseeker-travel','spreadsheet','price-update-october.csv',  9, 0, 8, 1, 0,
   '[{"row":6,"message":"Nothing in this row differs from what we already hold."}]', 4),
  ('coastline-holidays','live_cache', null,                      5, 5, 0, 0, 0, '[]', 9),
  ('coastline-holidays','live_cache','resync',                   5, 0, 5, 0, 0, '[]', 1),
  ('coastline-holidays','spreadsheet','city-breaks.csv',         3, 2, 0, 0, 1,
   '[{"row":4,"message":"Deal title is required"}]', 6)
) as r(slug, source, filename, total, created, updated, skipped, failed, problems, days_ago)
join public.agents a on a.slug = r.slug;

commit;

-- ── sign-in, set separately ─────────────────────────────────────────────────
-- Deliberately NOT part of the seed: a working credential must not live in the
-- repo. Run this once after seeding, with a password of your choosing, to be
-- able to open the three advertiser dashboards.
--
-- pgcrypto's bcrypt output ($2a$, cost 10) is the same format bcryptjs verifies
-- on the login path, so hashing in the database and checking in Node agree.
-- Verified rather than assumed.
--
--   update public.agents
--      set password_hash = extensions.crypt('<choose-a-password>', extensions.gen_salt('bf', 10))
--    where slug in ('sunseeker-travel', 'coastline-holidays', 'jetaway-travel');
--
-- These are demo accounts on the development database holding invented data.
-- Clear the hashes before anything is exposed publicly:
--
--   update public.agents set password_hash = null
--    where slug in ('sunseeker-travel', 'coastline-holidays', 'jetaway-travel');
