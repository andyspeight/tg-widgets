'use strict';

const DEFAULT_BASE = 'https://widgets.travelify.io';
const $ = (id) => document.getElementById(id);

// Accept a bare id or a full editor URL and return the id.
function extractId(value) {
  const v = String(value || '').trim();
  if (!v) return '';
  const m = v.match(/[?&]id=([^&\s]+)/);
  if (m) return decodeURIComponent(m[1]);
  return v;
}

chrome.storage.sync.get({ baseUrl: DEFAULT_BASE, widgetId: '' }, (s) => {
  $('base').value = s.baseUrl || DEFAULT_BASE;
  $('widget').value = s.widgetId || '';
});

$('save').addEventListener('click', () => {
  const widgetId = extractId($('widget').value);
  let baseUrl = String($('base').value || '').trim().replace(/\/$/, '') || DEFAULT_BASE;
  if (!/^https?:\/\//i.test(baseUrl)) baseUrl = 'https://' + baseUrl;
  $('widget').value = widgetId;
  $('base').value = baseUrl;
  chrome.storage.sync.set({ widgetId, baseUrl }, () => {
    const s = $('saved'); s.classList.add('show'); setTimeout(() => s.classList.remove('show'), 1600);
  });
});
