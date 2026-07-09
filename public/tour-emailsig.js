/* ============================================================================
   Email Signature — guided setup tour  v1.0.0
   ----------------------------------------------------------------------------
   Walkthrough for the Email Signature editor. Leads with the template gallery,
   then your details and contact, social icons, a call to action, brand colours,
   an optional promo banner, and finishes on the preview where you copy the
   signature into your email client.

   Requires editor-tour.js.

   Tabs: design / content / settings. The engine switches tabs and auto-opens
   any closed .tgse-section a target sits inside, so no beforeShow reveals are
   needed. Stable ids: #templateGrid, #presetRow (Design); #fName, #cPhone,
   #socialAdd, #ctaLabel, #badgeToggle (Content); #bannerToggle (Settings);
   plus .tgse-preview, #btn-save, #btn-embed.
   ============================================================================ */
(function () {
  'use strict';

  function buildSteps() {
    return [
      {
        tab: 'design',
        target: '#templateGrid',
        title: 'Pick a template',
        body: 'Ten ready-made layouts. Tap one to switch instantly, or hit Browse the gallery to see them all with your own details. You can change it any time.',
        placement: 'right'
      },
      {
        tab: 'content',
        target: '#fName',
        title: 'Add your details',
        body: 'Your name, job title and company. Add a headshot or company logo too. You can paste a link or upload an image straight from your computer.',
        placement: 'right'
      },
      {
        tab: 'content',
        target: '#cPhone',
        title: 'Your contact details',
        body: 'Phone, mobile, email and website. These turn into tidy click-to-call and one-tap email links in the finished signature.',
        placement: 'right'
      },
      {
        tab: 'content',
        target: '#socialAdd',
        title: 'Add your social links',
        body: 'Facebook, Instagram, LinkedIn and more. They show as real brand icons that render in every email app.',
        placement: 'right'
      },
      {
        tab: 'content',
        target: '#ctaLabel',
        title: 'Add a call to action',
        body: 'A single button like Book your next trip, pointing wherever you like. It is the easiest way to turn every email into a nudge back to your site.',
        placement: 'right'
      },
      {
        tab: 'content',
        target: '#badgeToggle',
        title: 'Show your credentials',
        body: 'Switch this on to add your ABTA and ATOL numbers and a Trustpilot rating. A quiet line of trust on every email you send.',
        placement: 'right'
      },
      {
        tab: 'design',
        target: '#presetRow',
        title: 'Match your brand',
        body: 'Pick a colour preset or set your exact accent. It carries through the name, links and button so the signature looks like you.',
        placement: 'right'
      },
      {
        tab: 'settings',
        target: '#bannerToggle',
        title: 'Add a promo banner',
        body: 'An optional image under your signature, great for an offer. Keep it updatable and you can swap the picture later without re-pasting the signature.',
        placement: 'right'
      },
      {
        target: '.tgse-preview',
        title: 'Copy it into your email',
        body: 'The preview updates as you go. When it looks right, use Copy signature and paste it into Gmail, Outlook or Apple Mail. The step-by-step guide for each one is right there.',
        placement: 'left',
        spotlightPadding: 6
      },
      {
        target: '#btn-save',
        title: 'Save your signature',
        body: 'Save it so you can come back and change any of this whenever you like. Saving also switches on the updatable banner and open tracking.',
        placement: 'bottom'
      }
    ];
  }

  var WELCOME = {
    titleHtml: 'Let’s build your <em>email signature</em>.',
    body: 'A quick walk through the setup, one step at a time. About a minute, and you will have a branded signature ready to paste into any inbox. Ready?'
  };
  var DONE = {
    titleHtml: 'All set. <em>Your signature is ready.</em>',
    body: 'Use Copy signature and paste it into Gmail, Outlook or Apple Mail, following the short guide for whichever you use. You can reopen this walkthrough any time from the button in the corner.'
  };

  var _api = null;
  function launch() {
    if (!window.tgse || typeof window.tgse.tour !== 'function') {
      console.warn('[emailsig-tour] tgse.tour not available — load editor-tour.js');
      return;
    }
    if (_api && typeof _api.finish === 'function') { try { _api.finish(false); } catch (e) {} }
    _api = window.tgse.tour({ id: 'emailsig', welcome: WELCOME, done: DONE, steps: buildSteps() });
    _api.start();
    return _api;
  }

  var _booted = false;
  window.initEmailSigTour = function () {
    if (_booted) return;
    _booted = true;
    if (!window.tgse || typeof window.tgse.tourLauncher !== 'function') {
      console.warn('[emailsig-tour] tgse.tourLauncher not available');
      return;
    }
    window.tgse.tourLauncher({ id: 'emailsig', label: 'Show me how', onClick: launch });
    if (!window.tgse.isTourDismissed || !window.tgse.isTourDismissed('emailsig')) {
      setTimeout(launch, 650);
    }
  };

})();
