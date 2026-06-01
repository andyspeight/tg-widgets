/* ============================================================================
   Countdown Timer — guided setup tour  v1.0.0
   ----------------------------------------------------------------------------
   Step-by-step walkthrough for the Countdown editor. Each step spotlights a
   REAL control and tells the user what to do. The tour switches tabs as needed
   and advances on Next.

   Requires editor-tour.js (adds tgse.tour + tgse.tourLauncher).

   Real anchors (verified against editor-countdown.html):
     #targetDate         Target date/time      (Content tab, "Target" section, open)
     #heading            Headline input        (Content tab, "Copy" section, open)
     #expiryBehaviour    What happens at zero  (Content tab, "When it hits zero" section, COLLAPSED)
     #layoutGrid         Layout chooser        (Design tab, "Layout" section, open)
     #presetsRow         Colour presets        (Design tab, "Theme & colours" section, open)
     .tgse-preview       Live preview          (main area)
     #btn-save           Save button           (header)
     #btn-embed          Get embed code        (preview toolbar)

   Notes on this editor (a third structural variant):
     - Static markup (not JS-rendered). Panels are .tab-panel[data-panel];
       tab clicks hide/show panels synchronously (editor's own wire() AND the
       shell's onTabChange), so a tab step's target is present right after the
       tab is clicked.
     - Sections are .sec / .sec.is-open with a .sec-head toggle, NOT
       .tgse-section.is-open. The engine's .tgse-section reveal is a harmless
       no-op here. Every targeted section defaults open EXCEPT "When it hits
       zero", which this step list opens itself via beforeShow (set .is-open
       directly, never click the head).
   ============================================================================ */
(function () {
  'use strict';

  // Return the whole .sec card whose title matches (case-insensitive).
  function secByTitle(t) {
    var el = Array.prototype.slice.call(document.querySelectorAll('.sec .sec-title'))
      .find(function (e) { return e.textContent.trim().toLowerCase() === t.toLowerCase(); });
    return el && el.closest ? el.closest('.sec') : null;
  }
  // Return the whole .sec card containing the element with the given id.
  function secOf(id) {
    var el = document.querySelector(id);
    return el && el.closest ? el.closest('.sec') : el;
  }

  function buildSteps() {
    return [
      {
        tab: 'content',
        target: function () { return secOf('#targetDate'); },
        title: 'Set when it ends',
        body: 'This is the moment everything counts down to, a sale deadline, a departure date, the last day to book. Pick the date and time here, then set the timezone just below so it reads right for your customers.',
        placement: 'right'
      },
      {
        tab: 'content',
        target: function () { return secOf('#heading'); },
        title: 'Your headline and message',
        body: 'Tell people what the countdown is for. A clear headline like Summer sale ends in does most of the work, with a short line underneath if you want to add detail.',
        placement: 'right'
      },
      {
        tab: 'content',
        target: function () { return secOf('#expiryBehaviour'); },
        // "When it hits zero" ships collapsed. Open its .sec directly before we paint.
        beforeShow: function () {
          var el = document.querySelector('#expiryBehaviour');
          var sec = el && el.closest ? el.closest('.sec') : null;
          if (sec) sec.classList.add('is-open');
        },
        title: 'Decide what happens at zero',
        body: 'When the timer runs out you can show a message, hide the countdown, or send people to another page. Pick whichever fits the campaign.',
        placement: 'right'
      },
      {
        tab: 'design',
        target: '#layoutGrid',
        title: 'Choose the look',
        body: 'Card boxes it neatly mid-page, Banner runs a wide strip across the top, Inline drops it into a line of text, Hero goes large and centred. Pick one and watch the preview.',
        placement: 'right'
      },
      {
        tab: 'design',
        target: function () { return secByTitle('Theme & colours') || document.querySelector('#presetsRow') || document.querySelector('#colBrand'); },
        title: 'Match your brand',
        body: 'Tap a preset for an instant palette, or set each colour yourself below so the timer looks like part of your site rather than bolted on.',
        placement: 'right'
      },
      {
        tab: 'design',
        target: function () { return secByTitle('Shape & motion'); },
        title: 'Shape and motion',
        body: 'Round off the digit boxes with Border radius, and choose how the numbers behave. Tick animation fades each digit as it changes, while Urgency mode flips the digits to your accent colour once you drop below the threshold you set in hours, a simple way to add pressure as the deadline nears.',
        placement: 'right'
      },
      {
        tab: 'design',
        target: function () { return secByTitle('Typography'); },
        title: 'Typography',
        body: 'Pick the font used across the whole countdown. Match it to your site for a seamless look, or choose something bolder if you want the timer to stand out.',
        placement: 'right'
      },
      {
        tab: 'design',
        target: function () { return secByTitle('Wow effects'); },
        title: 'Add some wow',
        body: 'Optional flourishes that make the timer feel alive: Sliding digits roll over reel-style, Brand glow adds a soft shadow under each cell, a Final-minute ring counts down the last 60 seconds, and the Hero aurora and Banner pulse dot add motion to those specific layouts. All respect reduced-motion settings, so switch on whatever suits the campaign.',
        placement: 'right'
      },
      {
        target: '.tgse-preview',
        title: 'Watch it tick',
        body: 'The preview runs live, so you can see exactly how your countdown looks and ticks before it goes anywhere near your site.',
        placement: 'left',
        spotlightPadding: 6
      },
      {
        target: '#btn-save',
        title: 'Save your countdown',
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
    titleHtml: 'Let\u2019s build your <em>countdown</em>.',
    body: 'A quick walk through the setup, one step at a time. It takes about a minute and you can do each bit yourself as we go. Ready?'
  };
  var DONE = {
    titleHtml: 'All set. <em>Your countdown is ticking.</em>',
    body: 'Target set, message written and your brand applied. Save it, then click Get embed code and paste that one line on your site. The timer will count down live for every visitor. You can reopen this walkthrough any time from the button in the corner.'
  };

  var _api = null;
  function launch() {
    if (!window.tgse || typeof window.tgse.tour !== 'function') {
      console.warn('[countdown-tour] tgse.tour not available — load editor-tour.js');
      return;
    }
    // tear down any previous run so reopening never stacks overlays
    if (_api && typeof _api.finish === 'function') { try { _api.finish(false); } catch (e) {} }
    _api = window.tgse.tour({
      id: 'countdown',
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
  window.initCountdownTour = function () {
    if (_booted) return;
    _booted = true;
    if (!window.tgse || typeof window.tgse.tourLauncher !== 'function') {
      console.warn('[countdown-tour] tgse.tourLauncher not available');
      return;
    }
    window.tgse.tourLauncher({ id: 'countdown', label: 'Show me how', onClick: launch });
    if (!window.tgse.isTourDismissed || !window.tgse.isTourDismissed('countdown')) {
      setTimeout(launch, 650);
    }
  };

})();
