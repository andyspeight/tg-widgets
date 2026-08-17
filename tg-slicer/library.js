/* TG Slicer — library page.
 * A persistent bank of captured sections (chrome.storage.local: tgsLibrary),
 * browsed here and re-sent to Travelgenix Sites through the same outbox the
 * capture bar uses. Static previews only: each section renders in a sandboxed
 * iframe with no scripts, so nothing captured off a page can run here.
 */

const $ = (id) => document.getElementById(id);

/** A self-contained document for the preview iframe, html and css only. */
function previewDoc(item) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}
body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
${item.css || ""}
</style></head><body>${item.html || ""}</body></html>`;
}

function host(url) {
  try { return new URL(url).hostname; } catch (_) { return url || ""; }
}

function when(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

let flashTimer = null;
function flash(msg) {
  const el = $("flash");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => el.classList.remove("show"), 1800);
}

async function getLibrary() {
  const { tgsLibrary } = await chrome.storage.local.get("tgsLibrary");
  return Array.isArray(tgsLibrary) ? tgsLibrary : [];
}

/** Re-send a saved section by dropping it in the outbox the bridge watches. */
async function sendItem(item) {
  const { tgsOutbox } = await chrome.storage.local.get("tgsOutbox");
  const outbox = Array.isArray(tgsOutbox) ? tgsOutbox : [];
  outbox.push({
    html: item.html,
    css: item.css,
    title: (item.title || host(item.source)).slice(0, 120),
    ts: Date.now(),
  });
  while (outbox.length > 20) outbox.shift();
  await chrome.storage.local.set({ tgsOutbox: outbox });
  flash("Sent to Travelgenix Sites. Open the Import tab there to add it.");
}

async function deleteItem(id) {
  const lib = (await getLibrary()).filter((it) => it.id !== id);
  await chrome.storage.local.set({ tgsLibrary: lib });
  render(lib);
}

async function clearAll() {
  if (!confirm("Remove every saved section from the library?")) return;
  await chrome.storage.local.set({ tgsLibrary: [] });
  render([]);
}

/** One saved section as a card. Text goes in with textContent, never innerHTML;
 *  the only untrusted markup is the preview, and that is sandboxed. */
function card(item) {
  const el = document.createElement("div");
  el.className = "card";

  const preview = document.createElement("div");
  preview.className = "preview";
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-same-origin");
  frame.setAttribute("scrolling", "no");
  frame.title = "preview";
  frame.srcdoc = previewDoc(item);
  preview.appendChild(frame);

  const meta = document.createElement("div");
  meta.className = "meta";
  const title = document.createElement("div");
  title.className = "title";
  title.textContent = item.title || host(item.source) || "Section";
  const src = document.createElement("div");
  src.className = "src";
  src.textContent = host(item.source);
  const at = document.createElement("div");
  at.className = "when";
  at.textContent = when(item.savedAt);
  meta.append(title, src, at);

  const row = document.createElement("div");
  row.className = "row";
  const send = document.createElement("button");
  send.className = "btn btn-primary";
  send.textContent = "Send to Sites";
  send.addEventListener("click", () => sendItem(item));
  const del = document.createElement("button");
  del.className = "btn btn-danger";
  del.textContent = "Delete";
  del.addEventListener("click", () => deleteItem(item.id));
  row.append(send, del);

  el.append(preview, meta, row);
  return el;
}

function render(lib) {
  const grid = $("grid");
  grid.innerHTML = "";
  $("count").textContent = lib.length ? `${lib.length} saved` : "";
  $("clear").hidden = lib.length === 0;
  $("empty").hidden = lib.length !== 0;
  for (const item of lib) grid.appendChild(card(item));
}

$("clear").addEventListener("click", clearAll);
getLibrary().then(render);

// Stay live if a capture is saved from another tab while this page is open.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.tgsLibrary) {
    render(Array.isArray(changes.tgsLibrary.newValue) ? changes.tgsLibrary.newValue : []);
  }
});
