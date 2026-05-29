/* ============================================================================
   Testimonials — guided setup tour  v1.0.0
   ----------------------------------------------------------------------------
   Defines the step-by-step walkthrough for the Testimonials editor. Each step
   spotlights a REAL control and tells the user what to do. The tour switches
   tabs as needed and advances on Next.

   Requires editor-tour.js (adds tgse.tour + tgse.tourLauncher).

   Real anchors (verified against editor-testimonials.html):
     [data-add-testimonial]        Add testimonial button   (Content tab, "ts" section)
     [data-section="layout"]       Layout chooser           (Design tab)
     [data-section="colours"]      Colours / presets        (Design tab)
     [data-section="heading"]      Heading                  (Design tab)
     [data-section="display"]      Display options          (Settings tab)
     .tgse-preview                 Live preview             (main area)
     #btn-save                     Save button              (header)
     #btn-embed                    Get embed code           (preview toolbar)

   Notes on this editor (differs from World Map):
     - The sidebar is JS-rendered into #sidebar-body; switching a tab calls
       setTab() -> renderTabBody() synchronously, so a tab step's target exists
       immediately after the tab button is clicked.
     - Sections are .section[data-section][data-open], not .tgse-section.is-open.
       Every section this tour targets defaults open, so no reveal is needed and
       the engine's .tgse-section reveal is a harmless no-op here.
   ============================================================================ */
(function () {
  'use strict';

  function buildSteps() {
    return [
      {
        tab: 'content',
        target: function () { return document.querySelector('[data-add-testimonial]') || document.querySelector('[data-section="ts"]'); },
        title: 'Add your reviews',
        body: 'This is the heart of it. Click Add testimonial to type a review in by hand, or use the AI builder up top and CSV import to bring several in at once. Leave it for now and hit Next, you can come back to it.',
        placement: 'right'
      },
      {
        tab: 'design',
        target: '[data-section="layout"]',
        title: 'Choose the layout',
        body: 'This is how your reviews are arranged. Grid and Masonry sit them in columns, Carousel slides through them one at a time, Marquee scrolls them gently along. Try each and watch the preview.',
        placement: 'right'
      },
      {
        tab: 'design',
        target: '[data-section="colours"]',
        title: 'Match your brand',
        body: 'Pick a preset or set your own colours so the widget looks like part of your site rather than bolted on.',
        placement: 'right'
      },
      {
        tab: 'design',
        target: '[data-section="heading"]',
        title: 'Add a heading',
        body: 'A short title above your reviews works well, something like What our travellers say. Leave it blank if you would rather go straight into the cards.',
        placement: 'right'
      },
      {
        tab: 'settings',
        target: '[data-section="display"]',
        title: 'Choose what shows',
        body: 'Switch the details on each card on or off, the star rating, where they travelled, the trip type and the travel date. Show what helps your visitors trust the review, hide the rest.',
        placement: 'right'
      },
      {
        target: '.tgse-preview',
        title: 'Watch it update live',
        body: 'Every change you make shows here straight away on the real widget, so you always know exactly what your visitors will see.',
        placement: 'left',
        spotlightPadding: 6
      },
      {
        target: '#btn-save',
        title: 'Save your widget',
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
    titleHtml: 'Let\u2019s set up your <em>reviews</em> widget.',
    body: 'A quick walk through the setup, one step at a time. It takes about a minute and you can do each bit yourself as we go. Ready?'
  };
  var DONE = {
    titleHtml: 'All set. <em>Your reviews look the part.</em>',
    body: 'Reviews added, a layout chosen and your brand applied. Save it, then click Get embed code and paste that one line on your site. Your reviews will be live. You can reopen this walkthrough any time from the button in the corner.'
  };

  var _api = null;
  function launch() {
    if (!window.tgse || typeof window.tgse.tour !== 'function') {
      console.warn('[testimonials-tour] tgse.tour not available — load editor-tour.js');
      return;
    }
    // tear down any previous run so reopening never stacks overlays
    if (_api && typeof _api.finish === 'function') { try { _api.finish(false); } catch (e) {} }
    _api = window.tgse.tour({
      id: 'testimonials',
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
  window.initTestimonialsTour = function () {
    if (_booted) return;
    _booted = true;
    if (!window.tgse || typeof window.tgse.tourLauncher !== 'function') {
      console.warn('[testimonials-tour] tgse.tourLauncher not available');
      return;
    }
    window.tgse.tourLauncher({ id: 'testimonials', label: 'Show me how', onClick: launch });
    if (!window.tgse.isTourDismissed || !window.tgse.isTourDismissed('testimonials')) {
      setTimeout(launch, 650);
    }
  };

})();
