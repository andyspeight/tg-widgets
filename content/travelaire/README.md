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
- `widget-rows.json` is the Airtable Widgets payload for the four live offer
  pages, with the widget and record ids they were created under.

```
npm run build:travelaire-offers   # JSON to CSV
npm run test:travelaire-offers    # 89 checks, keeps the pair honest
```

The test proves the CSV is still in step with the JSON, that the editor's own
importer takes it with no row errors, and that every offer clears the
server-side whitelist in `api/saved-offers.js` unchanged (field pattern, the
5,000 character field cap, the 48KB record cap). It also holds the no-em-dash
brand rule.

## They are live in the account

Created 10 September 2026 in the Airtable Widgets table (`tblVAThVqAjqtria2`),
owned by client record `recWGiXycDnxd8Zsh`, Status Active. Each row carries the
whole offer in its Config, so `widget-offer-page.js` renders a complete offer
page from the widget id alone. Same pattern as the two GLOBAL TRAVEL SOLUTION
Escorted Tour rows from August 2026: the trip lives in the config, not in a
feed, so publishing one needs no signed-in session.

| Offer | Widget ID | Airtable record |
|-------|-----------|-----------------|
| Red Sea and Umrah | `tgw_1789049614480_w2swqe` | recmbQo6yNzficvnm |
| Qatar | `tgw_1789049614481_g7i4oi` | recYA7CQDyjAz82FR |
| Doha, Madinah and Makkah | `tgw_1789049614482_1w84nb` | recOhe9SOOSqaNK79 |
| Zanzibar | `tgw_1789049614483_aa8yuh` | reccSyBeZf8iDD0zp |

Embed code, one per offer:

```html
<div data-tg-widget="offer-page" data-tg-id="tgw_1789049614480_w2swqe"></div>
<script src="https://tg-widgets.vercel.app/widget-offer-page.js" defer></script>
```

Verified end to end on 10 September 2026: the deployed widget script was run
against the four live configs fetched from `/api/widget-config`, and all four
mount with every section present (About this holiday, Itinerary, Highlights,
the country section, What's included, The detail), the enquiry form, the
client's navy and bronze branding and the ATOL badge. No console errors.

`npm run build:travelaire-offers && node scripts/build-offer-widgets.cjs
content/travelaire/offers-sep-2026.json content/travelaire/widget-rows.json`
regenerates the payloads if an offer changes. Writing them to Airtable stays a
separate, deliberate step so a rebuild never touches a live client account.

### Enquiry routing

An offer held in a widget config has no record in the saved-offers feed, so the
enquiry endpoint used to fall through to `CONTACT_TO` and land the lead with
Travelgenix rather than the client. `api/offer-enquiry.js` now resolves the
recipient from the widget's own config server-side, the way `api/trip-enquiry.js`
does, and the page posts its widget id. Held by
`npm run test:offer-enquiry-routing`, including that a browser-supplied address
is still never honoured. This ships on the next deploy of `main`; until then the
phone number and the offer email on the page work as normal.

### The offers grid

The Special Offers grid reads its cards from the saved-offers feed, which is
per-client Redis written only through an authenticated save. To put these four
in a grid as well, sign in, switch client to Halal World Travel, open Special
Offers and import `offers-sep-2026.csv`. The four pages above are unaffected
either way.

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
