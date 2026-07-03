/**
 * Travelgenix Scheduler — service worker.
 *
 * One job: clicking the toolbar icon opens the side panel (the drawer).
 * Everything else lives in panel.html/panel.js — the extension stays a thin
 * shell so UI improvements rarely need a Web Store re-review.
 */
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
