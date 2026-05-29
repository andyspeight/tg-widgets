/* ============================================================================
   Weather — guided setup tour  v1.0.0
   ----------------------------------------------------------------------------
   Step-by-step walkthrough for the Weather widget editor. Each step spotlights a
   REAL control and tells the user what to do. The tour switches tabs as needed
   and advances on Next.

   Requires editor-tour.js (adds tgse.tour + tgse.tourLauncher).

   Real anchors (verified against editor-weather.html):
     #layoutSeg          Layout segmented control   (Design tab, "Layout" section, open)
     #presets            Colour presets             (Design tab, "Colours" section, open)
     #destSearch         Live destination search    (Content tab, "Destination" section, open)
     #slugSource         Auto-detect source         (Content tab, "Auto-detect" section, COLLAPSED)
     #sectionTogglesWrap Section visibility toggles (Settings tab, "Section visibility" section, open)
     .tgse-preview       Live preview               (main area)
     #btn-save           Save button                (header)
     #btn-embed          Get embed code             (preview toolbar)

   Notes on this editor (the Testimonials family of the line-up):
     - Panels are static (#panelDesign / #panelContent / #panelSettings) and
       toggled by setTab() via the `hidden` attribute, driven by the shell's
       onTabChange. A tab step's target is present right after the tab click.
     - Sections are .section[data-open="true|false"] (head .section-head, body
       .section-body shown only when data-open="true"). The engine's
       .tgse-section reveal is a no-op here, so the one collapsed section we
       target (Auto-detect) is opened by this step list's beforeShow (set
       data-open="true" directly, never click the head).
   ============================================================================ */
(function () {
  'use strict';

  function buildSteps() {
    return [
      {
        tab: 'design',
        target: '#layoutSeg',
        title: 'Pick a layout',
        body: 'Compact keeps it small and tidy, Standard is the everyday view, Wide spreads it out with more room for the forecast. Choose one and watch the preview.',
        placement: 'right'
      },
      {
        tab: 'design',
        target: '#presets',
        title: 'Match your brand',
        body: 'Tap a preset for an instant matching pair, or set the brand and accent colours by hand just above so the widget sits with the rest of your site.',
        placement: 'right'
      },
      {
        tab: 'content',
        target: '#destSearch',
        title: 'Choose your destination',
        body: 'Start typing a country, city or resort and pick it from the list. The widget will show live weather for wherever you choose, ideal for a single destination page.',
        placement: 'right'
      },
      {
        tab: 'content',
        target: '#slugSource',
        // The Auto-detect section ships collapsed. Open it before we paint.
        beforeShow: function () {
          var el = document.querySelector('#slugSource');
          var sec = el && el.closest ? el.closest('.section') : null;
          if (sec) sec.setAttribute('data-open', 'true');
        },
        title: 'Or detect it automatically',
        body: 'Running one widget across lots of destination pages? Auto-detect reads the destination from the page address, so the same widget shows the right weather everywhere. Use a fixed destination above or this, not both.',
        placement: 'right'
      },
      {
        tab: 'settings',
        target: '#sectionTogglesWrap',
        title: 'Choose what to show',
        body: 'Turn the different parts on or off, like the current conditions, the day by day forecast and the climate notes. Show as much or as little as you like.',
        placement: 'right'
      },
      {
        target: '.tgse-preview',
        title: 'See it come together',
        body: 'The preview updates as you go, so you always know exactly how your weather widget will look on your site.',
        placement: 'left',
        spotlightPadding: 6
      },
      {
        target: '#btn-save',
        title: 'Save your weather widget',
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
    titleHtml: 'Let\u2019s set up your <em>weather widget</em>.',
    body: 'A quick walk through the setup, one step at a time. About a minute, and it will be showing live weather for your destination by the end. Ready?'
  };
  var DONE = {
    titleHtml: 'All set. <em>Your weather widget is ready.</em>',
    body: 'Destination chosen, styled to your brand and showing just what you want. Save it, then click Get embed code and paste that one line on your site. Live weather will be on show in seconds. You can reopen this walkthrough any time from the button in the corner.'
  };

  var _api = null;
  function launch() {
    if (!window.tgse || typeof window.tgse.tour !== 'function') {
      console.warn('[weather-tour] tgse.tour not available — load editor-tour.js');
      return;
    }
    // tear down any previous run so reopening never stacks overlays
    if (_api && typeof _api.finish === 'function') { try { _api.finish(false); } catch (e) {} }
    _api = window.tgse.tour({
      id: 'weather',
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
  window.initWeatherTour = function () {
    if (_booted) return;
    _booted = true;
    if (!window.tgse || typeof window.tgse.tourLauncher !== 'function') {
      console.warn('[weather-tour] tgse.tourLauncher not available');
      return;
    }
    window.tgse.tourLauncher({ id: 'weather', label: 'Show me how', onClick: launch });
    if (!window.tgse.isTourDismissed || !window.tgse.isTourDismissed('weather')) {
      setTimeout(launch, 650);
    }
  };

})();
