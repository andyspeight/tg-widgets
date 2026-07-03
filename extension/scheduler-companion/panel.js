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

function bookingLink(id) {
  return API + '/book-appointment?widget=' + encodeURIComponent(id);
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

  let html = '';
  html += '<div class="sec">Your schedulers</div>';
  if (!schedulers.length) {
    html += '<div class="state">No appointment schedulers yet.<br>Create one in the dashboard and it appears here.</div>';
  } else {
    html += schedulers.map((s, i) =>
      '<div class="sched">' +
      '<div class="name" title="' + esc(s.name) + '">' + esc(s.name) + '</div>' +
      '<div class="row">' +
      '<button class="btn primary" data-copy="' + i + '">Copy link</button>' +
      '<button class="btn ghost" data-share="' + i + '">Share times</button>' +
      '</div></div>'
    ).join('');
  }

  if (bookings && bookings.length) {
    html += '<div class="sec">Coming up</div>';
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
  }

  $('view').innerHTML = html;

  $('view').querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const s = schedulers[Number(btn.getAttribute('data-copy'))];
      if (!s) return;
      navigator.clipboard.writeText(bookingLink(s.widgetId)).then(() => {
        btn.textContent = 'Copied ✓';
        btn.classList.add('copied');
        setTimeout(() => { btn.textContent = 'Copy link'; btn.classList.remove('copied'); }, 1600);
      }).catch(() => { btn.textContent = 'Copy failed'; });
    });
  });
  $('view').querySelectorAll('[data-share]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const s = schedulers[Number(btn.getAttribute('data-share'))];
      if (s) showShare(s);
    });
  });
}

// The share-times flow is the hosted /appointment-share page (public, themed
// to the scheduler) embedded full-bleed. Back returns to the list.
function showShare(s) {
  $('back').hidden = false;
  $('view').classList.add('no-pad');
  $('view').innerHTML =
    '<iframe id="share-frame" allow="clipboard-write" src="' + esc(API + '/appointment-share?widget=' + encodeURIComponent(s.widgetId)) + '" title="Share times"></iframe>';
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
