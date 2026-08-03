/*
 * TG Slicer bridge, for Travelgenix Sites only.
 *
 * WHAT IT DOES, AND WHY IT IS ITS OWN FILE. The capture overlay (content.js) is
 * injected on demand on the site you are slicing. This is the other half: a
 * small, permanent content script that runs ONLY on the Travelgenix Sites
 * domains, and its whole job is to carry a captured section from the extension's
 * outbox to an open Sites editor with no copy-paste.
 *
 * HOW THE HANDOFF WORKS. "Send to Travelgenix Sites" in the overlay pushes the
 * section into chrome.storage.local under `tgsOutbox`. This script, on the Sites
 * page, reads that outbox and hands it to the page with window.postMessage. The
 * editor's Import tab listens for it, lists the section and adds it on one
 * click, then posts back which ones it used so they are cleared from the outbox
 * and never offered twice. It also re-sends whenever the outbox changes, so a
 * capture made while the tab is already open turns up straight away, and answers
 * the editor's request on mount, so one made beforehand is not missed.
 *
 * WHERE IT RUNS. The allowlist is the content_scripts.matches list in
 * manifest.json, and that is the only place it lives, so it cannot drift. Today
 * that is the production editor at tg-sites.vercel.app and localhost for dev. It
 * is deliberately NOT the client preview domain (*.travelgenixsites.com), which
 * serves customers' own sites and never the editor. When the editor gets a real
 * domain (the APP_HOSTNAMES one, e.g. sites.travelgenix.com), add it there and
 * re-load the extension.
 *
 * TRUST. Nothing here is trusted by the editor beyond being a section of HTML
 * and CSS: it goes through the same import that a hand paste does, which
 * sanitises it. This only moves the bytes; it grants no new power.
 */
(function () {
  function post(slices) {
    const list = Array.isArray(slices) ? slices : [];
    if (list.length) {
      window.postMessage({ source: "tgs-slicer", slices: list }, location.origin);
    }
  }

  async function flush() {
    try {
      const { tgsOutbox } = await chrome.storage.local.get("tgsOutbox");
      post(tgsOutbox);
    } catch (_) {
      // Storage unavailable is not worth breaking the page over.
    }
  }

  // A capture made while this tab is open lands the moment the outbox changes.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.tgsOutbox) post(changes.tgsOutbox.newValue);
  });

  // The editor talks back: it asks for what is waiting on mount, and it says
  // which sections it has used so they can be cleared.
  window.addEventListener("message", async (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== "tgs-sites") return;

    if (data.request) {
      flush();
      return;
    }
    if (Array.isArray(data.consumed) && data.consumed.length) {
      try {
        const { tgsOutbox } = await chrome.storage.local.get("tgsOutbox");
        const kept = (Array.isArray(tgsOutbox) ? tgsOutbox : []).filter(
          (item) => !data.consumed.includes(item && item.ts),
        );
        await chrome.storage.local.set({ tgsOutbox: kept });
      } catch (_) {
        // As above: a failed clear just means it may be offered again, not a crash.
      }
    }
  });

  // Push anything already waiting as soon as the bridge loads.
  flush();
})();
