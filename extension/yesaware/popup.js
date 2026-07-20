'use strict';
var API = 'https://widgets.travelify.io';

document.getElementById('dash').href = API + '/yesaware';
document.getElementById('tpl').href = API + '/yesaware#templates';

var auto = document.getElementById('auto');
try { chrome.storage.local.get('autoTrack', function (o) { auto.checked = !!(o && o.autoTrack); }); } catch (e) { /* no storage */ }
auto.addEventListener('change', function () {
  try { chrome.storage.local.set({ autoTrack: auto.checked }); } catch (e) { /* ignore */ }
});
