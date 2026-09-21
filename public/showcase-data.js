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
            '<span class="lt-tile-v lt-tile-v--sm">Heathrow to Abu Dhabi</span>' +
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
        title: 'Your name on their home screen',
        feature:
          'Every screen carries the agency\u2019s own logo, colours and name. Travelgenix appears ' +
          'nowhere the traveller can see.',
        benefit:
          'For a fortnight their client is looking at their brand, at the point in the year they are ' +
          'most likely to be telling friends about the holiday.',
        edge: 'Vamoos sells branding as a tier. Here it is simply how the app arrives.'
      },
      {
        anchor: 'agent-banner',
        title: 'Reach them when it matters',
        feature:
          'A message sent from the agency lands at the top of the home screen, colour coded by how ' +
          'urgent it is. Red for now, amber for soon, teal for the rest.',
        benefit:
          'A moved transfer or a gate change reaches the traveller on the screen already in their ' +
          'hand, instead of an email they will read once they land.'
      },
      {
        anchor: 'bell',
        at: 'top-left',
        title: 'Nothing sits unread',
        feature:
          'The unread count refreshes whenever the app comes back to the front, so it is right ' +
          'without anyone pulling to refresh.',
        benefit:
          'The agency can be confident a message was seen, which is the difference between telling ' +
          'someone and hoping.'
      },
      {
        anchor: 'trip-hero',
        at: 'bottom-right',
        title: 'The booking fills it in',
        feature:
          'Reference, dates, flights, hotels and extras all arrive from the booking itself. Nobody ' +
          'retypes a thing.',
        benefit:
          'A branded trip app for a holiday already sold, with no back office work and nothing to ' +
          'keep in step by hand.'
      },
      {
        anchor: 'countdown',
        at: 'top-left',
        title: 'Something to open before they fly',
        feature:
          'A live count of the days left, taken from the booking\u2019s own dates.',
        benefit:
          'It gives the traveller a reason to come back in the weeks before departure, which is when ' +
          'lounge passes, transfers and upgrades still sell.'
      },
      {
        anchor: 'weather',
        at: 'top-left',
        title: 'The question they always ask',
        feature:
          'Live conditions where they are going, on the first screen they see.',
        benefit:
          'Every agent answers this one a dozen times a week. Now it answers itself.'
      },
      {
        anchor: 'nextup',
        at: 'top-right',
        title: 'What happens next, without hunting',
        feature:
          'The next thing due is lifted out of the itinerary onto the home screen. Tonight\u2019s ' +
          'flight, tomorrow\u2019s transfer, the last morning\u2019s checkout.',
        benefit:
          'They open the app and have their answer, rather than scrolling a fortnight of detail to ' +
          'work out what today holds.'
      },
      {
        anchor: 'call-agent',
        title: 'One tap back to a person',
        feature:
          'Call and email buttons built from the agency\u2019s own number and address, shown only ' +
          'when they are on file.',
        benefit:
          'When something goes wrong at eleven at night the agency is one tap away, not a name the ' +
          'traveller has to go looking for.'
      },
      {
        anchor: 'guide',
        title: 'They look like they know the place',
        feature:
          'Destination guides drawn from the Travelgenix content database, matched to where the ' +
          'traveller is actually going.',
        benefit:
          'The same content that fills the agency\u2019s website works a second time here, and nobody ' +
          'has to write a word of it.'
      },
      {
        anchor: 'tabbar',
        title: 'Five tabs, and it stays at five',
        feature:
          'Home, Trip, Map, Docs and Me. New things go inside a tab rather than becoming a sixth.',
        benefit:
          'A traveller who used it last year still knows where everything is. The app gets better ' +
          'without getting harder.'
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
          '<span class="lt-day-h"><b>Day 2</b><small>Fri 3 Oct · Baa Atoll, Maldives</small></span>' +
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
          '<span class="lt-sb-art lt-art--shore"></span>' +
          '<span class="lt-sb-copy"><b>Day 3 · At leisure</b><small>Baa Atoll, Maldives</small></span>' +
        '</div>' +
      '</div>' +
      tabBar('itinerary'),
    hotspots: [
      {
        anchor: 'seg',
        title: 'A schedule, or a story',
        feature:
          'The same trip told two ways. Timeline is the practical list of what happens when. ' +
          'Storyboard turns it into a day by day account with a picture and a headline for each one.',
        benefit:
          'One is for the airport queue. The other is the one they show people when they get home.'
      },
      {
        anchor: 'daygroup',
        title: 'Days that match their days',
        feature:
          'Day one is the day they fly, wherever in the world they happen to be reading it.',
        benefit:
          'It sounds obvious. Getting it wrong puts a phantom day at the front of the holiday, and ' +
          'travellers spot it immediately.'
      },
      {
        anchor: 'ev-flight',
        title: 'As booked, down to the seat',
        feature:
          'Flight numbers, terminals, seats, room type, board basis and check in times, every one of ' +
          'them read from the booking.',
        benefit:
          'The agency stops answering what time is my flight forty times a week, because the answer ' +
          'is already in the traveller\u2019s pocket.'
      },
      {
        anchor: 'storyboard',
        title: 'A holiday, not a spreadsheet',
        feature:
          'Each day gets a plain headline and a picture. Travel day, arrive, at leisure, departure.',
        benefit:
          'This is the screen that gets shown to other people, which makes it the one that brings the ' +
          'agency its next enquiry.'
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
      /* The map draws twice over. `.lt-map-world` is a real web-mercator frame
         at zoom 2: the tiles, the flight path and the three pins all sit at
         their true projected pixel, so the picture is geography rather than
         decoration. Behind it, three soft shapes stand in for land. Online the
         basemap draws and the shapes are hidden. Offline it is never asked for,
         the shapes stay, and the demo proves the badge instead of claiming it. */
      '<div class="lt-map" data-hs="map-canvas">' +
        '<span class="lt-map-land lt-map-land--a"></span>' +
        '<span class="lt-map-land lt-map-land--b"></span>' +
        '<span class="lt-map-land lt-map-land--c"></span>' +
        '<div class="lt-map-world">' +
          '<span class="lt-map-tiles"></span>' +
          '<svg class="lt-map-route" viewBox="0 0 1280 960" aria-hidden="true">' +
            '<path d="M638 426 Q736 446 834 550 Q867 569 900 622" />' +
          '</svg>' +
          '<span class="lt-pin lt-pin--1" data-hs="pin-airport"><b>London Heathrow</b></span>' +
          '<span class="lt-pin lt-pin--2 lt-pin--flip"><b>Abu Dhabi</b></span>' +
          '<span class="lt-pin lt-pin--3 lt-pin--hotel lt-pin--flip" data-hs="pin-hotel">' +
            '<b>Reethi Beach Resort</b></span>' +
        '</div>' +
        '<span class="lt-map-credit">\u00a9 OpenStreetMap contributors</span>' +
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
        title: 'A map that works at 38,000 feet',
        feature:
          'The map is built into the app. It draws in flight mode, in a resort with one bar, and ' +
          'abroad with data switched off.',
        benefit:
          'Which is exactly when someone wants to see how far the hotel is from the airport. It also ' +
          'costs the agency nothing per view, because there is no map service behind it.'
      },
      {
        anchor: 'map-canvas',
        title: 'Nothing to ask permission for',
        feature:
          'It plots the booking, never the traveller. The app never asks the phone where it is.',
        benefit:
          'No permission box on first open, and no location data to hold or to explain in a privacy ' +
          'policy.'
      },
      {
        anchor: 'pin-airport',
        at: 'top-left',
        title: 'Every airport, placed properly',
        feature:
          'Suppliers send three letter codes with no coordinates, so the app carries its own list and ' +
          'puts each airport where it belongs.',
        benefit:
          'Without it the flights would not appear on the map at all.'
      },
      {
        anchor: 'pin-hotel',
        title: 'How far is the hotel, really',
        feature:
          'The hotel is pinned at its true position, taken straight from the booking.',
        benefit:
          'The transfer question, answered as a picture, before anyone has to ask it.'
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
        title: 'Tickets that open at the gate',
        feature:
          'Every document opens inside the app, full size and readable, on any phone.',
        benefit:
          'Most travel apps throw the traveller out to a file viewer here, because phones make the ' +
          'easy way impossible. This one does the harder version so nobody notices.'
      },
      {
        anchor: 'pdf-brand',
        title: 'The agency\u2019s name at the check in desk',
        feature:
          'Generated documents carry the agency\u2019s name and colours, the same as every other ' +
          'screen.',
        benefit:
          'The thing handed over at a desk has their brand on it. There is no better piece of ' +
          'advertising in the whole trip.'
      },
      {
        anchor: 'doc-acts',
        title: 'Always a way out',
        feature:
          'Open full screen and download sit under every document.',
        benefit:
          'If one awkward handset struggles, the traveller still gets their file. Nobody is left ' +
          'stuck at an airport.'
      },
      {
        anchor: 'doc-item',
        title: 'Upload once, and it is there',
        feature:
          'The agent attaches documents from the CRM, next to the booking they belong to, and they ' +
          'appear on the phone.',
        benefit:
          'No more sending a six megabyte attachment and hoping. The agency can see it arrived.'
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
        title: 'It answers from their actual booking',
        feature:
          'Ask about the flight, the room, the board basis or the dates and it answers from the trip ' +
          'they are really on.',
        benefit:
          'The answers are right because they come from the booking. There is nothing for the agency ' +
          'to keep updated and nothing to correct afterwards.'
      },
      {
        anchor: 'luna-honest',
        title: 'It says when it does not know',
        feature:
          'When it cannot answer it says so plainly. No cheerful non answer, no unrelated suggestions ' +
          'to look busy.',
        benefit:
          'A confident wrong answer about a visa or a cot is how an agency loses a client. Admitting ' +
          'it costs nothing.'
      },
      {
        anchor: 'luna-handoff',
        title: 'The dead end becomes a conversation',
        feature:
          'Not knowing produces two buttons: email the agent with the booking reference already ' +
          'filled in, or ring them.',
        benefit:
          'An unanswered question turns into contact with the agency rather than a bad review, and ' +
          'the agent opens an email that already says which trip it is about.'
      },
      {
        anchor: 'luna-composer',
        title: 'It works with no signal, every time',
        feature:
          'The assistant runs inside the app rather than calling out to anything.',
        benefit:
          'No waiting, no invented answers, no leaning on the resort wifi. It behaves the same on a ' +
          'stand as it does in the Maldives.'
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
          'English, Romanian, French, German, Spanish and Italian. The app picks one from the phone ' +
          'on first open and remembers any change.',
        benefit:
          'A traveller who does not read English gets a usable app without setting anything up, and ' +
          'the agency does not need a second product to sell abroad.'
      },
      {
        anchor: 'me-lang',
        title: 'What is deliberately left alone',
        feature:
          'Room names, references, dates and supplier wording are never translated. Only the ' +
          'app\u2019s own words change.',
        benefit:
          'A helpfully translated room name is a traveller turned away at a desk. Anything that has ' +
          'to match the supplier stays exactly as the supplier wrote it.'
      },
      {
        anchor: 'me-badge',
        title: 'A way back in',
        feature:
          'Unread messages from the agency show as a count on the app\u2019s own icon.',
        benefit:
          'The agency has a route back to a client\u2019s attention that costs nothing and does not ' +
          'depend on an email being opened.'
      },
      {
        anchor: 'me-update',
        title: 'Fixes actually arrive',
        feature:
          'An update clears everything the phone was holding and loads the new version properly.',
        benefit:
          'Something asked for on Monday is on the traveller\u2019s phone, rather than stuck behind a ' +
          'cache nobody can clear down a phone line.'
      },
      {
        anchor: 'me-travellers',
        title: 'The whole party, not the lead name',
        feature:
          'Everyone on the booking is listed, so the trip belongs to the family rather than to ' +
          'whoever paid.',
        benefit:
          'Groups stop relaying everything through one person, which is where details go missing.'
      },
      {
        anchor: 'me-version',
        title: 'Support calls start with a fact',
        feature:
          'The version sits at the bottom of the screen, with a check for updates directly above it.',
        benefit:
          'The agent asks what it says at the bottom and knows immediately, instead of guessing.'
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
        title: 'The next holiday, while this one is still warm',
        feature:
          'When the trip is over the app turns to where they might go next.',
        benefit:
          'A warm second sale to a client who is already theirs, at the moment they are most likely ' +
          'to say yes, and it costs nothing to reach them.'
      },
      {
        anchor: 'insp-cards',
        title: 'The agency chooses what is pushed',
        feature:
          'Agencies swap the promoted destinations for their own.',
        benefit:
          'They put forward the trips they actually make money on, rather than whatever a generic app ' +
          'decides to show.'
      },
      {
        anchor: 'insp-price',
        title: 'A guide price, never a quote',
        feature:
          'The from price is wording the agency writes. It is deliberately not wired to live ' +
          'availability.',
        benefit:
          'Nothing here can be mistaken for a booking price, so an inspiration screen cannot turn ' +
          'into a complaint.'
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
          'The traveller opens a link, usually a QR code from the agency, and adds it to their home ' +
          'screen. No download, no account, no store.',
        benefit:
          'The gap between sending it and them having it is one tap, instead of a store search a ' +
          'third of people never finish.'
      },
      {
        anchor: 'inst-h',
        at: 'outside-right',
        title: 'An icon on their home screen',
        feature:
          'The icon, the name and the splash screen are the agency\u2019s.',
        benefit:
          'Very few small travel businesses will ever get a place on a client\u2019s home screen any ' +
          'other way.'
      },
      {
        anchor: 'inst-note',
        at: 'outside-right',
        title: 'It keeps working when the signal stops',
        feature:
          'The trip, the map and the documents are all there with no connection at all.',
        benefit:
          'In the air, in a resort with poor wifi, abroad with data off. Which is precisely when a ' +
          'ticket is needed.'
      },
      {
        anchor: 'inst-pill',
        at: 'outside-right',
        title: 'Everyone ends up on the current version',
        feature:
          'The app says when a new version is ready and takes it properly.',
        benefit:
          'Nobody has to be chased, and the agency never ends up supporting three versions at once.'
      }
    ]
  });

  window.TG_SHOWCASE = { version: '1.0.0', products: [lunaTravel] };
})();
