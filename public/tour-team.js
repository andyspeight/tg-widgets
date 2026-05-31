/* ============================================================================
   Team Showcase — guided setup tour  v1.0.0
   ----------------------------------------------------------------------------
   Walkthrough for the Team Showcase editor. Preview-first: we lead with the
   team members (the people who fill the preview), then the heading above them,
   the layout, the brand colours and the grid. The editor ships seeded with
   three sample members, so the preview is populated from the first frame.

   Requires editor-tour.js.

   This editor (World Map / Airport family): static .tgse-panel[data-tab] with
   .tgse-section / .tgse-section.is-open. The engine auto-opens any closed
   .tgse-section a target sits inside, so no beforeShow reveals are needed.

   Stable ids: #member-list, #add-member, #show-heading (Content); #layout-picker,
   #grid-cols-field, #brand-col (Design). Per-member editing is inline in the
   member list, so we anchor the content step on the list itself. Default tab is
   Design. loadFromUrl() is the funnel, gated on isLoggedIn via onReady, so the
   tour is started from the logged-in path and from onLoginSuccess.
   ============================================================================ */
(function () {
  'use strict';

  function buildSteps() {
    return [
      {
        tab: 'content',
        target: '#member-list',
        title: 'Add your team',
        body: 'Add everyone who should appear, with a photo, name, role and a short line about them. Use Add member for each one. The preview builds your team grid as you go.',
        placement: 'right'
      },
      {
        tab: 'content',
        target: '#show-heading',
        title: 'A heading for the section',
        body: 'Keep a heading above your team, something like Meet the team or Your travel experts, with an optional intro line. Or switch it off for just the cards.',
        placement: 'right'
      },
      {
        tab: 'design',
        target: '#layout-picker',
        title: 'Choose the layout',
        body: 'A grid is the classic team wall, a carousel slides through them, spotlight gives each person room to shine, and compact keeps it tight. Pick what suits your page.',
        placement: 'right'
      },
      {
        tab: 'design',
        target: '#brand-col',
        title: 'Match your brand',
        body: 'Set your brand and accent colours so the cards feel like part of your site. The card shape and radius are yours to tweak too.',
        placement: 'right'
      },
      {
        tab: 'design',
        target: '#grid-cols-field',
        title: 'How many across',
        body: 'Choose how many cards sit side by side. Three or four works for most teams, and it stacks down neatly on phones either way.',
        placement: 'right'
      },
      {
        target: '.tgse-preview',
        title: 'See it come together',
        body: 'The preview updates as you go, so you always know exactly how your team will look on your site.',
        placement: 'left',
        spotlightPadding: 6
      },
      {
        target: '#btn-save',
        title: 'Save your team',
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
    titleHtml: 'Let\u2019s set up your <em>team showcase</em>.',
    body: 'A quick walk through the setup, one step at a time. About a minute, and your customers will see the friendly faces behind your business. Ready?'
  };
  var DONE = {
    titleHtml: 'All set. <em>Your team is ready.</em>',
    body: 'People book with people. Putting real faces to your business builds trust before a word is spoken. Save it, then click Get embed code and paste that one line on your site. You can reopen this walkthrough any time from the button in the corner.'
  };

  var _api = null;
  function launch() {
    if (!window.tgse || typeof window.tgse.tour !== 'function') {
      console.warn('[team-tour] tgse.tour not available — load editor-tour.js');
      return;
    }
    if (_api && typeof _api.finish === 'function') { try { _api.finish(false); } catch (e) {} }
    _api = window.tgse.tour({ id: 'team', welcome: WELCOME, done: DONE, steps: buildSteps() });
    _api.start();
    return _api;
  }

  var _booted = false;
  window.initTeamTour = function () {
    if (_booted) return;
    _booted = true;
    if (!window.tgse || typeof window.tgse.tourLauncher !== 'function') {
      console.warn('[team-tour] tgse.tourLauncher not available');
      return;
    }
    window.tgse.tourLauncher({ id: 'team', label: 'Show me how', onClick: launch });
    if (!window.tgse.isTourDismissed || !window.tgse.isTourDismissed('team')) {
      setTimeout(launch, 650);
    }
  };

})();
