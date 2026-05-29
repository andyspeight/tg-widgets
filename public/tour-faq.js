/* ============================================================================
   FAQ — guided setup tour  v1.0.0
   ----------------------------------------------------------------------------
   Step-by-step walkthrough for the FAQ widget editor. Each step spotlights a
   REAL control and tells the user what to do. The tour switches tabs as needed
   and advances on Next.

   ORDER: questions FIRST. The questions are what the preview displays, so we
   lead with them, then layout, brand, behaviour and the SEO win each have a
   populated accordion to work against.

   Requires editor-tour.js (adds tgse.tour + tgse.tourLauncher).

   Real anchors (verified against editor-faq.html):
     [data-add-question]               Add question button (Content tab, "Questions" section)
     [data-section="layout"]           Layout chooser      (Design tab — accordion/two-column/tabs/searchable)
     [data-section="colours"]          Colours block       (Design tab)
     [data-toggle="search.enabled"]    Search bar toggle   (Settings tab, behaviour)
     [data-toggle="seo.enableSchema"]  FAQ schema toggle   (Settings tab — Google rich results)
     .tgse-preview                     Live preview        (main area)
     #btn-save                         Save button         (header)
     #btn-embed                        Get embed code      (preview toolbar)

   Notes on this editor (Testimonials family):
     - The sidebar body is JS-rendered per tab: setTab() -> renderTabBody()
       swaps #sidebar-body for renderDesignTab/ContentTab/SettingsTab, driven by
       the shell's onTabChange. A tab step's target is rendered the moment the
       tab is clicked, so it is present when the engine paints.
     - Sections are .section[data-open][data-section] built by a section()
       helper and default to open (state.sections[key] !== false), so no
       beforeShow reveals are needed for the controls this tour targets.
     - Per-question editing happens in a modal (#qe-question / #qe-answer), so we
       anchor the content step on the always-present Add question button rather
       than the modal fields.
   ============================================================================ */
(function () {
  'use strict';

  function buildSteps() {
    return [
      {
        tab: 'content',
        target: '[data-add-question]',
        title: 'Add your questions',
        body: 'This is the heart of it. Add a question and answer, and group them into categories if you have a lot. The preview builds your accordion as you go. Leave it for now and hit Next.',
        placement: 'right'
      },
      {
        tab: 'design',
        target: '[data-section="layout"]',
        title: 'Choose the layout',
        body: 'Accordion is the classic expanding list, Two-column fits more in, Tabs groups by category, and Searchable adds a search box up top. Pick one and watch the preview.',
        placement: 'right'
      },
      {
        tab: 'design',
        target: '[data-section="colours"]',
        title: 'Match your brand',
        body: 'Set your brand and accent colours here so the FAQ sits comfortably with the rest of your site.',
        placement: 'right'
      },
      {
        tab: 'settings',
        target: '[data-toggle="search.enabled"]',
        title: 'Set the behaviour',
        body: 'Add a search box, show category icons, or give visitors an expand all button. Small touches that make a long FAQ much easier to use.',
        placement: 'right'
      },
      {
        tab: 'settings',
        target: '[data-toggle="seo.enableSchema"]',
        title: 'Get found on Google',
        body: 'Switch on FAQ schema and your questions become eligible to show as rich results in Google search, right under your listing. A genuine free win for an FAQ page.',
        placement: 'right'
      },
      {
        target: '.tgse-preview',
        title: 'See it come together',
        body: 'The preview updates as you go, so you always know exactly how your FAQ will look on your site.',
        placement: 'left',
        spotlightPadding: 6
      },
      {
        target: '#btn-save',
        title: 'Save your FAQ',
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
    titleHtml: 'Let\u2019s set up your <em>FAQ</em>.',
    body: 'A quick walk through the setup, one step at a time. About a minute, and you can add your real questions as we go. Ready?'
  };
  var DONE = {
    titleHtml: 'All set. <em>Your FAQ is ready.</em>',
    body: 'Questions answered, laid out and styled to your brand. Save it, then click Get embed code and paste that one line on your site. Fewer repeat emails for you, quicker answers for your customers. You can reopen this walkthrough any time from the button in the corner.'
  };

  var _api = null;
  function launch() {
    if (!window.tgse || typeof window.tgse.tour !== 'function') {
      console.warn('[faq-tour] tgse.tour not available — load editor-tour.js');
      return;
    }
    // tear down any previous run so reopening never stacks overlays
    if (_api && typeof _api.finish === 'function') { try { _api.finish(false); } catch (e) {} }
    _api = window.tgse.tour({
      id: 'faq',
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
  window.initFaqTour = function () {
    if (_booted) return;
    _booted = true;
    if (!window.tgse || typeof window.tgse.tourLauncher !== 'function') {
      console.warn('[faq-tour] tgse.tourLauncher not available');
      return;
    }
    window.tgse.tourLauncher({ id: 'faq', label: 'Show me how', onClick: launch });
    if (!window.tgse.isTourDismissed || !window.tgse.isTourDismissed('faq')) {
      setTimeout(launch, 650);
    }
  };

})();
