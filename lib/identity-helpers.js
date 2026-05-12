<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Staff · Travelgenix Control</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --tg-primary: #1B2B5B; --tg-primary-light: #2A3F7A; --tg-primary-dark: #111D3E;
      --tg-accent: #00B4D8; --tg-accent-light: #48CAE4; --tg-accent-dark: #0096B7;
      --tg-success: #10B981; --tg-warning: #F59E0B; --tg-error: #EF4444; --tg-info: #3B82F6;
      --tg-bg-primary: #FFFFFF; --tg-bg-secondary: #F8FAFC; --tg-bg-tertiary: #F1F5F9;
      --tg-border: #E2E8F0; --tg-border-light: #F1F5F9;
      --tg-text-primary: #0F172A; --tg-text-secondary: #475569; --tg-text-tertiary: #94A3B8;
      --tg-text-inverse: #FFFFFF;
      --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px;
      --space-5: 20px; --space-6: 24px; --space-8: 32px; --space-10: 40px;
      --space-12: 48px; --space-16: 64px;
      --radius-sm: 6px; --radius-md: 8px; --radius-lg: 12px; --radius-xl: 16px;
      --shadow-sm: 0 1px 2px rgba(15,23,42,0.04);
      --shadow-md: 0 4px 12px rgba(15,23,42,0.06);
      --shadow-lg: 0 12px 32px rgba(15,23,42,0.10);
    }
    [data-theme="dark"] {
      --tg-bg-primary: #0F172A; --tg-bg-secondary: #1E293B; --tg-bg-tertiary: #334155;
      --tg-border: #334155; --tg-border-light: #1E293B;
      --tg-text-primary: #F8FAFC; --tg-text-secondary: #CBD5E1; --tg-text-tertiary: #64748B;
    }
    *, *::before, *::after { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: var(--tg-bg-secondary);
      color: var(--tg-text-primary);
      -webkit-font-smoothing: antialiased;
      font-size: 15px; line-height: 1.6;
    }

    .wrap { max-width: 1280px; margin: 0 auto; padding: var(--space-8); }

    /* Header */
    .head { display: flex; align-items: flex-end; justify-content: space-between; gap: var(--space-4); margin-bottom: var(--space-6); flex-wrap: wrap; }
    .head h1 { margin: 0 0 var(--space-1) 0; font-size: 28px; line-height: 1.2; font-weight: 700; letter-spacing: -0.02em; color: var(--tg-text-primary); }
    .head p { margin: 0; color: var(--tg-text-secondary); font-size: 15px; }

    /* Toolbar */
    .toolbar { display: flex; gap: var(--space-3); align-items: center; margin-bottom: var(--space-5); flex-wrap: wrap; }
    .search {
      flex: 1; min-width: 240px; height: 44px; padding: 0 var(--space-4);
      background: var(--tg-bg-primary); border: 1px solid var(--tg-border); border-radius: var(--radius-md);
      font-size: 15px; color: var(--tg-text-primary); font-family: inherit;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .search:focus { outline: none; border-color: var(--tg-accent); box-shadow: 0 0 0 3px rgba(0,180,216,0.15); }
    .stat {
      padding: 0 var(--space-4); height: 44px; display: inline-flex; align-items: center; gap: var(--space-2);
      background: var(--tg-bg-primary); border: 1px solid var(--tg-border); border-radius: var(--radius-md);
      font-size: 13px; color: var(--tg-text-secondary); font-weight: 500;
    }
    .stat strong { color: var(--tg-text-primary); font-weight: 600; }

    /* Buttons */
    .btn {
      display: inline-flex; align-items: center; gap: var(--space-2);
      height: 44px; padding: 0 var(--space-4);
      background: var(--tg-bg-primary); border: 1px solid var(--tg-border); border-radius: var(--radius-md);
      font-family: inherit; font-size: 14px; font-weight: 500; color: var(--tg-text-primary);
      cursor: pointer; transition: background 0.15s, border-color 0.15s, transform 0.05s;
    }
    .btn:hover { background: var(--tg-bg-tertiary); border-color: var(--tg-text-tertiary); }
    .btn:active { transform: translateY(1px); }
    .btn--primary { background: var(--tg-primary); border-color: var(--tg-primary); color: var(--tg-text-inverse); }
    .btn--primary:hover { background: var(--tg-primary-light); border-color: var(--tg-primary-light); }
    .btn--sm { height: 32px; padding: 0 var(--space-3); font-size: 13px; }
    .btn--danger { color: var(--tg-error); }
    .btn--danger:hover { background: rgba(239,68,68,0.08); border-color: var(--tg-error); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }

    /* Table */
    .table-card { background: var(--tg-bg-primary); border: 1px solid var(--tg-border); border-radius: var(--radius-lg); overflow: hidden; box-shadow: var(--shadow-sm); }
    .table { width: 100%; border-collapse: collapse; }
    .table th, .table td { padding: var(--space-4); text-align: left; vertical-align: middle; }
    .table thead th {
      font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;
      color: var(--tg-text-tertiary); background: var(--tg-bg-secondary);
      border-bottom: 1px solid var(--tg-border);
    }
    .table tbody tr { border-bottom: 1px solid var(--tg-border-light); transition: background 0.1s; }
    .table tbody tr:last-child { border-bottom: 0; }
    .table tbody tr:hover { background: var(--tg-bg-secondary); }
    .table td { font-size: 14px; color: var(--tg-text-primary); }
    .cell-name { font-weight: 600; }
    .cell-meta { color: var(--tg-text-secondary); font-size: 13px; }
    .cell-actions { text-align: right; white-space: nowrap; }
    .cell-actions .btn { margin-left: var(--space-2); }

    /* Status pills */
    .pill {
      display: inline-flex; align-items: center; gap: var(--space-1);
      padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 500;
    }
    .pill--active { background: rgba(16,185,129,0.10); color: var(--tg-success); }
    .pill--suspended { background: rgba(148,163,184,0.15); color: var(--tg-text-tertiary); }
    .pill--owner { background: rgba(27,43,91,0.08); color: var(--tg-primary); }
    .pill--admin { background: rgba(0,180,216,0.10); color: var(--tg-accent-dark); }
    .pill--user { background: var(--tg-bg-tertiary); color: var(--tg-text-secondary); }
    .pill-row { display: flex; flex-wrap: wrap; gap: 4px; }

    /* Empty / loading */
    .empty { padding: var(--space-12); text-align: center; color: var(--tg-text-secondary); }
    .empty svg { color: var(--tg-text-tertiary); margin-bottom: var(--space-3); }
    .empty h3 { margin: 0 0 var(--space-1) 0; color: var(--tg-text-primary); font-size: 18px; font-weight: 600; }
    .empty p { margin: 0 0 var(--space-4) 0; font-size: 14px; }
    .skeleton-row td { padding: var(--space-4); }
    .skeleton { display: inline-block; height: 14px; border-radius: 4px; background: linear-gradient(90deg, var(--tg-bg-tertiary) 0%, var(--tg-border) 50%, var(--tg-bg-tertiary) 100%); background-size: 200% 100%; animation: shimmer 1.4s infinite; }
    @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

    /* Modal */
    .modal-overlay {
      position: fixed; inset: 0; background: rgba(15,23,42,0.5); backdrop-filter: blur(4px);
      display: none; align-items: center; justify-content: center; z-index: 100;
      padding: var(--space-4);
    }
    .modal-overlay.is-open { display: flex; }
    .modal {
      background: var(--tg-bg-primary); border-radius: var(--radius-lg); box-shadow: var(--shadow-lg);
      width: 100%; max-width: 560px; max-height: 90vh; overflow-y: auto;
      animation: modalIn 0.15s ease-out;
    }
    @keyframes modalIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    .modal-head { padding: var(--space-6); border-bottom: 1px solid var(--tg-border-light); display: flex; align-items: center; justify-content: space-between; }
    .modal-head h2 { margin: 0; font-size: 20px; font-weight: 600; color: var(--tg-text-primary); }
    .modal-close { background: none; border: 0; cursor: pointer; padding: var(--space-2); border-radius: var(--radius-sm); color: var(--tg-text-tertiary); }
    .modal-close:hover { background: var(--tg-bg-tertiary); color: var(--tg-text-primary); }
    .modal-body { padding: var(--space-6); }
    .modal-foot { padding: var(--space-4) var(--space-6); border-top: 1px solid var(--tg-border-light); background: var(--tg-bg-secondary); display: flex; justify-content: flex-end; gap: var(--space-3); }

    /* Form */
    .field { margin-bottom: var(--space-4); }
    .field:last-child { margin-bottom: 0; }
    .field-label { display: block; font-size: 13px; font-weight: 500; color: var(--tg-text-primary); margin-bottom: var(--space-1); }
    .field-hint { display: block; font-size: 12px; color: var(--tg-text-tertiary); margin-top: var(--space-1); }
    .input, .select {
      width: 100%; height: 44px; padding: 0 var(--space-3);
      background: var(--tg-bg-primary); border: 1px solid var(--tg-border); border-radius: var(--radius-md);
      font-family: inherit; font-size: 15px; color: var(--tg-text-primary);
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .input:focus, .select:focus { outline: none; border-color: var(--tg-accent); box-shadow: 0 0 0 3px rgba(0,180,216,0.15); }
    .field-row { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-4); }

    /* Product checklist */
    .checklist { display: flex; flex-direction: column; gap: var(--space-2); border: 1px solid var(--tg-border); border-radius: var(--radius-md); padding: var(--space-3); background: var(--tg-bg-secondary); }
    .check-row { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm); cursor: pointer; }
    .check-row:hover { background: var(--tg-bg-primary); }
    .check-row input { width: 18px; height: 18px; accent-color: var(--tg-primary); cursor: pointer; flex-shrink: 0; }
    .check-row .name { font-size: 14px; font-weight: 500; color: var(--tg-text-primary); }
    .check-row .slug { font-size: 12px; color: var(--tg-text-tertiary); font-family: 'SF Mono', Menlo, Consolas, monospace; margin-left: auto; }

    /* Inline form error */
    .form-error { padding: var(--space-3) var(--space-4); background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.3); border-radius: var(--radius-md); color: var(--tg-error); font-size: 13px; margin-bottom: var(--space-4); display: none; }
    .form-error.is-on { display: block; }

    /* Success panel (post-create) */
    .success-block {
      padding: var(--space-5); background: linear-gradient(135deg, rgba(16,185,129,0.06), rgba(0,180,216,0.04));
      border: 1px solid rgba(16,185,129,0.25); border-radius: var(--radius-md); margin-bottom: var(--space-4);
    }
    .success-block h3 { margin: 0 0 var(--space-1) 0; font-size: 16px; font-weight: 600; color: var(--tg-success); }
    .success-block p { margin: 0 0 var(--space-3) 0; font-size: 13px; color: var(--tg-text-secondary); }
    .cred-card { background: var(--tg-bg-primary); border: 1px solid var(--tg-border); border-radius: var(--radius-md); overflow: hidden; }
    .cred-row { display: flex; padding: var(--space-3) var(--space-4); border-bottom: 1px solid var(--tg-border-light); align-items: center; gap: var(--space-3); }
    .cred-row:last-child { border-bottom: 0; }
    .cred-label { font-size: 11px; color: var(--tg-text-tertiary); text-transform: uppercase; letter-spacing: 0.05em; width: 100px; flex-shrink: 0; font-weight: 600; }
    .cred-value { flex: 1; font-family: 'SF Mono', Menlo, Consolas, monospace; font-size: 14px; color: var(--tg-text-primary); font-weight: 600; word-break: break-all; }
    .cred-copy { background: none; border: 0; cursor: pointer; padding: var(--space-1) var(--space-2); border-radius: var(--radius-sm); color: var(--tg-text-secondary); font-size: 12px; font-weight: 500; font-family: inherit; }
    .cred-copy:hover { background: var(--tg-bg-tertiary); color: var(--tg-text-primary); }

    .email-status {
      display: flex; gap: var(--space-2); align-items: flex-start;
      padding: var(--space-3) var(--space-4); border-radius: var(--radius-md);
      font-size: 13px; line-height: 1.5;
    }
    .email-status--sent { background: rgba(16,185,129,0.08); color: var(--tg-success); }
    .email-status--manual { background: rgba(245,158,11,0.08); color: #92400E; }
    [data-theme="dark"] .email-status--manual { color: #F59E0B; }

    /* Toast */
    .toast {
      position: fixed; bottom: var(--space-6); right: var(--space-6); z-index: 200;
      padding: var(--space-3) var(--space-4); border-radius: var(--radius-md); box-shadow: var(--shadow-lg);
      background: var(--tg-text-primary); color: var(--tg-text-inverse); font-size: 14px; font-weight: 500;
      transform: translateY(8px); opacity: 0; transition: transform 0.2s, opacity 0.2s; pointer-events: none;
    }
    .toast.is-on { transform: translateY(0); opacity: 1; pointer-events: auto; }
    .toast--err { background: var(--tg-error); }
    .toast--ok { background: var(--tg-success); }

    /* Responsive */
    @media (max-width: 720px) {
      .wrap { padding: var(--space-4); }
      .field-row { grid-template-columns: 1fr; }
      .table th:nth-child(3), .table td:nth-child(3) { display: none; } /* hide products column on mobile */
      .table th, .table td { padding: var(--space-3); }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <header class="head">
      <div>
        <h1>Staff</h1>
        <p>Users with access to Travelgenix products under your account.</p>
      </div>
      <button class="btn btn--primary" id="btn-add">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Add Staff
      </button>
    </header>

    <div class="toolbar">
      <input type="search" class="search" id="search" placeholder="Search by name, email, or code…" autocomplete="off">
      <span class="stat" id="stat-total">Loading…</span>
    </div>

    <div class="table-card">
      <table class="table">
        <thead>
          <tr>
            <th style="width: 30%;">Name</th>
            <th style="width: 25%;">Email</th>
            <th style="width: 25%;">Products</th>
            <th style="width: 10%;">Status</th>
            <th style="width: 10%;"></th>
          </tr>
        </thead>
        <tbody id="rows">
          <tr class="skeleton-row"><td colspan="5"><span class="skeleton" style="width: 60%"></span></td></tr>
          <tr class="skeleton-row"><td colspan="5"><span class="skeleton" style="width: 75%"></span></td></tr>
          <tr class="skeleton-row"><td colspan="5"><span class="skeleton" style="width: 50%"></span></td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <!-- Add Staff modal -->
  <div class="modal-overlay" id="modal-add" role="dialog" aria-modal="true" aria-labelledby="modal-add-title">
    <div class="modal">
      <div class="modal-head">
        <h2 id="modal-add-title">Add staff member</h2>
        <button class="modal-close" id="modal-add-close" aria-label="Close">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="modal-body">
        <div class="form-error" id="form-error"></div>

        <!-- Success state (replaces form after successful create) -->
        <div id="success-pane" style="display:none;">
          <div class="success-block">
            <h3>Account created</h3>
            <p>Sign-in details below — keep this window open until they're captured.</p>
            <div class="cred-card">
              <div class="cred-row">
                <span class="cred-label">Email</span>
                <span class="cred-value" id="succ-email"></span>
                <button class="cred-copy" data-copy="succ-email">Copy</button>
              </div>
              <div class="cred-row">
                <span class="cred-label">Code</span>
                <span class="cred-value" id="succ-code"></span>
                <button class="cred-copy" data-copy="succ-code">Copy</button>
              </div>
              <div class="cred-row">
                <span class="cred-label">Sign in</span>
                <span class="cred-value" id="succ-url">https://id.travelify.io/signin.html</span>
                <button class="cred-copy" data-copy="succ-url">Copy</button>
              </div>
            </div>
          </div>
          <div class="email-status" id="email-status"></div>
        </div>

        <!-- The form -->
        <div id="form-pane">
          <div class="field-row">
            <div class="field">
              <label class="field-label" for="f-name">Full name</label>
              <input class="input" id="f-name" type="text" placeholder="Jane Smith" autocomplete="off">
            </div>
            <div class="field">
              <label class="field-label" for="f-email">Email</label>
              <input class="input" id="f-email" type="email" placeholder="jane@travelgenix.io" autocomplete="off">
            </div>
          </div>

          <div class="field-row">
            <div class="field">
              <label class="field-label" for="f-role">Role on Widget Suite</label>
              <select class="select" id="f-role">
                <option value="owner">Owner (full admin, same as you)</option>
                <option value="admin">Admin</option>
                <option value="user">User</option>
              </select>
              <span class="field-hint">This role applies across all granted products.</span>
            </div>
            <div class="field">
              <label class="field-label" for="f-plan">Plan</label>
              <select class="select" id="f-plan">
                <option value="Bespoke" selected>Bespoke (full access)</option>
                <option value="Ignite">Ignite</option>
                <option value="Boost">Boost</option>
                <option value="Spark">Spark</option>
              </select>
            </div>
          </div>

          <div class="field">
            <label class="field-label">Product access</label>
            <div class="checklist" id="products"></div>
            <span class="field-hint">All products are selected by default. Uncheck any you don't want them to have.</span>
          </div>

          <div class="field">
            <label class="field-label" style="display: flex; align-items: center; gap: var(--space-2); cursor: pointer;">
              <input type="checkbox" id="f-send-email" checked style="width: 18px; height: 18px; accent-color: var(--tg-primary);">
              Send welcome email automatically
            </label>
            <span class="field-hint">If Resend isn't configured yet, you'll get the sign-in details on screen instead.</span>
          </div>
        </div>
      </div>
      <div class="modal-foot" id="modal-foot-form">
        <button class="btn" id="btn-cancel">Cancel</button>
        <button class="btn btn--primary" id="btn-create">Create staff account</button>
      </div>
      <div class="modal-foot" id="modal-foot-success" style="display:none;">
        <button class="btn btn--primary" id="btn-done">Done</button>
      </div>
    </div>
  </div>

  <div class="toast" id="toast" role="status" aria-live="polite"></div>

<script>
  // ============================================================================
  // Config
  // ============================================================================
  // When iframed inside id.travelify.io/admin both share the same origin,
  // so a relative URL works AND the tg_session cookie travels automatically.
  const API = {
    users: '/api/identity/users',
    user: (id) => `/api/identity/users/${id}`,
    perms: '/api/identity/permissions',
  };

  // Hardcoded for now — should ideally come from a /api/products endpoint.
  // Matches the seven products you've registered (per memory).
  const ALL_PRODUCTS = [
    { slug: 'widget_suite',    name: 'TG Widget Suite' },
    { slug: 'luna_chat',       name: 'Luna Chat' },
    { slug: 'luna_marketing',  name: 'Luna Marketing' },
    { slug: 'luna_brain',      name: 'Luna Brain' },
    { slug: 'luna_trends',     name: 'Luna Trends' },
    { slug: 'luna_qa',         name: 'Luna QA' },
    { slug: 'tool_hub',        name: 'Tool Hub' },
  ];

  // ============================================================================
  // State
  // ============================================================================
  let users = [];
  let filtered = [];

  // ============================================================================
  // DOM
  // ============================================================================
  const $ = (s) => document.querySelector(s);
  const rowsEl = $('#rows');
  const searchEl = $('#search');
  const statEl = $('#stat-total');
  const modal = $('#modal-add');
  const toastEl = $('#toast');

  // ============================================================================
  // Toast
  // ============================================================================
  let toastTimer;
  function toast(msg, kind = '') {
    toastEl.textContent = msg;
    toastEl.className = 'toast is-on' + (kind ? ' toast--' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-on'), 3000);
  }

  // ============================================================================
  // Helpers
  // ============================================================================
  function esc(s) {
    return (s == null ? '' : String(s)).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function roleClass(role) { return ({ owner: 'pill--owner', admin: 'pill--admin' }[role]) || 'pill--user'; }
  function statusClass(s) { return s === 'Suspended' ? 'pill--suspended' : 'pill--active'; }

  async function api(url, opts = {}) {
    const res = await fetch(url, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      ...opts,
    });
    const data = await res.json().catch(() => ({ ok: false, error: 'Bad response' }));
    if (!res.ok || data.ok === false) {
      const err = new Error(data.error || `Request failed (${res.status})`);
      err.code = data.code;
      err.status = res.status;
      throw err;
    }
    return data;
  }

  // ============================================================================
  // Render
  // ============================================================================
  function applyFilter() {
    const q = (searchEl.value || '').trim().toLowerCase();
    filtered = !q ? users.slice() : users.filter((u) =>
      (u.fullName || '').toLowerCase().includes(q) ||
      (u.email || '').toLowerCase().includes(q) ||
      (u.clientCode || '').toLowerCase().includes(q)
    );
    renderRows();
  }

  function renderRows() {
    statEl.textContent = filtered.length === users.length
      ? `${users.length} ${users.length === 1 ? 'user' : 'users'}`
      : `${filtered.length} of ${users.length}`;

    if (filtered.length === 0) {
      rowsEl.innerHTML = `<tr><td colspan="5">
        <div class="empty">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
          <h3>${users.length === 0 ? 'No staff yet' : 'No matches'}</h3>
          <p>${users.length === 0 ? 'Add your first team member to give them access.' : 'Try a different search term.'}</p>
          ${users.length === 0 ? '<button class="btn btn--primary" onclick="document.getElementById(\'btn-add\').click()">Add staff</button>' : ''}
        </div>
      </td></tr>`;
      return;
    }

    rowsEl.innerHTML = filtered.map((u) => {
      const products = (u.permissions || []).slice(0, 3).map((p) =>
        `<span class="pill ${roleClass(p.role)}" title="${esc(p.productName)} (${esc(p.role)})">${esc(p.productName || p.productSlug)}</span>`
      ).join('');
      const more = u.permissions.length > 3 ? `<span class="pill pill--user">+${u.permissions.length - 3}</span>` : '';

      return `<tr data-id="${esc(u.recordId)}">
        <td>
          <div class="cell-name">${esc(u.fullName)}</div>
          <div class="cell-meta">${esc(u.clientCode || '—')}</div>
        </td>
        <td><div class="cell-meta" style="color: var(--tg-text-primary); font-size: 14px;">${esc(u.email)}</div></td>
        <td><div class="pill-row">${products}${more || '<span class="pill pill--user">None</span>'}</div></td>
        <td><span class="pill ${statusClass(u.status)}">${esc(u.status)}</span></td>
        <td class="cell-actions">
          ${u.status === 'Active'
            ? `<button class="btn btn--sm" data-act="suspend" data-id="${esc(u.recordId)}">Suspend</button>`
            : `<button class="btn btn--sm" data-act="reactivate" data-id="${esc(u.recordId)}">Reactivate</button>`}
        </td>
      </tr>`;
    }).join('');
  }

  // ============================================================================
  // Actions
  // ============================================================================
  rowsEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = btn.dataset.id;
    const act = btn.dataset.act;
    btn.disabled = true;
    try {
      if (act === 'suspend') {
        await api(API.user(id), { method: 'PATCH', body: JSON.stringify({ status: 'Suspended' }) });
        toast('User suspended', 'ok');
      } else if (act === 'reactivate') {
        await api(API.user(id), { method: 'PATCH', body: JSON.stringify({ status: 'Active' }) });
        toast('User reactivated', 'ok');
      }
      await loadUsers();
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      btn.disabled = false;
    }
  });

  // ============================================================================
  // Modal — Add Staff
  // ============================================================================
  function openModal() {
    document.body.style.overflow = 'hidden';
    $('#form-pane').style.display = 'block';
    $('#success-pane').style.display = 'none';
    $('#modal-foot-form').style.display = 'flex';
    $('#modal-foot-success').style.display = 'none';
    $('#form-error').classList.remove('is-on');
    $('#f-name').value = '';
    $('#f-email').value = '';
    $('#f-role').value = 'owner';
    $('#f-plan').value = 'Bespoke';
    $('#f-send-email').checked = true;
    renderProductChecklist();
    modal.classList.add('is-open');
    setTimeout(() => $('#f-name').focus(), 50);
  }
  function closeModal() {
    modal.classList.remove('is-open');
    document.body.style.overflow = '';
  }

  function renderProductChecklist() {
    $('#products').innerHTML = ALL_PRODUCTS.map((p) => `
      <label class="check-row">
        <input type="checkbox" value="${esc(p.slug)}" checked>
        <span class="name">${esc(p.name)}</span>
        <span class="slug">${esc(p.slug)}</span>
      </label>
    `).join('');
  }

  $('#btn-add').addEventListener('click', openModal);
  $('#modal-add-close').addEventListener('click', closeModal);
  $('#btn-cancel').addEventListener('click', closeModal);
  $('#btn-done').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modal.classList.contains('is-open')) closeModal(); });

  $('#btn-create').addEventListener('click', async () => {
    const errEl = $('#form-error');
    errEl.classList.remove('is-on');

    const fullName = $('#f-name').value.trim();
    const email = $('#f-email').value.trim().toLowerCase();
    const role = $('#f-role').value;
    const plan = $('#f-plan').value;
    const sendEmail = $('#f-send-email').checked;
    const productSlugs = Array.from($('#products').querySelectorAll('input:checked')).map((i) => i.value);

    if (fullName.length < 2) { errEl.textContent = 'Enter a full name (at least 2 characters).'; errEl.classList.add('is-on'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { errEl.textContent = 'Enter a valid email address.'; errEl.classList.add('is-on'); return; }
    if (productSlugs.length === 0) { errEl.textContent = 'Select at least one product.'; errEl.classList.add('is-on'); return; }

    const btn = $('#btn-create');
    btn.disabled = true; btn.textContent = 'Creating…';

    try {
      const res = await api(API.users, {
        method: 'POST',
        body: JSON.stringify({ fullName, email, role, plan, productSlugs, sendEmail }),
      });
      // Show success pane
      $('#succ-email').textContent = res.user.email;
      $('#succ-code').textContent = res.user.clientCode;
      const statusEl = $('#email-status');
      if (res.email && res.email.sent) {
        statusEl.className = 'email-status email-status--sent';
        statusEl.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;margin-top:1px;"><polyline points="20 6 9 17 4 12"/></svg> Welcome email sent to ${esc(res.user.email)}.`;
      } else {
        statusEl.className = 'email-status email-status--manual';
        const reason = res.email && res.email.reason ? res.email.reason : 'Auto-send unavailable.';
        statusEl.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;margin-top:1px;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> <strong>Send manually:</strong> ${esc(reason)} Copy the code and email it to ${esc(res.user.email)}.`;
      }
      $('#form-pane').style.display = 'none';
      $('#success-pane').style.display = 'block';
      $('#modal-foot-form').style.display = 'none';
      $('#modal-foot-success').style.display = 'flex';
      // Refresh the table in the background
      loadUsers();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.add('is-on');
    } finally {
      btn.disabled = false; btn.textContent = 'Create staff account';
    }
  });

  // Copy buttons in success pane
  document.addEventListener('click', (e) => {
    const c = e.target.closest('.cred-copy');
    if (!c) return;
    const el = document.getElementById(c.dataset.copy);
    if (!el) return;
    navigator.clipboard.writeText(el.textContent).then(() => {
      const orig = c.textContent;
      c.textContent = 'Copied';
      setTimeout(() => { c.textContent = orig; }, 1200);
    });
  });

  // ============================================================================
  // Search (debounced)
  // ============================================================================
  let searchTimer;
  searchEl.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(applyFilter, 120);
  });

  // ============================================================================
  // Load
  // ============================================================================
  async function loadUsers() {
    try {
      const res = await api(API.users);
      users = res.users || [];
      applyFilter();
    } catch (err) {
      if (err.status === 401 || err.status === 403) {
        rowsEl.innerHTML = `<tr><td colspan="5"><div class="empty">
          <h3>Admin access only</h3>
          <p>${esc(err.message)}</p>
        </div></td></tr>`;
        statEl.textContent = '—';
      } else {
        toast(err.message, 'err');
      }
    }
  }

  // Theme: respect parent's data-theme attribute if iframed
  try {
    if (window.parent && window.parent !== window && window.parent.document) {
      const theme = window.parent.document.documentElement.getAttribute('data-theme');
      if (theme) document.documentElement.setAttribute('data-theme', theme);
    }
  } catch { /* cross-origin parent — ignore */ }

  loadUsers();
</script>
</body>
</html>
