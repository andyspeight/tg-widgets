# Autocomplete translation proxy — MVP spec

Status: MVP, first cut 10 July 2026. Owner: Andy Speight.

## The problem in one line

A customer typing a place name in their own language (Romanian "Londra")
should get the right Travelify match (London), and see the results back in
their own language, without us pre translating a million location names.

## Who does what

- **The search box** is Travelify's own widget. We are not building it and we
  are not changing how it looks or behaves. For the MVP we use a small throwaway
  test box instead, purely so there is something to type into.
- **The translator** (this project) is a small server endpoint that sits between
  the box and Travelify. The box asks it for matches, it swaps the typed word
  for the English one Travelify knows, calls Travelify, swaps the answers back to
  the customer's language and hands them over. To the box it looks exactly like
  Travelify's own search service.

## Why the million names is not a problem

Almost none of those names have a different form in another language. Resorts,
hotels, airports, ports, points of interest and small towns are spelled the same
everywhere. The names that genuinely differ are a small, stable set: countries
and the major cities. So:

- The long tail passes straight through untouched and displays correctly as
  typed, no dictionary entry needed.
- We only ever hold the small set of names that actually differ.

We translate demand, not the database.

## How the flow works

1. Box calls the translator with the typed text and a language code (for example
   `Language=ro`).
2. Translator resolves the typed word to the English name Travelify knows.
   `Londra` becomes `London`. If we do not recognise the word, we pass it through
   unchanged, which is correct for the long tail.
3. Translator calls Travelify's `/autocomplete` with the English word, forwarding
   the box's own Travelify login when present.
4. Translator takes the results and puts the human readable name back into the
   customer's language. `London` becomes `Londra`. Anything with no local form is
   left as it is (correct by default).
5. Box shows the dropdown, entirely in the customer's language.

The customer only ever sees English if a place has no local name to show instead.

## Endpoint

`GET /api/autocomplete` (also reachable as `/autocomplete` so it mirrors
Travelify's own path for phase 2). It is a drop in for
`https://api.travelify.io/autocomplete`: it accepts the same query string
parameters, forwards them unchanged apart from the translated `Query`, and
returns the same JSON array shape. On an upstream error it relays Travelify's
status code and body.

### Parameters

Every documented Travelify autocomplete parameter is forwarded (whitelisted):
`Query`, `Language`, `CountryCode`, `BlockCountryCode`, `TopQuery`, `SearchType`,
`GeographyType`, `LinkGeography`, `LinkId`, `MinStarRating`, `BlockLevel`,
`ListID`, `Split`, `Numeric`, `MaxItems`, `ShowSupplier`. Only `Query` is
rewritten, and only when we recognise the typed word.

### Which fields get translated

Only the human readable ones: `name`, `parentName`, `summary`, and the same
fields inside any nested `subLocations` (handled recursively). Codes, ids,
coordinates, ratings and everything else pass through untouched.

### Authorization

The translator holds no Travelify secrets of its own. When the box sends an
`Authorization` header (and `Referer`) we forward them verbatim, exactly as the
reference doc requires. For the MVP demo there is no real box, so when no
`Authorization` arrives we fall back to Travelify's published demo application
(App 250) so the demo returns real results. In production the real box brings its
own login and that fallback is never used.

## The dictionary

`api/_lib/exonyms.js` holds a seed list per language. Each entry is one
`[ localName, canonicalEnglishName ]` pair, listed only where the two genuinely
differ. Matching is case and accent insensitive, so `Veneția`, `Venetia` and
`VENETIA` all resolve the same, which matters because customers type without
diacritics.

Resolution is exact first, then a guarded prefix match: while a customer types,
if the letters so far uniquely point at one English name we resolve early (`Lo`
already finds London), and if they are ambiguous we pass through and let
Travelify match the raw text.

The seed canonical forms are a best first guess and get tuned once we can see
live Travelify results, since matching depends on the exact English spelling
Travelify indexes.

## What is deliberately out of scope for the MVP

- **The self learning fallback.** When a customer types an unknown word that
  Travelify cannot match, a one off AI translation would resolve it and cache it
  for good, so the dictionary fills itself in from real use. This is phase 2. The
  MVP proves the round trip with a hand seeded list and no AI cost.
- **Wiring into the real Travelify search boxes.** Phase 2, once we confirm the
  box can be pointed at our address.
- **Languages beyond `RO`.**
- **Dual query merge** (searching both the raw and translated word and merging),
  which would keep raw matches the resolver drops. Phase 2 refinement.

## How to see it working

Deploy and open `/demo-autocomplete-translate`. Type `Londra` with the language
set to `RO`. It resolves to London behind the scenes, Travelify returns the real
match and it shows back as `Londra`. The status line shows the typed word, the
English word we searched and the match type.

## Tests

`tests/autocomplete-translate.test.mjs` covers the pure translation logic
(exact, prefix, passthrough, accent folding, display re localisation, compound
names, and the English no op). Run with `npm run test:autocomplete`.
