/**
 * Travelgenix Scheduler — side panel (the drawer).
 *
 * Calendly-grade layout: account header, one card per MEETING TYPE with its
 * own booking link and share-times flow, and a "Coming up" tab showing the
 * connected calendar's real diary (Google/Microsoft events via
 * /api/appointment/agenda — scheduler bookings appear there naturally since
 * every booking is inserted into that calendar). Falls back to scheduler
 * bookings when no calendar is connected.
 *
 * Auth rides the existing .travelify.io dashboard session; the extension
 * stores nothing.
 */
'use strict';

const API = 'https://widgets.travelify.io';
const PALETTE = ['#7C3AED', '#F59E0B', '#0891B2', '#F97316', '#10B981', '#EC4899'];

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let tab = 'meetings';        // 'meetings' | 'agenda'
let meetings = null;         // [{ widgetId, schedName, ev: {id,label,mins}|null }]
let agenda = null;           // { connected, events } | null until loaded
let bookings = null;         // scheduler bookings (badge matching + fallback)
let filterText = '';

function openTab(url) {
  try { chrome.tabs.create({ url }); }
  catch (e) { window.open(url, '_blank', 'noopener'); }
}
function bookingLink(widgetId, eventId) {
  return API + '/book-appointment?widget=' + encodeURIComponent(widgetId)
    + (eventId ? '&event=' + encodeURIComponent(eventId) : '');
}

/* ── Chrome ─────────────────────────────────────────────────────────── */

function setChrome(mode) {
  // mode: 'full' (tabs+account), 'bare' (share view / signed out)
  $('tabs').hidden = mode !== 'full';
  $('account').hidden = mode !== 'full' || !$('acct-name').textContent;
  $('back').hidden = mode !== 'share';
  if (mode === 'share') $('tabs').hidden = false;
}

function showLoading(msg) {
  setChrome('full');
  $('view').classList.remove('no-pad');
  $('view').innerHTML = '<div class="state">' + esc(msg || 'Loading…') + '</div>';
}

function showSignedOut() {
  setChrome('bare');
  $('view').classList.remove('no-pad');
  $('view').innerHTML =
    '<div class="signin-card">' +
    '<h2>Sign in to Travelgenix</h2>' +
    '<p>Sign in to your dashboard in a new tab, then come back here and refresh.</p>' +
    '<button class="btn primary" id="go-signin">Sign in</button>' +
    '<button class="btn ghost" id="did-signin">I\'ve signed in</button>' +
    '</div>';
  $('go-signin').addEventListener('click', () => openTab(API + '/signin'));
  $('did-signin').addEventListener('click', load);
}

function showError(msg) {
  setChrome('full');
  $('view').classList.remove('no-pad');
  $('view').innerHTML =
    '<div class="state">' + esc(msg) + '<br><br>' +
    '<button class="btn ghost" id="try-again">Try again</button></div>';
  $('try-again').addEventListener('click', load);
}

/* ── Meetings tab ───────────────────────────────────────────────────── */

const LINK_ICON = '<svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>';
const CLOCK_ICON = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>';
const EXT_ICON = '<svg viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';

function renderMeetings() {
  setChrome('full');
  $('view').classList.remove('no-pad');
  if (!meetings) { showLoading('Loading your meetings…'); return; }

  let html = '';
  if (meetings.length > 4) {
    html += '<div class="search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></svg>' +
      '<input id="q" type="search" placeholder="Search meetings…" value="' + esc(filterText) + '"></div>';
  }

  const shown = meetings.filter((m) => {
    if (!filterText) return true;
    const hay = ((m.ev ? m.ev.label : '') + ' ' + m.schedName).toLowerCase();
    return hay.includes(filterText.toLowerCase());
  });

  if (!meetings.length) {
    html += '<div class="state">No appointment schedulers yet.<br>Create one in the dashboard and it appears here.</div>';
  } else if (!shown.length) {
    html += '<div class="state">Nothing matches your search.</div>';
  } else {
    html += shown.map((m, i) => {
      const label = m.ev ? m.ev.label : 'Booking page';
      const meta = (m.ev && m.ev.mins ? m.ev.mins + ' mins · ' : '') + m.schedName;
      const bar = PALETTE[i % PALETTE.length];
      return '<div class="mcard" style="--bar:' + bar + '">' +
        '<div class="m-title" title="' + esc(label) + '">' + esc(label) + '</div>' +
        '<div class="m-meta" title="' + esc(meta) + '">' + esc(meta) + '</div>' +
        '<div class="m-actions">' +
        '<button class="act" data-times="' + i + '" title="Share times that suit">' + CLOCK_ICON + '</button>' +
        '<a class="act" data-open href="' + esc(bookingLink(m.widgetId, m.ev && m.ev.id)) + '" target="_blank" rel="noopener" title="Open booking page">' + EXT_ICON + '</a>' +
        '<span class="spacer"></span>' +
        '<button class="copy-pill" data-copy="' + i + '">' + LINK_ICON + ' Copy link</button>' +
        '</div></div>';
    }).join('');
  }

  $('view').innerHTML = html;

  const q = $('q');
  if (q) {
    q.addEventListener('input', () => { filterText = q.value; renderMeetings(); const nq = $('q'); if (nq) { nq.focus(); nq.setSelectionRange(nq.value.length, nq.value.length); } });
  }
  $('view').querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const m = shown[Number(btn.getAttribute('data-copy'))];
      if (!m) return;
      navigator.clipboard.writeText(bookingLink(m.widgetId, m.ev && m.ev.id)).then(() => {
        btn.classList.add('copied');
        btn.innerHTML = 'Copied ✓';
        setTimeout(() => { btn.classList.remove('copied'); btn.innerHTML = LINK_ICON + ' Copy link'; }, 1500);
      }).catch(() => { btn.innerHTML = 'Copy failed'; });
    });
  });
  $('view').querySelectorAll('[data-times]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const m = shown[Number(btn.getAttribute('data-times'))];
      if (m) showShare(m);
    });
  });
}

function showShare(m) {
  setChrome('share');
  $('view').classList.add('no-pad');
  const url = API + '/appointment-share?widget=' + encodeURIComponent(m.widgetId)
    + (m.ev && m.ev.id ? '&event=' + encodeURIComponent(m.ev.id) : '');
  $('view').innerHTML = '<iframe id="share-frame" allow="clipboard-write" src="' + esc(url) + '" title="Share times"></iframe>';
}

/* ── Coming up tab ──────────────────────────────────────────────────── */

function dayLabel(d) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const that = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((that - today) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).format(d);
}
const fmtTime = (d) => new Intl.DateTimeFormat('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true }).format(d).replace(/\s/g, '');

function renderAgenda() {
  setChrome('full');
  $('view').classList.remove('no-pad');
  if (!agenda) { showLoading('Loading your diary…'); return; }

  let html = '';
  const tgStarts = new Set((bookings || []).map((b) => Date.parse(b.startISO)).filter(Number.isFinite));

  let events = agenda.connected ? (agenda.events || []) : [];
  if (!agenda.connected) {
    html += '<div class="hint-card"><b>No calendar connected.</b> Connect Google or Microsoft in the scheduler editor and your whole diary shows here. Until then this lists scheduler bookings only.</div>';
    events = (bookings || []).map((b) => ({
      title: (b.eventLabel || 'Appointment') + (b.name ? ' — ' + b.name : ''),
      startISO: b.startISO, endISO: b.endISO, allDay: false, tg: true,
    }));
  }

  events = events
    .filter((e) => e && e.startISO && Date.parse(e.startISO) > Date.now() - 3600000)
    .sort((a, b) => Date.parse(a.startISO) - Date.parse(b.startISO))
    .slice(0, 30);

  if (!events.length) {
    html += '<div class="state">Nothing coming up in the next two weeks.</div>';
  } else {
    let lastDay = '';
    for (const e of events) {
      const start = new Date(e.startISO);
      const day = dayLabel(start);
      if (day !== lastDay) { html += '<div class="day-h">' + esc(day) + '</div>'; lastDay = day; }
      const isTG = e.tg || tgStarts.has(Date.parse(e.startISO));
      const dur = e.endISO ? Math.max(0, Math.round((Date.parse(e.endISO) - Date.parse(e.startISO)) / 60000)) : 0;
      html += '<div class="evt">' +
        '<span class="t">' + (e.allDay ? '<b>All day</b>' : '<b>' + esc(fmtTime(start)) + '</b>' + (dur ? '<span>' + dur + ' min</span>' : '')) + '</span>' +
        '<span class="what" title="' + esc(e.title) + '">' + esc(e.title) + '</span>' +
        (isTG ? '<span class="badge">Scheduler</span>' : (e.allDay ? '<span class="badge allday">All day</span>' : '')) +
        '</div>';
    }
    if (agenda.degraded) html += '<div class="hint-card">Your calendar could not be read just now — showing what we have. Try refresh.</div>';
  }

  // Always offer a way through to the full bookings page, where a meeting can
  // be rescheduled or cancelled (the drawer is view-only).
  html += '<a class="manage-link" href="' + API + '/bookings" target="_blank" rel="noopener">' +
    '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>' +
    'Manage my meetings — reschedule or cancel</a>';

  $('view').innerHTML = html;
}

/* ── Data ───────────────────────────────────────────────────────────── */

async function loadIdentity() {
  try {
    const r = await fetch(API + '/api/auth/me', { credentials: 'include' });
    if (!r.ok) return;
    const d = await r.json();
    const me = (d && (d.user || d)) || {};
    const name = me.fullName || me.name || '';
    const email = me.email || '';
    if (name || email) {
      $('acct-name').textContent = name || email;
      $('acct-email').textContent = name ? email : '';
      $('avatar').textContent = (name || email).trim().charAt(0).toUpperCase() || 'T';
      $('account').hidden = false;
    }
  } catch (e) { /* header stays plain */ }
}

async function load() {
  showLoading(tab === 'meetings' ? 'Loading your meetings…' : 'Loading your diary…');

  let widgets;
  try {
    const r = await fetch(API + '/api/widget-list', { credentials: 'include' });
    if (r.status === 401 || r.status === 403) { showSignedOut(); return; }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    widgets = await r.json();
  } catch (e) {
    showError('Could not reach Travelgenix. Check your connection and try again.');
    return;
  }

  loadIdentity(); // non-blocking

  const schedulers = (Array.isArray(widgets) ? widgets : [])
    .filter((w) => w && w.type === 'Appointment' && w.widgetId);

  // One flat row per meeting type across all schedulers (Calendly's model).
  const flat = [];
  await Promise.all(schedulers.map(async (s) => {
    let events = null;
    try {
      const r = await fetch(API + '/api/widget-config?id=' + encodeURIComponent(s.widgetId));
      if (r.ok) {
        const d = await r.json();
        const cfg = (d && (d.config || d)) || {};
        if (Array.isArray(cfg.eventTypes)) {
          events = cfg.eventTypes.filter((e) => e && e.id)
            .map((e) => ({ id: e.id, label: e.label || 'Meeting', mins: Number(e.mins) || 0 }));
        }
      }
    } catch (e) { /* scheduler-level row below */ }
    if (events && events.length) events.forEach((ev) => flat.push({ widgetId: s.widgetId, schedName: s.name, ev }));
    else flat.push({ widgetId: s.widgetId, schedName: s.name, ev: null });
  }));
  meetings = flat;

  // Diary + scheduler bookings for the agenda tab (fail-soft, in parallel).
  const [agendaRes, listRes] = await Promise.all([
    fetch(API + '/api/appointment/agenda?days=14', { credentials: 'include' }).then((r) => r.ok ? r.json() : null).catch(() => null),
    fetch(API + '/api/appointment/list?days=14', { credentials: 'include' }).then((r) => r.ok ? r.json() : null).catch(() => null),
  ]);
  agenda = agendaRes && agendaRes.ok !== false ? agendaRes : { connected: false, events: [] };
  bookings = listRes && Array.isArray(listRes.bookings)
    ? listRes.bookings.filter((b) => b && b.status !== 'cancelled')
    : [];

  render();
}

function render() { (tab === 'meetings' ? renderMeetings : renderAgenda)(); }

/* ── Boot ───────────────────────────────────────────────────────────── */

$('refresh').addEventListener('click', load);
$('back').addEventListener('click', render);
$('open-dashboard').href = 'https://id.travelify.io/dashboard.html';
$('open-bookings').href = API + '/bookings';
document.querySelectorAll('nav .tab').forEach((el) => {
  el.addEventListener('click', () => {
    tab = el.getAttribute('data-tab');
    document.querySelectorAll('nav .tab').forEach((t) => t.classList.toggle('is-on', t === el));
    render();
  });
});
load();
