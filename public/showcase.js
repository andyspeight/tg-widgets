/**
 * Travelgenix Showcase v1.0.0
 * Self-guided product showcase for a large touch screen.
 *
 * Reads window.TG_SHOWCASE (see showcase-data.js) and renders, per product,
 * a device stage with numbered hotspots over the real UI plus a feature rail.
 * Tapping a hotspot or a rail row opens the same detail sheet, so the screen
 * works whether someone pokes the phone or reads down the list.
 *
 * Built for a stand: no network call after load, no text entry, an attract
 * loop when nobody is touching it, and an idle reset so the next visitor
 * always starts from the top.
 *
 * CSP-clean: no inline handlers, no injected script, no eval. All screen
 * markup is authored in showcase-data.js and never built from input.
 */
(function () {
  'use strict';

  var VERSION = '1.0.0';
  var IDLE_MS = 90000;          /* back to attract after 90s untouched */
  var PHONE_W = 390, PHONE_H = 844;
  var SPOT_MIN_GAP = 58;        /* px between hotspot dots before nudging */

  var data = window.TG_SHOWCASE;
  if (!data || !data.products || !data.products.length) return;

  var els = {};
  var state = { product: null, screen: 0, open: -1, seen: Object.create(null) };
  var idleTimer = null;

  /* ---------------------------------------------------------------- *
   * Small helpers
   * ---------------------------------------------------------------- */

  function $(sel) { return document.querySelector(sel); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function icon(paths, size) {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '2');
    s.setAttribute('stroke-linecap', 'round');
    s.setAttribute('stroke-linejoin', 'round');
    s.setAttribute('aria-hidden', 'true');
    if (size) { s.setAttribute('width', size); s.setAttribute('height', size); }
    s.innerHTML = paths;
    return s;
  }
  var ICON_X = '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>';
  var ICON_HOME = '<path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>';
  var ICON_SUN = '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.2" y1="4.2" x2="5.6" y2="5.6"/><line x1="18.4" y1="18.4" x2="19.8" y2="19.8"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.2" y1="19.8" x2="5.6" y2="18.4"/><line x1="18.4" y1="5.6" x2="19.8" y2="4.2"/>';

  /* ---------------------------------------------------------------- *
   * Idle handling
   * ---------------------------------------------------------------- */

  function poke() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(toAttract, IDLE_MS);
  }
  function stopIdle() { if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; } }

  /* ---------------------------------------------------------------- *
   * Attract
   * ---------------------------------------------------------------- */

  function toAttract() {
    stopIdle();
    state.product = null; state.screen = 0; state.open = -1;
    state.seen = Object.create(null);
    els.view.hidden = true;
    els.attract.hidden = false;
    els.crumb.hidden = true;
    els.home.hidden = true;
    els.attractCta.focus({ preventScroll: true });
  }

  function buildAttract() {
    var a = el('div', 'tg-attract');
    a.appendChild(el('span', 'tg-attract-badge', 'Travelgenix'));
    a.appendChild(el('h1', null, 'See what your clients would see'));
    a.appendChild(el('p', null,
      'Tap a product, then tap any numbered dot on the screen to find out what it does ' +
      'and why it matters. Take as long as you like.'));

    var cta = el('button', 'tg-attract-cta');
    cta.type = 'button';
    cta.appendChild(document.createTextNode(
      data.products.length === 1 ? 'Explore ' + data.products[0].name : 'Start exploring'));
    cta.addEventListener('click', start);
    a.appendChild(cta);
    els.attractCta = cta;

    a.appendChild(el('span', 'tg-attract-tick', 'Touch the screen to begin'));
    a.addEventListener('click', function (e) { if (e.target === a) start(); });
    return a;
  }

  function start() {
    openProduct(data.products[0]);
  }

  /* ---------------------------------------------------------------- *
   * Product view
   * ---------------------------------------------------------------- */

  function openProduct(p) {
    state.product = p;
    state.screen = 0;
    state.open = -1;
    state.seen = Object.create(null);

    els.attract.hidden = true;
    els.view.hidden = false;
    els.crumb.hidden = false;
    els.home.hidden = false;
    els.crumbName.textContent = p.name;
    els.crumbMeta.textContent = p.category + ' · ' + p.status + ' ' + p.version;

    els.eyebrow.textContent = p.category;
    els.title.textContent = p.name;
    els.lede.textContent = p.summary;

    /* screen chips */
    els.screens.textContent = '';
    p.screens.forEach(function (s, i) {
      var b = el('button', 'tg-screenbtn', s.name);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
      b.addEventListener('click', function () { showScreen(i); });
      els.screens.appendChild(b);
    });

    /* QR */
    if (p.qr) {
      els.qr.hidden = false;
      els.qrImg.src = '/showcase/qr/' + p.id + '.svg';
      els.qrImg.alt = 'QR code linking to ' + p.qr.url;
      els.qrHead.textContent = p.qr.heading;
      els.qrNote.textContent = p.qr.note;
    } else {
      els.qr.hidden = true;
    }

    showScreen(0);
    poke();
  }

  function showScreen(i) {
    var p = state.product;
    if (!p) return;
    state.screen = i;
    state.open = -1;
    closeSheet();

    Array.prototype.forEach.call(els.screens.children, function (b, n) {
      b.setAttribute('aria-selected', n === i ? 'true' : 'false');
    });

    var s = p.screens[i];
    els.phoneScreen.className = 'tg-phone-screen lt';
    els.phoneScreen.innerHTML = s.html;

    buildFeatureList(s);
    /* Two frames: let the new markup lay out before measuring it. */
    requestAnimationFrame(function () { requestAnimationFrame(layout); });
    poke();
  }

  function seenKey(si, hi) { return si + ':' + hi; }

  function buildFeatureList(s) {
    els.feats.textContent = '';
    els.feats.scrollTop = 0;

    var lede = el('p', 'tg-feats-lede',
      s.blurb + '  ' + s.hotspots.length + ' things to look at on this screen.');
    els.feats.appendChild(lede);

    s.hotspots.forEach(function (h, i) {
      var row = el('button', 'tg-feat');
      row.type = 'button';
      row.setAttribute('aria-expanded', 'false');
      var bodyId = 'tg-feat-body-' + i;
      row.setAttribute('aria-controls', bodyId);
      row.appendChild(el('span', 'tg-feat-n', String(i + 1)));
      row.appendChild(el('span', 'tg-feat-t', h.title));

      var body = el('div', 'tg-feat-body');
      body.id = bodyId;
      body.hidden = true;
      body.appendChild(el('h4', null, 'What it does'));
      body.appendChild(el('p', null, h.feature));
      body.appendChild(el('h4', null, 'Why it matters'));
      body.appendChild(el('p', null, h.benefit));
      if (h.edge) {
        var edge = el('div', 'tg-feat-edge');
        edge.appendChild(el('b', null, 'The edge. '));
        edge.appendChild(document.createTextNode(h.edge));
        body.appendChild(edge);
      }

      row.addEventListener('click', function () {
        toggle(i, true);
      });

      els.feats.appendChild(row);
      els.feats.appendChild(body);
    });
  }

  /* ---------------------------------------------------------------- *
   * Hotspots
   * ---------------------------------------------------------------- */

  function layout() {
    var box = els.stage.getBoundingClientRect();
    var pad = 24;
    var availW = Math.max(120, box.width - pad * 2);
    var availH = Math.max(120, box.height - pad * 2);
    var scale = Math.min(availW / PHONE_W, availH / PHONE_H);

    els.fitbox.style.width = (PHONE_W * scale) + 'px';
    els.fitbox.style.height = (PHONE_H * scale) + 'px';
    els.phone.style.transform = 'scale(' + scale + ')';
    els.spots.style.width = (PHONE_W * scale) + 'px';
    els.spots.style.height = (PHONE_H * scale) + 'px';

    /* The phone is narrow and the stage is not, so when there is room the
       detail panel sits BESIDE the phone. Covering the screen someone just
       tapped is the one thing a hotspot demo must not do. */
    var sideGap = (box.width - PHONE_W * scale) / 2 - 40;
    if (sideGap >= 300) {
      els.stage.classList.add('is-side');
      els.stage.style.setProperty('--sheet-w', Math.min(460, sideGap) + 'px');
    } else {
      els.stage.classList.remove('is-side');
    }

    placeSpots();
  }

  function placeSpots() {
    var p = state.product;
    if (!p) return;
    var s = p.screens[state.screen];
    els.spots.textContent = '';

    var boxRect = els.fitbox.getBoundingClientRect();
    var placed = [];

    s.hotspots.forEach(function (h, i) {
      var target = els.phoneScreen.querySelector('[data-hs="' + h.anchor + '"]');
      if (!target) return;           /* anchor gone: the rail still carries it */
      var r = target.getBoundingClientRect();
      if (!r.width && !r.height) return;

      /* The dot sits ON a corner of its element, half over and half off,
         so it clearly belongs to that element without covering it. Per
         hotspot `at` picks the corner; top-right is the default. */
      var at = h.at || 'top-right';
      var x, y;
      if (at === 'center') {
        x = r.left + r.width / 2;
        y = r.top + r.height / 2;
      } else if (at === 'outside-right' || at === 'outside-left') {
        /* For a narrow centred element, a corner dot lands on the last
           word. These put it clear of the box altogether. */
        x = at === 'outside-left' ? r.left - 30 : r.right + 30;
        y = r.top + r.height / 2;
      } else {
        x = at.indexOf('left') > -1 ? r.left : r.right;
        y = at.indexOf('bottom') > -1 ? r.bottom : r.top;
      }
      x -= boxRect.left;
      y -= boxRect.top;

      /* Nudge apart anything that would sit on top of another dot. */
      for (var pass = 0; pass < 12; pass++) {
        var hit = false;
        for (var j = 0; j < placed.length; j++) {
          var dx = x - placed[j].x, dy = y - placed[j].y;
          var d = Math.sqrt(dx * dx + dy * dy);
          if (d < SPOT_MIN_GAP) {
            hit = true;
            if (d < 0.5) { y += SPOT_MIN_GAP; }
            else { y += (dy >= 0 ? 1 : -1) * (SPOT_MIN_GAP - d); }
          }
        }
        if (!hit) break;
      }
      x = Math.max(30, Math.min(boxRect.width - 30, x));
      y = Math.max(30, Math.min(boxRect.height - 30, y));
      placed.push({ x: x, y: y });

      var dot = el('button', 'tg-spot', String(i + 1));
      dot.type = 'button';
      dot.style.left = x + 'px';
      dot.style.top = y + 'px';
      dot.setAttribute('aria-label', 'Feature ' + (i + 1) + ': ' + h.title);
      if (state.seen[seenKey(state.screen, i)]) dot.classList.add('is-seen');
      if (state.open === i) dot.classList.add('is-open');
      dot.addEventListener('click', function () { toggle(i); });
      els.spots.appendChild(dot);
    });
  }

  /* ---------------------------------------------------------------- *
   * Detail sheet
   * ---------------------------------------------------------------- */

  function toggle(i, fromRail) {
    if (state.open === i) { closeSheet(); state.open = -1; syncMarks(); poke(); return; }
    openHotspot(i, fromRail);
  }

  function openHotspot(i, fromRail) {
    var p = state.product;
    if (!p) return;
    var s = p.screens[state.screen];
    var h = s.hotspots[i];
    if (!h) return;

    state.open = i;
    state.seen[seenKey(state.screen, i)] = true;

    els.sheetN.textContent = String(i + 1);
    els.sheetTitle.textContent = h.title;

    els.sheetBody.textContent = '';
    els.sheetBody.appendChild(el('h4', null, 'What it does'));
    els.sheetBody.appendChild(el('p', null, h.feature));
    els.sheetBody.appendChild(el('h4', null, 'Why it matters'));
    els.sheetBody.appendChild(el('p', null, h.benefit));
    if (h.edge) {
      var edge = el('div', 'tg-feat-edge');
      edge.appendChild(el('b', null, 'The edge. '));
      edge.appendChild(document.createTextNode(h.edge));
      els.sheetBody.appendChild(edge);
    }

    els.prev.disabled = i === 0;
    els.next.textContent = i === s.hotspots.length - 1 ? 'Done' : 'Next';
    /* Tapping the list opens it in the list; tapping a dot opens the panel.
       Showing the same words in both places at once just reads as a bug. */
    els.sheet.hidden = !!fromRail;

    var row = els.feats.querySelectorAll('.tg-feat')[i];
    if (row) {
      row.setAttribute('aria-expanded', fromRail ? 'true' : 'false');
      var body = document.getElementById(row.getAttribute('aria-controls'));
      if (body) body.hidden = !fromRail;
      row.scrollIntoView({ block: 'nearest' });
    }
    syncMarks();
    poke();
  }

  function closeSheet() {
    els.sheet.hidden = true;
    Array.prototype.forEach.call(els.feats.querySelectorAll('.tg-feat'), function (r) {
      r.setAttribute('aria-expanded', 'false');
      var b = document.getElementById(r.getAttribute('aria-controls'));
      if (b) b.hidden = true;
    });
  }

  function syncMarks() {
    Array.prototype.forEach.call(els.spots.children, function (dot, i) {
      dot.classList.toggle('is-open', state.open === i);
      dot.classList.toggle('is-seen', !!state.seen[seenKey(state.screen, i)]);
    });
    Array.prototype.forEach.call(els.feats.querySelectorAll('.tg-feat'), function (r, i) {
      r.classList.toggle('is-seen', !!state.seen[seenKey(state.screen, i)]);
      r.classList.toggle('is-active', state.open === i);
    });
  }

  function step(delta) {
    var s = state.product.screens[state.screen];
    var n = state.open + delta;
    if (n < 0) return;
    if (n >= s.hotspots.length) {
      closeSheet(); state.open = -1; syncMarks();
      if (state.screen < state.product.screens.length - 1) showScreen(state.screen + 1);
      return;
    }
    openHotspot(n);
  }

  /* ---------------------------------------------------------------- *
   * Build the shell
   * ---------------------------------------------------------------- */

  function build() {
    var app = el('div', 'tg-app');

    /* top bar */
    var top = el('header', 'tg-topbar');
    var logo = el('div', 'tg-logo');
    logo.appendChild(document.createTextNode('Travel'));
    logo.appendChild(el('span', null, 'genix'));
    top.appendChild(logo);

    var crumb = el('div', 'tg-crumb');
    crumb.hidden = true;
    var cn = el('b', null, ''), cm = el('span', null, '');
    crumb.appendChild(cn); crumb.appendChild(cm);
    top.appendChild(crumb);
    els.crumb = crumb; els.crumbName = cn; els.crumbMeta = cm;

    top.appendChild(el('div', 'tg-topbar-sp'));

    var home = el('button', 'tg-iconbtn');
    home.type = 'button';
    home.hidden = true;
    home.appendChild(icon(ICON_HOME));
    home.appendChild(document.createTextNode('Start over'));
    home.addEventListener('click', toAttract);
    top.appendChild(home);
    els.home = home;

    var theme = el('button', 'tg-iconbtn');
    theme.type = 'button';
    theme.setAttribute('aria-label', 'Switch between light and dark');
    theme.appendChild(icon(ICON_SUN));
    theme.addEventListener('click', function () {
      var dark = document.documentElement.getAttribute('data-theme') === 'dark';
      document.documentElement.setAttribute('data-theme', dark ? 'light' : 'dark');
      poke();
    });
    top.appendChild(theme);
    app.appendChild(top);

    /* main */
    var main = el('main', 'tg-main');

    var attract = buildAttract();
    main.appendChild(attract);
    els.attract = attract;

    var view = el('div', 'tg-view');
    view.hidden = true;

    /* stage */
    var stage = el('section', 'tg-stage');
    stage.setAttribute('aria-label', 'Product screen with feature hotspots');
    var fitbox = el('div', 'tg-fitbox');
    var phone = el('div', 'tg-phone');
    var notch = el('div', 'tg-phone-notch');
    var pscreen = el('div', 'tg-phone-screen lt');
    phone.appendChild(pscreen);
    phone.appendChild(notch);
    fitbox.appendChild(phone);
    var spots = el('div', 'tg-spots');
    fitbox.appendChild(spots);
    stage.appendChild(fitbox);

    /* sheet */
    var sheet = el('div', 'tg-sheet');
    sheet.hidden = true;
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-live', 'polite');
    var sh = el('div', 'tg-sheet-h');
    var sn = el('span', 'tg-sheet-n', '1');
    var st = el('h3', null, '');
    var sx = el('button', 'tg-sheet-x');
    sx.type = 'button';
    sx.setAttribute('aria-label', 'Close');
    sx.appendChild(icon(ICON_X));
    sx.addEventListener('click', function () { closeSheet(); state.open = -1; syncMarks(); poke(); });
    sh.appendChild(sn); sh.appendChild(st); sh.appendChild(sx);
    sheet.appendChild(sh);
    var sb = el('div', 'tg-sheet-b');
    sheet.appendChild(sb);
    var nav = el('div', 'tg-sheet-nav');
    var prev = el('button', null, 'Back');
    prev.type = 'button';
    prev.addEventListener('click', function () { step(-1); });
    var next = el('button', 'tg-next', 'Next');
    next.type = 'button';
    next.addEventListener('click', function () { step(1); });
    nav.appendChild(prev); nav.appendChild(next);
    sheet.appendChild(nav);
    stage.appendChild(sheet);

    view.appendChild(stage);
    els.stage = stage; els.fitbox = fitbox; els.phone = phone;
    els.phoneScreen = pscreen; els.spots = spots;
    els.sheet = sheet; els.sheetN = sn; els.sheetTitle = st; els.sheetBody = sb;
    els.prev = prev; els.next = next;

    /* rail */
    var rail = el('aside', 'tg-rail');
    var head = el('div', 'tg-rail-head');
    var eyebrow = el('span', 'tg-eyebrow', '');
    var h2 = el('h2', null, '');
    var lede = el('p', null, '');
    head.appendChild(eyebrow); head.appendChild(h2); head.appendChild(lede);
    rail.appendChild(head);

    var screens = el('div', 'tg-screens');
    screens.setAttribute('role', 'tablist');
    screens.setAttribute('aria-label', 'Screens');
    rail.appendChild(screens);

    var feats = el('div', 'tg-feats');
    rail.appendChild(feats);

    var qr = el('div', 'tg-qr');
    var qrImg = el('img');
    qrImg.width = 124; qrImg.height = 124; qrImg.decoding = 'async';
    var qrC = el('div', 'tg-qr-c');
    var qrHead = el('b', null, '');
    var qrNote = el('p', null, '');
    qrC.appendChild(qrHead); qrC.appendChild(qrNote);
    qr.appendChild(qrImg); qr.appendChild(qrC);
    rail.appendChild(qr);

    view.appendChild(rail);
    main.appendChild(view);
    app.appendChild(main);

    els.view = view; els.eyebrow = eyebrow; els.title = h2; els.lede = lede;
    els.screens = screens; els.feats = feats;
    els.qr = qr; els.qrImg = qrImg; els.qrHead = qrHead; els.qrNote = qrNote;

    document.body.appendChild(app);
  }

  /* ---------------------------------------------------------------- *
   * Boot
   * ---------------------------------------------------------------- */

  function init() {
    if (window.__TG_SHOWCASE_BOOTED__) return;
    window.__TG_SHOWCASE_BOOTED__ = true;

    build();
    toAttract();

    if (window.ResizeObserver) {
      new ResizeObserver(function () { if (!els.view.hidden) layout(); }).observe(els.stage);
    }
    window.addEventListener('orientationchange', function () { setTimeout(layout, 120); });
    window.addEventListener('resize', function () { if (!els.view.hidden) layout(); });

    ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(function (evt) {
      document.addEventListener(evt, poke, { passive: true });
    });

    document.addEventListener('keydown', function (e) {
      if (els.view.hidden) return;
      if (e.key === 'Escape') { closeSheet(); state.open = -1; syncMarks(); }
      else if (e.key === 'ArrowRight' && state.open > -1) step(1);
      else if (e.key === 'ArrowLeft' && state.open > -1) step(-1);
    });

    window.__TG_SHOWCASE_VERSION__ = VERSION;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.TGShowcase = { version: VERSION, open: openProduct, attract: toAttract };
})();
