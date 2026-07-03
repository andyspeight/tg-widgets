/**
 * Travelgenix Scheduler — service worker.
 *
 * Two jobs:
 *   1. Clicking the toolbar icon opens the side panel (the drawer).
 *   2. Proxy API reads for the Gmail content script. Content scripts fetch as
 *      the page (mail.google.com), so the SameSite=Lax session cookie never
 *      travels with them — but extension-context fetches to hosts we hold
 *      permissions for DO carry it. The whitelist keeps this bridge read-only
 *      and exactly as narrow as the panel's own needs.
 */
'use strict';

const API = 'https://widgets.travelify.io';
const ALLOWED_PATHS = [
  /^\/api\/widget-list$/,
  /^\/api\/appointment\/list(\?[A-Za-z0-9=&_-]*)?$/,
];

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'tgs-fetch') return;
  if (!sender || sender.id !== chrome.runtime.id) return;
  const path = typeof msg.path === 'string' ? msg.path : '';
  if (!ALLOWED_PATHS.some((re) => re.test(path))) {
    sendResponse({ ok: false, status: 400 });
    return;
  }
  fetch(API + path, { credentials: 'include' })
    .then(async (r) => {
      let body = null;
      if (r.ok) { try { body = await r.json(); } catch (e) { /* non-JSON */ } }
      sendResponse({ ok: r.ok, status: r.status, body });
    })
    .catch(() => sendResponse({ ok: false, status: 0 }));
  return true; // keep the message channel open for the async response
});
