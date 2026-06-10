/* ============================================================================
   Back to Top — guided setup tour  v1.0.0
   ----------------------------------------------------------------------------
   Walkthrough for the Back to Top editor. Leads with the headline behaviour —
   when the button appears (the scroll percentage) — then look (corner, shape,
   icon/label), then preview / save / embed.

   Requires editor-tour.js.

   Static .tgse-panel[data-tab] with .tgse-section / .tgse-section.is-open. The
   engine auto-opens any closed .tgse-section a target sits inside.

   Stable ids: #after-input (Settings); #pos-picker, #shape-picker (Design);
   #icon-picker (Content); #btn-save, #btn-embed. Default tab is Design.
   loadFromUrl() is the funnel, gated on isLoggedIn via onReady, so the tour
   starts from the logged-in path and from onLoginSuccess.
   ============================================================================ */
(function () {
  'use strict';

  function buildSteps() {
    return [
      {
        tab: 'settings',
        target: '#after-input',
        title: 'Choose when it appears',
        body: 'This is the important one. The button stays hidden until the visitor has scrolled this far down the page — 25% is a good default. Drag it up for long pages, down if you want it sooner.',
        placement: 'right'
      },
      {
        tab: 'design',
        target: '#pos-picker',
        title: 'Pick a corner',
        body: 'Park the button bottom-left, bottom-centre or bottom-right. Bottom-right is the convention most visitors expect.',
        placement: 'right'
      },
      {
        tab: 'design',
        target: '#shape-picker',
        title: 'Shape and size',
        body: 'Circle, rounded or square — then set the size, edge spacing and accent colour just below. The icon colour adjusts itself for contrast.',
        placement: 'right'
      },
      {
        tab: 'content',
        target: '#icon-picker',
        title: 'Icon and label',
        body: 'Choose the up-arrow style, and optionally turn on a short text label like “Top”.',
        placement: 'right'
      },
      {
        target: '.tgse-preview',
        title: 'See it live',
        body: 'The button is always shown here so you can style it. On a real page it stays hidden until the scroll point you set, then fades in. Try the desktop, tablet and mobile buttons up top.',
        placement: 'left',
        spotlightPadding: 6
      },
      {
        target: '#btn-save',
        title: 'Save it',
        body: 'Give it a name and save. Your Back to Top button is stored and ready to embed.',
        placement: 'bottom'
      },
      {
        target: '#btn-embed',
        title: 'Drop it on your site',
        body: 'Click Get embed code and paste the single line anywhere on the page. One button covers the whole page.',
        placement: 'bottom'
      }
    ];
  }

  var WELCOME = {
    titleHtml: 'Let\u2019s set up your <em>Back to Top</em> button.',
    body: 'A quick walk through the setup, one step at a time. Under a minute, and visitors get an easy way back to the top of long pages. Ready?'
  };
  var DONE = {
    titleHtml: 'All set. <em>Nice and simple.</em>',
    body: 'On long pages a Back to Top button is a small touch that makes a site feel considered. Save it, then click Get embed code and paste that one line on your site. You can reopen this walkthrough any time from the button in the corner.'
  };

  var _api = null;
  function launch() {
    if (!window.tgse || typeof window.tgse.tour !== 'function') {
      console.warn('[backtotop-tour] tgse.tour not available — load editor-tour.js');
      return;
    }
    if (_api && typeof _api.finish === 'function') { try { _api.finish(false); } catch (e) {} }
    _api = window.tgse.tour({ id: 'backtotop', welcome: WELCOME, done: DONE, steps: buildSteps() });
    _api.start();
    return _api;
  }

  var _booted = false;
  window.initBackToTopTour = function () {
    if (_booted) return;
    _booted = true;
    if (!window.tgse || typeof window.tgse.tourLauncher !== 'function') {
      console.warn('[backtotop-tour] tgse.tourLauncher not available');
      return;
    }
    window.tgse.tourLauncher({ id: 'backtotop', label: 'Show me how', onClick: launch });
    if (!window.tgse.isTourDismissed || !window.tgse.isTourDismissed('backtotop')) {
      setTimeout(launch, 650);
    }
  };

})();
