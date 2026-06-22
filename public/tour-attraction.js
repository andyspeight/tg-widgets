/* ============================================================================
   Attraction Spotlight — guided setup tour  v1.0.0
   ----------------------------------------------------------------------------
   Step-by-step walkthrough for the Attraction Spotlight editor. Each step
   spotlights a REAL control and tells the user what to do. The tour switches
   tabs as needed and advances on Next.

   ORDER: attraction FIRST. The preview is empty until one is chosen, so we get
   that in before anything else, then every later step has a live spotlight to
   work against.

   Requires editor-tour.js (adds tgse.tour + tgse.tourLauncher).

   Real anchors (verified against editor-attraction.html):
     #at-search        Park / attraction search   (Content tab, "Attraction" section, open)
     #cta-title        Call-to-action title       (Content tab, "Call-to-action" section, open)
     #brand-color      Brand colour               (Design tab, "Colours" section, open)
     #hero-url         Hero image URL             (Design tab, "Hero image" section, COLLAPSED)
     .at-toggles       Sections to show           (Settings tab, "Sections to show" section, open)
     .tgse-preview     Live preview               (main area)
     #btn-save         Save button                (header)
     #btn-embed        Get embed code             (preview toolbar)

   Notes on this editor:
     - Static .tgse-panel[data-tab] panels (Content is the DEFAULT tab), shell
       drives visibility via .tgse-panel.is-active, so a tab step's target is
       present right after the tab click.
     - Sections are .tgse-section / .tgse-section.is-open. The Attraction and
       CTA steps spotlight the whole section (the search box hides once a park
       is picked, so the section is the stable target). The one collapsed
       section this tour targets (Hero image) is opened by beforeShow, set
       .is-open directly, never click the head.
     - There is no map toggle in this editor, the map shows automatically when
       the attraction has coordinates, so the copy talks about the sections only.
   ============================================================================ */
(function () {
  'use strict';

  function sectionOf(sel) {
    var el = document.querySelector(sel);
    return el && el.closest ? el.closest('.tgse-section') : el;
  }

  function buildSteps() {
    return [
      {
        tab: 'content',
        target: function () { return sectionOf('#at-search'); },
        title: 'Start with your attraction',
        body: 'Search by park or attraction name and pick yours from the list. The preview fills in straight away with the name, location and details, so everything after this has something to show.',
        placement: 'right'
      },
      {
        tab: 'content',
        target: function () { return sectionOf('#cta-title'); },
        title: 'Set your call to action',
        body: 'This is the enquiry panel at the foot of the widget, with a title, subtitle, button label and link. Type {{name}} into any field and the widget drops the real attraction name in for you. It points enquiries at you, never off to book direct.',
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
          var sec = sectionOf('#hero-url');
          if (sec) sec.classList.add('is-open');
        },
        title: 'Add a hero image (optional)',
        body: 'Theme parks do not ship a photo, so the header is a clean branded gradient by default. Drop in a URL here if you would like an image to sit behind the name, or leave it blank for the coloured header.',
        placement: 'right'
      },
      {
        tab: 'settings',
        target: function () { return sectionOf('.at-toggles'); },
        title: 'Choose what to show',
        body: 'Switch the different blocks on or off, the overview, star attractions, the good-to-know guides, tickets, getting there with its map, where to stay, food, insider tips and more. Show as much or as little as suits your page.',
        placement: 'right',
        spotlightPadding: 6
      },
      {
        target: '.tgse-preview',
        title: 'See it come together',
        body: 'The preview updates as you go, so you always know exactly how your attraction spotlight will look on your site.',
        placement: 'left',
        spotlightPadding: 6
      },
      {
        target: '#btn-save',
        title: 'Save your attraction spotlight',
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
    titleHtml: 'Let’s set up your <em>attraction spotlight</em>.',
    body: 'A quick walk through the setup, one step at a time. About a minute, and you can pick your attraction and brand it as we go. Ready?'
  };
  var DONE = {
    titleHtml: 'All set. <em>Your attraction spotlight is ready.</em>',
    body: 'Attraction chosen, branded and showing just what you want. Save it, then click Get embed code and paste that one line on your site. Your page will have a smart, useful spotlight in seconds. You can reopen this walkthrough any time from the button in the corner.'
  };

  var _api = null;
  function launch() {
    if (!window.tgse || typeof window.tgse.tour !== 'function') {
      console.warn('[attraction-tour] tgse.tour not available — load editor-tour.js');
      return;
    }
    // tear down any previous run so reopening never stacks overlays
    if (_api && typeof _api.finish === 'function') { try { _api.finish(false); } catch (e) {} }
    _api = window.tgse.tour({
      id: 'attraction',
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
  window.initAttractionTour = function () {
    if (_booted) return;
    _booted = true;
    if (!window.tgse || typeof window.tgse.tourLauncher !== 'function') {
      console.warn('[attraction-tour] tgse.tourLauncher not available');
      return;
    }
    window.tgse.tourLauncher({ id: 'attraction', label: 'Show me how', onClick: launch });
    if (!window.tgse.isTourDismissed || !window.tgse.isTourDismissed('attraction')) {
      setTimeout(launch, 650);
    }
  };

})();
