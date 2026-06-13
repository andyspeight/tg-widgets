/* ============================================================================
   Deal Bar — guided setup tour  v1.0.0
   ----------------------------------------------------------------------------
   Walkthrough for the Deal Bar editor. Leads with the message (the whole
   point), then the button, then the countdown that drives urgency, then look,
   then preview / save / embed.

   Requires editor-tour.js.

   Stable ids: #msg-input, #cta-fields, #countdown-fields (Content);
   #pos-picker (Design); #btn-save, #btn-embed. Default tab is Design.
   ============================================================================ */
(function () {
  'use strict';

  function buildSteps() {
    return [
      {
        tab: 'content',
        target: '#msg-input',
        title: 'Write your announcement',
        body: 'This is the headline. Keep it short and specific, like "Late deals out now, save up to 40% on summer breaks". Add a leading emoji just below if you fancy one.',
        placement: 'right'
      },
      {
        tab: 'content',
        target: '#cta-fields',
        title: 'Add a button',
        body: 'Point visitors straight at the offer. Set the label and the link, for example your late deals page. Turn the button off if the bar is just an announcement.',
        placement: 'right'
      },
      {
        tab: 'content',
        target: '#countdown-fields',
        title: 'Build urgency',
        body: 'Switch on a countdown to your deadline and the bar shows a live clock ticking down. Great for "book by Friday" style offers.',
        placement: 'right'
      },
      {
        tab: 'design',
        target: '#pos-picker',
        title: 'Top or bottom',
        body: 'Pin the bar to the top or the bottom of the page, then set the bar and button colours just below to match your brand.',
        placement: 'right'
      },
      {
        target: '.tgse-preview',
        title: 'See it live',
        body: 'The bar is always shown here so you can style it. On a real page it slides in, nudges your content out of the way and remembers when a visitor closes it. Try the desktop, tablet and mobile buttons up top.',
        placement: 'left',
        spotlightPadding: 6
      },
      {
        target: '#btn-save',
        title: 'Save it',
        body: 'Give it a name and save. Your Deal Bar is stored and ready to embed.',
        placement: 'bottom'
      },
      {
        target: '#btn-embed',
        title: 'Drop it on your site',
        body: 'Click Get embed code and paste the single line anywhere on the page. One line covers every page.',
        placement: 'bottom'
      }
    ];
  }

  var WELCOME = {
    titleHtml: 'Let’s set up your <em>Deal Bar</em>.',
    body: 'A quick walk through the setup, one step at a time. Under a minute, and you have a slim bar that pushes your best offer on every page. Ready?'
  };
  var DONE = {
    titleHtml: 'All set. <em>Go win some bookings.</em>',
    body: 'A deal bar is the simplest way to put an offer in front of every visitor. Save it, then click Get embed code and paste that one line on your site. You can reopen this walkthrough any time from the button in the corner.'
  };

  var _api = null;
  function launch() {
    if (!window.tgse || typeof window.tgse.tour !== 'function') {
      console.warn('[dealbar-tour] tgse.tour not available — load editor-tour.js');
      return;
    }
    if (_api && typeof _api.finish === 'function') { try { _api.finish(false); } catch (e) {} }
    _api = window.tgse.tour({ id: 'dealbar', welcome: WELCOME, done: DONE, steps: buildSteps() });
    _api.start();
    return _api;
  }

  var _booted = false;
  window.initDealBarTour = function () {
    if (_booted) return;
    _booted = true;
    if (!window.tgse || typeof window.tgse.tourLauncher !== 'function') {
      console.warn('[dealbar-tour] tgse.tourLauncher not available');
      return;
    }
    window.tgse.tourLauncher({ id: 'dealbar', label: 'Show me how', onClick: launch });
    if (!window.tgse.isTourDismissed || !window.tgse.isTourDismissed('dealbar')) {
      setTimeout(launch, 650);
    }
  };

})();
