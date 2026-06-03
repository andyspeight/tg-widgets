/**
 * Travelgenix Staff Client Switcher v1.0.0
 *
 * A self-contained control that lets a Travelgenix staff member "act as" any
 * live client to set up and support that client's widgets. Drop one script tag
 * on any Suite page and it does the rest:
 *
 *   <script defer src="/staff-switcher.js"></script>
 *
 * It self-gates: on load it calls GET /api/auth/staff-clients. That endpoint
 * returns the live client list ONLY to staff (403 otherwise), so for any
 * non-staff user this script renders nothing at all — no flicker, no pill.
 *
 * Picking a client POSTs /api/auth/switch-client, which mints a fresh session
 * cookie scoped to that client and revokes the old one. We then reload so the
 * dashboard, widget list and editors all operate inside the chosen client.
 *
 * Zero dependencies. Shadow DOM for full style isolation. Light + dark mode.
 * Keyboard accessible. Reduced-motion aware. Escapes all client-supplied text.
 */
(function () {
  'use strict';

  if (window.__tgStaffSwitcher) return;            // never mount twice
  window.__tgStaffSwitcher = true;

  var STAFF_CLIENTS_URL = '/api/auth/staff-clients';
  var SWITCH_URL = '/api/auth/switch-client';

  // ── helpers ──────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function debounce(fn, ms) {
    var t;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  // ── boot: only proceed if the caller is staff ────────────────
  function boot() {
    fetch(STAFF_CLIENTS_URL, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !Array.isArray(data.clients) || data.clients.length === 0) return;
        mount(data.clients, data.currentClientId || null);
      })
      .catch(function () { /* not staff / not signed in — render nothing */ });
  }

  // ── mount the control ────────────────────────────────────────
  function mount(clients, currentClientId) {
    var current = clients.filter(function (c) { return c.id === currentClientId; })[0] || null;

    var host = document.createElement('div');
    host.id = 'tg-staff-switcher';
    host.style.cssText = 'position:fixed;left:20px;bottom:20px;z-index:2147483000;';
    document.body.appendChild(host);
    var root = host.attachShadow({ mode: 'open' });

    root.innerHTML = STYLE + markup(current);

    var pill = root.getElementById('pill');
    var panel = root.getElementById('panel');
    var search = root.getElementById('search');
    var listEl = root.getElementById('list');
    var countEl = root.getElementById('count');
    var errEl = root.getElementById('err');

    var open = false;

    function renderList(filter) {
      var q = (filter || '').trim().toLowerCase();
      var rows = clients.filter(function (c) {
        return !q || c.name.toLowerCase().indexOf(q) !== -1;
      });
      countEl.textContent = rows.length + (rows.length === 1 ? ' client' : ' clients');
      if (rows.length === 0) {
        listEl.innerHTML = '<div class="empty">No clients match that search</div>';
        return;
      }
      listEl.innerHTML = rows.map(function (c) {
        var isCur = c.id === currentClientId;
        var plan = c.plan ? '<span class="plan">' + esc(c.plan) + '</span>' : '';
        return '<button class="row' + (isCur ? ' is-current' : '') + '" role="option"' +
          ' aria-selected="' + (isCur ? 'true' : 'false') + '" data-id="' + esc(c.id) + '">' +
          '<span class="name">' + esc(c.name) + '</span>' + plan +
          (isCur ? '<span class="cur">Current</span>' : '<span class="go">Act as</span>') +
          '</button>';
      }).join('');
    }

    function openPanel() {
      open = true;
      panel.classList.add('is-open');
      pill.setAttribute('aria-expanded', 'true');
      renderList('');
      search.value = '';
      setTimeout(function () { search.focus(); }, 30);
      document.addEventListener('keydown', onKey, true);
      document.addEventListener('pointerdown', onOutside, true);
    }
    function closePanel() {
      open = false;
      panel.classList.remove('is-open');
      pill.setAttribute('aria-expanded', 'false');
      errEl.textContent = '';
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onOutside, true);
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); closePanel(); pill.focus(); }
    }
    function onOutside(e) {
      if (!e.composedPath || e.composedPath().indexOf(host) === -1) closePanel();
    }

    pill.addEventListener('click', function () { open ? closePanel() : openPanel(); });

    search.addEventListener('input', debounce(function () { renderList(search.value); }, 150));

    listEl.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.row') : null;
      if (!btn) return;
      var id = btn.getAttribute('data-id');
      if (!id || id === currentClientId) { closePanel(); return; }
      switchTo(id, btn);
    });

    function switchTo(clientId, btn) {
      errEl.textContent = '';
      listEl.querySelectorAll('.row').forEach(function (b) { b.disabled = true; });
      if (btn) btn.classList.add('is-loading');
      fetch(SWITCH_URL, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ clientId: clientId }),
      })
        .then(function (r) {
          return r.json().catch(function () { return {}; }).then(function (j) {
            return { ok: r.ok, body: j };
          });
        })
        .then(function (res) {
          if (res.ok) {
            // New session cookie is set. Reload so every surface picks it up.
            window.location.reload();
            return;
          }
          throw new Error((res.body && (res.body.message || res.body.error)) || 'Could not switch client');
        })
        .catch(function (e) {
          listEl.querySelectorAll('.row').forEach(function (b) { b.disabled = false; });
          if (btn) btn.classList.remove('is-loading');
          errEl.textContent = e.message || 'Could not switch client';
        });
    }
  }

  function markup(current) {
    var label = current ? esc(current.name) : 'Select a client';
    return '' +
      '<button id="pill" type="button" aria-haspopup="listbox" aria-expanded="false"' +
      ' aria-label="Switch active client">' +
        '<span class="badge">STAFF</span>' +
        '<span class="pill-text"><span class="pill-k">Acting as</span>' +
        '<span class="pill-v">' + label + '</span></span>' +
        '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>' +
      '</button>' +
      '<div id="panel" role="dialog" aria-label="Choose a client to act as">' +
        '<div class="head">' +
          '<input id="search" type="text" autocomplete="off" spellcheck="false"' +
          ' placeholder="Search clients by name" aria-label="Search clients by name">' +
          '<span id="count" class="count"></span>' +
        '</div>' +
        '<div id="list" class="list" role="listbox" aria-label="Live clients"></div>' +
        '<div id="err" class="err" role="alert" aria-live="polite"></div>' +
        '<div class="foot">You are signed in as Travelgenix staff. Changes you make apply to the selected client.</div>' +
      '</div>';
  }

  var STYLE = '<style>' +
    ':host{all:initial;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
      '--bg:#fff;--panel:#fff;--ink:#0F172A;--ink2:#475569;--ink3:#64748B;--border:#E2E8F0;' +
      '--hover:#F1F5F9;--brand:#0891B2;--brand-dark:#0E7490;--brand-tint:rgba(8,145,178,.10);' +
      '--shadow:0 10px 30px rgba(15,23,42,.18),0 2px 8px rgba(15,23,42,.10);--danger:#DC2626;}' +
    '@media (prefers-color-scheme:dark){:host{--bg:#0F172A;--panel:#1E293B;--ink:#F8FAFC;' +
      '--ink2:#CBD5E1;--ink3:#94A3B8;--border:#334155;--hover:#334155;--brand:#22D3EE;' +
      '--brand-dark:#0E7490;--brand-tint:rgba(34,211,238,.14);}}' +
    '*{box-sizing:border-box;}' +
    'button{font:inherit;cursor:pointer;border:0;background:none;color:inherit;}' +

    // pill
    '#pill{display:inline-flex;align-items:center;gap:10px;height:44px;padding:0 12px 0 10px;' +
      'background:var(--panel);border:1px solid var(--border);border-radius:999px;' +
      'box-shadow:var(--shadow);color:var(--ink);transition:transform .15s ease-out,border-color .15s;}' +
    '#pill:hover{border-color:var(--brand);}' +
    '#pill:active{transform:scale(.98);}' +
    '#pill:focus-visible{outline:none;box-shadow:var(--shadow),0 0 0 3px var(--brand-tint);}' +
    '.badge{font-size:9px;font-weight:700;letter-spacing:.08em;color:#fff;background:var(--brand);' +
      'padding:3px 6px;border-radius:5px;line-height:1;}' +
    '.pill-text{display:flex;flex-direction:column;align-items:flex-start;line-height:1.15;text-align:left;}' +
    '.pill-k{font-size:10px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--ink3);}' +
    '.pill-v{font-size:13px;font-weight:600;color:var(--ink);max-width:200px;overflow:hidden;' +
      'text-overflow:ellipsis;white-space:nowrap;}' +
    '.chev{width:16px;height:16px;fill:none;stroke:var(--ink3);stroke-width:2;stroke-linecap:round;' +
      'stroke-linejoin:round;transition:transform .15s ease-out;}' +
    '#pill[aria-expanded="true"] .chev{transform:rotate(180deg);}' +

    // panel
    '#panel{position:absolute;left:0;bottom:54px;width:320px;max-width:calc(100vw - 40px);' +
      'background:var(--panel);border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow);' +
      'opacity:0;transform:translateY(8px) scale(.98);transform-origin:bottom left;pointer-events:none;' +
      'transition:opacity .18s ease-out,transform .18s ease-out;overflow:hidden;}' +
    '#panel.is-open{opacity:1;transform:translateY(0) scale(1);pointer-events:auto;}' +
    '.head{padding:12px 12px 8px;border-bottom:1px solid var(--border);display:flex;' +
      'align-items:center;gap:10px;}' +
    '#search{flex:1;height:38px;padding:0 12px;border:1px solid var(--border);border-radius:9px;' +
      'background:var(--bg);color:var(--ink);font-size:14px;outline:none;transition:border-color .15s,box-shadow .15s;}' +
    '#search::placeholder{color:var(--ink3);}' +
    '#search:focus{border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-tint);}' +
    '.count{font-size:11px;color:var(--ink3);white-space:nowrap;}' +

    '.list{max-height:300px;overflow-y:auto;padding:6px;}' +
    '.row{display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:9px 10px;' +
      'border-radius:9px;color:var(--ink);transition:background .12s;}' +
    '.row:hover{background:var(--hover);}' +
    '.row:focus-visible{outline:none;background:var(--hover);box-shadow:inset 0 0 0 2px var(--brand-tint);}' +
    '.row .name{flex:1;font-size:14px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
    '.row .plan{font-size:10px;font-weight:600;color:var(--ink3);text-transform:uppercase;letter-spacing:.04em;}' +
    '.row .go{font-size:11px;font-weight:600;color:var(--brand);opacity:0;transition:opacity .12s;}' +
    '.row:hover .go,.row:focus-visible .go{opacity:1;}' +
    '.row.is-current{background:var(--brand-tint);}' +
    '.row.is-current .cur{font-size:11px;font-weight:700;color:var(--brand);}' +
    '.row.is-loading{opacity:.6;}' +
    '.row[disabled]{cursor:default;}' +
    '.empty{padding:18px 12px;text-align:center;font-size:13px;color:var(--ink3);}' +

    '.err{color:var(--danger);font-size:12px;padding:0 14px;min-height:0;}' +
    '.err:not(:empty){padding:8px 14px;}' +
    '.foot{padding:10px 14px;border-top:1px solid var(--border);font-size:11px;color:var(--ink3);line-height:1.4;}' +

    '.list::-webkit-scrollbar{width:10px;}' +
    '.list::-webkit-scrollbar-thumb{background:var(--border);border-radius:10px;border:3px solid var(--panel);}' +

    '@media (prefers-reduced-motion:reduce){*{transition:none!important;}}' +
    '</style>';

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
