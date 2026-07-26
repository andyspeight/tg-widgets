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
-- Jetaway's shorter qualifying length against Coastline's 90 seconds is what
-- makes the "only proven calls are charged for" rule visible in the figures.
update public.agents set billing_mode = 'click' where slug = 'sunseeker-travel';
update public.agents set billing_mode = 'call',  call_min_seconds = 60 where slug = 'jetaway-travel';
update public.agents set billing_mode = 'both',  call_min_seconds = 90 where slug = 'coastline-holidays';

-- ── clear what this seed owns ───────────────────────────────────────────────
-- Scoped to the demo agents. click_events and deal_daily_stats cascade from
-- deals, but they are cleared explicitly so the intent is obvious.
delete from public.click_events     where agent_id in (select id from public.agents where slug in ('sunseeker-travel','coastline-holidays','jetaway-travel'));
delete from public.deal_daily_stats where agent_id in (select id from public.agents where slug in ('sunseeker-travel','coastline-holidays','jetaway-travel'));
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
   array[]::text[],array[]::text[],array['Old town','Breakfast'],'manual')
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
           45 + (abs(hashtext(dl.reference || 'pop')) % 180) as base_imp,
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
insert into public.click_events
  (deal_id, agent_id, occurred_at, surface, ip_hash, ua_family, referrer_host, country_code, is_billable)
select s.deal_id, s.agent_id,
       s.stat_date
         + (interval '1 hour'   * (7 + (abs(hashtext(d.reference || g::text || 'h')) % 15)))
         + (interval '1 minute' * (abs(hashtext(d.reference || g::text || 'm')) % 60)),
       case when (abs(hashtext(d.reference || g::text || 's')) % 5) = 0 then 'widget' else 'site' end,
       -- The shape the real recorder writes: a salted hash truncated to 40 chars,
       -- never an IP address.
       substr(encode(sha256(convert_to('demo-seed' || d.reference || s.stat_date::text || g::text, 'UTF8')), 'hex'), 1, 40),
       (array['chrome','chrome','chrome','safari','safari','edge','firefox','samsung'])
         [1 + (abs(hashtext(d.reference || g::text || 'ua')) % 8)],
       (array['google.com','google.com','facebook.com',null,'bing.com','sunseekertravel.co.uk'])
         [1 + (abs(hashtext(d.reference || g::text || 'r')) % 6)],
       'GB',
       (abs(hashtext(d.reference || g::text || 'b')) % 8) <> 0
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
-- never disagree. Roughly one call in six rings out, and of those answered some
-- are a quick availability check rather than a real enquiry, so `is_billable`
-- is computed with the SAME rule tb_record_click applies — connected, and past
-- the agency's own qualifying length. Coastline's 90 seconds against Jetaway's
-- 60 is why their billable share is visibly lower.
insert into public.click_events
  (deal_id, agent_id, occurred_at, surface, ip_hash, ua_family, referrer_host, country_code,
   is_billable, event_type, call_seconds, call_connected, caller_hash)
select s.deal_id, s.agent_id,
       s.stat_date
         + (interval '1 hour'   * (9 + (abs(hashtext(d.reference || g::text || 'ch')) % 9)))
         + (interval '1 minute' * (abs(hashtext(d.reference || g::text || 'cm')) % 60)),
       case when (abs(hashtext(d.reference || g::text || 'cs')) % 6) = 0 then 'widget' else 'site' end,
       substr(encode(sha256(convert_to('demo-call' || d.reference || s.stat_date::text || g::text, 'UTF8')), 'hex'), 1, 40),
       (array['chrome','chrome','safari','safari','safari','edge'])
         [1 + (abs(hashtext(d.reference || g::text || 'cua')) % 6)],
       (array['google.com','google.com','facebook.com',null])
         [1 + (abs(hashtext(d.reference || g::text || 'cr')) % 4)],
       'GB',
       v.connected and v.secs >= a.call_min_seconds,
       'call', v.secs, v.connected,
       -- The caller's number would be hashed and salted exactly like the IP.
       substr(encode(sha256(convert_to('caller' || d.reference || s.stat_date::text || g::text, 'UTF8')), 'hex'), 1, 40)
  from public.deal_daily_stats s
  join public.agents a on a.id = s.agent_id
  join public.deals d on d.id = s.deal_id
  cross join generate_series(1, s.calls) as g
  cross join lateral (
    select
      (abs(hashtext(d.reference || g::text || 'conn')) % 6) <> 0        as connected,
      (15 + (abs(hashtext(d.reference || g::text || 'secs')) % 400))    as secs
  ) v
 where s.calls > 0
   and s.agent_id in (select id from public.agents where slug in ('sunseeker-travel','coastline-holidays','jetaway-travel'));

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
