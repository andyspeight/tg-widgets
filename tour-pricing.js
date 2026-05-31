/* ============================================================================
   Pricing Table — guided setup tour  v1.0.0
   ----------------------------------------------------------------------------
   Step-by-step walkthrough for the Pricing Table editor. Each step spotlights a
   REAL control and tells the user what to do. The tour switches tabs as needed
   and advances on Next.

   Requires editor-tour.js (adds tgse.tour + tgse.tourLauncher).

   Real anchors (verified against editor.html — Pricing's editor file):
     input[data-bind="header.title"]   Title          (Design tab, "Header" section, open)
     input[data-bind="brandColor"]     Brand colour   (Design tab, "Colours" section, open)
     .plans-header                     Plans toolbar  (Content tab — Add plan / AI / upload)
     #p0                               First plan     (Content tab — click to edit a plan)
     #panel-settings .sec              Display block  (Settings tab, "Display" section, open)
     .tgse-preview                     Live preview   (main area)
     #btn-save                         Save button    (header)
     #btn-embed                        Get embed code (preview toolbar)

   Notes on this editor (a fifth structural variant):
     - Panels are static .tgse-panel[data-tab] containers (#panel-design /
       -content / -settings) that ship EMPTY and are JS-rendered together by
       ren() at boot (panel-design=dTab(), panel-content=cTab(),
       panel-settings=sTab()). Tab visibility is shell-driven (.tgse-panel
       .is-active), so every target exists after boot regardless of active tab.
     - Sections are .sec / .sec.open (head .sec-hd, body .sec-bd) — NOT
       .tgse-section, NOT .sec.is-open, NOT .section. The engine's reveal is a
       no-op here, but every section this tour targets (Header, Colours,
       Display) ships open, so no beforeShow reveal is needed.
   ============================================================================ */
(function () {
  'use strict';

  function buildSteps() {
    return [
      {
        tab: 'design',
        target: 'input[data-bind="header.title"]',
        title: 'Name your pricing table',
        body: 'This is the heading that sits above your plans, something like Our holiday packages or Membership options. There is a subtitle underneath for a supporting line.',
        placement: 'right'
      },
      {
        tab: 'design',
        target: function () { var el = document.querySelector('input[data-bind="brandColor"]'); return el && el.closest ? el.closest('.cr') : el; },
        title: 'Match your brand',
        body: 'Set your brand and accent colours here, plus the page and card backgrounds. In a hurry? The presets just below set a matching pair in one click.',
        placement: 'right'
      },
      {
        tab: 'content',
        target: '.plans-header',
        title: 'Build your plans',
        body: 'Your plans live here. Add one by hand, let AI draft a set for you, or upload a spreadsheet if you already have your pricing in one. Most people start with two or three.',
        placement: 'right'
      },
      {
        tab: 'content',
        target: '#p0',
        title: 'Edit a plan',
        body: 'Click any plan to open it up. Set the name, price, currency and button, tick each feature on or off, and mark your best value plan as Featured so it stands out.',
        placement: 'right'
      },
      {
        tab: 'settings',
        target: function () { return document.querySelector('#panel-settings .sec'); },
        title: 'Switch on the extras',
        body: 'Add a monthly and yearly billing toggle, plan badges, icons and a trust strip along the bottom. Turn on only what you need, a clean table converts best.',
        placement: 'right'
      },
      {
        target: '.tgse-preview',
        title: 'See it come together',
        body: 'The preview updates as you go, so you always know exactly how your pricing table will look on your site.',
        placement: 'left',
        spotlightPadding: 6
      },
      {
        target: '#btn-save',
        title: 'Save your pricing table',
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
    titleHtml: 'Let\u2019s build your <em>pricing table</em>.',
    body: 'A quick walk through the setup, one step at a time. About a minute, and you can fill in your real plans as we go. Ready?'
  };
  var DONE = {
    titleHtml: 'All set. <em>Your pricing table is ready.</em>',
    body: 'Plans built, priced and styled to your brand. Save it, then click Get embed code and paste that one line on your site. Your packages will be live and easy to compare. You can reopen this walkthrough any time from the button in the corner.'
  };

  var _api = null;
  function launch() {
    if (!window.tgse || typeof window.tgse.tour !== 'function') {
      console.warn('[pricing-tour] tgse.tour not available — load editor-tour.js');
      return;
    }
    // tear down any previous run so reopening never stacks overlays
    if (_api && typeof _api.finish === 'function') { try { _api.finish(false); } catch (e) {} }
    _api = window.tgse.tour({
      id: 'pricing',
      welcome: WELCOME,
      done: DONE,
      steps: buildSteps()   // fresh steps each open
    });
    _api.start();
    return _api;
  }

  // Public entry. Mounts the persistent launcher, and auto-starts on login
  // unless the user ticked "don't show this again".
  var _booted = false;
  window.initPricingTour = function () {
    if (_booted) return;
    _booted = true;
    if (!window.tgse || typeof window.tgse.tourLauncher !== 'function') {
      console.warn('[pricing-tour] tgse.tourLauncher not available');
      return;
    }
    window.tgse.tourLauncher({ id: 'pricing', label: 'Show me how', onClick: launch });
    if (!window.tgse.isTourDismissed || !window.tgse.isTourDismissed('pricing')) {
      setTimeout(launch, 650);
    }
  };

})();
