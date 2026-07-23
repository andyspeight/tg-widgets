/* ============================================================
   Travelgenix Widget Editor — Unified Shell JS v1.2.1
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

   ── v1.1 (May 2026) ──
   New: tgse.onReady(cb)
     Runs `cb` once auth state has resolved (cookie check complete OR
     legacy localStorage session detected). Fires immediately if auth
     is already resolved. Use this in every editor's boot block instead
     of a synchronous isLoggedIn() check, to avoid the blank-page race
     where the editor hides itself before the cookie check completes.

     Canonical editor boot pattern:
       window.tgse.onReady(() => {
         if (window.tgse.isLoggedIn()) init();
         // else: shell has already shown its login overlay
       });

   ── v1.1.1 (May 2026) ──
   Fix: doSave() now sends credentials:'include' so cookie-authed users
   (unified Travelgenix SSO) can save without being asked to log in again.

   ── v1.2.0 (May 2026) ──
   Fix: Global fetch interceptor auto-attaches credentials:'include' to
   any same-origin /api/* request, unless the caller already specified a
   credentials value. Fixes the ~30 fetch sites across editors that
   pre-date the cookie auth migration and would otherwise 401. Scope is
   narrow by design — see the comment block at the top of the IIFE for
   the rules. Future cleanup: when every fetch site is updated with
   explicit credentials, this interceptor can be removed safely.

   ── v1.2.1 (Jul 2026) ──
   Fix: doSave() now aborts a stalled request after 20s (AbortController)
   so a flaky connection can no longer lock the Save button in 'Saving…'
   forever, and guards against stacking parallel saves while one is in
   flight. showLogin() only redirects once (no boot-time redirect loop)
   and warns before discarding unsaved edits when a session expires.
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
  let saveInFlight = false;
  let saveTimer = null;
  let loginRedirected = false;
  let activeTab = 'design';

  // ============================================================
  // GLOBAL FETCH INTERCEPTOR — auto-attach cookie credentials
  // ============================================================
  //
  // Why this exists:
  //
  // The widget suite was migrated from Bearer-token auth (localStorage) to
  // cookie auth (HttpOnly cookie set by /api/auth/sso on .travelify.io).
  // Cookies are NOT sent on fetch() requests by default — the caller must
  // opt in via { credentials: 'include' }. The codebase has ~30 fetch sites
  // across editors and helper code that pre-date the migration and call
  // fetch() without that option. Each one is a silent 401 for cookie users.
  //
  // Rather than edit 30 files, this wrapper intercepts every fetch() call
  // made from any editor and, if the URL points at a same-origin /api/...
  // endpoint, adds credentials:'include' unless the caller already specified
  // a value for credentials.
  //
  // Scope rules (DELIBERATELY NARROW):
  //   - Only same-origin requests (skip cross-origin like fonts.googleapis.com,
  //     cdnjs.cloudflare.com, id.travelify.io — they have their own policies)
  //   - Only URLs whose path starts with /api/
  //   - Never override an explicit credentials value
  //   - Idempotent — won't double-wrap if the shell loads twice
  //
  // Future cleanup: when every fetch site is updated to explicit
  // credentials:'include', delete this block. Editors will still work.
  // Look for window.fetch.__tgseWrapped to identify the wrapped state.
  //
  if (typeof window !== 'undefined' && window.fetch && !window.fetch.__tgseWrapped) {
    const originalFetch = window.fetch.bind(window);

    function shouldAttachCredentials(input) {
      try {
        // Resolve to an absolute URL so origin compare is reliable. Accepts
        // string URLs, Request objects, or relative paths.
        const urlStr = (input && typeof input === 'object' && 'url' in input)
          ? input.url
          : String(input);
        const url = new URL(urlStr, window.location.href);
        if (url.origin !== window.location.origin) return false;
        return url.pathname.startsWith('/api/');
      } catch {
        return false;
      }
    }

    // Cache-bust GET /api/widget-config so an editor reload always shows the
    // freshest config. A live widget's PUBLIC config is CDN-cached
    // (s-maxage=300), and Vercel's edge can serve that cached copy to an
    // AUTHENTICATED editor request too — a Cookie does not bypass the edge
    // cache. So after a successful save, the reopened editor was handed the OLD
    // config and the change "didn't stick". A unique URL forces a fresh fetch.
    // Scope is deliberately tiny: only GET /api/widget-config, only same-origin,
    // and only on editor pages (they load this shell). Public embeds on
    // customer sites never run this shell, so their config stays CDN-cached.
    function tgseBustConfigGet(input, init) {
      try {
        var method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
        if (method !== 'GET' || typeof input !== 'string') return input;
        var url = new URL(input, window.location.href);
        if (url.origin !== window.location.origin || url.pathname !== '/api/widget-config') return input;
        if (!url.searchParams.has('_ts')) url.searchParams.set('_ts', String(Date.now()));
        return url.toString();
      } catch (e) { return input; }
    }

    const wrapped = function tgseFetch(input, init) {
      input = tgseBustConfigGet(input, init);
      if (shouldAttachCredentials(input)) {
        // Respect a caller-specified credentials value (including 'omit'
        // if someone deliberately opts out).
        if (!init || init.credentials === undefined) {
          init = Object.assign({}, init || {}, { credentials: 'include' });
        }
      }
      return originalFetch(input, init);
    };
    wrapped.__tgseWrapped = true;
    window.fetch = wrapped;
  }

  // ============================================================
  // COOKIE-BASED SESSION (NEW UNIFIED AUTH)
  //
  // Travelgenix moved auth onto a cookie set by id.travelify.io. Any
  // *.travelify.io page (including widgets.travelify.io) gets the cookie
  // sent automatically. To stay compatible with the existing legacy
  // localStorage-token flow, we check both: cookie first (preferred),
  // localStorage as fallback.
  //
  // The cookie itself is HttpOnly, so JS can't read it directly. Instead,
  // we ask the server via /api/auth/me whether it's valid. Result is
  // cached in module state so we don't re-fetch on every isLoggedIn() call.
  // ============================================================

  // States: 'pending' (in flight), 'authenticated', 'unauthenticated'
  let cookieAuthState = 'pending';
  let cookieAuthUser = null;
  const cookieAuthListeners = [];

  function notifyCookieAuthResolved() {
    while (cookieAuthListeners.length) {
      const cb = cookieAuthListeners.shift();
      try { cb(); } catch (e) { console.error('[tgse] auth listener error', e); }
    }
    try {
      window.dispatchEvent(new CustomEvent('tgse-auth-resolved', {
        detail: { state: cookieAuthState, user: cookieAuthUser },
      }));
    } catch {}
  }

  /**
   * Public API: tgse.onReady(cb)
   *
   * Runs `cb` once the shell's auth state has resolved. Fires immediately
   * (synchronously) if auth has already resolved by the time it's called.
   * Otherwise queues `cb` until the cookie check completes.
   *
   * This is the canonical pattern every editor MUST use in its boot block.
   * Do NOT call isLoggedIn() synchronously at the bottom of the editor —
   * the cookie check may still be in flight, returning false, which would
   * cause a signed-in user to see a blank page.
   *
   * Example:
   *   window.tgse.onReady(() => {
   *     if (window.tgse.isLoggedIn()) init();
   *     // else: the shell has already shown its login overlay
   *   });
   */
  function onReady(cb) {
    if (typeof cb !== 'function') return;
    // Already-resolved fast path: run on next microtask so callers can
    // always treat this as async (no surprise re-entrancy during boot).
    if (cookieAuthState !== 'pending') {
      Promise.resolve().then(() => {
        try { cb(); } catch (e) { console.error('[tgse] onReady cb error', e); }
      });
      return;
    }
    // Still pending — queue it. notifyCookieAuthResolved() will drain
    // this queue exactly once when the /api/auth/me fetch settles.
    cookieAuthListeners.push(cb);
  }

  // Kick off the cookie check immediately at module load (before init()).
  // On widgets.travelify.io this typically resolves before the user can
  // notice — it's a single GET, no preflight, cookie sent automatically.
  (function bootstrapCookieAuth() {
    fetch('https://id.travelify.io/api/auth/me', {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
    })
      .then(function (r) {
        if (r.status === 401) return null;
        if (!r.ok) throw new Error('me_' + r.status);
        return r.json();
      })
      .then(function (data) {
        if (data && data.ok && data.user) {
          cookieAuthUser = {
            email: data.user.email,
            fullName: data.user.fullName,
            role: data.user.role,
            // From client info (the session is scoped to a client)
            clientName: data.client && data.client.clientName,
            clientRecordId: data.client && data.client.recordId,
            plan: data.client && data.client.packageName,
            // Permissions array — products this user can use
            permissions: data.permissions || [],
          };
          cookieAuthState = 'authenticated';
        } else {
          cookieAuthState = 'unauthenticated';
        }
      })
      .catch(function (err) {
        console.warn('[tgse] cookie auth check failed:', err && err.message);
        cookieAuthState = 'unauthenticated';
      })
      .finally(notifyCookieAuthResolved);
  })();

  // ============================================================
  // STAFF "ACTING AS" SAFETY NET
  // ============================================================
  //
  // Every editor loads the shell, so injecting the staff switcher here puts the
  // loud "ACTING AS <client>" banner (and the exit-to-your-account button) on
  // ALL 42 editors automatically — including the appointment scheduler editor,
  // where a silent act-as session previously showed another client's calendar
  // with no warning. The switcher self-gates: /api/auth/staff-clients returns
  // the client list only to staff (403 otherwise), so it renders nothing for a
  // normal client. It also has its own double-init guard (window.__tgStaffSwitcher).
  //
  // Gated to our own origins so it can never fire on a customer site (editors
  // only ever run on travelify.io, but this is belt-and-braces).
  (function injectStaffSwitcher() {
    try {
      var h = (location.hostname || '').toLowerCase();
      var ours = h === 'travelify.io' || h.slice(-13) === '.travelify.io' ||
        h === 'localhost' || h === '127.0.0.1';
      if (!ours) return;
      if (document.querySelector('script[data-tg-staff-switcher]')) return;
      var s = document.createElement('script');
      s.src = '/staff-switcher.js';
      s.defer = true;
      s.setAttribute('data-tg-staff-switcher', '');
      (document.head || document.documentElement).appendChild(s);
    } catch (e) { /* non-fatal: the banner is a safety net, not core */ }
  })();

  // ============================================================
  // SESSION MANAGEMENT
  // Soft cutover: read both localStorage + sessionStorage,
  // write only to localStorage going forward.
  // ============================================================

  function getSession() {
    try {
      // 1. Primary: new auth flow keys written by /signin.html
      const tok = localStorage.getItem('tg_token');
      const usrRaw = localStorage.getItem('tg_user');
      if (tok && usrRaw) {
        const usr = JSON.parse(usrRaw);
        let cli = null;
        try { cli = JSON.parse(localStorage.getItem('tg_client') || 'null'); } catch {}
        // plan may be a string ("Bespoke") or a singleSelect object ({name:"Bespoke"})
        const rawPlan = cli?.plan ?? usr?.plan;
        const planStr = (rawPlan && typeof rawPlan === 'object') ? (rawPlan.name || '') : (rawPlan || '');
        return {
          token: tok,
          user: {
            ...usr,
            plan: planStr,
            clientName: cli?.clientName || usr?.clientName || '',
            clientRecordId: cli?.recordId || null
          },
          timestamp: Date.now()
        };
      }
      // 2. Legacy fallback: tgw_session blob
      let raw = localStorage.getItem(SESSION_KEY);
      if (raw) return JSON.parse(raw);
      // 3. Even older fallback: sessionStorage
      raw = sessionStorage.getItem(SESSION_KEY);
      if (raw) {
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
      // Clear new auth keys
      localStorage.removeItem('tg_token');
      localStorage.removeItem('tg_user');
      localStorage.removeItem('tg_client');
      // Clear legacy keys
      localStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem(SESSION_KEY);
    } catch {}
  }

  function isLoggedIn() {
    // Cookie session is the primary source of truth — set after the
    // bootstrap fetch resolves. Until then, fall back to legacy localStorage.
    if (cookieAuthState === 'authenticated') return true;
    const s = getSession();
    return !!(s && s.token);
  }

  function getAuthToken() {
    // For backwards-compatible Bearer-header use. Cookie sessions don't
    // have a JS-accessible token (the cookie is HttpOnly), so this returns
    // empty when the cookie is the auth source — callers should not set
    // a Bearer header in that case, and the cookie will be sent
    // automatically on same-origin fetches.
    return getSession()?.token || '';
  }

  function authHeaders() {
    const h = { 'Content-Type': 'application/json' };
    const t = getAuthToken();
    if (t) {
      h['Authorization'] = 'Bearer ' + t;
    }
    // If we're running off the cookie session, no Authorization header is
    // needed — the browser sends the cookie automatically. Callers must
    // ensure their fetch() calls use credentials:'include' for same-site
    // cross-subdomain calls if any.
    return h;
  }

  /**
   * Returns user info for the current session, regardless of auth source.
   * Prefers cookie session; falls back to legacy localStorage session.
   *
   * Use this to render the editor's user chip, gating, etc, instead of
   * reading getSession() directly.
   */
  function getCurrentUser() {
    if (cookieAuthState === 'authenticated' && cookieAuthUser) {
      return cookieAuthUser;
    }
    const s = getSession();
    return s ? s.user : null;
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
    // Redirect to the canonical sign-in page. (The legacy inline overlay
    // built by buildLoginOverlay() is wired to /api/widget-auth, which is
    // now disconnected from the bcrypt-based Users table, so it is not used.)

    // Redirect only once — a boot-time auth gate can fire this repeatedly,
    // and without a guard a failing check on return would loop the browser
    // between the editor and /signin.html.
    if (loginRedirected) return;

    // If the session expired mid-edit, don't silently discard unsaved work —
    // let the user cancel the redirect so they can retry or copy their edits.
    if (saveDirty && typeof window.confirm === 'function') {
      const go = window.confirm(
        'You have unsaved changes that will be lost when you sign in again. ' +
        'Sign in now anyway?'
      );
      if (!go) return;
    }

    loginRedirected = true;
    const here = location.pathname + location.search + location.hash;
    location.href = '/signin.html?next=' + encodeURIComponent(here);
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
    // Guard against a second save while one is already in flight — Cmd/Ctrl+S
    // bypasses the button's pointer-events:none, so without this a stalled
    // request could stack up parallel POSTs.
    if (saveInFlight) return;
    // Optional editor veto. An editor can supply canSave() to block a save it
    // knows would be destructive — chiefly when its config failed to load, so
    // saving now would overwrite the real record with blank defaults. Returning
    // false (the editor shows its own message) aborts before any state change.
    if (typeof opts.canSave === 'function') {
      let allowed = true;
      try { allowed = opts.canSave() !== false; } catch (e) { console.error('[tgse] canSave threw', e); }
      if (!allowed) return;
    }
    if (typeof opts.getConfig !== 'function') {
      console.error('[tgse] getConfig() not provided in init()');
      return;
    }
    const config = opts.getConfig();
    const nameEl = document.getElementById('name-input');
    const name = (nameEl?.value || '').trim() || 'Untitled';

    saveInFlight = true;
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

    // Abort a stalled request after ~20s so a flaky connection can never
    // lock the Save button in 'Saving…' forever — the abort lands in the
    // catch block below, which restores the dirty (clickable) state.
    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(), 20000);

    try {
      const r = await fetch('/api/widget-config', {
        method: 'POST',
        headers: authHeaders(),
        // credentials:'include' ships the tg_session cookie so the new
        // unified Travelgenix SSO flow can authenticate this request.
        // Without it, cookie-only users get 401 → "session expired".
        credentials: 'include',
        body: JSON.stringify(body),
        signal: ctrl.signal,
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
    } finally {
      clearTimeout(timeoutId);
      saveInFlight = false;
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

    // 1. Auth gate — show login overlay only if BOTH cookie session check
    // has resolved AND we're not authenticated by any means. While the
    // cookie check is in flight (typically <200ms), defer the decision to
    // avoid flashing the overlay for users who are signed in via the
    // unified flow.
    function applyAuthGate() {
      if (!isLoggedIn()) {
        showLogin();
      } else {
        // We're authenticated — make sure any overlay is hidden (in case
        // the user signed in mid-page, e.g. via storage event)
        hideLogin();
      }
    }
    if (cookieAuthState === 'pending') {
      cookieAuthListeners.push(applyAuthGate);
    } else {
      applyAuthGate();
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
      getCurrentUser,
      mountFontPicker,
      onReady,
      FONTS,
    };
  }

  // ── Expose ─────────────────────────────────────────────────
  /**
   * Coach an AI "describe your business" prompt toward something usable, and
   * stop thin/empty generations reaching the paid endpoint in the first place.
   *
   * Wires a description <textarea> to a Generate <button>:
   *   - renders a "who you are / what you sell / who your customers are"
   *     checklist under the field (once)
   *   - keeps the button disabled until the text meets minChars + minWords
   *   - shows a gentle live hint while it is still too thin
   *
   * The server enforces the same floor as the hard guard (api/widget-ai.js);
   * this is the friendly front line that saves the client a wasted click and
   * saves us the AI credits. Additive and opt-in — editors that only rewrite
   * existing copy never call it. CSP-safe: inline styles via CSSOM, no classes
   * that need external CSS, no injected <script>.
   *
   * @param {{textarea:(string|Element), button:(string|Element), hintEl?:(string|Element),
   *          minChars?:number, minWords?:number, checklist?:string[]}} opts
   * @returns {{ isReady:()=>boolean, refresh:()=>void }}
   */
  function wireAiPrompt(opts) {
    opts = opts || {};
    const sel = (x) => (typeof x === 'string' ? document.querySelector(x) : x) || null;
    const ta = sel(opts.textarea);
    const btn = sel(opts.button);
    if (!ta || !btn) return { isReady: () => true, refresh: () => {} };

    const minChars = opts.minChars != null ? opts.minChars : 30;
    const minWords = opts.minWords != null ? opts.minWords : 5;
    const items = (opts.checklist && opts.checklist.length)
      ? opts.checklist
      : ['who you are', 'what you sell', 'who your customers are'];

    // Checklist, rendered once immediately after the textarea.
    let list = ta.parentElement && ta.parentElement.querySelector('[data-tgse-ai-checklist]');
    if (!list) {
      list = document.createElement('div');
      list.setAttribute('data-tgse-ai-checklist', '');
      list.style.cssText = 'font-size:12px;line-height:1.5;color:#64748b;margin-top:6px;';
      list.textContent = 'A good description covers ' + items.join(' · ') + '.';
      ta.insertAdjacentElement('afterend', list);
    }
    const hint = opts.hintEl ? sel(opts.hintEl) : null;

    const TOO_THIN = 'Add a little more detail so the AI has something to work with — a sentence or two is plenty.';
    const assess = () => {
      const v = (ta.value || '').trim();
      const words = v ? v.split(/\s+/).filter(Boolean).length : 0;
      return v.length >= minChars && words >= minWords;
    };
    const refresh = () => {
      const ready = assess();
      btn.disabled = !ready;
      btn.setAttribute('aria-disabled', ready ? 'false' : 'true');
      btn.style.opacity = ready ? '' : '0.55';
      btn.style.cursor = ready ? '' : 'not-allowed';
      list.style.color = ready ? '#059669' : '#64748b';
      if (hint) hint.textContent = ready ? '' : TOO_THIN;
    };
    ta.addEventListener('input', refresh);
    // Capture-phase guard: block a generate click whenever the description is
    // thin, even if the editor's own code re-enabled the button after a
    // previous run. Belt-and-braces in front of the disabled state.
    btn.addEventListener('click', (ev) => {
      if (!assess()) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        refresh();
        if (hint) hint.textContent = TOO_THIN;
        try { ta.focus(); } catch (_) {}
      }
    }, true);
    refresh();
    return { isReady: assess, refresh };
  }

  window.tgse = {
    init,
    onReady,
    markDirty,
    setSaveState,
    toast,
    doSave,
    showLogin,
    hideLogin,
    isLoggedIn,
    authHeaders,
    getAuthToken,
    getCurrentUser,
    mountFontPicker,
    wireAiPrompt,
    FONTS,
    version: '1.3.0',
  };

})();
