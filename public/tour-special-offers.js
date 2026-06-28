/* ============================================================================
   Special Offers — guided setup tour  v1.0.0
   ----------------------------------------------------------------------------
   Step-by-step walkthrough for the Special Offers editor (the offer BUILDER
   workspace — distinct from the Travel Offers editor and its tour-offers.js).

   Each step spotlights a REAL control and tells the user what to do. The tour
   switches sidebar tabs as needed and advances on Next.

   This editor is a "My offers" workspace (a list plus a create/edit form), not
   the standard sidebar-only editor, so the tour leads with the create action and
   never opens the form (which would unmount the list it points at).

   Requires editor-tour.js (adds tgse.tour + tgse.tourLauncher).

   Real anchors (verified against editor-offer-builder.html):
     #btn-new            New offer button         (workspace top)
     #btn-import         Import (spreadsheet)     (workspace top)
     #offersList         The offers list / empty state (workspace body)
     #layoutGrid         Card style chooser       (Design tab)
     #cfgTemplate        Offer page template      (Design tab)
     #cfgAccent          Brand / accent colour    (Design tab)
     #cfgEnquiryEmail    Enquiry routing          (Settings tab)
     #cfgOfferBase       Offer page web address   (Settings tab — white-label)
     #btn-save           Save                     (header)
     #btn-embed          Get embed code           (preview toolbar)

   The Design and Settings sections all default open, so no beforeShow reveals
   are needed. Tab steps use the shell's [role="tab"][data-tab] buttons, which
   the engine clicks for us.
   ============================================================================ */
(function () {
  'use strict';

  function buildSteps() {
    return [
      {
        target: '#btn-new',
        title: 'Create an offer',
        body: 'This is where it starts. Open the form, describe the deal in a sentence and let AI fill it in, add your photos, then save. Each offer gets its own shareable page. Leave it for now and hit Next.',
        placement: 'bottom'
      },
      {
        target: '#btn-import',
        title: 'Or import a spreadsheet',
        body: 'Got a lot of offers already? Download the template, fill it in and upload it to create them all at once.',
        placement: 'bottom'
      },
      {
        target: '#offersList',
        title: 'Your offers live here',
        body: 'Every offer you create shows in this list with a Live, Scheduled or Ended badge. Open, edit or remove any of them from here.',
        placement: 'top',
        spotlightPadding: 6
      },
      {
        tab: 'design',
        target: '#layoutGrid',
        title: 'Choose your card style',
        body: 'Pick how your offers look as cards — vertical for a grid, or horizontal, banner and split for a feature row. The preview updates as you choose.',
        placement: 'right'
      },
      {
        tab: 'design',
        target: '#cfgTemplate',
        title: 'Pick the offer page template',
        body: 'Each offer opens a full landing page. Classic, Editorial and Immersive give you three different looks for that page.',
        placement: 'right'
      },
      {
        tab: 'design',
        target: '#cfgAccent',
        title: 'Match your brand',
        body: 'Set your accent and brand colours so the cards and offer pages sit comfortably with the rest of your site.',
        placement: 'right'
      },
      {
        tab: 'settings',
        target: '#cfgEnquiryEmail',
        title: 'Where enquiries go',
        body: 'Every offer page has a built-in enquiry form. Set the email and phone here and they become the default for new offers. You can still change them per offer.',
        placement: 'right'
      },
      {
        tab: 'settings',
        target: '#cfgOfferBase',
        title: 'Use your own web address',
        body: 'Optional. Share offers on your own domain instead of ours. Point it at us first (your account manager sets this up) and your links and embed code switch to it automatically.',
        placement: 'right'
      },
      {
        target: '#btn-save',
        title: 'Save your setup',
        body: 'When the design and settings look right, hit Save. Your individual offers save themselves as you create them.',
        placement: 'bottom'
      },
      {
        target: '#btn-embed',
        title: 'Last thing: your grid embed',
        body: 'This gives you a single line of code that shows all your live offers on your site and keeps itself up to date. We will not open it just yet. Hit Finish, then click here whenever you are ready.',
        placement: 'left'
      }
    ];
  }

  var WELCOME = {
    titleHtml: 'Let’s set up your <em>Special Offers</em>.',
    body: 'A quick walk through the workspace, one step at a time. About a minute, and you will know exactly how to build an offer and put it on your site. Ready?'
  };
  var DONE = {
    titleHtml: 'All set. <em>Time to build an offer.</em>',
    body: 'Click New offer, describe the deal and let AI draft it, then save. Drop the grid embed on your site once and it keeps itself up to date as you add, schedule and retire offers. You can reopen this walkthrough any time from the button in the corner.'
  };

  var _api = null;
  function launch() {
    if (!window.tgse || typeof window.tgse.tour !== 'function') {
      console.warn('[special-offers-tour] tgse.tour not available — load editor-tour.js');
      return;
    }
    if (_api && typeof _api.finish === 'function') { try { _api.finish(false); } catch (e) {} }
    _api = window.tgse.tour({
      id: 'special-offers',
      welcome: WELCOME,
      done: DONE,
      steps: buildSteps()
    });
    _api.start();
    return _api;
  }

  // Public entry. Mounts the persistent launcher, and auto-starts on first login
  // unless the user ticked "don't show this again".
  var _booted = false;
  window.initSpecialOffersTour = function () {
    if (_booted) return;
    _booted = true;
    if (!window.tgse || typeof window.tgse.tourLauncher !== 'function') {
      console.warn('[special-offers-tour] tgse.tourLauncher not available');
      return;
    }
    window.tgse.tourLauncher({ id: 'special-offers', label: 'Show me how', onClick: launch });
    if (!window.tgse.isTourDismissed || !window.tgse.isTourDismissed('special-offers')) {
      setTimeout(launch, 650);
    }
  };

})();
