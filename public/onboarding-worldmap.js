/* ============================================================================
   World Map — guided setup tour  v1.0.0
   ----------------------------------------------------------------------------
   Defines the step-by-step walkthrough for the World Map editor. Each step
   spotlights a REAL control and tells the user what to do. The tour switches
   tabs as needed and advances on Next (or automatically when the user performs
   the action, where that helps).

   Requires editor-tour.js (adds tgse.tour + tgse.tourLauncher).

   Real anchors (verified against editor-worldmap.html):
     #f-title              Title input            (Content tab)
     #cur-regions          Destinations chooser   (Content tab)
     #col-accent           Accent colour          (Design tab)
     #fontPickerMount      Font picker            (Design tab)
     #f-fullscreen         Fullscreen toggle      (Settings tab)
     #btn-save             Save button            (header)
     #btn-embed            Get embed code         (preview toolbar)
   ============================================================================ */
(function () {
  'use strict';

  function buildSteps() {
    return [
      {
        tab: 'content',
        target: '#f-title',
        title: 'Give your map a heading',
        body: 'This sits above the map on your site. Something inviting works best, like "Where will you go next?". Type yours here.',
        placement: 'right'
      },
      {
        tab: 'content',
        target: '#cur-regions',
        title: 'Choose your destinations',
        body: 'Tick a whole region to switch on every country in it, or pick them one by one. Leave it all unticked and the map shows every destination you have offers for.',
        placement: 'right'
      },
      {
        tab: 'design',
        target: function () { return document.querySelector('#col-accent') ? document.querySelector('#col-accent').closest('.tgwm-field') || document.querySelector('#col-accent') : null; },
        title: 'Set your accent colour',
        body: 'This is the colour of your active pins and highlights. Click the swatch or type a hex code to match your brand.',
        placement: 'right'
      },
      {
        tab: 'design',
        target: function () { return document.querySelector('#col-primary') ? document.querySelector('#col-primary').closest('.tgwm-field') || document.querySelector('#col-primary') : null; },
        title: 'And your primary colour',
        body: 'This is the structural colour behind the price tags and the fullscreen button. Keep it dark so the white text stays readable. We warn you if a shade is too light.',
        placement: 'right'
      },
      {
        tab: 'design',
        target: '#fontPickerMount',
        title: 'Pick a font',
        body: 'Choose a typeface that matches the rest of your website, so the map looks like it belongs there rather than bolted on.',
        placement: 'right'
      },
      {
        tab: 'settings',
        target: function () { return document.querySelector('#f-fullscreen') ? document.querySelector('#f-fullscreen').closest('.tgwm-toggle-row') || document.querySelector('#f-fullscreen') : null; },
        title: 'Let visitors go fullscreen',
        body: 'Leave this on and visitors get an immersive, filterable map of every deal, with budget and star-rating filters. It is where browsing turns into booking.',
        placement: 'right'
      },
      {
        target: '.tgse-preview',
        title: 'Watch it update live',
        body: 'Every change you make shows here straight away on the real widget, so you always know exactly what your customers will see.',
        placement: 'left',
        spotlightPadding: 6
      },
      {
        target: '#btn-save',
        title: 'Save your map',
        body: 'When it looks right, hit Save. You can come back and tweak any of this whenever you like.',
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
    titleHtml: 'Let\u2019s put your <em>live map</em> on your site.',
    body: 'A quick walk through the setup, one control at a time. It takes about a minute, and you can do each step yourself as we go. Ready?'
  };
  var DONE = {
    titleHtml: 'Nicely done. <em>Your map is ready.</em>',
    body: 'Heading set, destinations chosen, brand applied. Save your map, then click Get embed code and paste that one line on your site. Your live offers will be on the map. You can reopen this walkthrough any time from the button in the corner.'
  };

  var _api = null;
  function launch() {
    if (!window.tgse || typeof window.tgse.tour !== 'function') {
      console.warn('[worldmap-tour] tgse.tour not available — load editor-tour.js');
      return;
    }
    _api = window.tgse.tour({
      id: 'worldmap',
      welcome: WELCOME,
      done: DONE,
      steps: buildSteps()
    });
    _api.start();
    return _api;
  }

  // Public entry. Mounts the persistent launcher, and auto-starts on login
  // unless the user ticked "don't show this again".
  var _booted = false;
  window.initWorldMapTour = function () {
    if (_booted) return;
    _booted = true;
    if (!window.tgse || typeof window.tgse.tourLauncher !== 'function') {
      console.warn('[worldmap-tour] tgse.tourLauncher not available');
      return;
    }
    window.tgse.tourLauncher({ id: 'worldmap', label: 'Show me how', onClick: launch });
    if (!window.tgse.isTourDismissed || !window.tgse.isTourDismissed('worldmap')) {
      setTimeout(launch, 650);
    }
  };

})();
