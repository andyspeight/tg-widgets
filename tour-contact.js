/* ============================================================================
   Contact Card — guided setup tour  v1.0.0
   ----------------------------------------------------------------------------
   Step-by-step walkthrough for the Contact Card editor. Each step spotlights a
   REAL control and advances on Next. Preview-first: we lead with the contact
   details, the content that fills the card.

   Requires editor-tour.js (adds tgse.tour + tgse.tourLauncher).

   Real anchors (verified against editor-contact.html):
     #f-contactName   Contact name      (Content tab, "business" sec — OPEN)
     #f-phone         Phone field       (Content tab, "channels" sec — OPEN)
     #btn-add-social  Add social link   (Content tab, "socials" sec — CLOSED, revealed)
     #sb-layout       Layout pickers    (Design tab, "layout" sec — OPEN; panel/card/strip)
     #colour-brand    Brand colour      (Design tab, "colours" sec — CLOSED, revealed)
     #sw-vcard        Save to phone tog (Settings tab, "display" sec — OPEN; vCard download)
     .tgse-preview    Live preview      (main area)
     #btn-save        Save button       (header)
     #btn-embed       Get embed code    (preview toolbar)

   Notes on this editor:
     - Static .tab-panel[data-panel] panels; the editor's own onTabChange mirrors
       the shell tab state onto .tab-panel.is-active, so a tab step's target is
       visible right after the tab click.
     - Sections are .sec / .sec.is-open with a .sec-head[data-sec] button. The
       engine only auto-opens .tgse-section, so the two sections this tour needs
       that ship CLOSED (colours, socials) are opened in beforeShow by adding
       is-open to the .sec directly (never by clicking the head).
   ============================================================================ */
(function () {
  'use strict';

  // Open a collapsed .sec by its data-sec key, directly (not by clicking the head).
  function openSec(key) {
    var head = document.querySelector('.sec-head[data-sec="' + key + '"]');
    if (head && head.closest) {
      var sec = head.closest('.sec');
      if (sec) sec.classList.add('is-open');
    }
  }

  function buildSteps() {
    return [
      {
        tab: 'content',
        target: '#f-contactName',
        title: 'Who people are reaching',
        body: 'Add your business name, a short intro and a contact person here. This is what shows on the card, a real person to talk to, not a faceless form.',
        placement: 'right'
      },
      {
        tab: 'content',
        target: '#f-phone',
        title: 'How to reach you',
        body: 'Phone, email, website and address. Fill in the ones you want shown, leave the rest blank and they simply drop off the card.',
        placement: 'right'
      },
      {
        tab: 'content',
        target: '#btn-add-social',
        title: 'Add your socials',
        body: 'Link your Facebook, Instagram, LinkedIn and the rest. They show as neat little icons people can tap.',
        placement: 'right',
        beforeShow: function () { openSec('socials'); }
      },
      {
        tab: 'design',
        target: '#sb-layout',
        title: 'Pick a layout',
        body: 'Panel is the full card, Card is a tidier version, and Strip is a slim bar that tucks into a page. Try each and watch the preview.',
        placement: 'right'
      },
      {
        tab: 'design',
        target: '#colour-brand',
        title: 'Match your brand',
        body: 'Set your brand and accent colours so the card looks like part of your site, not a bolt-on.',
        placement: 'right',
        beforeShow: function () { openSec('colours'); }
      },
      {
        tab: 'settings',
        target: '#sw-vcard',
        title: 'Save to phone',
        body: 'Leave this on and visitors get a Save to phone button that drops your details straight into their contacts as a vCard. One tap and you are in their phone, no typing.',
        placement: 'right'
      },
      {
        target: '.tgse-preview',
        title: 'See it come together',
        body: 'The preview updates as you go, so you always know exactly how your card will look on your site.',
        placement: 'left',
        spotlightPadding: 6
      },
      {
        target: '#btn-save',
        title: 'Save your card',
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
    titleHtml: 'Let\u2019s set up your <em>contact card</em>.',
    body: 'A quick walk through the setup, one step at a time. About a minute, and you will have a tidy contact card ready to drop on your site. Ready?'
  };
  var DONE = {
    titleHtml: 'All set. <em>Your contact card is ready.</em>',
    body: 'A real person, your details, your socials and a one-tap save to phone, all styled to your brand. Save it, then click Get embed code and paste that one line on your site. You can reopen this walkthrough any time from the button in the corner.'
  };

  var _api = null;
  function launch() {
    if (!window.tgse || typeof window.tgse.tour !== 'function') {
      console.warn('[contact-tour] tgse.tour not available — load editor-tour.js');
      return;
    }
    if (_api && typeof _api.finish === 'function') { try { _api.finish(false); } catch (e) {} }
    _api = window.tgse.tour({
      id: 'contact',
      welcome: WELCOME,
      done: DONE,
      steps: buildSteps()
    });
    _api.start();
    return _api;
  }

  var _booted = false;
  window.initContactTour = function () {
    if (_booted) return;
    _booted = true;
    if (!window.tgse || typeof window.tgse.tourLauncher !== 'function') {
      console.warn('[contact-tour] tgse.tourLauncher not available');
      return;
    }
    window.tgse.tourLauncher({ id: 'contact', label: 'Show me how', onClick: launch });
    if (!window.tgse.isTourDismissed || !window.tgse.isTourDismissed('contact')) {
      setTimeout(launch, 650);
    }
  };

})();
