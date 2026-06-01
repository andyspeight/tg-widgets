/* ============================================================================
   Travelgenix Editor Guided Tour  v1.0.0
   ----------------------------------------------------------------------------
   A step-by-step, point-at-the-real-control walkthrough for widget editors.

   This is NOT a modal that talks at the user. It is a coach-mark tour: it dims
   the editor, spotlights one real control at a time, and anchors a short
   instruction beside it ("Type your heading here", "Now tick your destinations").
   The highlighted control stays fully usable, so the user actually does each
   step in their real editor. Steps can switch tabs, scroll the control into
   view, and advance either on a Next click or when the user performs the action.

   Adds two methods to the shell global:
     tgse.tour({ id, steps, onDone })   -> starts/returns a tour controller
     tgse.tourLauncher({ id, label, onClick })  -> mounts the persistent
                                                    "Show me how" launcher blob

   STEP SHAPE
     {
       tab:      'content'|'design'|'settings',   // optional: switch to this tab first
       target:   '#f-title'  |  () => el,         // the real element to spotlight
       title:    'Give it a heading',
       body:     'Short instruction. One or two lines.',
       placement:'auto'|'top'|'bottom'|'left'|'right',  // callout side (default auto)
                                                         // the user does the thing
       spotlightPadding: 8,                        // optional px around target
       allowClickThrough: true,                    // default true: control stays usable
       beforeShow: (api) => {},                    // optional hook (e.g. open a section)
     }

   The tour reads the shell's --tgse-* tokens, so it themes with the editor.
   Respects prefers-reduced-motion. Cleans up all listeners on finish.
   ============================================================================ */
(function () {
  'use strict';

  if (!window.tgse) {
    console.warn('[tgse-tour] window.tgse not found — load editor-shell.js first.');
    return;
  }

  var STYLE_ID = 'tgse-tour-styles';
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var css = `
    /* a LIGHT scrim with a transparent spotlight hole — the editor stays clearly
       visible so the user can see exactly what they are about to use. The target
       is made to pop with a bright ring + glow, not by darkening everything. */
    .tgt-veil{ position:fixed; inset:0; z-index:3000; pointer-events:none; opacity:0; transition:opacity .25s ease; }
    .tgt-veil.is-on{ opacity:1; }
    .tgt-spot{
      position:fixed; z-index:3001; border-radius:11px; pointer-events:none;
      box-shadow:0 0 0 9999px rgba(10,15,28,.34);
      transition:left .3s cubic-bezier(.34,1.1,.4,1), top .3s cubic-bezier(.34,1.1,.4,1), width .3s cubic-bezier(.34,1.1,.4,1), height .3s cubic-bezier(.34,1.1,.4,1);
      outline:2.5px solid var(--tgse-brand,#0891B2); outline-offset:3px;
    }
    /* a soft brand halo so the highlighted control lifts off the page */
    .tgt-spot::before{
      content:''; position:absolute; inset:-3px; border-radius:13px; pointer-events:none;
      box-shadow:0 0 0 3px color-mix(in srgb, var(--tgse-brand,#0891B2) 35%, transparent), 0 0 22px 4px color-mix(in srgb, var(--tgse-brand,#0891B2) 30%, transparent);
    }
    .tgt-spot::after{
      content:''; position:absolute; inset:-3px; border-radius:13px; pointer-events:none;
      box-shadow:0 0 0 6px color-mix(in srgb, var(--tgse-brand,#0891B2) 22%, transparent);
      animation:tgt-breath 2.2s ease-in-out infinite;
    }
    @keyframes tgt-breath{ 0%,100%{ opacity:.4; } 50%{ opacity:1; } }

    /* the instruction callout, anchored beside the spotlight */
    .tgt-pop{
      position:fixed; z-index:3003; width:312px; max-width:calc(100vw - 32px); box-sizing:border-box;
      background:var(--tgse-surface,#0e1726); color:var(--tgse-text,#e6edf6);
      border:1px solid var(--tgse-border,#1e293b); border-radius:14px;
      box-shadow:0 24px 60px -20px rgba(0,0,0,.6);
      padding:16px 16px 13px; opacity:0; transform:translateY(6px) scale(.98);
      transition:opacity .22s ease, transform .26s cubic-bezier(.34,1.3,.5,1);
    }
    .tgt-pop.is-on{ opacity:1; transform:none; }
    .tgt-pop-step{ font-size:11px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:var(--tgse-brand,#0891B2); margin-bottom:8px; display:flex; align-items:center; gap:8px; }
    .tgt-pop-step::before{ content:''; width:16px; height:2px; border-radius:2px; background:var(--tgse-brand,#0891B2); }
    .tgt-pop-title{ margin:0 0 6px; font-size:16.5px; font-weight:800; letter-spacing:-.01em; line-height:1.2; }
    .tgt-pop-body{ margin:0 0 13px; font-size:13px; line-height:1.55; color:var(--tgse-text-muted,#94a3b8); }
    .tgt-pop-body b{ color:var(--tgse-text,#e6edf6); font-weight:600; }

    .tgt-pop-foot{ display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; row-gap:10px; }
    .tgt-dots{ display:flex; gap:5px; align-items:center; flex:1 1 auto; min-width:0; flex-wrap:wrap; }
    .tgt-dot{ width:6px; height:6px; border-radius:50%; background:var(--tgse-border-strong,#334155); transition:all .25s; }
    .tgt-dot.is-on{ width:18px; border-radius:3px; background:var(--tgse-brand,#0891B2); }
    .tgt-nav{ display:flex; gap:7px; align-items:center; flex:0 0 auto; margin-left:auto; }
    .tgt-btn{ font:inherit; font-size:12.5px; font-weight:600; cursor:pointer; border:1px solid transparent; border-radius:9px; padding:7px 13px; transition:transform .1s, filter .14s, border-color .14s, color .14s; }
    .tgt-btn:active{ transform:translateY(1px); }
    .tgt-btn-ghost{ color:var(--tgse-text-muted,#94a3b8); background:transparent; border-color:var(--tgse-border,#1e293b); }
    .tgt-btn-ghost:hover{ color:var(--tgse-text,#e6edf6); border-color:var(--tgse-border-strong,#334155); }
    .tgt-btn-primary{ color:#fff; border:none; background:linear-gradient(135deg, var(--tgse-brand,#0891B2), var(--tgse-brand-dark,#0E7490)); box-shadow:0 5px 14px -6px color-mix(in srgb, var(--tgse-brand,#0891B2) 70%, transparent); }
    .tgt-btn-primary:hover{ filter:brightness(1.07); }
    .tgt-skip{ position:absolute; top:13px; right:14px; font:inherit; font-size:11.5px; font-weight:500; color:var(--tgse-text-muted,#94a3b8); background:none; border:none; cursor:pointer; padding:2px 4px; border-radius:6px; }
    .tgt-skip:hover{ color:var(--tgse-text,#e6edf6); }

    /* little arrow on the callout */
    .tgt-pop-arrow{ position:absolute; width:12px; height:12px; background:var(--tgse-surface,#0e1726); border:1px solid var(--tgse-border,#1e293b); transform:rotate(45deg); }

    /* "auto-advance" affordance: a subtle 'or just do it' nudge */
    .tgt-pop-doit{ display:inline-flex; align-items:center; gap:6px; margin:0 0 12px; font-size:11.5px; color:var(--tgse-brand,#0891B2); font-weight:600; }
    .tgt-pop-doit svg{ width:13px; height:13px; }

    /* persistent launcher */
    .tgt-launch{
      position:fixed; inset-block-end:22px; inset-inline-end:22px; z-index:2990;
      display:inline-flex; align-items:center; gap:9px;
      font:inherit; font-size:13.5px; font-weight:600; color:#fff; cursor:pointer; border:none;
      padding:11px 17px 11px 13px; border-radius:999px;
      background:linear-gradient(135deg, var(--tgse-brand,#0891B2), var(--tgse-brand-dark,#0E7490));
      box-shadow:0 10px 26px -8px color-mix(in srgb, var(--tgse-brand,#0891B2) 75%, transparent);
      transform:translateY(8px); opacity:0; transition:opacity .3s ease, transform .3s ease, filter .14s;
    }
    .tgt-launch.is-on{ transform:none; opacity:1; animation:tgt-launch-breath 3.4s ease-in-out infinite; }
    .tgt-launch:hover{ filter:brightness(1.07); transform:translateY(-1px); }
    .tgt-launch .tgt-launch-ico{ inline-size:26px; block-size:26px; border-radius:50%; flex:0 0 auto; display:flex; align-items:center; justify-content:center; background:rgba(255,255,255,.2); }
    .tgt-launch .tgt-launch-ico svg{ width:14px; height:14px; }
    @keyframes tgt-launch-breath{ 0%,100%{ box-shadow:0 10px 26px -8px color-mix(in srgb, var(--tgse-brand,#0891B2) 60%, transparent);} 50%{ box-shadow:0 12px 32px -6px color-mix(in srgb, var(--tgse-brand,#0891B2) 95%, transparent);} }

    /* welcome / done cards (centred, used only for the first + last beats) */
    .tgt-card{
      position:fixed; z-index:3004; left:50%; top:50%; transform:translate(-50%,-46%) scale(.97);
      width:420px; max-width:calc(100vw - 32px);
      background:var(--tgse-surface,#0e1726); color:var(--tgse-text,#e6edf6);
      border:1px solid var(--tgse-border,#1e293b); border-radius:18px;
      box-shadow:0 36px 80px -24px rgba(0,0,0,.62); padding:26px 26px 22px;
      opacity:0; transition:opacity .26s ease, transform .3s cubic-bezier(.34,1.3,.5,1);
    }
    .tgt-card.is-on{ opacity:1; transform:translate(-50%,-50%) scale(1); }
    .tgt-card-ico{ width:46px; height:46px; border-radius:13px; display:flex; align-items:center; justify-content:center; margin-bottom:14px;
      background:color-mix(in srgb, var(--tgse-brand,#0891B2) 14%, transparent); color:var(--tgse-brand,#0891B2); }
    .tgt-card-ico svg{ width:24px; height:24px; }
    .tgt-card h2{ margin:0 0 8px; font-size:22px; font-weight:800; letter-spacing:-.02em; line-height:1.15; }
    .tgt-card h2 em{ font-style:normal; color:var(--tgse-brand,#0891B2); }
    .tgt-card p{ margin:0 0 18px; font-size:13.5px; line-height:1.6; color:var(--tgse-text-muted,#94a3b8); }
    .tgt-card-foot{ display:flex; align-items:center; justify-content:space-between; gap:10px; }
    .tgt-card-foot .tgt-left{ display:flex; align-items:center; gap:8px; }
    .tgt-dontshow{ display:inline-flex; align-items:center; gap:7px; font-size:12px; color:var(--tgse-text-muted,#94a3b8); cursor:pointer; user-select:none; }
    .tgt-dontshow input{ width:14px; height:14px; accent-color:var(--tgse-brand,#0891B2); cursor:pointer; }

    @media (prefers-reduced-motion:reduce){
      .tgt-veil,.tgt-spot,.tgt-pop,.tgt-card,.tgt-launch,.tgt-dot{ transition:none !important; }
      .tgt-spot::before,.tgt-spot::after,.tgt-launch.is-on{ animation:none !important; }
      .tgt-card-ico-pop,.tgt-done-burst span{ animation:none !important; }
    }

    /* celebratory completion tile */
    .tgt-card-done{ text-align:center; }
    .tgt-card-done .tgt-card-ico{ margin-left:auto; margin-right:auto; }
    .tgt-card-done h2, .tgt-card-done p{ text-align:center; }
    .tgt-card-done .tgt-card-foot{ justify-content:center; }
    .tgt-card-ico-pop{ animation:tgt-ico-pop .5s cubic-bezier(.34,1.6,.5,1) both; animation-delay:.08s; }
    @keyframes tgt-ico-pop{ 0%{ transform:scale(.3); opacity:0; } 60%{ transform:scale(1.15); } 100%{ transform:scale(1); opacity:1; } }
    .tgt-done-burst{ position:absolute; top:38px; left:50%; width:0; height:0; pointer-events:none; }
    .tgt-done-burst span{ position:absolute; left:0; top:0; width:46px; height:46px; margin:-23px 0 0 -23px; border-radius:50%;
      border:2px solid color-mix(in srgb, var(--tgse-brand,#0891B2) 60%, transparent); opacity:0; animation:tgt-burst 1.1s ease-out both; }
    .tgt-done-burst span:nth-child(2){ animation-delay:.14s; }
    .tgt-done-burst span:nth-child(3){ animation-delay:.28s; }
    @keyframes tgt-burst{ 0%{ transform:scale(.3); opacity:.7; } 100%{ transform:scale(3.4); opacity:0; } }
    `;
    var el = document.createElement('style');
    el.id = STYLE_ID; el.textContent = css;
    document.head.appendChild(el);
  }

  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
  function dismissKey(id){ return 'tgse:tour-dismissed:' + (id||'default'); }
  function isDismissed(id){ try{ return localStorage.getItem(dismissKey(id))==='1'; }catch(e){ return false; } }
  function setDismissed(id,v){ try{ v?localStorage.setItem(dismissKey(id),'1'):localStorage.removeItem(dismissKey(id)); }catch(e){} }
  function resolve(t){ if(!t) return null; if(typeof t==='function'){ try{return t();}catch(e){return null;} } return document.querySelector(t); }
  function clickTab(tab){
    if(!tab) return;
    var b = document.querySelector('[role="tab"][data-tab="'+tab+'"]');
    if(b){ b.click(); }
  }

  var ICON_X='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  var ICON_PLAY='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3l14 9-14 9V3z"/></svg>';
  var ICON_WAND='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4V2"/><path d="M15 16v-2"/><path d="M8 9h2"/><path d="M20 9h2"/><path d="M17.8 11.8L19 13"/><path d="M15 9h0"/><path d="M17.8 6.2L19 5"/><path d="M3 21l9-9"/><path d="M12.2 6.2L11 5"/></svg>';
  var ICON_CURSOR='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/></svg>';
  var ICON_CHECK='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

  // ── the tour ────────────────────────────────────────────────────────────────
  function tour(config) {
    config = config || {};
    var id = config.id || 'default';
    var steps = Array.isArray(config.steps) ? config.steps : [];
    if (!steps.length) { console.warn('[tgse-tour] no steps for "'+id+'"'); return; }
    var welcome = config.welcome || null;   // { title, body }
    var done = config.done || null;          // { title, body }

    injectStyles();

    var veil, spot, pop, card, i = -1, dismissCb = null;
    var onResize = function(){ position(); };
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function ensureLayers() {
      if (veil) return;
      // clear any orphaned layers left by a previous controller for this id
      document.querySelectorAll('.tgt-veil,.tgt-spot,.tgt-pop,.tgt-card').forEach(function(n){ n.remove(); });
      veil = document.createElement('div'); veil.className = 'tgt-veil';
      spot = document.createElement('div'); spot.className = 'tgt-spot'; spot.style.display = 'none';
      pop  = document.createElement('div'); pop.className = 'tgt-pop'; pop.style.display = 'none';
      document.body.appendChild(veil);
      document.body.appendChild(spot);
      document.body.appendChild(pop);
      window.addEventListener('resize', onResize, { passive:true });
      window.addEventListener('scroll', onResize, { passive:true, capture:true });
      document.addEventListener('keydown', onKey);
    }

    function onKey(e){
      if (i < 0) return;
      if (e.key === 'Escape') { finish(false); return; }
      // never hijack arrow keys while the user is typing/selecting in a field
      var a = document.activeElement;
      var typing = a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable || a.tagName === 'SELECT');
      if (typing) return;
      if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') prev();
    }


    function showWelcome(cb){
      ensureLayers();
      veil.classList.add('is-on');
      card = document.createElement('div'); card.className = 'tgt-card';
      card.innerHTML =
        '<div class="tgt-card-ico">'+ICON_WAND+'</div>'+
        '<h2>'+(welcome.titleHtml||esc(welcome.title||''))+'</h2>'+
        '<p>'+esc(welcome.body||'')+'</p>'+
        '<div class="tgt-card-foot">'+
          '<label class="tgt-dontshow"><input type="checkbox"> Don\'t show this again</label>'+
          '<div class="tgt-nav">'+
            '<button type="button" class="tgt-btn tgt-btn-ghost" data-skip>Maybe later</button>'+
            '<button type="button" class="tgt-btn tgt-btn-primary" data-start>Start setup</button>'+
          '</div>'+
        '</div>';
      document.body.appendChild(card);
      dismissCb = card.querySelector('input');
      dismissCb.checked = isDismissed(id);
      dismissCb.addEventListener('change', function(){ setDismissed(id, dismissCb.checked); });
      card.querySelector('[data-skip]').addEventListener('click', function(){ teardownCard(); finish(false); });
      card.querySelector('[data-start]').addEventListener('click', function(){ teardownCard(); cb(); });
      requestAnimationFrame(function(){ card.classList.add('is-on'); });
    }
    function teardownCard(){ if (card){ card.classList.remove('is-on'); var c=card; card=null; setTimeout(function(){ if(c&&c.parentNode) c.parentNode.removeChild(c); }, reduce?0:220); } }

    function showDone(){
      ensureLayers();
      spot.style.display='none'; pop.style.display='none';
      card = document.createElement('div'); card.className='tgt-card tgt-card-done';
      card.innerHTML =
        '<div class="tgt-done-burst" aria-hidden="true"><span></span><span></span><span></span></div>'+
        '<div class="tgt-card-ico tgt-card-ico-pop">'+ICON_CHECK+'</div>'+
        '<h2>'+(done.titleHtml||esc(done.title||''))+'</h2>'+
        '<p>'+esc(done.body||'')+'</p>'+
        '<div class="tgt-card-foot">'+
          '<span></span>'+
          '<div class="tgt-nav"><button type="button" class="tgt-btn tgt-btn-primary" data-close>Done</button></div>'+
        '</div>';
      document.body.appendChild(card);
      card.querySelector('[data-close]').addEventListener('click', function(){ teardownCard(); finish(true); });
      requestAnimationFrame(function(){ card.classList.add('is-on'); });
    }

    function go(n){

      if (n < 0) n = 0;
      if (n >= steps.length){ if (done) { i = steps.length; showDone(); return; } finish(true); return; }
      i = n;
      var st = steps[i];

      if (st.tab) clickTab(st.tab);
      if (typeof st.beforeShow === 'function') { try{ st.beforeShow(api); }catch(e){} }

      // wait a frame for tab switch / layout, then locate the target
      setTimeout(function(){ paint(st); }, st.tab ? 120 : 20);
    }

    function paint(st){
      try { paintInner(st); }
      catch(err){
        console.warn('[tgse-tour] paint failed, recovering:', err);
        // never leave the user stranded — at minimum show the callout centred
        if (pop){ pop.style.display='block'; pop.style.left='50%'; pop.style.top='24px'; pop.style.transform='translateX(-50%)'; pop.classList.add('is-on'); }
      }
    }
    function paintInner(st){
      var el = resolve(st.target);
      if (!el){ // target missing — skip forward gracefully
        console.warn('[tgse-tour] target not found, skipping:', st.target);
        return go(i+1);
      }
      // If the target sits inside a collapsed accordion section, open it first
      // (TG editor shell uses .tgse-section / .is-open). Set the class directly
      // rather than clicking the head — clicking would fire the shell's own
      // document-level accordion toggler, whose timing/side-effects we do not
      // control. The one-shot guard stops any chance of a re-paint loop.
      var sec = el.closest ? el.closest('.tgse-section') : null;
      if (sec && !sec.classList.contains('is-open') && !st._revealed){
        st._revealed = true;
        sec.classList.add('is-open');
        return setTimeout(function(){ paint(st); }, 180);
      }
      // scroll into view
      try { el.scrollIntoView({ behavior: reduce?'auto':'smooth', block:'center', inline:'nearest' }); } catch(e){}

      veil.classList.add('is-on');
      spot.style.display='block';
      pop.style.display='block';
      pop.dataset.placement = st.placement || 'auto';
      spot._padding = (st.spotlightPadding != null ? st.spotlightPadding : 8);
      spot._el = el;

      // build callout
      var isLast = i === steps.length - 1;
      pop.innerHTML =
        '<button type="button" class="tgt-skip" data-skip>Skip tour</button>'+
        '<div class="tgt-pop-step">Step '+(i+1)+' of '+steps.length+'</div>'+
        '<h3 class="tgt-pop-title">'+esc(st.title||'')+'</h3>'+
        '<p class="tgt-pop-body">'+(st.bodyHtml||esc(st.body||''))+'</p>'+
        '<div class="tgt-pop-foot">'+
          '<div class="tgt-dots">'+steps.map(function(_,k){return '<span class="tgt-dot'+(k===i?' is-on':'')+'"></span>';}).join('')+'</div>'+
          '<div class="tgt-nav">'+
            (i>0?'<button type="button" class="tgt-btn tgt-btn-ghost" data-prev>Back</button>':'')+
            '<button type="button" class="tgt-btn tgt-btn-primary" data-next>'+(isLast?(done?'Finish':'Done'):'Next')+'</button>'+
          '</div>'+
        '</div>'+
        '<div class="tgt-pop-arrow"></div>';

      pop.querySelector('[data-skip]').addEventListener('click', function(){ finish(false); });
      pop.querySelector('[data-next]').addEventListener('click', next);
      var pv = pop.querySelector('[data-prev]'); if (pv) pv.addEventListener('click', prev);

      requestAnimationFrame(function(){
        position();
        veil.classList.add('is-on');
        spot.classList.add('is-on');
        pop.classList.add('is-on');
      });
    }

    function position(){
      if (i<0 || !spot || !spot._el) return;
      var el = spot._el;
      if (!el.isConnected){ return; }
      var r = el.getBoundingClientRect();
      var pad = spot._padding;
      var x = Math.max(4, r.left - pad), y = Math.max(4, r.top - pad);
      var w = r.width + pad*2, h = r.height + pad*2;
      spot.style.left = x+'px'; spot.style.top = y+'px';
      spot.style.width = w+'px'; spot.style.height = h+'px';

      // place callout: prefer right, else left, else below, else above
      var pw = pop.offsetWidth || 312, ph = pop.offsetHeight || 160, gap = 16;
      var vw = window.innerWidth, vh = window.innerHeight;
      var want = pop.dataset.placement || 'auto';
      var order;
      if (want === 'auto') order = ['right','left','bottom','top'];
      else order = [want, 'right','left','bottom','top'];
      var place = order[0];
      var fit = false;
      for (var oi=0; oi<order.length; oi++){
        var c = order[oi];
        if (c==='right' && r.right + gap + pw <= vw - 8){ place=c; fit=true; break; }
        if (c==='left'  && r.left  - gap - pw >= 8){ place=c; fit=true; break; }
        if (c==='bottom'&& r.bottom + gap + ph <= vh - 8){ place=c; fit=true; break; }
        if (c==='top'   && r.top   - gap - ph >= 8){ place=c; fit=true; break; }
        place = c;
      }
      var arrow = pop.querySelector('.tgt-pop-arrow');
      // Target too big to sit a callout beside (e.g. the full-height preview):
      // float the callout centred over it and drop the arrow, rather than
      // cascading to a side that pushes it off-screen.
      if (!fit){
        var cx = clamp(r.left + r.width/2 - pw/2, 8, Math.max(8, vw - pw - 8));
        var cy = clamp(r.top + r.height/2 - ph/2, 8, Math.max(8, vh - ph - 8));
        pop.style.left = cx+'px'; pop.style.top = cy+'px';
        if (arrow) arrow.style.display='none';
        return;
      }
      var px, py, ax, ay, arot;
      if (place==='right'){ px=r.right+gap; py=clamp(r.top + r.height/2 - ph/2, 8, vh-ph-8); ax=-6; ay=clampLocal(r.top+r.height/2-py, 14, ph-26); arot='border-right:0;border-bottom:0'; }
      else if (place==='left'){ px=r.left-gap-pw; py=clamp(r.top + r.height/2 - ph/2, 8, vh-ph-8); ax=pw-6; ay=clampLocal(r.top+r.height/2-py, 14, ph-26); arot='border-left:0;border-top:0'; }
      else if (place==='bottom'){ py=r.bottom+gap; px=clamp(r.left + r.width/2 - pw/2, 8, vw-pw-8); ay=-6; ax=clampLocal(r.left+r.width/2-px, 14, pw-26); arot='border-bottom:0;border-right:0'; }
      else { py=r.top-gap-ph; px=clamp(r.left + r.width/2 - pw/2, 8, vw-pw-8); ay=ph-6; ax=clampLocal(r.left+r.width/2-px, 14, pw-26); arot='border-top:0;border-left:0'; }
      // final safety net — never allow the callout off-screen on any axis
      px = clamp(px, 8, Math.max(8, vw - pw - 8));
      py = clamp(py, 8, Math.max(8, vh - ph - 8));
      pop.style.left=px+'px'; pop.style.top=py+'px';
      if (arrow){ arrow.style.left=ax+'px'; arrow.style.top=ay+'px'; arrow.setAttribute('style', arrow.getAttribute('style')+';'+arot); }
    }
    function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }
    function clampLocal(v,min,max){ return Math.max(min, Math.min(max, v)); }

    function next(){ go(i+1); }
    function prev(){ go(i-1); }

    function finish(completed){

      teardownCard();
      if (veil) veil.classList.remove('is-on');
      if (spot){ spot.classList.remove('is-on'); spot.style.display='none'; }
      if (pop){ pop.classList.remove('is-on'); pop.style.display='none'; }
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
      document.removeEventListener('keydown', onKey);
      i = -1;
      if (completed && typeof config.onDone === 'function') { try{ config.onDone(); }catch(e){} }
    }

    var api = {
      start: function(){ ensureLayers(); if (welcome) showWelcome(function(){ go(0); }); else go(0); return api; },
      next: next, prev: prev, finish: finish,
      goTo: function(n){ go(n); }
    };
    return api;
  }

  // ── persistent launcher blob ────────────────────────────────────────────────
  function tourLauncher(opts){
    opts = opts || {};
    injectStyles();
    var id = opts.id || 'default';
    if (document.querySelector('.tgt-launch[data-tour="'+id+'"]')) return;
    var b = document.createElement('button');
    b.type='button'; b.className='tgt-launch'; b.setAttribute('data-tour', id);
    b.innerHTML = '<span class="tgt-launch-ico">'+ICON_PLAY+'</span> '+esc(opts.label||'Show me how');
    b.addEventListener('click', function(){ if (typeof opts.onClick==='function') opts.onClick(); });
    document.body.appendChild(b);
    requestAnimationFrame(function(){ setTimeout(function(){ b.classList.add('is-on'); }, 450); });
    return b;
  }

  window.tgse.tour = tour;
  window.tgse.tourLauncher = tourLauncher;
  window.tgse.isTourDismissed = isDismissed;
  window.tgse.tourVersion = '1.0.0';

})();
