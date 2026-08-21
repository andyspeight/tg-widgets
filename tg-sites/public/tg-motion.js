/**
 * tg-sites motion, the part a script does.
 *
 * ONE RECIPE NEEDS THIS AND ONLY ONE. Seven of the eight built so far are pure CSS
 * and never load this file. A3 drifting-rail is here because it is the one thing CSS
 * genuinely cannot do: a track that moves on its own AND is added to by scroll, two
 * sources combined into one offset. CSS can do either alone and neither together.
 *
 * WHAT THE PAGE IS WITHOUT IT, which is the whole design. The rail is a native
 * horizontal scroll-snap carousel, written in globals.css and working on its own:
 * swipeable on a phone, draggable on a trackpad, reachable from a keyboard, and with
 * every card readable. This file adds an ambient drift ON TOP by nudging scrollLeft.
 * Blocked, slow, or switched off and the visitor still gets the whole rail and every
 * card in it. Clause 2 of the rule in lib/content/blocks.ts: the content never
 * depends on a script.
 *
 * WHY scrollLeft AND NOT A TRANSFORM. A transform would slide the track under a
 * viewport the visitor can no longer steer, so the drift would have to take over the
 * scrolling as well and reimplement dragging, snapping, momentum and keyboard access.
 * Nudging the real scroll position leaves all of that to the browser, which does it
 * better, and means the ambient movement and the visitor's own steering are the same
 * number rather than two that have to be reconciled.
 *
 * PACED BY ELAPSED TIME, NEVER BY FRAMES. Lesson 3 in the motion catalogue: anything
 * advanced by a fixed step per frame runs slow on a weak GPU and drifts visibly. The
 * phase here is read from the clock, so a machine dropping frames shows a coarser
 * drift at the same speed rather than a smooth one running late.
 *
 * IT STOPS WHEN ANYBODY WANTS IT TO. Reduced motion and it never starts at all. A
 * pointer over it, focus inside it, the tab hidden, or the visitor scrolling the rail
 * themselves, and it holds still until they are done. Auto-moving content needs a way
 * to stop it (WCAG 2.2.2) and hovering is not reachable from a keyboard, which is why
 * focus counts too: tab into a card and the drift stops.
 *
 * CSP-CLEAN, like everything else here. No inline handlers, no injected script, no
 * eval, no innerHTML. It only ever reads the data- attributes the renderer wrote.
 *
 * @version 1.0.0
 */
(function () {
  'use strict';

  var VERSION = '1.0.0';

  /* Nothing here runs for a visitor who asked for less movement. Not a reduced
     amount: none, and no rAF loop is ever started. The CSS rail is already a
     finished, swipeable carousel without it. */
  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
  if (REDUCED && REDUCED.matches) return;

  /*
   * TWO OUT-OF-PHASE SINE WAVES, per the catalogue, and deliberately not a marquee.
   * A marquee has to wrap, and a seven-card track wraps to a visible gap unless the
   * content is duplicated. Oscillation cannot expose an end, so it is the safe
   * default and the amplitude is clamped to the track's real travel besides.
   *
   * The periods are primes so the pair does not come back into phase in any time
   * somebody will sit and watch, which is the same reasoning A4's layers use.
   */
  var PERIOD_A = 29000;
  var PERIOD_B = 47000;
  var BANDS = { 1: 0.18, 2: 0.32, 3: 0.5 };

  /** How long to leave the rail alone after the visitor has touched it. */
  var SETTLE_MS = 1800;

  function clamp(value, low, high) {
    return value < low ? low : value > high ? high : value;
  }

  function setUpRail(track, intensity) {
    var amplitude = BANDS[intensity] || BANDS[2];
    var paused = false;
    var settleUntil = 0;
    var selfScrollUntil = 0;

    /* The rail's own travel. Re-read every frame rather than cached, because a
       picture finishing loading or a phone turning changes it, and a stale width
       clamps the drift to a track that no longer exists. */
    function travel() {
      return Math.max(0, track.scrollWidth - track.clientWidth);
    }

    /*
     * The rail is the visitor's for a moment. Marking it hands SNAPPING back (see
     * globals.css), so their swipe lands on a card the way it would with no script
     * here at all, and stops the drift arguing with them about where it should be.
     */
    function hold() {
      settleUntil = Date.now() + SETTLE_MS;
      track.setAttribute('data-motion-steer', '1');
    }

    track.addEventListener('pointerenter', function () { paused = true; });
    track.addEventListener('pointerleave', function () { paused = false; hold(); });
    track.addEventListener('focusin', function () { paused = true; });
    track.addEventListener('focusout', function () { paused = false; hold(); });
    track.addEventListener('pointerdown', hold);
    track.addEventListener('wheel', hold, { passive: true });
    track.addEventListener('touchstart', hold, { passive: true });

    /*
     * A scroll on the rail is either ours or theirs, and only theirs should stop the
     * drift. Every nudge below stamps selfScrollUntil first, so the event it causes
     * is recognised and ignored; anything else is the visitor steering.
     */
    track.addEventListener('scroll', function () {
      if (Date.now() > selfScrollUntil) hold();
    }, { passive: true });

    var start = 0;

    function frame(now) {
      if (!start) start = now;
      var max = travel();

      /* Nothing to drift along, the visitor is busy, or the tab is not being looked
         at. Keep the loop alive but touch nothing. */
      if (max <= 1 || paused || Date.now() < settleUntil || document.hidden) {
        window.requestAnimationFrame(frame);
        return;
      }

      /* Nobody is steering any more, so the drift takes the position back and
         snapping goes quiet until they touch it again. */
      if (track.getAttribute('data-motion-steer') === '1') {
        track.removeAttribute('data-motion-steer');
      }

      var t = now - start;
      var wave =
        Math.sin((t / PERIOD_A) * Math.PI * 2) * 0.6
        + Math.sin((t / PERIOD_B) * Math.PI * 2 + 1.1) * 0.4;

      /*
       * The drift is a position along the track's REAL travel, so it can never
       * expose an end however long it runs or however few cards there are. Half the
       * travel is the centre, and the wave swings either side of it by the band.
       */
      var target = clamp(max * (0.5 + wave * amplitude), 0, max);

      /* Ease toward the target rather than jumping to it, so a frame the browser
         skipped shows up as a slightly coarser drift and never as a jolt. */
      var next = track.scrollLeft + (target - track.scrollLeft) * 0.02;

      if (Math.abs(next - track.scrollLeft) > 0.05) {
        selfScrollUntil = Date.now() + 120;
        track.scrollLeft = next;
      }

      window.requestAnimationFrame(frame);
    }

    window.requestAnimationFrame(frame);
  }

  function init() {
    var rails = document.querySelectorAll("[data-motion='A3'] .tgs-cards");
    for (var i = 0; i < rails.length; i += 1) {
      var track = rails[i];
      /* A double-init guard, the same one every widget in this repo carries: the
         routes emit one tag per document, but a preview can re-run this. */
      if (track.getAttribute('data-motion-live') === '1') continue;
      track.setAttribute('data-motion-live', '1');

      var section = track.closest("[data-motion='A3']");
      var intensity = parseInt(section && section.getAttribute('data-motion-intensity'), 10) || 2;
      setUpRail(track, intensity);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.__TG_MOTION_VERSION__ = VERSION;
})();
