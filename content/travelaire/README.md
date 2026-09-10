# Travelaire / Halal World Travel: four custom offers (10 Sep 2026)

Four hand-built Special Offers, written from Andy's brief of 10 September 2026
and researched against the actual hotels, airline routes and destinations.

The account is the Airtable client record `recWGiXycDnxd8Zsh`, owner
`romina@travelaire.co.uk`, trading as **Halal World Travel** (Ignite plan, active).
That is also what "Exclusive to HWT" in offer three refers to.

| # | Offer | Nights | Price | Reference |
|---|-------|--------|------|-----------|
| 1 | Red Sea and Umrah in Jeddah, Makkah and Madinah | 14 | £2,495pp | HWT-SA-NOV26 |
| 2 | Qatar, desert villa and private island | 10 | £1,850pp | HWT-QA-JAN27 |
| 3 | Doha, Madinah and Makkah with Saudia | 13 | £1,650pp | HWT-QA-SA-MAR27 |
| 4 | Zanzibar, two coasts on half board | 10 | £1,700pp | HWT-ZNZ-10 |

All prices are per person based on two people sharing, as briefed.

## Files

- `offers-sep-2026.json` is the source of truth. Same shape as the bulk-import
  body `/api/saved-offers` takes: `{ offers: [ { currency, fields, includes,
  tags, images } ] }`.
- `offers-sep-2026.csv` is generated from the JSON, in the exact Special Offers
  import template. Do not hand-edit it; edit the JSON and rebuild.

```
npm run build:travelaire-offers   # JSON to CSV
npm run test:travelaire-offers    # 89 checks, keeps the pair honest
```

The test proves the CSV is still in step with the JSON, that the editor's own
importer takes it with no row errors, and that every offer clears the
server-side whitelist in `api/saved-offers.js` unchanged (field pattern, the
5,000 character field cap, the 48KB record cap). It also holds the no-em-dash
brand rule.

## Getting them into the account

Import `offers-sep-2026.csv` through the editor:

1. Sign in at `https://tg-widgets.vercel.app` as staff.
2. **Switch client to Halal World Travel first.** Offers save against whichever
   client the session is on, and the staff switcher reissues the session with
   the new client id (`api/auth/switch-client.js`), so this decides where they
   land.
3. Open **Special Offers** (`/editor-offer-builder`).
4. **Import**, upload the CSV, **Import 4 offers**.

Every row has a blank Offer ID, so each one creates a new offer and nothing
existing can be overwritten.

Once imported they behave natively: editable in the builder workspace, each with
its own page at `/offer/<slug>-<id>`, picked up by the Special Offers grid, and
enquiries routed to `info@halalworldtravel.com` from the stored `enquiryEmail`.

### Why there is a manual step, and one approach that did not work

Offers live in per-client Redis (`offers:idx:c:<clientId>`) and the only way in
is `POST /api/saved-offers`, behind `requireAuth`. That accepts a Bearer JWT or
the `tg_session` cookie and nothing else, both signed with `TG_SESSION_SECRET`
(`api/_auth.js:217`). There is no API-key or service path, so an agent with
Airtable access alone cannot seed a client's feed. The import is the route.

On 10 Sep 2026 this was first attempted by copying the GLOBAL TRAVEL SOLUTION
pattern: one Widgets row per trip with the whole thing authored in the row's
Config, which is how the two Escorted Tour rows from Aug 2026 work. That does
not carry over. Escorted Tour is one trip per widget authored in config, but
Special Offers is a pool of offers in the client's feed plus a grid that
displays them, and the builder loads its workspace from `/api/saved-offers`
(`public/editor-offer-builder.html:648`) without ever reading the widget config.
So the four rows rendered standalone pages but showed as empty shells in the
editor, and they were deleted the same day. Do not repeat it: for anything in
the Special Offers family, the feed is the only home.

## Assumptions, and the fields left blank on purpose

Confirmed with Andy: departure is **London Heathrow** on all four, and the LXR
property in offer three is **The Plaza Doha**.

- **"Book before 31st Sept" is set to 30 September 2026.** September has thirty
  days. Offer one also carries `showUntil: 2026-09-30`, so it takes itself off
  the site the day after the book-by date.
- **Offer four has no travel period.** The brief gave no month, so the field is
  empty rather than invented. Worth filling before it goes live: Etihad's Abu
  Dhabi to Zanzibar service runs daily from 25 October 2026 and twice daily from
  1 December 2026, so a winter date is the natural fit.
- **No photos.** Rather than point at image URLs nobody has cleared, `images` is
  empty on all four and the cards fall back to their gradient placeholder. Add
  photos per offer in the builder's Photos step.
- **No latitude or longitude.** `mapAddress` is filled on each offer; opening
  the offer in the builder and running the map lookup geocodes it exactly. A
  guessed pin would have been worse than none.
- **No "was" prices.** None were briefed, so none are claimed.
- **Transfers only where they were briefed.** Offers one and two say transfers
  are included and their copy says so. Offers three and four did not, so neither
  the includes list nor the itinerary mentions them.
- **Offer one's board is a sentence,** "All inclusive in Jeddah, breakfast in
  Makkah and Madinah", because the trip is genuinely split and a single board
  code would have misdescribed half of it.

## What the research established

- **Rixos Obhur Jeddah Resort & Villas**, Jeddah's first luxury all inclusive
  resort, on Obhur Bay, 250 rooms and villas, private beach, spa, kids' club,
  daily live show, about 26km from King Abdulaziz International Airport.
- **Hilton Suites Jabal Omar Makkah**, roughly 300m from Masjid al-Haram, four
  to five minutes on foot to the King Fahad gate.
- **InterContinental Dar Al Hijra Madinah**, 231 rooms, about 300m from Masjid
  an-Nabawi, city and Mount Uhud views, Al Safa restaurant.
- **The Outpost Al Barari**, 21 tented villas, most with private pools, inside
  the Khor Al Adaid (Inland Sea) reserve at Mesaieed, about 66km south of Hamad
  International. Farm-to-table dining, desert spa, dune buggies, camel rides.
- **The Ritz-Carlton, Doha**, private island in West Bay Lagoon, private beach,
  235-berth marina, spa, Ritz Kids.
- **The Plaza Doha, LXR Hotels & Resorts**, central Doha near the National
  Museum, indoor and outdoor pools, wellness centre, three restaurants.
- **Pullman ZamZam Madinah**, about 150m from Masjid an-Nabawi and the Rawdah.
- **Jabal Omar Marriott Hotel Makkah**, 426 rooms over 22 floors, a three
  minute walk to the King Fahad gate, many rooms overlooking Masjid Al Haram.
- **Sea Cliff Resort & Spa Zanzibar**, Mangapwani on the north west coast, 120
  rooms on a cliff above the Indian Ocean, infinity pools, Zuri Rituals spa,
  horse riding and Zanzibar's only golf course. Stone Town about 25 minutes.
- **LUX\* Marijani Zanzibar**, Pwani Mchangani on the north east coast, 82
  rooms, private beach, infinity pool, two restaurants, LUX\* ME Spa.
- **Routes.** Etihad serves Jeddah and Madinah via Abu Dhabi, and Abu Dhabi to
  Zanzibar daily from 25 October 2026. Qatar Airways flies London Heathrow to
  Doha direct in under seven hours. Saudia sells London Heathrow to Doha.
