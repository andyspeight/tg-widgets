/* TG Slicer — in-page selector and result bar
 * Captures a section on any page and sends it to Travelgenix Sites via the
 * outbox (see bridge.js). No network here and no secret: the capture is handed
 * to the Sites editor's Import tab, which turns it into editable blocks.
 */
(function () {
  if (window.__tgsActive) {
    try { window.__tgsTeardown && window.__tgsTeardown(); } catch (_) {}
  }
  window.__tgsActive = true;

  let current = null;
  let lastSlice = null;
  const box = document.createElement("div");
  box.className = "tgs-highlight";
  const label = document.createElement("div");
  label.className = "tgs-label";
  box.appendChild(label);

  const bar = document.createElement("div");
  bar.className = "tgs-bar";
  bar.innerHTML = `
    <span class="tgs-bar-brand">TG&nbsp;Slicer</span>
    <span class="tgs-bar-hint">Hover a component, click to lock. <b>&uarr;</b> parent &middot; <b>&darr;</b> child &middot; <b>C</b> capture &middot; <b>Esc</b> exit</span>
    <span class="tgs-bar-actions"></span>
  `;
  const actions = bar.querySelector(".tgs-bar-actions");
  const hintEl = bar.querySelector(".tgs-bar-hint");

  document.documentElement.appendChild(box);
  document.documentElement.appendChild(bar);

  function rectFor(el) {
    const r = el.getBoundingClientRect();
    box.style.transform = `translate(${r.left + window.scrollX}px, ${r.top + window.scrollY}px)`;
    box.style.width = r.width + "px";
    box.style.height = r.height + "px";
    const cls = (el.className && typeof el.className === "string")
      ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".")
      : "";
    label.textContent = `${el.tagName.toLowerCase()}${cls}  ${Math.round(r.width)}\u00d7${Math.round(r.height)}`;
  }

  function setCurrent(el) {
    if (!el || el === box || el === bar || bar.contains(el)) return;
    current = el;
    rectFor(el);
  }

  function onMove(e) {
    if (window.__tgsLocked) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (el) setCurrent(el);
  }

  function onClick(e) {
    if (bar.contains(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    window.__tgsLocked = true;
    box.classList.add("tgs-locked");
    showActions();
  }

  function onKey(e) {
    if (e.key === "Escape") { teardown(); return; }
    if (e.key === "ArrowUp" && current && current.parentElement) {
      e.preventDefault(); setCurrent(current.parentElement);
    }
    if (e.key === "ArrowDown" && current && current.firstElementChild) {
      e.preventDefault(); setCurrent(current.firstElementChild);
    }
    if ((e.key === "c" || e.key === "C") && current) {
      e.preventDefault(); doCapture();
    }
  }

  function onScroll() { if (current) rectFor(current); }

  function showActions() {
    actions.innerHTML = "";
    actions.appendChild(button("Capture", "primary", doCapture));
  }

  function button(text, kind, fn) {
    const b = document.createElement("button");
    b.className = "tgs-btn" + (kind === "primary" ? " tgs-btn-primary" : "");
    b.textContent = text;
    b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); fn(b); });
    return b;
  }

  function selfContainedHTML(slice) {
    return `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="tg-slicer-source" content="${(slice.meta.source || "").replace(/"/g, "&quot;")}">
<style>
*{box-sizing:border-box}
body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
${slice.css}
</style></head>
<body>
${slice.html}
</body></html>`;
  }

  // Put the captured section in the outbox for Travelgenix Sites. No network:
  // the bridge content script on the Sites domain reads the outbox and hands it
  // to an open editor. Capped so it cannot grow without bound.
  async function sendToSites(btn) {
    if (!lastSlice) { showResult("Capture a component first.", "error"); return; }
    const item = {
      html: lastSlice.html,
      css: lastSlice.css,
      title: (location.hostname + (document.title ? " — " + document.title : "")).slice(0, 120),
      ts: Date.now(),
    };
    try {
      const { tgsOutbox } = await chrome.storage.local.get("tgsOutbox");
      const outbox = Array.isArray(tgsOutbox) ? tgsOutbox : [];
      outbox.push(item);
      while (outbox.length > 20) outbox.shift();
      await chrome.storage.local.set({ tgsOutbox: outbox });
      flash(btn, "Sent");
      showResult("Sent to Travelgenix Sites. Open the Import tab there to add it.", "ok");
    } catch (e) {
      showResult("Could not send: " + (e.message || e), "error");
    }
  }

  // Keep the captured section in the extension's own library, a persistent bank
  // separate from the send outbox, so a good section can be re-sent to any site
  // later. Local to this browser, capped so it cannot grow without bound. The
  // library page (library.html) browses, re-sends and clears it.
  async function saveToLibrary(btn) {
    if (!lastSlice) { showResult("Capture a component first.", "error"); return; }
    const item = {
      id: "s" + Date.now() + Math.random().toString(36).slice(2, 7),
      title: (document.title || location.hostname).slice(0, 120),
      source: location.href.slice(0, 300),
      html: lastSlice.html,
      css: lastSlice.css,
      savedAt: Date.now(),
    };
    try {
      const { tgsLibrary } = await chrome.storage.local.get("tgsLibrary");
      const lib = Array.isArray(tgsLibrary) ? tgsLibrary : [];
      lib.unshift(item);
      while (lib.length > 100) lib.pop();
      await chrome.storage.local.set({ tgsLibrary: lib });
      flash(btn, "Saved");
      showResult("Saved to your library. Open it from the TG Slicer popup.", "ok");
    } catch (e) {
      showResult("Could not save: " + (e.message || e), "error");
    }
  }

  async function copy(text, btn) {
    try {
      await navigator.clipboard.writeText(text);
      flash(btn, "Copied");
    } catch (_) {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); flash(btn, "Copied"); }
      catch { flash(btn, "Copy failed"); }
      ta.remove();
    }
  }

  function flash(btn, msg) {
    if (!btn) return;
    const old = btn.dataset.label || btn.textContent;
    btn.dataset.label = old;
    btn.textContent = msg;
    setTimeout(() => { btn.textContent = btn.dataset.label; }, 1600);
  }

  async function doCapture() {
    if (!current) return;
    label.textContent = "Capturing\u2026";
    try {
      lastSlice = await globalThis.TGSCapture.capture(current);
    } catch (e) {
      label.textContent = "Capture failed: " + (e.message || e);
      return;
    }
    actions.innerHTML = "";
    // Puts the section in the outbox. The bridge content script hands it to an
    // open Travelgenix Sites editor, where it appears in the Import tab for a
    // one-click add, no copy-paste. See tg-slicer/bridge.js and
    // tg-sites/components/editor/ImportPanel.tsx.
    actions.appendChild(button("Send to Travelgenix Sites", "primary", sendToSites));
    // A persistent bank of captures, browsed from the popup's My library page.
    actions.appendChild(button("Save to library", "", saveToLibrary));
    // Copy stays as a fallback for when the editor is not open, or for a paste
    // into the Import box by hand.
    actions.appendChild(button("Copy HTML+CSS", "", (b) => copy(selfContainedHTML(lastSlice), b)));
    actions.appendChild(button("Copy slice JSON", "", (b) => copy(JSON.stringify(lastSlice, null, 2), b)));
    actions.appendChild(button("New", "", reset));
    bar.classList.add("tgs-captured");
  }

  function showResult(msg, kind) {
    if (!hintEl.dataset.orig) hintEl.dataset.orig = hintEl.innerHTML;
    const colour = kind === "error" ? "#ffb4b4" : "#cfe9f5";
    hintEl.innerHTML = '<span style="color:' + colour + '">' + msg + '</span>';
  }

  function reset() {
    window.__tgsLocked = false;
    lastSlice = null;
    box.classList.remove("tgs-locked");
    bar.classList.remove("tgs-captured");
    actions.innerHTML = "";
  }

  function teardown() {
    window.__tgsActive = false;
    window.__tgsLocked = false;
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("scroll", onScroll, true);
    box.remove();
    bar.remove();
  }
  window.__tgsTeardown = teardown;

  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("scroll", onScroll, true);
})();
