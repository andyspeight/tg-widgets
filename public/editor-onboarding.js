/* ============================================================================
   Travelgenix Editor Onboarding Overlay  v1.3.0
   ----------------------------------------------------------------------------
   Layout reset: copy on TOP, art FULL-WIDTH below.

   v1.0  static SVG art (scrapped)
   v1.1  animation library + moving art
   v1.2  onLeave teardown hook (live widgets can mount/unmount cleanly)
   v1.3  STACKED LAYOUT — the art is no longer squashed into a right column.
         A compact two-column copy header sits at the top (title left,
         supporting line + optional "try this" hint right), and the art zone
         runs the full width of the card beneath it. Maps, dashboards and
         control panels finally get room to breathe. Card is wider and the
         vertical rhythm is more generous.

   CHAPTER SHAPE
     {
       kicker, title|titleHtml, body,
       hint:   'small try-this line shown under the body' (optional),
       art:    'html' | function(){...returns html...} (optional),
       onArt:  function(frameEl){...}   (optional, after art mounts),
       onLeave:function(frameEl){...}   (optional, before art is torn down)
     }

   Animation classes any art can use: tgob-a-drop / -pop / -rise / -draw,
   tgob-pulse, tgob-sweep (+ .tgob-sweep-host), tgob-caret.

   API: tgse.onboarding({ id, chapters })
   ============================================================================ */
(function () {
  'use strict';

  if (!window.tgse) {
    console.warn('[tgse-onboarding] window.tgse not found — load editor-shell.js first.');
    return;
  }

  var STYLE_ID = 'tgse-onboarding-styles';
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var css = `
    .tgob-overlay{
      position:fixed; inset:0; z-index:950;
      display:flex; align-items:center; justify-content:center; padding:24px;
      background:color-mix(in srgb, var(--tgse-bg-page,#0b1220) 76%, #000 24%);
      -webkit-backdrop-filter:blur(0px); backdrop-filter:blur(0px);
      opacity:0; pointer-events:none; transition:opacity .26s ease, backdrop-filter .4s ease;
    }
    .tgob-overlay.is-open{ opacity:1; pointer-events:auto; -webkit-backdrop-filter:blur(7px); backdrop-filter:blur(7px); }

    .tgob-card{
      --dir:1;
      position:relative; width:100%; max-width:1000px;
      height:min(660px, calc(100vh - 40px)); min-height:min(620px, calc(100vh - 40px));
      background:var(--tgse-surface,#0e1726); color:var(--tgse-text,#e6edf6);
      border:1px solid var(--tgse-border,#1e293b); border-radius:20px; overflow:hidden;
      box-shadow:0 40px 90px -28px rgba(0,0,0,.62), 0 0 0 1px rgba(255,255,255,.02) inset;
      display:flex; flex-direction:column;
      transform:translateY(16px) scale(.97); opacity:.4;
      transition:transform .42s cubic-bezier(.34,1.4,.5,1), opacity .3s ease;
    }
    .tgob-overlay.is-open .tgob-card{ transform:none; opacity:1; }

    .tgob-card::before{
      content:''; position:absolute; inset:-40%; z-index:0; pointer-events:none;
      background:radial-gradient(50% 40% at 50% 6%, color-mix(in srgb, var(--tgse-brand,#0891B2) 14%, transparent), transparent 70%);
      opacity:.7;
    }
    .tgob-card > *{ position:relative; z-index:1; }

    .tgob-top{
      position:absolute; inset-block-start:0; inset-inline:0; height:54px;
      display:flex; align-items:center; justify-content:space-between;
      padding:0 18px; z-index:3; pointer-events:none;
    }
    .tgob-top > *{ pointer-events:auto; }
    .tgob-skip{
      font:inherit; font-size:13px; font-weight:500; color:var(--tgse-text-muted,#94a3b8);
      background:none; border:none; cursor:pointer; padding:6px 8px; border-radius:8px;
      transition:color .14s, background .14s;
    }
    .tgob-skip:hover{ color:var(--tgse-text,#e6edf6); background:color-mix(in srgb, var(--tgse-text,#fff) 8%, transparent); }
    .tgob-close{
      inline-size:34px; block-size:34px; border-radius:50%; cursor:pointer;
      display:flex; align-items:center; justify-content:center; color:var(--tgse-text-muted,#94a3b8);
      background:color-mix(in srgb, var(--tgse-text,#fff) 8%, transparent);
      border:1px solid var(--tgse-border,#1e293b); transition:all .18s;
    }
    .tgob-close:hover{ color:var(--tgse-text,#e6edf6); border-color:var(--tgse-border-strong,#334155); transform:rotate(90deg); }
    .tgob-close svg{ width:16px; height:16px; }

    /* ── body is now a vertical stack: header on top, art full-width below ── */
    .tgob-body{
      flex:1 1 auto; min-height:0;
      display:flex; flex-direction:column;
      padding:54px 0 0;
    }

    /* copy header — title left, supporting line + hint right */
    .tgob-copy{
      flex:0 0 auto;
      display:grid; grid-template-columns:1.08fr 0.92fr; gap:12px 40px; align-items:end;
      padding:8px 46px 16px;
    }
    .tgob-head-l{ display:flex; flex-direction:column; gap:13px; }
    .tgob-head-r{ display:flex; flex-direction:column; gap:12px; padding-bottom:3px; }
    .tgob-kicker{
      display:flex; align-items:center; gap:10px;
      font-size:11px; font-weight:700; letter-spacing:.14em; text-transform:uppercase;
      color:var(--tgse-brand,#0891B2);
    }
    .tgob-kicker::before{ content:''; width:22px; height:2px; border-radius:2px; background:var(--tgse-brand,#0891B2); }
    .tgob-title{ margin:0; font-size:29px; line-height:1.1; font-weight:800; letter-spacing:-.022em; color:var(--tgse-text,#e6edf6); }
    .tgob-title em{ font-style:normal; color:var(--tgse-brand,#0891B2); }
    .tgob-text{ margin:0; font-size:14px; line-height:1.6; color:var(--tgse-text-muted,#94a3b8); }
    .tgob-hint{
      display:inline-flex; align-items:center; gap:8px; align-self:flex-start;
      font-size:12px; font-weight:600; color:var(--tgse-brand,#0891B2);
      background:color-mix(in srgb, var(--tgse-brand,#0891B2) 10%, transparent);
      border:1px solid color-mix(in srgb, var(--tgse-brand,#0891B2) 30%, transparent);
      padding:6px 11px; border-radius:999px;
    }
    .tgob-hint svg{ width:13px; height:13px; flex:0 0 auto; }

    /* art zone — full width, fills the rest of the card */
    .tgob-art{ flex:1 1 auto; min-height:0; display:flex; padding:0 22px 20px; }
    .tgob-art-frame{
      position:relative; flex:1 1 auto; min-height:280px; box-sizing:border-box;
      border:1px solid var(--tgse-border,#1e293b); border-radius:14px;
      background:color-mix(in srgb, var(--tgse-text,#fff) 3%, transparent);
      overflow:hidden;
    }

    .tgob-foot{
      flex:0 0 auto; height:62px; display:flex; align-items:center; justify-content:space-between;
      padding:0 24px; border-top:1px solid var(--tgse-border,#1e293b);
      background:color-mix(in srgb, var(--tgse-surface,#0e1726) 60%, transparent);
    }
    .tgob-dots{ display:flex; gap:7px; align-items:center; }
    .tgob-dot{
      width:7px; height:7px; border-radius:50%; padding:0; border:none; cursor:pointer;
      background:var(--tgse-border-strong,#334155); transition:all .3s cubic-bezier(.34,1.4,.5,1); flex:0 0 auto;
    }
    .tgob-dot.is-on{ width:24px; border-radius:4px; background:var(--tgse-brand,#0891B2); }

    .tgob-nav{ display:flex; gap:10px; align-items:center; }
    .tgob-btn{
      font:inherit; font-size:13.5px; font-weight:600; cursor:pointer;
      display:inline-flex; align-items:center; gap:7px; padding:9px 16px; border-radius:10px;
      transition:transform .12s ease, filter .14s, border-color .14s, color .14s; border:1px solid transparent;
    }
    .tgob-btn:active{ transform:translateY(1px) scale(.985); }
    .tgob-btn svg{ width:15px; height:15px; }
    .tgob-btn-ghost{ color:var(--tgse-text-muted,#94a3b8); background:transparent; border-color:var(--tgse-border,#1e293b); }
    .tgob-btn-ghost:hover{ color:var(--tgse-text,#e6edf6); border-color:var(--tgse-border-strong,#334155); }
    .tgob-btn-ghost:disabled{ opacity:.4; cursor:default; }
    .tgob-btn-primary{
      color:#fff; border:none;
      background:linear-gradient(135deg, var(--tgse-brand,#0891B2), var(--tgse-brand-dark,#0E7490));
      box-shadow:0 6px 18px -6px color-mix(in srgb, var(--tgse-brand,#0891B2) 70%, transparent);
    }
    .tgob-btn-primary:hover{ filter:brightness(1.07); }

    .tgob-dontshow{
      display:none; align-items:center; gap:8px; cursor:pointer; user-select:none;
      font-size:12px; color:var(--tgse-text-muted,#94a3b8); padding:6px 8px; border-radius:8px;
    }
    .tgob-dontshow.is-show{ display:inline-flex; }
    .tgob-dontshow input{ width:15px; height:15px; accent-color:var(--tgse-brand,#0891B2); cursor:pointer; }

    .tgob-blob{
      position:fixed; inset-block-end:22px; inset-inline-end:22px; z-index:880;
      display:inline-flex; align-items:center; gap:9px;
      font:inherit; font-size:13.5px; font-weight:600; color:#fff; cursor:pointer; border:none;
      padding:11px 17px 11px 13px; border-radius:999px;
      background:linear-gradient(135deg, var(--tgse-brand,#0891B2), var(--tgse-brand-dark,#0E7490));
      box-shadow:0 10px 26px -8px color-mix(in srgb, var(--tgse-brand,#0891B2) 75%, transparent);
      transform:translateY(8px); opacity:0; transition:opacity .3s ease, transform .3s ease, filter .14s;
    }
    .tgob-blob.is-show{ transform:none; opacity:1; }
    .tgob-blob:hover{ filter:brightness(1.07); transform:translateY(-1px); }
    .tgob-blob .tgob-blob-ico{
      inline-size:26px; block-size:26px; border-radius:50%; flex:0 0 auto;
      display:flex; align-items:center; justify-content:center; background:rgba(255,255,255,.2);
    }
    .tgob-blob .tgob-blob-ico svg{ width:13px; height:13px; margin-inline-start:1px; }
    @keyframes tgob-blob-breath { 0%,100%{ box-shadow:0 10px 26px -8px color-mix(in srgb, var(--tgse-brand,#0891B2) 60%, transparent);} 50%{ box-shadow:0 12px 32px -6px color-mix(in srgb, var(--tgse-brand,#0891B2) 95%, transparent);} }
    .tgob-blob.is-show{ animation:tgob-blob-breath 3.4s ease-in-out infinite; }

    /* entrance, replays each render */
    .tgob-head-l{ animation:tgob-rise .42s cubic-bezier(.16,1,.3,1) both; animation-delay:.02s; }
    .tgob-head-r{ animation:tgob-rise .42s cubic-bezier(.16,1,.3,1) both; animation-delay:.1s; }
    .tgob-art-frame{ animation:tgob-rise .5s cubic-bezier(.16,1,.3,1) both; animation-delay:.14s; }

    /* generic animation library (art opts in) */
    @keyframes tgob-rise { from{ opacity:0; transform:translate(calc(var(--dir,1)*14px), 10px);} to{ opacity:1; transform:none;} }
    @keyframes tgob-drop { 0%{ opacity:0; transform:translateY(-26px) scale(.9);} 60%{ opacity:1;} 100%{ opacity:1; transform:translateY(0) scale(1);} }
    @keyframes tgob-pop  { 0%{ opacity:0; transform:scale(.5);} 70%{ transform:scale(1.12);} 100%{ opacity:1; transform:scale(1);} }
    @keyframes tgob-pulse{ 0%{ transform:scale(.6); opacity:.65;} 70%{ opacity:0;} 100%{ transform:scale(2.4); opacity:0;} }
    @keyframes tgob-draw { from{ stroke-dashoffset:var(--len,40);} to{ stroke-dashoffset:0;} }
    @keyframes tgob-sweep{ 0%{ transform:translateX(-120%);} 100%{ transform:translateX(220%);} }
    @keyframes tgob-blink{ 0%,49%{ opacity:1;} 50%,100%{ opacity:0;} }

    .tgob-a-drop{ animation:tgob-drop .44s cubic-bezier(.34,1.5,.5,1) both; }
    .tgob-a-pop { animation:tgob-pop  .34s cubic-bezier(.34,1.56,.64,1) both; }
    .tgob-a-rise{ animation:tgob-rise .42s cubic-bezier(.16,1,.3,1) both; }
    .tgob-a-draw{ stroke-dasharray:var(--len,40); animation:tgob-draw .4s ease-out both; }
    .tgob-pulse{ animation:tgob-pulse 2.4s ease-out infinite; }
    .tgob-sweep-host{ position:relative; overflow:hidden; }
    .tgob-sweep-host .tgob-sweep{
      position:absolute; inset:0; pointer-events:none;
      background:linear-gradient(105deg, transparent 30%, color-mix(in srgb, var(--tgse-brand,#0891B2) 38%, transparent) 50%, transparent 70%);
      animation:tgob-sweep 1s ease-in-out both;
    }
    .tgob-caret{ display:inline-block; width:2px; height:1em; vertical-align:-2px; background:var(--tgse-brand,#22D3EE); margin-inline-start:2px; animation:tgob-blink 1s steps(1) infinite; }

    @media (max-width:760px){
      .tgob-card{ max-height:calc(100vh - 28px); }
      .tgob-body{ padding-top:50px; overflow:auto; }
      .tgob-copy{ grid-template-columns:1fr; gap:12px; padding:10px 22px 16px; }
      .tgob-head-r{ padding-bottom:0; }
      .tgob-title{ font-size:23px; }
      .tgob-art{ padding:0 16px 16px; }
      .tgob-art-frame{ min-height:240px; }
    }
    @media (prefers-reduced-motion:reduce){
      .tgob-overlay, .tgob-card, .tgob-blob, .tgob-dot, .tgob-close, .tgob-btn{ transition:none !important; }
      .tgob-card{ transform:none; opacity:1; }
      .tgob-head-l, .tgob-head-r, .tgob-art-frame,
      .tgob-a-drop, .tgob-a-pop, .tgob-a-rise, .tgob-a-draw,
      .tgob-pulse, .tgob-sweep-host .tgob-sweep, .tgob-blob.is-show{ animation:none !important; opacity:1 !important; transform:none !important; }
      .tgob-a-draw{ stroke-dashoffset:0 !important; }
      .tgob-caret{ display:none; }
    }
    `;
    var el = document.createElement('style');
    el.id = STYLE_ID; el.textContent = css;
    document.head.appendChild(el);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function dismissKey(id) { return 'tgse:onboard-dismissed:' + (id || 'default'); }
  function isDismissed(id) { try { return localStorage.getItem(dismissKey(id)) === '1'; } catch (e) { return false; } }
  function setDismissed(id, v) { try { v ? localStorage.setItem(dismissKey(id), '1') : localStorage.removeItem(dismissKey(id)); } catch (e) {} }

  var ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  var ICON_CHEV_L = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>';
  var ICON_CHEV_R = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
  var ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
  var ICON_HINT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V18h6v-1.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z"/></svg>';

  function onboarding(config) {
    config = config || {};
    var id = config.id || 'default';
    var chapters = Array.isArray(config.chapters) ? config.chapters : [];
    if (!chapters.length) { console.warn('[tgse-onboarding] no chapters supplied for "' + id + '"'); return; }

    injectStyles();

    var idx = 0;
    var root, card, dotsWrap, copyWrap, artWrap, btnBack, btnNext, dontShow, dontShowCb, skipBtn;

    function build() {
      root = document.createElement('div');
      root.className = 'tgob-overlay';
      root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true');
      root.setAttribute('aria-label', 'Getting started guide');
      root.innerHTML =
        '<div class="tgob-card">' +
          '<div class="tgob-top">' +
            '<button type="button" class="tgob-skip">Skip</button>' +
            '<button type="button" class="tgob-close" aria-label="Close guide">' + ICON_X + '</button>' +
          '</div>' +
          '<div class="tgob-body"><div class="tgob-copy"></div><div class="tgob-art"></div></div>' +
          '<div class="tgob-foot">' +
            '<div style="display:flex;align-items:center;gap:14px;">' +
              '<div class="tgob-dots" role="tablist"></div>' +
              '<label class="tgob-dontshow"><input type="checkbox"> Don\'t show me this again</label>' +
            '</div>' +
            '<div class="tgob-nav">' +
              '<button type="button" class="tgob-btn tgob-btn-ghost tgob-back">' + ICON_CHEV_L + ' Back</button>' +
              '<button type="button" class="tgob-btn tgob-btn-primary tgob-next">Next ' + ICON_CHEV_R + '</button>' +
            '</div>' +
          '</div>' +
        '</div>';

      card = root.querySelector('.tgob-card');
      copyWrap = root.querySelector('.tgob-copy');
      artWrap = root.querySelector('.tgob-art');
      dotsWrap = root.querySelector('.tgob-dots');
      btnBack = root.querySelector('.tgob-back');
      btnNext = root.querySelector('.tgob-next');
      skipBtn = root.querySelector('.tgob-skip');
      dontShow = root.querySelector('.tgob-dontshow');
      dontShowCb = dontShow.querySelector('input');

      chapters.forEach(function (_, i) {
        var d = document.createElement('button');
        d.type = 'button'; d.className = 'tgob-dot'; d.setAttribute('aria-label', 'Chapter ' + (i + 1));
        d.addEventListener('click', function () { go(i); });
        dotsWrap.appendChild(d);
      });

      root.querySelector('.tgob-close').addEventListener('click', close);
      skipBtn.addEventListener('click', close);
      btnBack.addEventListener('click', function () { go(idx - 1); });
      btnNext.addEventListener('click', function () { idx >= chapters.length - 1 ? close() : go(idx + 1); });
      dontShowCb.addEventListener('change', function () { setDismissed(id, dontShowCb.checked); });
      root.addEventListener('click', function (e) { if (e.target === root) close(); });
      document.addEventListener('keydown', onKey);

      document.body.appendChild(root);
    }

    function onKey(e) {
      if (!root || !root.classList.contains('is-open')) return;
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') { if (idx < chapters.length - 1) go(idx + 1); }
      else if (e.key === 'ArrowLeft') { if (idx > 0) go(idx - 1); }
    }

    var _prevCh = null, _prevFrame = null;
    function render() {
      if (_prevCh && typeof _prevCh.onLeave === 'function') {
        try { _prevCh.onLeave(_prevFrame); } catch (e) {}
      }

      var ch = chapters[idx];
      var titleHtml = ch.titleHtml ? ch.titleHtml : esc(ch.title || '');
      copyWrap.innerHTML =
        '<div class="tgob-head-l">' +
          (ch.kicker ? '<div class="tgob-kicker">' + esc(ch.kicker) + '</div>' : '') +
          '<h2 class="tgob-title">' + titleHtml + '</h2>' +
        '</div>' +
        '<div class="tgob-head-r">' +
          (ch.body ? '<p class="tgob-text">' + esc(ch.body) + '</p>' : '') +
          (ch.hint ? '<span class="tgob-hint">' + ICON_HINT + esc(ch.hint) + '</span>' : '') +
        '</div>';

      var artHtml = typeof ch.art === 'function' ? ch.art() : ch.art;
      artWrap.innerHTML = artHtml ? ('<div class="tgob-art-frame">' + artHtml + '</div>') : '';
      artWrap.style.display = artHtml ? '' : 'none';

      var frame = artWrap.querySelector('.tgob-art-frame');
      if (artHtml && typeof ch.onArt === 'function') {
        requestAnimationFrame(function () { try { ch.onArt(frame); } catch (e) {} });
      }
      _prevCh = ch; _prevFrame = frame;

      Array.prototype.forEach.call(dotsWrap.children, function (d, i) { d.classList.toggle('is-on', i === idx); });

      btnBack.disabled = idx === 0;
      var last = idx === chapters.length - 1;
      btnNext.innerHTML = last ? 'Get started' : ('Next ' + ICON_CHEV_R);
      dontShow.classList.toggle('is-show', last);
      skipBtn.style.visibility = last ? 'hidden' : '';
    }

    function go(i) {
      var n = Math.max(0, Math.min(chapters.length - 1, i));
      if (card) card.style.setProperty('--dir', n >= idx ? '1' : '-1');
      idx = n;
      render();
    }

    function open() {
      if (!root) build();
      idx = 0;
      if (card) card.style.setProperty('--dir', '1');
      render();
      dontShowCb.checked = isDismissed(id);
      requestAnimationFrame(function () { root.classList.add('is-open'); });
    }
    function close() {
      if (_prevCh && typeof _prevCh.onLeave === 'function') {
        try { _prevCh.onLeave(_prevFrame); } catch (e) {}
        _prevCh = null; _prevFrame = null;
      }
      if (root) root.classList.remove('is-open');
    }

    function mountBlob() {
      if (document.querySelector('.tgob-blob[data-tgob="' + id + '"]')) return;
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'tgob-blob'; b.setAttribute('data-tgob', id);
      b.innerHTML = '<span class="tgob-blob-ico">' + ICON_PLAY + '</span> Show me how';
      b.addEventListener('click', open);
      document.body.appendChild(b);
      requestAnimationFrame(function () { setTimeout(function () { b.classList.add('is-show'); }, 450); });
    }

    mountBlob();
    if (!isDismissed(id)) setTimeout(open, 560);

    return { open: open, close: close, goTo: go };
  }

  window.tgse.onboarding = onboarding;
  window.tgse.onboardingVersion = '1.3.0';

})();
