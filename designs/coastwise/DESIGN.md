---
name: Coastwise — Small Ship Voyages
description: A small-ship coastal cruise line that trades on restraint. Bone paper grounds banded against deep sea-slate, one signal red that marks prices and the way in, a wide-cut grotesk that does both display and body, and a plotting-room mono reserved for data. Copy is dry, concrete and short. The site moves the way water does, slowly and without asking for credit.
mode: Persuade
adopted: 21 Aug 2026, from the approved Coastwise homepage concept (travel-homepage-concepts). Andy chose this world; this file commits it for the CMS build. Two corrections carried in from his review of the concept, both recorded under "corrections" below.
---

colors:
  # Paper grounds
  bone: "#F2EFE9"          # dominant page surface
  bone-2: "#E7E2D8"        # alternate band, the itinerary rail's ground

  # Ink
  ink: "#14181C"           # body and headings on bone
  ink-2: "#4E5960"         # secondary text on bone (4.5:1 on bone, checked)

  # Sea
  deep: "#1B333D"          # the dark band: hero scrim ground, aboard, closing CTA
  cold: "#93A7B4"          # sea-mist: image wells, never text
  bone-on-deep: "#F2EFE9"  # text on deep
  soft-on-deep: "#AFBFC9"  # secondary on deep (tinted from cold, holds 4.5:1)

  # The one signal
  signal: "#C8452C"        # prices, the CTA, the sea-day marker. Nothing else.

fonts:
  display: "'Archivo', system-ui, sans-serif"   # wide cut for headings: weight 600-700, tight tracking
  body: "'Archivo', system-ui, sans-serif"      # 400, the same face doing both jobs is the identity
  mono: "'IBM Plex Mono', ui-monospace, monospace"  # DATA ONLY: coordinates, dates, fares, day numbers

type:
  headings: tight (-2 to -3 tracking), weight 600-700, short lines. The h1 speaks in
    fragments ("Thirty-eight guests. No queue for anything.").
  mono use: uppercase, small, letterspaced. It is a ship's log, not a label maker.
    Legitimate: day numbers on an itinerary (the sequence IS the information),
    coordinates, fares, dates, ship names. NOT legitimate: section numbers and
    eyebrows over headings; the craft floor bans those and the ones in the concept
    ("01 — What we actually do") are dropped, not carried.

voice: Dry, confident, concrete. British English. Sentences that could be radioed.
  Numbers are exact (thirty-eight guests, 3.8m draught, nineteen seasons). The joke,
  when there is one, is deadpan ("a bar that runs on trust"). Never "nestled",
  never "hidden gem", never an exclamation mark.

motion: The water moves, the type does not chase it. Destination pages get Ken
  Burns on the banner; about gets the count-up numbers; home has the voyage deck
  (stacked cards) AND Ken Burns on the hero photograph. Reveals are used at most
  once per page section group and honour prefers-reduced-motion throughout (free:
  the CMS blocks all do).

  THE ONE-MOMENT-PER-PAGE RULE NO LONGER APPLIES TO THIS SITE, changed by Andy on
  25 Aug 2026: "we spent a lot of time adding a motion engine, so not using it is
  not good." It had been read here as a ban on a second moving thing, and on the
  home page that meant the hero photograph sat still because the voyage deck lower
  down had already spent the page's allowance. What survives the change is the
  half that carries the identity: the water moves and the type does not chase it.
  So the background of a picture may drift, and headings, prices and the booking
  box still do not move. A page wanting a THIRD moving thing is a fresh decision
  rather than a precedent set here.

anti-references:
  - The big-ship cruise site: atrium photography, exclamation marks, WIN A CRUISE.
  - The luxury-brand template: gold foil, serif whispering, "curated".
  - The AI tell: three equal cards, hero-metric blocks, kickers over every heading.

corrections (Andy, 25 Aug 2026):
  - The home hero is 1200px tall, the ceiling the CMS allows, and carries Ken
    Burns. It had been 640 and still. Note for anyone tempted to make it
    full-bleed as well: the hero PHOTOGRAPH already is, because a section spans
    the viewport and its background sits at inset 0. `width` sets the max-width
    of the text column only, so switching it to full would put the headline
    against the viewport edge, which is the thing the 21 Aug correction below
    exists to prevent. Height is the lever; width is not.

corrections (Andy, 21 Aug 2026, from the concept review):
  - Text must never touch the viewport edge. The concept's fluid gutter bottomed
    out at 20px and the hero headline could kiss the edge on small screens; the CMS
    build keeps the page's contained width and standard section padding everywhere.
  - The home page must hold a clear slot for the booking search box (the Travelify
    search widget), directly under the hero, on the deep ground, labelled so it is
    obvious in the editor where the widget drops in. The site is to be bookable.

craft-floor notes: selection/caret/focus themed from signal and deep; link
  underline offset set; one motion moment per page; no kickers; no hero-metric
  template; contrast 4.5:1 held on both grounds (ink-2 on bone and soft-on-deep
  on deep are the two measured secondaries).
