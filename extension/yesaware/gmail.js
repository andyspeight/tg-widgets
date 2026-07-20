/**
 * YesAware — Gmail compose integration (content script).
 *
 * Two buttons beside Send:
 *   - Templates — insert a saved template at the caret (Phase 3).
 *   - Track — register a tracker, rewrite the body's links and drop in the open
 *     pixel (Phase 2, button-driven).
 *
 * The heavy string work is in tracking.js (pure, unit-tested). Resilience mirrors
 * scheduler-companion: the only Gmail landmarks relied on are the contenteditable
 * body and the Send button; if they move the buttons quietly don't appear and
 * Gmail is unaffected. All UI is shadow-DOM. Fetches go through the service worker
 * so the .travelify.io session cookie travels.
 */
'use strict';
(function () {
  var API = 'https://widgets.travelify.io';
  var BTN = 'data-ya-btn';
  var DONE = 'data-ya-done';
  var T = self.YesAwareTracking;

  function bg(path, method, body) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage({ type: 'ya-fetch', path: path, method: method || 'GET', body: body }, function (res) {
          if (chrome.runtime.lastError || !res) resolve({ ok: false, status: 0 });
          else resolve(res);
        });
      } catch (e) { resolve({ ok: false, status: 0 }); }
    });
  }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  // ── Compose landmarks ───────────────────────────────────────────────────────
  function findComposeBodies() {
    return Array.prototype.slice.call(document.querySelectorAll('div[contenteditable="true"][role="textbox"]'))
      .filter(function (el) { return (el.getAttribute('aria-label') || '').length > 0; });
  }
  function composeRootOf(body) {
    return body.closest('div.M9') || body.closest('div[role="dialog"]') || body.closest('table') || body.parentElement;
  }
  function findSendButton(root) {
    return root && root.querySelector('[role="button"][data-tooltip*="Send"], [role="button"][aria-label*="Send"]');
  }
  function subjectInputOf(root) { return root && root.querySelector('input[name="subjectbox"]'); }
  function subjectOf(root) { var s = subjectInputOf(root); return s ? s.value : ''; }
  function recipientsOf(root) {
    if (!root) return '';
    var out = [];
    Array.prototype.forEach.call(root.querySelectorAll('[email]'), function (c) {
      var e = c.getAttribute('email'); if (e && out.indexOf(e) === -1) out.push(e);
    });
    return out.join(', ');
  }

  // ── Caret-preserving insertion (from scheduler-companion) ────────────────────
  function captureRange(body) {
    var sel = window.getSelection();
    if (sel.rangeCount && body.contains(sel.anchorNode)) return sel.getRangeAt(0).cloneRange();
    return null;
  }
  function insertHtml(body, saved, html) {
    body.focus();
    var sel = window.getSelection();
    sel.removeAllRanges();
    if (saved && body.contains(saved.startContainer)) sel.addRange(saved);
    else { var r = document.createRange(); r.selectNodeContents(body); r.collapse(false); sel.addRange(r); }
    var done = false;
    try { done = document.execCommand('insertHTML', false, html); } catch (e) { /* fall through */ }
    if (!done) { body.appendChild(document.createRange().createContextualFragment(html)); }
    body.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // ── Styles ──────────────────────────────────────────────────────────────────
  var CSS =
    ':host{all:initial}' +
    '.wrap{display:inline-flex;gap:4px;vertical-align:middle;font-family:Inter,Arial,sans-serif}' +
    'button{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 12px;border:1px solid #C7D2E0;border-radius:8px;background:#fff;color:#1B2B5B;font:600 13px/1 Inter,Arial,sans-serif;cursor:pointer}' +
    'button:hover{border-color:#00B4D8}' +
    'button[data-on="1"]{background:#00B4D8;border-color:#00B4D8;color:#fff}' +
    'svg{width:15px;height:15px}';
  var POP_CSS =
    ':host{all:initial}' +
    '.box{position:fixed;z-index:2147483000;width:320px;max-width:calc(100vw - 24px);background:#fff;border:1px solid #E2E8F0;border-radius:12px;box-shadow:0 10px 38px rgba(15,23,42,.22);overflow:hidden;font-family:Inter,Arial,sans-serif;color:#0F172A}' +
    'header{display:flex;align-items:center;padding:10px 14px;border-bottom:1px solid #E2E8F0}' +
    'header b{font-size:13px;flex:1}header button{border:0;background:none;cursor:pointer;color:#64748B;font-size:15px}' +
    '.list{max-height:300px;overflow-y:auto;padding:6px}' +
    '.row{display:flex;align-items:center;gap:8px;padding:9px 10px;border-radius:8px;cursor:pointer}' +
    '.row:hover{background:#F1F5F9}' +
    '.row .nm{flex:1;font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.row .sj{font-size:11px;color:#64748B;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.state{padding:22px 16px;text-align:center;color:#64748B;font-size:13px;line-height:1.5}' +
    '.state a{color:#0891B2;font-weight:700;text-decoration:none}';
  var EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>';
  var TPL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="16" x2="13" y2="16"/></svg>';

  // ── Templates popover ────────────────────────────────────────────────────────
  var pop = null;
  function closePop() { if (pop && pop.host) pop.host.remove(); pop = null; document.removeEventListener('mousedown', onDocDown, true); }
  function onDocDown(e) { if (!pop) return; var ours = e.composedPath().some(function (n) { return n && n.getAttribute && n.hasAttribute && n.hasAttribute(BTN); }); if (!ours) closePop(); }

  function openTemplates(root, body, anchor) {
    closePop();
    var saved = captureRange(body);
    var host = document.createElement('div'); host.setAttribute(BTN, 'pop');
    var shadow = host.attachShadow({ mode: 'closed' });
    var style = document.createElement('style'); style.textContent = POP_CSS;
    var box = document.createElement('div'); box.className = 'box';
    shadow.append(style, box);
    document.body.appendChild(host);
    pop = { host: host };

    function paint(inner) {
      box.innerHTML = '<header><b>Insert a template</b><button type="button" data-x aria-label="Close">✕</button></header>' + inner;
      box.querySelector('[data-x]').addEventListener('click', closePop);
      var rect = anchor.getBoundingClientRect();
      var top = rect.top - box.offsetHeight - 8;
      box.style.left = Math.max(12, Math.min(rect.left, window.innerWidth - box.offsetWidth - 12)) + 'px';
      box.style.top = (top < 12 ? rect.bottom + 8 : top) + 'px';
    }
    paint('<div class="state">Loading templates…</div>');
    document.addEventListener('mousedown', onDocDown, true);

    bg('/api/track/templates', 'GET').then(function (res) {
      if (!pop || pop.host !== host) return;
      if (res.status === 401 || res.status === 403) { paint('<div class="state">Sign in to your Travelgenix dashboard first.<br><br><a href="' + API + '/signin" target="_blank" rel="noopener">Open sign-in</a></div>'); return; }
      if (!res.ok || !res.body || !Array.isArray(res.body.templates)) { paint('<div class="state">Could not load templates.</div>'); return; }
      var tpls = res.body.templates;
      if (!tpls.length) { paint('<div class="state">No templates yet.<br><a href="' + API + '/yesaware#templates" target="_blank" rel="noopener">Create one</a></div>'); return; }
      paint('<div class="list">' + tpls.map(function (t, i) {
        return '<div class="row" data-i="' + i + '"><div style="flex:1;min-width:0"><div class="nm">' + esc(t.name || 'Untitled') + '</div>' + (t.subject ? '<div class="sj">' + esc(t.subject) + '</div>' : '') + '</div></div>';
      }).join('') + '</div>');
      box.querySelectorAll('[data-i]').forEach(function (rowEl) {
        rowEl.addEventListener('click', function () {
          var t = tpls[Number(rowEl.getAttribute('data-i'))];
          if (!t) return;
          var subj = subjectInputOf(root);
          if (subj && !subj.value && t.subject) { subj.value = t.subject; subj.dispatchEvent(new Event('input', { bubbles: true })); }
          if (t.id) root.setAttribute('data-ya-tpl', t.id);
          closePop();
          insertHtml(body, saved, t.body || '');
        });
      });
    });
  }

  // ── Track action ────────────────────────────────────────────────────────────
  var busy = false;
  function label(btn, txt) { var s = btn.querySelector('span'); if (s) s.textContent = txt; }
  function reset(btn, txt, ms) { setTimeout(function () { label(btn, txt || 'Track'); }, ms || 1600); }

  function track(root, body, btn) {
    if (busy) return;
    if (root.getAttribute('data-ya-token')) { label(btn, 'Tracked ✓'); return; }
    busy = true;
    label(btn, 'Tracking…');

    var html = body.innerHTML;
    var links = (T ? T.extractLinks(html) : []).map(function (u) { return { url: u }; });
    var payload = { subject: subjectOf(root), recipient: recipientsOf(root), links: links };
    var tpl = root.getAttribute('data-ya-tpl'); if (tpl) payload.templateId = tpl;

    bg('/api/track/register', 'POST', payload).then(function (res) {
      busy = false;
      if (res.status === 401 || res.status === 403) { label(btn, 'Sign in'); reset(btn, 'Track', 2200); window.open(API + '/signin', '_blank', 'noopener'); return; }
      if (!res.ok || !res.body) { label(btn, 'Failed'); reset(btn); return; }
      var data = res.body;
      var map = T ? T.urlMapFromLinks(data.links) : {};
      body.innerHTML = T ? T.applyTracking(html, map, data.pixelHtml || '') : html;
      body.dispatchEvent(new Event('input', { bubbles: true }));
      root.setAttribute('data-ya-token', data.token || '1');
      btn.setAttribute('data-on', '1');
      label(btn, 'Tracked ✓');
    });
  }

  // ── Inject ──────────────────────────────────────────────────────────────────
  function injectFor(body) {
    var root = composeRootOf(body);
    if (!root || root.hasAttribute(DONE)) return;
    var send = findSendButton(root);
    if (!send || !send.parentElement) return;
    root.setAttribute(DONE, '1');

    var host = document.createElement('span');
    host.setAttribute(BTN, '1');
    var shadow = host.attachShadow({ mode: 'closed' });
    var style = document.createElement('style'); style.textContent = CSS;
    var wrap = document.createElement('span'); wrap.className = 'wrap';
    var tplBtn = document.createElement('button'); tplBtn.type = 'button'; tplBtn.title = 'Insert a saved template'; tplBtn.innerHTML = TPL + '<span>Templates</span>';
    var trkBtn = document.createElement('button'); trkBtn.type = 'button'; trkBtn.title = 'Track opens and clicks for this email'; trkBtn.innerHTML = EYE + '<span>Track</span>';
    wrap.append(tplBtn, trkBtn);
    shadow.append(style, wrap);

    [tplBtn, trkBtn].forEach(function (b) { b.addEventListener('mousedown', function (e) { e.preventDefault(); }); });
    tplBtn.addEventListener('click', function () { openTemplates(root, body, tplBtn); });
    trkBtn.addEventListener('click', function () { track(root, body, trkBtn); });

    send.parentElement.insertBefore(host, send.nextSibling);
  }

  var queued = false;
  function scan() { queued = false; findComposeBodies().forEach(function (b) { try { injectFor(b); } catch (e) { /* never break Gmail */ } }); }
  var mo = new MutationObserver(function () { if (queued) return; queued = true; setTimeout(scan, 400); });
  mo.observe(document.documentElement, { childList: true, subtree: true });
  scan();
})();
