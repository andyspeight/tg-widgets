/**
 * Travelgenix Showcase — product data
 *
 * Drives the touch-screen product showcase at /showcase. One entry per
 * product. Each product carries a set of SCREENS (self-contained markup
 * rendered inside a device frame) and a set of HOTSPOTS per screen.
 *
 * A hotspot anchors to an element by its data-hs attribute, so the dot
 * tracks the real element wherever it reflows to. Every hotspot states a
 * FEATURE (what it does) and a BENEFIT (why it matters to the agency or
 * the traveller). An optional EDGE line carries the competitive story.
 *
 * All markup here is authored and static. Nothing on this page is fetched
 * or built from user input, and no image is loaded over the network, so
 * the showcase works on a stand with no wifi.
 *
 * Screens are a faithful recreation of the shipped product, not a live
 * embed: Luna Travel is a phone PWA on another origin that needs a real
 * booking and a sign-in, so it cannot be framed. Feature copy is taken
 * from the Luna Travel project record at v0.14.11.
 */
(function () {
  'use strict';

  /* ---------------------------------------------------------------- *
   * Luna Travel — the post-booking traveller PWA
   * ---------------------------------------------------------------- */

  var statusBar =
    '<div class="lt-statusbar">' +
      '<span class="lt-sb-time">09:41</span>' +
      '<span class="lt-sb-right">' +
        '<span class="lt-sb-bars"><i></i><i></i><i></i><i></i></span>' +
        '<span class="lt-sb-batt"></span>' +
      '</span>' +
    '</div>';

  function tabBar(active) {
    var tabs = [
      { id: 'home', label: 'Home' },
      { id: 'itinerary', label: 'Trip' },
      { id: 'map', label: 'Map' },
      { id: 'documents', label: 'Docs' },
      { id: 'me', label: 'Me' }
    ];
    var html = '<nav class="lt-tabbar" data-hs="tabbar">';
    tabs.forEach(function (t) {
      var on = t.id === active ? ' is-on' : '';
      var badge = t.id === 'me'
        ? '<span class="lt-tab-badge" data-hs="me-badge">2</span>'
        : '';
      html +=
        '<span class="lt-tab' + on + '">' +
          '<span class="lt-tab-ico lt-ico--' + t.id + '">' + badge + '</span>' +
          '<span class="lt-tab-label">' + t.label + '</span>' +
        '</span>';
    });
    return html + '</nav>';
  }

  var lunaTravel = {
    id: 'luna-travel',
    name: 'Luna Travel',
    category: 'Luna Suite',
    status: 'Live',
    version: 'v0.14.11',
    tagline: 'The trip, in the traveller’s pocket. Branded as the agency.',
    summary:
      'A post-booking app the traveller installs from a link, with no app store in the way. ' +
      'It carries the whole trip: itinerary, documents, a map that works with no signal, and ' +
      'an assistant that answers from the real booking. Every screen wears the agency’s name, ' +
      'not ours.',
    device: 'phone',
    qr: {
      url: 'https://lunatravel.travelify.io/install',
      heading: 'Try it on your own phone',
      note: 'Scan to install the demo trip. Nothing to download from a store.'
    },
    screens: []
  };

  /* -- Home ------------------------------------------------------- */
  lunaTravel.screens.push({
    id: 'home',
    name: 'Home',
    blurb: 'Where the traveller lands, and where the agency reaches them.',
    html:
      statusBar +
      '<header class="lt-appbar">' +
        '<span class="lt-brandmark" data-hs="brand">TD</span>' +
        '<span class="lt-brandtext"><strong>Travel Demo</strong><small>Your trip, in your pocket</small></span>' +
        '<span class="lt-bell" data-hs="bell"><span class="lt-bell-dot">2</span></span>' +
      '</header>' +
      '<div class="lt-body">' +
        '<div class="lt-banner lt-banner--urgent" data-hs="agent-banner">' +
          '<span class="lt-banner-tag">Urgent</span>' +
          '<p>Your resort transfer now leaves at 14:20, from speedboat jetty 2.</p>' +
          '<span class="lt-banner-act">Mark as read</span>' +
        '</div>' +
        '<section class="lt-hero" data-hs="trip-hero">' +
          '<span class="lt-hero-art lt-art--atoll"></span>' +
          '<span class="lt-hero-copy">' +
            '<strong>Maldives</strong>' +
            '<small>2 to 17 Oct 2026 · 12 nights · DEMO81297</small>' +
          '</span>' +
          '<span class="lt-countdown" data-hs="countdown"><b>13</b><small>days to go</small></span>' +
        '</section>' +
        '<div class="lt-row2">' +
          '<div class="lt-tile" data-hs="weather">' +
            '<span class="lt-tile-k">Malé now</span>' +
            '<span class="lt-tile-v">29°</span>' +
            '<span class="lt-tile-s">Warm, light cloud</span>' +
          '</div>' +
          '<div class="lt-tile" data-hs="nextup">' +
            '<span class="lt-tile-k">Next up</span>' +
            '<span class="lt-tile-v lt-tile-v--sm">LHR to AUH</span>' +
            '<span class="lt-tile-s">Thu 2 Oct, 21:35</span>' +
          '</div>' +
        '</div>' +
        '<div class="lt-quick" data-hs="quick">' +
          '<span class="lt-qbtn"><i class="lt-qi lt-qi--doc"></i>Documents</span>' +
          '<span class="lt-qbtn"><i class="lt-qi lt-qi--chat"></i>Ask Luna</span>' +
          '<span class="lt-qbtn" data-hs="call-agent"><i class="lt-qi lt-qi--phone"></i>Call agent</span>' +
        '</div>' +
        '<div class="lt-guide" data-hs="guide">' +
          '<span class="lt-guide-art lt-art--atoll"></span>' +
          '<span class="lt-guide-c">' +
            '<b>Your guide to Baa Atoll</b>' +
            '<small>Getting around, eating out, what the weather does in October</small>' +
          '</span>' +
          '<i class="lt-chev"></i>' +
        '</div>' +
      '</div>' +
      tabBar('home'),
    hotspots: [
      {
        anchor: 'brand',
        at: 'top-left',
        title: 'White-labelled to the agency',
        feature:
          'The agency name, mark and colours are applied across every screen from their Control record. ' +
          'Travelgenix is not named anywhere the traveller can see.',
        benefit:
          'The traveller spends two weeks looking at their travel agent’s brand, at the point in the ' +
          'journey when they are most likely to talk about the trip.',
        edge: 'Vamoos charges for branding as a tier. Here it is how the app ships.'
      },
      {
        anchor: 'agent-banner',
        title: 'The agent can reach them mid-trip',
        feature:
          'Messages an agent sends from the CRM surface at the top of home, newest unread first, ' +
          'colour coded by priority: red for urgent, amber for important, teal for the rest. ' +
          'Mark as read clears it, and opening notifications clears the rest.',
        benefit:
          'A gate change or a moved transfer reaches the traveller on the screen they already have open, ' +
          'instead of an email they will not see until they land.'
      },
      {
        anchor: 'bell',
        at: 'top-left',
        title: 'Unread count that follows them',
        feature:
          'The badge polls on open, on focus and whenever the app comes back to the foreground, so the ' +
          'count is right without the traveller pulling to refresh.',
        benefit: 'Nothing important sits unseen just because the app was in the background.'
      },
      {
        anchor: 'trip-hero',
        at: 'bottom-right',
        title: 'The booking arrives by itself',
        feature:
          'The trip is built from the live Travelify order. Reference, dates, nights, flights, hotels ' +
          'and extras all come across without anyone retyping them.',
        benefit:
          'The agency gets a branded trip app for a booking they have already made, with no back-office ' +
          'work and nothing to keep in step by hand.'
      },
      {
        anchor: 'countdown',
        at: 'top-left',
        title: 'Countdown to departure',
        feature: 'A live count of days to go, from the booking’s own start date.',
        benefit:
          'It gives the traveller a reason to open the app before they travel, which is when upsells and ' +
          'extras still convert.'
      },
      {
        anchor: 'weather',
        at: 'top-left',
        title: 'Destination weather',
        feature: 'Current conditions for the destination, on the home screen.',
        benefit: 'It answers the question every traveller asks their agent in the fortnight before they fly.'
      },
      {
        anchor: 'nextup',
        at: 'top-right',
        title: 'What happens next, without hunting for it',
        feature:
          'The next thing due on the trip is pulled out of the itinerary onto the home screen: the flight ' +
          'tonight, the transfer tomorrow, the check out on the last morning.',
        benefit:
          'The traveller opens the app and gets their answer immediately, rather than scrolling a fifteen ' +
          'day itinerary to work out what is happening today.'
      },
      {
        anchor: 'call-agent',
        title: 'One tap back to a human',
        feature:
          'Call and email actions are built from the agency’s own number and address, and they only ' +
          'appear when the agency has them on file.',
        benefit:
          'The agency stays in the trip. The traveller never has to hunt for who booked it when something ' +
          'goes wrong.'
      },
      {
        anchor: 'guide',
        title: 'Destination content the agency already owns',
        feature:
          'Guides are drawn from the Travelgenix destination database, the same content that fills the ' +
          'agency\u2019s website, and matched to where the traveller is actually going.',
        benefit:
          'The agency looks like it knows the resort, without anyone writing a word, and the content they ' +
          'paid for once works twice.'
      },
      {
        anchor: 'tabbar',
        title: 'Five tabs, and it stays at five',
        feature:
          'Home, Trip, Map, Docs and Me. New capability is added inside a tab rather than as a sixth, ' +
          'which is why the storyboard ships as a view of the itinerary and not a tab of its own.',
        benefit:
          'A traveller who used the app last year still knows where everything is. The app does not grow ' +
          'a navigation problem as it grows features.'
      }
    ]
  });


  /* -- Itinerary -------------------------------------------------- */
  lunaTravel.screens.push({
    id: 'itinerary',
    name: 'Itinerary',
    blurb: 'One set of facts, shown two ways.',
    html:
      statusBar +
      '<header class="lt-appbar lt-appbar--sub">' +
        '<span class="lt-back"></span>' +
        '<span class="lt-title">Your trip</span>' +
      '</header>' +
      '<div class="lt-seg" data-hs="seg">' +
        '<span class="lt-seg-btn is-on">Timeline</span>' +
        '<span class="lt-seg-btn">Storyboard</span>' +
      '</div>' +
      '<div class="lt-body">' +
        '<div class="lt-day" data-hs="daygroup">' +
          '<span class="lt-day-h"><b>Day 1</b><small>Thu 2 Oct · London</small></span>' +
          '<span class="lt-day-tag">Travel day</span>' +
        '</div>' +
        '<div class="lt-ev" data-hs="ev-flight">' +
          '<span class="lt-ev-ico lt-ev--plane"></span>' +
          '<span class="lt-ev-b">' +
            '<strong>London Heathrow to Abu Dhabi</strong>' +
            '<small>EY20 · 21:35 · Terminal 4 · Seat 24A</small>' +
          '</span>' +
        '</div>' +
        '<div class="lt-day">' +
          '<span class="lt-day-h"><b>Day 2</b><small>Fri 3 Oct · Baa Atoll</small></span>' +
          '<span class="lt-day-tag lt-day-tag--arrive">Arrive</span>' +
        '</div>' +
        '<div class="lt-ev" data-hs="ev-transfer">' +
          '<span class="lt-ev-ico lt-ev--boat"></span>' +
          '<span class="lt-ev-b">' +
            '<strong>Speedboat transfer</strong>' +
            '<small>14:20 · Jetty 2 · 35 minutes</small>' +
          '</span>' +
        '</div>' +
        '<div class="lt-ev" data-hs="ev-hotel">' +
          '<span class="lt-ev-ico lt-ev--bed"></span>' +
          '<span class="lt-ev-b">' +
            '<strong>Reethi Beach Resort</strong>' +
            '<small>Check in 15:00 · Water Villa · 12 nights · All inclusive</small>' +
          '</span>' +
        '</div>' +
        '<div class="lt-storyboard" data-hs="storyboard">' +
          '<span class="lt-sb-art lt-art--atoll"></span>' +
          '<span class="lt-sb-copy"><b>Day 3 · At leisure</b><small>Baa Atoll, Maldives</small></span>' +
        '</div>' +
      '</div>' +
      tabBar('itinerary'),
    hotspots: [
      {
        anchor: 'seg',
        title: 'Timeline and Storyboard, one source',
        feature:
          'The storyboard is a presentation layer over the same canonical timeline, switched here rather ' +
          'than built as a second tab with its own copy of the data.',
        benefit:
          'The two views cannot drift apart and disagree about the trip, which is the usual way a second ' +
          'view of an itinerary goes wrong.'
      },
      {
        anchor: 'daygroup',
        title: 'Days that match the traveller’s day',
        feature:
          'Days are derived from the events themselves, grouped on the same day keys the timeline uses, ' +
          'rather than counted forward from the trip start.',
        benefit:
          'A British traveller on a 2 October trip sees Day 1 as 2 October. Counting from the start date ' +
          'in UTC used to invent a phantom day in front of the trip.'
      },
      {
        anchor: 'ev-flight',
        title: 'Flights, rooms and transfers as booked',
        feature:
          'Every event is read from the supplier order: flight numbers, terminals, seats, room type, board ' +
          'basis and check in times.',
        benefit:
          'The traveller stops emailing the agency to ask what time the flight is, and the agency stops ' +
          'answering that email forty times a week.'
      },
      {
        anchor: 'storyboard',
        title: 'A day at a time, with a headline',
        feature:
          'Storyboard gives each day a plain headline, travel day, arrive, at leisure or departure, with a ' +
          'location line beneath. Travel days take their image from the country they are heading to.',
        benefit:
          'It reads like a holiday rather than a schedule, which is what makes a traveller show it to ' +
          'someone else.'
      }
    ]
  });

  /* -- Trip map --------------------------------------------------- */
  lunaTravel.screens.push({
    id: 'map',
    name: 'Trip map',
    blurb: 'A map that works with the phone in flight mode.',
    html:
      statusBar +
      '<header class="lt-appbar lt-appbar--sub">' +
        '<span class="lt-back"></span>' +
        '<span class="lt-title">Trip map</span>' +
      '</header>' +
      '<div class="lt-map" data-hs="map-canvas">' +
        '<span class="lt-map-land lt-map-land--a"></span>' +
        '<span class="lt-map-land lt-map-land--b"></span>' +
        '<span class="lt-map-land lt-map-land--c"></span>' +
        '<span class="lt-map-route"></span>' +
        '<span class="lt-pin lt-pin--1" data-hs="pin-airport"><b>LHR</b></span>' +
        '<span class="lt-pin lt-pin--2"><b>AUH</b></span>' +
        '<span class="lt-pin lt-pin--3 lt-pin--hotel" data-hs="pin-hotel"><b>Resort</b></span>' +
        '<span class="lt-map-badge" data-hs="map-offline">Works offline</span>' +
      '</div>' +
      '<div class="lt-body lt-body--tight">' +
        '<div class="lt-legend" data-hs="map-legend">' +
          '<span><i class="lt-dot lt-dot--air"></i>Airports</span>' +
          '<span><i class="lt-dot lt-dot--hotel"></i>Where you stay</span>' +
        '</div>' +
      '</div>' +
      tabBar('map'),
    hotspots: [
      {
        anchor: 'map-offline',
        at: 'outside-right',
        title: 'No tiles, no signal needed',
        feature:
          'The basemap is a bundled Natural Earth outline drawn with a hand rolled equirectangular ' +
          'projection. There is no mapping library and no tile server call.',
        benefit:
          'It draws on a plane, in a resort with bad wifi, and on an overseas data plan the traveller is ' +
          'trying not to use. It also costs the agency nothing per view.'
      },
      {
        anchor: 'map-canvas',
        title: 'Nothing to ask permission for',
        feature: 'The map never asks the device for its location. It plots the booking, not the traveller.',
        benefit:
          'No permission prompt on first open, and no location data to hold. One less thing to explain in ' +
          'a privacy policy.'
      },
      {
        anchor: 'pin-airport',
        at: 'top-left',
        title: 'Airports the feed only names by code',
        feature:
          'Supplier orders carry IATA codes with no coordinates, so airports are placed from a curated ' +
          'coordinate list held in the app.',
        benefit: 'Flights appear on the map at all, which they cannot do from a three letter code alone.'
      },
      {
        anchor: 'pin-hotel',
        title: 'Hotels pinned where they really are',
        feature: 'Accommodation carries real latitude and longitude in the feed, so it is plotted exactly.',
        benefit:
          'The traveller can see how far the resort is from the airport before they land, which is the ' +
          'transfer question in visual form.'
      }
    ]
  });


  /* -- Documents -------------------------------------------------- */
  lunaTravel.screens.push({
    id: 'documents',
    name: 'Documents',
    blurb: 'The paperwork, readable on the phone it is stored on.',
    html:
      statusBar +
      '<header class="lt-appbar lt-appbar--sub">' +
        '<span class="lt-back"></span>' +
        '<span class="lt-title">Documents</span>' +
      '</header>' +
      '<div class="lt-body">' +
        '<div class="lt-doclist">' +
          '<span class="lt-doc is-on" data-hs="doc-item"><i class="lt-doc-ico"></i><b>E-tickets</b><small>PDF · 2 pages</small></span>' +
          '<span class="lt-doc"><i class="lt-doc-ico"></i><b>Hotel voucher</b><small>PDF · 1 page</small></span>' +
          '<span class="lt-doc"><i class="lt-doc-ico"></i><b>Insurance</b><small>PDF · 4 pages</small></span>' +
        '</div>' +
        '<div class="lt-pdf" data-hs="pdf-canvas">' +
          '<span class="lt-pdf-page">' +
            '<span class="lt-pdf-brand" data-hs="pdf-brand">Travel Demo</span>' +
            '<span class="lt-pdf-l lt-pdf-l--t"></span>' +
            '<span class="lt-pdf-l"></span>' +
            '<span class="lt-pdf-l"></span>' +
            '<span class="lt-pdf-l lt-pdf-l--s"></span>' +
            '<span class="lt-pdf-l"></span>' +
            '<span class="lt-pdf-l lt-pdf-l--s"></span>' +
          '</span>' +
          '<span class="lt-pdf-pager">Page 1 of 2</span>' +
        '</div>' +
        '<div class="lt-docacts" data-hs="doc-acts">' +
          '<span class="lt-abtn">Open full screen</span>' +
          '<span class="lt-abtn lt-abtn--ghost">Download</span>' +
        '</div>' +
      '</div>' +
      tabBar('documents'),
    hotspots: [
      {
        anchor: 'pdf-canvas',
        title: 'A PDF that actually opens on a phone',
        feature:
          'Pages are rendered to a canvas in the app itself. Mobile browsers refuse to draw a PDF inside a ' +
          'frame and show their own Open placeholder instead, so framing one can never work on a phone.',
        benefit:
          'The traveller reads their ticket in the app, at the airport, rather than being bounced into a ' +
          'file viewer or a download they then have to find again.'
      },
      {
        anchor: 'pdf-brand',
        title: 'Documents wear the agency’s brand',
        feature: 'Generated documents carry the agency name and colours, the same as every other screen.',
        benefit:
          'The thing the traveller shows at a check in desk has the agency on it, which is the highest ' +
          'value piece of brand real estate in the whole trip.'
      },
      {
        anchor: 'doc-acts',
        title: 'Two ways out, always',
        feature: 'Open full screen and Download stay available under every document.',
        benefit:
          'If a document is awkward on a particular handset, the traveller is never stuck. They can always ' +
          'get the file itself.'
      },
      {
        anchor: 'doc-item',
        title: 'The agent uploads, the traveller receives',
        feature:
          'Documents are attached from the agency side in Luna Work, next to the trip they belong to, and ' +
          'they appear here without the traveller doing anything.',
        benefit:
          'No more sending a 6MB attachment and hoping it arrived. The agency can see the app has it.'
      }
    ]
  });

  /* -- Luna ------------------------------------------------------- */
  lunaTravel.screens.push({
    id: 'luna',
    name: 'Ask Luna',
    blurb: 'An assistant that would rather hand over than guess.',
    html:
      statusBar +
      '<header class="lt-appbar lt-appbar--sub">' +
        '<span class="lt-back"></span>' +
        '<span class="lt-title">Ask Luna</span>' +
      '</header>' +
      '<div class="lt-body lt-chat">' +
        '<div class="lt-msg lt-msg--in" data-hs="luna-grounded">' +
          'Your flight EY20 leaves Heathrow Terminal 4 at 21:35 on Thursday 2 October. ' +
          'Bag drop opens three hours before.' +
        '</div>' +
        '<div class="lt-msg lt-msg--out">Can I get a cot in the room?</div>' +
        '<div class="lt-msg lt-msg--in" data-hs="luna-honest">' +
          'I cannot answer that for certain. Your agent will know.' +
        '</div>' +
        '<div class="lt-pills" data-hs="luna-handoff">' +
          '<span class="lt-pill">Email my agent</span>' +
          '<span class="lt-pill">Call my agent</span>' +
        '</div>' +
        '<div class="lt-composer" data-hs="luna-composer">' +
          '<span class="lt-input">Ask about your trip</span>' +
          '<span class="lt-send"></span>' +
        '</div>' +
      '</div>' +
      tabBar('home'),
    hotspots: [
      {
        anchor: 'luna-grounded',
        title: 'Answers from the booking, not the internet',
        feature:
          'Luna answers from the trip the traveller is actually on: flights, times, terminals, room, board ' +
          'basis, dates and reference.',
        benefit:
          'The answers are right because they come from the order. There is nothing for the agency to keep ' +
          'up to date and nothing to correct afterwards.'
      },
      {
        anchor: 'luna-honest',
        title: 'It admits what it does not know',
        feature:
          'When Luna cannot answer, it says so plainly. It does not offer a cheerful non-answer and it does ' +
          'not show unrelated suggestions to look busy.',
        benefit:
          'A confident wrong answer about a cot, a visa or a transfer is the fastest way to lose a client. ' +
          'Saying so costs nothing and keeps the trust.'
      },
      {
        anchor: 'luna-handoff',
        title: 'The dead end is a handover',
        feature:
          'Not knowing produces two actions: email the agent with the booking reference already in the ' +
          'subject, or call them. Each appears only if the agency has that contact on file.',
        benefit:
          'An unanswered question becomes a conversation with the agency rather than a bad review, and the ' +
          'agent opens an email that already says which booking it is about.'
      },
      {
        anchor: 'luna-composer',
        title: 'Built to be safe on a stand',
        feature:
          'The in-app assistant runs a local deterministic engine rather than calling out to a model, which ' +
          'is a deliberate choice for demos and for travellers with no signal.',
        benefit:
          'No latency, no hallucination and no dependency on the venue wifi. It answers the same way every ' +
          'time you show it.'
      }
    ]
  });


  /* -- Me --------------------------------------------------------- */
  lunaTravel.screens.push({
    id: 'me',
    name: 'Me',
    blurb: 'Language, travellers and the thing that keeps the app current.',
    html:
      statusBar +
      '<header class="lt-appbar lt-appbar--sub">' +
        '<span class="lt-title">Me</span>' +
      '</header>' +
      '<div class="lt-body">' +
        '<div class="lt-rows">' +
          '<span class="lt-r" data-hs="me-travellers"><b>Travellers</b><small>3 on this booking</small><i class="lt-chev"></i></span>' +
          '<span class="lt-r" data-hs="me-lang"><b>Language</b><small>English</small><i class="lt-chev"></i></span>' +
          '<span class="lt-r" data-hs="me-notif"><b>Notifications</b><small>2 unread</small><i class="lt-chev"></i></span>' +
          '<span class="lt-r" data-hs="me-help"><b>Help and FAQ</b><small>Ask Luna, or contact your agent</small><i class="lt-chev"></i></span>' +
          '<span class="lt-r" data-hs="me-update"><b>Check for updates</b><small>You are on the latest version</small><i class="lt-chev"></i></span>' +
        '</div>' +
        '<div class="lt-langs" data-hs="me-locales">' +
          '<span class="lt-lang is-on">English</span><span class="lt-lang">Română</span>' +
          '<span class="lt-lang">Français</span><span class="lt-lang">Deutsch</span>' +
          '<span class="lt-lang">Español</span><span class="lt-lang">Italiano</span>' +
        '</div>' +
        '<span class="lt-ver" data-hs="me-version">Luna Travel v0.14.11</span>' +
      '</div>' +
      tabBar('me'),
    hotspots: [
      {
        anchor: 'me-locales',
        at: 'bottom-right',
        title: 'Six languages, chosen for them',
        feature:
          'English, Romanian, French, German, Spanish and Italian. The app picks one from the handset on ' +
          'first open, and a manual choice is remembered on that device from then on.',
        benefit:
          'A traveller who does not read English gets a usable app without being asked to set it up, and ' +
          'an agency selling into those markets does not need a separate product.'
      },
      {
        anchor: 'me-lang',
        title: 'What is deliberately left alone',
        feature:
          'Supplier text, booking references, dates and times are never machine translated. Only the app’s ' +
          'own wording changes.',
        benefit:
          'A room name or a reference that got helpfully translated is a traveller turned away at a desk. ' +
          'The parts that must match the supplier stay exactly as the supplier wrote them.'
      },
      {
        anchor: 'me-badge',
        title: 'The badge that brings them back',
        feature: 'Unread agent messages show as a count on the Me tab, capped at nine plus.',
        benefit:
          'The agency has a way to pull a traveller back into a branded app, without paying for a push ' +
          'campaign or hoping an email gets opened.'
      },
      {
        anchor: 'me-update',
        title: 'Updates that actually take',
        feature:
          'Updating unregisters the service worker, clears every cache and reloads on a fresh URL. A plain ' +
          'reload just serves the stale app back from disk, which is why the new version prompt used to ' +
          'reappear forever.',
        benefit:
          'A fix the agency asks for on Monday is on the traveller’s phone, rather than stuck behind a ' +
          'cache nobody can clear from the other end of a phone call.'
      },
      {
        anchor: 'me-travellers',
        title: 'Everyone on the booking',
        feature: 'The party on the order is listed, so the app covers the whole booking and not one lead name.',
        benefit: 'Families and groups share one trip rather than one person relaying everything to the rest.'
      },
      {
        anchor: 'me-version',
        title: 'You can always see what you are running',
        feature: 'The live version number sits in the footer, and Check for updates is one row above it.',
        benefit:
          'Support calls start with a fact instead of a guess. The agent can ask what it says at the bottom ' +
          'of Me and know immediately.'
      }
    ]
  });

  /* -- Inspirations ----------------------------------------------- */
  lunaTravel.screens.push({
    id: 'inspiration',
    name: 'Inspirations',
    blurb: 'The screen that earns the next booking.',
    html:
      statusBar +
      '<header class="lt-appbar lt-appbar--sub">' +
        '<span class="lt-back"></span>' +
        '<span class="lt-title">Where next</span>' +
      '</header>' +
      '<div class="lt-body">' +
        '<p class="lt-lede" data-hs="insp-when">Back from the Maldives. Here is where your agent would send you next.</p>' +
        '<div class="lt-cards" data-hs="insp-cards">' +
          '<span class="lt-card"><i class="lt-card-art lt-art--dunes"></i><b>Oman</b><small>From £899</small></span>' +
          '<span class="lt-card"><i class="lt-card-art lt-art--isle"></i><b>Sri Lanka</b><small>From £1,149</small></span>' +
        '</div>' +
        '<span class="lt-note" data-hs="insp-price">Prices are a guide. Your agent confirms the real one.</span>' +
      '</div>' +
      tabBar('home'),
    hotspots: [
      {
        anchor: 'insp-when',
        title: 'A rebooking surface, not an advert',
        feature:
          'Inspirations is aimed at the end of the trip, when the traveller is home, happy and still ' +
          'thinking about travel.',
        benefit:
          'The agency gets a warm second sale from a client who is already theirs, at the moment repeat ' +
          'intent is highest and costs nothing to reach.'
      },
      {
        anchor: 'insp-cards',
        title: 'The agency chooses what is promoted',
        feature:
          'The app ships with a promoted set, and an agency can swap it for their own destinations and ' +
          'content.',
        benefit:
          'A tour operator pushes the trips they actually have margin on, rather than whatever a generic ' +
          'app decides to show.'
      },
      {
        anchor: 'insp-price',
        title: 'A guide price is never supplier data',
        feature:
          'The from price on these cards is promotional copy the agency writes. It is deliberately not ' +
          'wired to live supplier pricing or availability.',
        benefit:
          'Nothing here can be read as a quote or a bookable price, so an inspiration screen cannot turn ' +
          'into a complaint about a price that moved.'
      }
    ]
  });

  /* -- Install ---------------------------------------------------- */
  lunaTravel.screens.push({
    id: 'install',
    name: 'Getting it',
    blurb: 'A link, not an app store.',
    html:
      statusBar +
      '<div class="lt-install">' +
        '<span class="lt-inst-mark">TD</span>' +
        '<b class="lt-inst-h" data-hs="inst-h">Travel Demo</b>' +
        '<small class="lt-inst-s">Your Maldives trip, ready to install</small>' +
        '<span class="lt-inst-btn" data-hs="inst-btn">Add to home screen</span>' +
        '<span class="lt-inst-note" data-hs="inst-note">Works offline once installed</span>' +
        '<span class="lt-pillup" data-hs="inst-pill">New version available</span>' +
      '</div>',
    hotspots: [
      {
        anchor: 'inst-btn',
        at: 'outside-right',
        title: 'No app store in the way',
        feature:
          'The traveller opens a link the agency sends, often as a QR code from the CRM, and adds it to ' +
          'their home screen. There is no download, no account to create and no store review to wait for.',
        benefit:
          'The drop off between the agency sending it and the traveller having it is a single tap, instead ' +
          'of a store search a third of people never finish.'
      },
      {
        anchor: 'inst-h',
        at: 'outside-right',
        title: 'It installs as the agency',
        feature: 'The icon, name and splash on the home screen are the agency’s, not Travelgenix’s.',
        benefit:
          'The agency has an icon on their client’s home screen. Very few small travel businesses will ' +
          'ever get that any other way.'
      },
      {
        anchor: 'inst-note',
        at: 'outside-right',
        title: 'Offline once it is on there',
        feature:
          'The app shell, the trip, the map and the documents are all available with no connection.',
        benefit:
          'It works in the air, in a resort with bad wifi and abroad with data switched off, which is ' +
          'exactly when a traveller needs their ticket.'
      },
      {
        anchor: 'inst-pill',
        at: 'outside-right',
        title: 'It tells them when it has changed',
        feature:
          'A new version prompt appears when one ships, and taking it does a genuine clean reload rather ' +
          'than a refresh that serves the old app back.',
        benefit: 'Everyone is on the current version without the agency chasing anyone.'
      }
    ]
  });

  window.TG_SHOWCASE = { version: '1.0.0', products: [lunaTravel] };
})();
