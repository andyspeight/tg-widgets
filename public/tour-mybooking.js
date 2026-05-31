/* ============================================================================
   My Booking — guided setup tour  v1.0.0
   ----------------------------------------------------------------------------
   Walkthrough for the My Booking editor (a booking-lookup widget: a customer
   enters their reference and sees their trip). Preview-first: we lead with the
   lookup copy, then layout, brand, support details, the Luna chat link, and the
   display options. The editor ships with a sample booking (DEMO81376) in the
   preview, so everything renders against real-looking data from the first frame.

   Requires editor-tour.js.

   This editor (World Map family): static .tab-content[data-tab] panels with
   .section / .section.open and a .section-head; the editor's own onTabChange
   toggles .tab-content.active. The engine only auto-opens .tgse-section, so the
   two CLOSED sections this tour targets (brand, luna) are opened in beforeShow
   by their data-section, directly (never by clicking the head).

   Stable ids/anchors: #copy-title (Content, copy section — OPEN);
   .section[data-section="layout"] (Design — OPEN); #brand-name (Design, brand —
   CLOSED, revealed); #support-email or the support section (Content, support);
   #luna-connect-btn (Content, luna — CLOSED, revealed);
   .section[data-section="display"] (Settings — OPEN). Default tab is Design.
   bootstrap() is the funnel, reached only when logged in (via onReady and
   onLoginSuccess), so the tour is started from there.
   ============================================================================ */
(function () {
  'use strict';

  function openSection(key) {
    var s = document.querySelector('.section[data-section="' + key + '"]');
    if (s) s.classList.add('open');
  }
  function sectionEl(key) {
    return function () { return document.querySelector('.section[data-section="' + key + '"]'); };
  }

  function buildSteps() {
    return [
      {
        tab: 'content',
        target: '#copy-title',
        title: 'Welcome your customers in',
        body: 'This is the heading and intro on the lookup screen, the first thing a customer sees when they come to check their trip. Keep it warm. The preview shows a sample booking so you can see exactly how it reads.',
        placement: 'right'
      },
      {
        tab: 'design',
        target: sectionEl('layout'),
        title: 'Choose the layout',
        body: 'Vertical stacks everything in one column, horizontal spreads it wider, and compact keeps it tight. Pick what fits the page you will drop it on.',
        placement: 'right'
      },
      {
        tab: 'design',
        target: '#brand-name',
        title: 'Make it yours',
        body: 'Add your company name and set your colours just below, so the booking screen feels like your own site, not a third-party tool.',
        placement: 'right',
        beforeShow: function () { openSection('brand'); }
      },
      {
        tab: 'content',
        target: sectionEl('support'),
        title: 'Add your support details',
        body: 'Pop in the email and phone you want shown if a customer needs a hand. It sits neatly on their booking so help is always one tap away.',
        placement: 'right',
        beforeShow: function () { openSection('support'); }
      },
      {
        tab: 'content',
        target: '#luna-connect-btn',
        title: 'Connect Luna, your AI assistant',
        body: 'This is the clever part. Link your Luna chat and when a customer asks about their booking in chat, Luna looks it up through this widget and answers instantly. A real concierge touch, day or night.',
        placement: 'right',
        beforeShow: function () { openSection('luna'); }
      },
      {
        tab: 'settings',
        target: sectionEl('display'),
        title: 'Choose what to show',
        body: 'Decide how much detail appears, the PDF download, documents, hotel facilities, the cancellation policy and more. Show your customers as much or as little as you like.',
        placement: 'right'
      },
      {
        target: '.tgse-preview',
        title: 'See it come together',
        body: 'The preview shows a sample booking styled to your brand, so you always know exactly how your customers\u2019 trips will look.',
        placement: 'left',
        spotlightPadding: 6
      },
      {
        target: '#btn-save',
        title: 'Save your booking widget',
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
    titleHtml: 'Let\u2019s set up your <em>booking lookup</em>.',
    body: 'A quick walk through the setup, one step at a time. About a minute, and your customers will be able to pull up their whole trip in seconds. Ready?'
  };
  var DONE = {
    titleHtml: 'All set. <em>Your booking lookup is ready.</em>',
    body: 'Customers can see their trip whenever they like, and with Luna connected they can just ask. Save it, then click Get embed code and paste that one line on your site. You can reopen this walkthrough any time from the button in the corner.'
  };

  var _api = null;
  function launch() {
    if (!window.tgse || typeof window.tgse.tour !== 'function') {
      console.warn('[mybooking-tour] tgse.tour not available — load editor-tour.js');
      return;
    }
    if (_api && typeof _api.finish === 'function') { try { _api.finish(false); } catch (e) {} }
    _api = window.tgse.tour({ id: 'mybooking', welcome: WELCOME, done: DONE, steps: buildSteps() });
    _api.start();
    return _api;
  }

  var _booted = false;
  window.initMyBookingTour = function () {
    if (_booted) return;
    _booted = true;
    if (!window.tgse || typeof window.tgse.tourLauncher !== 'function') {
      console.warn('[mybooking-tour] tgse.tourLauncher not available');
      return;
    }
    window.tgse.tourLauncher({ id: 'mybooking', label: 'Show me how', onClick: launch });
    if (!window.tgse.isTourDismissed || !window.tgse.isTourDismissed('mybooking')) {
      setTimeout(launch, 650);
    }
  };

})();
