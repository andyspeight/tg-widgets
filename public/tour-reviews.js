/* ============================================================================
   Reviews — guided setup tour  v1.0.0
   ----------------------------------------------------------------------------
   Walkthrough for the Reviews editor. Preview-first: we lead with the
   business header (name + rating + total), which renders in the preview from
   the defaults, then the reviews themselves, then design and display.

   Requires editor-tour.js.

   This editor (Pricing/Reviews family): three panels #panel-design /
   #panel-content / #panel-settings are JS-rendered by dTab()/cTab()/sTab().
   Sections are .sec / .sec.open with a .sec-hd head and .sec-tt title; there
   is no stable per-section id, so section steps use a function target that
   finds the .sec by its title text. Controls use inline handlers + data-bind,
   so we anchor on the stable ones (input[data-bind="place.name"], the .lp
   layout picker, the .presets swatches, .reviews-header) and on #btn-save /
   #btn-embed. Default tab is Design. boot() returns early if not logged in,
   so the tour is started from inside the logged-in path.
   ============================================================================ */
(function () {
  'use strict';

  // Find a .sec section by (partial, case-insensitive) title text.
  function secByTitle(t) {
    return function () {
      var tt = Array.prototype.slice.call(document.querySelectorAll('.sec .sec-tt'))
        .find(function (e) { return e.textContent.toLowerCase().indexOf(t.toLowerCase()) > -1; });
      return tt ? tt.closest('.sec') : null;
    };
  }

  function buildSteps() {
    return [
      {
        tab: 'design',
        target: function () { var el = document.querySelector('input[data-bind="place.name"]'); return el && el.closest ? el.closest('.sec') : el; },
        title: 'Your business',
        body: 'This is your business info, and there are three fields to fill in here, your business name, your star rating and how many reviews you have. Set each one and the preview shows the rating summary straight away, the bit that builds instant trust. Fill them all in before you hit Next.',
        placement: 'right'
      },
      {
        tab: 'content',
        target: function () { return document.querySelector('.reviews-header'); },
        title: 'Add your reviews',
        body: 'Three ways to fill this in. Let AI generate realistic reviews to start with, upload a spreadsheet of your real ones, or add them by hand. Each review can have a photo, tags and your owner reply.',
        placement: 'right'
      },
      {
        tab: 'design',
        target: '.lp',
        title: 'Choose the layout',
        body: 'Cards, masonry, a sliding carousel, a single spotlight, a compact badge or a scrolling ticker. Pick the one that fits the space and watch the preview change.',
        placement: 'right'
      },
      {
        tab: 'design',
        target: '.presets',
        title: 'Match your brand',
        body: 'Tap a preset for an instant colour scheme, or set your brand and accent colours by hand just above. The card and page colours are yours to tweak too.',
        placement: 'right'
      },
      {
        tab: 'settings',
        target: secByTitle('Display'),
        title: 'Trust strip and CTA',
        body: 'Show a trust strip with your overall score, and add a Write a review button so happy customers can leave their own. Small things that turn browsers into bookers.',
        placement: 'right'
      },
      {
        target: '.tgse-preview',
        title: 'See it come together',
        body: 'The preview updates as you go, so you always know exactly how your reviews will look on your site.',
        placement: 'left',
        spotlightPadding: 6
      },
      {
        target: '#btn-save',
        title: 'Save your reviews widget',
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
    titleHtml: 'Let\u2019s set up your <em>reviews</em>.',
    body: 'A quick walk through the setup, one step at a time. About a minute, and your best reviews will be ready to show off. Ready?'
  };
  var DONE = {
    titleHtml: 'All set. <em>Your reviews are ready.</em>',
    body: 'Real social proof, laid out and styled to your brand. Save it, then click Get embed code and paste that one line on your site. Nothing sells a holiday like a happy customer. You can reopen this walkthrough any time from the button in the corner.'
  };

  var _api = null;
  function launch() {
    if (!window.tgse || typeof window.tgse.tour !== 'function') {
      console.warn('[reviews-tour] tgse.tour not available — load editor-tour.js');
      return;
    }
    if (_api && typeof _api.finish === 'function') { try { _api.finish(false); } catch (e) {} }
    _api = window.tgse.tour({ id: 'reviews', welcome: WELCOME, done: DONE, steps: buildSteps() });
    _api.start();
    return _api;
  }

  var _booted = false;
  window.initReviewsTour = function () {
    if (_booted) return;
    _booted = true;
    if (!window.tgse || typeof window.tgse.tourLauncher !== 'function') {
      console.warn('[reviews-tour] tgse.tourLauncher not available');
      return;
    }
    window.tgse.tourLauncher({ id: 'reviews', label: 'Show me how', onClick: launch });
    if (!window.tgse.isTourDismissed || !window.tgse.isTourDismissed('reviews')) {
      setTimeout(launch, 650);
    }
  };

})();
