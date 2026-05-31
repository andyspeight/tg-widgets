/* ============================================================================
   Social Share — guided setup tour  v1.0.0
   ----------------------------------------------------------------------------
   Walkthrough for the Social Share editor. Preview-first: we lead with the
   platforms (the share buttons that fill the preview), then what gets shared,
   then layout, brand and behaviour.

   Requires editor-tour.js.

   This editor (World Map / Airport family): static .tgse-panel[data-tab] with
   .tgse-section / .tgse-section.is-open. The engine auto-opens any closed
   .tgse-section a target sits inside, so no beforeShow reveals are needed.
   Stable ids: #platformsList, #shareUrlInput (Content); #layoutGrid, #colBrand
   (Design). The Settings behaviour controls have no single stable id, so that
   step targets the .tgse-section labelled "Behaviour" by a function. Default
   tab is Design. boot() gates on login, so the tour is started from the
   logged-in path and from onLoginSuccess.
   ============================================================================ */
(function () {
  'use strict';

  function sectionByLabel(t) {
    return function () {
      var l = Array.prototype.slice.call(document.querySelectorAll('.tgse-section .tgse-section-label'))
        .find(function (e) { return e.textContent.trim().toLowerCase() === t.toLowerCase(); });
      return l ? l.closest('.tgse-section') : null;
    };
  }

  function buildSteps() {
    return [
      {
        tab: 'content',
        target: '#platformsList',
        title: 'Pick your platforms',
        body: 'Choose which buttons to show, Facebook, WhatsApp, X, email and the rest. Drag to reorder them. The preview fills in as you toggle each one on.',
        placement: 'right'
      },
      {
        tab: 'content',
        target: '#shareUrlInput',
        title: 'What gets shared',
        body: 'By default we share the page the widget is on, which is usually exactly what you want. To always share one specific link, like an offers page, pop it in here with your own share text.',
        placement: 'right'
      },
      {
        tab: 'design',
        target: '#layoutGrid',
        title: 'Choose the layout',
        body: 'An inline strip sits in the page, a floating rail clings to the side, a floating dock pins to the bottom, and compact tucks everything behind one Share button. Pick what suits.',
        placement: 'right'
      },
      {
        tab: 'design',
        target: '#colBrand',
        title: 'Match your brand',
        body: 'Keep each platform in its own familiar colour, or switch the colour mode just above to tint everything in your brand colour for a cleaner look.',
        placement: 'right'
      },
      {
        tab: 'settings',
        target: sectionByLabel('Behaviour'),
        title: 'Behaviour and tracking',
        body: 'Turn on click tracking to see which buttons get used, and for the floating layouts you can hold them back until the visitor has scrolled a little way down.',
        placement: 'right'
      },
      {
        target: '.tgse-preview',
        title: 'See it come together',
        body: 'The preview updates as you go, so you always know exactly how your share buttons will look on your site.',
        placement: 'left',
        spotlightPadding: 6
      },
      {
        target: '#btn-save',
        title: 'Save your share buttons',
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
    titleHtml: 'Let\u2019s set up your <em>share buttons</em>.',
    body: 'A quick walk through the setup, one step at a time. About a minute, and your visitors will be spreading the word for you. Ready?'
  };
  var DONE = {
    titleHtml: 'All set. <em>Your share buttons are ready.</em>',
    body: 'Every share is a free recommendation to someone\u2019s friends. Save it, then click Get embed code and paste that one line on your site. You can reopen this walkthrough any time from the button in the corner.'
  };

  var _api = null;
  function launch() {
    if (!window.tgse || typeof window.tgse.tour !== 'function') {
      console.warn('[share-tour] tgse.tour not available — load editor-tour.js');
      return;
    }
    if (_api && typeof _api.finish === 'function') { try { _api.finish(false); } catch (e) {} }
    _api = window.tgse.tour({ id: 'share', welcome: WELCOME, done: DONE, steps: buildSteps() });
    _api.start();
    return _api;
  }

  var _booted = false;
  window.initShareTour = function () {
    if (_booted) return;
    _booted = true;
    if (!window.tgse || typeof window.tgse.tourLauncher !== 'function') {
      console.warn('[share-tour] tgse.tourLauncher not available');
      return;
    }
    window.tgse.tourLauncher({ id: 'share', label: 'Show me how', onClick: launch });
    if (!window.tgse.isTourDismissed || !window.tgse.isTourDismissed('share')) {
      setTimeout(launch, 650);
    }
  };

})();
