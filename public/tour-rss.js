/* ============================================================================
   RSS News Feed — guided setup tour  v1.0.0
   ----------------------------------------------------------------------------
   Walkthrough for the RSS editor. Content-first: we lead with the feeds (the one
   thing that makes it work) and the one-click travel presets, then layout, how
   many articles, the display toggles, then preview / save / embed. The editor
   ships seeded with two reliable travel feeds, so the preview is populated from
   the first frame.

   Requires editor-tour.js.

   Static .tgse-panel[data-tab] with .tgse-section / .tgse-section.is-open. The
   engine auto-opens any closed .tgse-section a target sits inside.

   Stable ids: #preset-grid, #feed-add (Content); #layout-picker, #max-input
   (Design); #show-images (Settings). Default tab is Design. loadFromUrl() is the
   funnel, gated on isLoggedIn via onReady, so the tour starts from the logged-in
   path and from onLoginSuccess.
   ============================================================================ */
(function () {
  'use strict';

  function buildSteps() {
    return [
      {
        tab: 'content',
        target: '#preset-grid',
        title: 'Add your feeds',
        body: 'Tap a popular travel feed to add it instantly, or use “Add feed” just above to paste any RSS or Atom URL. Add up to six — the newest articles from all of them are merged, sorted and de-duplicated for you.',
        placement: 'right'
      },
      {
        tab: 'design',
        target: '#layout-picker',
        title: 'Pick a layout',
        body: 'List puts a thumbnail beside each story, Grid is a tidy card wall, and Compact is a dense headline list. Switch any time.',
        placement: 'right'
      },
      {
        tab: 'design',
        target: '#max-input',
        title: 'How many to show',
        body: 'Choose how many of the latest articles appear, up to thirty across all feeds. For a grid you can also set the number of columns just above.',
        placement: 'right'
      },
      {
        tab: 'settings',
        target: '#show-images',
        title: 'Fine-tune each story',
        body: 'Toggle thumbnails, the source name, the date and a short excerpt — and set how long the excerpt runs. Compact layout always keeps things to a single line.',
        placement: 'right'
      },
      {
        target: '.tgse-preview',
        title: 'See it live',
        body: 'The preview pulls the real articles from your feeds and updates as you go. Try the desktop, tablet and mobile buttons up top.',
        placement: 'left',
        spotlightPadding: 6
      },
      {
        target: '#btn-save',
        title: 'Save your feed',
        body: 'Give it a name and save. Your news feed is stored and ready to embed.',
        placement: 'bottom'
      },
      {
        target: '#btn-embed',
        title: 'Drop it on your site',
        body: 'Click Get embed code and paste the single line wherever the news should appear. It refreshes itself as your feeds publish new stories.',
        placement: 'bottom'
      }
    ];
  }

  var WELCOME = {
    titleHtml: 'Let\u2019s set up your <em>news feed</em>.',
    body: 'A quick walk through the setup, one step at a time. About a minute, and fresh travel stories will show on your site automatically. Ready?'
  };
  var DONE = {
    titleHtml: 'All set. <em>Your feed is ready.</em>',
    body: 'A live stream of fresh content keeps a site feeling current and gives visitors a reason to return. Save it, then click Get embed code and paste that one line on your site. You can reopen this walkthrough any time from the button in the corner.'
  };

  var _api = null;
  function launch() {
    if (!window.tgse || typeof window.tgse.tour !== 'function') {
      console.warn('[rss-tour] tgse.tour not available — load editor-tour.js');
      return;
    }
    if (_api && typeof _api.finish === 'function') { try { _api.finish(false); } catch (e) {} }
    _api = window.tgse.tour({ id: 'rss', welcome: WELCOME, done: DONE, steps: buildSteps() });
    _api.start();
    return _api;
  }

  var _booted = false;
  window.initRssTour = function () {
    if (_booted) return;
    _booted = true;
    if (!window.tgse || typeof window.tgse.tourLauncher !== 'function') {
      console.warn('[rss-tour] tgse.tourLauncher not available');
      return;
    }
    window.tgse.tourLauncher({ id: 'rss', label: 'Show me how', onClick: launch });
    if (!window.tgse.isTourDismissed || !window.tgse.isTourDismissed('rss')) {
      setTimeout(launch, 650);
    }
  };

})();
