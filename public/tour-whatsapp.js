/* ============================================================================
   WhatsApp Chat — guided setup tour  v1.0.0
   ----------------------------------------------------------------------------
   Walkthrough for the WhatsApp Chat editor. Preview-first: we lead with the
   agents (the number that makes the button actually work and shows in the
   preview), then the call to action, layout, brand, greeting and office hours.

   Requires editor-tour.js.

   This editor (World Map / Airport family): static .tgse-panel[data-tab] with
   .tgse-section / .tgse-section.is-open; the engine auto-opens any closed
   .tgse-section a target sits inside, so no beforeShow reveals are needed.

   GOTCHA handled: #greetingFields and #hoursFields are display:none until their
   toggles are switched on (greetingEnabled/hoursEnabled default false), so the
   inner inputs would measure 0x0 and corner-clamp the callout. Those two steps
   anchor on the always-visible toggles (#toggleGreeting, #toggleHours) instead.

   Stable ids: #agentsList, #ctaLabelInput (Content); #layoutGrid, #colBrand
   (Design); #toggleGreeting, #toggleHours (Settings). Default tab is Design.
   boot() gates on login, so the tour starts from the logged-in path and from
   onLoginSuccess.
   ============================================================================ */
(function () {
  'use strict';

  function buildSteps() {
    return [
      {
        tab: 'content',
        target: '#agentsList',
        title: 'Add your WhatsApp number',
        body: 'Pop in the number chats should go to, in full international format. Got a team? Switch to multiple agents and each one gets their own name, role and number, and the visitor picks who to message.',
        placement: 'right'
      },
      {
        tab: 'content',
        target: '#ctaLabelInput',
        title: 'Your call to action',
        body: 'This is the wording on the button, something like Chat with us or Message our team. Warm and direct works best.',
        placement: 'right'
      },
      {
        tab: 'design',
        target: '#layoutGrid',
        title: 'Choose the layout',
        body: 'A floating bubble follows the page, a card sits in your content, an inline pill tucks into a row, and vertical clings to the side. Pick what suits the spot you have in mind.',
        placement: 'right'
      },
      {
        tab: 'design',
        target: '#colBrand',
        title: 'Your colours',
        body: 'Keep the familiar WhatsApp green, which people recognise instantly, or set your own brand colour here if you would rather it blended in.',
        placement: 'right'
      },
      {
        tab: 'settings',
        target: '#toggleGreeting',
        title: 'A friendly greeting',
        body: 'Switch this on and a little speech bubble pops up after a moment with a line like Need a hand planning your trip? It is a gentle nudge that gets more people clicking.',
        placement: 'right'
      },
      {
        tab: 'settings',
        target: '#toggleHours',
        title: 'Set your office hours',
        body: 'Turn this on to only invite chats when someone is actually there to reply. Outside hours it shows a leave-a-message note instead, so nobody is left waiting.',
        placement: 'right'
      },
      {
        target: '.tgse-preview',
        title: 'See it come together',
        body: 'The preview updates as you go, so you always know exactly how your chat button will look on your site.',
        placement: 'left',
        spotlightPadding: 6
      },
      {
        target: '#btn-save',
        title: 'Save your chat button',
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
    titleHtml: 'Let\u2019s set up your <em>WhatsApp chat</em>.',
    body: 'A quick walk through the setup, one step at a time. About a minute, and your customers will be one tap from a conversation. Ready?'
  };
  var DONE = {
    titleHtml: 'All set. <em>Your chat button is ready.</em>',
    body: 'A real conversation is worth a dozen contact forms. Save it, then click Get embed code and paste that one line on your site. You can reopen this walkthrough any time from the button in the corner.'
  };

  var _api = null;
  function launch() {
    if (!window.tgse || typeof window.tgse.tour !== 'function') {
      console.warn('[whatsapp-tour] tgse.tour not available — load editor-tour.js');
      return;
    }
    if (_api && typeof _api.finish === 'function') { try { _api.finish(false); } catch (e) {} }
    _api = window.tgse.tour({ id: 'whatsapp', welcome: WELCOME, done: DONE, steps: buildSteps() });
    _api.start();
    return _api;
  }

  var _booted = false;
  window.initWhatsappTour = function () {
    if (_booted) return;
    _booted = true;
    if (!window.tgse || typeof window.tgse.tourLauncher !== 'function') {
      console.warn('[whatsapp-tour] tgse.tourLauncher not available');
      return;
    }
    window.tgse.tourLauncher({ id: 'whatsapp', label: 'Show me how', onClick: launch });
    if (!window.tgse.isTourDismissed || !window.tgse.isTourDismissed('whatsapp')) {
      setTimeout(launch, 650);
    }
  };

})();
