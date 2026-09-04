/**
 * Travelgenix editor — shared email popup (v1.0.0)
 *
 * ONE popup for every widget editor where a client writes an email. Write on
 * the left, see the real email rendered live on the right.
 *
 * Why this file exists: the popup was built for My Booking (Sep 2026), then
 * again for Enquiry, and the two copies had already drifted (message box
 * 220px vs 200px) before a third and fourth were needed for Newsletter and
 * Popup. Andy's ask was consistency across all the widgets, so the popup is
 * now one component and consistency is structural rather than remembered.
 *
 * The editor supplies WHAT its emails are; this file owns HOW they are edited:
 * chrome, tabs, merge-tag chips, the envelope bar, the sandboxed preview and
 * every close path. An editor never rebuilds any of that.
 *
 * Usage (classic script — works from a module or a plain editor script):
 *
 *   <script src="/editor-email-popup.js"></script>
 *
 *   TGEmailPopup.open({
 *     startKey: 'customer',
 *     onChange: debouncedSave,       // called after every keystroke
 *     onClose:  () => refreshCards(),
 *     emails: [{
 *       key: 'customer',
 *       label: 'Customer confirmation',
 *       from: () => brandName,        // string or function
 *       to:   'sarah@example.com (the visitor)',
 *       tags: [{ tag: '{firstName}', label: 'First name' }],
 *       fields: [
 *         { key: 'subject', type: 'text',     label: 'Subject', maxlength: 200 },
 *         { key: 'body',    type: 'textarea', label: 'Message', grow: true, hint: '...' },
 *         { key: 'html',    type: 'advanced', label: 'Advanced: your own HTML', hint: '...' },
 *       ],
 *       read:   () => ({ subject: '', body: '', html: '' }),
 *       write:  (key, value) => { ... },        // persist one field
 *       render: (values) => ({ subject, html, note }),  // the REAL renderer
 *       reset: {                       // optional "back to our wording" link
 *         label: 'Use our standard wording',
 *         isSet: () => bool,           // nothing written yet -> the link no-ops
 *         run: (applied) => confirmThen(() => { clearCopy(); applied(); }),
 *       },
 *     }],
 *   });
 *
 * The `render` callback must return the email the SERVER would send, produced
 * by the same shared module the sender imports. That is the whole point: a
 * preview that cannot drift from what lands in the customer's inbox.
 */
(function () {
  'use strict';

  const VERSION = '1.0.0';
  const STYLE_ID = 'tgep-styles';

  const CSS = `
  .tgep-overlay { position:fixed; inset:0; background:rgba(15,23,42,.6); backdrop-filter:blur(4px);
    z-index:600; display:flex; align-items:center; justify-content:center; padding:24px;
    opacity:0; transition:opacity .2s; font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; }
  .tgep-overlay.is-open { opacity:1; }
  .tgep-modal { width:100%; max-width:1240px; height:min(860px, calc(100vh - 48px)); background:#fff;
    border-radius:16px; overflow:hidden; display:flex; flex-direction:column;
    box-shadow:0 20px 25px rgba(15,23,42,.14); transform:translateY(8px); transition:transform .2s; }
  .tgep-overlay.is-open .tgep-modal { transform:none; }
  .tgep-head { display:flex; align-items:center; gap:16px; padding:14px 20px; border-bottom:1px solid #E2E8F0; flex-shrink:0; }
  .tgep-head h2 { margin:0; font-size:15px; font-weight:600; letter-spacing:-.01em; color:#0F172A; }
  .tgep-tabs { display:flex; gap:4px; background:#F1F5F9; padding:3px; border-radius:10px; }
  .tgep-tab { font:inherit; font-size:12px; font-weight:600; padding:7px 14px; border:0; border-radius:8px;
    background:transparent; color:#475569; cursor:pointer; transition:all .15s; }
  .tgep-tab.is-active { background:#fff; color:#0F172A; box-shadow:0 1px 2px rgba(15,23,42,.06); }
  .tgep-close { margin-left:auto; width:32px; height:32px; border:1px solid #E2E8F0; border-radius:8px;
    background:#fff; color:#475569; font-size:18px; line-height:1; cursor:pointer; }
  .tgep-close:hover { color:#0F172A; border-color:#00B4D8; }
  .tgep-body { flex:1; display:flex; min-height:0; }
  .tgep-pane { width:400px; flex:0 0 400px; display:flex; flex-direction:column; gap:12px;
    padding:18px 20px; border-right:1px solid #E2E8F0; overflow-y:auto; }
  .tgep-field { display:flex; flex-direction:column; }
  .tgep-field.is-grow { flex:1; min-height:0; }
  .tgep-field label { display:block; font-size:12px; font-weight:500; color:#475569; margin-bottom:4px; }
  .tgep-field input[type=text], .tgep-field textarea { width:100%; font:inherit; font-size:13px; padding:8px 10px;
    color:#0F172A; background:#fff; border:1px solid #E2E8F0; border-radius:6px; outline:none; transition:border-color .15s; }
  .tgep-field input[type=text]:focus, .tgep-field textarea:focus { border-color:#00B4D8; box-shadow:0 0 0 3px rgba(0,180,216,.12); }
  .tgep-field.is-grow textarea { flex:1; min-height:220px; resize:vertical; line-height:1.5; }
  .tgep-field textarea { min-height:96px; resize:vertical; line-height:1.5; }
  .tgep-hint { font-size:11px; color:#94A3B8; line-height:1.45; margin:4px 0 0; }
  .tgep-tags { display:flex; flex-wrap:wrap; gap:6px; }
  .tgep-tag { font:inherit; font-size:11px; font-weight:600; padding:4px 9px; border:1px solid #E2E8F0;
    border-radius:20px; background:#F8FAFC; color:#475569; cursor:pointer; transition:all .15s; }
  .tgep-tag:hover { border-color:#00B4D8; color:#0F172A; }
  .tgep-reset { align-self:flex-start; margin-top:4px; padding:0; border:0; background:none; font:inherit;
    font-size:12px; font-weight:600; color:#475569; text-decoration:underline; text-underline-offset:3px; cursor:pointer; }
  .tgep-reset:hover { color:#EF4444; }
  .tgep-adv { border-top:1px solid #F1F5F9; padding-top:8px; }
  .tgep-adv > summary { font-size:12px; font-weight:600; color:#475569; cursor:pointer; padding:6px 0; }
  .tgep-adv textarea { font-family:'SF Mono',Menlo,Consolas,monospace; font-size:11px; min-height:120px; }
  .tgep-preview { flex:1; display:flex; flex-direction:column; min-width:0; background:#F1F5F9; }
  .tgep-env { padding:10px 20px; background:#fff; border-bottom:1px solid #E2E8F0; flex-shrink:0; }
  .tgep-env-row { display:flex; gap:10px; padding:2px 0; font-size:12px; color:#0F172A; min-width:0; }
  .tgep-env-row > span:first-child { width:52px; flex-shrink:0; color:#94A3B8; }
  .tgep-env-row strong, .tgep-env-row .tgep-env-val { font-weight:600; min-width:0; overflow:hidden;
    text-overflow:ellipsis; white-space:nowrap; }
  .tgep-env-row .tgep-env-val { font-weight:400; }
  .tgep-preview iframe { flex:1; width:100%; border:0; background:#F1F5F9; }
  .tgep-foot { display:flex; align-items:center; gap:12px; padding:12px 20px; border-top:1px solid #E2E8F0; flex-shrink:0; }
  .tgep-note { flex:1; font-size:12px; color:#475569; line-height:1.4; margin:0; }
  .tgep-done { height:38px; padding:0 22px; font:inherit; font-size:13px; font-weight:600; border-radius:8px;
    background:#1B2B5B; border:1px solid #1B2B5B; color:#fff; cursor:pointer; }
  .tgep-done:hover { background:#0891B2; border-color:#0891B2; }
  @media (max-width: 900px) {
    .tgep-body { flex-direction:column; overflow-y:auto; }
    .tgep-pane { width:auto; flex:none; border-right:0; border-bottom:1px solid #E2E8F0; overflow:visible; }
    .tgep-field.is-grow textarea { min-height:160px; }
    .tgep-preview { flex:none; min-height:520px; }
    .tgep-preview iframe { min-height:420px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .tgep-overlay, .tgep-modal { transition:none; }
  }`;

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = CSS;
    document.head.appendChild(el);
  }

  const val = (v) => (typeof v === 'function' ? v() : (v == null ? '' : v));

  /**
   * A sidebar card: the email's name, whether the client's own wording is in
   * use, and the button that opens the popup. Every editor gets the same card
   * so the entry point looks the same everywhere too.
   */
  function card(opts) {
    const wrap = document.createElement('div');
    wrap.className = 'tgep-card';
    wrap.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;'
      + 'padding:12px 14px;border:1px solid #E2E8F0;border-radius:10px;background:#F8FAFC;margin-bottom:10px;';
    const info = document.createElement('div');
    const title = document.createElement('div');
    title.style.cssText = 'font-size:13px;font-weight:600;color:#0F172A;';
    title.textContent = opts.title;
    const status = document.createElement('div');
    status.style.cssText = 'font-size:11px;margin-top:2px;'
      + (opts.isCustom ? 'color:#10B981;font-weight:600;' : 'color:#94A3B8;');
    status.textContent = opts.status;
    info.appendChild(title);
    info.appendChild(status);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = opts.buttonLabel || 'Edit email';
    btn.style.cssText = 'flex-shrink:0;height:32px;padding:0 14px;font:inherit;font-size:12px;font-weight:600;'
      + 'color:#0891B2;background:#fff;border:1px solid #E2E8F0;border-radius:8px;cursor:pointer;';
    btn.addEventListener('click', opts.onEdit);
    wrap.appendChild(info);
    wrap.appendChild(btn);
    return wrap;
  }

  function open(config) {
    ensureStyles();
    const emails = (config && config.emails) || [];
    if (!emails.length) return null;
    let current = emails.find((e) => e.key === config.startKey) || emails[0];
    let lastField = null;

    const overlay = document.createElement('div');
    overlay.className = 'tgep-overlay';

    const modal = document.createElement('div');
    modal.className = 'tgep-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'tgep-title');

    // ── Head: title, one tab per email, close ──
    const head = document.createElement('div');
    head.className = 'tgep-head';
    const h2 = document.createElement('h2');
    h2.id = 'tgep-title';
    head.appendChild(h2);
    const tabs = document.createElement('div');
    tabs.className = 'tgep-tabs';
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Which email');
    // A single email needs no tab strip — one tab to choose from is furniture.
    if (emails.length > 1) head.appendChild(tabs);
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'tgep-close';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.innerHTML = '&times;';
    head.appendChild(closeBtn);
    modal.appendChild(head);

    // ── Body: writing pane + live preview ──
    const body = document.createElement('div');
    body.className = 'tgep-body';
    const pane = document.createElement('div');
    pane.className = 'tgep-pane';
    const preview = document.createElement('div');
    preview.className = 'tgep-preview';
    const env = document.createElement('div');
    env.className = 'tgep-env';
    const envFrom = document.createElement('strong');
    const envTo = document.createElement('span');
    envTo.className = 'tgep-env-val';
    const envSubject = document.createElement('strong');
    [['From', envFrom], ['To', envTo], ['Subject', envSubject]].forEach(([label, node]) => {
      const row = document.createElement('div');
      row.className = 'tgep-env-row';
      const l = document.createElement('span');
      l.textContent = label;
      row.appendChild(l);
      row.appendChild(node);
      env.appendChild(row);
    });
    const frame = document.createElement('iframe');
    frame.title = 'Email preview';
    // Sandbox with no allow-* tokens: the previewed HTML is client-authored and
    // must never run script or reach the editor's own page.
    frame.setAttribute('sandbox', '');
    preview.appendChild(env);
    preview.appendChild(frame);
    body.appendChild(pane);
    body.appendChild(preview);
    modal.appendChild(body);

    // ── Foot: the note the current email wants to say, and Done ──
    const foot = document.createElement('div');
    foot.className = 'tgep-foot';
    const note = document.createElement('p');
    note.className = 'tgep-note';
    const done = document.createElement('button');
    done.type = 'button';
    done.className = 'tgep-done';
    done.textContent = 'Done';
    foot.appendChild(note);
    foot.appendChild(done);
    modal.appendChild(foot);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    function draw() {
      const out = current.render(current.read()) || {};
      envFrom.textContent = val(current.from) || 'Your company';
      envTo.textContent = val(current.to) || '';
      envSubject.textContent = out.subject || '';
      frame.srcdoc = out.html || '';
      note.textContent = out.note || '';
    }

    // Drop a merge tag in at the cursor of whichever field was last focused.
    function insertTag(tag) {
      const el = lastField || pane.querySelector('textarea');
      if (!el) return;
      const s = typeof el.selectionStart === 'number' ? el.selectionStart : el.value.length;
      const e = typeof el.selectionEnd === 'number' ? el.selectionEnd : el.value.length;
      el.value = el.value.slice(0, s) + tag + el.value.slice(e);
      el.focus();
      const pos = s + tag.length;
      try { el.setSelectionRange(pos, pos); } catch (err) { /* not selectable */ }
      el.dispatchEvent(new Event('input'));
    }

    function buildPane() {
      pane.textContent = '';
      lastField = null;
      const values = current.read() || {};
      let firstEditable = null;

      (current.fields || []).forEach((f) => {
        const isAdvanced = f.type === 'advanced';
        const host = isAdvanced ? document.createElement('details') : document.createElement('div');
        if (isAdvanced) {
          host.className = 'tgep-adv';
          const sum = document.createElement('summary');
          sum.textContent = f.label;
          host.appendChild(sum);
        } else {
          host.className = 'tgep-field' + (f.grow ? ' is-grow' : '');
          const label = document.createElement('label');
          label.textContent = f.label;
          host.appendChild(label);
        }

        const input = f.type === 'text'
          ? document.createElement('input')
          : document.createElement('textarea');
        if (f.type === 'text') input.type = 'text';
        if (f.maxlength) input.maxLength = f.maxlength;
        if (f.placeholder) input.placeholder = f.placeholder;
        input.value = values[f.key] == null ? '' : String(values[f.key]);
        const id = 'tgep-f-' + current.key + '-' + f.key;
        input.id = id;
        const lbl = host.querySelector('label');
        if (lbl) lbl.setAttribute('for', id);

        input.addEventListener('focus', () => { lastField = input; });
        input.addEventListener('input', () => {
          current.write(f.key, input.value);
          if (typeof config.onChange === 'function') config.onChange();
          draw();
        });
        host.appendChild(input);

        if (f.hint) {
          const hint = document.createElement('p');
          hint.className = 'tgep-hint';
          hint.textContent = f.hint;
          host.appendChild(hint);
        }
        pane.appendChild(host);
        if (!firstEditable && !isAdvanced) firstEditable = input;

        // Tag chips sit directly under the first field that accepts them, so
        // clicking one lands where the client is already writing.
        if (f.tagsAfter && (current.tags || []).length) {
          const tagWrap = document.createElement('div');
          tagWrap.className = 'tgep-field';
          const tl = document.createElement('label');
          tl.textContent = 'Tags (click to drop one in, we fill it per send)';
          tagWrap.appendChild(tl);
          const tagRow = document.createElement('div');
          tagRow.className = 'tgep-tags';
          current.tags.forEach((t) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'tgep-tag';
            b.textContent = t.label;
            b.setAttribute('data-tag', t.tag);
            b.addEventListener('click', () => insertTag(t.tag));
            tagRow.appendChild(b);
          });
          tagWrap.appendChild(tagRow);
          pane.appendChild(tagWrap);
        }
      });

      // "Use our standard wording" — the editor owns the confirm step and calls
      // applied() once the copy is actually cleared, so the pane repopulates
      // from the real config rather than optimistically blanking itself.
      if (current.reset && typeof current.reset.run === 'function') {
        const link = document.createElement('button');
        link.type = 'button';
        link.className = 'tgep-reset';
        link.textContent = current.reset.label || 'Use our standard wording';
        link.addEventListener('click', () => {
          if (typeof current.reset.isSet === 'function' && !current.reset.isSet()) return;
          current.reset.run(() => {
            if (typeof config.onChange === 'function') config.onChange();
            buildPane();
            draw();
          });
        });
        pane.appendChild(link);
      }
      return firstEditable;
    }

    function select(key) {
      const next = emails.find((e) => e.key === key);
      if (!next) return;
      current = next;
      Array.prototype.forEach.call(tabs.children, (b) => {
        const on = b.getAttribute('data-tab') === key;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      h2.textContent = current.label;
      const first = buildPane();
      draw();
      if (first) first.focus();
    }

    emails.forEach((e) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tgep-tab';
      b.setAttribute('role', 'tab');
      b.setAttribute('data-tab', e.key);
      b.textContent = e.tabLabel || e.label;
      b.addEventListener('click', () => select(e.key));
      tabs.appendChild(b);
    });

    // Closing is idempotent: the overlay lingers ~200ms for its fade, so the X
    // and an Escape landing in that window would otherwise fire onClose twice.
    let isClosed = false;
    function close() {
      if (isClosed) return;
      isClosed = true;
      overlay.classList.remove('is-open');
      overlay.setAttribute('data-closing', '1');
      document.removeEventListener('keydown', onKey);
      setTimeout(() => { if (overlay.parentNode) overlay.remove(); }, 200);
      if (typeof config.onClose === 'function') config.onClose();
    }
    function onKey(e) {
      if (e.key === 'Escape') close();
    }
    closeBtn.addEventListener('click', close);
    done.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', onKey);

    select(current.key);
    requestAnimationFrame(() => overlay.classList.add('is-open'));
    return { close: close, refresh: draw };
  }

  window.TGEmailPopup = { open: open, card: card, VERSION: VERSION };
  window.__TG_EMAIL_POPUP_VERSION__ = VERSION;
})();
