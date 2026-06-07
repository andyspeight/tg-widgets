/* ==========================================================================
   Luna Copilot  -  dashboard-copilot.js
   Drop-in agent-assist panel for the Luna Chat dashboard.

   What it adds, sitting just above the reply box:
     - Suggest replies : 3 grounded, ready-to-send options (click to insert)
     - Improve / Friendlier / Shorter / More detail : rewrites the live draft
     - Summarise : a glanceable thread handover
     - Translate : the draft, or the last incoming message

   Integration: it reuses the dashboard's own design tokens, reads the live
   transcript from the existing .msg / .msg-bubble nodes, and inserts text
   into #msgInput exactly the way the canned-response feature already does.
   It is fully defensive: if the page shape changes it logs once and no-ops,
   it never throws into the dashboard, and it only ever calls one server
   endpoint (the hardened /api/luna-copilot route).

   To wire it up, add ONE line near the end of dashboard.html, before </body>:
     <script src="/dashboard-copilot.js" defer></script>
   Optional override (e.g. local dev):
     <script>window.LUNA_COPILOT_ENDPOINT = 'https://luna-chat-endpoint.vercel.app/api/luna-copilot';</script>
   ========================================================================== */
(function () {
  'use strict';
  if (window.__lunaCopilotLoaded) return;
  window.__lunaCopilotLoaded = true;

  var ENDPOINT = window.LUNA_COPILOT_ENDPOINT ||
    'https://luna-chat-endpoint.vercel.app/api/luna-copilot';

  // ---- credentials (same source the dashboard authenticates with) ---------
  function param(name) {
    try { return new URLSearchParams(window.location.search).get(name) || ''; }
    catch (e) { return ''; }
  }
  function creds() {
    var C = window.CONFIG || {};
    return {
      clientId: C.CLIENT_ID || param('clientId') || '',
      client:   C.CLIENT_NAME || param('client') || ''  // for display/logging only
    };
  }

  // ---- tiny utils ---------------------------------------------------------
  function el(tag, cls, attrs) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }
  function svg(paths, extra) {
    var s = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      paths + '</svg>';
    return s;
  }
  var ICON = {
    spark: svg('<path d="M12 3l1.6 4.3L18 9l-4.4 1.7L12 15l-1.6-4.3L6 9l4.4-1.7z"/><path d="M19 14l.7 1.9L21.6 16l-1.9.7L19 18.6l-.7-1.9L16.4 16l1.9-.7z"/>'),
    wand:  svg('<path d="M15 4V2M15 10V8M11 6H9M21 6h-2"/><path d="M3 21l9-9"/><path d="M12.5 6.5l5 5"/>'),
    heart: svg('<path d="M19 14c1.5-1.5 3-3.3 3-5.5A4.5 4.5 0 0012 5 4.5 4.5 0 002 8.5c0 2.2 1.5 4 3 5.5l7 7z"/>'),
    cut:   svg('<path d="M4 7h16M4 12h10M4 17h7"/>'),
    plus:  svg('<path d="M4 7h16M4 12h16M4 17h10"/>'),
    list:  svg('<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>'),
    globe: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18"/>'),
    undo:  svg('<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 015 5 5 5 0 01-5 5H9"/>'),
    close: svg('<path d="M6 6l12 12M18 6L6 18"/>')
  };
  function reduceMotion() {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (e) { return false; }
  }

  // ---- read the live conversation -----------------------------------------
  function readTranscript() {
    var box = document.getElementById('chatMessages');
    if (!box) return [];
    var out = [];
    box.querySelectorAll('.msg').forEach(function (m) {
      var from = m.classList.contains('visitor') ? 'visitor'
        : m.classList.contains('agent') ? 'agent'
        : m.classList.contains('ai') ? 'ai'
        : 'visitor';
      var bub = m.querySelector('.msg-bubble');
      var text = (bub ? bub.textContent : m.textContent || '').trim();
      if (text) out.push({ from: from, text: text });
    });
    return out.slice(-24);
  }
  function lastVisitorMessage() {
    var t = readTranscript();
    for (var i = t.length - 1; i >= 0; i--) if (t[i].from === 'visitor') return t[i].text;
    return '';
  }

  // ---- composer helpers (mirror the canned-response behaviour) ------------
  function input() { return document.getElementById('msgInput'); }
  function setDraft(text) {
    var ta = input();
    if (!ta) return;
    ta.value = text;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.focus();
    try { ta.selectionStart = ta.selectionEnd = ta.value.length; } catch (e) {}
  }
  function getDraft() { var ta = input(); return ta ? ta.value : ''; }

  // ---- styles (inherit dashboard tokens, with safe fallbacks) -------------
  function injectStyles() {
    if (document.getElementById('lcp-styles')) return;
    var css = `
    .lcp-wrap{margin:0 0 var(--space-2,8px);font-family:var(--font,inherit);
      animation:lcp-in .28s ease both}
    @media (prefers-reduced-motion: reduce){.lcp-wrap,.lcp-card,.lcp-result{animation:none!important}}
    @keyframes lcp-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
    .lcp-bar{display:flex;align-items:center;gap:var(--space-2,8px);flex-wrap:wrap}
    .lcp-tag{display:inline-flex;align-items:center;gap:6px;font-size:var(--text-xs,11px);
      font-weight:600;letter-spacing:.02em;color:var(--text-muted,#94a3b8);text-transform:uppercase}
    .lcp-tag svg{color:var(--teal,#00b4d8)}
    .lcp-btn{display:inline-flex;align-items:center;gap:6px;cursor:pointer;
      font-family:inherit;font-size:var(--text-sm,13px);font-weight:600;
      padding:7px 11px;border-radius:var(--radius-full,999px);
      border:1px solid var(--border,#e2e8f0);background:var(--surface-raised,#f8fafc);
      color:var(--text,#0f172a);transition:transform .12s ease,background .15s,border-color .15s,box-shadow .15s;
      line-height:1;white-space:nowrap}
    .lcp-btn svg{color:var(--text-muted,#94a3b8);transition:color .15s}
    .lcp-btn:hover{border-color:var(--teal,#00b4d8);background:var(--surface,#fff)}
    .lcp-btn:hover svg{color:var(--teal,#00b4d8)}
    .lcp-btn:active{transform:translateY(1px)}
    .lcp-btn:focus-visible{outline:none;box-shadow:0 0 0 3px var(--teal-glow,rgba(0,180,216,.25))}
    .lcp-btn[disabled]{opacity:.5;cursor:not-allowed;transform:none}
    .lcp-btn--primary{color:#fff;border-color:transparent;
      background:linear-gradient(135deg,var(--teal,#00b4d8),var(--teal-dark,#0096b7))}
    .lcp-btn--primary svg{color:#fff}
    .lcp-btn--primary:hover{box-shadow:0 6px 18px var(--teal-glow,rgba(0,180,216,.35));background:linear-gradient(135deg,var(--teal,#00b4d8),var(--teal-dark,#0096b7))}
    .lcp-panel{margin-bottom:var(--space-2,8px);display:none;flex-direction:column;gap:var(--space-2,8px)}
    .lcp-panel.open{display:flex}
    .lcp-card{position:relative;text-align:left;cursor:pointer;font-family:inherit;
      padding:11px 13px 11px 15px;border-radius:var(--radius-md,10px);
      border:1px solid var(--border,#e2e8f0);background:var(--surface,#fff);
      color:var(--text,#0f172a);font-size:var(--text-sm,13px);line-height:1.5;
      transition:transform .12s ease,border-color .15s,box-shadow .15s;
      animation:lcp-in .26s ease both;width:100%}
    .lcp-card:hover{border-color:var(--teal,#00b4d8);box-shadow:var(--shadow-md,0 4px 14px rgba(15,23,42,.08));transform:translateY(-1px)}
    .lcp-card:focus-visible{outline:none;box-shadow:0 0 0 3px var(--teal-glow,rgba(0,180,216,.25))}
    .lcp-card::before{content:"";position:absolute;left:0;top:8px;bottom:8px;width:3px;border-radius:3px;background:var(--c,var(--teal,#00b4d8))}
    .lcp-card[data-basis="knowledge"]{--c:var(--teal,#00b4d8)}
    .lcp-card[data-basis="conversation"]{--c:var(--amber,#f59e0b)}
    .lcp-card[data-basis="general"]{--c:var(--text-muted,#94a3b8)}
    .lcp-pill{display:inline-flex;align-items:center;gap:5px;margin-bottom:6px;
      font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;
      color:var(--c,var(--teal,#00b4d8))}
    .lcp-pill::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--c,var(--teal,#00b4d8))}
    .lcp-card .lcp-ins{position:absolute;right:10px;top:10px;font-size:10px;font-weight:700;
      color:var(--text-muted,#94a3b8);opacity:0;transition:opacity .15s}
    .lcp-card:hover .lcp-ins{opacity:1}
    .lcp-result{padding:12px 14px;border-radius:var(--radius-md,10px);
      border:1px solid var(--border,#e2e8f0);background:var(--surface-raised,#f8fafc);
      color:var(--text,#0f172a);font-size:var(--text-sm,13px);line-height:1.55;
      white-space:pre-wrap;animation:lcp-in .26s ease both}
    .lcp-result-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
    .lcp-result-actions{display:flex;gap:6px}
    .lcp-mini{display:inline-flex;align-items:center;gap:5px;cursor:pointer;border:none;
      font-family:inherit;font-size:var(--text-xs,11px);font-weight:600;padding:5px 9px;
      border-radius:var(--radius-sm,7px);background:var(--surface,#fff);color:var(--text,#0f172a);
      border:1px solid var(--border,#e2e8f0);transition:border-color .15s,color .15s}
    .lcp-mini:hover{border-color:var(--teal,#00b4d8);color:var(--teal,#00b4d8)}
    .lcp-mini--go{background:var(--teal,#00b4d8);color:#fff;border-color:transparent}
    .lcp-mini--go:hover{color:#fff;filter:brightness(1.05)}
    .lcp-skel{height:54px;border-radius:var(--radius-md,10px);
      background:linear-gradient(100deg,var(--surface-raised,#f1f5f9) 30%,var(--border-light,#e9eef5) 50%,var(--surface-raised,#f1f5f9) 70%);
      background-size:200% 100%;animation:lcp-shimmer 1.1s linear infinite}
    @keyframes lcp-shimmer{from{background-position:200% 0}to{background-position:-200% 0}}
    .lcp-note{font-size:var(--text-xs,11px);color:var(--text-muted,#94a3b8);padding:2px 2px}
    .lcp-err{color:var(--red,#ef4444)}
    .lcp-menu{position:relative}
    .lcp-pop{position:absolute;bottom:calc(100% + 6px);left:0;z-index:40;display:none;
      flex-direction:column;min-width:150px;padding:6px;border-radius:var(--radius-md,10px);
      background:var(--surface,#fff);border:1px solid var(--border,#e2e8f0);
      box-shadow:var(--shadow-lg,0 12px 30px rgba(15,23,42,.16))}
    .lcp-pop.open{display:flex}
    .lcp-pop button{text-align:left;cursor:pointer;border:none;background:none;font-family:inherit;
      font-size:var(--text-sm,13px);color:var(--text,#0f172a);padding:7px 9px;border-radius:var(--radius-sm,7px)}
    .lcp-pop button:hover{background:var(--surface-raised,#f1f5f9);color:var(--teal,#00b4d8)}
    .lcp-spin{width:13px;height:13px;border-radius:50%;border:2px solid currentColor;
      border-right-color:transparent;display:inline-block;animation:lcp-rot .7s linear infinite}
    @keyframes lcp-rot{to{transform:rotate(360deg)}}
    `;
    var tag = el('style'); tag.id = 'lcp-styles'; tag.textContent = css;
    document.head.appendChild(tag);
  }

  // ---- network ------------------------------------------------------------
  function api(payload) {
    var c = creds();
    return fetch(ENDPOINT, {
      method: 'POST',
      credentials: 'include',                       // send the tg_session cookie
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ clientId: c.clientId }, payload))
    }).then(function (res) {
      return res.json().catch(function () { return { ok: false, error: 'Bad response' }; })
        .then(function (data) {
          if (!res.ok || !data.ok) throw new Error(data.error || ('Error ' + res.status));
          return data;
        });
    });
  }

  // ---- UI state -----------------------------------------------------------
  var ui = {};
  var busy = false;

  function openPanel(node) {
    ui.panel.innerHTML = '';
    if (node) ui.panel.appendChild(node);
    ui.panel.classList.add('open');
  }
  function closePanel() { ui.panel.classList.remove('open'); ui.panel.innerHTML = ''; }

  function skeletons(n) {
    var frag = document.createDocumentFragment();
    for (var i = 0; i < n; i++) frag.appendChild(el('div', 'lcp-skel'));
    var w = el('div'); w.style.display = 'flex'; w.style.flexDirection = 'column';
    w.style.gap = 'var(--space-2,8px)'; w.appendChild(frag);
    return w;
  }
  function noteBox(msg, isErr) {
    var n = el('div', 'lcp-note' + (isErr ? ' lcp-err' : '')); n.textContent = msg; return n;
  }
  function setBusy(state, btn) {
    busy = state;
    ui.buttons.forEach(function (b) { b.disabled = state; });
    if (btn) {
      if (state) { btn._html = btn.innerHTML; btn.innerHTML = '<span class="lcp-spin"></span>' + (btn.dataset.label || ''); }
      else if (btn._html) { btn.innerHTML = btn._html; }
    }
  }

  // ---- actions ------------------------------------------------------------
  function doSuggest(btn) {
    if (busy) return;
    var transcript = readTranscript();
    if (!transcript.length) { openPanel(noteBox('Open a conversation first, then I can suggest replies.')); return; }
    setBusy(true, btn);
    openPanel(skeletons(3));
    api({ action: 'suggest', transcript: transcript })
      .then(function (data) { renderSuggestions(data.suggestions); })
      .catch(function (e) { openPanel(noteBox(e.message, true)); })
      .finally(function () { setBusy(false, btn); });
  }

  function renderSuggestions(list) {
    var wrap = el('div'); wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column'; wrap.style.gap = 'var(--space-2,8px)';
    var head = el('div', 'lcp-result-head');
    head.appendChild(tagLabel('Suggested replies'));
    var close = el('button', 'lcp-mini'); close.innerHTML = ICON.close; close.setAttribute('aria-label', 'Dismiss');
    close.addEventListener('click', closePanel); head.appendChild(close);
    wrap.appendChild(head);

    list.forEach(function (s, i) {
      var card = el('button', 'lcp-card', { 'data-basis': s.basis, 'type': 'button' });
      card.style.animationDelay = reduceMotion() ? '0s' : (i * 0.05) + 's';
      var label = s.basis === 'knowledge' ? 'From your knowledge'
        : s.basis === 'conversation' ? 'From the chat' : 'Suggested';
      var pill = el('span', 'lcp-pill'); pill.textContent = label;
      var body = el('div'); body.textContent = s.text;
      var ins = el('span', 'lcp-ins'); ins.textContent = 'Click to insert';
      card.appendChild(pill); card.appendChild(body); card.appendChild(ins);
      card.addEventListener('click', function () { setDraft(s.text); closePanel(); });
      wrap.appendChild(card);
    });
    openPanel(wrap);
  }

  function tagLabel(text) {
    var t = el('span', 'lcp-tag'); t.innerHTML = ICON.spark + '<span>' + text + '</span>'; return t;
  }

  function doRephrase(style, btn) {
    if (busy) return;
    var draft = getDraft().trim();
    if (!draft) { openPanel(noteBox('Type a reply first, then I can rework it.')); return; }
    setBusy(true, btn);
    openPanel(skeletons(1));
    api({ action: 'rephrase', style: style, draft: draft, transcript: readTranscript() })
      .then(function (data) { showResult(data.result, { insertReplaces: true, prev: draft, title: 'Reworked' }); })
      .catch(function (e) { openPanel(noteBox(e.message, true)); })
      .finally(function () { setBusy(false, btn); });
  }

  function doSummarise(btn) {
    if (busy) return;
    var transcript = readTranscript();
    if (!transcript.length) { openPanel(noteBox('Nothing to summarise yet.')); return; }
    setBusy(true, btn);
    openPanel(skeletons(1));
    api({ action: 'summarise', transcript: transcript })
      .then(function (data) { showResult(data.result, { title: 'Thread summary' }); })
      .catch(function (e) { openPanel(noteBox(e.message, true)); })
      .finally(function () { setBusy(false, btn); });
  }

  function doTranslate(lang, btn) {
    if (busy) return;
    var draft = getDraft().trim();
    var text = draft || lastVisitorMessage();
    if (!text) { openPanel(noteBox('Nothing to translate yet.')); return; }
    setBusy(true, btn);
    openPanel(skeletons(1));
    api({ action: 'translate', text: text, targetLang: lang, transcript: readTranscript() })
      .then(function (data) {
        showResult(data.result, {
          title: 'In ' + lang,
          insertReplaces: !!draft, prev: draft,
          // if it was the visitor's message, offer insert as a fresh draft
          insertFresh: !draft
        });
      })
      .catch(function (e) { openPanel(noteBox(e.message, true)); })
      .finally(function () { setBusy(false, btn); });
  }

  function showResult(text, opts) {
    opts = opts || {};
    var wrap = el('div', 'lcp-result');
    var head = el('div', 'lcp-result-head');
    head.appendChild(tagLabel(opts.title || 'Result'));
    var actions = el('div', 'lcp-result-actions');

    if (opts.insertReplaces || opts.insertFresh) {
      var use = el('button', 'lcp-mini lcp-mini--go'); use.textContent = opts.insertReplaces ? 'Replace draft' : 'Use as reply';
      use.addEventListener('click', function () {
        var prev = getDraft();
        setDraft(text);
        // offer undo
        showUndo(prev);
        closePanel();
      });
      actions.appendChild(use);
    }
    var copy = el('button', 'lcp-mini'); copy.textContent = 'Copy';
    copy.addEventListener('click', function () {
      try { navigator.clipboard.writeText(text); copy.textContent = 'Copied'; setTimeout(function () { copy.textContent = 'Copy'; }, 1400); } catch (e) {}
    });
    actions.appendChild(copy);
    var close = el('button', 'lcp-mini'); close.innerHTML = ICON.close; close.setAttribute('aria-label', 'Dismiss');
    close.addEventListener('click', closePanel);
    actions.appendChild(close);

    head.appendChild(actions);
    var body = el('div'); body.style.whiteSpace = 'pre-wrap'; body.textContent = text;
    wrap.appendChild(head); wrap.appendChild(body);
    openPanel(wrap);
  }

  var undoTimer = null;
  function showUndo(prev) {
    clearTimeout(undoTimer);
    var bar = el('div', 'lcp-result');
    bar.style.display = 'flex'; bar.style.alignItems = 'center'; bar.style.justifyContent = 'space-between';
    var label = el('span', 'lcp-note'); label.textContent = 'Draft replaced.';
    var btn = el('button', 'lcp-mini'); btn.innerHTML = ICON.undo + '<span>Undo</span>';
    btn.addEventListener('click', function () { setDraft(prev); closePanel(); });
    bar.appendChild(label); bar.appendChild(btn);
    openPanel(bar);
    undoTimer = setTimeout(function () { if (ui.panel.contains(bar)) closePanel(); }, 8000);
  }

  // ---- build the bar ------------------------------------------------------
  function chip(label, icon, opts) {
    var b = el('button', 'lcp-btn' + (opts && opts.primary ? ' lcp-btn--primary' : ''), { 'type': 'button' });
    b.dataset.label = label;
    b.innerHTML = icon + '<span>' + label + '</span>';
    if (opts && opts.title) b.setAttribute('aria-label', opts.title);
    return b;
  }

  function build() {
    var ta = input();
    if (!ta || document.getElementById('lcp-wrap')) return;
    injectStyles();

    var wrap = el('div', 'lcp-wrap'); wrap.id = 'lcp-wrap';
    var panel = el('div', 'lcp-panel', { 'aria-live': 'polite' });
    var bar = el('div', 'lcp-bar');

    var suggest = chip('Suggest replies', ICON.spark, { primary: true, title: 'Suggest replies' });
    var improve = chip('Improve', ICON.wand);
    var friend  = chip('Friendlier', ICON.heart);
    var shorter = chip('Shorter', ICON.cut);
    var detail  = chip('More detail', ICON.plus);
    var summary = chip('Summarise', ICON.list);

    // translate menu
    var menu = el('div', 'lcp-menu');
    var translate = chip('Translate', ICON.globe);
    var pop = el('div', 'lcp-pop');
    ['English', 'French', 'Spanish', 'German', 'Italian', 'Portuguese', 'Dutch', 'Polish', 'Arabic'].forEach(function (lng) {
      var b = el('button', null, { 'type': 'button' }); b.textContent = lng;
      b.addEventListener('click', function () { pop.classList.remove('open'); doTranslate(lng, translate); });
      pop.appendChild(b);
    });
    translate.addEventListener('click', function (e) { e.stopPropagation(); pop.classList.toggle('open'); });
    document.addEventListener('click', function () { pop.classList.remove('open'); });
    menu.appendChild(translate); menu.appendChild(pop);

    suggest.addEventListener('click', function () { doSuggest(suggest); });
    improve.addEventListener('click', function () { doRephrase('improve', improve); });
    friend.addEventListener('click', function () { doRephrase('friendlier', friend); });
    shorter.addEventListener('click', function () { doRephrase('shorter', shorter); });
    detail.addEventListener('click', function () { doRephrase('detailed', detail); });
    summary.addEventListener('click', function () { doSummarise(summary); });

    bar.appendChild(tagLabel('Copilot'));
    [suggest, improve, friend, shorter, detail, summary, menu].forEach(function (n) { bar.appendChild(n); });

    wrap.appendChild(panel); wrap.appendChild(bar);
    ta.parentNode.insertBefore(wrap, ta);

    ui.panel = panel;
    ui.buttons = [suggest, improve, friend, shorter, detail, summary, translate];

    // keyboard: Cmd/Ctrl+J suggests, Esc clears the panel
    document.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'j' || e.key === 'J')) { e.preventDefault(); doSuggest(suggest); }
      else if (e.key === 'Escape' && ui.panel.classList.contains('open')) { closePanel(); }
    });
  }

  // ---- mount (wait for the composer to exist, survive re-renders) ----------
  function tryBuild() {
    try { build(); } catch (e) {
      if (!window.__lcpWarned) { window.__lcpWarned = true; console.warn('Luna Copilot: could not mount,', e && e.message); }
    }
  }
  function start() {
    tryBuild();
    if (document.getElementById('lcp-wrap')) return;
    var tries = 0;
    var iv = setInterval(function () {
      tries++;
      tryBuild();
      if (document.getElementById('lcp-wrap') || tries > 40) clearInterval(iv);
    }, 300);
    // also rebuild if the composer is swapped out by the dashboard
    try {
      var obs = new MutationObserver(function () {
        if (!document.getElementById('lcp-wrap') && input()) tryBuild();
      });
      obs.observe(document.body, { childList: true, subtree: true });
    } catch (e) {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
