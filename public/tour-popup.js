/* ============================================================================
   Popup — guided setup tour  v1.0.0
   ----------------------------------------------------------------------------
   Walkthrough for the Popup editor. Preview-first: we lead with the content
   type and the message (what the popup actually says), then the look, the all
   important trigger (when it appears) and frequency (how often), so a client
   builds something useful without being annoying.

   Requires editor-tour.js.

   This editor (Countdown family): static .tab-panel[data-panel] mirrored by the
   editor's own onTabChange; sections are .sec / .sec.is-open with a .sec-head
   and .sec-title. The engine only auto-opens .tgse-section, so the one CLOSED
   section this tour targets (Frequency) is opened in beforeShow by title text.

   Stable ids: #sb-content-type, #sb-content-fields (Content); #sb-layout,
   #sb-trigger, #sb-colours (Design); #sb-frequency (Settings). Default tab is
   Design. loadFromUrl() is the funnel, gated on isLoggedIn via onReady, so the
   tour starts from the logged-in path and from onLoginSuccess.
   ============================================================================ */
(function () {
  'use strict';

  function openSecByTitle(t) {
    var tt = Array.prototype.slice.call(document.querySelectorAll('.sec .sec-title'))
      .find(function (e) { return e.textContent.trim().toLowerCase() === t.toLowerCase(); });
    if (tt && tt.closest) { var s = tt.closest('.sec'); if (s) s.classList.add('is-open'); }
  }

  function buildSteps() {
    return [
      {
        tab: 'content',
        target: '#sb-content-type',
        title: 'What kind of popup',
        body: 'Start by picking the job it does, capture an email, push an offer, make an announcement or point people somewhere. The right fields appear underneath for whatever you choose.',
        placement: 'right'
      },
      {
        tab: 'content',
        target: '#sb-content-fields',
        title: 'Write your message',
        body: 'Your headline, a line or two of body, and the button. Keep it short and give people one clear reason to act. The preview shows it exactly as visitors will see it.',
        placement: 'right'
      },
      {
        tab: 'design',
        target: '#sb-layout',
        title: 'Choose the style',
        body: 'A centred modal commands attention, a slide-in is gentler, and a bar sits quietly at the edge. Pick the level of interruption that feels right for your site.',
        placement: 'right'
      },
      {
        tab: 'design',
        target: '#sb-trigger',
        title: 'Decide when it appears',
        body: 'This is the clever bit. Show it after a few seconds, once someone scrolls down, or right as they move to leave the page. Exit intent is brilliant for catching people before they go.',
        placement: 'right'
      },
      {
        tab: 'design',
        target: '#pop-style-group',
        beforeShow: function () { openSecByTitle('Colours'); openSecByTitle('Shape'); openSecByTitle('Typography'); },
        title: 'Style it to match your site',
        body: 'Everything that controls the look sits here. Colours set the popup to your brand, Shape adjusts how rounded the corners are, and Typography picks the font. Get these right and it reads as part of your site, not an ad that landed on top of it.',
        placement: 'right',
        spotlightPadding: 6
      },
      {
        tab: 'settings',
        target: '#sb-frequency',
        title: 'How often to show it',
        body: 'Nobody likes the same popup on every visit. Show it once per session, or once every few days, so it stays a nudge and never a nuisance.',
        placement: 'right',
        beforeShow: function () { openSecByTitle('Frequency'); }
      },
      {
        tab: 'settings',
        target: function () { var b = document.querySelector('#sb-pages'); return b && b.closest ? b.closest('.sec') : b; },
        title: 'Choose where it appears',
        body: 'Page targeting lets you limit the popup to certain pages instead of the whole site. Show it everywhere, or only on specific paths — for example just your holidays pages, or one landing page running a campaign. Leave it open to show site-wide.',
        placement: 'right',
        beforeShow: function () { openSecByTitle('Page targeting'); }
      },
      {
        tab: 'settings',
        target: function () { var b = document.querySelector('#sb-devices'); return b && b.closest ? b.closest('.sec') : b; },
        title: 'Desktop, mobile or both',
        body: 'Devices controls who sees it by screen size. Keep it on for everyone, or show it only on desktop or only on mobile — handy when an offer or layout suits one better than the other.',
        placement: 'right',
        beforeShow: function () { openSecByTitle('Devices'); }
      },
      {
        target: '.tgse-preview',
        title: 'See it come together',
        body: 'The preview shows your popup just as it will appear. Tweak anything and it updates live.',
        placement: 'left',
        spotlightPadding: 6
      },
      {
        target: '#btn-save',
        title: 'Save your popup',
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
    titleHtml: 'Let\u2019s set up your <em>popup</em>.',
    body: 'A quick walk through the setup, one step at a time. About a minute, and you will have a popup that catches the right people at the right moment. Ready?'
  };
  var DONE = {
    titleHtml: 'All set. <em>Your popup is ready.</em>',
    body: 'The right message, shown at the right moment, as often as makes sense. Save it, then click Get embed code and paste that one line on your site. You can reopen this walkthrough any time from the button in the corner.'
  };

  var _api = null;
  function launch() {
    if (!window.tgse || typeof window.tgse.tour !== 'function') {
      console.warn('[popup-tour] tgse.tour not available — load editor-tour.js');
      return;
    }
    if (_api && typeof _api.finish === 'function') { try { _api.finish(false); } catch (e) {} }
    _api = window.tgse.tour({ id: 'popup', welcome: WELCOME, done: DONE, steps: buildSteps() });
    _api.start();
    return _api;
  }

  var _booted = false;
  window.initPopupTour = function () {
    if (_booted) return;
    _booted = true;
    if (!window.tgse || typeof window.tgse.tourLauncher !== 'function') {
      console.warn('[popup-tour] tgse.tourLauncher not available');
      return;
    }
    window.tgse.tourLauncher({ id: 'popup', label: 'Show me how', onClick: launch });
    if (!window.tgse.isTourDismissed || !window.tgse.isTourDismissed('popup')) {
      setTimeout(launch, 650);
    }
  };

})();
