/**
 * Travelgenix Showcase v2.0.0
 * A walk through the product, for a touch screen.
 *
 * The first version put a caption, a device, a product summary, a chip row,
 * a 39-item list and a QR code on screen at once, with ten pulsing markers
 * on a phone the size of a postcard. It read as a debug overlay. This one
 * shows the screen, spotlights the one part of it being described, and puts
 * the words beside it. The list and the QR are one tap away.
 *
 * Navigation is a single index across the whole product, so "next" always
 * means the next thing worth seeing and changes screen when it needs to.
 *
 * Built for a stand: no network call after load, no text entry, it plays
 * itself when left alone, and any touch hands control over.
 *
 * CSP-clean: no inline handlers, no injected script, no eval.
 */
(function () {
  'use strict';

  var VERSION = '2.0.0';
  var NARROW_PX = 820;        /* keep in step with showcase.css */
  var PHONE_W = 390, PHONE_H = 844;
  var PIN_GAP = 42;
  var IDLE_MS = 90000;
  var ATTRACT_MS = 20000;
  var DWELL_BASE = 2400, DWELL_PER_WORD = 58, DWELL_MIN = 5200, DWELL_MAX = 13000;

  var data = window.TG_SHOWCASE;
  if (!data || !data.products || !data.products.length) return;

  var el = {};
  var st = {
    product: null, list: [], i: -1, screen: -1,
    seen: Object.create(null),
    tour: { on: false, paused: false, timer: null, dwell: 0, at: 0, used: 0 }
  };
  var idleTimer = null, attractTimer = null;

  /* ---------------------------------------------------------------- *
   * helpers
   * ---------------------------------------------------------------- */

  function n(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function svg(d) {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '1.75');
    s.setAttribute('stroke-linecap', 'round');
    s.setAttribute('stroke-linejoin', 'round');
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML = d;
    return s;
  }
  var I = {
    play:  '<polygon points="7 4 19 12 7 20"/>',
    pause: '<rect x="7" y="5" width="3.5" height="14" rx="1"/><rect x="13.5" y="5" width="3.5" height="14" rx="1"/>',
    next:  '<polyline points="9 6 15 12 9 18"/>',
    back:  '<polyline points="15 6 9 12 15 18"/>',
    list:  '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
    x:     '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    sun:   '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.2" y1="4.2" x2="5.6" y2="5.6"/><line x1="18.4" y1="18.4" x2="19.8" y2="19.8"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.2" y1="19.8" x2="5.6" y2="18.4"/><line x1="18.4" y1="5.6" x2="19.8" y2="4.2"/>',
    /* A house says "home". Four tiles says "all of them", which is what is
       on the other side of it. */
    grid:  '<rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/>' +
           '<rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/>' +
           '<rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/>' +
           '<rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/>'
  };
  function narrow() { return window.innerWidth <= NARROW_PX; }

  /* ---------------------------------------------------------------- *
   * idle and attract
   * ---------------------------------------------------------------- */

  function poke() {
    if (idleTimer) clearTimeout(idleTimer);
    /* A playing walkthrough is the screen doing its job, not an idle one. */
    if (st.tour.on && !st.tour.paused) { idleTimer = null; return; }
    idleTimer = setTimeout(toSplash, IDLE_MS);
  }
  function stopIdle() { if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; } }

  function onInput(e) {
    if (e && e.target && e.target.closest && e.target.closest('[data-ctl]')) { poke(); return; }
    if (st.tour.on && !st.tour.paused) tourPause();
    if (!el.attract.hidden || !el.splash.hidden) armAttract();
    poke();
  }

  /* Nobody is standing here. Play something, so the stand is never a still
     picture waiting to be touched. From the chooser that means the first
     product; from a product's own front door it means that product. */
  function armAttract() {
    if (attractTimer) clearTimeout(attractTimer);
    attractTimer = setTimeout(function () {
      if (!el.splash.hidden) { open(data.products[0]); tourStart(0); return; }
      if (!el.attract.hidden) { open(st.pick || data.products[0]); tourStart(0); }
    }, ATTRACT_MS);
  }
  function disarmAttract() { if (attractTimer) { clearTimeout(attractTimer); attractTimer = null; } }

  /* Our own paths, checked anyway before one goes near a style. */
  function imgUrl(path) {
    return /^\/showcase\/img\/[a-z0-9-]+\.webp$/.test(path || '')
      ? 'url("' + path + '")' : '';
  }

  function clearScreens() {
    stopIdle(); tourStop();
    st.product = null; st.i = -1; st.screen = -1; st.seen = Object.create(null);
    el.scene.hidden = true;
    el.end.hidden = true;
    el.contents.hidden = true;
    el.crumb.hidden = true;
    el.contentsBtn.hidden = true;
  }

  /* The chooser. One tile per product, which with a single product is the
     shelf rather than the shop, and that is the point of building it now. */
  function toSplash() {
    clearScreens();
    el.attract.hidden = true;
    el.splash.hidden = false;
    el.restartBtn.hidden = true;        /* this IS the start */
    armAttract();
  }

  /* A product's own front door: its picture, and the choice of being shown
     round or poking about. */
  function toAttract(p) {
    p = p || st.pick || data.products[0];
    clearScreens();
    st.pick = p;
    el.splash.hidden = true;
    el.attract.hidden = false;
    el.restartBtn.hidden = false;       /* a way back to the chooser */
    el.attractKicker.textContent = 'Travelgenix \u00b7 ' + p.name;
    var bg = imgUrl(p.splash);
    if (bg) el.attractBg.style.backgroundImage = bg;
    armAttract();
    el.attractCta.focus({ preventScroll: true });
  }

  /* ---------------------------------------------------------------- *
   * opening a product
   * ---------------------------------------------------------------- */

  /* One flat walk across every screen. "Next" then always means the next
     thing worth seeing, and changes screen by itself when it runs out. */
  function flatten(p) {
    var out = [];
    p.screens.forEach(function (s, si) {
      s.hotspots.forEach(function (h, hi) {
        out.push({ screen: si, spot: hi, h: h, chapter: s.name });
      });
    });
    return out;
  }

  function open(p) {
    disarmAttract();
    st.product = p;
    st.list = flatten(p);
    st.i = -1; st.screen = -1;
    st.seen = Object.create(null);

    el.splash.hidden = true;     /* the walk can start straight off the chooser */
    el.attract.hidden = true;
    el.end.hidden = true;
    el.scene.hidden = false;
    el.crumb.hidden = false;
    el.contentsBtn.hidden = false;
    el.restartBtn.hidden = false;
    el.crumbName.textContent = p.name;
    el.crumbMeta.textContent = p.category + ' · ' + p.status + ' ' + p.version;

    goTo(0);
    poke();
  }

  /* The basemap is ours and it is one file, so there is nothing to negotiate
     with: draw it as soon as it decodes. Offline we do not draw it at all. The
     soft map stays and the badge stops being a claim and becomes a demo, which
     is the whole point of that screen. */
  var BASEMAP = '/showcase/img/world.webp';
  var basemap = null;   /* null not asked, 'asking', true ready, false no */

  function liveMap(root) {
    var map = root.querySelector('.lt-map');
    if (!map) return;
    if (basemap === true) { map.classList.add('is-live'); return; }
    if (basemap !== null) return;                     /* asking, or already refused */
    if (navigator.onLine === false) { basemap = false; return; }
    basemap = 'asking';
    var img = new Image();
    img.addEventListener('load', function () {
      basemap = true;
      var live = el.screen.querySelector('.lt-map');  /* the screen may have moved on */
      if (live) live.classList.add('is-live');
    });
    img.addEventListener('error', function () { basemap = false; });
    img.src = BASEMAP;
  }

  /* A show floor loses its wifi and gets it back. Let the next map try again. */
  window.addEventListener('online', function () { if (basemap === false) basemap = null; });

  function goTo(i) {
    var p = st.product;
    if (!p) return;
    if (i < 0) return;
    if (i >= st.list.length) { finish(); return; }

    st.i = i;
    st.seen[i] = true;
    var item = st.list[i];

    if (st.screen !== item.screen) {
      st.screen = item.screen;
      el.screen.className = 'tg-screen lt';
      el.screen.innerHTML = p.screens[item.screen].html;
      el.screen.appendChild(el.spot);   /* innerHTML just removed it */
      liveMap(el.screen);
      caption(item);
      /* Two frames for the new markup to lay out, then measure it. */
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { layout(); paint(); });
      });
    } else {
      caption(item);
      paint();
    }
    poke();
  }

  function caption(item) {
    var h = item.h;
    el.capChapter.textContent = item.chapter;
    el.capCount.textContent = (st.i + 1) + ' of ' + st.list.length;
    el.capTitle.textContent = h.title;

    el.capBody.textContent = '';
    /* Two plain paragraphs: what they see, then what it is worth. Labelling
       them "What it does" and "Why it matters" is what made this read as a
       spec sheet rather than a pitch. */
    el.capBody.appendChild(n('p', 'tg-cap-lead', h.feature));
    el.capBody.appendChild(n('p', null, h.benefit));
    if (h.edge) {
      var e = n('div', 'tg-edge');
      e.appendChild(n('b', null, 'The edge. '));
      e.appendChild(document.createTextNode(h.edge));
      el.capBody.appendChild(e);
    }

    el.railFill.style.transform = 'scaleX(' + ((st.i + 1) / st.list.length) + ')';
    el.back.disabled = st.i === 0;
    el.nextLabel.textContent = st.i === st.list.length - 1 ? 'Finish' : 'Next';
    el.capBody.scrollTop = 0;
  }

  /* ---------------------------------------------------------------- *
   * the device
   * ---------------------------------------------------------------- */

  /* The first used track size, in pixels, or 0 if the grid is not laid out. */
  function track(v) {
    var one = parseFloat(String(v || '').split(' ')[0]);
    return one > 0 ? one : 0;
  }

  function layout() {
    var box = el.deck.getBoundingClientRect();
    var avail = el.scene.getBoundingClientRect();
    var cs = window.getComputedStyle(el.scene);
    var padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);

    /* The scene is a grid: the device beside the caption in landscape, above it
       in portrait. Ask the grid how big the device's own cell is rather than
       handing it the whole scene, which is what pushed the phone off the top
       of a portrait kiosk. Chrome reports used track sizes in pixels; anything
       else (display:block on a phone, or the scene still hidden) parses to
       nothing and we fall back to measuring. */
    var w = track(cs.gridTemplateColumns) || box.width || avail.width;
    var h = track(cs.gridTemplateRows) || (avail.height - padY);
    /* On a phone the page scrolls, so the device is sized by WIDTH only and
       never magnified past 1:1. Sizing by height there is what shrank it to
       a third of size in the first build. */
    var scale = narrow()
      ? Math.min(w / PHONE_W, 1)
      /* Capped: a phone drawn 2x life size stops reading as a phone. */
      : Math.min(w / PHONE_W, Math.max(240, h) / PHONE_H, 1.5);
    st.scale = scale;

    el.fit.style.width = (PHONE_W * scale) + 'px';
    el.fit.style.height = (PHONE_H * scale) + 'px';
    el.phone.style.transform = 'scale(' + scale + ')';
    el.pins.style.width = (PHONE_W * scale) + 'px';
    el.pins.style.height = (PHONE_H * scale) + 'px';
  }

  function anchorPoint(r, at, box) {
    var x, y;
    if (at === 'center') { x = r.left + r.width / 2; y = r.top + r.height / 2; }
    else if (at === 'outside-right') { x = r.right + 26; y = r.top + r.height / 2; }
    else if (at === 'outside-left') { x = r.left - 26; y = r.top + r.height / 2; }
    else {
      x = at.indexOf('left') > -1 ? r.left : r.right;
      y = at.indexOf('bottom') > -1 ? r.bottom : r.top;
    }
    return { x: x - box.left, y: y - box.top };
  }

  /* Draw the markers for this screen and put the spotlight on the live one. */
  function paint() {
    var p = st.product;
    if (!p || st.screen < 0) return;
    var scr = p.screens[st.screen];
    var here = st.list[st.i];
    var box = el.fit.getBoundingClientRect();

    el.pins.textContent = '';
    var placed = [];
    var liveTarget = null;

    scr.hotspots.forEach(function (h, hi) {
      var t = el.screen.querySelector('[data-hs="' + h.anchor + '"]');
      if (!t) return;
      var r = t.getBoundingClientRect();
      if (!r.width && !r.height) return;

      var live = here && here.screen === st.screen && here.spot === hi;
      if (live) liveTarget = { el: t, r: r };

      var x, y;
      if (live) {
        /* Beside the hole, on whichever side has room. */
        var cy = r.top + r.height / 2 - box.top;
        var rightRoom = box.width - (r.right - box.left);
        var leftRoom = r.left - box.left;
        if (rightRoom >= 76) x = (r.right - box.left) + 38;
        else if (leftRoom >= 76) x = (r.left - box.left) - 38;
        else { x = (r.left + r.width / 2) - box.left; cy = (r.bottom - box.top) + 38; }
        y = cy;
      } else {
        var pt = anchorPoint(r, h.at || 'top-right', box);
        x = pt.x; y = pt.y;
      }
      for (var pass = 0; pass < 10; pass++) {
        var hit = false;
        for (var j = 0; j < placed.length; j++) {
          var dx = x - placed[j].x, dy = y - placed[j].y;
          var d = Math.sqrt(dx * dx + dy * dy);
          if (d < PIN_GAP) { hit = true; y += (dy >= 0 ? 1 : -1) * (PIN_GAP - d) || PIN_GAP; }
        }
        if (!hit) break;
      }
      x = Math.max(28, Math.min(box.width - 28, x));
      y = Math.max(28, Math.min(box.height - 28, y));
      placed.push({ x: x, y: y });

      /* The index in the whole walk, so tapping a marker lands you at the
         right place in the sequence rather than a parallel numbering. */
      var gi = globalIndex(st.screen, hi);
      var pin = n('button', 'tg-pin', String(gi + 1));
      pin.type = 'button';
      pin.style.left = x + 'px';
      pin.style.top = y + 'px';
      pin.setAttribute('aria-label', h.title);
      if (live) pin.classList.add('is-live');
      else if (st.seen[gi]) pin.classList.add('is-done');
      pin.addEventListener('click', function () { tourPause(); goTo(gi); });
      el.pins.appendChild(pin);
    });

    spotlight(liveTarget);
    if (narrow()) requestAnimationFrame(revealLive);
  }

  function globalIndex(screen, spot) {
    for (var i = 0; i < st.list.length; i++) {
      if (st.list[i].screen === screen && st.list[i].spot === spot) return i;
    }
    return 0;
  }

  /* A hole in a scrim, sitting exactly on the element being described.
     It lives inside the screen, which clips it to the rounded device, so its
     coordinates are device pixels: divide the measured rect by the scale the
     device is being drawn at. */
  function spotlight(target) {
    var s = el.spot;
    if (!target) { s.classList.remove('is-on'); return; }
    var sr = el.screen.getBoundingClientRect();
    var k = st.scale || 1;
    var pad = 7;
    s.style.left = ((target.r.left - sr.left) / k - pad) + 'px';
    s.style.top = ((target.r.top - sr.top) / k - pad) + 'px';
    s.style.width = (target.r.width / k + pad * 2) + 'px';
    s.style.height = (target.r.height / k + pad * 2) + 'px';
    s.classList.add('is-on');
  }

  /* On a phone the caption covers the bottom, so the live marker has to be
     put in the strip still visible above it. */
  function revealLive() {
    var pin = el.pins.querySelector('.tg-pin.is-live');
    if (!pin) return;
    var barH = el.topbar.getBoundingClientRect().height;
    var capTop = el.caption.getBoundingClientRect().top;
    var band = capTop - barH;
    if (band < 90) return;
    var r = pin.getBoundingClientRect();
    var delta = (r.top + r.height / 2) - (barH + band / 2);
    if (Math.abs(delta) < 6) return;
    window.scrollBy({ top: delta, behavior: 'smooth' });
  }

  /* ---------------------------------------------------------------- *
   * stepping and the walkthrough
   * ---------------------------------------------------------------- */

  function next() { goTo(st.i + 1); }
  function prev() { if (st.i > 0) goTo(st.i - 1); }

  function dwellFor(h) {
    var words = (h.title + ' ' + h.feature + ' ' + h.benefit + ' ' + (h.edge || '')).split(/\s+/).length;
    return Math.max(DWELL_MIN, Math.min(DWELL_MAX, DWELL_BASE + words * DWELL_PER_WORD));
  }

  function tourStart(from) {
    if (!st.product) return;
    st.tour.on = true; st.tour.paused = false;
    stopIdle();
    if (typeof from === 'number') goTo(from);
    tourArm();
    chrome();
  }
  function tourStop() {
    if (st.tour.timer) { clearTimeout(st.tour.timer); st.tour.timer = null; }
    st.tour.on = false; st.tour.paused = false; st.tour.used = 0;
    chrome();
  }
  function tourPause() {
    var t = st.tour;
    if (!t.on || t.paused) return;
    if (t.timer) { clearTimeout(t.timer); t.timer = null; }
    t.used += Date.now() - t.at;
    t.paused = true;
    chrome(); poke();
  }
  function tourResume() {
    var t = st.tour;
    if (!t.on) { tourStart(); return; }
    if (!t.paused) return;
    t.paused = false; stopIdle();
    var left = Math.max(1500, t.dwell - t.used);
    t.at = Date.now();
    t.timer = setTimeout(function () { tourNext(); }, left);
    chrome();
  }
  function tourToggle() { (st.tour.on && !st.tour.paused) ? tourPause() : tourResume(); }

  function tourArm() {
    var t = st.tour;
    var item = st.list[st.i];
    if (!item) return;
    t.dwell = dwellFor(item.h);
    t.used = 0;
    t.at = Date.now();
    if (t.timer) clearTimeout(t.timer);
    t.timer = setTimeout(function () { tourNext(); }, t.dwell);
    stopIdle();
  }
  function tourNext() {
    if (st.i + 1 >= st.list.length) { finish(); return; }
    goTo(st.i + 1);
    if (st.tour.on && !st.tour.paused) tourArm();
  }

  function chrome() {
    var playing = st.tour.on && !st.tour.paused;
    el.play.classList.toggle('is-live', playing);
    el.play.setAttribute('aria-pressed', playing ? 'true' : 'false');
    el.play.setAttribute('aria-label', playing ? 'Pause the walkthrough' : 'Play the walkthrough');
    el.playIcon.textContent = '';
    el.playIcon.appendChild(svg(playing ? I.pause : I.play));
  }

  /* ---------------------------------------------------------------- *
   * contents and the ending
   * ---------------------------------------------------------------- */

  function openContents() {
    var p = st.product;
    if (!p) return;
    tourPause();
    el.chapters.textContent = '';
    p.screens.forEach(function (s, si) {
      var first = globalIndex(si, 0);
      var row = n('button', 'tg-chapter');
      row.type = 'button';
      if (si === st.screen) row.classList.add('is-here');
      row.appendChild(n('span', 'tg-chapter-n', String(si + 1).padStart(2, '0')));
      row.appendChild(n('span', 'tg-chapter-t', s.name));
      row.appendChild(n('span', 'tg-chapter-c', s.hotspots.length + ' points'));
      row.appendChild(n('span', 'tg-chapter-b', s.blurb));
      row.addEventListener('click', function () { closeContents(); goTo(first); });
      el.chapters.appendChild(row);
    });
    el.contents.hidden = false;
    poke();
  }
  function closeContents() { el.contents.hidden = true; poke(); }

  function finish() {
    tourStop();
    var p = st.product;
    el.endTitle.textContent = 'That is ' + (p ? p.name : 'the product');
    el.endBlurb.textContent = p && p.qr ? p.qr.note : '';
    if (p && p.qr) {
      el.qrImg.src = '/showcase/qr/' + p.id + '.svg';
      el.qrImg.alt = 'QR code linking to ' + p.qr.url;
      el.qrNote.textContent = p.qr.heading;
      el.qr.hidden = false;
    } else { el.qr.hidden = true; }
    el.end.hidden = false;
    poke();
  }

  /* How long a product takes to watch, from the same dwell model the walk
     itself uses, so the tile cannot drift away from the truth. */
  function sizeOf(p) {
    var spots = 0, ms = 0;
    p.screens.forEach(function (s) {
      spots += s.hotspots.length;
      s.hotspots.forEach(function (h) { ms += dwellFor(h); });
    });
    return p.screens.length + ' screens \u00b7 ' + spots + ' points \u00b7 about ' +
      Math.max(1, Math.round(ms / 60000)) + ' minutes';
  }

  function tileFor(p) {
    var b = n('button', 'tg-tile');
    b.type = 'button';
    var art = n('span', 'tg-tile-art');
    var url = imgUrl(p.tile);
    if (url) art.style.backgroundImage = url;
    b.appendChild(art);
    var body = n('span', 'tg-tile-body');
    body.appendChild(n('span', 'tg-tile-meta',
      p.category + ' \u00b7 ' + p.status + ' ' + p.version));
    body.appendChild(n('strong', null, p.name));
    body.appendChild(n('span', 'tg-tile-line', p.tagline));
    body.appendChild(n('span', 'tg-tile-foot', sizeOf(p)));
    b.appendChild(body);
    b.addEventListener('click', function () { disarmAttract(); toAttract(p); });
    return b;
  }

  /* ---------------------------------------------------------------- *
   * shell
   * ---------------------------------------------------------------- */

  function build() {
    var app = n('div', 'tg-app');

    /* top bar */
    var top = n('header', 'tg-topbar');
    var brand = n('div', 'tg-brand');
    var logo = n('div', 'tg-logo');
    logo.appendChild(document.createTextNode('Travel'));
    logo.appendChild(n('span', null, 'genix'));
    brand.appendChild(logo);
    var crumb = n('div', 'tg-crumb');
    crumb.hidden = true;
    var cn = n('b', null, ''), cm = n('span', null, '');
    crumb.appendChild(cn); crumb.appendChild(document.createTextNode(' '));
    crumb.appendChild(cm);
    brand.appendChild(crumb);
    top.appendChild(brand);
    top.appendChild(n('div', 'tg-spacer'));

    var restart = n('button', 'tg-btn');
    restart.type = 'button';
    restart.hidden = true;
    /* It went to the chooser already, but "Start over" reads as restarting the
       walk you are standing in, so nobody would press it to leave. */
    restart.setAttribute('aria-label', 'All walkthroughs');
    restart.appendChild(svg(I.grid));
    restart.appendChild(n('span', 'tg-btn-label', 'All walkthroughs'));
    restart.addEventListener('click', function () { toSplash(); });
    top.appendChild(restart);

    var contentsBtn = n('button', 'tg-btn');
    contentsBtn.type = 'button';
    contentsBtn.hidden = true;
    contentsBtn.setAttribute('aria-label', 'Contents');
    contentsBtn.appendChild(svg(I.list));
    contentsBtn.appendChild(n('span', 'tg-btn-label', 'Contents'));
    contentsBtn.addEventListener('click', openContents);
    top.appendChild(contentsBtn);

    var theme = n('button', 'tg-btn tg-btn--icon');
    theme.type = 'button';
    theme.setAttribute('aria-label', 'Switch between light and dark');
    theme.appendChild(svg(I.sun));
    theme.addEventListener('click', function () {
      var dark = document.documentElement.getAttribute('data-theme') === 'dark';
      document.documentElement.setAttribute('data-theme', dark ? 'light' : 'dark');
      poke();
    });
    top.appendChild(theme);
    app.appendChild(top);
    el.topbar = top; el.crumb = crumb; el.crumbName = cn; el.crumbMeta = cm;
    el.contentsBtn = contentsBtn; el.restartBtn = restart;

    /* scene */
    var scene = n('main', 'tg-scene');
    scene.hidden = true;

    var deck = n('div', 'tg-deck');
    var fit = n('div', 'tg-fit');
    var phone = n('div', 'tg-phone');
    var screen = n('div', 'tg-screen lt');
    phone.appendChild(screen);
    phone.appendChild(n('div', 'tg-notch'));
    fit.appendChild(phone);
    var spot = n('div', 'tg-spotlight');
    screen.appendChild(spot);
    var pins = n('div', 'tg-pins');
    fit.appendChild(pins);
    deck.appendChild(fit);
    scene.appendChild(deck);
    el.deck = deck; el.fit = fit; el.phone = phone; el.screen = screen;
    el.spot = spot; el.pins = pins;

    var cap = n('section', 'tg-caption');
    cap.setAttribute('aria-live', 'polite');
    var meta = n('div', 'tg-cap-meta');
    var chap = n('span', 'tg-cap-chapter', '');
    var count = n('span', 'tg-cap-count', '');
    meta.appendChild(chap);
    meta.appendChild(n('i', null, '—'));
    meta.appendChild(count);
    cap.appendChild(meta);
    var title = n('h1', 'tg-cap-title', '');
    cap.appendChild(title);
    var body = n('div', 'tg-cap-body');
    cap.appendChild(body);

    var foot = n('div', 'tg-cap-foot');
    var rail = n('div', 'tg-rail');
    var fill = n('span', 'tg-rail-fill');
    rail.appendChild(fill);
    foot.appendChild(rail);
    var ctrls = n('div', 'tg-controls');
    var back = n('button', 'tg-ctl');
    back.type = 'button';
    back.setAttribute('aria-label', 'Previous');
    back.appendChild(svg(I.back));
    back.addEventListener('click', function () { tourPause(); prev(); });
    var play = n('button', 'tg-ctl');
    play.type = 'button';
    play.setAttribute('data-ctl', '');
    var playIcon = n('span', 'tg-play-ico');
    playIcon.appendChild(svg(I.play));
    play.appendChild(playIcon);
    play.addEventListener('click', tourToggle);
    var nextBtn = n('button', 'tg-next');
    nextBtn.type = 'button';
    var nextLabel = n('span', null, 'Next');
    nextBtn.appendChild(nextLabel);
    nextBtn.appendChild(svg(I.next));
    nextBtn.addEventListener('click', function () { tourPause(); next(); });
    ctrls.appendChild(back); ctrls.appendChild(play); ctrls.appendChild(nextBtn);
    foot.appendChild(ctrls);
    cap.appendChild(foot);
    scene.appendChild(cap);
    app.appendChild(scene);

    el.scene = scene; el.caption = cap; el.capChapter = chap; el.capCount = count;
    el.capTitle = title; el.capBody = body; el.railFill = fill;
    el.back = back; el.play = play; el.playIcon = playIcon; el.nextLabel = nextLabel;

    /* attract */
    var att = n('div', 'tg-attract');
    var attBg = n('span', 'tg-attract-bg');        /* its own box, so it can drift */
    att.appendChild(attBg);
    var attIn = n('div', 'tg-attract-in');
    var attKicker = n('span', 'tg-kicker', 'Travelgenix');
    attIn.appendChild(attKicker);
    attIn.appendChild(n('h1', null, 'See what your clients would see'));
    attIn.appendChild(n('p', null,
      'A walk through the app your travellers would carry, one feature at a time.'));
    var ctas = n('div', 'tg-attract-ctas');
    var goTour = n('button', 'tg-cta');
    goTour.type = 'button';
    goTour.setAttribute('data-ctl', '');
    goTour.appendChild(svg(I.play));
    goTour.appendChild(document.createTextNode('Show me round'));
    goTour.addEventListener('click', function () { disarmAttract(); open(st.pick || data.products[0]); tourStart(); });
    var goSelf = n('button', 'tg-cta tg-cta--quiet');
    goSelf.type = 'button';
    goSelf.appendChild(document.createTextNode('Explore it myself'));
    goSelf.addEventListener('click', function () { disarmAttract(); open(st.pick || data.products[0]); });
    ctas.appendChild(goTour); ctas.appendChild(goSelf);
    attIn.appendChild(ctas);
    attIn.appendChild(n('span', 'tg-attract-note',
      'It plays on its own. Touch anything to take over.'));
    att.appendChild(attIn);
    app.appendChild(att);
    el.attract = att; el.attractCta = goTour;
    el.attractBg = attBg; el.attractKicker = attKicker;

    /* splash: which walkthrough */
    var splash = n('div', 'tg-splash');
    var spIn = n('div', 'tg-splash-in');
    spIn.appendChild(n('span', 'tg-kicker', 'Travelgenix'));
    spIn.appendChild(n('h1', null, 'Discover what we build'));
    spIn.appendChild(n('p', null,
      'Each one is the real product, one feature at a time. They play themselves, ' +
      'or you can take one at your own pace.'));
    var tiles = n('div', 'tg-tiles');
    data.products.forEach(function (p) { tiles.appendChild(tileFor(p)); });
    spIn.appendChild(tiles);
    splash.appendChild(spIn);
    app.appendChild(splash);
    el.splash = splash;


    /* contents */
    var sheet = n('div', 'tg-sheet');
    sheet.hidden = true;
    var sHead = n('div', 'tg-sheet-head');
    sHead.appendChild(n('h2', null, 'Contents'));
    var sClose = n('button', 'tg-btn tg-btn--icon');
    sClose.type = 'button';
    sClose.setAttribute('aria-label', 'Close contents');
    sClose.appendChild(svg(I.x));
    sClose.addEventListener('click', closeContents);
    sHead.appendChild(sClose);
    sheet.appendChild(sHead);
    var sBody = n('div', 'tg-sheet-body');
    var chapters = n('div', 'tg-chapters');
    sBody.appendChild(chapters);
    sheet.appendChild(sBody);
    app.appendChild(sheet);
    el.contents = sheet; el.chapters = chapters;

    /* ending */
    var end = n('div', 'tg-end');
    end.hidden = true;
    var endIn = n('div', 'tg-end-in');
    var endCopy = n('div');
    var endTitle = n('h2', null, '');
    var endBlurb = n('p', null, '');
    endCopy.appendChild(endTitle); endCopy.appendChild(endBlurb);
    var endCtas = n('div', 'tg-end-ctas');
    var again = n('button', 'tg-cta');
    again.type = 'button';
    again.appendChild(svg(I.play));
    again.appendChild(document.createTextNode('Watch it again'));
    again.addEventListener('click', function () { el.end.hidden = true; goTo(0); tourStart(); });
    var browse = n('button', 'tg-cta tg-cta--quiet');
    browse.type = 'button';
    /* The ending covers the top bar, so it carries its own way back. */
    browse.appendChild(document.createTextNode('All walkthroughs'));
    browse.addEventListener('click', function () { toSplash(); });
    endCtas.appendChild(again); endCtas.appendChild(browse);
    endCopy.appendChild(endCtas);
    endIn.appendChild(endCopy);
    var qr = n('div', 'tg-qr');
    var qrImg = n('img');
    qrImg.decoding = 'async';
    var qrNote = n('span', null, '');
    qr.appendChild(qrImg); qr.appendChild(qrNote);
    endIn.appendChild(qr);
    end.appendChild(endIn);
    app.appendChild(end);
    el.end = end; el.endTitle = endTitle; el.endBlurb = endBlurb;
    el.qr = qr; el.qrImg = qrImg; el.qrNote = qrNote;

    document.body.appendChild(app);
  }

  /* ---------------------------------------------------------------- *
   * boot
   * ---------------------------------------------------------------- */

  function relayout() {
    if (el.scene.hidden) return;
    layout();
    paint();
  }

  function init() {
    if (window.__TG_SHOWCASE_BOOTED__) return;
    window.__TG_SHOWCASE_BOOTED__ = true;

    build();
    toSplash();
    chrome();

    if (window.ResizeObserver) {
      var ro = new ResizeObserver(function () { relayout(); });
      ro.observe(el.scene);
    }
    window.addEventListener('resize', relayout);
    window.addEventListener('orientationchange', function () { setTimeout(relayout, 150); });

    ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(function (ev) {
      document.addEventListener(ev, onInput, { passive: true });
    });

    document.addEventListener('keydown', function (e) {
      if (!el.contents.hidden && e.key === 'Escape') { closeContents(); return; }
      if (el.scene.hidden) return;
      if (e.key === 'ArrowRight') { tourPause(); next(); }
      else if (e.key === 'ArrowLeft') { tourPause(); prev(); }
      else if ((e.key === ' ' || e.key === 'Spacebar') &&
               !(e.target && e.target.closest && e.target.closest('button'))) {
        e.preventDefault(); tourToggle();
      }
    });

    window.__TG_SHOWCASE_VERSION__ = VERSION;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.TGShowcase = {
    version: VERSION,
    open: open,
    splash: toSplash,
    attract: toAttract,
    goTo: goTo,
    playTour: tourStart,
    pauseTour: tourPause,
    stopTour: tourStop,
    state: function () {
      return { i: st.i, of: st.list.length, screen: st.screen,
               tour: { on: st.tour.on, paused: st.tour.paused } };
    }
  };
})();
