/* TG Slicer — background service worker
 * Injects the capture engine and selector UI into the active tab on demand.
 * That is the whole job now: the capture is handed to Travelgenix Sites through
 * the outbox (see content.js sendToSites and bridge.js), so there is no network
 * call and no secret here.
 */

const BLOCKED = /^(chrome|edge|brave|about|chrome-extension|edge-extension|view-source|devtools):/i;

async function activate() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) throw new Error("No active tab.");
  if (BLOCKED.test(tab.url || "")) {
    throw new Error("TG Slicer can't run on this page. Open a normal website and try again.");
  }
  await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["overlay.css"] });
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["capture.js", "content.js"] });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "TGS_ACTIVATE") {
    activate()
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e.message || e) }));
    return true;
  }
});
