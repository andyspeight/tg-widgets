/* TG Slicer — popup logic (v0.2) */

const $ = (id) => document.getElementById(id);

chrome.storage.sync.get(["tgsEndpoint", "tgsSecret"]).then(({ tgsEndpoint, tgsSecret }) => {
  if (tgsEndpoint) $("endpoint").value = tgsEndpoint;
  if (tgsSecret) $("secret").value = tgsSecret;
});

function saveDebounced(key, value) {
  clearTimeout(saveDebounced._t);
  saveDebounced._t = setTimeout(async () => {
    await chrome.storage.sync.set({ [key]: value });
    $("saved").textContent = "Saved";
    setTimeout(() => ($("saved").textContent = ""), 1200);
  }, 350);
}

$("endpoint").addEventListener("input", (e) => saveDebounced("tgsEndpoint", e.target.value.trim()));
$("secret").addEventListener("input", (e) => saveDebounced("tgsSecret", e.target.value));

$("activate").addEventListener("click", () => {
  $("err").textContent = "";
  chrome.runtime.sendMessage({ type: "TGS_ACTIVATE" }, (resp) => {
    if (chrome.runtime.lastError) { $("err").textContent = chrome.runtime.lastError.message; return; }
    if (resp && resp.ok) { window.close(); }
    else { $("err").textContent = (resp && resp.error) || "Could not start on this page."; }
  });
});
