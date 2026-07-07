/* ============================================================================
   Smart Section — guided setup tour  v1.0.0
   ----------------------------------------------------------------------------
   Walkthrough for the Smart Section editor. Leads with the rule builder (the
   heart of the widget), then the "Preview as" simulator (so you can see a rule
   working without being that visitor yourself), then dismissal and frequency,
   then the live preview badge, save and embed.

   Requires editor-tour.js.

   This editor uses shell tabs named design / content / settings, surfaced as
   "Rules" / "Behaviour" / "Settings". Stable ids: #matchSeg, #btnAddRule,
   #simPanel (Rules tab); #tglDismiss, #inMaxShows (Behaviour tab);
   .tgse-preview; #btn-save, #btn-embed. Default tab is Rules (design).
   ============================================================================ */
(function () {
  'use strict';

  function buildSteps() {
    return [
      {
        target: '#btn-templates',
        title: 'Start from a template',
        body: 'In a hurry? Click Templates for ready-made recipes: an exit-intent offer, an office-hours message, a mobile-only promo and more. Or build your own below.',
        placement: 'right'
      },
      {
        tab: 'design',
        target: '#matchSeg',
        title: 'Decide who sees it',
        body: 'This is where you choose your audience. Show the section when all of your rules match, or when any single one does. With no rules, everyone sees it.',
        placement: 'right'
      },
      {
        tab: 'design',
        target: '#btnAddRule',
        title: 'Add a rule',
        body: 'Add one or more rules: new or returning visitors, time of day, day of week, device, the campaign that brought them, or exit intent. Mix and match to name your audience.',
        placement: 'right'
      },
      {
        tab: 'design',
        target: '#simPanel',
        title: 'Preview as any visitor',
        body: 'You cannot be a returning mobile visitor at 9pm on a Sunday all at once, so pretend. Set a visitor here and the preview badge shows exactly what they would get. This only affects the preview, never your saved rules.',
        placement: 'right'
      },
      {
        tab: 'content',
        target: '#tglDismiss',
        title: 'Let visitors close it',
        body: 'Turn this on to add a small dismiss button. Once someone closes the section it stays gone on their device for as long as you choose.',
        placement: 'right'
      },
      {
        tab: 'content',
        target: '#inMaxShows',
        title: 'Cap how often it shows',
        body: 'Limit how many times one visitor sees the section. It is counted anonymously on their own device, so there is no personal data to worry about.',
        placement: 'right'
      },
      {
        target: '.tgse-preview',
        title: 'Watch the badge',
        body: 'The badge on the preview tells you whether the current visitor would see this section, and which rule hid it if not. Change the visitor on the left and watch it flip.',
        placement: 'left',
        spotlightPadding: 6
      },
      {
        target: '#btn-save',
        title: 'Save it',
        body: 'Give it a name and save. Your Smart Section is stored and ready to wrap around your content.',
        placement: 'bottom'
      },
      {
        target: '#btn-embed',
        title: 'Wrap your content',
        body: 'Click Get embed code, then put the content you want to control inside the code you paste: an offer, a banner, a whole section, even other widgets. Everything inside follows your rules.',
        placement: 'bottom'
      }
    ];
  }

  var WELCOME = {
    titleHtml: 'Let’s set up your <em>Smart Section</em>.',
    body: 'A quick walk through the setup, one step at a time. In under a minute you will be showing the right content to the right visitors, no developer needed. Ready?'
  };
  var DONE = {
    titleHtml: 'All set. <em>Show the right thing to the right people.</em>',
    body: 'Smart Section wraps any part of your site and shows it only to the visitors you choose. Save it, click Get embed code, and paste your content inside. You can reopen this walkthrough any time from the button in the corner.'
  };

  var _api = null;
  function launch() {
    if (!window.tgse || typeof window.tgse.tour !== 'function') {
      console.warn('[smartsection-tour] tgse.tour not available — load editor-tour.js');
      return;
    }
    if (_api && typeof _api.finish === 'function') { try { _api.finish(false); } catch (e) {} }
    _api = window.tgse.tour({ id: 'smartsection', welcome: WELCOME, done: DONE, steps: buildSteps() });
    _api.start();
    return _api;
  }

  var _booted = false;
  window.initSmartSectionTour = function () {
    if (_booted) return;
    _booted = true;
    if (!window.tgse || typeof window.tgse.tourLauncher !== 'function') {
      console.warn('[smartsection-tour] tgse.tourLauncher not available');
      return;
    }
    window.tgse.tourLauncher({ id: 'smartsection', label: 'Show me how', onClick: launch });
    if (!window.tgse.isTourDismissed || !window.tgse.isTourDismissed('smartsection')) {
      setTimeout(launch, 650);
    }
  };

})();
