/**
 * Stop right click on a published site.
 *
 * Andy's call, 21 Aug 2026, from Duda's Disable Right Click. Loaded only for a
 * site whose settings ask for it, so a site that has not asked ships nothing.
 *
 * WHAT THIS IS NOT. It is not protection. The picture is still in the page
 * source, still in the browser cache, still one screenshot away and still
 * whatever curl asks for. Anybody who wanted it will have it. This raises the
 * effort above idle, which is what was asked for and all it can be.
 *
 * TEXT FIELDS KEEP THEIR MENU. Right-clicking to paste an email address into a
 * form is how a lot of people fill one in, and the enquiry form is what the site
 * is for. Blocking it there would cost bookings to guard a photograph. If that
 * exception is ever unwanted, it is the `isTyping` check below.
 *
 * CSP-CLEAN, like everything else here: no inline handlers, no eval, no
 * innerHTML. It reads nothing off the page and sends nothing anywhere.
 *
 * @version 1.0.0
 */
(function () {
  'use strict';

  var VERSION = '1.0.0';
  if (window.__TG_SITES_NORIGHT__) return;
  window.__TG_SITES_NORIGHT__ = VERSION;

  /* The class the stylesheet keys the long-press and drag rules off. Added here
     rather than server-side because the whole feature needs this script anyway,
     so a page without it should not carry the styling either. */
  document.documentElement.classList.add('tg-noright');

  /** Somewhere a person is typing, where the menu is how they paste. */
  function isTyping(node) {
    if (!node || !node.tagName) return false;
    var tag = node.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || node.isContentEditable === true;
  }

  document.addEventListener(
    'contextmenu',
    function (event) {
      if (isTyping(event.target)) return;
      event.preventDefault();
    },
    /* Capture, so a widget's own handler further down cannot let it through
       first and make the setting look unreliable. */
    true,
  );

  /* Dragging a picture to the desktop is the other one-step save. */
  document.addEventListener(
    'dragstart',
    function (event) {
      var tag = event.target && event.target.tagName;
      if (tag === 'IMG' || tag === 'VIDEO') event.preventDefault();
    },
    true,
  );
})();
