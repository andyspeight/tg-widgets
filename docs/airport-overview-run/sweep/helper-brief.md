<!-- Copy of the brief every helper agent works from (session scratchpad/sweep/BRIEF.md), saved to the repo on 23 Sep 2026 so a later session can reuse it. Paths under /tmp/claude-0/... are this session's scratchpad and will not exist in a new session: point them at the new session's scratchpad. -->

# Brief: verify airport Overviews to the two-source standard

You are helping Travelgenix verify short airport descriptions ("Overviews") in
its Airports table before they can be shown to travel agents. Each Overview was
written in September 2026 from ONE source, the airport's Wikipedia article.
Your job is to check every fact in it against a SECOND, independent source and
produce a corrected Overview plus a verification ledger. The owner's rule is
absolute: NO MADE-UP DATA, DOUBLE VERIFICATION ON EVERYTHING. A fact you cannot
confirm is cut, never guessed and never written from memory.

Work in: /home/user/tg-widgets/docs/airport-overview-run/sweep
Read first: README.md in that folder (the method) and ledger/TBS.json (a
finished, passing example). Follow both exactly.

## For each airport in your list

1. `node start.mjs <IATA>` prints the record and current Overview, saves the
   Wikipedia text (source 1) and runs the coordinates check, and creates
   `ledger/<IATA>.json`.
2. List every fact-bearing claim: numbers, names, dates, rankings, airlines,
   terminals, distances, directions, recent changes, histories.
3. For each claim find a second source from a DIFFERENT organisation than
   Wikipedia. THERE IS NO WEB SEARCH: the session's search allowance is used
   up. Do not call WebSearch, and do not fetch search-engine result pages
   (Google, Bing, DuckDuckGo, Baidu and the like) to get round that. Find
   sources these ways instead:
   - `node refs.mjs <IATA> [regex]` lists every external page the Wikipedia
     article cites, grouped by publisher. Those are usually the original
     publishers (operator, regulator, newspaper) and count as a second
     organisation once you save the page and the quote is on it.
   - Official sites you can address directly: the airport operator's site,
     the national civil aviation authority or statistics office, the
     airline's own site, and for any country with current travel warnings the
     UK FCDO page at https://www.gov.uk/foreign-travel-advice/<country-slug>.
   - `node links.mjs <url> [regex]` lists the links on a page through a real
     browser: use it on an operator's news or press-release index to find
     the release you need. WebFetch may also be used to read a page and FIND
     a link on it. Neither is evidence.
   Save each page with
   `node grab.mjs <IATA> <short-label> "<url>" "<regex of words to show>"`.
   If that gets a plain 403, an empty page or a timeout, try
   `node grabb.mjs` with the same arguments (it reads through a real
   browser). But if grab.mjs gets a bot-check page (Cloudflare's "Just a
   moment...", "checking your browser", "Enable JavaScript and cookies to
   continue", Imperva/Incapsula, a CAPTCHA, a "security check required"
   page), the site is behind a bot check: stop there, do NOT try grabb.mjs,
   and record the block (tightened 23 Sep evening). Only a quote that
   appears in a page saved by grab.mjs or grabb.mjs counts.
   Read grab.mjs's answer before you do anything else: never chain
   grabb.mjs, or any other fetch, into the same command as grab.mjs. An
   answer of 'Blocked by egress policy' means the session's network
   policy forbids that site: record it and move on, and let no other tool
   try it. Do not use curl or wget at all (added 23 Sep evening, after
   two chained retries on egress-blocked sites).
   A site's own search page counts as a search page, and a blocked site is
   not fetched again just to read the refusal (added 23 Sep late evening).
   Make sure an "official" site really is the airport's: compare the domain
   with OurAirports' home link (in scratchpad/sweep/airports.csv) or the
   Wikipedia infobox. billund-airport.com, for one, is a hijacked spam site.
   Preferred sources: the airport operator; government, regulator or
   statistics office; the airline's own site for its own base; reputable news
   or aviation trade press (Reuters, AP, Aviation Week, CAPA, Simple Flying
   only to back up something plainer sources say). Travel blogs and content
   farms only as a last-resort tie-breaker. Sites that copy Wikipedia do not
   count.
   Time-sensitive claims (passengers, airlines, routes, terminals, works,
   renamings, closures, conflict) need a source dated within the last 12
   months. If Wikipedia is out of date, the corrected fact needs two sources
   of its own.
   ATTRIBUTED STATEMENTS are the one exception to two sources. A sentence that
   names who says something ("The FCDO advises against all travel to
   Yemen") may rest on that body's own page alone. In the ledger mark the
   claim `"primary": true` and `"attribution": "FCDO"`; the text must name the
   body and the source's org must be that body. See ledger/SAH.json and
   ledger/AQJ.json. The facts behind the advice still need two sources.
   For conflict-hit airports, read the FCDO page for the country first: the
   Overviews were written from Wikipedia and often miss what happened in 2026.
   Spend at most two or three attempts per claim. Then cut it or soften it to
   what two sources do support.
4. Rewrite the Overview in `after`. Rules: UK English; no em dashes; no Oxford
   comma; none of these words: leverage, holistic, robust, seamless, delve,
   tapestry, unlock, landscape, ecosystem, nestled, vibrant, profound, pivotal,
   crucial, vital, testament, underscores, fostering, garner, showcase,
   intricate, enduring, additionally, furthermore, moreover, boasts,
   "gateway to". No two consecutive sentences starting with the same word.
   Keep the existing plain, factual voice and paragraphing. Aim for 80 to 150
   words. Do not add new facts except to replace a stale one, and only with
   two sources. Replace like with like: a passenger total may replace an
   older passenger figure, but not a count of flights, routes, airlines or
   destinations. Replace those with the airport's own current count,
   attributed ("the airport lists 16 destinations"), or cut them. A fact
   you found that replaces nothing (a passenger total, a new terminal, a
   warning) stays out of the text: record it in the ledger as a cut with no
   `wasBefore`, a `why` beginning "Held back:", and its sources, and name it
   in your report. Keep what matters to a UK travel agent: where it is, how busy,
   which airlines, anything that has recently changed or will catch a
   traveller out.
5. Fill `claims` in the ledger exactly as ledger/TBS.json does: every kept
   claim has `inAfter` (the exact phrase in the new text), `sources` (file =
   the grab label, org = the publisher, quote = exact words from the saved
   page, dated where you know it, and only from a date readable on the saved
   page itself, never from metadata read another way), and a `note` for any
   judgement call. Every
   removed claim is a `cut` with `wasBefore` (exact phrase from the old text)
   and `why`. Every sentence of the new text must be carried by some claim's
   inAfter, or listed in `opinion` with a reason.
6. Run `node check.mjs <IATA>` and fix until it prints READY TO PUSH. Look
   hard at any "look" lines too.

## Do not

- Do not write to Airtable or call any Airtable tool.
- Do not edit any .mjs script, README.md, or another airport's ledger.
- Do not commit to git.
- Do not touch airports outside your list.
- Do not try to get round a network or security block: no supplying or
  installing certificates, no changing TLS or proxy settings, no solving or
  dodging bot checks (Cloudflare, Imperva/Incapsula and the like). Note the
  block in the cut's `why` and move on. If the permission system stops you,
  say so in your report; do not ask anyone else to do it for you.

- Do not call Wikipedia or Wikidata yourself with curl or fetch. Use wiki.mjs
  and refs.mjs, which send the harness's user agent. If Wikimedia answers 403
  ("Please respect our robot policy"), stop calling it: use the Wikipedia text
  already saved and say so in your hand-back. (23 Sep: one plain-curl request
  got this session's IP blocked.)

## Report back (plain text, short)

For each airport: READY or BLOCKED; what you corrected and why (one line each);
what you cut; any place where good sources disagreed and how you chose; and
anything you think the owner should decide. Say plainly if you ran out of
budget before finishing an airport.

## Data other helpers have already found useful (added 23 Sep afternoon)

- Chinese airports: CAAC's 2025 traffic table is saved; each Chinese airport's
  passenger row is already in evidence/<IATA>/caac-2025.txt. For cargo or
  any other row, `node /tmp/claude-0/-home-user-tg-widgets/aa74082d-0375-5ea9-97e1-bfee8cc3073d/scratchpad/xlsx-row.cjs <xlsx> "<regex>"`
  reads the saved spreadsheet (scratchpad/sweep/caac-2025-ranking.xlsx); see
  evidence/CGO/caac-2025-cargo.txt for how to save a row as evidence.
- EU and EEA airports: Eurostat's 2022 to 2025 passenger totals are saved in
  scratchpad/sweep/eurostat-paoa.json (keyed by country and ICAO code); see
  how evidence/BGO/eurostat.txt was saved.
- Norway: Avinor's 2025 annual report (evidence/BGO/avinor-ar2025.txt) has
  2025 passengers for Oslo, Bergen, Stavanger and Trondheim. Sweden: Swedavia's
  2025 annual report tabulates all ten Swedavia airports.
- US airports: the FAA's preliminary CY2025 commercial-service enplanements
  table (https://www.faa.gov/airports/planning_capacity/passenger_allcargo_stats/passenger/arp-cy2025-commercial-service-enplanements-preliminary.pdf)
  and the CY2025 all-cargo table
  (.../arp-CY2025-all-cargo-airports-preliminary.pdf) grab cleanly with
  grab.mjs; see evidence/SDF/faa-cy2025-enpl.txt. Enplanements are
  boardings, roughly half an airport's total passengers: say which you quote.
- Wikipedia (23 Sep, 15:27 UTC): Wikimedia is refusing this session's IP.
  wiki.mjs and refs.mjs now skip it for two hours after a 403 and say so.
  start.mjs still works and saves the archived copy the Overview was written
  from (wikipedia-archived.txt), which is source 1. refs.mjs will not work
  while the block lasts: find publishers through the operator's own site,
  the regulator and links.mjs instead.
- German airports: ADV's December 2025 report (full-year 2025 passengers,
  cargo and domestic share for every German airport) is saved as
  evidence/BRE/adv-dec2025.txt; copy it with a NOTE line as LEJ and NUE do.
- EU airports, the kind of flying: `node eurostat-routes.cjs <ISO2> <ICAO>
  <IATA>` saves an airport's routes from Eurostat (2024, the latest by
  route); `node eurostat-series.cjs <ISO2_ICAO> <IATA>` saves its passenger
  totals for every year, for 'record year' claims (see ledger/NUE.json).
- Blocked, do not retry: web.archive.org (network policy), onda.ma
  (Cloudflare), airbus.com (Imperva). Many Chinese government and airport
  sites answer 502 or 503; one try is enough.
