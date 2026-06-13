/* ============================================================================
   Appointment Scheduler — guided setup tour  v1.0.0
   ----------------------------------------------------------------------------
   Walkthrough for the Appointment Scheduler editor. Leads with the headline,
   then the appointment type, then the all-important availability (working days,
   hours, slot length), then the fields, then preview / save / embed.

   Requires editor-tour.js.

   Stable ids: #heading-input, #mode-picker (Content); #avail-section,
   #days-picker, #fields-section (Settings); #btn-save, #btn-embed.
   Default tab is Design.
   ============================================================================ */
(function () {
  'use strict';

  function buildSteps() {
    return [
      {
        tab: 'content',
        target: '#heading-input',
        title: 'Set the invitation',
        body: 'This is the headline visitors see, like "Book a free consultation". Add a warm line underneath that tells them what happens next.',
        placement: 'right'
      },
      {
        tab: 'content',
        target: '#mode-picker',
        title: 'How will you meet?',
        body: 'Callback, a phone call, a video call or in person. This sets the icon and the wording so it reads right.',
        placement: 'right'
      },
      {
        tab: 'settings',
        target: '#avail-section',
        title: 'Set your availability',
        body: 'This is the heart of it. Choose your working days, the hours you take calls, how long each slot is and how far ahead people can book. The widget builds the times for you.',
        placement: 'right'
      },
      {
        tab: 'settings',
        target: '#fields-section',
        title: 'What to ask for',
        body: 'Phone, notes and a consent tick. Keep it short, you only need enough to make the call.',
        placement: 'right'
      },
      {
        target: '.tgse-preview',
        title: 'Try it live',
        body: 'Pick a day and a time on the right, fill the form and submit. In the editor it shows the confirmation without sending anything. On your site the request lands with your team.',
        placement: 'left',
        spotlightPadding: 6
      },
      {
        target: '#btn-save',
        title: 'Save it',
        body: 'Give it a name and save. Your scheduler is stored and ready to embed.',
        placement: 'bottom'
      },
      {
        target: '#btn-embed',
        title: 'Drop it on your site',
        body: 'Click Get embed code and paste the single line on your contact or enquiry page.',
        placement: 'bottom'
      }
    ];
  }

  var WELCOME = {
    titleHtml: 'Let’s set up your <em>Appointment Scheduler</em>.',
    body: 'A quick walk through the setup, one step at a time. A couple of minutes, and visitors can book a time with one of your experts without a single email back and forth. Ready?'
  };
  var DONE = {
    titleHtml: 'All set. <em>Your diary, on your site.</em>',
    body: 'A booked time converts far better than a cold form. Save it, then click Get embed code and paste that one line on your site. You can reopen this walkthrough any time from the button in the corner.'
  };

  var _api = null;
  function launch() {
    if (!window.tgse || typeof window.tgse.tour !== 'function') {
      console.warn('[appointment-tour] tgse.tour not available — load editor-tour.js');
      return;
    }
    if (_api && typeof _api.finish === 'function') { try { _api.finish(false); } catch (e) {} }
    _api = window.tgse.tour({ id: 'appointment', welcome: WELCOME, done: DONE, steps: buildSteps() });
    _api.start();
    return _api;
  }

  var _booted = false;
  window.initAppointmentTour = function () {
    if (_booted) return;
    _booted = true;
    if (!window.tgse || typeof window.tgse.tourLauncher !== 'function') {
      console.warn('[appointment-tour] tgse.tourLauncher not available');
      return;
    }
    window.tgse.tourLauncher({ id: 'appointment', label: 'Show me how', onClick: launch });
    if (!window.tgse.isTourDismissed || !window.tgse.isTourDismissed('appointment')) {
      setTimeout(launch, 650);
    }
  };

})();
