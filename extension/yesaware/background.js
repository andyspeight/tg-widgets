/**
 * YesAware — service worker.
 *
 * The one job: proxy API calls for the Gmail content script. Content-script
 * fetches run as mail.google.com, so the SameSite=Lax .travelify.io session
 * cookie never travels with them — but extension-context fetches to hosts we
 * hold permissions for DO carry it. The whitelist keeps this bridge exactly as
 * narrow as the extension's own needs (mirrors scheduler-companion, extended to
 * the writes YesAware needs).
 */
'use strict';

const API = 'https://widgets.travelify.io';

const ALLOWED = [
  { m: 'POST', re: /^\/api\/track\/register$/ },
  { m: 'GET',  re: /^\/api\/track\/list$/ },
  { m: 'GET',  re: /^\/api\/track\/templates$/ },
  { m: 'POST', re: /^\/api\/track\/templates$/ },
  { m: 'GET',  re: /^\/api\/track\/reminders$/ },
  { m: 'POST', re: /^\/api\/track\/reminders$/ },
  { m: 'GET',  re: /^\/api\/track\/sequences$/ },
  { m: 'POST', re: /^\/api\/track\/sequences$/ },
  { m: 'GET',  re: /^\/api\/auth\/me$/ },
];

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'ya-fetch') return;
  if (!sender || sender.id !== chrome.runtime.id) return;

  const method = (msg.method || 'GET').toUpperCase();
  const path = typeof msg.path === 'string' ? msg.path : '';
  if (!ALLOWED.some((a) => a.m === method && a.re.test(path))) {
    sendResponse({ ok: false, status: 400 });
    return;
  }

  const init = { method, credentials: 'include', headers: {} };
  if (msg.body != null && method !== 'GET') {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(msg.body);
  }

  fetch(API + path, init)
    .then(async (r) => {
      let body = null;
      try { body = await r.json(); } catch (e) { /* non-JSON */ }
      sendResponse({ ok: r.ok, status: r.status, body });
    })
    .catch(() => sendResponse({ ok: false, status: 0 }));

  return true; // keep the channel open for the async response
});
