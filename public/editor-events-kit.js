/**
 * Editor kit — shared behaviour for the ticket widget family.
 *
 * Loaded by editor-tickets, editor-nextevent, editor-clubpicker,
 * editor-ticketsearch, editor-ticketmonth and editor-eventmenu, after
 * editor-shell.js and before the per-editor script.
 *
 * The unified shell owns auth, save, the font picker, tabs, sections and the
 * preview chrome. This kit owns the things all six ticket editors need and the
 * shell has no opinion about:
 *
 *   - one memoised call to the events index, shared across every control
 *   - the source picker, which searches the live feed
 *   - the booking-option list, which reads what the API says can be built
 *   - control binders, so a slider or a switch is three lines instead of ten
 *   - a modal that remembers to add .is-open (see below)
 *
 * It is deliberately NOT a second shell. Nothing here duplicates anything
 * editor-shell.js already does.
 */
(function (global) {
  'use strict';

  var FEED = '/api/events-feed';

  function $(id) { return document.getElementById(id); }

  // ── Data ──────────────────────────────────────────────────────────────────

  var indexPromise = null;

  /**
   * The events index. Every editor wants it (categories, competitions, which
   * booking combinations exist), and several controls want it at once, so it is
   * fetched once. A failure is not cached, so a retry can actually retry.
   */
  function index() {
    if (!indexPromise) {
      indexPromise = fetch(FEED)
        .then(function (r) { if (!r.ok) throw new Error('index ' + r.status); return r.json(); })
        .catch(function (e) { indexPromise = null; throw e; });
    }
    return indexPromise;
  }

  // ── Small helpers ─────────────────────────────────────────────────────────

  /**
   * Two letters for a generated badge.
   *
   * Splits on non-alphanumerics, not whitespace: "MLB - USA" split on spaces
   * leaves the hyphen as a word and the badge reads "M-".
   */
  function initials(name) {
    var words = String(name || '?').replace(/\([^)]*\)/g, ' ').split(/[^A-Za-z0-9]+/)
      .filter(function (w) { return w && !/^(fc|afc|the|of|and)$/i.test(w); });
    if (!words.length) return String(name || '?').slice(0, 2).toUpperCase();
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
  }

  /** FNV-1a, matching the server so a badge keeps its colour everywhere. */
  function hue(key) {
    var h = 0x811c9dc5;
    var s = String(key);
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h % 360;
  }

  function badgeEl(name, h) {
    var el = document.createElement('span');
    el.className = 'result-badge';
    var n = typeof h === 'number' ? h : 210;
    el.style.background = 'hsl(' + n + ' 48% 92%)';
    el.style.color = 'hsl(' + n + ' 62% 34%)';
    el.textContent = initials(name);
    return el;
  }

  function debounce(fn, ms) {
    var t = null;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  // ── Control binders ───────────────────────────────────────────────────────
  //
  // Each takes the config object and a key, mutates it, then calls onChange.
  // The editors pass one onChange that marks dirty and re-renders.

  function controls(cfg, onChange) {
    function bump() { onChange(); }

    return {
      /** Segmented button group. */
      seg: function (id, key, after) {
        var host = $(id);
        if (!host) return;
        host.addEventListener('click', function (e) {
          var btn = e.target.closest('button[data-v]');
          if (!btn) return;
          cfg[key] = btn.getAttribute('data-v');
          var all = host.querySelectorAll('button[data-v]');
          for (var i = 0; i < all.length; i++) all[i].setAttribute('aria-pressed', String(all[i] === btn));
          if (after) after(cfg[key]);
          bump();
        });
      },
      segSync: function (id, value) {
        var host = $(id);
        if (!host) return;
        var all = host.querySelectorAll('button[data-v]');
        for (var i = 0; i < all.length; i++) {
          all[i].setAttribute('aria-pressed', String(all[i].getAttribute('data-v') === value));
        }
      },

      /** iOS-style switch. Kept as a real button with role=switch. */
      toggle: function (id, key, after) {
        var b = $(id);
        if (!b) return;
        b.addEventListener('click', function () {
          cfg[key] = !cfg[key];
          b.classList.toggle('is-on', cfg[key]);
          b.setAttribute('aria-checked', String(cfg[key]));
          if (after) after(cfg[key]);
          bump();
        });
      },
      toggleSync: function (id, on) {
        var b = $(id);
        if (!b) return;
        b.classList.toggle('is-on', !!on);
        b.setAttribute('aria-checked', String(!!on));
      },

      text: function (id, key, after) {
        var el = $(id);
        if (!el) return;
        el.addEventListener('input', function () {
          cfg[key] = el.value;
          if (after) after(el.value);
          bump();
        });
      },

      select: function (id, key, after) {
        var el = $(id);
        if (!el) return;
        el.addEventListener('change', function () {
          cfg[key] = el.value;
          if (after) after(el.value);
          bump();
        });
      },

      number: function (id, key, after) {
        var el = $(id);
        if (!el) return;
        el.addEventListener('change', function () {
          cfg[key] = parseInt(el.value, 10);
          if (after) after(cfg[key]);
          bump();
        });
      },

      slider: function (id, valId, key, fmt) {
        var el = $(id);
        if (!el) return;
        el.addEventListener('input', function () {
          cfg[key] = parseInt(el.value, 10);
          var v = $(valId);
          if (v) v.textContent = fmt ? fmt(cfg[key]) : String(cfg[key]);
          bump();
        });
      },
      sliderSync: function (id, valId, value, fmt) {
        var el = $(id);
        if (el) el.value = value;
        var v = $(valId);
        if (v) v.textContent = fmt ? fmt(value) : String(value);
      },

      /** Colour swatch plus hex field, kept in step both ways. */
      colour: function (swatchId, hexId, key) {
        var sw = $(swatchId);
        var hex = $(hexId);
        if (!sw || !hex) return;
        sw.addEventListener('input', function () {
          cfg[key] = sw.value;
          hex.value = sw.value;
          bump();
        });
        hex.addEventListener('input', function () {
          var v = hex.value.trim();
          // Only a complete hex updates the config. Typing "#0" mid-entry must
          // not blank the preview.
          if (/^#[0-9a-fA-F]{6}$/.test(v)) { cfg[key] = v; sw.value = v; bump(); }
        });
      },
      colourSync: function (swatchId, hexId, value) {
        var sw = $(swatchId);
        var hex = $(hexId);
        if (sw) sw.value = value;
        if (hex) hex.value = value;
      },

      /** Colour pair where a blank hex means "not set" — the standard look. */
      colourOpt: function (swatchId, hexId, key) {
        var sw = $(swatchId);
        var hex = $(hexId);
        if (!sw || !hex) return;
        sw.addEventListener('input', function () {
          cfg[key] = sw.value;
          hex.value = sw.value;
          bump();
        });
        hex.addEventListener('input', function () {
          var v = hex.value.trim();
          if (v === '') { cfg[key] = ''; bump(); return; }
          if (/^#[0-9a-fA-F]{6}$/.test(v)) { cfg[key] = v; sw.value = v; bump(); }
        });
      },
      colourOptSync: function (swatchId, hexId, value) {
        var sw = $(swatchId);
        var hex = $(hexId);
        if (hex) hex.value = value || '';
        if (sw && value) sw.value = value;
      },
    };
  }

  // ── Source picker ─────────────────────────────────────────────────────────

  var PICKER_VIEW = { team: 'teams', venue: 'venues', performer: 'performers' };
  var TYPE_LABEL = { competition: 'Competition', team: 'Club', venue: 'Venue', performer: 'Artist' };

  function needsPicker(t) {
    return t === 'competition' || t === 'team' || t === 'venue' || t === 'performer';
  }

  /**
   * A live search over the feed, in place of a slug field.
   *
   * @param {object} o
   *   @param {function} o.getType   current source type
   *   @param {function} o.getValue  current key
   *   @param {function} o.getLabel  current display name
   *   @param {function} o.onPick    (value, label) => void
   *   @param {function} o.onClear   () => void
   *   @param {string} o.pickedId    element to hold the chosen pill
   *   @param {string} o.searchId    the search input
   *   @param {string} o.resultsId   the results list
   */
  function sourcePicker(o) {
    var seq = 0;

    function note(text) {
      var d = document.createElement('div');
      d.className = 'results-note';
      d.textContent = text;
      return d;
    }

    function row(name, meta, h, onPick) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'result';
      b.appendChild(badgeEl(name, h));
      var body = document.createElement('div');
      body.className = 'result-body';
      var n = document.createElement('div'); n.className = 'result-name'; n.textContent = name;
      var m = document.createElement('div'); m.className = 'result-meta'; m.textContent = meta;
      body.appendChild(n); body.appendChild(m);
      b.appendChild(body);
      b.addEventListener('click', onPick);
      return b;
    }

    function search(term) {
      var box = $(o.resultsId);
      if (!box) return;
      box.textContent = '';
      var type = o.getType();
      if (!needsPicker(type)) return;

      // Competitions are already in the index, so the list is there before the
      // first keystroke rather than after it.
      if (type === 'competition') {
        index().then(function (d) {
          if (o.getType() !== 'competition') return;
          box.textContent = '';
          var t = term.trim().toLowerCase();
          var list = d.competitions.filter(function (c) {
            return !t || (c.label + ' ' + (c.country || '') + ' ' + (c.categoryLabel || '')).toLowerCase().indexOf(t) !== -1;
          }).slice(0, 40);
          if (!list.length) { box.appendChild(note('No competition matches that.')); return; }
          list.forEach(function (c) {
            box.appendChild(row(
              c.label + (c.country ? ' - ' + c.country : ''),
              c.events + (c.events === 1 ? ' event' : ' events') + (c.teams ? ' · ' + c.teams + ' teams' : ''),
              hue(c.slug),
              function () { choose(c.slug, c.label); }
            ));
          });
        }).catch(function () {
          box.textContent = '';
          box.appendChild(note('Could not load competitions.'));
        });
        return;
      }

      var mine = ++seq;
      box.appendChild(note(term ? 'Searching…' : 'Loading…'));
      fetch(FEED + '?view=' + PICKER_VIEW[type] + '&limit=40' + (term ? '&q=' + encodeURIComponent(term) : ''))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (mine !== seq) return;
          box.textContent = '';
          var items = (d && d.items) || [];
          if (!items.length) { box.appendChild(note('Nothing matches that.')); return; }
          items.forEach(function (x) {
            var meta = type === 'team'
              ? x.events + ' games' + (x.homeVenueName ? ' · ' + x.homeVenueName : '')
              : type === 'performer'
                ? x.events + ' dates' + (x.topLocation ? ' · ' + x.topLocation : '')
                : x.events + ' events';
            box.appendChild(row(x.name, meta, x.hue, function () { choose(x.key, x.name); }));
          });
        })
        .catch(function () {
          if (mine !== seq) return;
          box.textContent = '';
          box.appendChild(note('Search failed. Try again.'));
        });
    }

    function choose(value, label) {
      var s = $(o.searchId);
      if (s) s.value = '';
      var box = $(o.resultsId);
      if (box) box.textContent = '';
      o.onPick(value, label);
      showPicked();
    }

    function showPicked() {
      var host = $(o.pickedId);
      if (!host) return;
      host.textContent = '';
      if (!o.getValue() || !needsPicker(o.getType())) return;

      var box = document.createElement('div');
      box.className = 'picked';
      var body = document.createElement('div');
      body.className = 'picked-body';
      var n = document.createElement('div');
      n.className = 'picked-name';
      n.textContent = o.getLabel() || o.getValue();
      var m = document.createElement('div');
      m.className = 'picked-meta';
      m.textContent = TYPE_LABEL[o.getType()] || '';
      body.appendChild(n); body.appendChild(m);

      var clear = document.createElement('button');
      clear.type = 'button';
      clear.textContent = 'Change';
      clear.addEventListener('click', function () {
        o.onClear();
        showPicked();
        var s = $(o.searchId);
        if (s) { s.value = ''; s.focus(); }
        search('');
      });

      box.appendChild(body); box.appendChild(clear);
      host.appendChild(box);
    }

    var s = $(o.searchId);
    if (s) s.addEventListener('input', debounce(function () { search(s.value); }, 250));

    return {
      /** Re-read the config and show the right state. */
      sync: function () {
        showPicked();
        if (needsPicker(o.getType()) && !o.getValue()) search('');
        else { var box = $(o.resultsId); if (box) box.textContent = ''; }
      },
      search: search,
      needsPicker: needsPicker,
    };
  }

  // ── Booking options ───────────────────────────────────────────────────────

  /**
   * List every booking combination the API declares, ticking the ones this
   * widget is set to offer.
   *
   * Combinations without a verified Travelify spec are listed and disabled
   * rather than hidden, so an agent can see what is coming instead of wondering
   * whether we forgot.
   */
  function bookingOptions(hostId, getKinds, setKinds) {
    var host = $(hostId);
    if (!host) return;

    index().then(function (d) {
      var kinds = (d && d.meta && d.meta.bookingKinds) || [{ kind: 'ticket', label: 'Ticket only', ready: true }];
      host.textContent = '';
      kinds.forEach(function (k) {
        var row = document.createElement('label');
        row.className = 'book-opt' + (k.ready ? '' : ' is-pending');

        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = (getKinds() || []).indexOf(k.kind) !== -1;
        cb.disabled = !k.ready;
        cb.addEventListener('change', function () {
          var set = (getKinds() || []).filter(function (x) { return x !== k.kind; });
          if (cb.checked) set.push(k.kind);
          // Keep the declared order, so buttons never reshuffle between events.
          setKinds(kinds.filter(function (dk) { return set.indexOf(dk.kind) !== -1; })
            .map(function (dk) { return dk.kind; }));
        });

        var body = document.createElement('div');
        body.className = 'book-opt-body';
        var n = document.createElement('div');
        n.className = 'book-opt-name';
        n.textContent = k.label;
        if (!k.ready) {
          var pill = document.createElement('span');
          pill.className = 'pending-pill';
          pill.textContent = 'Awaiting spec';
          n.appendChild(pill);
        }
        body.appendChild(n);
        if (!k.ready) {
          var s = document.createElement('div');
          s.className = 'book-opt-note';
          s.textContent = 'Turns on by itself once the Travelify link for this combination is confirmed.';
          body.appendChild(s);
        }

        row.appendChild(cb);
        row.appendChild(body);
        host.appendChild(row);
      });
    }).catch(function () {
      host.textContent = '';
      var d = document.createElement('div');
      d.className = 'field-help';
      d.textContent = 'Could not load the booking options.';
      host.appendChild(d);
    });
  }

  // ── Modal ─────────────────────────────────────────────────────────────────

  var escHandler = null;

  function closeModal() {
    if (escHandler) { document.removeEventListener('keydown', escHandler); escHandler = null; }
    var back = document.querySelector('.tgse-modal');
    if (back) back.remove();
    var t = $('btn-templates');
    if (t) t.focus();
  }

  /**
   * A dialog built from the shell's own classes.
   *
   * The is-open class is not decoration: .tgse-modal ships as opacity:0 with
   * pointer-events:none, so without it the dialog is invisible AND the preview
   * pane behind it swallows every click. That cost an afternoon once.
   */
  function modal(title, bodyEl) {
    closeModal();

    var back = document.createElement('div');
    back.className = 'tgse-modal';
    var card = document.createElement('div');
    card.className = 'tgse-modal-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-label', title);

    var head = document.createElement('div');
    head.className = 'tgse-modal-head';
    head.textContent = title;

    var inner = document.createElement('div');
    inner.className = 'tgse-modal-body';
    inner.appendChild(bodyEl);

    var foot = document.createElement('div');
    foot.className = 'tgse-modal-foot';
    var close = document.createElement('button');
    close.className = 'tgse-btn';
    close.type = 'button';
    close.textContent = 'Close';
    close.addEventListener('click', closeModal);
    foot.appendChild(close);

    card.appendChild(head); card.appendChild(inner); card.appendChild(foot);
    back.appendChild(card);
    back.addEventListener('click', function (e) { if (e.target === back) closeModal(); });

    escHandler = function (e) { if (e.key === 'Escape') closeModal(); };
    document.addEventListener('keydown', escHandler);

    document.body.appendChild(back);
    // Next frame, so the shell's opacity transition actually runs.
    requestAnimationFrame(function () { back.classList.add('is-open'); });
    close.focus();
  }

  /** The standard Templates list. `apply` receives the chosen template's cfg. */
  function templates(list, apply) {
    var body = document.createElement('div');
    body.className = 'tpl-list';
    list.forEach(function (t) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'tpl-card';
      var n = document.createElement('div'); n.className = 'tpl-name'; n.textContent = t.name;
      var d = document.createElement('div'); d.className = 'tpl-desc'; d.textContent = t.desc;
      b.appendChild(n); b.appendChild(d);
      b.addEventListener('click', function () { apply(t.cfg); closeModal(); });
      body.appendChild(b);
    });
    modal('Templates', body);
  }

  // ── Boot helper ───────────────────────────────────────────────────────────

  /**
   * The standard editor boot.
   *
   * Never calls tgse.isLoggedIn() synchronously: the shell's cookie SSO check is
   * async, and a sync read hands a blank page to anyone arriving already signed
   * in. Every editor in this family boots through here so none of them can get
   * that wrong independently.
   */
  function boot(opts) {
    document.addEventListener('DOMContentLoaded', function () {
      if (opts.wire) opts.wire();
      var go = function () {
        if (global.tgse && typeof tgse.onReady === 'function') {
          tgse.onReady(function () {
            if (tgse.isLoggedIn()) opts.load();
            else { if (opts.ready) opts.ready(); }
          });
        } else if (global.tgse && tgse.isLoggedIn()) {
          opts.load();
        } else if (opts.ready) {
          opts.ready();
        }
      };
      if (opts.prefetch) opts.prefetch().then(go).catch(go);
      else go();
    });
  }

  /** Load a saved widget config by ?id=, or fall straight through. */
  function loadSaved(cfg, onDone) {
    var wId = new URLSearchParams(location.search).get('id');
    if (!wId) { onDone(); return; }
    fetch('/api/widget-config?id=' + encodeURIComponent(wId))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (d && d.config) Object.assign(cfg, d.config);
        var n = $('name-input');
        if (d && d.name && n) n.value = d.name;
        onDone();
      })
      .catch(function () {
        if (global.tgse) tgse.toast('Failed to load widget', 'err');
        onDone();
      });
  }

  global.TGEditorKit = {
    FEED: FEED,
    index: index,
    controls: controls,
    sourcePicker: sourcePicker,
    bookingOptions: bookingOptions,
    modal: modal,
    closeModal: closeModal,
    templates: templates,
    boot: boot,
    loadSaved: loadSaved,
    initials: initials,
    hue: hue,
    badgeEl: badgeEl,
    debounce: debounce,
    needsPicker: needsPicker,
  };
}(window));
