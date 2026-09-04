/**
 * Travelgenix editor — shared lead-email settings (v1.0.0)
 *
 * Drops the two EMAIL lead destinations into any editor whose widget hands its
 * submissions to the shared lead router (dispatchLead):
 *
 *   • Team notification  — tells the client's own team a lead has landed
 *   • Welcome email      — the branded email the person who filled the form gets
 *
 * Why this exists: Form, Tour and Trips all call dispatchLead, so they can
 * already send both emails, but their editors had no routing UI whatsoever.
 * The Form editor even told clients to "open the Routing panel from the
 * dashboard", and no such panel exists. So those clients could not see,
 * configure or write emails their own widgets were capable of sending.
 *
 * It talks to the existing /api/routing-configs endpoint, which is already
 * generic over widgetId — nothing server-side had to change to support more
 * widgets. The welcome email is written in the shared popup
 * (/editor-email-popup.js) and previewed through /_welcome-email-template.js,
 * the exact module api/_lib/destinations/auto-reply.js sends with.
 *
 * The team notification gets fields but no popup: its body is a generated
 * readout of the lead, so only the recipient and subject are worth editing.
 *
 * Usage:
 *   <script src="/editor-email-popup.js"></script>
 *   <script src="/editor-lead-emails.js"></script>
 *   <script type="module">
 *     import { renderWelcomeEmail, welcomeCtaIsUsable } from '/_welcome-email-template.js';
 *     window.TGWelcomeEmail = { renderWelcomeEmail, welcomeCtaIsUsable };
 *   </script>
 *
 *   const leadEmails = TGLeadEmails.mount({
 *     mount: document.getElementById('lead-emails'),
 *     widgetType: 'form',                // key stored on the RoutingConfig
 *     getBrandName: () => C.brandName,   // shown as the preview's From
 *   });
 *   // ...and after a save, so a brand-new widget lights up straight away:
 *   onAfterSave: () => leadEmails.reload(),
 *
 * It resolves the widget's Airtable record id itself from the ?id= in the URL,
 * because the editor shell hands editors the config on load but not the record
 * id, and routing is keyed on the record id.
 */
(function () {
  'use strict';

  const VERSION = '1.0.0';
  const API = '/api/routing-configs';

  const authHeaders = (json) => Object.assign(
    json ? { 'Content-Type': 'application/json' } : {},
    (window.tgse && window.tgse.authHeaders) ? window.tgse.authHeaders() : {}
  );
  const toast = (msg, kind) => { if (window.tgse && window.tgse.toast) window.tgse.toast(msg, kind); };

  const el = (tag, css, text) => {
    const n = document.createElement(tag);
    if (css) n.style.cssText = css;
    if (text != null) n.textContent = text;
    return n;
  };

  const LABEL = 'display:block;font-size:12px;font-weight:500;color:#475569;margin-bottom:4px';
  const INPUT = 'width:100%;font:inherit;font-size:13px;padding:8px 10px;color:#0F172A;background:#fff;'
    + 'border:1px solid #E2E8F0;border-radius:6px;outline:none;box-sizing:border-box';
  const HINT = 'font-size:11px;color:#94A3B8;line-height:1.45;margin:4px 0 0';

  function mount(opts) {
    const host = opts && opts.mount;
    if (!host) return null;
    const widgetType = String((opts && opts.widgetType) || '').trim();
    const getBrandName = (opts && opts.getBrandName) || (() => '');
    const getWidgetId = (opts && opts.getWidgetId)
      || (() => new URLSearchParams(location.search).get('id') || '');

    let configs = [];
    let loaded = false;
    let recordId = null;

    const find = (dest) => configs.find(c => c.destination === dest) || null;
    const getRecordId = () => recordId;

    // The record id is only on the AUTHENTICATED widget-config response, and
    // the shell passes editors the config alone, so resolve it here.
    async function resolveRecordId() {
      const wid = getWidgetId();
      if (!wid) return null;
      try {
        const r = await fetch('/api/widget-config?id=' + encodeURIComponent(wid), { headers: authHeaders(false) });
        if (!r.ok) return null;
        const d = await r.json();
        return (d && d.recordId) || null;
      } catch (err) { return null; }
    }

    async function load() {
      if (!recordId) recordId = await resolveRecordId();
      const id = getRecordId();
      if (!id) { loaded = false; render(); return; }
      try {
        const r = await fetch(API + '?widgetId=' + encodeURIComponent(id), { headers: authHeaders(false) });
        if (!r.ok) { console.warn('[lead-emails] load', r.status); render(); return; }
        const data = await r.json();
        configs = Array.isArray(data.configs) ? data.configs : [];
        loaded = true;
      } catch (err) {
        console.warn('[lead-emails] load error', err && err.message);
      }
      render();
    }

    // Create on first save, update thereafter. Never deletes: switching a
    // destination off leaves the client's wording intact for next time.
    async function persist(dest, patch) {
      const id = getRecordId();
      if (!id) { toast('Save the widget first', 'error'); return null; }
      const existing = find(dest);
      const body = existing
        ? Object.assign({ op: 'update', id: existing.id }, patch)
        : Object.assign({
            op: 'create', widgetType: widgetType, widgetRecordId: id,
            destination: dest, enabled: true,
          }, patch);
      try {
        const r = await fetch(API, { method: 'POST', headers: authHeaders(true), body: JSON.stringify(body) });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) { toast(data.error || 'Could not save', 'error'); return null; }
        if (data.config) {
          const i = configs.findIndex(c => c.id === data.config.id);
          if (i === -1) configs.push(data.config); else configs[i] = data.config;
        }
        return data.config || null;
      } catch (err) {
        toast('Could not save', 'error');
        return null;
      }
    }

    // Debounced so typing a recipient does not fire a write per keystroke.
    let timer = null;
    const persistLater = (dest, getPatch) => {
      clearTimeout(timer);
      timer = setTimeout(() => { persist(dest, getPatch()); }, 600);
    };

    function switchRow(label, on, onChange) {
      const row = el('div', 'display:flex;align-items:center;justify-content:space-between;gap:12px;padding:2px 0 10px');
      row.appendChild(el('span', 'font-size:13px;color:#0F172A', label));
      const btn = el('button');
      btn.type = 'button';
      btn.setAttribute('role', 'switch');
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
      const paint = (v) => {
        btn.style.cssText = 'width:40px;height:22px;border-radius:999px;border:0;cursor:pointer;position:relative;'
          + 'transition:background .15s;background:' + (v ? '#10B981' : '#CBD5E1');
        btn.innerHTML = '<span style="position:absolute;top:3px;left:' + (v ? '21px' : '3px')
          + ';width:16px;height:16px;border-radius:50%;background:#fff;transition:left .15s"></span>';
      };
      paint(on);
      btn.addEventListener('click', () => {
        const next = btn.getAttribute('aria-checked') !== 'true';
        btn.setAttribute('aria-checked', next ? 'true' : 'false');
        paint(next);
        onChange(next);
      });
      row.appendChild(btn);
      return row;
    }

    function field(labelText, value, placeholder, maxlength, onInput, hint) {
      const wrap = el('div', 'margin-bottom:12px');
      const lbl = el('label', LABEL, labelText);
      wrap.appendChild(lbl);
      const input = el('input');
      input.type = 'text';
      input.value = value || '';
      if (placeholder) input.placeholder = placeholder;
      if (maxlength) input.maxLength = maxlength;
      input.style.cssText = INPUT;
      input.addEventListener('input', () => onInput(input.value));
      wrap.appendChild(input);
      if (hint) wrap.appendChild(el('p', HINT, hint));
      return wrap;
    }

    function openWelcomePopup() {
      if (!window.TGEmailPopup || !window.TGWelcomeEmail) return;
      const rc = find('auto-reply');
      const cfg = Object.assign({}, (rc && rc.config) || {});
      const has = () => !!(String(cfg.subject || '').trim() || String(cfg.headline || '').trim() || String(cfg.body || '').trim());
      window.TGEmailPopup.open({
        onClose: render,
        emails: [{
          key: 'welcome',
          label: 'Welcome email',
          from: () => cfg.fromName || getBrandName() || 'Travelgenix',
          to: 'sarah@example.com (whoever fills the form)',
          tags: [
            { tag: '{firstName}', label: 'First name' },
            { tag: '{fromName}', label: 'Your company' },
          ],
          fields: [
            { key: 'fromName', type: 'text', label: 'From name', maxlength: 80, placeholder: 'Travelgenix',
              hint: 'The name this email comes from. Leave blank and it comes from Travelgenix.' },
            { key: 'subject', type: 'text', label: 'Subject', maxlength: 200, placeholder: 'You are in. Welcome to Travelgenix.' },
            { key: 'headline', type: 'text', label: 'Headline', maxlength: 120, placeholder: 'You are on the list', tagsAfter: true },
            { key: 'body', type: 'textarea', label: 'Message', grow: true,
              placeholder: 'Leave blank to use our friendly default.',
              hint: 'One line per paragraph. Leave blank to send our standard welcome, shown in the preview.' },
            { key: 'ctaLabel', type: 'text', label: 'Button text', maxlength: 40, placeholder: 'Browse destinations' },
            { key: 'ctaUrl', type: 'text', label: 'Button link', placeholder: 'https://yourwebsite.com',
              hint: 'A button needs BOTH text and a link starting with https://, or it is left out.' },
          ],
          read: () => cfg,
          write: (k, v) => { cfg[k] = v; persistLater('auto-reply', () => ({ config: Object.assign({}, cfg) })); },
          render: (v) => {
            const out = window.TGWelcomeEmail.renderWelcomeEmail(v, { contact: { firstName: 'Sarah' } });
            const wantsButton = String(v.ctaLabel || '').trim() || String(v.ctaUrl || '').trim();
            const usable = window.TGWelcomeEmail.welcomeCtaIsUsable(v.ctaLabel, v.ctaUrl);
            let note;
            if (rc && rc.enabled === false) note = 'This email is switched off. Turn it back on for people to receive it.';
            else if (wantsButton && !usable) note = 'The button needs BOTH text and a link starting with https:// — until then it is left out, as shown.';
            else if (!has()) note = 'You are previewing our standard welcome, filled with a sample signup. Start typing to replace it with your own.';
            else note = 'Preview uses a sample signup. Tags are filled per real person.';
            return { subject: out.subject, html: out.html, note: note };
          },
          reset: {
            label: 'Use our standard wording',
            isSet: has,
            run: (applied) => {
              ['subject', 'headline', 'body', 'ctaLabel', 'ctaUrl'].forEach(k => { cfg[k] = ''; });
              persist('auto-reply', { config: Object.assign({}, cfg) });
              applied();
            },
          },
        }],
      });
    }

    function render() {
      host.textContent = '';

      if (!getRecordId()) {
        const note = el('p', HINT + ';margin:0',
          'Save this widget once and the email settings appear here.');
        host.appendChild(note);
        return;
      }
      if (!loaded) {
        host.appendChild(el('p', HINT + ';margin:0', 'Loading your email settings…'));
        return;
      }

      // ── Team notification ──
      const team = find('email');
      const teamCfg = Object.assign({}, (team && team.config) || {});
      const teamBox = el('div', 'padding:12px 14px;border:1px solid #E2E8F0;border-radius:10px;background:#F8FAFC;margin-bottom:10px');
      teamBox.appendChild(el('div', 'font-size:13px;font-weight:600;color:#0F172A;margin-bottom:2px', 'Tell your team'));
      teamBox.appendChild(el('p', HINT + ';margin:0 0 10px', 'An email to you each time someone submits, with their answers.'));
      teamBox.appendChild(switchRow('Send it', !team || team.enabled !== false, (on) => {
        persist('email', { enabled: on, config: teamCfg }).then(render);
      }));
      teamBox.appendChild(field('Send to', teamCfg.to, 'team@yourcompany.com', 200,
        (v) => { teamCfg.to = v; persistLater('email', () => ({ config: Object.assign({}, teamCfg) })); },
        'One address. Sent from notifications@travelgenix.io.'));
      teamBox.appendChild(field('Subject (optional)', teamCfg.subject, 'New enquiry from {firstName}', 200,
        (v) => { teamCfg.subject = v; persistLater('email', () => ({ config: Object.assign({}, teamCfg) })); },
        'Leave blank for our default. You can use {firstName}.'));
      host.appendChild(teamBox);

      // ── Welcome email ──
      const rc = find('auto-reply');
      const wc = (rc && rc.config) || {};
      const hasCopy = !!(String(wc.subject || '').trim() || String(wc.headline || '').trim() || String(wc.body || '').trim());
      const wrap = el('div', 'padding:12px 14px;border:1px solid #E2E8F0;border-radius:10px;background:#F8FAFC');
      wrap.appendChild(el('div', 'font-size:13px;font-weight:600;color:#0F172A;margin-bottom:2px', 'Welcome the person who filled it in'));
      wrap.appendChild(el('p', HINT + ';margin:0 0 10px', 'A branded email back to them, so they know it arrived.'));
      wrap.appendChild(switchRow('Send it', !!(rc && rc.enabled !== false), (on) => {
        persist('auto-reply', { enabled: on, config: Object.assign({}, wc) }).then(render);
      }));
      if (window.TGEmailPopup) {
        wrap.appendChild(window.TGEmailPopup.card({
          title: 'Welcome email',
          status: !rc ? 'Not set up yet' : (rc.enabled === false ? 'Switched off' : (hasCopy ? 'Your own wording' : 'Using our standard wording')),
          isCustom: hasCopy,
          onEdit: openWelcomePopup,
        }));
      }
      host.appendChild(wrap);
    }

    render();
    load();
    return { reload: load, refresh: render };
  }

  window.TGLeadEmails = { mount: mount, VERSION: VERSION };
  window.__TG_LEAD_EMAILS_VERSION__ = VERSION;
})();
