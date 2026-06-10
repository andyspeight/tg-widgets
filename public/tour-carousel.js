/* ============================================================================
   Destination Carousel — guided setup tour  v1.0.0
   ----------------------------------------------------------------------------
   Walkthrough for the Destination Carousel editor. Leads with the content —
   the slides themselves — then the look (colours, lean), then playback,
   then preview / save / embed.

   Requires editor-tour.js.

   Static .tgse-panel[data-tab] with .tgse-section / .tgse-section.is-open. The
   engine auto-opens any closed .tgse-section a target sits inside.

   Stable ids: #slides-list, #intro-input (Content); #accent-row, #lean-field
   (Design); #interval-field (Settings); #btn-save, #btn-embed. Default tab is
   Design. loadFromUrl() is the funnel, gated on isLoggedIn via onReady, so the
   tour starts from the logged-in path and from onLoginSuccess.
   ============================================================================ */
(function () {
  'use strict';

  function buildSteps() {
    return [
      {
        tab: 'content',
        target: '#slides-list',
        title: 'Add your destinations',
        body: 'Each slide is one destination — name, tagline, a short description, an image and a button. The first slide opens as the big hero; the rest queue up on the right and travel across.',
        placement: 'right'
      },
      {
        tab: 'content',
        target: '#intro-input',
        title: 'Set the scene',
        body: 'The intro line sits centred above the carousel — one sentence that frames the collection, like \u201cFind the perfect place to stay in Mauritius.\u201d',
        placement: 'right'
      },
      {
        tab: 'design',
        target: '#accent-row',
        title: 'Make it yours',
        body: 'The accent colour drives the titles, buttons and lines — gold gives the classic luxury look, but it takes any brand colour. Background and text colours are just above and below.',
        placement: 'right'
      },
      {
        tab: 'design',
        target: '#lean-field',
        title: 'The fan effect',
        body: 'Card lean controls how much the travelling cards tilt and fan. Dial it to 0\u00B0 for a straight, formal row, or up to 8\u00B0 for maximum drama.',
        placement: 'right'
      },
      {
        tab: 'settings',
        target: '#interval-field',
        title: 'Set the pace',
        body: 'How long each destination holds the hero spot before the next one sweeps in. Rotation pauses on hover and whenever the carousel is off-screen.',
        placement: 'right'
      },
      {
        target: '.tgse-preview',
        title: 'Watch it move',
        body: 'Click the smaller cards or use the arrows — every card travels left and grows into the hero. Try the desktop, tablet and mobile buttons up top; on narrow screens it becomes a single full-bleed slide.',
        placement: 'left',
        spotlightPadding: 6
      },
      {
        target: '#btn-save',
        title: 'Save it',
        body: 'Give it a name and save. Your carousel is stored and ready to embed.',
        placement: 'bottom'
      },
      {
        target: '#btn-embed',
        title: 'Put it on your site',
        body: 'Click Get embed code and paste the snippet where you want the carousel to appear. It fills the width of whatever container you give it.',
        placement: 'bottom'
      }
    ];
  }

  var WELCOME = {
    titleHtml: 'Let\u2019s build your <em>Destination Carousel</em>.',
    body: 'A quick walk through the setup, one step at a time. A few minutes, and your destinations get a cinematic showcase that sells the dream. Ready?'
  };
  var DONE = {
    titleHtml: 'All set. <em>Now make it glow.</em>',
    body: 'The single biggest upgrade from here is photography — bright, high-quality destination images make this widget. Save it, then click Get embed code and paste the snippet on your site. You can reopen this walkthrough any time from the button in the corner.'
  };

  var _api = null;
  function launch() {
    if (!window.tgse || typeof window.tgse.tour !== 'function') {
      console.warn('[carousel-tour] tgse.tour not available — load editor-tour.js');
      return;
    }
    if (_api && typeof _api.finish === 'function') { try { _api.finish(false); } catch (e) {} }
    _api = window.tgse.tour({ id: 'carousel', welcome: WELCOME, done: DONE, steps: buildSteps() });
    _api.start();
    return _api;
  }

  var _booted = false;
  window.initCarouselTour = function () {
    if (_booted) return;
    _booted = true;
    if (!window.tgse || typeof window.tgse.tourLauncher !== 'function') {
      console.warn('[carousel-tour] tgse.tourLauncher not available');
      return;
    }
    window.tgse.tourLauncher({ id: 'carousel', label: 'Show me how', onClick: launch });
    if (!window.tgse.isTourDismissed || !window.tgse.isTourDismissed('carousel')) {
      setTimeout(launch, 650);
    }
  };

})();
