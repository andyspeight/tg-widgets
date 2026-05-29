/* ============================================================================
   Logo Showcase — guided setup tour  v1.0.0
   ----------------------------------------------------------------------------
   Step-by-step walkthrough for the Logo Showcase editor. Each step spotlights a
   REAL control and tells the user what to do. The tour switches tabs as needed
   and advances on Next.

   Requires editor-tour.js (adds tgse.tour + tgse.tourLauncher).

   Real anchors (verified against editor-logos.html):
     #pick-logo          Pick from library     (Content tab, "Logos" section, open)
     #title              Heading input         (Content tab, "Heading" section, open)
     [data-layout]       Layout chooser        (Design tab, "Layout" section, open)
     #color-brand        Brand colour          (Design tab, "Colours" section, COLLAPSED)
     #show-captions      Captions toggle       (Settings tab, "Display options" section, open)
     .tgse-preview       Live preview          (main area)
     #btn-save           Save button           (header)
     #btn-embed          Get embed code        (preview toolbar)

   Notes on this editor (a fourth structural variant):
     - Static markup. Panels are .panel[data-panel] (.panel.is-active = visible);
       tab clicks toggle is-active synchronously (editor's own handler AND the
       shell's onTabChange), so a tab step's target is present right after click.
     - Sections are .section / .section.is-open (NOT .tgse-section.is-open, NOT
       .sec). The engine's .tgse-section reveal is a no-op here, so the one
       collapsed section we target (Colours) is opened by this step list via
       beforeShow (set .is-open directly, never click the head).
   ============================================================================ */
(function () {
  'use strict';

  function buildSteps() {
    return [
      {
        tab: 'content',
        target: '#pick-logo',
        title: 'Add your logos',
        body: 'Click Pick from library to drop in common travel logos like ABTA and ATOL, Add blank logo to bring in your own, or import a batch from a spreadsheet. Leave it for now and hit Next, you can come back to it.',
        placement: 'right'
      },
      {
        tab: 'content',
        target: '#title',
        title: 'Give it a heading',
        body: 'A short line above the logos sets the tone, something like Our partners and accreditations. There is room for a small eyebrow line and a subtitle underneath too if you want them.',
        placement: 'right'
      },
      {
        tab: 'design',
        target: function () { var c = document.querySelector('[data-layout="grid"]'); return c && c.closest ? c.closest('.section') : c; },
        title: 'Choose the layout',
        body: 'Grid lays them out in neat rows, Strip keeps them on one tidy line, Marquee scrolls them gently along, Spotlight gives one logo the star treatment. Pick one and watch the preview.',
        placement: 'right'
      },
      {
        tab: 'design',
        target: '#color-brand',
        // The Colours section ships collapsed. Open its .section before we paint.
        beforeShow: function () {
          var el = document.querySelector('#color-brand');
          var sec = el && el.closest ? el.closest('.section') : null;
          if (sec) sec.classList.add('is-open');
        },
        title: 'Match your brand',
        body: 'Set your brand colour and the background here so the wall sits comfortably with the rest of your site.',
        placement: 'right'
      },
      {
        tab: 'settings',
        target: '#show-captions',
        title: 'Tidy up the details',
        body: 'Turn captions under each logo on or off, and switch on filters if you want visitors to sort by type. Small touches that keep the wall looking clean.',
        placement: 'right'
      },
      {
        target: '.tgse-preview',
        title: 'See it come together',
        body: 'The preview updates as you go, so you always know exactly how your logo wall will look on your site.',
        placement: 'left',
        spotlightPadding: 6
      },
      {
        target: '#btn-save',
        title: 'Save your logo wall',
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
    titleHtml: 'Let\u2019s set up your <em>logo wall</em>.',
    body: 'A quick walk through the setup, one step at a time. It takes about a minute and you can do each bit yourself as we go. Ready?'
  };
  var DONE = {
    titleHtml: 'All set. <em>Your logo wall is ready.</em>',
    body: 'Logos added, laid out and styled to your brand. Save it, then click Get embed code and paste that one line on your site. Your accreditations and partners will be on show. You can reopen this walkthrough any time from the button in the corner.'
  };

  var _api = null;
  function launch() {
    if (!window.tgse || typeof window.tgse.tour !== 'function') {
      console.warn('[logos-tour] tgse.tour not available — load editor-tour.js');
      return;
    }
    // tear down any previous run so reopening never stacks overlays
    if (_api && typeof _api.finish === 'function') { try { _api.finish(false); } catch (e) {} }
    _api = window.tgse.tour({
      id: 'logos',
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
  window.initLogosTour = function () {
    if (_booted) return;
    _booted = true;
    if (!window.tgse || typeof window.tgse.tourLauncher !== 'function') {
      console.warn('[logos-tour] tgse.tourLauncher not available');
      return;
    }
    window.tgse.tourLauncher({ id: 'logos', label: 'Show me how', onClick: launch });
    if (!window.tgse.isTourDismissed || !window.tgse.isTourDismissed('logos')) {
      setTimeout(launch, 650);
    }
  };

})();
