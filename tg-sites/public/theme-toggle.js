/**
 * tg-sites Light / dark switch, the part a script does.
 *
 * The automatic half of dark mode is pure CSS and needs nothing here: a site
 * that carries a switch follows the visitor's system setting on its own (see the
 * Light / dark rules in globals.css). This file is the manual half, the bit a
 * browser adds ON TOP where a script is allowed to run: it lets the visitor
 * press the switch to override the system, and it remembers that choice.
 *
 * Progressive enhancement. Blocked or slow, the automatic half still works and
 * only the press is missing, so the switch is never a broken control, just an
 * inert one. The flash guard that reads the saved choice before paint is inline
 * in the page (see ThemeToggleScript); this file only handles the press.
 *
 * CSP-CLEAN, like slideshow.js and every widget in this repo. One delegated
 * listener, no inline handlers, no injected script, no eval, no innerHTML.
 *
 * The stored value is 'dark' or 'light' under one key. Absent means automatic,
 * which is the default and is why removing the key is never needed: the switch
 * only ever writes an explicit choice.
 */
(function () {
  'use strict';

  var KEY = 'tgs-theme';
  var root = document.documentElement;

  /* The theme showing right now: an explicit choice if one is set, otherwise
     whatever the system asked for. This is what a press inverts. */
  function current() {
    var set = root.getAttribute('data-theme');
    if (set === 'dark' || set === 'light') return set;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }

  /* Reflect the current theme on every switch, so a screen reader hears whether
     it is on and the sliding knob sits the right side. Run on load too, because
     a page that opened dark automatically starts with the switch already on. */
  function sync() {
    var now = current();
    var buttons = document.querySelectorAll('[data-tg-theme-toggle]');
    for (var i = 0; i < buttons.length; i += 1) {
      buttons[i].setAttribute('aria-pressed', now === 'dark' ? 'true' : 'false');
    }
  }

  function apply(theme) {
    root.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(KEY, theme);
    } catch (e) {
      /* Private mode or a full quota: the theme still flips for this visit, it
         just is not remembered for the next one. Not worth a broken switch. */
    }
    sync();
  }

  document.addEventListener('click', function (event) {
    var target = event.target;
    var button = target && target.closest ? target.closest('[data-tg-theme-toggle]') : null;
    if (!button) return;
    event.preventDefault();
    apply(current() === 'dark' ? 'light' : 'dark');
  });

  sync();
})();
