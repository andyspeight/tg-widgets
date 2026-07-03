/**
 * Travelgenix Scheduler — side panel.
 *
 * Talks straight to the widget suite APIs with the user's existing dashboard
 * session (the tg_session cookie is Domain=.travelify.io, and the extension's
 * host permissions let panel fetches carry it). Nothing is stored in the
 * extension itself.
 *
 *   - /api/widget-list           the signed-in client's widgets (filtered to
 *                                Appointment schedulers here)
 *   - /api/appointment/list      upcoming bookings for the same client
 *   - /book-appointment?widget=  the scheduler's standing booking page — this
 *                                is what "Copy link" puts on the clipboard
 *   - /appointment-share?widget= the "share times that suit" flow, embedded
 *                                in the panel (public page, no session needed)
 */
'use strict';

const API = 'https://widgets.travelify.io';

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let schedulers = [];

function openTab(url) {
  try { chrome.tabs.create({ url }); }
  catch (e) { window.open(url, '_blank', 'noopener'); }
}

function bookingLink(id, eventId) {
  return API + '/book-appointment?widget=' + encodeURIComponent(id)
    + (eventId ? '&event=' + encodeURIComponent(eventId) : '');
}

// ── Views ────────────────────────────────────────────────────────────────

function showLoading(msg) {
  $('back').hidden = true;
  $('view').classList.remove('no-pad');
  $('view').innerHTML = '<div class="state">' + esc(msg || 'Loading your schedulers…') + '</div>';
}

function showSignedOut() {
  $('back').hidden = true;
  $('foot').hidden = true;
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
  $('back').hidden = true;
  $('view').classList.remove('no-pad');
  $('view').innerHTML =
    '<div class="state">' + esc(msg) + '<br><br>' +
    '<button class="btn ghost" id="try-again">Try again</button></div>';
  $('try-again').addEventListener('click', load);
}

function showList(bookings) {
  $('back').hidden = true;
  $('foot').hidden = false;
  $('view').classList.remove('no-pad');

  // One row per MEETING TYPE (the Calendly mental model): every event type
  // gets its own copyable link and its own share-times flow. A scheduler
  // whose config didn't load falls back to a single whole-scheduler row.
  let html = '';
  html += '<div class="sec">Your meetings</div>';
  if (!schedulers.length) {
    html += '<div class="state">No appointment schedulers yet.<br>Create one in the dashboard and it appears here.</div>';
  } else {
    html += schedulers.map((s, i) => {
      const events = (s.events && s.events.length) ? s.events : [null];
      const rows = events.map((ev, j) =>
        '<div class="ev-row">' +
        '<span class="ev-name" title="' + esc(ev ? ev.label : s.name) + '">' + esc(ev ? ev.label : 'Booking page') +
        (ev && ev.mins ? '<span class="ev-mins">' + esc(String(ev.mins)) + ' min</span>' : '') + '</span>' +
        '<button class="btn primary" data-copy="' + i + ':' + j + '">Copy link</button>' +
        '<button class="btn ghost" data-share="' + i + ':' + j + '">Times</button>' +
        '</div>'
      ).join('');
      return '<div class="sched"><div class="name" title="' + esc(s.name) + '">' + esc(s.name) + '</div>' + rows + '</div>';
    }).join('');
  }

  html += '<div class="sec">Coming up</div>';
  if (bookings && bookings.length) {
    html += bookings.slice(0, 12).map((b) => {
      let when = '';
      try {
        when = new Intl.DateTimeFormat('en-GB', {
          timeZone: b.timezone || 'Europe/London', weekday: 'short', day: 'numeric',
          month: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
        }).format(new Date(b.startISO));
      } catch (e) { when = b.startISO || ''; }
      return '<div class="appt">' +
        '<span class="when">' + esc(when) + '</span>' +
        '<span class="who" title="' + esc(b.name || '') + '">' + esc(b.name || 'Booked') + '</span>' +
        (b.eventLabel ? '<span class="what">' + esc(b.eventLabel) + '</span>' : '') +
        '</div>';
    }).join('');
  } else {
    html += '<div class="empty-note">Nothing booked through your schedulers in the next two weeks yet. Appointments made via your links appear here (it shows scheduler bookings, not your whole calendar).</div>';
  }

  $('view').innerHTML = html;

  const pick = (attr, btn) => {
    const parts = String(btn.getAttribute(attr)).split(':');
    const s = schedulers[Number(parts[0])];
    const ev = s && s.events && s.events[Number(parts[1])] ? s.events[Number(parts[1])] : null;
    return s ? { s, ev } : null;
  };
  $('view').querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const hit = pick('data-copy', btn);
      if (!hit) return;
      navigator.clipboard.writeText(bookingLink(hit.s.widgetId, hit.ev && hit.ev.id)).then(() => {
        btn.textContent = 'Copied ✓';
        btn.classList.add('copied');
        setTimeout(() => { btn.textContent = 'Copy link'; btn.classList.remove('copied'); }, 1600);
      }).catch(() => { btn.textContent = 'Copy failed'; });
    });
  });
  $('view').querySelectorAll('[data-share]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const hit = pick('data-share', btn);
      if (hit) showShare(hit.s, hit.ev);
    });
  });
}

// The share-times flow is the hosted /appointment-share page (public, themed
// to the scheduler) embedded full-bleed, scoped to one meeting type when
// given. Back returns to the list.
function showShare(s, ev) {
  $('back').hidden = false;
  $('view').classList.add('no-pad');
  const url = API + '/appointment-share?widget=' + encodeURIComponent(s.widgetId)
    + (ev && ev.id ? '&event=' + encodeURIComponent(ev.id) : '');
  $('view').innerHTML =
    '<iframe id="share-frame" allow="clipboard-write" src="' + esc(url) + '" title="Share times"></iframe>';
}

// ── Data ─────────────────────────────────────────────────────────────────

async function load() {
  showLoading();
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
  schedulers = (Array.isArray(widgets) ? widgets : [])
    .filter((w) => w && w.type === 'Appointment' && w.widgetId);

  // Pull each scheduler's config (public endpoint) for its meeting types —
  // the drawer lists those, Calendly-style. A failed fetch just means that
  // scheduler shows a single whole-booking-page row instead.
  await Promise.all(schedulers.map(async (s) => {
    try {
      const r = await fetch(API + '/api/widget-config?id=' + encodeURIComponent(s.widgetId));
      if (!r.ok) return;
      const d = await r.json();
      const cfg = (d && (d.config || d)) || {};
      if (Array.isArray(cfg.eventTypes)) {
        s.events = cfg.eventTypes
          .filter((e) => e && e.id)
          .map((e) => ({ id: e.id, label: e.label || 'Meeting', mins: Number(e.mins) || 0 }));
      }
    } catch (e) { /* fall back to the scheduler-level row */ }
  }));

  // Upcoming bookings are a bonus — never block the list on them.
  let bookings = [];
  try {
    const r = await fetch(API + '/api/appointment/list?days=14', { credentials: 'include' });
    if (r.ok) {
      const d = await r.json();
      if (d && Array.isArray(d.bookings)) {
        bookings = d.bookings
          .filter((b) => b && b.status !== 'cancelled' && Date.parse(b.startISO) > Date.now())
          .sort((a, b) => Date.parse(a.startISO) - Date.parse(b.startISO));
      }
    }
  } catch (e) { /* glanceable extra only */ }

  showList(bookings);
}

// ── Boot ─────────────────────────────────────────────────────────────────

$('refresh').addEventListener('click', load);
$('back').addEventListener('click', () => load());
$('open-bookings').href = API + '/bookings';
$('open-dashboard').href = 'https://id.travelify.io/dashboard.html';
load();
