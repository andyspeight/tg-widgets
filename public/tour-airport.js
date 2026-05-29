/* ============================================================================
   Airport Spotlight — guided setup tour  v1.0.0
   ----------------------------------------------------------------------------
   Step-by-step walkthrough for the Airport Spotlight editor. Each step
   spotlights a REAL control and tells the user what to do. The tour switches
   tabs as needed and advances on Next.

   ORDER: airport FIRST. The preview is empty until an airport is chosen, so we
   get that in before anything else, then every later step has a live spotlight
   to work against.

   Requires editor-tour.js (adds tgse.tour + tgse.tourLauncher).

   Real anchors (verified against editor-airport.html):
     #ap-search          Airport search by name/IATA  (Content tab, "Airport" section, open)
     #cta-orig-title     Origin CTA title             (Content tab, "Call to action" section, open)
     #brand-color        Brand colour                 (Design tab, "Colours" section, open)
     #hero-url           Hero image URL               (Design tab, "Hero image" section, COLLAPSED)
     #opt-showMap        Show map toggle              (Settings tab, "Sections to show" section, open)
     .tgse-preview       Live preview                 (main area)
     #btn-save           Save button                  (header)
     #btn-embed          Get embed code               (preview toolbar)

   Notes on this editor:
     - Static .tgse-panel[data-tab] panels (Content is the DEFAULT tab), shell
       drives visibility via .tgse-panel.is-active, so a tab step's target is
       present right after the tab click.
     - Sections are .tgse-section / .tgse-section.is-open (the original shell
       convention). The one collapsed section this tour targets (Hero image) is
       opened by beforeShow, set .is-open directly, never click the head.
   ============================================================================ */
(function () {
  'use strict';

  function buildSteps() {
    return [
      {
        tab: 'content',
        target: '#ap-search',
        title: 'Start with your airport',
        body: 'Search by airport name or IATA code and pick yours from the list. The preview fills in straight away with the name, location and details, so everything after this has something to show.',
        placement: 'right'
      },
      {
        tab: 'content',
        target: '#cta-orig-title',
        title: 'Set your call to action',
        body: 'Two sets of buttons here, one for airports people fly from and one for the airports they fly to. Type {{airportName}} or {{iata}} into a field and the widget drops the real name in for you.',
        placement: 'right'
      },
      {
        tab: 'design',
        target: '#brand-color',
        title: 'Match your brand',
        body: 'Set your brand and accent colours here so the spotlight sits comfortably with the rest of your site.',
        placement: 'right'
      },
      {
        tab: 'design',
        target: '#hero-url',
        // The Hero image section ships collapsed. Open it before we paint.
        beforeShow: function () {
          var el = document.querySelector('#hero-url');
          var sec = el && el.closest ? el.closest('.tgse-section') : null;
          if (sec) sec.classList.add('is-open');
        },
        title: 'Add a hero image',
        body: 'Drop in a photo to sit behind the airport name, a runway shot or a local landmark works well. Leave it blank for a clean coloured header instead.',
        placement: 'right'
      },
      {
        tab: 'settings',
        target: function () { return document.querySelector('.tgse-panel[data-tab="settings"] .tgse-section'); },
        title: 'Choose what to show',
        body: 'Switch the different blocks on or off, the overview, terminals and airlines, facilities, getting there, tips and more. Show as much or as little as suits your page, with map options just below.',
        placement: 'right'
      },
      {
        target: '.tgse-preview',
        title: 'See it come together',
        body: 'The preview updates as you go, so you always know exactly how your airport spotlight will look on your site.',
        placement: 'left',
        spotlightPadding: 6
      },
      {
        target: '#btn-save',
        title: 'Save your airport spotlight',
        body: 'When it looks right, hit Save. You can come back and change any of this whenever you like.',
        placement: 'bottom'
      },
      {
        target: '#btn-embed',
        title: 'Last thing: your embed code',
        body: 'This button gives you a single line of code to paste on your site. We will not open it just yet. Hit Finish below, then click here whenever you are ready.',
        placement: 'left'
      }
    ];
  }

  var WELCOME = {
    titleHtml: 'Let\u2019s set up your <em>airport spotlight</em>.',
    body: 'A quick walk through the setup, one step at a time. About a minute, and you can pick your airport and brand it as we go. Ready?'
  };
  var DONE = {
    titleHtml: 'All set. <em>Your airport spotlight is ready.</em>',
    body: 'Airport chosen, branded and showing just what you want. Save it, then click Get embed code and paste that one line on your site. Your airport page will have a smart, useful spotlight in seconds. You can reopen this walkthrough any time from the button in the corner.'
  };

  var _api = null;
  function launch() {
    if (!window.tgse || typeof window.tgse.tour !== 'function') {
      console.warn('[airport-tour] tgse.tour not available — load editor-tour.js');
      return;
    }
    // tear down any previous run so reopening never stacks overlays
    if (_api && typeof _api.finish === 'function') { try { _api.finish(false); } catch (e) {} }
    _api = window.tgse.tour({
      id: 'airport',
      welcome: WELCOME,
      done: DONE,
      steps: buildSteps()   // fresh steps each open (clears any _revealed flags)
    });
    _api.start();
    return _api;
  }

  // Public entry. Mounts the persistent launcher, and auto-starts on login
  // unless the user ticked "don't show this again".
  var _booted = false;
  window.initAirportTour = function () {
    if (_booted) return;
    _booted = true;
    if (!window.tgse || typeof window.tgse.tourLauncher !== 'function') {
      console.warn('[airport-tour] tgse.tourLauncher not available');
      return;
    }
    window.tgse.tourLauncher({ id: 'airport', label: 'Show me how', onClick: launch });
    if (!window.tgse.isTourDismissed || !window.tgse.isTourDismissed('airport')) {
      setTimeout(launch, 650);
    }
  };

})();
