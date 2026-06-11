/* TG Slicer — in-page selector and result bar (v0.2.1)
 * The network call is delegated to the background worker (MV3 cross-origin rules).
 * This script never holds the secret or touches the endpoint directly.
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
    actions.appendChild(button("Make Duda widget", "primary", emit));
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

  // Build the Duda widget locally and open the review tab. No network, no model,
  // so it's instant and can't time out, truncate or drift from the source.
  function emit(btn) {
    btn.dataset.label = "Make Duda widget";
    if (!lastSlice) { showResult("Capture a component first.", "error"); return; }
    let sheet;
    try {
      sheet = globalThis.TGSEmit.buildSheet(lastSlice);
    } catch (e) {
      showResult("Could not build the widget: " + (e.message || e), "error");
      return;
    }
    btn.textContent = "Opening\u2026";
    chrome.runtime.sendMessage({ type: "TGS_OPEN_REVIEW", sheet: sheet, slice: lastSlice })
      .then((r) => {
        btn.textContent = btn.dataset.label;
        if (r && r.ok) showResult("Done. Opening the review tab\u2026", "ok");
        else showResult((r && r.error) || "Could not open the review tab.", "error");
      })
      .catch(() => { btn.textContent = btn.dataset.label; showResult("Could not open the review tab.", "error"); });
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
