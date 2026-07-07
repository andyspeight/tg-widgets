/* ============================================================================
   Cookie Consent — guided setup tour  v1.0.0
   ----------------------------------------------------------------------------
   Walkthrough for the Cookie Consent editor. Leads with look (layout, brand),
   then the content that keeps it compliant (privacy link, cookie table), then
   the one setting that really matters (region behaviour), then preview / save /
   embed with the Duda placement note.

   Requires editor-tour.js.

   Stable ids used as targets:
     Design:   #pick-layout, #in-accent
     Content:  #in-privacy-url, #ck-list
     Settings: #in-geo, #in-policy-version
     Shell:    .tgse-preview, #btn-save
     Editor:   #btn-embed-consent
   Default tab is Design. initConsentTour() is called from the editor's
   onLoginSuccess and onReady boot path, so the tour starts from the logged-in
   funnel just like the other editors.
   ============================================================================ */
(function () {
  'use strict';

  function buildSteps() {
    return [
      {
        tab: 'design',
        target: '#pick-layout',
        title: 'Pick how it appears',
        body: 'A quiet bottom bar, a floating card in a corner, or a centred modal that asks front and centre. The card is the friendly default for a travel site.',
        placement: 'right'
      },
      {
        tab: 'design',
        target: '#in-accent',
        title: 'Make it yours',
        body: 'Set your brand accent for the buttons and toggles. The text colour flips itself for contrast, and Theme just below follows the visitor light or dark.',
        placement: 'right'
      },
      {
        tab: 'content',
        target: '#in-privacy-url',
        title: 'Link your privacy policy',
        body: 'Point this at your privacy or cookie policy page. The link shows in the banner and the preference centre, which visitors and regulators expect.',
        placement: 'right'
      },
      {
        tab: 'content',
        target: '#ck-list',
        title: 'List your cookies',
        body: 'Add the cookies your site sets, grouped by category. They appear in a tidy table in the preference centre so visitors can see exactly what each one does. The three common travel-site trackers are filled in to start you off.',
        placement: 'right'
      },
      {
        tab: 'settings',
        target: '#in-geo',
        title: 'This is the important one',
        body: 'Auto gives UK and EU visitors the full opt-in banner and everyone else a lighter notice, worked out at our edge with no IP stored. Leave it on Auto unless you have a reason not to.',
        placement: 'right'
      },
      {
        tab: 'settings',
        target: '#in-policy-version',
        title: 'Ask again when things change',
        body: 'Bump the policy version after a material change to your cookies and every visitor is asked afresh. The slider below sets how long a choice lasts before you re-ask.',
        placement: 'right'
      },
      {
        target: '.tgse-preview',
        title: 'See what visitors see',
        body: 'The banner runs live here on a mock travel page. Use Replay banner to watch it again as a first-time visitor, and the desktop, tablet and mobile buttons up top to check each size.',
        placement: 'left',
        spotlightPadding: 6
      },
      {
        target: '#btn-save',
        title: 'Save it',
        body: 'Give it a name and save. Your consent banner is stored and ready to embed.',
        placement: 'bottom'
      },
      {
        target: '#btn-embed-consent',
        title: 'Add it to your Duda site',
        body: 'Click Get embed code, then paste the single line into Site Settings, Site Header HTML, above any analytics tags so tracking waits for consent. Then turn off Duda’s own cookie notice so visitors see one banner, not two.',
        placement: 'bottom'
      }
    ];
  }

  var WELCOME = {
    titleHtml: 'Let’s set up your <em>cookie consent</em> banner.',
    body: 'A quick walk through the setup, one step at a time. Under a minute, and your site asks for consent properly, holds trackers back until visitors choose, and keeps your brand. Ready?'
  };
  var DONE = {
    titleHtml: 'All set. <em>Compliant and on brand.</em>',
    body: 'Save it, then click Get embed code and paste that one line into your Duda site header. Remember to switch off Duda’s built-in cookie notice so there is just the one banner. You can reopen this walkthrough any time from the button in the corner.'
  };

  var _api = null;
  function launch() {
    if (!window.tgse || typeof window.tgse.tour !== 'function') {
      console.warn('[consent-tour] tgse.tour not available — load editor-tour.js');
      return;
    }
    if (_api && typeof _api.finish === 'function') { try { _api.finish(false); } catch (e) {} }
    _api = window.tgse.tour({ id: 'consent', welcome: WELCOME, done: DONE, steps: buildSteps() });
    _api.start();
    return _api;
  }

  var _booted = false;
  window.initConsentTour = function () {
    if (_booted) return;
    _booted = true;
    if (!window.tgse || typeof window.tgse.tourLauncher !== 'function') {
      console.warn('[consent-tour] tgse.tourLauncher not available');
      return;
    }
    window.tgse.tourLauncher({ id: 'consent', label: 'Show me how', onClick: launch });
    if (!window.tgse.isTourDismissed || !window.tgse.isTourDismissed('consent')) {
      setTimeout(launch, 650);
    }
  };

})();
