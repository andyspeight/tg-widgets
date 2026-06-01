/* ============================================================================
   Destination Spotlight — guided setup tour  v1.0.0
   ----------------------------------------------------------------------------
   Step-by-step walkthrough for the Destination Spotlight editor. This widget has
   more to it than most (destination picker, auto-detect, a call to action,
   renameable content blocks, plus design and visibility), so the tour runs to
   ten steps. Each step spotlights a REAL control and advances on Next.

   ORDER: destination FIRST. The preview is empty until a destination is chosen,
   and choosing one pulls in all the content (overview, highlights, climate,
   events), so every later step has a live, fully populated spotlight to work on.

   Requires editor-tour.js (adds tgse.tour + tgse.tourLauncher).

   Real anchors (verified against editor-spotlight.html):
     #destSearch          Live destination search    (Content, "Destination" section, open)
     #togAutoDetect       Auto-detect switch         (Content, "Auto-detect" section, COLLAPSED)
     #ctaTitle            Call-to-action title       (Content, "Call to action" section, open)
     #hHighlights         A section-heading field    (Content, "Section headings" section, COLLAPSED)
     #presets             Colour presets             (Design, "Colours" section, open)
     #radius              Corner radius              (Design, "Shape & type" section, open)
     #sectionTogglesWrap  Block visibility toggles   (Settings, "Section visibility" section, open)
     .tgse-preview        Live preview               (main area)
     #btn-save            Save button                (header)
     #btn-embed           Get embed code             (preview toolbar)

   Notes on this editor (Weather/Testimonials family):
     - Static panels (#panelDesign / #panelContent / #panelSettings) toggled by
       setTab() via the `hidden` attribute, driven by the shell. A tab step's
       target is present right after the tab click.
     - Sections are .section[data-open="true|false"]. The engine's .tgse-section
       reveal is a no-op here, so the two collapsed sections we target
       (Auto-detect, Section headings) are opened by this step list's beforeShow
       (set data-open="true" directly, never click the head). For Auto-detect we
       anchor on the always-visible #togAutoDetect switch, not the slug fields,
       which stay hidden until the switch is on.
   ============================================================================ */
(function () {
  'use strict';

  function openSectionOf(sel) {
    var el = document.querySelector(sel);
    var sec = el && el.closest ? el.closest('.section') : null;
    if (sec) sec.setAttribute('data-open', 'true');
  }

  function buildSteps() {
    return [
      {
        tab: 'content',
        target: '#destSearch',
        title: 'Start with your destination',
        body: 'Search by country, city or resort and pick yours from the list. The preview fills in straight away with the overview, highlights, climate and more, all pulled in for you, so everything after this has something to show.',
        placement: 'right'
      },
      {
        tab: 'content',
        target: '#togAutoDetect',
        beforeShow: function () { openSectionOf('#togAutoDetect'); },
        title: 'One widget for every page',
        body: 'Turn on auto-detect and the widget reads the destination from the page address, so a single embed adapts to each destination page on your site. The fixed destination above is just for this preview. Leave it off if you only need one destination.',
        placement: 'right'
      },
      {
        tab: 'content',
        target: function () { var el = document.querySelector('#ctaTitle'); return el && el.closest ? el.closest('.section') : el; },
        title: 'Set your call to action',
        body: 'Give visitors a clear next step. Set the title, button label and link here for a button to enquire, browse holidays or get in touch. There are smart variables too, type one in and the widget drops the real destination name in for you.',
        placement: 'right'
      },
      {
        tab: 'content',
        target: function () { var el = document.querySelector('#hHighlights'); return el && el.closest ? el.closest('.section') : el; },
        beforeShow: function () { openSectionOf('#hHighlights'); },
        title: 'Rename the sections',
        body: 'Your spotlight is built from blocks like highlights, quick facts, climate and events, all filled in automatically for your destination. Here you can rename any of those headings to match your own wording.',
        placement: 'right'
      },
      {
        tab: 'design',
        target: function () { var el = document.querySelector('#presets'); return el && el.closest ? el.closest('.section') : el; },
        title: 'Match your brand',
        body: 'Set your brand and accent colours here, or tap a preset for an instant matching pair, so the spotlight sits comfortably with the rest of your site.',
        placement: 'right'
      },
      {
        tab: 'design',
        target: '#spot-design-group',
        // Climate chart ships collapsed — open both sections so they sit under the spotlight.
        beforeShow: function () {
          var g = document.querySelector('#spot-design-group');
          if (g) g.querySelectorAll('.section').forEach(function (s) { s.setAttribute('data-open', 'true'); });
        },
        title: 'Shape and type',
        body: 'Round the corners to taste and choose a font in Shape and type. Just below, the Climate chart section sets whether temperatures show in Celsius or Fahrenheit by default, readers can still flip between the two on the widget itself.',
        placement: 'right',
        spotlightPadding: 6
      },
      {
        tab: 'settings',
        target: '#spot-show-group',
        title: 'Choose what to show',
        body: 'Section visibility switches the different blocks on or off, the highlights, quick facts, climate chart, events and more. Just below, Extras handles the finishing touches, the image attribution (required when showing Unsplash photos) and the "best time to visit" callout above the climate chart. Show as much or as little as suits the page.',
        placement: 'right',
        spotlightPadding: 6
      },
      {
        target: '.tgse-preview',
        title: 'See it come together',
        body: 'The preview updates as you go, so you always know exactly how your destination spotlight will look on your site.',
        placement: 'left',
        spotlightPadding: 6
      },
      {
        target: '#btn-save',
        title: 'Save your destination spotlight',
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
    titleHtml: 'Let\u2019s set up your <em>destination spotlight</em>.',
    body: 'A quick walk through the setup, one step at a time. A minute or two, and you can pick a destination and shape it as we go. Ready?'
  };
  var DONE = {
    titleHtml: 'All set. <em>Your destination spotlight is ready.</em>',
    body: 'Destination chosen, branded and showing just what you want. Save it, then click Get embed code and paste that one line on your site. A rich, ready-made destination guide will be on show in seconds. You can reopen this walkthrough any time from the button in the corner.'
  };

  var _api = null;
  function launch() {
    if (!window.tgse || typeof window.tgse.tour !== 'function') {
      console.warn('[spotlight-tour] tgse.tour not available — load editor-tour.js');
      return;
    }
    // tear down any previous run so reopening never stacks overlays
    if (_api && typeof _api.finish === 'function') { try { _api.finish(false); } catch (e) {} }
    _api = window.tgse.tour({
      id: 'spotlight',
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
  window.initSpotlightTour = function () {
    if (_booted) return;
    _booted = true;
    if (!window.tgse || typeof window.tgse.tourLauncher !== 'function') {
      console.warn('[spotlight-tour] tgse.tourLauncher not available');
      return;
    }
    window.tgse.tourLauncher({ id: 'spotlight', label: 'Show me how', onClick: launch });
    if (!window.tgse.isTourDismissed || !window.tgse.isTourDismissed('spotlight')) {
      setTimeout(launch, 650);
    }
  };

})();
