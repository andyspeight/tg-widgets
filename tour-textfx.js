/* ============================================================================
   Text FX — guided setup tour  v1.0.0
   ----------------------------------------------------------------------------
   Walkthrough for the Text FX editor (animated headline text: typewriter,
   rotating words, gradient, counter, marquee and more). Preview-first: we lead
   with the effect picker, since the chosen effect is what the preview animates,
   then the words themselves, then size, colour, and the finish.

   Requires editor-tour.js.

   This editor: panels are [data-tab-panel] (design / content / settings),
   toggled by the editor's own onTabChange. Sections are .section[data-open="1"]
   (default open). The Design tab holds the effect picker, typography and
   colours. The per-effect text controls live on the Content tab inside
   [data-mode-panel="..."] blocks, only the panel for the current effect is
   visible (the rest are hidden), so we anchor on the typewriter phrases which
   is the default effect. The engine only auto-opens .tgse-section, but every
   target here is in an already-open .section, so no reveals are needed.

   Stable ids: #mode-grid, #cfg-fontSize, #cfg-textColor (Design);
   #tw-phrases-add / #tw-phrases-list (Content, typewriter panel). Default tab
   is Design. boot() runs only when logged in (via onReady and onLoginSuccess).

   NOTE: this tour describes the default typewriter effect. If a client switches
   effect the Content controls change shape, which is expected. The effect-picker
   step sets that expectation up front.
   ============================================================================ */
(function () {
  'use strict';

  function buildSteps() {
    return [
      {
        tab: 'design',
        target: '#mode-grid',
        title: 'Pick your effect',
        body: 'Start here. A typewriter that types itself out, rotating words that swap on a loop, a counter that ticks up, a flowing gradient and more. The preview animates your choice straight away.',
        placement: 'right'
      },
      {
        tab: 'content',
        target: '#tw-phrases-add',
        title: 'Write your words',
        body: 'This is what animates. For the typewriter, add each phrase and it types out, holds, then deletes before the next. For other effects the words sit here too. Keep them short and punchy.',
        placement: 'right'
      },
      {
        tab: 'design',
        target: '#cfg-fontSize',
        title: 'Set the size',
        body: 'Drag to size the text to its spot, big and bold for a hero headline, smaller for a line within a paragraph.',
        placement: 'right'
      },
      {
        tab: 'design',
        target: '#cfg-textColor',
        title: 'Match your brand',
        body: 'Set the text colour and background here so the effect sits naturally in your page. Some effects add their own accent colour just below.',
        placement: 'right'
      },
      {
        tab: 'content',
        target: '#cfg-tw-typeSpeed',
        title: 'Tune the timing',
        body: 'Each effect has its own speed and loop controls, type speed, hold time, whether it repeats. Small tweaks make a big difference to how it feels.',
        placement: 'right'
      },
      {
        target: '.tgse-preview',
        title: 'See it in motion',
        body: 'The preview plays your effect live, so you always know exactly how it will look on your site.',
        placement: 'left',
        spotlightPadding: 6
      },
      {
        target: '#btn-save',
        title: 'Save your text effect',
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
    titleHtml: 'Let\u2019s set up your <em>animated text</em>.',
    body: 'A quick walk through the setup, one step at a time. About a minute, and you will have a headline that catches the eye and holds it. Ready?'
  };
  var DONE = {
    titleHtml: 'All set. <em>Your text effect is ready.</em>',
    body: 'A little motion in the right place draws the eye exactly where you want it. Save it, then click Get embed code and paste that one line on your site. You can reopen this walkthrough any time from the button in the corner.'
  };

  var _api = null;
  function launch() {
    if (!window.tgse || typeof window.tgse.tour !== 'function') {
      console.warn('[textfx-tour] tgse.tour not available — load editor-tour.js');
      return;
    }
    if (_api && typeof _api.finish === 'function') { try { _api.finish(false); } catch (e) {} }
    _api = window.tgse.tour({ id: 'textfx', welcome: WELCOME, done: DONE, steps: buildSteps() });
    _api.start();
    return _api;
  }

  var _booted = false;
  window.initTextfxTour = function () {
    if (_booted) return;
    _booted = true;
    if (!window.tgse || typeof window.tgse.tourLauncher !== 'function') {
      console.warn('[textfx-tour] tgse.tourLauncher not available');
      return;
    }
    window.tgse.tourLauncher({ id: 'textfx', label: 'Show me how', onClick: launch });
    if (!window.tgse.isTourDismissed || !window.tgse.isTourDismissed('textfx')) {
      setTimeout(launch, 650);
    }
  };

})();
