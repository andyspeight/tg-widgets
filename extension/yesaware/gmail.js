/**
 * YesAware — Gmail compose integration (content script). Phase 2: button-driven.
 *
 * Adds a "Track" button beside Send in every compose window. Clicking it
 * registers a tracker for the email, rewrites the links in the body to tracked
 * redirects and drops in an invisible open pixel. The heavy lifting is the pure
 * code in tracking.js; this file is just the Gmail glue.
 *
 * Resilience (mirrors scheduler-companion): the ONLY selectors relied on are the
 * contenteditable message body and the Send button's tooltip/aria-label, both
 * stable Gmail landmarks. If either moves, the button quietly doesn't appear and
 * Gmail is unaffected. All UI lives in a shadow root. Fetches go via the service
 * worker so the session cookie stays home.
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
  function subjectOf(root) { var s = root && root.querySelector('input[name="subjectbox"]'); return s ? s.value : ''; }
  function recipientsOf(root) {
    if (!root) return '';
    var out = [];
    Array.prototype.forEach.call(root.querySelectorAll('[email]'), function (c) {
      var e = c.getAttribute('email');
      if (e && out.indexOf(e) === -1) out.push(e);
    });
    return out.join(', ');
  }

  // ── Button ──────────────────────────────────────────────────────────────────
  var CSS = ':host{all:initial} button{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 12px;margin:0 4px;border:1px solid #C7D2E0;border-radius:8px;background:#fff;color:#1B2B5B;font:600 13px/1 Inter,Arial,sans-serif;cursor:pointer;vertical-align:middle} button:hover{border-color:#00B4D8} button[data-on="1"]{background:#00B4D8;border-color:#00B4D8;color:#fff} svg{width:15px;height:15px}';
  var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>';

  function injectFor(body) {
    var root = composeRootOf(body);
    if (!root || root.hasAttribute(DONE)) return;
    var send = findSendButton(root);
    if (!send || !send.parentElement) return; // Gmail shifted — retry next scan
    root.setAttribute(DONE, '1');

    var host = document.createElement('span');
    host.setAttribute(BTN, '1');
    var shadow = host.attachShadow({ mode: 'closed' });
    var style = document.createElement('style'); style.textContent = CSS;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.title = 'Track opens and clicks for this email';
    btn.innerHTML = ICON + '<span>Track</span>';
    shadow.append(style, btn);

    // Never steal the caret from the compose body.
    btn.addEventListener('mousedown', function (e) { e.preventDefault(); });
    btn.addEventListener('click', function () { track(root, body, btn); });

    send.parentElement.insertBefore(host, send.nextSibling);
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

    bg('/api/track/register', 'POST', {
      subject: subjectOf(root),
      recipient: recipientsOf(root),
      links: links
    }).then(function (res) {
      busy = false;
      if (res.status === 401 || res.status === 403) { label(btn, 'Sign in'); reset(btn, 'Track', 2200); window.open(API + '/signin', '_blank', 'noopener'); return; }
      if (!res.ok || !res.body) { label(btn, 'Failed'); reset(btn); return; }

      var data = res.body;
      var map = T ? T.urlMapFromLinks(data.links) : {};
      body.innerHTML = T ? T.applyTracking(html, map, data.pixelHtml || '') : html;
      body.dispatchEvent(new Event('input', { bubbles: true })); // let Gmail notice
      root.setAttribute('data-ya-token', data.token || '1');
      btn.setAttribute('data-on', '1');
      label(btn, 'Tracked ✓');
    });
  }

  // ── Scan ────────────────────────────────────────────────────────────────────
  var queued = false;
  function scan() { queued = false; findComposeBodies().forEach(function (b) { try { injectFor(b); } catch (e) { /* never break Gmail */ } }); }
  var mo = new MutationObserver(function () { if (queued) return; queued = true; setTimeout(scan, 400); });
  mo.observe(document.documentElement, { childList: true, subtree: true });
  scan();
})();
