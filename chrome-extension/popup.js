'use strict';

const DEFAULT_BASE = 'https://widgets.travelify.io';
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let base = DEFAULT_BASE, widgetId = '', tz = 'Europe/London', eventId = '', selected = [];

function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 1900); }

const dayKey = (iso) => { try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso)); } catch (e) { return iso.slice(0, 10); } };
const dayLabel = (iso) => { try { return new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(iso)); } catch (e) { return iso; } };
const timeLabel = (iso) => { try { return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso)).replace(/\s/g, ''); } catch (e) { return iso; } };
const fullLabel = (iso) => { try { return new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso)); } catch (e) { return iso; } };
const bookLink = (iso) => base + '/book-appointment?widget=' + encodeURIComponent(widgetId) + '&start=' + encodeURIComponent(iso) + (eventId ? '&event=' + encodeURIComponent(eventId) : '');

function showSetup(msg) {
  $('conn').style.display = 'none';
  $('content').innerHTML =
    '<div class="setup"><p>' + esc(msg || 'Add your scheduler to get started.') + '</p>' +
    '<button class="btn primary" id="open-opts">Open settings</button></div>';
  $('open-opts').addEventListener('click', () => chrome.runtime.openOptionsPage());
}

function loadAvailability() {
  $('content').innerHTML = '<div class="state">Loading your availability…</div>';
  const from = new Date().toISOString();
  const to = new Date(Date.now() + 14 * 86400000).toISOString();
  fetch(base + '/api/appointment/availability?widgetId=' + encodeURIComponent(widgetId) + '&from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to))
    .then((r) => r.ok ? r.json() : null)
    .then((d) => {
      if (!d) { $('content').innerHTML = '<div class="state">Could not load availability. Check the scheduler ID in settings.</div>'; return; }
      tz = d.timezone || tz; eventId = d.eventId || eventId;
      const c = $('conn'); c.style.display = ''; c.className = 'pill ' + (d.connected ? 'on' : 'off'); c.textContent = d.connected ? 'Calendar synced' : 'No calendar';
      renderSlots(d.slots || []);
    })
    .catch(() => { $('content').innerHTML = '<div class="state">Network error. Is the scheduler ID correct?</div>'; });
}

function renderSlots(slots) {
  if (!slots.length) { $('content').innerHTML = '<div class="state">No available times in the next two weeks.</div>'; return; }
  const byDay = {};
  slots.forEach((s) => { const k = dayKey(s.startISO); (byDay[k] || (byDay[k] = [])).push(s.startISO); });
  let html = '<div id="slots">';
  Object.keys(byDay).sort().forEach((k) => {
    html += '<div class="day"><div class="day-h">' + esc(dayLabel(byDay[k][0])) + '</div><div class="chips">';
    byDay[k].forEach((iso) => { html += '<button type="button" class="chip' + (selected.indexOf(iso) !== -1 ? ' sel' : '') + '" data-iso="' + esc(iso) + '">' + esc(timeLabel(iso)) + '</button>'; });
    html += '</div></div>';
  });
  html += '</div>' +
    '<div class="compose" id="composer" style="display:none">' +
    '<label class="lbl" for="intro">Intro line</label>' +
    '<textarea id="intro" rows="2">Here are a few times that suit — click whichever works to confirm your appointment:</textarea>' +
    '<label class="lbl" for="outro" style="margin-top:8px">Closing line</label>' +
    '<input id="outro" value="If none of these work, just reply and we\'ll find another.">' +
    '</div>' +
    '<div class="bar"><span class="count" id="count">0 selected</span><span class="spacer"></span>' +
    '<button class="btn ghost" id="copy" disabled>Copy</button>' +
    '<button class="btn primary" id="insert" disabled>Insert into email</button></div>' +
    '<div class="foot"><button class="link" id="settings">Settings</button></div>';
  $('content').innerHTML = html;

  document.querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => {
    const iso = b.getAttribute('data-iso');
    const at = selected.indexOf(iso);
    if (at !== -1) { selected.splice(at, 1); b.classList.remove('sel'); }
    else { if (selected.length >= 12) { toast('Up to 12 options'); return; } selected.push(iso); b.classList.add('sel'); }
    update();
  }));
  $('intro').addEventListener('input', update);
  $('outro').addEventListener('input', update);
  $('copy').addEventListener('click', copyBlock);
  $('insert').addEventListener('click', insertBlock);
  $('settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
  update();
}

function buildHtml() {
  const intro = esc($('intro').value.trim()), outro = esc($('outro').value.trim());
  const items = selected.slice().sort().map((iso) => '<li><a href="' + esc(bookLink(iso)) + '">' + esc(fullLabel(iso)) + '</a></li>').join('');
  return '<div>' + (intro ? '<p>' + intro + '</p>' : '') + '<ul>' + items + '</ul>' + (outro ? '<p>' + outro + '</p>' : '') + '</div>';
}
function buildText() {
  const intro = $('intro').value.trim(), outro = $('outro').value.trim();
  const lines = selected.slice().sort().map((iso) => '• ' + fullLabel(iso) + ': ' + bookLink(iso)).join('\n');
  return (intro ? intro + '\n\n' : '') + lines + (outro ? '\n\n' + outro : '');
}

function update() {
  const n = selected.length;
  $('count').textContent = n + ' selected';
  $('copy').disabled = n === 0;
  $('insert').disabled = n === 0;
  const comp = $('composer'); if (comp) comp.style.display = n ? '' : 'none';
}

function copyBlock() {
  const html = buildHtml(), text = buildText();
  if (navigator.clipboard && window.ClipboardItem) {
    navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })])
      .then(() => toast('Copied — paste into your email'))
      .catch(() => navigator.clipboard.writeText(text).then(() => toast('Copied (plain text)')).catch(() => toast('Copy failed')));
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => toast('Copied (plain text)')).catch(() => {});
  }
}

async function insertBlock() {
  const html = buildHtml(), text = buildText();
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) throw new Error('no tab');
    const res = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (h, t) => {
        try {
          const el = document.activeElement;
          if (el && el.isContentEditable) { document.execCommand('insertHTML', false, h); return true; }
          if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')) {
            const s = el.selectionStart == null ? el.value.length : el.selectionStart;
            const e = el.selectionEnd == null ? s : el.selectionEnd;
            el.value = el.value.slice(0, s) + t + el.value.slice(e);
            return true;
          }
          const ce = Array.from(document.querySelectorAll('[contenteditable="true"],[contenteditable=""]')).pop();
          if (ce) { ce.focus(); document.execCommand('insertHTML', false, h); return true; }
          return false;
        } catch (e) { return false; }
      },
      args: [html, text],
    });
    if (res && res[0] && res[0].result) { toast('Inserted into the page'); }
    else { copyBlock(); toast('No email field found — copied instead'); }
  } catch (e) {
    copyBlock();
  }
}

// Boot
chrome.storage.sync.get({ baseUrl: DEFAULT_BASE, widgetId: '' }, (s) => {
  base = String(s.baseUrl || DEFAULT_BASE).replace(/\/$/, '');
  widgetId = String(s.widgetId || '').trim();
  if (!widgetId) { showSetup('Add your scheduler ID in settings to start sending time options.'); return; }
  loadAvailability();
});
