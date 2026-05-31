/* ============================================================================
   Opening Hours — guided setup tour  v1.0.0
   ----------------------------------------------------------------------------
   Walkthrough for the Opening Hours editor. Preview-first: we lead with the
   weekly hours grid (which fills the preview from the seeded Mon-Fri defaults),
   then holiday overrides, the live open/closed status, layout, title and time
   format.

   Requires editor-tour.js.

   This editor (World Map / Airport family): static .tgse-panel[data-tab] with
   .tgse-section / .tgse-section.is-open; the engine auto-opens any closed
   .tgse-section a target sits inside, so no beforeShow reveals are needed.

   IMPORTANT: the middle tab is "hours" (not "content"): tabs are
   design / hours / settings.

   Stable ids: #hoursGrid, #holidayAdd (Hours tab); #toggleStatus (Settings,
   Live status); #layoutGrid, #titleInput, #timeFormatSeg (Design). Default tab
   is Design. loadFromUrl() is the funnel, gated on isLoggedIn via onReady, so
   the tour is started from the logged-in path and from onLoginSuccess.
   ============================================================================ */
(function () {
  'use strict';

  function buildSteps() {
    return [
      {
        tab: 'hours',
        target: '#hoursGrid',
        title: 'Set your opening hours',
        body: 'Set when you are open each day. Add a break for lunch by giving a day two slots, or mark a day closed. The preview shows your week straight away.',
        placement: 'right'
      },
      {
        tab: 'hours',
        target: '#holidayAdd',
        title: 'Add holiday overrides',
        body: 'Closing for a bank holiday or opening late one day? Add a one-off override here and it takes priority over the usual hours, so customers always see the right thing.',
        placement: 'right'
      },
      {
        tab: 'settings',
        target: '#toggleStatus',
        title: 'Show a live open or closed badge',
        body: 'This is a lovely touch. Switch it on and visitors see Open now or Closed in real time, updating every minute against your hours. It tells people exactly when to get in touch.',
        placement: 'right'
      },
      {
        tab: 'design',
        target: '#layoutGrid',
        title: 'Choose the layout',
        body: 'A simple list, a tidy card, or a compact strip for a footer or sidebar. Pick what fits where you want to show your hours.',
        placement: 'right'
      },
      {
        tab: 'design',
        target: '#timeFormatSeg',
        title: 'Labels and time format',
        body: 'Choose short or full day names and pick 12 or 24 hour time, so it reads the way your customers expect.',
        placement: 'right'
      },
      {
        target: '.tgse-preview',
        title: 'See it come together',
        body: 'The preview updates as you go, so you always know exactly how your hours will look on your site.',
        placement: 'left',
        spotlightPadding: 6
      },
      {
        target: '#btn-save',
        title: 'Save your opening hours',
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
    titleHtml: 'Let\u2019s set up your <em>opening hours</em>.',
    body: 'A quick walk through the setup, one step at a time. About a minute, and your customers will always know when you are open. Ready?'
  };
  var DONE = {
    titleHtml: 'All set. <em>Your opening hours are ready.</em>',
    body: 'No more guessing or missed calls. Customers see exactly when you are around, holidays and all. Save it, then click Get embed code and paste that one line on your site. You can reopen this walkthrough any time from the button in the corner.'
  };

  var _api = null;
  function launch() {
    if (!window.tgse || typeof window.tgse.tour !== 'function') {
      console.warn('[hours-tour] tgse.tour not available — load editor-tour.js');
      return;
    }
    if (_api && typeof _api.finish === 'function') { try { _api.finish(false); } catch (e) {} }
    _api = window.tgse.tour({ id: 'hours', welcome: WELCOME, done: DONE, steps: buildSteps() });
    _api.start();
    return _api;
  }

  var _booted = false;
  window.initHoursTour = function () {
    if (_booted) return;
    _booted = true;
    if (!window.tgse || typeof window.tgse.tourLauncher !== 'function') {
      console.warn('[hours-tour] tgse.tourLauncher not available');
      return;
    }
    window.tgse.tourLauncher({ id: 'hours', label: 'Show me how', onClick: launch });
    if (!window.tgse.isTourDismissed || !window.tgse.isTourDismissed('hours')) {
      setTimeout(launch, 650);
    }
  };

})();
