/* ============================================================================
   Newsletter Signup — guided setup tour  v1.0.0
   ----------------------------------------------------------------------------
   Step-by-step walkthrough for the Newsletter Signup editor. This widget has a
   fourth tab (Routing) for sending signups onward, so the tour covers the lead
   destination too. Each step spotlights a REAL control and advances on Next.

   ORDER: headline/form FIRST. The form is what the preview displays, so we lead
   with the content, then layout, brand, consent and routing each have a live
   form to work against.

   Requires editor-tour.js (adds tgse.tour + tgse.tourLauncher).

   Real anchors (verified against editor-newsletter.html):
     #email-placeholder    Email field text     (Content tab, "Form" — always visible)
     #layout-picker        Layout chooser       (Design tab — card/inline/popup/footer/vertical)
     #brand-swatch         Brand colour         (Design tab)
     #sw-consent           Consent checkbox tog (Settings tab — GDPR)
     #btn-add-destination  Add lead destination (Routing tab — Mailchimp/Brevo/Sheets/webhook)
     .tgse-preview         Live preview         (main area)
     #btn-save             Save button          (header)
     #btn-embed            Get embed code       (preview toolbar)

   Notes on this editor:
     - Static .tgse-panel[data-tab] panels (design / settings / routing) plus a
       JS-rendered content tab (renderContentTab into the content panel). Shell
       drives tab visibility via .tgse-panel.is-active, so a tab step's target
       is present right after the tab click. There are FOUR tabs here, not the
       usual three; clickTab handles data-tab="routing" the same way.
     - GOTCHA: several content/settings controls live inside .when-layout
       wrappers (data-show-on="card,popup,...") that are display:none unless the
       chosen layout matches. The headline #title-input is one of these, so it
       can measure 0x0 and corner-clamp the callout. We lead on #email-placeholder
       instead, which sits outside any when-layout and is always present, and
       fold the headline into its copy. Every other control this tour targets is
       always visible too, so no beforeShow reveals are needed.
   ============================================================================ */
(function () {
  'use strict';

  function buildSteps() {
    return [
      {
        tab: 'content',
        target: '#email-placeholder',
        title: 'Your signup form',
        body: 'This is what visitors fill in, just an email by default, with a clear button. Set the placeholder and button text here, and write the thank-you message they see after they sign up.',
        placement: 'right'
      },
      {
        tab: 'design',
        target: '#layout-picker',
        title: 'Choose the layout',
        body: 'Card sits in the page, Inline tucks into a row, Popup appears over the page, Footer bar pins to the bottom, and Vertical tab clings to the side. Pick what suits the spot you have in mind.',
        placement: 'right'
      },
      {
        tab: 'design',
        target: '#brand-swatch',
        title: 'Match your brand',
        body: 'Set your brand colour here, and switch between light and dark just above, so the signup sits comfortably with the rest of your site.',
        placement: 'right'
      },
      {
        tab: 'settings',
        target: '#sw-consent',
        title: 'Stay on the right side of GDPR',
        body: 'Add a consent checkbox and link your privacy policy so signups are above board. You can also choose to ask for a first name, and tag your subscribers so they land in the right list.',
        placement: 'right'
      },
      {
        tab: 'routing',
        target: '#btn-add-destination',
        title: 'Decide where signups go',
        body: 'Add a destination to push new subscribers straight into Mailchimp, Brevo, a Google Sheet or your own endpoint, so they land in your tools automatically. Save the widget first and it will all be linked up.',
        placement: 'right'
      },
      {
        target: '.tgse-preview',
        title: 'See it come together',
        body: 'The preview updates as you go, so you always know exactly how your signup form will look on your site.',
        placement: 'left',
        spotlightPadding: 6
      },
      {
        target: '#btn-save',
        title: 'Save your signup form',
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
    titleHtml: 'Let\u2019s set up your <em>signup form</em>.',
    body: 'A quick walk through the setup, one step at a time. About a minute, and you can have it collecting subscribers by the end. Ready?'
  };
  var DONE = {
    titleHtml: 'All set. <em>Your signup form is ready.</em>',
    body: 'Worded, styled, made compliant and wired up to your tools. Save it, then click Get embed code and paste that one line on your site. New subscribers will start flowing into your list. You can reopen this walkthrough any time from the button in the corner.'
  };

  var _api = null;
  function launch() {
    if (!window.tgse || typeof window.tgse.tour !== 'function') {
      console.warn('[newsletter-tour] tgse.tour not available — load editor-tour.js');
      return;
    }
    // tear down any previous run so reopening never stacks overlays
    if (_api && typeof _api.finish === 'function') { try { _api.finish(false); } catch (e) {} }
    _api = window.tgse.tour({
      id: 'newsletter',
      welcome: WELCOME,
      done: DONE,
      steps: buildSteps()   // fresh steps each open (clears any _revealed flags)
    });
    _api.start();
    return _api;
  }

  // Public entry. Mounts the persistent launcher, and auto-starts on login
  // unless the user ticked "don't show this again".
  var _booted = false;
  window.initNewsletterTour = function () {
    if (_booted) return;
    _booted = true;
    if (!window.tgse || typeof window.tgse.tourLauncher !== 'function') {
      console.warn('[newsletter-tour] tgse.tourLauncher not available');
      return;
    }
    window.tgse.tourLauncher({ id: 'newsletter', label: 'Show me how', onClick: launch });
    if (!window.tgse.isTourDismissed || !window.tgse.isTourDismissed('newsletter')) {
      setTimeout(launch, 650);
    }
  };

})();
