/* ============================================================================
   YouTube — guided setup tour  v1.0.0
   ----------------------------------------------------------------------------
   Walkthrough for the YouTube editor. Content-first: we lead with the channel
   lookup (the one thing that makes the feed work), then layout, how many videos,
   the playback behaviour, then preview / save / embed. The editor ships seeded
   with a sample channel, so the preview is populated from the first frame.

   Requires editor-tour.js.

   Static .tgse-panel[data-tab] with .tgse-section / .tgse-section.is-open. The
   engine auto-opens any closed .tgse-section a target sits inside.

   Stable ids: #chan-find (Content); #layout-picker, #max-input (Design);
   #play-mode (Settings). Default tab is Design. loadFromUrl() is the funnel,
   gated on isLoggedIn via onReady, so the tour starts from the logged-in path
   and from onLoginSuccess.
   ============================================================================ */
(function () {
  'use strict';

  function buildSteps() {
    return [
      {
        tab: 'content',
        target: '#chan-find',
        title: 'Point it at a channel',
        body: 'Paste a YouTube channel link, an @handle, or a channel ID, then press Find. We look it up once and store the channel — from then on the widget always shows its newest uploads automatically.',
        placement: 'right'
      },
      {
        tab: 'design',
        target: '#layout-picker',
        title: 'Pick a layout',
        body: 'Grid is the classic wall of videos, Carousel is a swipeable row that saves space, and List puts a thumbnail beside each title with a short description. Switch any time.',
        placement: 'right'
      },
      {
        tab: 'design',
        target: '#max-input',
        title: 'How many to show',
        body: 'Choose how many of the latest videos appear, up to fifteen. For a grid you can also set the number of columns just above.',
        placement: 'right'
      },
      {
        tab: 'settings',
        target: '#play-mode',
        title: 'Choose how videos play',
        body: 'Play in a lightbox right on the page (privacy-friendly, nothing leaves your site until they hit play), or open on YouTube in a new tab. You can also toggle titles, dates and view counts here.',
        placement: 'right'
      },
      {
        target: '.tgse-preview',
        title: 'See it live',
        body: 'The preview pulls the channel’s real videos and updates as you go. Try the desktop, tablet and mobile buttons up top.',
        placement: 'left',
        spotlightPadding: 6
      },
      {
        target: '#btn-save',
        title: 'Save your feed',
        body: 'Give it a name and save. Your video feed is stored and ready to embed.',
        placement: 'bottom'
      },
      {
        target: '#btn-embed',
        title: 'Drop it on your site',
        body: 'Click Get embed code and paste the single line wherever the videos should appear. It keeps itself up to date as you upload.',
        placement: 'bottom'
      }
    ];
  }

  var WELCOME = {
    titleHtml: 'Let\u2019s set up your <em>video feed</em>.',
    body: 'A quick walk through the setup, one step at a time. About a minute, and your latest uploads will show on your site automatically. Ready?'
  };
  var DONE = {
    titleHtml: 'All set. <em>Your videos are ready.</em>',
    body: 'Fresh video keeps a site feeling alive and gives visitors a reason to stay. Save it, then click Get embed code and paste that one line on your site. You can reopen this walkthrough any time from the button in the corner.'
  };

  var _api = null;
  function launch() {
    if (!window.tgse || typeof window.tgse.tour !== 'function') {
      console.warn('[youtube-tour] tgse.tour not available — load editor-tour.js');
      return;
    }
    if (_api && typeof _api.finish === 'function') { try { _api.finish(false); } catch (e) {} }
    _api = window.tgse.tour({ id: 'youtube', welcome: WELCOME, done: DONE, steps: buildSteps() });
    _api.start();
    return _api;
  }

  var _booted = false;
  window.initYouTubeTour = function () {
    if (_booted) return;
    _booted = true;
    if (!window.tgse || typeof window.tgse.tourLauncher !== 'function') {
      console.warn('[youtube-tour] tgse.tourLauncher not available');
      return;
    }
    window.tgse.tourLauncher({ id: 'youtube', label: 'Show me how', onClick: launch });
    if (!window.tgse.isTourDismissed || !window.tgse.isTourDismissed('youtube')) {
      setTimeout(launch, 650);
    }
  };

})();
