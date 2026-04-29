/* ============================================================
   Travelgenix Widget Editor — Unified Shell JS v1.0
   Source of truth: /editor-shell-spec.md

   Loaded by every editor via:
     <script src="/editor-shell.js" defer></script>

   Exposes one global: window.tgse

   Public API (per editor init):
     tgse.init({
       widgetType: 'Pricing Table',          // string, must match Airtable WidgetType
       widgetTag:  'pricing',                // string, used in embed code
       scriptFile: 'widget.js',              // string, used in embed code
       getConfig:  () => ({...}),            // function returning current config to save
       setConfig:  (c) => {...},             // function to apply a loaded config
       onTabChange:    (tabName) => {...},   // optional, after tab switch
       onAIBuild:      () => {...},          // optional, opens custom AI modal
       onTemplates:    () => {...},          // optional, opens custom templates modal
       onThemeToggle:  (isDark) => {...},    // optional, when widget theme toggles
       onDesignMode:   (isOn) => {...},      // optional, when DM toggles
       fontPickerEl:   '#fontPickerMount',   // optional, where to mount font picker
     });
   ============================================================ */

(function () {
  'use strict';

  // ── Constants ──────────────────────────────────────────────
  const SESSION_KEY = 'tgw_session';
  const TOKEN_GRACE_MS = 30 * 60 * 1000; // refresh-redirect 30 min before server expiry

  // 29 Google Fonts — same list as the original Pricing editor.
  // Order: DM Sans first (default), then alphabetical-ish by popularity.
  const FONTS = [
    'DM Sans', 'Inter', 'Poppins', 'Raleway', 'Open Sans', 'Lato',
    'Montserrat', 'Nunito', 'Source Sans 3', 'Work Sans', 'Outfit',
    'Plus Jakarta Sans', 'Rubik', 'Manrope', 'Sora', 'Space Grotesk',
    'Figtree', 'Onest', 'Albert Sans', 'Urbanist', 'Karla', 'Cabin',
    'Mulish', 'Josefin Sans', 'Quicksand', 'Barlow', 'Archivo',
    'Red Hat Display', 'Overpass'
  ];

  // ── Internal state ────────────────────────────────────────
  let opts = null;       // editor's init options
  let saveDirty = false;
  let saveTimer = null;
  let activeTab = 'design';

  // ============================================================
  // SESSION MANAGEMENT
  // Soft cutover: read both localStorage + sessionStorage,
  // write only to localStorage going forward.
  // ============================================================

  function getSession() {
    try {
      // 1. Try localStorage (new home)
      let raw = localStorage.getItem(SESSION_KEY);
      if (raw) return JSON.parse(raw);
      // 2. Fall back to sessionStorage (legacy — pre-shell editors)
      raw = sessionStorage.getItem(SESSION_KEY);
      if (raw) {
        // Migrate transparently: copy to localStorage so next read is faster
        const s = JSON.parse(raw);
        if (s && s.token) {
          localStorage.setItem(SESSION_KEY, raw);
        }
        return s;
      }
      return null;
    } catch {
      return null;
    }
  }

  function saveSession(s) {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      // Clean up any legacy entry
      sessionStorage.removeItem(SESSION_KEY);
    } catch (e) {
      console.error('[tgse] saveSession failed', e);
    }
  }

  function clearSession() {
    try {
      localStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem(SESSION_KEY);
    } catch {}
  }

  function isLoggedIn() {
    const s = getSession();
    return !!(s && s.token);
  }

  function getAuthToken() {
    return getSession()?.token || '';
  }

  function authHeaders() {
    const h = { 'Content-Type': 'application/json' };
    const t = getAuthToken();
    if (t) h['Authorization'] = 'Bearer ' + t;
    return h;
  }

  // Cross-tab logout: when one tab clears the session, the others should too.
  // The 'storage' event fires on OTHER tabs when localStorage changes here.
  window.addEventListener('storage', (e) => {
    if (e.key !== SESSION_KEY) return;
    if (e.newValue === null) {
      // Session was cleared in another tab — reflect that here
      showLogin('Signed out in another tab');
    } else if (e.oldValue && !getAuthToken()) {
      // Session changed and we no longer have a valid token
      showLogin('Session changed — please sign in again');
    }
  });

  // ============================================================
  // LOGIN OVERLAY
  // ============================================================

  function buildLoginOverlay() {
    const existing = document.getElementById('tgse-login-overlay');
    if (existing) return existing;

    const root = document.createElement('div');
    root.id = 'tgse-login-overlay';
    root.className = 'tgse-login';
    root.setAttribute('hidden', '');
    root.style.display = 'none';
    root.innerHTML = `
      <div class="tgse-login-card" role="dialog" aria-labelledby="tgse-login-title">
        <div class="tgse-login-head">
          <span class="tgse-id-tile" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
          </span>
          <div>
            <h2 id="tgse-login-title">Sign in to continue</h2>
            <p class="tgse-login-sub" id="tgse-login-sub">Use your Travelgenix client account.</p>
          </div>
        </div>
        <label for="tgse-login-email">Email address</label>
        <input id="tgse-login-email" type="email" autocomplete="email" placeholder="you@example.com">
        <label for="tgse-login-code">Client code</label>
        <input id="tgse-login-code" type="password" autocomplete="current-password" placeholder="Enter your client code">
        <div class="tgse-login-err" id="tgse-login-err" hidden></div>
        <button class="tgse-btn tgse-btn--primary" id="tgse-login-submit">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2z"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          Sign in
        </button>
      </div>
    `;
    document.body.appendChild(root);

    // Submit handler
    const submit = root.querySelector('#tgse-login-submit');
    const emailEl = root.querySelector('#tgse-login-email');
    const codeEl = root.querySelector('#tgse-login-code');
    const errEl = root.querySelector('#tgse-login-err');

    async function doLogin() {
      const email = emailEl.value.trim();
      const code = codeEl.value;
      if (!email || !code) {
        errEl.textContent = 'Both fields are required.';
        errEl.hidden = false;
        return;
      }
      submit.disabled = true;
      errEl.hidden = true;
      try {
        const r = await fetch('/api/widget-auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, code }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !d.token) {
          errEl.textContent = d.error || 'Sign-in failed. Please check your details and try again.';
          errEl.hidden = false;
          submit.disabled = false;
          return;
        }
        // Success — write session, hide overlay
        saveSession({ user: d.user, token: d.token, timestamp: Date.now() });
        hideLogin();
        // If the editor was waiting for auth to load config, re-trigger
        if (typeof opts?.onLoginSuccess === 'function') opts.onLoginSuccess();
      } catch (e) {
        errEl.textContent = 'Network error. Please try again.';
        errEl.hidden = false;
        submit.disabled = false;
      }
    }

    submit.addEventListener('click', doLogin);
    [emailEl, codeEl].forEach(el => {
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); doLogin(); }
      });
    });

    return root;
  }

  function showLogin(message) {
    const root = buildLoginOverlay();
    if (message) {
      const sub = root.querySelector('#tgse-login-sub');
      if (sub) sub.textContent = message;
    }
    root.removeAttribute('hidden');
    root.style.display = 'flex';
    setTimeout(() => root.querySelector('#tgse-login-email')?.focus(), 50);
  }

  function hideLogin() {
    const root = document.getElementById('tgse-login-overlay');
    if (!root) return;
    root.setAttribute('hidden', '');
    root.style.display = 'none';
  }

  // Gate: ensure we're logged in before doing anything else
  function ensureAuth() {
    if (isLoggedIn()) return true;
    showLogin();
    return false;
  }

  // ============================================================
  // GOOGLE FONTS LOADER
  // Loads all 29 fonts as one stylesheet at startup.
  // ============================================================

  function loadGoogleFonts() {
    if (document.getElementById('tgse-fonts-link')) return;
    const fams = FONTS.map(f => f.replace(/ /g, '+') + ':wght@400;500;600;700').join('&family=');
    const link = document.createElement('link');
    link.id = 'tgse-fonts-link';
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=' + fams + '&display=swap';
    document.head.appendChild(link);
  }

  // ============================================================
  // FONT PICKER COMPONENT
  // Mounted into a container by tgse.mountFontPicker().
  // ============================================================

  function mountFontPicker(containerEl, currentFont, onChange) {
    const el = (typeof containerEl === 'string') ? document.querySelector(containerEl) : containerEl;
    if (!el) {
      console.warn('[tgse] mountFontPicker: container not found:', containerEl);
      return null;
    }

    let current = currentFont || FONTS[0];
    el.innerHTML = `
      <div class="tgse-fp" data-tgse-fp>
        <button type="button" class="tgse-fp-current" aria-haspopup="listbox" aria-expanded="false">
          <span class="tgse-fp-name" style="font-family:'${escapeAttr(current)}',sans-serif">${escapeHtml(current)}</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div class="tgse-fp-dropdown" role="listbox">
          <input type="text" class="tgse-fp-search" placeholder="Search fonts..." aria-label="Search fonts">
          <div class="tgse-fp-list"></div>
        </div>
      </div>
    `;

    const wrap = el.querySelector('[data-tgse-fp]');
    const trigger = wrap.querySelector('.tgse-fp-current');
    const nameEl = wrap.querySelector('.tgse-fp-name');
    const search = wrap.querySelector('.tgse-fp-search');
    const list = wrap.querySelector('.tgse-fp-list');

    function renderList(filter) {
      const q = (filter || '').trim().toLowerCase();
      const items = q ? FONTS.filter(f => f.toLowerCase().includes(q)) : FONTS;
      list.innerHTML = items.map(f =>
        `<div class="tgse-fp-option${f === current ? ' is-active' : ''}" role="option" data-font="${escapeAttr(f)}" style="font-family:'${escapeAttr(f)}',sans-serif">${escapeHtml(f)}</div>`
      ).join('');
    }
    renderList();

    trigger.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const open = wrap.classList.toggle('is-open');
      trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) { search.value = ''; renderList(); setTimeout(() => search.focus(), 0); }
    });

    search.addEventListener('input', () => renderList(search.value));
    search.addEventListener('click', (e) => e.stopPropagation());

    list.addEventListener('click', (e) => {
      e.stopPropagation();
      const opt = e.target.closest('.tgse-fp-option');
      if (!opt) return;
      const font = opt.dataset.font;
      current = font;
      nameEl.textContent = font;
      nameEl.style.fontFamily = `'${font}',sans-serif`;
      wrap.classList.remove('is-open');
      trigger.setAttribute('aria-expanded', 'false');
      if (typeof onChange === 'function') onChange(font);
    });

    // Close on outside click (ignore clicks inside the picker itself)
    document.addEventListener('click', (e) => {
      if (!wrap.contains(e.target) && wrap.classList.contains('is-open')) {
        wrap.classList.remove('is-open');
        trigger.setAttribute('aria-expanded', 'false');
      }
    });

    return {
      get value() { return current; },
      set value(v) {
        current = v;
        nameEl.textContent = v;
        nameEl.style.fontFamily = `'${v}',sans-serif`;
        renderList();
      },
    };
  }

  // ============================================================
  // SAVE BUTTON STATE MACHINE
  // ============================================================

  function setSaveState(state) {
    const btn = document.getElementById('btn-save');
    if (!btn) return;
    const lbl = document.getElementById('save-label');
    btn.classList.remove('is-dirty', 'is-saving', 'is-saved');
    if (state === 'dirty') {
      btn.classList.add('is-dirty');
      if (lbl) lbl.textContent = 'Save changes';
    } else if (state === 'saving') {
      btn.classList.add('is-saving');
      if (lbl) lbl.textContent = 'Saving…';
    } else if (state === 'saved') {
      btn.classList.add('is-saved');
      if (lbl) lbl.textContent = 'Saved';
      // Auto-revert after 1.2s
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        if (!saveDirty) setSaveState('clean');
      }, 1200);
    } else {
      if (lbl) lbl.textContent = 'Save';
    }
  }

  function markDirty() {
    saveDirty = true;
    setSaveState('dirty');
  }

  async function doSave() {
    if (!ensureAuth()) return;
    if (typeof opts.getConfig !== 'function') {
      console.error('[tgse] getConfig() not provided in init()');
      return;
    }
    const config = opts.getConfig();
    const nameEl = document.getElementById('name-input');
    const name = (nameEl?.value || '').trim() || 'Untitled';

    setSaveState('saving');

    const body = {
      config,
      name,
      widgetType: opts.widgetType,
    };
    // Reuse existing widgetId from URL if present
    const params = new URLSearchParams(location.search);
    const wId = params.get('id');
    if (wId) body.widgetId = wId;

    try {
      const r = await fetch('/api/widget-config', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(body),
      });

      if (r.status === 401) {
        clearSession();
        toast('Session expired — please sign in again', 'err');
        showLogin('Your session expired. Please sign in again.');
        setSaveState('dirty');
        return;
      }

      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast(d.error || 'Save failed', 'err');
        setSaveState('dirty');
        return;
      }

      // Success — toast first so the user sees it even if a downstream step
      // (URL sync, save state UI) throws unexpectedly.
      saveDirty = false;
      try { setSaveState('saved'); } catch (e) { console.error('[tgse] setSaveState threw', e); }
      toast('Saved', 'ok');

      // Sync URL with the widgetId the API returned. The API mints a fresh
      // widgetId on the CREATE path even if the client sent one (anti-squatting),
      // so we must always trust the response — not just on first save.
      try {
        if (d.widgetId && d.widgetId !== wId) {
          const u = new URL(location);
          u.searchParams.set('id', d.widgetId);
          history.replaceState(null, '', u);
        }
      } catch (e) { console.error('[tgse] URL sync threw', e); }

      // Let the editor react (e.g. clear its own dirty flag, refresh embed code)
      if (typeof opts.onAfterSave === 'function') {
        try { opts.onAfterSave(d); } catch (e) { console.error('[tgse] onAfterSave threw:', e); }
      }
    } catch (e) {
      console.error('[tgse] Save failed in catch block:', e);
      toast('Save failed — network error', 'err');
      setSaveState('dirty');
    }
  }

  // ============================================================
  // TOAST
  // ============================================================

  function toast(msg, kind) {
    const existing = document.querySelector('.tgse-toast');
    if (existing) existing.remove();
    const t = document.createElement('div');
    t.className = 'tgse-toast tgse-toast--' + (kind || 'ok');
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('is-show'));
    setTimeout(() => {
      t.classList.remove('is-show');
      setTimeout(() => t.remove(), 300);
    }, 2400);
  }

  // ============================================================
  // VIEWPORT SWITCHER
  // ============================================================

  function wireViewport() {
    const buttons = document.querySelectorAll('.tgse-vp button[data-vp]');
    const frame = document.getElementById('pv-frame');
    if (!buttons.length || !frame) return;

    buttons.forEach(b => {
      b.addEventListener('click', () => {
        buttons.forEach(x => x.classList.remove('is-on'));
        b.classList.add('is-on');
        frame.dataset.vp = b.dataset.vp;
      });
    });
  }

  // ============================================================
  // TABS
  // ============================================================

  function wireTabs() {
    const buttons = document.querySelectorAll('.tgse-tabs button[data-tab]');
    const panels = document.querySelectorAll('.tgse-panel[data-tab]');
    if (!buttons.length) return;

    function activate(tab) {
      activeTab = tab;
      buttons.forEach(b => {
        const on = b.dataset.tab === tab;
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      panels.forEach(p => {
        p.classList.toggle('is-active', p.dataset.tab === tab);
      });
      if (typeof opts.onTabChange === 'function') opts.onTabChange(tab);
    }

    buttons.forEach(b => {
      b.addEventListener('click', () => activate(b.dataset.tab));
    });

    // Activate initial tab (the one with aria-selected="true" or the first)
    const initial = document.querySelector('.tgse-tabs button[aria-selected="true"]')?.dataset.tab
      || buttons[0]?.dataset.tab;
    if (initial) activate(initial);
  }

  // ============================================================
  // ACTION BUTTONS — Templates, AI, Theme, Design Mode, Embed
  // ============================================================

  function wireActions() {
    document.getElementById('btn-templates')?.addEventListener('click', () => {
      if (typeof opts.onTemplates === 'function') opts.onTemplates();
    });

    document.getElementById('btn-ai')?.addEventListener('click', () => {
      if (typeof opts.onAIBuild === 'function') opts.onAIBuild();
    });

    const themeBtn = document.getElementById('btn-theme');
    themeBtn?.addEventListener('click', () => {
      const isOn = themeBtn.classList.toggle('is-on');
      if (typeof opts.onThemeToggle === 'function') opts.onThemeToggle(isOn);
    });

    const dmBtn = document.getElementById('btn-design-mode');
    dmBtn?.addEventListener('click', () => {
      const isOn = dmBtn.classList.toggle('is-on');
      if (typeof opts.onDesignMode === 'function') opts.onDesignMode(isOn);
    });

    document.getElementById('btn-embed')?.addEventListener('click', openEmbedModal);

    document.getElementById('btn-save')?.addEventListener('click', doSave);
  }

  // ============================================================
  // EMBED CODE MODAL
  // ============================================================

  function openEmbedModal() {
    if (!ensureAuth()) return;
    const params = new URLSearchParams(location.search);
    const wId = params.get('id');
    if (!wId) {
      toast('Save the widget first to get an embed code', 'err');
      return;
    }
    const widgetTag = opts.widgetTag || 'pricing';
    const scriptFile = opts.scriptFile || ('widget-' + widgetTag + '.js');
    const baseUrl = location.origin;
    const embed = `<div data-tg-widget="${widgetTag}" data-tg-id="${wId}"></div>\n<script src="${baseUrl}/${scriptFile}"></` + `script>`;

    let modal = document.getElementById('tgse-embed-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'tgse-embed-modal';
      modal.className = 'tgse-modal';
      modal.innerHTML = `
        <div class="tgse-modal-card" role="dialog" aria-labelledby="tgse-embed-title">
          <div class="tgse-modal-head">
            <span class="tgse-id-tile" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
            </span>
            <div>
              <h2 id="tgse-embed-title">Embed code</h2>
              <p class="tgse-modal-sub">Paste this anywhere on your website.</p>
            </div>
          </div>
          <div class="tgse-modal-body">
            <pre style="background:var(--tgse-panel-3);border:1px solid var(--tgse-border);border-radius:var(--tgse-radius-md);padding:14px;font:500 12px 'JetBrains Mono',monospace;color:var(--tgse-ink);overflow-x:auto;margin:0;white-space:pre-wrap;word-break:break-all" id="tgse-embed-code"></pre>
          </div>
          <div class="tgse-modal-foot">
            <button type="button" class="tgse-btn" id="tgse-embed-close">Close</button>
            <button type="button" class="tgse-btn tgse-btn--primary" id="tgse-embed-copy">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              Copy code
            </button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
      modal.addEventListener('click', e => { if (e.target === modal) closeModal(modal); });
      modal.querySelector('#tgse-embed-close').addEventListener('click', () => closeModal(modal));
      modal.querySelector('#tgse-embed-copy').addEventListener('click', () => {
        const code = modal.querySelector('#tgse-embed-code').textContent;
        navigator.clipboard.writeText(code).then(
          () => toast('Embed code copied', 'ok'),
          () => toast('Copy failed — please copy manually', 'err')
        );
      });
    }
    modal.querySelector('#tgse-embed-code').textContent = embed;
    openModal(modal);
  }

  function openModal(modal) {
    modal.classList.add('is-open');
    document.body.style.overflow = 'hidden';
  }
  function closeModal(modal) {
    modal.classList.remove('is-open');
    document.body.style.overflow = '';
  }
  function closeAllModals() {
    document.querySelectorAll('.tgse-modal.is-open').forEach(closeModal);
  }

  // ============================================================
  // SECTION ACCORDION (auto-wired for any .tgse-section-head)
  // ============================================================

  function wireSections() {
    document.addEventListener('click', (e) => {
      const head = e.target.closest('.tgse-section-head');
      if (!head) return;
      head.parentElement.classList.toggle('is-open');
    });
  }

  // ============================================================
  // KEYBOARD SHORTCUTS
  // ============================================================

  function wireKeyboard() {
    document.addEventListener('keydown', (e) => {
      const mod = e.metaKey || e.ctrlKey;
      const inField = !!e.target.closest('input,textarea,select,[contenteditable="true"]');

      // Save: Cmd/Ctrl + S — works everywhere
      if (mod && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        doSave();
        return;
      }

      // Escape — close any open modal
      if (e.key === 'Escape') {
        closeAllModals();
        return;
      }

      // Single-letter shortcuts only when not typing
      if (!mod && !inField) {
        if (e.key === 'a' || e.key === 'A') { e.preventDefault(); document.getElementById('btn-ai')?.click(); }
        else if (e.key === 't' || e.key === 'T') { e.preventDefault(); document.getElementById('btn-templates')?.click(); }
        else if (e.key === 'd' || e.key === 'D') { e.preventDefault(); document.getElementById('btn-design-mode')?.click(); }
        else if (e.key === '1') { e.preventDefault(); document.querySelector('.tgse-tabs button[data-tab="design"]')?.click(); }
        else if (e.key === '2') { e.preventDefault(); document.querySelector('.tgse-tabs button[data-tab="content"]')?.click(); }
        else if (e.key === '3') { e.preventDefault(); document.querySelector('.tgse-tabs button[data-tab="settings"]')?.click(); }
      }
    });
  }

  // ============================================================
  // UTILITIES
  // ============================================================

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }
  function escapeAttr(s) { return escapeHtml(s); }

  // ============================================================
  // PUBLIC API
  // ============================================================

  function init(initOpts) {
    opts = initOpts || {};

    // 1. Auth gate — if not logged in, show overlay (page still loads beneath)
    if (!isLoggedIn()) {
      showLogin();
    }

    // 2. Load Google Fonts so the picker previews properly
    loadGoogleFonts();

    // 3. Wire shell behaviour
    wireTabs();
    wireViewport();
    wireActions();
    wireSections();
    wireKeyboard();

    // 4. Mount font picker if requested
    if (opts.fontPickerEl) {
      const initialFont = opts.getConfig?.()?.fontFamily || FONTS[0];
      const picker = mountFontPicker(opts.fontPickerEl, initialFont, (font) => {
        markDirty();
        if (typeof opts.onFontChange === 'function') opts.onFontChange(font);
      });
      // Expose picker on the public API so the editor can update it later
      tgse._fontPicker = picker;
    }

    return {
      markDirty,
      setSaveState,
      toast,
      doSave,
      showLogin,
      hideLogin,
      isLoggedIn,
      authHeaders,
      getAuthToken,
      mountFontPicker,
      FONTS,
    };
  }

  // ── Expose ─────────────────────────────────────────────────
  window.tgse = {
    init,
    markDirty,
    setSaveState,
    toast,
    doSave,
    showLogin,
    hideLogin,
    isLoggedIn,
    authHeaders,
    getAuthToken,
    mountFontPicker,
    FONTS,
    version: '1.0.0',
  };

})();
