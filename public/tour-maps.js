/* ============================================================================
   Maps — guided setup tour  v1.0.0
   ----------------------------------------------------------------------------
   Walkthrough for the Maps editor. Preview-first: we lead with the locations
   (the pins that fill the map), then the address/Find flow, the map style, the
   pin colour, and the display options. The editor ships seeded with two sample
   locations, so the preview is populated from the first frame.

   Requires editor-tour.js.

   Static .tgse-panel[data-tab] with .tgse-section / .tgse-section.is-open. The
   engine auto-opens any closed .tgse-section a target sits inside.

   Stable ids: #loc-list, #add-loc (Content); #style-picker, #accent-col (Design);
   #show-list (Settings). Default tab is Design. loadFromUrl() is the funnel,
   gated on isLoggedIn via onReady, so the tour starts from the logged-in path
   and from onLoginSuccess.
   ============================================================================ */
(function () {
  'use strict';

  function buildSteps() {
    return [
      {
        tab: 'content',
        target: '#loc-list',
        title: 'Add your locations',
        body: 'Add every place you want on the map — your office, partner hotels, a meeting point. Each pin can have a title, description, photo and link. Use Add location for each one.',
        placement: 'right'
      },
      {
        tab: 'content',
        target: '#add-loc',
        title: 'Address in, pin out',
        body: 'Open a location, type its address and press Find — we drop the pin for you, no coordinates to look up. Or paste latitude and longitude directly if you have them.',
        placement: 'right'
      },
      {
        tab: 'design',
        target: '#style-picker',
        title: 'Pick a map style',
        body: 'Streets is the classic look, Minimal and Muted keep things calm, Dark suits dark pages, and Satellite is lovely for resorts. Auto follows your light/dark theme.',
        placement: 'right'
      },
      {
        tab: 'design',
        target: '#accent-col',
        title: 'Colour your pins',
        body: 'Set a default pin colour to match your brand. Any location can override it with its own colour, handy for grouping different kinds of place.',
        placement: 'right'
      },
      {
        tab: 'settings',
        target: '#show-list',
        title: 'Tune the behaviour',
        body: 'Show a side list of locations, switch the info card and directions button on or off, and decide whether the map auto-fits to all your pins. Sensible defaults are already set.',
        placement: 'right'
      },
      {
        target: '.tgse-preview',
        title: 'See it live',
        body: 'The preview updates as you go and works at every screen size — try the desktop, tablet and mobile buttons up top.',
        placement: 'left',
        spotlightPadding: 6
      },
      {
        target: '#btn-save',
        title: 'Save your map',
        body: 'Give it a name and save. Your map is stored and ready to embed.',
        placement: 'bottom'
      },
      {
        target: '#btn-embed',
        title: 'Drop it on your site',
        body: 'Click Get embed code and paste the single line wherever the map should appear. That’s it.',
        placement: 'bottom'
      }
    ];
  }

  var WELCOME = {
    titleHtml: 'Let\u2019s build your <em>map</em>.',
    body: 'A quick walk through the setup, one step at a time. About a minute, and your visitors will see exactly where to find you. Ready?'
  };
  var DONE = {
    titleHtml: 'All set. <em>Your map is ready.</em>',
    body: 'Showing people where you are — and which partners you work with — builds confidence fast. Save it, then click Get embed code and paste that one line on your site. You can reopen this walkthrough any time from the button in the corner.'
  };

  var _api = null;
  function launch() {
    if (!window.tgse || typeof window.tgse.tour !== 'function') {
      console.warn('[maps-tour] tgse.tour not available — load editor-tour.js');
      return;
    }
    if (_api && typeof _api.finish === 'function') { try { _api.finish(false); } catch (e) {} }
    _api = window.tgse.tour({ id: 'maps', welcome: WELCOME, done: DONE, steps: buildSteps() });
    _api.start();
    return _api;
  }

  var _booted = false;
  window.initMapsTour = function () {
    if (_booted) return;
    _booted = true;
    if (!window.tgse || typeof window.tgse.tourLauncher !== 'function') {
      console.warn('[maps-tour] tgse.tourLauncher not available');
      return;
    }
    window.tgse.tourLauncher({ id: 'maps', label: 'Show me how', onClick: launch });
    if (!window.tgse.isTourDismissed || !window.tgse.isTourDismissed('maps')) {
      setTimeout(launch, 650);
    }
  };

})();
