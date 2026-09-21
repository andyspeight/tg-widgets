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
    tile: '/showcase/img/story.webp',    /* the face it wears on the chooser */
    splash: '/showcase/img/splash.webp',  /* and behind its own front door */
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
      /* The picture runs from the very top of the screen, with the status bar
         and the app bar sitting on it and the greeting, the trip and the
         countdown at its foot. It was a 168px card under a notification,
         which is not what a traveller opens their holiday app to see. */
      '<div class="lt-topshot" data-hs="trip-hero">' +
        '<span class="lt-topshot-art lt-art--hero"></span>' +
        statusBar +
        '<header class="lt-appbar lt-appbar--shot">' +
          '<span class="lt-brandmark" data-hs="brand">TD</span>' +
          '<span class="lt-brandtext"><strong>Travel Demo</strong><small>Your trip, in your pocket</small></span>' +
          '<span class="lt-bell" data-hs="bell"><span class="lt-bell-dot">2</span></span>' +
        '</header>' +
        '<div class="lt-topshot-copy">' +
          '<span class="lt-welcome">Good morning, Sarah</span>' +
          '<strong>Maldives</strong>' +
          '<small>2 to 17 Oct 2026 · 12 nights · DEMO81297</small>' +
        '</div>' +
        '<span class="lt-countdown" data-hs="countdown"><b>13</b><small>days to go</small></span>' +
      '</div>' +
      '<div class="lt-body lt-body--shot">' +
        '<div class="lt-banner lt-banner--urgent" data-hs="agent-banner">' +
          '<span class="lt-banner-tag">Urgent</span>' +
          '<p>Your resort transfer now leaves at 14:20, from speedboat jetty 2.</p>' +
          '<span class="lt-banner-act">Mark as read</span>' +
        '</div>' +
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


  /* ================================================================ *
   * Luna Chat
   *
   * Two surfaces, and the walkthrough shows both. Where the point is the
   * RELATIONSHIP between them, a visitor's question landing in an agent's
   * inbox, they are drawn side by side: that is one event, and cutting
   * between two screens loses it.
   * ================================================================ */

  /* The agency's own website, which is the thing Luna sits on. Reused across
     every visitor-side screen so the chat is the only thing that moves. */
  function lcSite(inner) {
    return '<div class="lc-site">' +
      '<div class="lc-sitebar">' +
        '<span class="lc-logo" data-hs="lc-brand">Travel<em>Demo</em></span>' +
        '<nav class="lc-nav"><b>Holidays</b><span>Flights</span><span>Cruise</span>' +
          '<span>Offers</span><span>About us</span></nav>' +
        '<span class="lc-sitecta">01482 123456</span>' +
      '</div>' +
      '<div class="lc-hero">' +
        '<span class="lc-hero-art lt-art--hero"></span>' +
        '<div class="lc-hero-copy">' +
          '<strong>Somewhere warm,<br>sorted properly.</strong>' +
          '<span>Handpicked holidays from people who have actually been.</span>' +
        '</div>' +
      '</div>' +
      '<div class="lc-searchbar">' +
        '<span class="lc-field"><small>Going to</small><span>Anywhere</span></span>' +
        '<span class="lc-field"><small>When</small><span>Oct 2026</span></span>' +
        '<span class="lc-field"><small>Who</small><span>2 adults, 2 children</span></span>' +
        '<span class="lc-searchgo">Search</span>' +
      '</div>' +
      '<div class="lc-offers">' +
        '<span class="lc-offer"><span class="lc-offer-art lt-art--atoll"></span>' +
          '<span class="lc-offer-body"><b>Maldives</b><small>7 nights, all inclusive</small><i>&pound;1,449pp</i></span></span>' +
        '<span class="lc-offer"><span class="lc-offer-art lt-art--dunes"></span>' +
          '<span class="lc-offer-body"><b>Oman</b><small>5 nights, B&amp;B</small><i>&pound;879pp</i></span></span>' +
        '<span class="lc-offer"><span class="lc-offer-art lt-art--isle"></span>' +
          '<span class="lc-offer-body"><b>Sri Lanka</b><small>10 nights, tour</small><i>&pound;1,720pp</i></span></span>' +
      '</div>' +
      inner +
    '</div>';
  }

  function lcPanelHead(who) {
    return '<div class="lc-panel-head" data-hs="lc-head">' +
      '<span class="lc-avatar">TD</span>' +
      '<span class="lc-panel-who"><strong>' + who + '</strong><small>Travel Demo</small></span>' +
      '<span class="lc-live">Online</span>' +
    '</div>';
  }

  var lunaChat = {
    id: 'luna-chat',
    name: 'Luna Chat',
    category: 'Luna Suite',
    status: 'Live',
    version: 'v2.4',
    url: 'traveldemo.co.uk',
    tagline: 'Answers your visitors all night. Hands you the ones worth a human.',
    summary:
      'An AI travel expert on the agency’s own website, answering from knowledge they have ' +
      'approved, in their own voice. It holds a real conversation, works out what the customer ' +
      'actually wants, and turns it into a bookable search on their own booking engine. When it ' +
      'reaches the edge of what it should handle it passes the conversation to a human, in an ' +
      'inbox that also carries their WhatsApp.',
    device: 'browser',
    tile: '/showcase/img/chat-tile.webp',
    splash: '/showcase/img/chat-splash.webp',
    qr: {
      url: 'https://chat.travelify.io/widget-demo.html?client=Travel%20Demo',
      heading: 'Talk to it yourself',
      note: 'Scan to open the live demo and ask it anything. It answers from real knowledge.'
    },
    screens: []
  };

  /* -- 1. On your website ------------------------------------------ */
  lunaChat.screens.push({
    id: 'site',
    name: 'On your site',
    blurb: 'One script tag, and it wears the agency’s name rather than ours.',
    html: lcSite(
      '<div class="lc-panel">' +
        lcPanelHead('Ask Travel Demo') +
        '<div class="lc-thread">' +
          '<div class="lc-msg lc-msg--luna" data-hs="lc-welcome">Good evening. I know the places ' +
            'we sell rather well, so ask me anything. Where are you thinking of going?</div>' +
          '<div class="lc-chips" data-hs="lc-hints">' +
            '<span class="lc-chip">Family holiday to Tenerife</span>' +
            '<span class="lc-chip">Maldives in October</span>' +
            '<span class="lc-chip">Find my booking</span>' +
          '</div>' +
        '</div>' +
        '<div class="lc-composer" data-hs="lc-composer">' +
          '<span class="lc-input">Ask about anywhere...</span>' +
          '<span class="lc-send"></span>' +
        '</div>' +
        '<div class="lc-foot" data-hs="lc-foot">Powered by Travel Demo</div>' +
      '</div>'
    ),
    hotspots: [
      {
        anchor: 'lc-welcome',
        at: 'top-left',
        title: 'Open at eleven at night',
        feature:
          'Most holiday research happens in the evening and at weekends, long after the phones ' +
          'stop. Luna is there for all of it, holding a real conversation rather than offering a ' +
          'menu of four buttons.',
        benefit:
          'The enquiry that used to sit in a form until Tuesday gets answered while they are still ' +
          'interested. Nobody has to sit up for it.'
      },
      {
        anchor: 'lc-brand',
        at: 'bottom-right',
        title: 'It is their agency, not ours',
        feature:
          'The name, the colours, the greeting and the assistant’s own name are all the ' +
          'client’s. Their customers need never see the word Luna.',
        benefit:
          'A specialist’s whole value is that they know the destination. A bot with somebody ' +
          'else’s branding on it makes them look like everyone else.'
      },
      {
        anchor: 'lc-hints',
        title: 'It suggests what to ask',
        feature:
          'An empty message box is the commonest reason a chat never starts. These openers are the ' +
          'agency’s own, and one tap begins a proper conversation.',
        benefit:
          'More visitors say something at all, which is the only step that matters before any of ' +
          'the rest can happen.'
      },
      {
        anchor: 'lc-head',
        at: 'outside-left',
        title: 'Installed in a minute',
        feature:
          'One script tag on the site, and a setup screen for the colours, the name and the ' +
          'welcome. No plugin, no developer, no rebuild.',
        benefit:
          'Whoever looks after the website can put it live this afternoon, on any platform.'
      },
      {
        anchor: 'lc-foot',
        at: 'outside-left',
        title: 'Even the footer is theirs',
        feature:
          'The line along the bottom is a setting like everything else, so it can carry the ' +
          'agency’s own words or nothing at all.',
        benefit:
          'Nothing on the widget sells anybody but them.'
      }
    ]
  });

  /* -- 2. The conversation ------------------------------------------ */
  lunaChat.screens.push({
    id: 'talk',
    name: 'The conversation',
    blurb: 'It works out what they actually want, the way an agent would.',
    html: lcSite(
      '<div class="lc-panel">' +
        lcPanelHead('Ask Travel Demo') +
        '<div class="lc-thread">' +
          '<div class="lc-msg lc-msg--them">Somewhere hot in October, two of us and the kids</div>' +
          '<div class="lc-msg lc-msg--luna">October is a lovely month for it. Are the children ' +
            'school age, and roughly what were you hoping to spend?</div>' +
          '<div class="lc-msg lc-msg--them">Yeah, 7 and 11. Maybe two and a half grand all in</div>' +
          '<div class="lc-msg lc-msg--luna" data-hs="lc-know">Half term then, so the 24th onwards. ' +
            'For that budget in October I would look at the Canaries or Egypt. We use the Sunrise ' +
            'in Hurghada a lot for families that age, it has the slides and the shallow pool.</div>' +
          '<div class="lc-brief" data-hs="lc-brief">' +
            '<span class="lc-brief-t">Trip so far</span>' +
            '<span class="lc-chips">' +
              '<span class="lc-chip">October, half term</span>' +
              '<span class="lc-chip">2 adults, 2 children</span>' +
              '<span class="lc-chip">Ages 7 and 11</span>' +
              '<span class="lc-chip">Around &pound;2,500</span>' +
              '<span class="lc-chip lc-chip--empty">Airport?</span>' +
            '</span>' +
          '</div>' +
        '</div>' +
        '<div class="lc-composer">' +
          '<span class="lc-input">Ask about anywhere...</span>' +
          '<span class="lc-send"></span>' +
        '</div>' +
        '<div class="lc-foot">Powered by Travel Demo</div>' +
      '</div>'
    ),
    hotspots: [
      {
        anchor: 'lc-brief',
        at: 'top-left',
        title: 'It is filling in a booking form without asking anyone to',
        feature:
          'Destination, dates, who is travelling, ages, budget and departure airport are all ' +
          'collected as the conversation goes, not demanded up front on a form.',
        benefit:
          'A form asks eleven questions before it gives anything back, which is why most of them ' +
          'are abandoned. This one gives a useful answer at every step and still ends up knowing ' +
          'everything.'
      },
      {
        anchor: 'lc-know',
        at: 'outside-left',
        title: 'It knows what the agency knows',
        feature:
          'The hotel it named, and why it suits a 7 and an 11 year old, came out of knowledge the ' +
          'agency wrote and approved. Anything it cannot ground in that, it says it will find out ' +
          'rather than guessing.',
        benefit:
          'A specialist sounds like a specialist. The thirty years of knowing which resort suits ' +
          'which family stops living in one person’s head.'
      },
      {
        anchor: 'lc-know',
        at: 'bottom-right',
        title: 'And it keeps checking its own facts',
        feature:
          'Saved answers are re-read against their sources on a schedule. When one stops being ' +
          'true it goes into a queue for a human to approve, never silently changed.',
        benefit:
          'The honest worry about AI is that it confidently says something wrong. This is the part ' +
          'that answers it, and nothing else in this market does it.'
      }
    ]
  });

  /* -- 3. The search ------------------------------------------------- */
  lunaChat.screens.push({
    id: 'search',
    name: 'The search',
    blurb: 'The thing a website chatbot cannot do: produce a real bookable search.',
    html: lcSite(
      '<div class="lc-panel">' +
        lcPanelHead('Ask Travel Demo') +
        '<div class="lc-thread">' +
          '<div class="lc-msg lc-msg--them">Manchester would be easiest</div>' +
          '<div class="lc-msg lc-msg--luna">Then here is exactly that, ready to look at. Prices ' +
            'are live, so have a scroll and tell me which ones you like.</div>' +
          '<div class="lc-card" data-hs="lc-deep">' +
            '<span class="lc-card-head">Your search, ready</span>' +
            '<span class="lc-card-body">' +
              '<strong>Hurghada, 24 Oct, 7 nights</strong>' +
              '<small>From Manchester &middot; 2 adults, 2 children (7, 11) &middot; All inclusive ' +
              '&middot; Up to &pound;2,500</small>' +
            '</span>' +
            '<span class="lc-card-go" data-hs="lc-go">See 34 holidays</span>' +
          '</div>' +
          '<div class="lc-msg lc-msg--luna">If none of them land, tell me what is wrong with them ' +
            'and I will change the search.</div>' +
        '</div>' +
        '<div class="lc-composer">' +
          '<span class="lc-input">Ask about anywhere...</span>' +
          '<span class="lc-send"></span>' +
        '</div>' +
        '<div class="lc-foot">Powered by Travel Demo</div>' +
      '</div>'
    ),
    hotspots: [
      {
        anchor: 'lc-deep',
        at: 'top-left',
        title: 'This is the one to show people',
        feature:
          'That button opens the agency’s own booking engine with every field already filled ' +
          'in. Not a link to a home page, not a summary of what they said. The search itself.',
        benefit:
          'A generic chatbot deflects tickets. This one hands a customer a set of holidays they ' +
          'can book, on the agency’s own site, at midnight.',
        edge:
          'Ask any other chatbot to plan a family holiday to Tenerife in October and see whether ' +
          'it produces a bookable search. That is the whole demonstration.'
      },
      {
        anchor: 'lc-deep',
        at: 'outside-left',
        title: 'And the link still works next week',
        feature:
          'The dates are worked out relative to today rather than written into the link, and the ' +
          'search area is corrected server side against the agency’s own geography so a Luna ' +
          'search covers the same ground as the same search on their site.',
        benefit:
          'A link that has gone stale or lands somewhere slightly wrong costs a booking quietly, ' +
          'and nobody ever reports it.'
      },
      {
        anchor: 'lc-go',
        at: 'bottom-right',
        title: 'It never sends the business anywhere else',
        feature:
          'Luna is under an absolute instruction never to name a competitor, asked or unasked, and ' +
          'every search it builds points at the agency’s own engine.',
        benefit:
          'The fear is that an AI helpfully suggests booking elsewhere. It cannot.'
      }
    ]
  });

  /* -- 4. Where it stops ---------------------------------------------- */
  lunaChat.screens.push({
    id: 'limits',
    name: 'Where it stops',
    blurb: 'The subjects it refuses to have an opinion about.',
    html: lcSite(
      '<div class="lc-panel">' +
        lcPanelHead('Ask Travel Demo') +
        '<div class="lc-thread">' +
          '<div class="lc-msg lc-msg--them">Is Egypt actually safe at the moment?</div>' +
          '<div class="lc-msg lc-msg--luna" data-hs="lc-refuse">That is not mine to judge, and I ' +
            'would not want you taking my word for it. Here is what the Foreign Office says today, ' +
            'straight from them.</div>' +
          '<div class="lc-card lc-card--fcdo" data-hs="lc-fcdo">' +
            '<span class="lc-card-head">Foreign Office advice</span>' +
            '<span class="lc-card-body">' +
              '<strong>Egypt</strong>' +
              '<small>Advises against all but essential travel to parts of the country. Hurghada ' +
              'and the Red Sea resorts are not among them.</small>' +
            '</span>' +
            '<span class="lc-card-go" data-hs="lc-fcdo-go">Read it on gov.uk</span>' +
          '</div>' +
          '<div class="lc-msg lc-msg--luna">If you would rather talk it through with someone here, ' +
            'say the word and I will fetch them.</div>' +
        '</div>' +
        '<div class="lc-composer">' +
          '<span class="lc-input">Ask about anywhere...</span>' +
          '<span class="lc-send"></span>' +
        '</div>' +
        '<div class="lc-foot">Powered by Travel Demo</div>' +
      '</div>'
    ),
    hotspots: [
      {
        anchor: 'lc-refuse',
        at: 'top-left',
        title: 'It never gives a safety opinion',
        feature:
          'Asked whether somewhere is safe, Luna does not answer. The server attaches the official ' +
          'Foreign Office status instead and points at the page it came from.',
        benefit:
          'This is the question every agency worries about an AI answering. It is the one question ' +
          'it is not allowed to have a view on.'
      },
      {
        anchor: 'lc-fcdo',
        at: 'outside-left',
        title: 'Straight from the source, not from memory',
        feature:
          'The status is written to the knowledge base from the Foreign Office itself, word for ' +
          'word, with no model anywhere near it, and refreshed on a schedule.',
        benefit:
          'A model recalling what the advice used to be is worse than useless on this subject. ' +
          'This is the current text or it is nothing.'
      },
      {
        anchor: 'lc-fcdo-go',
        at: 'bottom-right',
        title: 'And it offers a human the moment it matters',
        feature:
          'Luna escalates on subjects it should not carry, and whenever the visitor asks.',
        benefit:
          'Knowing where to stop is what makes the rest of it trustworthy.'
      }
    ]
  });

  /* -- 5. Handing it over, both sides at once ------------------------ */
  lunaChat.screens.push({
    id: 'handover',
    name: 'The handover',
    blurb: 'The moment a conversation becomes a lead, from both sides.',
    html:
      '<div class="lc-split">' +
        '<div class="lc-half">' +
          '<span class="lc-vlabel">Your customer</span>' +
          '<div class="lc-vpane">' +
            '<div class="lc-panel lc-panel--inline">' +
              lcPanelHead('Ask Travel Demo') +
              '<div class="lc-thread">' +
                '<div class="lc-msg lc-msg--them" data-hs="lc-ask">Can I speak to an actual ' +
                  'person about the flights?</div>' +
                '<div class="lc-msg lc-msg--luna">Of course. Give me one second.</div>' +
                '<div class="lc-msg lc-msg--agent" data-hs="lc-agent">' +
                  '<span class="lc-msg-by">Claire, Travel Demo</span>' +
                  'Hi, Claire here. I have read the whole thread, so no need to start again. ' +
                  'Manchester flights on the 24th, was it?</div>' +
              '</div>' +
              '<div class="lc-composer">' +
                '<span class="lc-input">Type a message...</span>' +
                '<span class="lc-send"></span>' +
              '</div>' +
              '<div class="lc-foot">Powered by Travel Demo</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="lc-half lc-split-seam">' +
          '<span class="lc-vlabel">Your inbox</span>' +
          '<div class="lc-dash">' +
            '<div class="lc-rail">' +
              '<div class="lc-railhead"><strong>Travel Demo</strong><small>Claire, online</small></div>' +
              '<div class="lc-conv is-live" data-hs="lc-arrive">' +
                '<span class="lc-conv-av">SB</span>' +
                '<span class="lc-conv-b"><b>Sarah B.</b><span>Can I speak to an actual...</span></span>' +
                '<span class="lc-unread">1</span>' +
              '</div>' +
              '<div class="lc-conv">' +
                '<span class="lc-conv-av">DM</span>' +
                '<span class="lc-conv-b"><b>Dan M.</b><span>Thanks, that is great</span></span>' +
                '<span class="lc-conv-when">14m</span>' +
              '</div>' +
              '<div class="lc-conv">' +
                '<span class="lc-conv-av lc-conv-av--wa">JP</span>' +
                '<span class="lc-conv-b"><b>Jo P.</b><span>Sent the passport photos</span></span>' +
                '<span class="lc-conv-when">1h</span>' +
              '</div>' +
            '</div>' +
            '<div class="lc-stage">' +
              '<div class="lc-stagehead">' +
                '<strong>Sarah B.</strong>' +
                '<span class="lc-tag" data-hs="lc-context">Hurghada &middot; 24 Oct &middot; 2+2</span>' +
                '<span class="lc-tag lc-tag--ai">Luna handled 9 messages</span>' +
              '</div>' +
              '<div class="lc-stagebody">' +
                '<div class="lc-msg lc-msg--luna" data-hs="lc-thread-full">' +
                  '<span class="lc-msg-by">The whole conversation, already here</span>' +
                  'October, half term, two adults and two children aged 7 and 11, around ' +
                  '&pound;2,500, flying from Manchester. Searched Hurghada, opened 34 holidays.</div>' +
                '<div class="lc-msg lc-msg--them">Can I speak to an actual person about the flights?</div>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>',
    hotspots: [
      {
        anchor: 'lc-arrive',
        at: 'outside-left',
        title: 'It only fetches you for the ones worth fetching you for',
        feature:
          'Luna handles the conversation on its own and escalates when it should, or the moment ' +
          'the visitor asks. Out of hours the lead arrives by email instead.',
        benefit:
          'Nobody has to watch a chat window all day. The agency is interrupted for the ones that ' +
          'are actually worth being interrupted for.'
      },
      {
        anchor: 'lc-thread-full',
        at: 'top-left',
        title: 'They do not have to start again',
        feature:
          'The whole conversation, and everything Luna worked out from it, is already on the ' +
          'screen when the agent picks it up.',
        benefit:
          'The worst handover in any business is the one where the customer repeats themselves to ' +
          'a second person. This one never happens.'
      },
      {
        anchor: 'lc-agent',
        at: 'outside-right',
        title: 'And on their side, a person simply joins in',
        feature:
          'No new window, no ticket number, no "your reference is". The same conversation carries ' +
          'on with a human name on it.',
        benefit:
          'The customer never sees the join. They just notice the answers got better.'
      },
      {
        anchor: 'lc-context',
        title: 'The chat is tagged with what it is about',
        feature:
          'Destination, dates and party size are carried on the conversation itself.',
        benefit:
          'Somebody scanning a busy inbox can tell what each one is worth before opening it.'
      }
    ]
  });

  /* -- 6. Helping the agent, both sides at once ---------------------- */
  lunaChat.screens.push({
    id: 'copilot',
    name: 'Copilot',
    blurb: 'The AI carries on helping after a human takes over. The customer never sees it.',
    html:
      '<div class="lc-split">' +
        '<div class="lc-half">' +
          '<span class="lc-vlabel">Your customer</span>' +
          '<div class="lc-vpane">' +
            '<div class="lc-panel lc-panel--inline">' +
              lcPanelHead('Ask Travel Demo') +
              '<div class="lc-thread">' +
                '<div class="lc-msg lc-msg--them">Is the Sunrise any good for an 11 year old? ' +
                  'He is a fussy eater</div>' +
                '<div class="lc-msg lc-msg--agent" data-hs="lc-sent">' +
                  '<span class="lc-msg-by">Claire, Travel Demo</span>' +
                  'Honestly, yes. There are five restaurants and the buffet always has pasta and ' +
                  'chips, which covers most fussy eaters. The kids’ club does its own menu ' +
                  'too.</div>' +
                '<span class="lc-tick">Read &check;&check;</span>' +
              '</div>' +
              '<div class="lc-composer">' +
                '<span class="lc-input">Type a message...</span>' +
                '<span class="lc-send"></span>' +
              '</div>' +
              '<div class="lc-foot">Powered by Travel Demo</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="lc-half lc-split-seam">' +
          '<span class="lc-vlabel">What Claire sees</span>' +
          '<div class="lc-dash">' +
            '<div class="lc-rail">' +
              '<div class="lc-railhead"><strong>Travel Demo</strong><small>Claire, online</small></div>' +
              '<div class="lc-conv is-live">' +
                '<span class="lc-conv-av">SB</span>' +
                '<span class="lc-conv-b"><b>Sarah B.</b><span>Is the Sunrise any good...</span></span>' +
              '</div>' +
              '<div class="lc-conv">' +
                '<span class="lc-conv-av lc-conv-av--wa">JP</span>' +
                '<span class="lc-conv-b"><b>Jo P.</b><span>Sent the passport photos</span></span>' +
                '<span class="lc-conv-when">1h</span>' +
              '</div>' +
            '</div>' +
            '<div class="lc-stage">' +
              '<div class="lc-stagehead"><strong>Sarah B.</strong>' +
                '<span class="lc-tag">Hurghada &middot; 24 Oct</span></div>' +
              '<div class="lc-copilot" data-hs="lc-copilot">' +
                '<span class="lc-copilot-t">Copilot &middot; suggested reply</span>' +
                '<span class="lc-sugg">Honestly, yes. There are five restaurants and the buffet ' +
                  'always has pasta and chips, which covers most fussy eaters. The kids’ ' +
                  'club does its own menu too.' +
                  '<span class="lc-sugg-src" data-hs="lc-source">From your own notes on Sunrise ' +
                  'Hurghada, updated March</span></span>' +
                '<span class="lc-tools" data-hs="lc-tools">' +
                  '<span class="lc-tool">Friendlier</span>' +
                  '<span class="lc-tool">Shorter</span>' +
                  '<span class="lc-tool">More detail</span>' +
                  '<span class="lc-tool">Summarise</span>' +
                  '<span class="lc-tool">Translate</span>' +
                '</span>' +
              '</div>' +
              '<div class="lc-stagebody">' +
                '<div class="lc-msg lc-msg--them">Is the Sunrise any good for an 11 year old?</div>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>',
    hotspots: [
      {
        anchor: 'lc-copilot',
        at: 'outside-left',
        title: 'A draft reply, waiting',
        feature:
          'The moment a human takes over, Copilot writes what it would have said and puts it in ' +
          'front of them. They send it, change it, or ignore it.',
        benefit:
          'A new starter answers like somebody who has worked there ten years, and the person who ' +
          'has worked there ten years gets their afternoon back.'
      },
      {
        anchor: 'lc-source',
        at: 'bottom-right',
        title: 'And it says where it got it',
        feature:
          'Every suggestion names the knowledge it came from, so the agent can see whether to ' +
          'trust it before it goes out.',
        benefit:
          'A suggestion with no source behind it is just a guess with good grammar.'
      },
      {
        anchor: 'lc-tools',
        title: 'Friendlier, shorter, or in their language',
        feature:
          'One tap rewrites the draft, summarises a long thread, or translates it. Luna already ' +
          'replies in whatever language the visitor writes in, unconditionally.',
        benefit:
          'A tired agent at five to six writes a reply they would be happy to read.'
      },
      {
        anchor: 'lc-sent',
        at: 'outside-right',
        title: 'The customer sees none of this',
        feature:
          'Copilot is the agent’s side of the glass. What lands is a message from Claire.',
        benefit:
          'The help is invisible, which is the only way it is worth having.'
      }
    ]
  });

  /* -- 7. One inbox ---------------------------------------------------- */
  lunaChat.screens.push({
    id: 'whatsapp',
    name: 'One inbox',
    blurb: 'Website chat and WhatsApp arrive in the same place, handled the same way.',
    html:
      '<div class="lc-dash lc-dash--wide">' +
        '<div class="lc-rail">' +
          '<div class="lc-railhead"><strong>Travel Demo</strong><small>Claire, online</small></div>' +
          '<div class="lc-conv is-live" data-hs="lc-wa-conv">' +
            '<span class="lc-conv-av lc-conv-av--wa">JP</span>' +
            '<span class="lc-conv-b"><b>Jo P.</b><span>Sent the passport photos</span></span>' +
            '<span class="lc-unread">2</span>' +
          '</div>' +
          '<div class="lc-conv">' +
            '<span class="lc-conv-av">SB</span>' +
            '<span class="lc-conv-b"><b>Sarah B.</b><span>Perfect, thank you</span></span>' +
            '<span class="lc-conv-when">3m</span>' +
          '</div>' +
          '<div class="lc-conv">' +
            '<span class="lc-conv-av lc-conv-av--wa">RT</span>' +
            '<span class="lc-conv-b"><b>Ray T.</b><span>What time is the transfer</span></span>' +
            '<span class="lc-conv-when">22m</span>' +
          '</div>' +
          '<div class="lc-conv">' +
            '<span class="lc-conv-av">DM</span>' +
            '<span class="lc-conv-b"><b>Dan M.</b><span>Thanks, that is great</span></span>' +
            '<span class="lc-conv-when">1h</span>' +
          '</div>' +
        '</div>' +
        '<div class="lc-stage">' +
          '<div class="lc-stagehead">' +
            '<strong>Jo P.</strong>' +
            '<span class="lc-tag lc-tag--wa" data-hs="lc-wa-tag">WhatsApp</span>' +
            '<span class="lc-tag">Crete &middot; May</span>' +
          '</div>' +
          '<div class="lc-stagebody">' +
            '<div class="lc-msg lc-msg--them">Do you need the passports before we pay the balance?</div>' +
            '<div class="lc-msg lc-msg--luna" data-hs="lc-wa-ai">Not before the balance, no. We ' +
              'need them about six weeks out, so mid March for your May trip. You can send photos ' +
              'straight here whenever it suits.</div>' +
            '<div class="lc-msg lc-msg--them">Sent them now</div>' +
            '<span class="lc-tick">Read &check;&check;</span>' +
          '</div>' +
        '</div>' +
        '<div class="lc-side">' +
          '<span class="lc-side-t">Who this is</span>' +
          '<div class="lc-side-name">Jo P.</div>' +
          '<div class="lc-side-sub">On WhatsApp &middot; +44 7700 900412</div>' +
          '<div class="lc-hist" data-hs="lc-recall">' +
            '<span class="lc-side-t">Seen before</span>' +
            '<span class="lc-hist-row"><b>Today</b> asked about passports</span>' +
            '<span class="lc-hist-row"><b>9 Feb</b> booked Crete, 7 nights</span>' +
            '<span class="lc-hist-row"><b>2 Feb</b> asked about Crete on the website</span>' +
          '</div>' +
        '</div>' +
      '</div>',
    hotspots: [
      {
        anchor: 'lc-wa-conv',
        at: 'outside-right',
        title: 'Their customers already use WhatsApp',
        feature:
          'The agency’s WhatsApp number comes into the same inbox as the website chat, with ' +
          'the same Luna answering and the same people taking over.',
        benefit:
          'Most agencies already have a WhatsApp number and no idea what is happening on it. This ' +
          'is the same conversation, in the place everything else lives.',
        edge:
          'Travelgenix connects the number for them. There is no Meta account to set up and ' +
          'nothing for them to work out.'
      },
      {
        anchor: 'lc-wa-ai',
        at: 'top-left',
        title: 'Luna answers there too',
        feature:
          'It is not a forwarding inbox. The same assistant, the same approved knowledge, the same ' +
          'rules about what it will and will not say.',
        benefit:
          'A message at ten at night gets the same answer whichever way it arrived.'
      },
      {
        anchor: 'lc-recall',
        at: 'outside-left',
        title: 'It remembers them',
        feature:
          'A returning visitor is recognised on the same device, and across devices once they have ' +
          'verified their email with a code.',
        benefit:
          'Nobody likes explaining themselves twice. The agent opens the chat already knowing this ' +
          'is the Crete booking from February.'
      }
    ]
  });

  /* -- 8. What the agency can see ------------------------------------- */
  lunaChat.screens.push({
    id: 'proof',
    name: 'The proof',
    blurb: 'The leads it produced, and whether the whole thing is working.',
    html:
      '<div class="lc-dash lc-dash--wide">' +
        '<div class="lc-rail">' +
          '<div class="lc-railhead"><strong>Travel Demo</strong><small>Claire, online</small></div>' +
          '<div class="lc-conv"><span class="lc-conv-av">SB</span>' +
            '<span class="lc-conv-b"><b>Sarah B.</b><span>Perfect, thank you</span></span>' +
            '<span class="lc-conv-when">3m</span></div>' +
          '<div class="lc-conv"><span class="lc-conv-av lc-conv-av--wa">JP</span>' +
            '<span class="lc-conv-b"><b>Jo P.</b><span>Sent them now</span></span>' +
            '<span class="lc-conv-when">8m</span></div>' +
        '</div>' +
        '<div class="lc-stage">' +
          '<div class="lc-stagehead"><strong>This week</strong></div>' +
          '<div class="lc-stagebody">' +
            '<div class="lc-tiles" data-hs="lc-tiles">' +
              '<span class="lc-tile"><small>Conversations</small><b>214</b><i>63 after six o’clock</i></span>' +
              '<span class="lc-tile"><small>Handed to a human</small><b>28</b><i>13 per cent of them</i></span>' +
              '<span class="lc-tile"><small>Enquiries</small><b>19</b><i>All in the table below</i></span>' +
              '<span class="lc-tile"><small>Rated by the customer</small><b>4.6</b><i>Out of five</i></span>' +
            '</div>' +
            '<div class="lc-tile" style="margin-top:11px" data-hs="lc-hours">' +
              '<small>When they come</small>' +
              '<span class="lc-bars">' +
                '<span style="height:22%"></span><span style="height:14%"></span>' +
                '<span style="height:18%"></span><span style="height:34%"></span>' +
                '<span style="height:46%"></span><span style="height:58%"></span>' +
                '<span style="height:72%"></span><span class="is-peak" style="height:100%"></span>' +
                '<span class="is-peak" style="height:88%"></span><span style="height:54%"></span>' +
                '<span style="height:30%"></span><span style="height:17%"></span>' +
              '</span>' +
              '<i>Busiest between eight and ten in the evening</i>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="lc-side">' +
          '<div class="lc-lead" data-hs="lc-enquiry" style="margin:0 0 12px">' +
            '<span class="lc-lead-t">New enquiry</span>' +
            '<span class="lc-lead-rows">' +
              '<span class="lc-lead-row"><span>Name</span><b>Sarah Bright</b></span>' +
              '<span class="lc-lead-row"><span>Going to</span><b>Hurghada</b></span>' +
              '<span class="lc-lead-row"><span>When</span><b>24 Oct, 7 nights</b></span>' +
              '<span class="lc-lead-row"><span>Party</span><b>2 adults, 2 children</b></span>' +
              '<span class="lc-lead-row"><span>Budget</span><b>Around &pound;2,500</b></span>' +
              '<span class="lc-lead-row"><span>From</span><b>Manchester</b></span>' +
            '</span>' +
          '</div>' +
          '<div class="lc-stars" data-hs="lc-csat">' +
            '<b>&starf;&starf;&starf;&starf;&starf;</b>' +
            '&ldquo;Answered at half ten at night and actually knew the hotel.&rdquo;' +
          '</div>' +
        '</div>' +
      '</div>',
    hotspots: [
      {
        anchor: 'lc-enquiry',
        at: 'outside-left',
        title: 'The enquiry writes itself',
        feature:
          'Everything Luna worked out during the conversation arrives as a filled-in enquiry, and ' +
          'lands by email as well so it is not missed.',
        benefit:
          'This is the output the agency actually wanted. Not a transcript to read, a lead to ring.'
      },
      {
        anchor: 'lc-hours',
        at: 'top-left',
        title: 'It shows when the agency is closed and the customers are not',
        feature:
          'Conversations by hour, by day, and what people asked about.',
        benefit:
          'The evening peak is the argument for having it at all, in the agency’s own numbers ' +
          'rather than ours.'
      },
      {
        anchor: 'lc-tiles',
        title: 'And how much of it needed a person',
        feature:
          'Conversations, escalations, ratings and quality scores. Luna scores its own answers and ' +
          'flags the weak ones for review.',
        benefit:
          'It is possible to tell whether this is working, which is more than most agencies can ' +
          'say about their website today.'
      },
      {
        anchor: 'lc-csat',
        at: 'bottom-right',
        title: 'The customer gets a say',
        feature:
          'Every conversation can be rated when it ends, and the comments come through with it.',
        benefit:
          'The fastest way to find out the assistant is getting something wrong is to let the ' +
          'people it is talking to tell you.'
      }
    ]
  });

  window.TG_SHOWCASE = { version: '1.0.0', products: [lunaTravel, lunaChat] };
})();
