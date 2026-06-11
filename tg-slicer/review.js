/* TG Slicer — review page logic (v0.2)
 * Reads the build sheet from chrome.storage.local and renders it: an approximate
 * preview, the input lists, the code blocks, copy buttons, and a full export.
 */

let SHEET = null;
let SLICE = null;

init();

async function init() {
  const { tgsLastSheet, tgsLastSlice } = await chrome.storage.local.get(["tgsLastSheet", "tgsLastSlice"]);
  if (!tgsLastSheet) {
    document.querySelector(".rv-main").hidden = true;
    document.getElementById("empty").hidden = false;
    return;
  }
  SHEET = tgsLastSheet;
  SLICE = tgsLastSlice || null;
  render();
  wire();
}

function el(id) { return document.getElementById(id); }
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function render() {
  el("widgetName").textContent = SHEET.widgetName || "Build sheet";

  const src = SLICE && SLICE.meta && SLICE.meta.source ? SLICE.meta.source : "unknown";
  el("meta").innerHTML =
    `<b>Class prefix</b> ${esc(SHEET.classPrefix || "")} &nbsp;·&nbsp; ` +
    `<b>Captured from</b> ${esc(src)}` +
    (SHEET.description ? `<br><br>${esc(SHEET.description)}` : "");

  renderContentInputs(SHEET.contentInputs || []);
  renderDesignInputs(SHEET.designInputs || []);

  el("htmlCode").textContent = SHEET.html || "";
  el("cssDesktopCode").textContent = SHEET.cssDesktop || "";
  el("cssMobileCode").textContent = SHEET.cssMobile || "";

  renderList(el("notes"), SHEET.notes || [], "Nothing dropped.");
  renderChecklist(el("acceptance"), SHEET.acceptanceTest || []);

  renderPreview();
}

function renderList(ul, items, emptyText) {
  ul.innerHTML = "";
  if (!items.length) { ul.innerHTML = `<li>${esc(emptyText)}</li>`; return; }
  for (const it of items) {
    const li = document.createElement("li");
    li.textContent = it;
    ul.appendChild(li);
  }
}
function renderChecklist(ul, items) {
  ul.innerHTML = "";
  if (!items.length) { ul.innerHTML = `<li>No checks supplied.</li>`; return; }
  for (const it of items) {
    const li = document.createElement("li");
    li.textContent = it;
    ul.appendChild(li);
  }
}

function renderContentInputs(inputs) {
  const wrap = el("contentInputs");
  wrap.innerHTML = "";
  if (!inputs.length) { wrap.innerHTML = `<div class="rv-kv">None.</div>`; return; }
  for (const i of inputs) {
    const div = document.createElement("div");
    div.className = "rv-input";
    let html =
      `<div class="rv-input-top">` +
      `<span class="rv-tag">${esc(i.type || "Text")}</span>` +
      (i.variable ? `<span class="rv-var">${esc(i.variable)}</span>` : "") +
      (i.required ? `<span class="rv-req">required</span>` : "") +
      `</div>` +
      (i.label ? `<div class="rv-label">${esc(i.label)}</div>` : "") +
      (i.default ? `<div class="rv-kv"><b>Default:</b> ${esc(i.default)}</div>` : "") +
      (i.note ? `<div class="rv-kv">${esc(i.note)}</div>` : "");

    if (Array.isArray(i.list) && i.list.length) {
      let sub = `<div class="rv-sub"><div class="rv-sub-title">List item sub-inputs</div>`;
      for (const s of i.list) {
        sub += `<div class="rv-sub-row">• <b>${esc(s.type || "Text")}</b> ` +
               `<span class="rv-var">${esc(s.variable || "")}</span> — ${esc(s.label || "")}` +
               (s.default ? ` <span class="rv-kv">(default: ${esc(s.default)})</span>` : "") +
               `</div>`;
      }
      sub += `</div>`;
      html += sub;
    }
    div.innerHTML = html;
    wrap.appendChild(div);
  }
}

function renderDesignInputs(inputs) {
  const wrap = el("designInputs");
  wrap.innerHTML = "";
  if (!inputs.length) { wrap.innerHTML = `<div class="rv-kv">None.</div>`; return; }
  for (const i of inputs) {
    const div = document.createElement("div");
    div.className = "rv-input";
    div.innerHTML =
      `<div class="rv-input-top"><span class="rv-tag design">${esc(i.type || "")}</span></div>` +
      (i.label ? `<div class="rv-label">${esc(i.label)}</div>` : "") +
      (i.selector ? `<div class="rv-kv"><b>Selector:</b> <span class="rv-var">${esc(i.selector)}</span></div>` : "");
    wrap.appendChild(div);
  }
}

/* ---- approximate Handlebars-lite preview ---- */
/* Best-effort only: fills {{vars}} with their defaults, loops {{#each}} a few times
 * using list defaults, keeps {{#if}} blocks, renders {{#custom_link}} as an anchor,
 * and substitutes Icon SVG slots with a placeholder square. Clearly labelled approximate. */

function defaultsByVar(inputs) {
  const map = {};
  for (const i of inputs || []) {
    if (i.variable) map[i.variable] = i.default != null ? i.default : (i.label || i.variable);
    if (Array.isArray(i.list)) map["__list__" + (i.variable || "")] = i.list;
  }
  return map;
}

function renderPreviewTemplate(tpl, inputs) {
  const defs = defaultsByVar(inputs);
  let out = tpl;

  // {{#each var}} ... {{/each}}  -> repeat inner 3x with sub defaults
  out = out.replace(/\{\{#each\s+([\w.]+)\s*\}\}([\s\S]*?)\{\{\/each\}\}/g, (_m, listVar, inner) => {
    const list = defs["__list__" + listVar];
    const n = 3;
    let rows = "";
    for (let k = 0; k < n; k++) {
      let row = inner;
      if (Array.isArray(list)) {
        for (const s of list) {
          const val = s.default != null ? s.default : (s.label || s.variable || "");
          row = replaceVar(row, s.variable, val);
        }
      }
      // any leftover bare vars in the row -> blank
      row = stripControl(row);
      rows += row;
    }
    return rows;
  });

  // {{#if x}} ... {{/if}} -> keep inner
  out = out.replace(/\{\{#if\s+[\w.]+\s*\}\}([\s\S]*?)\{\{\/if\}\}/g, "$1");

  // {{#custom_link var}} inner {{/custom_link}} -> <a href="#">inner</a>
  out = out.replace(/\{\{#custom_link\s+[\w.]+\s*\}\}([\s\S]*?)\{\{\/custom_link\}\}/g,
    '<a href="#" style="text-decoration:none">$1</a>');

  // top-level vars
  for (const [k, v] of Object.entries(defs)) {
    if (k.startsWith("__list__")) continue;
    out = replaceVar(out, k, v);
  }

  out = stripControl(out);
  return out;
}

function replaceVar(s, name, value) {
  if (!name) return s;
  const safe = String(value == null ? "" : value);
  // triple braces (raw) — e.g. Icon SVG: substitute a placeholder block
  s = s.replace(new RegExp("\\{\\{\\{\\s*" + escapeRe(name) + "\\s*\\}\\}\\}", "g"),
    '<span style="display:inline-block;width:24px;height:24px;border-radius:6px;background:currentColor;opacity:.85"></span>');
  // double braces
  s = s.replace(new RegExp("\\{\\{\\s*" + escapeRe(name) + "\\s*\\}\\}", "g"), esc(safe));
  return s;
}

function stripControl(s) {
  // Remove any leftover handlebars tokens so they don't show literally.
  return s.replace(/\{\{\{[\s\S]*?\}\}\}/g, "")
          .replace(/\{\{[\s\S]*?\}\}/g, "");
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function renderPreview() {
  const body = renderPreviewTemplate(SHEET.html || "", SHEET.contentInputs || []);
  const doc = `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}
    body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#fff;
      --color_1:#1B2B5B;--color_2:#00B4D8}
    ${SHEET.cssDesktop || ""}
  </style></head><body>${body}</body></html>`;
  el("preview").srcdoc = doc;
}

/* ---- full-width standalone preview (real output, defaults filled) ---- */

function buildStandaloneDoc() {
  const body = renderPreviewTemplate(SHEET.html || "", SHEET.contentInputs || []);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(SHEET.widgetName || "TG Slicer preview")}</title>
<style>
:root{--color_1:#1B2B5B;--color_2:#00B4D8}
*{box-sizing:border-box}
html,body{margin:0;background:#fff;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
${SHEET.cssDesktop || ""}
${SHEET.cssMobile || ""}
</style></head>
<body>
${body}
</body></html>`;
}

function openFullPreview() {
  try {
    const url = URL.createObjectURL(new Blob([buildStandaloneDoc()], { type: "text/html" }));
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (e) {
    alert("Could not open the preview. Try Download HTML instead.");
  }
}

function downloadHtml() {
  const url = URL.createObjectURL(new Blob([buildStandaloneDoc()], { type: "text/html" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = (SHEET.widgetName || "tg-widget").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() + ".html";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ---- full build-sheet export (mirrors the hand-made proof doc) ---- */

function buildSheetMarkdown() {
  const s = SHEET;
  const lines = [];
  lines.push(`# ${s.widgetName || "TG Widget"} — Duda Custom Widget build sheet`);
  lines.push("");
  if (s.description) { lines.push(s.description); lines.push(""); }
  lines.push(`Class prefix: \`${s.classPrefix || "tgs-"}\``);
  lines.push("");
  lines.push("## 1. Content inputs (create in order)");
  for (const i of s.contentInputs || []) {
    lines.push(`- **${i.type || "Text"}** \`${i.variable || ""}\` — ${i.label || ""}` +
      (i.required ? " (required)" : "") +
      (i.default ? `\n  - Default: ${i.default}` : "") +
      (i.note ? `\n  - Note: ${i.note}` : ""));
    if (Array.isArray(i.list) && i.list.length) {
      lines.push(`  - List sub-inputs:`);
      for (const sub of i.list) {
        lines.push(`    - ${sub.type || "Text"} \`${sub.variable || ""}\` — ${sub.label || ""}` +
          (sub.default ? ` (default: ${sub.default})` : ""));
      }
    }
  }
  lines.push("");
  lines.push("## 2. Design inputs");
  for (const i of s.designInputs || []) {
    lines.push(`- **${i.type || ""}** — ${i.label || ""} → selector \`${i.selector || ""}\``);
  }
  lines.push("");
  lines.push("## 3. HTML");
  lines.push("```handlebars");
  lines.push(s.html || "");
  lines.push("```");
  lines.push("");
  lines.push("## 4. CSS — desktop & tablet");
  lines.push("```css");
  lines.push(s.cssDesktop || "");
  lines.push("```");
  lines.push("");
  lines.push("## 5. CSS — mobile");
  lines.push("```css");
  lines.push(s.cssMobile || "");
  lines.push("```");
  if ((s.notes || []).length) {
    lines.push("");
    lines.push("## Notes");
    for (const n of s.notes) lines.push(`- ${n}`);
  }
  if ((s.acceptanceTest || []).length) {
    lines.push("");
    lines.push("## Acceptance test");
    for (const a of s.acceptanceTest) lines.push(`- [ ] ${a}`);
  }
  lines.push("");
  return lines.join("\n");
}

/* ---- interactions ---- */

function wire() {
  document.querySelectorAll(".rv-copy").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-copy");
      copy(SHEET[key] || "", btn);
    });
  });
  el("copyAll").addEventListener("click", (e) => copy(buildSheetMarkdown(), e.target));
  el("openPreview").addEventListener("click", openFullPreview);
  el("downloadHtml").addEventListener("click", downloadHtml);
}

async function copy(text, btn) {
  try { await navigator.clipboard.writeText(text); }
  catch (_) {
    const ta = document.createElement("textarea");
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch (_) {}
    ta.remove();
  }
  flash(btn);
}

let flashEl = null;
function flash(btn) {
  if (btn && btn.classList.contains("rv-copy")) {
    const old = btn.textContent; btn.textContent = "Copied";
    setTimeout(() => (btn.textContent = old), 1400);
    return;
  }
  if (!flashEl) {
    flashEl = document.createElement("div");
    flashEl.className = "rv-flash";
    flashEl.textContent = "Copied to clipboard";
    document.body.appendChild(flashEl);
  }
  flashEl.classList.add("show");
  setTimeout(() => flashEl.classList.remove("show"), 1400);
}
