/* ============================================================================
   Prism — guided setup tour  v1.0.0
   ----------------------------------------------------------------------------
   Walkthrough for the Prism editor. Leads with the headline copy, then the
   destinations list, then framing a photo (the thing that makes Prism Prism),
   then the look, then preview / save / embed.

   Requires editor-tour.js.

   Stable ids: #t-title, #dest-list, #focal (Content); #d-slant (Design);
   .tgse-preview; #btn-save, #btn-embed. Default tab is Content.
   ============================================================================ */
(function () {
  'use strict';

  function buildSteps() {
    return [
      {
        tab: 'content',
        target: '#t-title',
        title: 'Write your headline',
        body: 'This is the copy on the left. Set the heading, the script line under it and a short piece of body text. You give each one its own font over in Design.',
        placement: 'right'
      },
      {
        tab: 'content',
        target: '#dest-list',
        title: 'Add your destinations',
        body: 'Each row is one angled photo. Add or remove them, rename them, and drag-free reorder later. Click a row to open its settings just below.',
        placement: 'right'
      },
      {
        tab: 'content',
        target: '#focal',
        title: 'Frame each photo',
        body: 'Drag the point to choose exactly which part of the photo shows, then zoom if you want. Paste in your own photo URL, set the label, and point the whole slice at any link.',
        placement: 'right'
      },
      {
        tab: 'design',
        target: '#d-slant',
        title: 'Make it yours',
        body: 'Set the panel colour, the seam colour and the diagonal angle here. Open Heading, Script, Lead and the label sections to give each piece of text its own font, size and colour.',
        placement: 'right'
      },
      {
        target: '.tgse-preview',
        title: 'See it live',
        body: 'Every change shows here straight away. Try the desktop, tablet and mobile buttons up top to check it holds together at any width.',
        placement: 'left',
        spotlightPadding: 6
      },
      {
        target: '#btn-save',
        title: 'Save it',
        body: 'Give it a name and save. Your Prism hero is stored and ready to embed.',
        placement: 'bottom'
      },
      {
        target: '#btn-embed',
        title: 'Drop it on your site',
        body: 'Click Get embed code and paste the single line where you want the hero to sit.',
        placement: 'bottom'
      }
    ];
  }

  var WELCOME = {
    titleHtml: 'Let’s set up your <em>Prism</em> hero.',
    body: 'A quick walk through the setup, one step at a time. Under a minute, and you have an editorial hero band with your own copy, photos and links. Ready?'
  };
  var DONE = {
    titleHtml: 'All set. <em>Show off your best places.</em>',
    body: 'Prism turns a row of destinations into a hero with a point of view. Save it, then click Get embed code and paste that one line on your site. You can reopen this walkthrough any time from the button in the corner.'
  };

  var _api = null;
  function launch() {
    if (!window.tgse || typeof window.tgse.tour !== 'function') {
      console.warn('[prism-tour] tgse.tour not available — load editor-tour.js');
      return;
    }
    if (_api && typeof _api.finish === 'function') { try { _api.finish(false); } catch (e) {} }
    _api = window.tgse.tour({ id: 'prism', welcome: WELCOME, done: DONE, steps: buildSteps() });
    _api.start();
    return _api;
  }

  var _booted = false;
  window.initPrismTour = function () {
    if (_booted) return;
    _booted = true;
    if (!window.tgse || typeof window.tgse.tourLauncher !== 'function') {
      console.warn('[prism-tour] tgse.tourLauncher not available');
      return;
    }
    window.tgse.tourLauncher({ id: 'prism', label: 'Show me how', onClick: launch });
    if (!window.tgse.isTourDismissed || !window.tgse.isTourDismissed('prism')) {
      setTimeout(launch, 650);
    }
  };

})();
