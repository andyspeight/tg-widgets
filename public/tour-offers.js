/* ============================================================================
   Travel Offers — guided setup tour  v1.0.0  (ADAPTIVE)
   ----------------------------------------------------------------------------
   Walkthrough for the Travel Offers editor. This editor is unlike the others:
   the client picks one of SIX display styles (templates) and each style reveals
   a different set of controls (via data-when-template). A fixed tour would point
   at controls that are not on screen for the chosen style.

   So this tour is ADAPTIVE. It has a fixed spine of controls that EVERY style
   shows, plus ONE style-aware step that detects the active template and anchors
   on whichever style-specific "layout" section is currently visible.

   Spine (shared, every style): Layout template picker -> Where (destinations)
   -> [the active style's own layout section] -> Colours -> preview -> save ->
   embed. The template picker is step one (preview-first: choosing the style is
   what shapes the whole preview).

   Requires editor-tour.js.

   Editor family: classic <script> (not a module). Panels are tab regions
   toggled by the editor's own setTab via onTabChange. Sections are
   .section[data-open] with a .section-head button whose TEXT is the title; the
   open state is a data-open attribute set by the editor JS. The engine only
   auto-opens .tgse-section, so any collapsed .section a step targets is opened
   in that step's beforeShow by setting data-open + the open class directly on
   the .section wrapper (never click the head). Sections have no stable ids, so
   they are found by their head title text.

   Default tab is Content (all the controls this tour touches live on Content).
   boot() is the funnel, gated on isLoggedIn via onReady, plus onLoginSuccess.

   PREVIEW NOTE: Offers are pulled from a live feed inside TGOffersWidget; there
   is no built-in sample set, so before any destinations/feed are configured the
   preview shows its empty state. That is expected and the copy accounts for it.
   ============================================================================ */
(function () {
  'use strict';

  // --- section helpers --------------------------------------------------------
  // Shared sections are matched by EXACT head text (ignoring the chevron svg).
  // Exact match avoids the "Layout" vs "Layout template" clash. Style-specific
  // sections are matched by data-when-template, which is exact and immune to
  // title collisions.
  function headText(headEl) {
    return (headEl.textContent || '').replace(/\s+/g, ' ').trim();
  }
  function sectionByTitle(t) {
    var heads = Array.prototype.slice.call(document.querySelectorAll('.section .section-head'));
    var want = t.replace(/\s+/g, ' ').trim().toLowerCase();
    var h = heads.find(function (el) { return headText(el).toLowerCase() === want; });
    return h ? h.closest('.section') : null;
  }
  function sectionElByTitle(t) {
    return function () { return sectionByTitle(t); };
  }
  function openSectionByTitle(t) {
    var s = sectionByTitle(t);
    if (s) { s.setAttribute('data-open', 'true'); s.classList.add('open'); }
  }
  // Find the style-specific section for a template by data-when-template and
  // head title (departure-board has two such sections; we pick by title).
  function styleSection(tpl, title) {
    var secs = Array.prototype.slice.call(
      document.querySelectorAll('.section[data-when-template~="' + tpl + '"]'));
    if (!secs.length) return null;
    var want = title.replace(/\s+/g, ' ').trim().toLowerCase();
    var match = secs.find(function (s) {
      var h = s.querySelector('.section-head');
      return h && headText(h).toLowerCase() === want;
    });
    return match || secs[0];
  }
  function styleSectionEl(tpl, title) { return function () { return styleSection(tpl, title); }; }
  function openStyleSection(tpl, title) {
    var s = styleSection(tpl, title);
    if (s) { s.removeAttribute('hidden'); s.setAttribute('data-open', 'true'); s.classList.add('open'); }
  }

  // --- active template detection + its style-specific layout section title ----
  var STYLE_SECTION = {
    'cards': 'Layout',
    'magazine': 'Magazine layout',
    'departure-board': 'Departure board theme & behaviour',
    'boarding-pass': 'Boarding pass layout',
    'ticker': 'Ticker layout',
    'popup': 'Popup layout'
  };
  var STYLE_LABEL = {
    'cards': 'cards',
    'magazine': 'magazine',
    'departure-board': 'departure board',
    'boarding-pass': 'boarding pass',
    'ticker': 'ticker',
    'popup': 'popup'
  };
  function activeTemplate() {
    var pressed = document.querySelector('.template-card[aria-pressed="true"]');
    var t = pressed && pressed.getAttribute('data-template');
    return t && STYLE_SECTION[t] ? t : 'cards';
  }

  function buildSteps() {
    var tpl = activeTemplate();
    var styleTitle = STYLE_SECTION[tpl];
    var styleLabel = STYLE_LABEL[tpl];

    return [
      {
        tab: 'content',
        target: '#templateGrid',
        title: 'Pick how your offers look',
        body: 'Start here. Cards, a magazine spread, an airport departure board, boarding-pass flights, a scrolling ticker, or a popup. Choosing a style shapes the whole preview, and the rest of the settings adjust to match.',
        placement: 'right'
      },
      {
        tab: 'content',
        target: '#destInput',
        title: 'Tell us where',
        body: 'Add the destinations these offers should cover, country codes like ES or IT, airport codes, or city and resort names. Type one and press Enter. This is what fills your offers with real deals.',
        placement: 'right',
        beforeShow: function () { openSectionByTitle('Where'); }
      },
      {
        tab: 'content',
        target: '#cfgBoard',
        title: 'Then filter and sort',
        body: 'Narrow by board basis, star rating, price or trip length, set how far ahead to look, and choose the order. Show your customers exactly the kind of deals you want front and centre.',
        placement: 'right',
        beforeShow: function () { openSectionByTitle('Filters'); }
      },
      {
        tab: 'design',
        target: styleSectionEl(tpl, styleTitle),
        title: 'Fine-tune your ' + styleLabel,
        body: 'These settings belong to the ' + styleLabel + ' style you picked. Tweak how it lays out and behaves here. Switch style at the top and this section changes to match.',
        placement: 'right',
        beforeShow: function () { openStyleSection(tpl, styleTitle); }
      },
      {
        tab: 'design',
        target: '#brandColor',
        title: 'Match your brand',
        body: 'Set your brand and accent colours so the offers feel like part of your site. The accent is used for prices, codes and call-to-action buttons.',
        placement: 'right',
        beforeShow: function () { openSectionByTitle('Colours'); }
      },
      {
        target: '.tgse-preview',
        title: 'See it come together',
        body: 'The preview shows your offers in the style you chose. Until your destinations pull through live deals it may sit empty, that is normal, and you control exactly what shows when none match.',
        placement: 'left',
        spotlightPadding: 6
      },
      {
        target: '#btn-save',
        title: 'Save your offers widget',
        body: 'When it looks right, hit Save. You can come back and change the style or the settings whenever you like.',
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
    titleHtml: 'Let\u2019s set up your <em>travel offers</em>.',
    body: 'A quick walk through the setup, one step at a time. About a minute, and you will have live deals on your site in the style that suits you. Ready?'
  };
  var DONE = {
    titleHtml: 'All set. <em>Your offers are ready.</em>',
    body: 'Live deals, in your style, kept fresh for you. Save it, then click Get embed code and paste that one line on your site. You can reopen this walkthrough any time from the button in the corner.'
  };

  var _api = null;
  function launch() {
    if (!window.tgse || typeof window.tgse.tour !== 'function') {
      console.warn('[offers-tour] tgse.tour not available — load editor-tour.js');
      return;
    }
    if (_api && typeof _api.finish === 'function') { try { _api.finish(false); } catch (e) {} }
    // Steps are built fresh at launch so the style-aware step reflects the
    // template that is active right now (it may have changed since page load).
    _api = window.tgse.tour({ id: 'offers', welcome: WELCOME, done: DONE, steps: buildSteps() });
    _api.start();
    return _api;
  }

  var _booted = false;
  window.initOffersTour = function () {
    if (_booted) return;
    _booted = true;
    if (!window.tgse || typeof window.tgse.tourLauncher !== 'function') {
      console.warn('[offers-tour] tgse.tourLauncher not available');
      return;
    }
    window.tgse.tourLauncher({ id: 'offers', label: 'Show me how', onClick: launch });
    if (!window.tgse.isTourDismissed || !window.tgse.isTourDismissed('offers')) {
      setTimeout(launch, 650);
    }
  };

})();
