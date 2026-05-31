/* ============================================================================
   Event Calendar — guided setup tour  v1.0.0
   ----------------------------------------------------------------------------
   Walkthrough for the Event Calendar editor. Preview-first: we lead with the
   Travelgenix events feed (which fills the calendar instantly), then the
   client's own events, then the view, header, colours and click behaviour.

   Requires editor-tour.js.

   This editor (Countdown family): static .tab-panel[data-panel] mirrored by the
   editor's own onTabChange; sections are .sec / .sec.is-open with a .sec-head
   and .sec-title. The engine only auto-opens .tgse-section, so the one CLOSED
   section this tour targets (Colours) is opened in beforeShow by title text.

   Stable ids: #add-event (Content, Your events); #sb-layout, #sb-colours
   (Design); #months-range (Content, Travelgenix events feed range). The feed
   section and the Header section have no single stable id, so those steps use a
   function target that finds the .sec by its title. Default tab is Design.
   loadFromUrl() is the funnel, gated on isLoggedIn via onReady, so the tour is
   started from the logged-in path and from onLoginSuccess.
   ============================================================================ */
(function () {
  'use strict';

  function secByTitle(t) {
    return function () {
      var tt = Array.prototype.slice.call(document.querySelectorAll('.sec .sec-title'))
        .find(function (e) { return e.textContent.replace(/\s+/g, ' ').trim().toLowerCase().indexOf(t.toLowerCase()) > -1; });
      return tt ? tt.closest('.sec') : null;
    };
  }
  function openSecByTitle(t) {
    var s = secByTitle(t)();
    if (s) s.classList.add('is-open');
  }

  function buildSteps() {
    return [
      {
        tab: 'content',
        target: secByTitle('Travelgenix events'),
        title: 'Start with our events feed',
        body: 'The quickest win. Switch on our curated feed and your calendar fills with travel-industry dates, festivals, sporting fixtures and more, kept up to date for you. Pick the mix that suits your clients.',
        placement: 'right'
      },
      {
        tab: 'content',
        target: '#add-event',
        title: 'Add your own events',
        body: 'Now add your own, an open evening, a destination night, a webinar. Give each a name, dates and a category. They sit right alongside the feed in the calendar.',
        placement: 'right'
      },
      {
        tab: 'design',
        target: '#sb-layout',
        title: 'Choose the view',
        body: 'A chronological list, a proper month grid, or featured cards for what is coming up. Pick how your visitors browse what is on.',
        placement: 'right'
      },
      {
        tab: 'design',
        target: secByTitle('Header'),
        title: 'Add a heading',
        body: 'Give the calendar a title and subtitle, something like What\u2019s on or Upcoming events, so visitors know what they are looking at.',
        placement: 'right'
      },
      {
        tab: 'design',
        target: '#sb-colours',
        title: 'Match your brand',
        body: 'Set your colours so the calendar looks like part of your site. Categories can carry their own colours too, which makes a busy month easy to read at a glance.',
        placement: 'right',
        beforeShow: function () { openSecByTitle('Colours'); }
      },
      {
        tab: 'settings',
        target: secByTitle('Display'),
        title: 'Display and click behaviour',
        body: 'Choose how much shows at once and what happens when someone clicks an event, open the details, jump to a booking link, or send them to an enquiry. Turn interest into action.',
        placement: 'right'
      },
      {
        target: '.tgse-preview',
        title: 'See it come together',
        body: 'The preview updates as you go, so you always know exactly how your calendar will look on your site.',
        placement: 'left',
        spotlightPadding: 6
      },
      {
        target: '#btn-save',
        title: 'Save your calendar',
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
    titleHtml: 'Let\u2019s set up your <em>event calendar</em>.',
    body: 'A quick walk through the setup, one step at a time. About a minute, and you will have a calendar that gives people a reason to keep coming back. Ready?'
  };
  var DONE = {
    titleHtml: 'All set. <em>Your calendar is ready.</em>',
    body: 'A reason to return is worth a lot. Between our feed and your own events there is always something on. Save it, then click Get embed code and paste that one line on your site. You can reopen this walkthrough any time from the button in the corner.'
  };

  var _api = null;
  function launch() {
    if (!window.tgse || typeof window.tgse.tour !== 'function') {
      console.warn('[events-tour] tgse.tour not available — load editor-tour.js');
      return;
    }
    if (_api && typeof _api.finish === 'function') { try { _api.finish(false); } catch (e) {} }
    _api = window.tgse.tour({ id: 'events', welcome: WELCOME, done: DONE, steps: buildSteps() });
    _api.start();
    return _api;
  }

  var _booted = false;
  window.initEventsTour = function () {
    if (_booted) return;
    _booted = true;
    if (!window.tgse || typeof window.tgse.tourLauncher !== 'function') {
      console.warn('[events-tour] tgse.tourLauncher not available');
      return;
    }
    window.tgse.tourLauncher({ id: 'events', label: 'Show me how', onClick: launch });
    if (!window.tgse.isTourDismissed || !window.tgse.isTourDismissed('events')) {
      setTimeout(launch, 650);
    }
  };

})();
