/* TG Slicer — popup logic */

const $ = (id) => document.getElementById(id);

$("activate").addEventListener("click", () => {
  $("err").textContent = "";
  chrome.runtime.sendMessage({ type: "TGS_ACTIVATE" }, (resp) => {
    if (chrome.runtime.lastError) { $("err").textContent = chrome.runtime.lastError.message; return; }
    if (resp && resp.ok) { window.close(); }
    else { $("err").textContent = (resp && resp.error) || "Could not start on this page."; }
  });
});
