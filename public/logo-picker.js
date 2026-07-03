/**
 * Travelgenix Logo Library — picker + upload/edit.
 *
 * The shared library now lives inside tg-widgets (/api/logo-library); this
 * replaces the picker the editors used to load from the retired
 * tg-logo-library app, keeping the same contract:
 *
 *   window.LogoPicker.open({
 *     onSelect(brand),       // { id, name, domain, category, assets, preferredUrl }
 *     mode: 'library'        // or 'upload' to jump straight to the upload editor
 *   })
 *
 * Upload flow: choose/drop/paste an image → edit on a canvas (Smart cutout
 * via the vendored @imgly/background-removal bundle, flat-background
 * removal, trim + padding, output size) → name it → it is published to the
 * shared library (visible to every client instantly — locked decision
 * 3 Jul 2026) and handed back through onSelect.
 *
 * The AI cutout is fully self-hosted: the vendored bundle
 * (@imgly/background-removal 1.4.5) and its matching model + wasm data live
 * under /vendor/bg-removal/, so no third-party CDN is involved. (The first
 * attempt used the 1.7.0 bundle with imgly's CDN default, which pointed at
 * a data version the CDN does not hold — the cutout failed for exactly that
 * pairing reason. Version-matched and self-hosted kills the whole class.)
 * If anything still fails, the flat-background removal works regardless and
 * the error now names its cause.
 */
(function () {
  'use strict';
  if (window.LogoPicker) return;

  var API = '/api/logo-library';
  var BG_REMOVAL_SRC = '/vendor/bg-removal/index.mjs';
  var CATEGORIES = ['Suppliers', 'Accreditations', 'Airlines', 'Cruise lines', 'Hotels', 'Tourist boards', 'Payment & trust', 'Other'];
  var MAX_INPUT_DIM = 1600;   // incoming images larger than this are scaled down before editing
  var OUTPUT_DIMS = [240, 480, 800];

  var cache = null, cacheAt = 0;
  var root = null, st = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c];
    });
  }
  function authHeaders() {
    if (window.tgse && typeof window.tgse.authHeaders === 'function') return window.tgse.authHeaders();
    return { 'Content-Type': 'application/json' };
  }

  /* ── data ─────────────────────────────────────────────────────────── */

  function fetchBrands(force) {
    if (!force && cache && (Date.now() - cacheAt) < 5 * 60 * 1000) return Promise.resolve(cache);
    return fetch(API, { headers: authHeaders(), credentials: 'include' })
      .then(function (r) { if (!r.ok) throw new Error('library HTTP ' + r.status); return r.json(); })
      .then(function (d) {
        cache = Array.isArray(d.brands) ? d.brands : [];
        cacheAt = Date.now();
        return cache;
      });
  }

  /* ── modal shell ──────────────────────────────────────────────────── */

  function open(opts) {
    opts = opts || {};
    close();
    st = {
      onSelect: typeof opts.onSelect === 'function' ? opts.onSelect : function () {},
      view: opts.mode === 'upload' ? 'upload' : 'library',
      q: '', cat: '',
      src: null,        // original canvas (as loaded)
      work: null,       // working canvas the tools mutate
      tol: 24, pad: 6, outDim: 480,
      busy: '',
    };
    root = document.createElement('div');
    root.className = 'tglp-overlay';
    root.addEventListener('click', function (e) { if (e.target === root) close(); });
    document.body.appendChild(root);
    document.addEventListener('keydown', onKey);
    document.addEventListener('paste', onPaste);
    render();
    if (st.view === 'library') loadLibrary();
  }

  function close() {
    if (root && root.parentNode) root.parentNode.removeChild(root);
    root = null; st = null;
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('paste', onPaste);
  }

  function onKey(e) { if (e.key === 'Escape') close(); }
  function onPaste(e) {
    if (!st || st.view !== 'upload' || st.work) return;
    var items = (e.clipboardData && e.clipboardData.items) || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].type && items[i].type.indexOf('image/') === 0) {
        var f = items[i].getAsFile();
        if (f) { loadFile(f); e.preventDefault(); return; }
      }
    }
  }

  function h(html) { var d = document.createElement('div'); d.innerHTML = html; return d.firstElementChild; }
  function $id(id) { return root ? root.querySelector('#' + id) : null; }

  /* ── render ───────────────────────────────────────────────────────── */

  function render() {
    if (!root || !st) return;
    var isLib = st.view === 'library';
    root.innerHTML =
      '<div class="tglp-card" role="dialog" aria-modal="true" aria-label="Logo library">' +
        '<div class="tglp-head">' +
          '<h2>' + (isLib ? 'Logo library' : 'Upload a logo') + '</h2>' +
          (isLib
            ? '<button class="tglp-btn tglp-btn--primary" id="tglp-to-upload">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>' +
                'Upload a logo</button>'
            : '<button class="tglp-btn" id="tglp-to-library">Browse library</button>') +
          '<button class="tglp-x" id="tglp-close" aria-label="Close">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
          '</button>' +
        '</div>' +
        '<div class="tglp-body" id="tglp-body"></div>' +
        (isLib ? '' :
        '<div class="tglp-foot">' +
          '<span class="tglp-hint">Uploads join the shared library for every client.</span>' +
          '<button class="tglp-btn" id="tglp-cancel">Cancel</button>' +
          '<button class="tglp-btn tglp-btn--primary" id="tglp-publish" disabled>Add to library &amp; use</button>' +
        '</div>') +
      '</div>';
    $id('tglp-close').addEventListener('click', close);
    if (isLib) {
      $id('tglp-to-upload').addEventListener('click', function () { st.view = 'upload'; render(); });
      renderLibraryBody();
    } else {
      $id('tglp-to-library').addEventListener('click', function () { st.view = 'library'; st.src = null; st.work = null; render(); loadLibrary(); });
      $id('tglp-cancel').addEventListener('click', close);
      $id('tglp-publish').addEventListener('click', publish);
      renderUploadBody();
    }
  }

  /* ── library view ─────────────────────────────────────────────────── */

  function loadLibrary() {
    var body = $id('tglp-body');
    if (body) body.innerHTML = '<div class="tglp-empty">Loading the library…</div>';
    fetchBrands().then(function () { renderLibraryBody(); })
      .catch(function () {
        var b = $id('tglp-body');
        if (b) b.innerHTML = '<div class="tglp-err">Could not load the logo library. Check you are signed in, then try again.</div>';
      });
  }

  function renderLibraryBody() {
    var body = $id('tglp-body');
    if (!body || !st) return;
    var brands = cache || [];
    var cats = [];
    brands.forEach(function (b) { if (b.category && cats.indexOf(b.category) === -1) cats.push(b.category); });
    cats.sort();

    var q = st.q.toLowerCase();
    var shown = brands.filter(function (b) {
      if (st.cat && (b.category || '') !== st.cat) return false;
      if (q && String(b.name || '').toLowerCase().indexOf(q) === -1 && String(b.domain || '').toLowerCase().indexOf(q) === -1) return false;
      return true;
    });

    body.innerHTML =
      '<div class="tglp-tools">' +
        '<input type="search" class="tglp-search" id="tglp-q" placeholder="Search logos…" value="' + esc(st.q) + '" />' +
      '</div>' +
      (cats.length ?
      '<div class="tglp-cats">' +
        '<button class="tglp-cat" data-cat="" aria-pressed="' + (!st.cat) + '">All</button>' +
        cats.map(function (c) {
          return '<button class="tglp-cat" data-cat="' + esc(c) + '" aria-pressed="' + (st.cat === c) + '">' + esc(c) + '</button>';
        }).join('') +
      '</div>' : '') +
      (shown.length ?
      '<div class="tglp-grid">' +
        shown.map(function (b, i) {
          return '<div class="tglp-tile" data-i="' + i + '" role="button" tabindex="0" aria-label="Use ' + esc(b.name) + '">' +
            (b.canDelete ? '<button class="tglp-tile-del" data-del="' + esc(b.id) + '" title="Remove from library" aria-label="Remove ' + esc(b.name) + '">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>' : '') +
            '<div class="tglp-tile-img"><img src="' + esc(b.preferredUrl) + '" alt="" loading="lazy" /></div>' +
            '<div class="tglp-tile-name">' + esc(b.name) + '</div>' +
            (b.category ? '<div class="tglp-tile-cat">' + esc(b.category) + '</div>' : '') +
          '</div>';
        }).join('') +
      '</div>'
      : '<div class="tglp-empty">' + (brands.length ? 'Nothing matches that search.' : 'The library is empty so far — upload the first logo.') + '</div>');

    var lastShown = shown;
    $id('tglp-q').addEventListener('input', function (e) { st.q = e.target.value; renderLibraryBody(); refocusSearch(); });
    body.querySelectorAll('.tglp-cat').forEach(function (btn) {
      btn.addEventListener('click', function () { st.cat = btn.getAttribute('data-cat'); renderLibraryBody(); });
    });
    body.querySelectorAll('.tglp-tile').forEach(function (tile) {
      var pick = function () {
        var b = lastShown[parseInt(tile.getAttribute('data-i'), 10)];
        if (!b) return;
        var cb = st.onSelect;
        close();
        cb(b);
      };
      tile.addEventListener('click', function (e) {
        if (e.target.closest('[data-del]')) return;
        pick();
      });
      tile.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    });
    body.querySelectorAll('[data-del]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-del');
        var b = (cache || []).find(function (x) { return x.id === id; });
        if (!b || !confirm('Remove "' + b.name + '" from the shared library for everyone?')) return;
        fetch(API + '?id=' + encodeURIComponent(id), { method: 'DELETE', headers: authHeaders(), credentials: 'include' })
          .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; }); })
          .then(function (out) {
            if (!out.ok) { alert((out.d && out.d.message) || 'Could not remove that logo.'); return; }
            cache = (cache || []).filter(function (x) { return x.id !== id; });
            renderLibraryBody();
          })
          .catch(function () { alert('Could not remove that logo — network error.'); });
      });
    });

    function refocusSearch() {
      var q2 = $id('tglp-q');
      if (q2) { q2.focus(); var v = q2.value; q2.value = ''; q2.value = v; }
    }
  }

  /* ── upload / edit view ───────────────────────────────────────────── */

  function renderUploadBody() {
    var body = $id('tglp-body');
    if (!body || !st) return;

    if (!st.work) {
      body.innerHTML =
        '<div id="tglp-uperr"></div>' +
        '<div class="tglp-drop" id="tglp-drop" role="button" tabindex="0">' +
          '<strong>Choose an image, or drag it here</strong>' +
          '<span>PNG, JPG, WebP or SVG. You can also paste a copied image.</span>' +
        '</div>' +
        '<input type="file" id="tglp-file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden />';
      var drop = $id('tglp-drop'), file = $id('tglp-file');
      drop.addEventListener('click', function () { file.click(); });
      drop.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } });
      drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('is-over'); });
      drop.addEventListener('dragleave', function () { drop.classList.remove('is-over'); });
      drop.addEventListener('drop', function (e) {
        e.preventDefault(); drop.classList.remove('is-over');
        var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) loadFile(f);
      });
      file.addEventListener('change', function (e) { if (e.target.files[0]) loadFile(e.target.files[0]); e.target.value = ''; });
      return;
    }

    body.innerHTML =
      '<div id="tglp-uperr"></div>' +
      '<div class="tglp-editor">' +
        '<div>' +
          '<div class="tglp-stage" id="tglp-stage"></div>' +
          '<div class="tglp-busy" id="tglp-busy"></div>' +
        '</div>' +
        '<div class="tglp-side">' +
          '<div class="tglp-toolrow">' +
            '<button class="tglp-tool tglp-tool--wide" id="tglp-ai">Smart cutout (AI)</button>' +
            '<button class="tglp-tool" id="tglp-flood">Remove background</button>' +
            '<button class="tglp-tool" id="tglp-trim">Trim edges</button>' +
            '<button class="tglp-tool tglp-tool--wide" id="tglp-reset">Reset to original</button>' +
          '</div>' +
          '<div class="tglp-field"><label for="tglp-tol">Background match (for Remove background)</label>' +
            '<div class="tglp-sliderrow"><input type="range" id="tglp-tol" min="4" max="80" step="2" value="' + st.tol + '" /><span class="tglp-sliderval" id="tglp-tolval">' + st.tol + '</span></div>' +
          '</div>' +
          '<div class="tglp-field"><label for="tglp-pad">Padding after trim (%)</label>' +
            '<div class="tglp-sliderrow"><input type="range" id="tglp-pad" min="0" max="20" step="1" value="' + st.pad + '" /><span class="tglp-sliderval" id="tglp-padval">' + st.pad + '</span></div>' +
          '</div>' +
          '<div class="tglp-field"><label for="tglp-dim">Output size (longest side)</label>' +
            '<select id="tglp-dim">' + OUTPUT_DIMS.map(function (d) {
              return '<option value="' + d + '"' + (d === st.outDim ? ' selected' : '') + '>' + d + 'px</option>';
            }).join('') + '</select>' +
          '</div>' +
          '<div class="tglp-field"><label for="tglp-name">Name</label>' +
            '<input type="text" id="tglp-name" maxlength="80" placeholder="e.g. Jet2holidays" /></div>' +
          '<div class="tglp-field"><label for="tglp-cat2">Category</label>' +
            '<input type="text" id="tglp-cat2" maxlength="40" list="tglp-catlist" placeholder="e.g. Suppliers" />' +
            '<datalist id="tglp-catlist">' + CATEGORIES.map(function (c) { return '<option value="' + esc(c) + '">'; }).join('') + '</datalist>' +
          '</div>' +
          '<div class="tglp-field"><label for="tglp-site">Website (optional)</label>' +
            '<input type="text" id="tglp-site" maxlength="200" placeholder="e.g. jet2holidays.com" /></div>' +
        '</div>' +
      '</div>';

    $id('tglp-stage').appendChild(st.work);
    $id('tglp-ai').addEventListener('click', smartCutout);
    $id('tglp-flood').addEventListener('click', function () { floodClear(); });
    $id('tglp-trim').addEventListener('click', function () { trimPad(); });
    $id('tglp-reset').addEventListener('click', function () { setWork(copyCanvas(st.src)); });
    $id('tglp-tol').addEventListener('input', function (e) { st.tol = parseInt(e.target.value, 10); $id('tglp-tolval').textContent = st.tol; });
    $id('tglp-pad').addEventListener('input', function (e) { st.pad = parseInt(e.target.value, 10); $id('tglp-padval').textContent = st.pad; });
    $id('tglp-dim').addEventListener('change', function (e) { st.outDim = parseInt(e.target.value, 10); });
    $id('tglp-name').addEventListener('input', syncPublish);
    syncPublish();
  }

  function upErr(msg) {
    var el = $id('tglp-uperr');
    if (el) el.innerHTML = msg ? '<div class="tglp-err">' + esc(msg) + '</div>' : '';
  }
  function setBusy(msg) {
    if (st) st.busy = msg;
    var el = $id('tglp-busy');
    if (el) el.innerHTML = msg ? '<span class="tglp-spin"></span>' + esc(msg) : '';
    var ai = $id('tglp-ai');
    if (ai) ai.disabled = !!msg;
    var pub = $id('tglp-publish');
    if (pub && msg) pub.disabled = true; else syncPublish();
  }
  function syncPublish() {
    var pub = $id('tglp-publish');
    var name = $id('tglp-name');
    if (pub) pub.disabled = !(st && st.work && name && name.value.trim()) || !!(st && st.busy);
  }

  function loadFile(file) {
    if (!file || !/^image\//.test(file.type)) { upErr('That file is not an image.'); return; }
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var w = img.naturalWidth || img.width, h2 = img.naturalHeight || img.height;
        if (!w || !h2) { w = w || 400; h2 = h2 || 400; } // SVGs can report no intrinsic size
        var scale = Math.min(1, MAX_INPUT_DIM / Math.max(w, h2));
        var c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(w * scale));
        c.height = Math.max(1, Math.round(h2 * scale));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        st.src = c;
        setWork(copyCanvas(c));
        // Pre-fill the name from the filename (tidied) as a starting point.
        var base = String(file.name || '').replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim();
        renderUploadBody();
        var nm = $id('tglp-name');
        if (nm && base && !nm.value) { nm.value = base.slice(0, 80); syncPublish(); }
      };
      img.onerror = function () { upErr('Could not read that image.'); };
      img.src = reader.result;
    };
    reader.onerror = function () { upErr('Could not read that file.'); };
    reader.readAsDataURL(file);
  }

  function copyCanvas(c) {
    var out = document.createElement('canvas');
    out.width = c.width; out.height = c.height;
    out.getContext('2d').drawImage(c, 0, 0);
    return out;
  }
  function setWork(c) {
    st.work = c;
    var stage = $id('tglp-stage');
    if (stage) { stage.innerHTML = ''; stage.appendChild(c); }
    syncPublish();
  }

  /* Flat-background removal: clear every pixel connected to the image edge
     whose colour is within tolerance of the corner background samples, then
     feather the fringe one pass so edges don't halo on dark sites. */
  function floodClear() {
    var c = st.work, w = c.width, hgt = c.height;
    var ctx = c.getContext('2d');
    var im = ctx.getImageData(0, 0, w, hgt), d = im.data;
    var corners = [0, (w - 1) * 4, (hgt - 1) * w * 4, ((hgt - 1) * w + (w - 1)) * 4];
    var tol = st.tol * 2.55, tol2 = tol * tol * 3;
    var featherT2 = tol2 * 2;

    function bgDist2(i) {
      var best = Infinity;
      for (var k = 0; k < 4; k++) {
        var ci = corners[k];
        var dr = d[i] - d[ci], dg = d[i + 1] - d[ci + 1], db = d[i + 2] - d[ci + 2];
        var v = dr * dr + dg * dg + db * db;
        if (v < best) best = v;
      }
      return best;
    }

    var visited = new Uint8Array(w * hgt);
    var queue = [];
    for (var x = 0; x < w; x++) { queue.push(x); queue.push((hgt - 1) * w + x); }
    for (var y = 0; y < hgt; y++) { queue.push(y * w); queue.push(y * w + (w - 1)); }
    while (queue.length) {
      var p = queue.pop();
      if (visited[p]) continue;
      visited[p] = 1;
      var i = p * 4;
      if (d[i + 3] === 0) continue;
      if (bgDist2(i) > tol2) continue;
      d[i + 3] = 0;
      var px = p % w, py = (p - px) / w;
      if (px > 0) queue.push(p - 1);
      if (px < w - 1) queue.push(p + 1);
      if (py > 0) queue.push(p - w);
      if (py < hgt - 1) queue.push(p + w);
    }
    // Feather: near-background pixels adjacent to cleared area fade out.
    for (var p2 = 0; p2 < w * hgt; p2++) {
      var i2 = p2 * 4;
      if (d[i2 + 3] === 0) continue;
      var px2 = p2 % w, py2 = (p2 - px2) / w;
      var nearClear =
        (px2 > 0 && d[i2 - 4 + 3] === 0) || (px2 < w - 1 && d[i2 + 4 + 3] === 0) ||
        (py2 > 0 && d[i2 - w * 4 + 3] === 0) || (py2 < hgt - 1 && d[i2 + w * 4 + 3] === 0);
      if (!nearClear) continue;
      var dist2 = bgDist2(i2);
      if (dist2 < featherT2) {
        d[i2 + 3] = Math.min(d[i2 + 3], Math.round(255 * (dist2 / featherT2)));
      }
    }
    ctx.putImageData(im, 0, 0);
  }

  /* Trim to the alpha bounding box, then add st.pad% transparent margin. */
  function trimPad() {
    var c = st.work, w = c.width, hgt = c.height;
    var d = c.getContext('2d').getImageData(0, 0, w, hgt).data;
    var minX = w, minY = hgt, maxX = -1, maxY = -1;
    for (var y = 0; y < hgt; y++) {
      for (var x = 0; x < w; x++) {
        if (d[(y * w + x) * 4 + 3] > 8) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) { upErr('The image is fully transparent — nothing to trim to.'); return; }
    var bw = maxX - minX + 1, bh = maxY - minY + 1;
    var pad = Math.round(Math.max(bw, bh) * (st.pad / 100));
    var out = document.createElement('canvas');
    out.width = bw + pad * 2; out.height = bh + pad * 2;
    out.getContext('2d').drawImage(c, minX, minY, bw, bh, pad, pad, bw, bh);
    setWork(out);
  }

  function canvasToBlob(c) {
    return new Promise(function (resolve, reject) {
      c.toBlob(function (b) { if (b) resolve(b); else reject(new Error('toBlob failed')); }, 'image/png');
    });
  }

  function smartCutout() {
    upErr('');
    setBusy('Loading the cutout model — first use downloads it (~50MB, then cached)…');
    var cfg = {
      // Model + wasm are served from OUR origin (version-matched to the
      // vendored 1.4.5 bundle). 1.4.5 names its models small/medium.
      publicPath: new URL('/vendor/bg-removal/data/', window.location.origin).toString(),
      model: 'small',
      progress: function (key, cur, total) {
        if (total > 0 && /fetch/.test(String(key))) {
          setBusy('Downloading cutout model… ' + Math.min(100, Math.round((cur / total) * 100)) + '%');
        } else {
          setBusy('Cutting out the background…');
        }
      },
    };
    import(BG_REMOVAL_SRC)
      .then(function (mod) {
        var removeBackground = mod.removeBackground || (mod.default && mod.default.removeBackground) || mod.default;
        if (typeof removeBackground !== 'function') throw new Error('removeBackground export missing');
        return canvasToBlob(st.work).then(function (blob) {
          return removeBackground(blob, cfg);
        });
      })
      .then(function (outBlob) {
        return new Promise(function (resolve, reject) {
          var url = URL.createObjectURL(outBlob);
          var img = new Image();
          img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
          img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('decode failed')); };
          img.src = url;
        });
      })
      .then(function (img) {
        var out = document.createElement('canvas');
        out.width = img.naturalWidth; out.height = img.naturalHeight;
        out.getContext('2d').drawImage(img, 0, 0);
        setWork(out);
        setBusy('');
      })
      .catch(function (e) {
        console.warn('[logo-picker] smart cutout failed:', e);
        setBusy('');
        var why = e && e.message ? String(e.message).slice(0, 140) : 'unknown error';
        upErr('Smart cutout failed (' + why + ') — "Remove background" works regardless.');
      });
  }

  function exportPng() {
    var c = st.work;
    var scale = Math.min(1, st.outDim / Math.max(c.width, c.height));
    var out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(c.width * scale));
    out.height = Math.max(1, Math.round(c.height * scale));
    var ctx = out.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(c, 0, 0, out.width, out.height);
    var dataUrl = out.toDataURL('image/png');
    // Stay under the API's 2MB cap (base64 inflates ~4/3).
    while (dataUrl.length > 2.6e6 && out.width > 120) {
      var half = document.createElement('canvas');
      half.width = Math.round(out.width * 0.7); half.height = Math.round(out.height * 0.7);
      half.getContext('2d').drawImage(out, 0, 0, half.width, half.height);
      out = half;
      dataUrl = out.toDataURL('image/png');
    }
    return dataUrl;
  }

  function publish() {
    if (!st || !st.work) return;
    var name = ($id('tglp-name').value || '').trim();
    if (!name) { upErr('Give the logo a name first.'); return; }
    var category = ($id('tglp-cat2').value || '').trim();
    var domain = ($id('tglp-site').value || '').trim();
    upErr('');
    setBusy('Publishing to the library…');
    fetch(API, {
      method: 'POST',
      headers: authHeaders(),
      credentials: 'include',
      body: JSON.stringify({ name: name, category: category, domain: domain, dataUrl: exportPng() }),
    })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (out) {
        setBusy('');
        if (!out.ok || !out.d || !out.d.brand) {
          upErr((out.d && out.d.message) || 'Could not save the logo — please try again.');
          return;
        }
        cache = null; // library changed — next open refetches
        var cb = st.onSelect;
        close();
        cb(out.d.brand);
      })
      .catch(function () {
        setBusy('');
        upErr('Could not reach the server — please try again.');
      });
  }

  window.LogoPicker = { open: open, close: close };
})();
