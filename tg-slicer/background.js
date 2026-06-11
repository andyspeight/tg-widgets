/* TG Slicer — background service worker (v0.2.1)
 * - Injects the capture engine + selector UI into the active tab on demand.
 * - Performs the Stage 2 network call HERE (not in the content script), because in
 *   Manifest V3 only the extension's own contexts (this worker) get cross-origin
 *   fetch rights from host_permissions. A content-script fetch is bound by the
 *   page's CORS policy and is blocked -> that was the "Network failed" cause.
 * - The shared secret now lives only in the extension, never in the page context.
 */

const BLOCKED = /^(chrome|edge|brave|about|chrome-extension|edge-extension|view-source|devtools):/i;

async function activate() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) throw new Error("No active tab.");
  if (BLOCKED.test(tab.url || "")) {
    throw new Error("TG Slicer can't run on this page. Open a normal website and try again.");
  }
  await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["overlay.css"] });
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["capture.js", "emit-local.js", "content.js"] });
}

async function emit(slice) {
  const { tgsEndpoint, tgsSecret } = await chrome.storage.sync.get(["tgsEndpoint", "tgsSecret"]);
  if (!tgsEndpoint) return { ok: false, error: "Set endpoint in popup" };

  // The fidelity build can take 1-3 minutes. Two things must survive that:
  // 1) the MV3 service worker, which Chrome kills after ~30s idle, so ping a
  //    cheap chrome API on an interval to keep it awake while we wait;
  // 2) the request itself, bounded by an abort timeout so the UI can never hang
  //    silently. 270s sits just under the 300s Vercel function limit.
  const keepAlive = setInterval(() => { try { chrome.runtime.getPlatformInfo(() => {}); } catch (_) {} }, 20000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 270000);

  let res;
  try {
    res = await fetch(tgsEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-tgs-secret": tgsSecret || "" },
      body: JSON.stringify(slice),
      signal: controller.signal
    });
  } catch (e) {
    clearInterval(keepAlive); clearTimeout(timeout);
    if (e && e.name === "AbortError") {
      return { ok: false, error: "Timed out. Try a smaller section." };
    }
    return { ok: false, error: "Network failed" };
  }
  clearInterval(keepAlive); clearTimeout(timeout);

  if (res.status === 401) return { ok: false, error: "Bad secret" };
  if (res.status === 429) return { ok: false, error: "Rate limited" };
  if (res.status === 504 || res.status === 408) return { ok: false, error: "Server timed out. Try a smaller section." };
  if (!res.ok) {
    let msg = "Error " + res.status;
    try { const b = await res.json(); if (b && b.error) msg = b.error; } catch (_) {}
    return { ok: false, error: msg };
  }

  let data;
  try { data = await res.json(); }
  catch { return { ok: false, error: "Bad response" }; }
  if (!data || !data.ok || !data.buildSheet) return { ok: false, error: (data && data.error) ? data.error : "No build sheet" };

  await chrome.storage.local.set({
    tgsLastSheet: data.buildSheet,
    tgsLastSlice: slice,
    tgsLastAt: new Date().toISOString()
  });
  await chrome.tabs.create({ url: chrome.runtime.getURL("review.html") });
  return { ok: true };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "TGS_ACTIVATE") {
    activate()
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e.message || e) }));
    return true;
  }
  if (msg && msg.type === "TGS_OPEN_REVIEW") {
    (async () => {
      await chrome.storage.local.set({
        tgsLastSheet: msg.sheet,
        tgsLastSlice: msg.slice,
        tgsLastAt: new Date().toISOString()
      });
      await chrome.tabs.create({ url: chrome.runtime.getURL("review.html") });
    })()
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e.message || e) }));
    return true;
  }
  if (msg && msg.type === "TGS_EMIT") {
    emit(msg.slice)
      .then((r) => sendResponse(r))
      .catch((e) => sendResponse({ ok: false, error: String(e.message || e) }));
    return true;
  }
});
