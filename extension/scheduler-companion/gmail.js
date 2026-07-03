/**
 * Travelgenix Scheduler — Gmail compose integration (content script).
 *
 * Adds a Travelgenix button beside Send in every Gmail compose window. The
 * button opens a popover with the account's schedulers:
 *   - "Link"  inserts the scheduler's standing booking page as a tidy anchor
 *     at the caret.
 *   - "Times" embeds the hosted share flow (?mode=insert) — pick slots,
 *     tweak the wording, and the composed snippet lands at the caret, every
 *     time a one-click booking link.
 *
 * Design constraints honoured here:
 *   - Gmail's DOM is obfuscated and shifts; the ONLY selectors relied on are
 *     the contenteditable message body and the Send button's data-tooltip /
 *     aria-label, both stable landmarks for years. If either vanishes the
 *     script does nothing — Gmail keeps working, we just don't appear.
 *   - All UI lives in shadow roots so Gmail's styles and ours never mix.
 *   - Data comes via the service worker (tgs-fetch): content-script fetches
 *     run as mail.google.com and the SameSite session cookie stays home.
 *   - The share iframe hands its snippet back via postMessage, validated by
 *     BOTH origin and a nonce minted per popover — nothing else is accepted.
 */
'use strict';

(function () {
  const API = 'https://widgets.travelify.io';
  const BTN_MARK = 'data-tgs-btn';
  const ROOT_MARK = 'data-tgs-done';

  let schedulers = null; // cached for the tab's lifetime; refreshed on auth change
  let popover = null;    // { host, targetBody, savedRange, nonce }

  // ── Service-worker bridge ────────────────────────────────────────────────
  function bg(path) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: 'tgs-fetch', path }, (res) => {
          if (chrome.runtime.lastError || !res) resolve({ ok: false, status: 0 });
          else resolve(res);
        });
      } catch (e) { resolve({ ok: false, status: 0 }); }
    });
  }

  // ── Caret-preserving insertion ───────────────────────────────────────────
  function captureRange(body) {
    const sel = window.getSelection();
    if (sel.rangeCount && body.contains(sel.anchorNode)) return sel.getRangeAt(0).cloneRange();
    return null;
  }
  function insertHtml(body, savedRange, html) {
    body.focus();
    const sel = window.getSelection();
    sel.removeAllRanges();
    if (savedRange && body.contains(savedRange.startContainer)) {
      sel.addRange(savedRange);
    } else {
      const r = document.createRange();
      r.selectNodeContents(body);
      r.collapse(false); // caret to the end
      sel.addRange(r);
    }
    let done = false;
    try { done = document.execCommand('insertHTML', false, html); } catch (e) { /* fall through */ }
    if (!done) {
      const frag = document.createRange().createContextualFragment(html);
      body.appendChild(frag);
    }
    body.dispatchEvent(new Event('input', { bubbles: true })); // let Gmail notice
  }

  // ── Popover ──────────────────────────────────────────────────────────────
  function closePopover() {
    if (popover && popover.host) popover.host.remove();
    popover = null;
    window.removeEventListener('message', onShareMessage);
    document.removeEventListener('mousedown', onDocDown, true);
  }
  function onDocDown(e) {
    if (!popover || !popover.host) return;
    // Ignore clicks inside the popover AND on any of our toolbar buttons —
    // the button's own click handler owns the toggle (close-then-reopen
    // otherwise makes the button feel stuck-open).
    const ours = e.composedPath().some((n) => n && n.getAttribute && n.hasAttribute(BTN_MARK));
    if (!ours) closePopover();
  }
  function onShareMessage(e) {
    if (!popover) return;
    if (e.origin !== API) return;
    const d = e.data;
    if (!d || d.type !== 'tgs-insert' || d.nonce !== popover.nonce) return;
    if (typeof d.html !== 'string' || !d.html) return;
    const { targetBody, savedRange } = popover;
    closePopover();
    insertHtml(targetBody, savedRange, d.html);
  }

  const POPOVER_CSS = `
    :host { all: initial; }
    .box {
      position: fixed; z-index: 2147483000; width: 400px; max-width: calc(100vw - 24px);
      background: #fff; border: 1px solid #E2E8F0; border-radius: 14px;
      box-shadow: 0 10px 38px rgba(15,23,42,.22); overflow: hidden;
      font-family: 'Inter', system-ui, -apple-system, sans-serif; color: #0F172A;
      display: flex; flex-direction: column;
    }
    header { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-bottom: 1px solid #E2E8F0; }
    header b { font-size: 13.5px; flex: 1; }
    header button { border: 0; background: none; cursor: pointer; color: #64748B; font-size: 16px; padding: 2px 6px; }
    header button:hover { color: #0F172A; }
    .list { padding: 10px 12px; max-height: 46vh; overflow-y: auto; }
    .row { display: flex; align-items: center; gap: 8px; padding: 8px 6px; border-bottom: 1px solid #F1F5F9; }
    .row:last-child { border-bottom: 0; }
    .row .name { flex: 1; font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .row button {
      border: 1px solid #E2E8F0; background: #fff; border-radius: 8px; cursor: pointer;
      font-family: inherit; font-size: 12px; font-weight: 700; padding: 6px 11px; color: #0F172A;
    }
    .row button:hover { border-color: #0891B2; color: #0891B2; }
    .row button.primary { background: #0891B2; border-color: #0891B2; color: #fff; }
    .row button.primary:hover { opacity: .92; color: #fff; }
    .state { padding: 24px 16px; text-align: center; color: #64748B; font-size: 13px; line-height: 1.6; }
    .state a { color: #0891B2; font-weight: 700; text-decoration: none; }
    iframe { width: 100%; height: min(66vh, 620px); border: 0; display: block; background: #F1F5F9; }
  `;

  function positionBox(box, anchorRect) {
    const pad = 12;
    let left = Math.min(anchorRect.left, window.innerWidth - box.offsetWidth - pad);
    left = Math.max(pad, left);
    let top = anchorRect.top - box.offsetHeight - 10;
    if (top < pad) top = Math.min(anchorRect.bottom + 10, window.innerHeight - box.offsetHeight - pad);
    box.style.left = left + 'px';
    box.style.top = Math.max(pad, top) + 'px';
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function openPopover(anchor, targetBody) {
    closePopover();
    const savedRange = captureRange(targetBody);
    const nonce = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');

    const host = document.createElement('div');
    host.setAttribute(BTN_MARK, 'popover');
    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = POPOVER_CSS;
    const box = document.createElement('div');
    box.className = 'box';
    shadow.append(style, box);
    document.body.appendChild(host);
    popover = { host, targetBody, savedRange, nonce };

    const paint = (inner) => {
      box.innerHTML = '<header><b>Travelgenix — insert into email</b><button type="button" data-x aria-label="Close">✕</button></header>' + inner;
      box.querySelector('[data-x]').addEventListener('click', closePopover);
      positionBox(box, anchor.getBoundingClientRect());
    };

    paint('<div class="state">Loading your schedulers…</div>');
    document.addEventListener('mousedown', onDocDown, true);
    window.addEventListener('message', onShareMessage);

    if (!schedulers) {
      const res = await bg('/api/widget-list');
      if (!popover || popover.host !== host) return; // closed while loading
      if (res.status === 401 || res.status === 403) {
        paint('<div class="state">Sign in to your Travelgenix dashboard first, then try again.<br><br><a href="' + API + '/signin" target="_blank" rel="noopener">Open sign-in</a></div>');
        return;
      }
      if (!res.ok || !Array.isArray(res.body)) {
        paint('<div class="state">Could not reach Travelgenix. Check your connection and try again.</div>');
        return;
      }
      schedulers = res.body.filter((w) => w && w.type === 'Appointment' && w.widgetId);
    }

    if (!schedulers.length) {
      paint('<div class="state">No appointment schedulers yet.<br>Create one in the dashboard and it appears here.</div>');
      return;
    }

    paint('<div class="list">' + schedulers.map((s, i) =>
      '<div class="row"><span class="name" title="' + esc(s.name) + '">' + esc(s.name) + '</span>' +
      '<button type="button" data-link="' + i + '" title="Insert this scheduler\'s booking-page link">Link</button>' +
      '<button type="button" class="primary" data-times="' + i + '" title="Pick specific times to offer">Times</button></div>'
    ).join('') + '</div>');

    box.querySelectorAll('[data-link]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const s = schedulers[Number(btn.getAttribute('data-link'))];
        if (!s) return;
        const url = API + '/book-appointment?widget=' + encodeURIComponent(s.widgetId);
        const { targetBody: tb, savedRange: sr } = popover;
        closePopover();
        insertHtml(tb, sr, '<a href="' + esc(url) + '">Book an appointment</a>&nbsp;');
      });
    });
    box.querySelectorAll('[data-times]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const s = schedulers[Number(btn.getAttribute('data-times'))];
        if (!s || !popover) return;
        paint('<iframe src="' + esc(API + '/appointment-share?widget=' + encodeURIComponent(s.widgetId) + '&mode=insert&nonce=' + nonce) + '" allow="clipboard-write" title="Share times"></iframe>');
      });
    });
  }

  // ── Compose-window discovery + button injection ──────────────────────────
  const BTN_CSS = `
    :host { all: initial; }
    button {
      display: inline-flex; align-items: center; justify-content: center;
      width: 34px; height: 34px; margin: 0 2px; border: 0; border-radius: 50%;
      background: transparent; cursor: pointer; vertical-align: middle;
    }
    button:hover { background: rgba(8,145,178,.12); }
    svg { width: 20px; height: 20px; }
  `;
  const ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="#0891B2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="3" y="4" width="18" height="17" rx="3"/><line x1="8" y1="2.5" x2="8" y2="6.5"/>' +
    '<line x1="16" y1="2.5" x2="16" y2="6.5"/><line x1="3" y1="9.5" x2="21" y2="9.5"/>' +
    '<path d="M9 15.5l2 2 4-4"/></svg>';

  function findComposeBodies() {
    return Array.from(document.querySelectorAll('div[contenteditable="true"][role="textbox"]'))
      .filter((el) => (el.getAttribute('aria-label') || '').length > 0);
  }
  function composeRootOf(body) {
    return body.closest('div.M9') || body.closest('div[role="dialog"]') || body.closest('table') || body.parentElement;
  }
  function findSendButton(root) {
    return root && root.querySelector('[role="button"][data-tooltip*="Send"], [role="button"][aria-label*="Send"]');
  }

  function injectFor(body) {
    const root = composeRootOf(body);
    if (!root || root.hasAttribute(ROOT_MARK)) return;
    const send = findSendButton(root);
    if (!send || !send.parentElement) return; // Gmail shifted — do nothing, retry on next scan
    root.setAttribute(ROOT_MARK, '1');

    const host = document.createElement('span');
    host.setAttribute(BTN_MARK, '1');
    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = BTN_CSS;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.title = 'Travelgenix — insert booking times';
    btn.innerHTML = ICON_SVG;
    shadow.append(style, btn);

    // Keep the caret where the writer left it: the button never takes focus.
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    host.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', () => {
      if (popover) { closePopover(); return; }
      openPopover(host, body);
    });

    send.parentElement.insertBefore(host, send.nextSibling);
  }

  let scanQueued = false;
  function scan() {
    scanQueued = false;
    findComposeBodies().forEach((body) => {
      try { injectFor(body); } catch (e) { /* never break Gmail */ }
    });
  }
  const mo = new MutationObserver(() => {
    if (scanQueued) return;
    scanQueued = true;
    setTimeout(scan, 400); // Gmail mutates constantly — coalesce
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
  scan();
})();
