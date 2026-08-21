/**
 * tg-sites image slideshow, the part a script does.
 *
 * The slideshow auto-plays in pure CSS on its own, on the published page and in
 * the editor preview alike, and pauses on hover with no script at all. This file
 * is what a browser adds ON TOP where a script is allowed to run: clickable prev
 * and next arrows, dots you can jump with, and a pause button so nobody is stuck
 * watching pictures move. It is progressive enhancement, so a page with the
 * script blocked still shows a working, moving slideshow, just without the
 * buttons.
 *
 * WHEN THIS TAKES OVER. The moment it enhances a slideshow it adds `is-live`,
 * which switches the CSS off the keyframe cycle and onto a script-driven current
 * slide (see globals.css). From then on the timer here decides what shows, so a
 * click lands exactly on the slide you asked for rather than fighting an
 * animation. The pause button is not a nicety: auto-moving content needs a way to
 * stop it (WCAG 2.2.2), and hover-to-pause is not reachable from a keyboard.
 *
 * CSP-CLEAN, like every widget in this repo. No inline handlers, no injected
 * script, no eval, no innerHTML. Controls are built with createElement and
 * labelled with textContent and aria-label; their arrows and bars are drawn in
 * CSS. Nothing off the page or the network reaches this, it only ever reads the
 * data- attributes the renderer wrote.
 *
 * @version 1.0.0
 */
(function () {
  'use strict';

  var VERSION = '1.0.0';
  if (window.__TG_SITES_SLIDESHOW__) return;
  window.__TG_SITES_SLIDESHOW__ = VERSION;

  var reduceMotion =
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;

  /** A labelled button with one class, and no text of its own to draw. */
  function button(className, label) {
    var el = document.createElement('button');
    el.type = 'button';
    el.className = className;
    el.setAttribute('aria-label', label);
    return el;
  }

  /**
   * Turn one .tgs-slideshow into a real, controllable slideshow. Safe to call
   * twice on the same node: the `is-live` flag makes the second call a no-op.
   */
  function enhance(root) {
    if (!root || root.classList.contains('is-live')) return;

    var slides = [].slice.call(root.querySelectorAll('.tgs-slideshow__slide'));
    var count = slides.length;
    // One picture is a picture, not a slideshow. Nothing to drive.
    if (count < 2) return;

    var wantArrows = root.getAttribute('data-arrows') === 'true';
    var wantDots = root.getAttribute('data-dots') === 'true';

    // Seconds a slide is held, as the renderer wrote it. A sane fallback keeps a
    // hand-edited or future page from stalling on a missing or silly number.
    var interval = parseFloat(root.getAttribute('data-interval'));
    if (!(interval >= 1) || !isFinite(interval)) interval = 5;
    var holdMs = interval * 1000;

    root.classList.add('is-live');

    /* The takeover moment. Until now the CSS cycle was showing slide 0 and every
       film was running; from here the script owns which one shows, so the films
       have to be brought into line or four of them keep playing unseen. */
    for (var f = 0; f < slides.length; f += 1) films(slides[f], f === 0);
    root.setAttribute('data-dir', 'next');

    var current = 0;
    var timer = 0;
    var paused = false; // the visitor pressed pause
    var hovering = false;
    var focused = false;

    // The decorative CSS dots stop meaning anything once the script drives the
    // slides, so hide them and build ones that click.
    var cssDots = root.querySelector('.tgs-slideshow__dots');
    if (cssDots) cssDots.hidden = true;

    // A quiet announcement of which slide is showing, for a screen reader.
    var status = document.createElement('p');
    status.className = 'tgs-slideshow__status tgs-sr-only';
    status.setAttribute('aria-live', 'polite');
    root.appendChild(status);

    var dots = [];
    if (wantDots) {
      var nav = document.createElement('div');
      nav.className = 'tgs-slideshow__nav';
      for (var i = 0; i < count; i += 1) {
        var dot = button('tgs-slideshow__dotbtn', 'Go to slide ' + (i + 1));
        (function (to) {
          dot.addEventListener('click', function () {
            go(to, to < current ? 'prev' : 'next');
            arm();
          });
        })(i);
        nav.appendChild(dot);
        dots.push(dot);
      }
      root.appendChild(nav);
    }

    var toggle = button('tgs-slideshow__toggle', 'Pause slideshow');
    toggle.setAttribute('aria-pressed', 'false');
    toggle.setAttribute('data-state', 'playing');
    toggle.addEventListener('click', function () {
      paused = !paused;
      reflect();
      arm();
    });
    root.appendChild(toggle);

    if (wantArrows) {
      // Named with the Btn suffix on purpose: a bare `next` would be a var that
      // shadows the next() function below and stop autoplay dead.
      var prevBtn = button('tgs-slideshow__arrow tgs-slideshow__arrow--prev', 'Previous slide');
      var nextBtn = button('tgs-slideshow__arrow tgs-slideshow__arrow--next', 'Next slide');
      prevBtn.addEventListener('click', function () {
        go(current - 1, 'prev');
        arm();
      });
      nextBtn.addEventListener('click', function () {
        go(current + 1, 'next');
        arm();
      });
      root.appendChild(prevBtn);
      root.appendChild(nextBtn);
    }

    function reflect() {
      toggle.setAttribute('aria-label', paused ? 'Play slideshow' : 'Pause slideshow');
      toggle.setAttribute('aria-pressed', paused ? 'true' : 'false');
      toggle.setAttribute('data-state', paused ? 'paused' : 'playing');
    }

    /**
     * Only the slide on show keeps its film running.
     *
     * A SLIDE CAN BE A FILM since 21 Aug 2026, and the slides are stacked with
     * opacity rather than display, so a browser will happily decode five clips at
     * once while four of them are invisible. That is four videos' worth of work
     * and battery for nothing. Pausing the rest costs a loop.
     *
     * PURELY AN ENHANCEMENT, like the arrows and the dots: without this script
     * every clip plays, muted and looping, which is correct and merely wasteful.
     * The `play()` promise is swallowed because a browser is allowed to refuse
     * it, and a refusal here is not an error worth anybody's console.
     */
    function films(slide, playing) {
      var found = slide.getElementsByTagName('video');
      for (var v = 0; v < found.length; v += 1) {
        if (playing) {
          var started = found[v].play();
          if (started && started.catch) started.catch(function () {});
        } else {
          found[v].pause();
        }
      }
    }

    /** Show slide `to`, sliding `dir`. Wraps at either end. */
    function go(to, dir) {
      to = (to % count + count) % count;
      if (to === current) return;
      root.setAttribute('data-dir', dir);
      for (var i = 0; i < count; i += 1) {
        var s = slides[i];
        s.classList.toggle('is-leaving', i === current);
        s.classList.toggle('is-current', i === to);
        s.setAttribute('aria-hidden', i === to ? 'false' : 'true');
        films(s, i === to);
      }
      for (var d = 0; d < dots.length; d += 1) {
        dots[d].setAttribute('aria-current', d === to ? 'true' : 'false');
      }
      current = to;
      status.textContent = 'Slide ' + (to + 1) + ' of ' + count;
    }

    function next() {
      go(current + 1, 'next');
    }

    // Autoplay may run only when nobody is looking closely and nothing forbids
    // it: not paused by hand, not hovered, not focused within, tab visible, and
    // motion allowed.
    function mayPlay() {
      return (
        !paused &&
        !hovering &&
        !focused &&
        !document.hidden &&
        !(reduceMotion && reduceMotion.matches)
      );
    }

    function disarm() {
      if (timer) {
        window.clearTimeout(timer);
        timer = 0;
      }
    }

    /** Reset the countdown: every change of state or manual move calls this. */
    function arm() {
      disarm();
      if (mayPlay()) {
        timer = window.setTimeout(function () {
          next();
          arm();
        }, holdMs);
      }
    }

    root.addEventListener('mouseenter', function () {
      hovering = true;
      arm();
    });
    root.addEventListener('mouseleave', function () {
      hovering = false;
      arm();
    });
    root.addEventListener('focusin', function () {
      focused = true;
      arm();
    });
    root.addEventListener('focusout', function () {
      // Let focus settle on its next home before deciding it has left.
      window.setTimeout(function () {
        focused = root.contains(document.activeElement);
        arm();
      }, 0);
    });
    document.addEventListener('visibilitychange', arm);
    if (reduceMotion && typeof reduceMotion.addEventListener === 'function') {
      reduceMotion.addEventListener('change', arm);
    }

    // Set the opening frame without animating in from a wrap, then start.
    slides[0].classList.add('is-current');
    slides[0].setAttribute('aria-hidden', 'false');
    for (var j = 1; j < count; j += 1) slides[j].setAttribute('aria-hidden', 'true');
    for (var k = 0; k < dots.length; k += 1) {
      dots[k].setAttribute('aria-current', k === 0 ? 'true' : 'false');
    }
    status.textContent = 'Slide 1 of ' + count;
    arm();
  }

  function init(scope) {
    var root = scope && scope.querySelectorAll ? scope : document;
    var all = root.querySelectorAll('.tgs-slideshow');
    for (var i = 0; i < all.length; i += 1) enhance(all[i]);
  }

  window.TGSitesSlideshow = { version: VERSION, init: init, enhance: enhance };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      init(document);
    });
  } else {
    init(document);
  }
})();
